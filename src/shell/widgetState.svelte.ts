import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 桌面小组件（R4-F6）：贴在桌面上的活动小卡片（时钟 / 日历 / 系统状态）。
// 镜像便签（notes.svelte.ts）的拖动 + 持久化模式：持久一组 {kind,x,y}，拖动改位置自动存。
// ⚠️ 文件名用 widgetState（非 widgets）避免与组件 Widgets.svelte 在 Windows 上只差大小写而撞名。
// ───────────────────────────────────────────────────────────
export type WidgetKind = 'clock' | 'calendar' | 'sysstat';
export interface Widget {
  id: string;
  kind: WidgetKind;
  x: number;
  y: number;
}

export const widgets = persisted<{ list: Widget[] }>('qz.widgets', { list: [] });

const KINDS: WidgetKind[] = ['clock', 'calendar', 'sysstat'];

export function addWidget(kind: WidgetKind = 'clock'): string {
  const id = crypto.randomUUID();
  const n = widgets.list.length;
  widgets.list.push({ id, kind, x: 120 + (n % 6) * 28, y: 120 + (n % 6) * 28 }); // 错开堆叠
  return id;
}

export function removeWidget(id: string): void {
  const i = widgets.list.findIndex((w) => w.id === id);
  if (i !== -1) widgets.list.splice(i, 1);
}

// 切换小组件类型（时钟→日历→系统状态→…）：一个菜单项即可造出任意小组件
export function cycleWidgetKind(id: string): void {
  const w = widgets.list.find((x) => x.id === id);
  if (!w) return;
  w.kind = KINDS[(KINDS.indexOf(w.kind) + 1) % KINDS.length];
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzWidgets: unknown }).__qzWidgets = { widgets, addWidget, removeWidget, cycleWidgetKind };
}
