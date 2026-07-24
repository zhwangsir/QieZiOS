// 锁屏上滑解锁的手势判定（纯函数，便于单测）。
// dragOffset：跟手位移（上滑为负）；越过 1/3 屏 → 松手解锁，否则弹簧回弹。
export const UNLOCK_RATIO = 1 / 3;

export function shouldUnlock(dragOffset: number, viewportHeight: number): boolean {
  if (viewportHeight <= 0) return false;
  return dragOffset < 0 && -dragOffset >= viewportHeight * UNLOCK_RATIO;
}

// 跟手位移带阻尼：拖过阈值后阻力变大（iOS 橡皮筋手感）。
export function rubberBand(dy: number): number {
  if (dy >= 0) return 0; // 下滑不跟手
  return dy * 0.85;
}

// Home Indicator 单/双击判定窗口（毫秒）
export const DOUBLE_TAP_MS = 280;
export function isDoubleTap(now: number, lastTap: number): boolean {
  return lastTap > 0 && now - lastTap < DOUBLE_TAP_MS;
}

// ───────────────────────────────────────────────────────────
// 长按判定（M5.8：移动端图标长按 → 上下文菜单）
// 用法：pointerdown 起计时 ≥LONG_PRESS_MS 且无超容差位移 → 触发；中途位移/抬起即取消。
// ───────────────────────────────────────────────────────────
export const LONG_PRESS_MS = 500;
// 按住期间允许的位移容差（px，取 x/y 较大者）：手指微抖不取消，超过视为拖动/滚动
export const LONG_PRESS_TOLERANCE = 10;

// 按住时长是否已达长按阈值
export function isLongPress(durationMs: number): boolean {
  return durationMs >= LONG_PRESS_MS;
}

// 按下后位移是否超出容差（超出 → 长按应取消）
export function longPressCancelled(dx: number, dy: number): boolean {
  return Math.max(Math.abs(dx), Math.abs(dy)) > LONG_PRESS_TOLERANCE;
}
