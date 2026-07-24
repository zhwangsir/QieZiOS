import { describe, it, expect } from 'vitest';
import {
  detectSnapZone,
  zoneBounds,
  SNAP_EDGE_T,
  SNAP_CORNER_T,
  type SnapZone,
} from './snapPreview';

// 参考视口：1000×700（窗口层坐标系，原点左上角）
const W = 1000;
const H = 700;
const CX = W / 2; // 500，水平中轴
const CY = H / 2; // 350，垂直中轴

describe('detectSnapZone 边缘检测', () => {
  it('左边缘命中 → left 半屏', () => {
    expect(detectSnapZone(0, CY, W, H)).toBe('left');
    expect(detectSnapZone(4, CY, W, H)).toBe('left');
  });

  it('右边缘命中 → right 半屏', () => {
    expect(detectSnapZone(W, CY, W, H)).toBe('right');
    expect(detectSnapZone(W - 4, CY, W, H)).toBe('right');
  });

  it('上边缘命中 → max 最大化', () => {
    expect(detectSnapZone(CX, 0, W, H)).toBe('max');
    expect(detectSnapZone(CX, 4, W, H)).toBe('max');
  });

  it('四角命中 → 对应 quarter 区', () => {
    expect(detectSnapZone(10, 10, W, H)).toBe('tl');
    expect(detectSnapZone(W - 10, 10, W, H)).toBe('tr');
    expect(detectSnapZone(10, H - 10, W, H)).toBe('bl');
    expect(detectSnapZone(W - 10, H - 10, W, H)).toBe('br');
  });

  it('屏幕中心不命中 → null', () => {
    expect(detectSnapZone(CX, CY, W, H)).toBeNull();
  });

  it('底部边缘（Dock 区域）不命中 → null', () => {
    expect(detectSnapZone(CX, H - 4, W, H)).toBeNull();
    expect(detectSnapZone(CX, H, W, H)).toBeNull();
  });

  it('阈值边界：边缘带 8px —— 7px 命中 / 9px 不命中', () => {
    expect(SNAP_EDGE_T).toBe(8); // 锁定设计阈值
    // 左边缘
    expect(detectSnapZone(7, CY, W, H)).toBe('left');
    expect(detectSnapZone(9, CY, W, H)).toBeNull();
    // 右边缘
    expect(detectSnapZone(W - 7, CY, W, H)).toBe('right');
    expect(detectSnapZone(W - 9, CY, W, H)).toBeNull();
    // 上边缘
    expect(detectSnapZone(CX, 7, W, H)).toBe('max');
    expect(detectSnapZone(CX, 9, W, H)).toBeNull();
  });

  it('角落与边缘重叠时角落优先（96px 角落带 > 8px 边缘带）', () => {
    expect(SNAP_CORNER_T).toBe(96); // 锁定设计阈值
    // (4,4) 同时在左/上边缘带内：既不是 left 也不是 max，而是 tl
    expect(detectSnapZone(4, 4, W, H)).toBe('tl');
    // 左边缘带 + 上部角落带 → tl 而非 left
    expect(detectSnapZone(4, 50, W, H)).toBe('tl');
    // 右边缘带 + 下部角落带 → br 而非 right
    expect(detectSnapZone(W - 4, H - 50, W, H)).toBe('br');
    // 上边缘带 + 左/右角落带 → tr/tl 而非 max
    expect(detectSnapZone(W - 50, 4, W, H)).toBe('tr');
    expect(detectSnapZone(50, 4, W, H)).toBe('tl');
  });

  it('角落带边界：96px 内算角落，之外回落到普通边缘判定', () => {
    // 角落带内（含边界 96）
    expect(detectSnapZone(5, 96, W, H)).toBe('tl');
    // 超出角落带但仍在左边缘带 → left
    expect(detectSnapZone(5, 97, W, H)).toBe('left');
    // 超出角落带且不在任何边缘带 → null
    expect(detectSnapZone(97, 50, W, H)).toBeNull();
    expect(detectSnapZone(50, 97, W, H)).toBeNull();
  });

  it('指针拖出屏幕外（捕获越界坐标）仍按最近边缘判定', () => {
    expect(detectSnapZone(-20, CY, W, H)).toBe('left');
    expect(detectSnapZone(W + 20, CY, W, H)).toBe('right');
    expect(detectSnapZone(CX, -20, W, H)).toBe('max');
  });
});

