// 键盘快捷键速查面板的开关（按 ? 唤起；桌面右键也能开）。仿 spotlightState 的极简共享状态。
export const shortcuts = $state<{ open: boolean }>({ open: false });
export function openShortcuts(): void {
  shortcuts.open = true;
}
export function closeShortcuts(): void {
  shortcuts.open = false;
}
