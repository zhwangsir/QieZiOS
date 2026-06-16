// Spotlight 命令面板的开关状态（Ctrl/Cmd+K 打开）。
// 文件名用 spotlightState 避免和组件 Spotlight.svelte 在 Windows 上撞名。
export const spotlight = $state<{ open: boolean }>({ open: false });

export function openSpotlight() {
  spotlight.open = true;
}
export function closeSpotlight() {
  spotlight.open = false;
}
