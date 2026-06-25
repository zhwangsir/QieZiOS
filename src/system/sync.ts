// ───────────────────────────────────────────────────────────
// 跨设备同步（雏形）· 把本地状态推到 /sync/<token> 或从云端拉回。
// token 当密钥（自托管单人足够）；排除 qz.ai（含 API key）与 token 本身，不上云。
// ⚠️ /sync 由生产后端 server/index.mjs 提供 → 仅在 `npm run serve` 部署下可用（dev 无此端点）。
// ───────────────────────────────────────────────────────────
const TOKEN_KEY = 'qz.syncToken';
const EXCLUDE = new Set([TOKEN_KEY, 'qz.ai']);

export function syncToken(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

// 收集要同步的本地状态（所有 qz.* 键，排除敏感/本机项）
export function gatherState(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('qz.') && !EXCLUDE.has(k)) {
      const v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    }
  }
  return out;
}

export async function pushSync(): Promise<number> {
  const state = gatherState();
  const res = await fetch('/sync/' + syncToken(), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error('上传失败（HTTP ' + res.status + '）—— 同步需在 npm run serve 的部署下使用');
  return Object.keys(state).length;
}

// 拉取并写回本地。返回恢复的键数（调用方通常随后 location.reload() 让状态生效）。
export async function pullSync(): Promise<number> {
  const res = await fetch('/sync/' + syncToken());
  if (res.status === 404) throw new Error('云端还没有这个 token 的数据');
  if (!res.ok) throw new Error('下载失败（HTTP ' + res.status + '）');
  const body = await res.json();
  const data = (body && body.data) || {};
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('qz.') && !EXCLUDE.has(k) && typeof v === 'string') {
      localStorage.setItem(k, v);
      n++;
    }
  }
  return n;
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzSync: unknown }).__qzSync = { syncToken, gatherState, pushSync, pullSync };
}
