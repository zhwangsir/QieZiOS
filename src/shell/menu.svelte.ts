// ───────────────────────────────────────────────────────────
// 右键菜单 · 一份全局共享状态 + 打开/关闭
// 任何地方右键时调用 openMenu(e, items)，由 <ContextMenu/> 统一渲染。
// （文件名特意用 menu.svelte.ts，避免和组件 ContextMenu.svelte 在
//  Windows 大小写不敏感的文件系统上撞名。）
// ───────────────────────────────────────────────────────────
export interface MenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean; // 危险操作（删除）用红色
  separator?: boolean; // 在此项之前画一条分割线
  shortcut?: string; // 快捷键提示（如 '⌘Q'），右对齐 kbd 样式；只标注真实接了 handler 的快捷键
  disabled?: boolean; // 禁用态：灰化、不可点、hover 无高亮（项保留不消失，macOS 心智）
  checked?: boolean; // 勾选态：图标列显示 ✓（与 icon 同列，同时存在时 ✓ 优先）
}

export const menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
  open: false,
  x: 0,
  y: 0,
  items: [],
});

// 在指定坐标开菜单（U8 顶栏按钮下拉用：传按钮锚点坐标）。坐标粗略夹进视口（不用精确测量）。
export function openMenuAt(x: number, y: number, items: MenuItem[]) {
  const estW = 200;
  const estH = items.length * 34 + 12;
  menu.x = Math.min(x, window.innerWidth - estW - 8);
  menu.y = Math.min(y, window.innerHeight - estH - 8);
  menu.items = items;
  menu.open = true;
}

export function openMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  openMenuAt(e.clientX, e.clientY, items);
}

export function closeMenu() {
  menu.open = false;
}
