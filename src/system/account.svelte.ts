import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 账号会话（持久化）。token = 服务端发的会话凭据；username 仅显示用。
// ⚠️ 功能优先 / 安全待硬化：简单会话，无过期/刷新（见记忆 prioritize-features-over-security）。
// /auth 与 /sync 由 server/index.mjs 提供：dev 经 vite 代理转发到本地 node 服务，生产同源。
// ───────────────────────────────────────────────────────────
export const account = persisted<{ username: string; token: string }>('qz.account', { username: '', token: '' });

export function loggedIn(): boolean {
  return !!account.token;
}

async function post(path: string, username: string, password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('连不上服务器（账号功能需 npm run serve 部署 / dev 下需本地后端在跑）');
  }
  const body = await res.json().catch(() => ({}) as { username?: string; token?: string; error?: string });
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  account.username = body.username ?? username;
  account.token = body.token ?? '';
}

export function register(username: string, password: string): Promise<void> {
  return post('/auth/register', username, password);
}
export function login(username: string, password: string): Promise<void> {
  return post('/auth/login', username, password);
}
export function logout(): void {
  account.username = '';
  account.token = '';
}
