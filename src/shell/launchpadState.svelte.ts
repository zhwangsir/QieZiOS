// Launchpad（全 App 网格启动器）的开关。点顶栏 🍆 唤起。仿 spotlightState 的极简共享状态。
export const launchpad = $state<{ open: boolean }>({ open: false });
export function openLaunchpad(): void {
  launchpad.open = true;
}
export function closeLaunchpad(): void {
  launchpad.open = false;
}
