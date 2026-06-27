import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 桌面便签小组件（E8b）：贴在桌面上的便利贴。
// 持久化一组便签（文本 + 位置 + 颜色），拖动改位置、编辑改文本都自动存盘。
// ───────────────────────────────────────────────────────────
export interface StickyNote {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
}

export const stickyNotes = persisted<{ list: StickyNote[] }>('qz.notes', { list: [] });

// 几种便利贴底色（暖色系，配深色字）
export const NOTE_COLORS = ['#fde68a', '#fca5a5', '#a7f3d0', '#bfdbfe', '#ddd6fe', '#fbcfe8'];

export function addNote(): string {
  const id = crypto.randomUUID();
  const n = stickyNotes.list.length;
  stickyNotes.list.push({
    id,
    text: '',
    x: 90 + (n % 6) * 26, // 错开堆叠，避免新便签完全重叠
    y: 90 + (n % 6) * 26,
    color: NOTE_COLORS[n % NOTE_COLORS.length],
  });
  return id;
}

export function removeNote(id: string): void {
  const i = stickyNotes.list.findIndex((x) => x.id === id);
  if (i !== -1) stickyNotes.list.splice(i, 1);
}

export function cycleColor(id: string): void {
  const note = stickyNotes.list.find((x) => x.id === id);
  if (!note) return;
  const idx = NOTE_COLORS.indexOf(note.color);
  note.color = NOTE_COLORS[(idx + 1) % NOTE_COLORS.length];
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzNotes: unknown }).__qzNotes = { stickyNotes, addNote, removeNote, cycleColor };
}
