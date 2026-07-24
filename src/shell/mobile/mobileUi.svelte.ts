// ───────────────────────────────────────────────────────────
// 移动外壳共享 UI 状态（模块级 $state，不持久化）
// M3 起锁屏并入统一会话状态机（system/session.svelte.ts 的 phase），
// 本模块只剩控制中心面板开关。
// ───────────────────────────────────────────────────────────
export const mobileUi = $state({
  ccOpen: false, // 控制中心面板开关
});

export function openControlCenter(): void {
  mobileUi.ccOpen = true;
}
export function closeControlCenter(): void {
  mobileUi.ccOpen = false;
}
