// ───────────────────────────────────────────────────────────
// Dock 右键菜单构建（纯函数，注入状态 + 回调 → 可在 vitest 里裸跑，不碰内核/DOM）。
// macOS 心智：边界项（左移/右移到头）保留但禁用灰化，不直接消失；
// 开关项（自动隐藏）用 checked ✓ 表达，不再拼 '✓ ' 文本前缀。
// ───────────────────────────────────────────────────────────
import type { MenuItem } from './menu.svelte';

export interface DockMenuActions {
  openNew: () => void; // 打开新窗口
  minimizeAll: () => void; // 最小化全部（该 App 所有窗）
  closeAll: () => void; // 关闭全部（该 App 所有窗）
  move: (orderedIds: string[], id: string, dir: -1 | 1) => void; // 左移/右移一格
  pin: () => void; // 固定到 Dock
  unpin: () => void; // 从 Dock 移除
  toggleAutohide: () => void; // 切换自动隐藏
  reset: () => void; // 重置 Dock 布局
}

export interface DockMenuOptions {
  appId: string; // 右键的 App
  ids: string[]; // 当前 Dock 展示顺序（排序后的 appId 列表）
  running: boolean; // 该 App 是否有进程在跑
  pinned: boolean; // 是否已固定
  autohide: boolean; // 当前自动隐藏开关
  actions: DockMenuActions;
}

export function buildDockMenu(o: DockMenuOptions): MenuItem[] {
  const i = o.ids.indexOf(o.appId);
  const items: MenuItem[] = [{ label: '打开新窗口', icon: '➕', onClick: o.actions.openNew }];
  if (o.running) {
    items.push({ label: '最小化全部', icon: '—', separator: true, onClick: o.actions.minimizeAll });
    items.push({ label: '关闭全部', icon: '✕', danger: true, onClick: o.actions.closeAll });
  }
  // 排序：左移/右移始终保留，到头则禁用（分割线只画在组前一条 → 挂左移上）
  items.push({
    label: '左移',
    icon: '◀',
    separator: true,
    disabled: i <= 0,
    onClick: () => o.actions.move(o.ids, o.appId, -1),
  });
  items.push({
    label: '右移',
    icon: '▶',
    disabled: i < 0 || i >= o.ids.length - 1,
    onClick: () => o.actions.move(o.ids, o.appId, 1),
  });
  // 固定 / 取消固定
  if (o.pinned) items.push({ label: '从 Dock 移除', icon: '📌', separator: true, onClick: o.actions.unpin });
  else items.push({ label: '固定到 Dock', icon: '📌', separator: true, onClick: o.actions.pin });
  items.push({
    label: '自动隐藏 Dock',
    icon: '⬇',
    separator: true,
    checked: o.autohide,
    onClick: o.actions.toggleAutohide,
  });
  items.push({ label: '重置 Dock 布局', icon: '↺', onClick: o.actions.reset });
  return items;
}
