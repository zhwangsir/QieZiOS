// 窗口拖拽边缘贴靠预览 —— 纯函数库（vitest 可裸跑）
// 把「边缘判定」和「zone → 几何计算」抽离出组件，供预览浮层与落位共用，保证像素级一致。

/** 边缘检测的输出 zone（可预览/可拖拽落位）。
 *  上边缘 → max（最大化）；左/右边缘 → 半屏；四角 → 四分之一屏。
 *  （top/bottom/lthird/cthird/rthird 只能由贴靠浮层点击触发，不由边缘检测产出。）
 */
export type SnapZone = 'left' | 'right' | 'max' | 'tl' | 'tr' | 'bl' | 'br';

/** 边缘判定带宽度（px）：指针离窗口层左/右/上边缘 ≤ 8px 即命中对应边缘。 */
export const SNAP_EDGE_T = 8;

/** 角落判定带宽度（px）：距相邻两边均 ≤ 96px 的 96×96 方块区 → 判为对应四角。 */
export const SNAP_CORNER_T = 96;

/**
 * 根据指针在窗口层内的坐标，判定应当吸附到哪个 zone。
 * 纯函数：无 DOM/状态副作用，vitest 可裸跑。
 *
 * 规则：
 * 1. 四角优先：指针进入屏幕四角的 96×96 方块区 → 对应四分之一屏
 *    （角落与左/右/上边缘带重叠时，角落胜出）。
 * 2. 上边缘 ≤8px → max（最大化）。
 * 3. 左/右边缘 ≤8px → left/right 半屏。
 * 4. 底部边缘与其余区域 → null（底部是 Dock 区域，不触发）。
 * 指针拖出屏幕外（越界坐标）仍按最近边缘判定，与指针捕获的拖拽行为一致。
 *
 * @param x 指针在窗口层坐标系中的 x（px）
 * @param y 指针在窗口层坐标系中的 y（px）
 * @param w 窗口层宽度（px）
 * @param h 窗口层高度（px）
 * @returns 命中 zone 或 null（未命中任何吸附区）
 */
export function detectSnapZone(x: number, y: number, w: number, h: number): SnapZone | null {
  // ── 四角 96×96 方块区，优先于一切边缘判定 ──
  const inLeftBand = x <= SNAP_CORNER_T;
  const inRightBand = x >= w - SNAP_CORNER_T;
  const inTopBand = y <= SNAP_CORNER_T;
  const inBottomBand = y >= h - SNAP_CORNER_T;
  if (inTopBand && inLeftBand) return 'tl';
  if (inTopBand && inRightBand) return 'tr';
  if (inBottomBand && inLeftBand) return 'bl';
  if (inBottomBand && inRightBand) return 'br';

  // ── 边缘判定带（底部边缘不触发：Dock 区域） ──
  if (y <= SNAP_EDGE_T) return 'max';
  if (x <= SNAP_EDGE_T) return 'left';
  if (x >= w - SNAP_EDGE_T) return 'right';
  return null;
}

/** 吸附预览框 / 落位目标的几何描述（窗口层坐标系）。 */
export interface SnapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 根据 zone 和窗口层尺寸，计算目标几何（预览框与落位共用，确保像素级一致）。
 * 采用与现有 onTile 一致的计算方式：
 * - 半屏：width/height = round(W/2) 或 round(H/2)；右侧/底部吸收余数，保证不溢出。
 * - 三分之一：left/right 各占 round(W/3)，中列吸收剩余宽度。
 * - max：铺满整层（预览框用；实际落位通过 setBounds maximized 实现）。
 *
 * @param zone 目标区域类型
 * @param w 窗口层宽度（px）
 * @param h 窗口层高度（px）
 * @returns 对应几何，未知 zone 返回 null
 */
export function zoneBounds(zone: string, w: number, h: number): SnapRect | null {
  const half = Math.round(w / 2);
  const halfH = Math.round(h / 2);
  const third = Math.round(w / 3);

  switch (zone) {
    case 'left':
      return { x: 0, y: 0, w: half, h };
    case 'right':
      return { x: w - half, y: 0, w: w - half, h };
    case 'top':
      return { x: 0, y: 0, w, h: halfH };
    case 'bottom':
      return { x: 0, y: halfH, w, h: h - halfH };
    case 'tl':
      return { x: 0, y: 0, w: half, h: halfH };
    case 'tr':
      return { x: w - half, y: 0, w: w - half, h: halfH };
    case 'bl':
      return { x: 0, y: halfH, w: half, h: h - halfH };
    case 'br':
      return { x: w - half, y: halfH, w: w - half, h: h - halfH };
    case 'lthird':
      return { x: 0, y: 0, w: third, h };
    case 'cthird':
      return { x: third, y: 0, w: w - 2 * third, h };
    case 'rthird':
      return { x: w - third, y: 0, w: third, h };
    case 'max':
      return { x: 0, y: 0, w, h };
    default:
      return null;
  }
}
