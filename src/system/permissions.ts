// ───────────────────────────────────────────────────────────
// 权限判定（纯函数）· 终端与 GUI 共用一套逻辑，避免两边各写一份走偏。
// 调用方传入「当前用户」（来自 account.currentUser() 或 shell ctx.env.USER）。
// 模型：root 全通过；属主看 owner 段、否则看 other 段（暂无 group）。bit: 4=读 2=写 1=执行。
// ───────────────────────────────────────────────────────────
import { defaultMode, DEFAULT_OWNER, type VNode } from '../kernel/vfs.svelte';

export function nodeMode(n: VNode): number {
  return n.mode ?? defaultMode(n.type);
}

// rwxr-xr-x 风格权限串（首字符 d/-）
export function modeStr(n: VNode): string {
  const m = nodeMode(n);
  const triad = (t: number) => `${t & 4 ? 'r' : '-'}${t & 2 ? 'w' : '-'}${t & 1 ? 'x' : '-'}`;
  return (n.type === 'dir' ? 'd' : '-') + triad((m >> 6) & 7) + triad((m >> 3) & 7) + triad(m & 7);
}

// 某用户对某节点是否有 bit 权限（4=读 2=写 1=执行）
export function permits(n: VNode, user: string, bit: number): boolean {
  if (user === 'root') return true;
  const m = nodeMode(n);
  const triad = user === (n.owner ?? DEFAULT_OWNER) ? (m >> 6) & 7 : m & 7;
  return (triad & bit) !== 0;
}

// 当前用户对该节点的 rwx 串（给 GUI 显示「你的权限」）
export function accessStr(n: VNode, user: string): string {
  return `${permits(n, user, 4) ? 'r' : '-'}${permits(n, user, 2) ? 'w' : '-'}${permits(n, user, 1) ? 'x' : '-'}`;
}
