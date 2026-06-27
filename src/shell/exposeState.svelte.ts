// 任务视图（Exposé）浮层开关状态。仿 spotlightState / launchpadState 模式。
export const expose = $state({ open: false });

export function openExpose(): void {
  expose.open = true;
}
export function closeExpose(): void {
  expose.open = false;
}
export function toggleExpose(): void {
  expose.open = !expose.open;
}
