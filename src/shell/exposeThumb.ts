// ───────────────────────────────────────────────────────────
// Exposé（任务视图）窗口缩略图 · 纯函数层（不 import 组件，vitest 可直接跑）
// 把窗口真实宽高（proc.width × proc.height）等比缩进预览框，保持宽高比，
// 让任务视图里的「迷你窗口」形状忠于真实窗口（宽窗扁、窄窗长）。
// ───────────────────────────────────────────────────────────

export interface ThumbSize {
  w: number; // 缩略宽（px，已取整）
  h: number; // 缩略高（px，已取整）
  scale: number; // 实际缩放比（≤ 1，只缩不放）
}

// 预览框默认上限（卡片主体区域）：比卡片略小，留出内边距。
export const THUMB_MAX_W = 150;
export const THUMB_MAX_H = 86;

// 等比缩放：min(maxW/w, maxH/h)，且不放大（小窗口按原尺寸显示）。
// 非法尺寸（0/负/NaN）按 1 兜底，保证永远返回正整数像素。
export function fitThumb(
  width: number,
  height: number,
  maxW: number = THUMB_MAX_W,
  maxH: number = THUMB_MAX_H,
): ThumbSize {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale };
}
