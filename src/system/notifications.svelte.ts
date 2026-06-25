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

let nid = 0;

export function pushNote(p: { title: string; body?: string; level?: NoteLevel; timeout?: number }): number {
  const id = ++nid;
  notifications.items.push({ id, title: p.title, body: p.body, level: p.level ?? 'info', ts: Date.now() });
  const timeout = p.timeout ?? 4500;
  // setTimeout（非 rAF）：隐藏标签页里也会触发，自动消失才靠谱
  if (timeout > 0) setTimeout(() => dismissNote(id), timeout);
  return id;
}

export function dismissNote(id: number): void {
  const i = notifications.items.findIndex((n) => n.id === id);
  if (i !== -1) notifications.items.splice(i, 1);
}
