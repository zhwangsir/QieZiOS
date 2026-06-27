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

// ── 终端外观（配色 + 字号，持久化）──────────────────────────
// 每个配色给 背景/前景/输入回显(绿)/错误(红)/光标 五个颜色（可填 hex 或 CSS var）。
export interface TermScheme {
  id: string;
  name: string;
  bg: string;
  fg: string;
  in: string;
  err: string;
  caret: string;
}
export const TERM_SCHEMES: TermScheme[] = [
  { id: 'default', name: '默认', bg: '#0c0d12', fg: '#d6deeb', in: '#7ee787', err: '#ff7b72', caret: '#7ee787' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', fg: '#d8dee9', in: '#a3be8c', err: '#bf616a', caret: '#88c0d0' },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', fg: '#f8f8f2', in: '#50fa7b', err: '#ff5555', caret: '#bd93f9' },
  { id: 'solarized', name: 'Solarized', bg: '#002b36', fg: '#93a1a1', in: '#859900', err: '#dc322f', caret: '#268bd2' },
  { id: 'light', name: '亮色', bg: '#f6f8fa', fg: '#24292f', in: '#1a7f37', err: '#cf222e', caret: '#0969da' },
  // 跟随系统主题：用运行时 token，换肤时终端跟着变
  { id: 'system', name: '跟随系统', bg: 'var(--color-qz-surface)', fg: 'var(--color-qz-text)', in: 'var(--color-qz-accent)', err: '#ef4444', caret: 'var(--color-qz-accent)' },
];

export const termPrefs = persisted<{ scheme: string; fontSize: number }>('qz.term', { scheme: 'default', fontSize: 13 });

export function termScheme(): TermScheme {
  return TERM_SCHEMES.find((s) => s.id === termPrefs.scheme) ?? TERM_SCHEMES[0];
}

// 追加一条历史（跳过空行与「与上一条完全相同」，封顶 HISTORY_CAP）
export function addHistory(cmd: string): void {
  const t = cmd.trim();
  if (!t) return;
  const list = cmdHistory.list;
  if (list[list.length - 1] === t) return;
  list.push(t);
  if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP);
}
