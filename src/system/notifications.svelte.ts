import { persisted } from '../kernel/persist.svelte';

// 通知队列（数据层）：系统 toast 的真相源。通知中心服务往里 push，外壳的 toast 层渲染它。
export type NoteLevel = 'info' | 'success' | 'warn' | 'error';
export interface Note {
  id: number;
  title: string;
  body?: string;
  level: NoteLevel;
  ts: number;
}

export const notifications = $state<{ items: Note[] }>({ items: [] });

// 通知历史（持久化）：toast 弹完即焚，但历史留在这里，供顶栏「通知中心」回看错过的通知。
// lastSeen：上次打开通知中心的时间戳 → 之后的通知算「未读」，给铃铛角标计数。
const HISTORY_CAP = 40;
export const noteHistory = persisted<{ items: Note[]; lastSeen: number }>('qz.notehistory', { items: [], lastSeen: 0 });

// 计数器从「已持久化历史的最大 id」之上起步：刷新后 nid 本会重置为 0，若新通知从 1 起，
// 会和持久化历史里的旧 id 撞 → 通知中心 keyed {#each (n.id)} 出现重复 key → Svelte each_key_duplicate 崩溃。
let nid = noteHistory.items.reduce((m, n) => Math.max(m, n.id), 0);

export function pushNote(p: { title: string; body?: string; level?: NoteLevel; timeout?: number }): number {
  const id = ++nid;
  const note: Note = { id, title: p.title, body: p.body, level: p.level ?? 'info', ts: Date.now() };
  notifications.items.push(note);
  noteHistory.items.push({ ...note });
  if (noteHistory.items.length > HISTORY_CAP) noteHistory.items.splice(0, noteHistory.items.length - HISTORY_CAP);
  const timeout = p.timeout ?? 4500;
  // setTimeout（非 rAF）：隐藏标签页里也会触发，自动消失才靠谱
  if (timeout > 0) setTimeout(() => dismissNote(id), timeout);
  return id;
}

export function dismissNote(id: number): void {
  const i = notifications.items.findIndex((n) => n.id === id);
  if (i !== -1) notifications.items.splice(i, 1);
}

// 未读数：晚于 lastSeen 的历史通知
export function unreadCount(): number {
  return noteHistory.items.filter((n) => n.ts > noteHistory.lastSeen).length;
}
// 打开通知中心时调用：把「上次看到」推到现在 → 未读清零
export function markNotesSeen(): void {
  noteHistory.lastSeen = Date.now();
}
export function clearHistory(): void {
  noteHistory.items = [];
}