describe('zoneBounds 吸附区几何', () => {
  const BW = 1000;
  const BH = 600;

  it('半屏区：left/right/top/bottom', () => {
    expect(zoneBounds('left', BW, BH)).toEqual({ x: 0, y: 0, w: 500, h: 600 });
    expect(zoneBounds('right', BW, BH)).toEqual({ x: 500, y: 0, w: 500, h: 600 });
    expect(zoneBounds('top', BW, BH)).toEqual({ x: 0, y: 0, w: 1000, h: 300 });
    expect(zoneBounds('bottom', BW, BH)).toEqual({ x: 0, y: 300, w: 1000, h: 300 });
  });

  it('四角区：tl/tr/bl/br', () => {
    expect(zoneBounds('tl', BW, BH)).toEqual({ x: 0, y: 0, w: 500, h: 300 });
    expect(zoneBounds('tr', BW, BH)).toEqual({ x: 500, y: 0, w: 500, h: 300 });
    expect(zoneBounds('bl', BW, BH)).toEqual({ x: 0, y: 300, w: 500, h: 300 });
    expect(zoneBounds('br', BW, BH)).toEqual({ x: 500, y: 300, w: 500, h: 300 });
  });

  it('三分之一区：lthird/cthird/rthird（中列吸收余数）', () => {
    expect(zoneBounds('lthird', BW, BH)).toEqual({ x: 0, y: 0, w: 333, h: 600 });
    expect(zoneBounds('cthird', BW, BH)).toEqual({ x: 333, y: 0, w: 334, h: 600 });
    expect(zoneBounds('rthird', BW, BH)).toEqual({ x: 667, y: 0, w: 333, h: 600 });
  });

  it('max → 铺满整层（预览框用；落位仍走 maximized 标志）', () => {
    expect(zoneBounds('max', BW, BH)).toEqual({ x: 0, y: 0, w: 1000, h: 600 });
  });

  it('未知 zone → null', () => {
    expect(zoneBounds('nope', BW, BH)).toBeNull();
    expect(zoneBounds('', BW, BH)).toBeNull();
  });

  it('奇数宽度：半区取整后右侧不溢出（x + w ≤ W）', () => {
    const left = zoneBounds('left', 999, BH)!;
    const right = zoneBounds('right', 999, BH)!;
    expect(left.w).toBe(Math.round(999 / 2)); // 500
    expect(right.x + right.w).toBeLessThanOrEqual(999);
    expect(right.x).toBe(999 - left.w);
  });

  it('detectSnapZone 的所有可能输出都能算出几何（预览与落位像素级一致）', () => {
    const zones: (SnapZone | null)[] = [
      detectSnapZone(4, CY, W, H),       // left
      detectSnapZone(W - 4, CY, W, H),   // right
      detectSnapZone(CX, 4, W, H),       // max
      detectSnapZone(10, 10, W, H),      // tl
      detectSnapZone(W - 10, 10, W, H),  // tr
      detectSnapZone(10, H - 10, W, H),  // bl
      detectSnapZone(W - 10, H - 10, W, H), // br
    ];
    for (const z of zones) {
      expect(z).not.toBeNull();
      const b = zoneBounds(z!, W, H)!;
      expect(b).not.toBeNull();
      // 几何必须落在层内
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(W);
      expect(b.y + b.h).toBeLessThanOrEqual(H);
    }
  });
});
