// 系统剪贴板（数据层）：带历史的共享内容。剪贴板服务 clipd 往里 push，剪贴板 App 展示。
export interface ClipItem {
  id: number;
  text: string;
  ts: number;
}

const MAX = 30;
let cid = 0;

export const clipboard = $state<{ items: ClipItem[] }>({ items: [] });

export function pushClip(text: string): void {
  const t = String(text ?? '');
  if (!t) return;
  if (clipboard.items[0]?.text === t) return; // 和最新一条相同 → 不重复
  clipboard.items.unshift({ id: ++cid, text: t, ts: Date.now() });
  if (clipboard.items.length > MAX) clipboard.items.length = MAX;
  // best-effort 同步到浏览器真剪贴板（无权限/非安全上下文就算了）
  try {
    navigator.clipboard?.writeText(t);
  } catch {
    /* ignore */
  }
}

export function clearClipboard(): void {
  clipboard.items = [];
}

export function currentClip(): string {
  return clipboard.items[0]?.text ?? '';
}
