import { persisted } from '../kernel/persist.svelte';

// 桌面图标的摆放位置（nodeId → {x,y}），拖动后持久化。
// 没记录的图标走自动排布（见 DesktopIcons.svelte）。
// 文件名用 iconLayout.svelte.ts，避免和组件 DesktopIcons.svelte 在 Windows 上撞名。
export const iconPos = persisted<{ pos: Record<string, { x: number; y: number }> }>(
  'qz.desktopIcons',
  { pos: {} },
  250,
);
