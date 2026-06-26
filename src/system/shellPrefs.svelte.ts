import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// Shell 偏好（持久化）：别名 + 命令历史。
// 终端与 AI 的 shell 会话共用同一份 → 别名/历史跨终端、跨刷新保留。
// （放 .svelte.ts 因为 persisted 用了 runes；lib/shell.ts 是纯 .ts 用不了。）
// ───────────────────────────────────────────────────────────
export const aliases = persisted<{ map: Record<string, string> }>('qz.aliases', { map: {} });

export function setAlias(name: string, value: string): void {
  aliases.map[name] = value;
}
export function removeAlias(name: string): void {
  delete aliases.map[name];
}

const HISTORY_CAP = 200;
export const cmdHistory = persisted<{ list: string[] }>('qz.cmdhistory', { list: [] });

// 追加一条历史（跳过空行与「与上一条完全相同」，封顶 HISTORY_CAP）
export function addHistory(cmd: string): void {
  const t = cmd.trim();
  if (!t) return;
  const list = cmdHistory.list;
  if (list[list.length - 1] === t) return;
  list.push(t);
  if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP);
}
