import { executeTool } from './aiTools';
import { complete } from './ai';

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

// 默认授权的能力（MVP：现有安全工具全开；将来按 App 的能力声明收紧）
export const DEFAULT_CAPS = new Set<string>([
  'list_apps',
  'launch_app',
  'list_files',
  'create_folder',
  'create_file',
  'write_file',
  'set_theme',
]);

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
    let result: unknown;
    if (data.name === '__ask') {
      result = await complete(String(data.input?.prompt ?? ''), {});
    } else if (allow.has(data.name)) {
      result = await executeTool(data.name, data.input ?? {});
    } else {
      throw new Error('能力未授权：' + data.name);
    }
    post({ result });
  } catch (e) {
    post({ error: e instanceof Error ? e.message : String(e) });
  }
}
