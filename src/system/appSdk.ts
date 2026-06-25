import { executeTool } from './aiTools';
import { complete } from './ai';
import { emit } from '../kernel/bus.svelte';

// ───────────────────────────────────────────────────────────
// App SDK · 契约式运行时（D2 平台地基）
// 用户写的 App 跑在「沙箱 iframe」里（sandbox=allow-scripts，无 same-origin → 摸不到
// 宿主 DOM/localStorage/cookie），只能通过 postMessage 跟宿主对话。
// 宿主收到调用 → 校验能力白名单 → 路由到 executeTool / AI → 把结果 postMessage 回去。
// 这就是「能力申请」的雏形：iframe 想干什么都得过宿主这道闸。
// ───────────────────────────────────────────────────────────

// 注入进 iframe 的访客 SDK：暴露 window.qz.*（Promise 化的 RPC）。
// 放进 <head> → 用户代码运行时 qz 已就绪。
const GUEST_SDK = `<script>
(function () {
  var _id = 0, _pending = {};
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.__qz !== 'res' || !_pending[m.id]) return;
    var p = _pending[m.id]; delete _pending[m.id];
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
  });
  function call(name, input) {
    return new Promise(function (resolve, reject) {
      var id = ++_id; _pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ __qz: 'call', id: id, name: name, input: input || {} }, '*');
    });
  }
  window.qz = {
    call: call,
    listApps: function () { return call('list_apps'); },
    launchApp: function (appId) { return call('launch_app', { appId: appId }); },
    listFiles: function (folderId) { return call('list_files', { folderId: folderId }); },
    createFolder: function (name, parentId) { return call('create_folder', { name: name, parentId: parentId }); },
    createFile: function (name, content, parentId) { return call('create_file', { name: name, content: content, parentId: parentId }); },
    writeFile: function (fileId, content) { return call('write_file', { fileId: fileId, content: content }); },
    setTheme: function (t) { return call('set_theme', t || {}); },
    ask: function (prompt) { return call('__ask', { prompt: prompt }); }
  };
})();
<\/script>`;

// 把用户代码（HTML+CSS+JS，作为 body 内容）包成一份完整文档 + 注入 SDK。
export function buildSrcdoc(userCode: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0}body{font-family:system-ui,-apple-system,sans-serif;color:#e7e7ea;padding:12px}</style>' +
    GUEST_SDK +
    '</head><body>' +
    userCode +
    '</body></html>'
  );
}

// 能力分组：给用户/开发者看的粗粒度权限 → 背后映射到具体工具名。
// App 声明它要哪些 cap key，宿主据此放行对应工具；没声明的工具一律拒绝。
export interface Capability {
  key: string;
  label: string;
  desc: string;
  icon: string;
  tools: string[];
}
export const CAPABILITIES: Capability[] = [
  { key: 'apps', label: '启动 App', desc: '列出并打开其它 App', icon: '🚀', tools: ['list_apps', 'launch_app'] },
  {
    key: 'files',
    label: '读写文件',
    desc: '增删改查文件与文件夹',
    icon: '📁',
    tools: ['list_files', 'create_folder', 'create_file', 'write_file'],
  },
  { key: 'theme', label: '换肤', desc: '修改系统主题/壁纸', icon: '🎨', tools: ['set_theme'] },
  { key: 'ai', label: 'AI', desc: '调用 AI 问答', icon: '🤖', tools: ['__ask'] },
];
export const ALL_CAP_KEYS = CAPABILITIES.map((c) => c.key);

// 声明的 cap key 列表 → 允许的工具名集合。
// capKeys 为 undefined（旧 App 没声明字段）→ 全给（向后兼容，不弄坏老 App）。
export function capsToTools(capKeys: string[] | undefined): Set<string> {
  if (!capKeys) return new Set(CAPABILITIES.flatMap((c) => c.tools));
  const allow = new Set<string>();
  for (const c of CAPABILITIES) if (capKeys.includes(c.key)) c.tools.forEach((t) => allow.add(t));
  return allow;
}

interface GuestCall {
  __qz: 'call';
  id: number;
  name: string;
  input?: Record<string, unknown>;
}
function isGuestCall(d: unknown): d is GuestCall {
  return !!d && typeof d === 'object' && (d as { __qz?: unknown }).__qz === 'call';
}

// 宿主端：处理一条访客调用，把结果/错误 postMessage 回那个 iframe。
export async function handleGuestCall(win: Window, data: unknown, allow: Set<string>): Promise<void> {
  if (!isGuestCall(data)) return;
  const post = (patch: Record<string, unknown>) =>
    win.postMessage({ __qz: 'res', id: data.id, ...patch }, '*');
  try {
    if (!allow.has(data.name)) {
      emit('app.denied', { tool: data.name });
      throw new Error('能力未授权：' + data.name);
    }
    emit('app.call', { tool: data.name });
    let result: unknown;
    if (data.name === '__ask') {
      result = await complete(String(data.input?.prompt ?? ''), {});
    } else {
      result = await executeTool(data.name, data.input ?? {});
    }
    post({ result });
  } catch (e) {
    post({ error: e instanceof Error ? e.message : String(e) });
  }
}
