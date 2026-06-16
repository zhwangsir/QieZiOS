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
}

export const menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[] }>({
  open: false,
  x: 0,
  y: 0,
  items: [],
});

export function openMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  // 粗略夹住位置，别让菜单超出视口（不用精确测量）
  const estW = 200;
  const estH = items.length * 34 + 12;
  menu.x = Math.min(e.clientX, window.innerWidth - estW - 8);
  menu.y = Math.min(e.clientY, window.innerHeight - estH - 8);
  menu.items = items;
  menu.open = true;
}

export function closeMenu() {
  menu.open = false;
}
