// ───────────────────────────────────────────────────────────
// 跨设备同步 · 账号制：登录后把本地状态推到 /sync（按账号隔离）或从云端拉回。
// 鉴权靠 account.token（Authorization: Bearer）。排除敏感/本机项不上云。
// ⚠️ /auth、/sync 由 server/index.mjs 提供：dev 经 vite 代理转发本地 node 服务，生产同源。
// ───────────────────────────────────────────────────────────
import { account } from './account.svelte';
import { ASYNC_KEYS, flushPersisted, freezePersistence, unfreezePersistence } from '../kernel/persist.svelte';
import { idbEntries, idbSet } from '../kernel/idbStore';

// 不上云：会话/凭据（qz.account）、AI 配置含 key（qz.ai）、旧 token（qz.syncToken）
const EXCLUDE = new Set(['qz.account', 'qz.ai', 'qz.syncToken']);

// 收集要同步的本地状态（所有 qz.* 键，排除敏感/本机项）。
// 大块状态（VFS 等）已迁 IndexedDB → 同时从 localStorage 与 IDB 两个后端收集，否则会漏掉文件系统。
export async function gatherState(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('qz.') && !EXCLUDE.has(k)) {
      const v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    }
  }
  // IDB 里的 qz.*（如 qz.vfs）一并纳入
  for (const [k, v] of Object.entries(await idbEntries())) {
    if (k.startsWith('qz.') && !EXCLUDE.has(k)) out[k] = v;
  }
  return out;
}

export async function pushSync(): Promise<number> {
  if (!account.token) throw new Error('请先登录账号');
  await flushPersisted(); // 先把挂起的防抖写盘刷干净，避免上传陈旧状态（改完立刻上传会漏最新改动）
  const state = await gatherState();
  const res = await fetch('/sync', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + account.token },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error('上传失败（HTTP ' + res.status + '）');
  return Object.keys(state).length;
}

// 拉取并写回本地。返回恢复的键数（调用方通常随后 location.reload() 让状态生效）。
export async function pullSync(): Promise<number> {
  if (!account.token) throw new Error('请先登录账号');
  const res = await fetch('/sync', { headers: { authorization: 'Bearer ' + account.token } });
  if (res.status === 404) throw new Error('云端还没有你的数据');
  if (!res.ok) throw new Error('下载失败（HTTP ' + res.status + '）');
  const body = await res.json();
  const data = (body && body.data) || {};
  // 冻结持久化：写回云数据前先停掉所有 store 的内存→盘写盘（F1）——否则 reload 前的窗口里，
  // 任何对 store 的响应式写会把「旧内存」序列化盖回刚拉下来的云数据，静默丢失正要恢复的数据。
  // 成功后调用方 reload（模块重载、frozen 复位）；写回中途失败则解冻、让正常保存恢复。
  freezePersistence();
  try {
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('qz.') && !EXCLUDE.has(k) && typeof v === 'string') {
        // 按键所属后端写回：IDB 键（如 qz.vfs）写 IndexedDB，其余写 localStorage。
        if (ASYNC_KEYS.has(k)) await idbSet(k, v);
        else localStorage.setItem(k, v);
        n++;
      }
    }
    return n;
  } catch (e) {
    unfreezePersistence(); // 写回失败、不会 reload → 恢复正常保存，避免本会话永久冻结
    throw e;
  }
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzSync: unknown }).__qzSync = { gatherState, pushSync, pullSync, flushPersisted, freezePersistence, unfreezePersistence };
}
