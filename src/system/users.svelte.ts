import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 用户/账户模型（对标 Linux 的 /etc/passwd）。
// 单机自托管 → 不做密码鉴权，su/sudo 直接切身份（隐喻）。
// 默认两个用户：root(0) + qiezi(1000，与 shell 默认 USER 一致)。
// ───────────────────────────────────────────────────────────
export interface User {
  name: string;
  uid: number;
  gid: number;
}

export const users = persisted<{ list: User[] }>('qz.users', {
  list: [
    { name: 'root', uid: 0, gid: 0 },
    { name: 'qiezi', uid: 1000, gid: 1000 },
  ],
});

export function getUser(name: string): User | undefined {
  return users.list.find((u) => u.name === name);
}
export function userExists(name: string): boolean {
  return users.list.some((u) => u.name === name);
}
// 新建用户：uid 从现有最大值（≥1000）往后排
export function addUser(name: string): User {
  // 从 1000 起算（floor 1000 → 即便 qiezi 被删也不会复用其规范 uid 1000，新用户恒 ≥1001）
  const uid = Math.max(1000, ...users.list.map((u) => u.uid).filter((x) => x < 60000)) + 1;
  const u: User = { name, uid, gid: uid };
  users.list.push(u);
  return u;
}

// 确保某用户存在（登录账号时把账号名接进 shell 用户表 → su/id//etc/passwd 都认它）
export function ensureUser(name: string): User {
  return getUser(name) ?? addUser(name);
}

// 渲染成 /etc/passwd 一行：name:x:uid:gid::home:shell
export function passwdLine(u: User): string {
  return `${u.name}:x:${u.uid}:${u.gid}::${u.name === 'root' ? '/root' : '/'}:/bin/qzsh`;
}
export function passwdContent(): string {
  return users.list.map(passwdLine).join('\n') + '\n';
}
