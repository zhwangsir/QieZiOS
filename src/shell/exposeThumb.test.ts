// Exposé 缩略图比例计算 · exposeThumb.ts 纯函数测试（F4）
// 目标：迷你窗口永远等比缩进预览框、保持真实窗口宽高比、只缩不放、非法尺寸安全兜底。
import { describe, it, expect } from 'vitest';
import { fitThumb, THUMB_MAX_W, THUMB_MAX_H } from './exposeThumb';

describe('fitThumb（窗口尺寸 → 缩略尺寸）', () => {
  it('宽窗按宽度顶满，宽高比不变', () => {
    const t = fitThumb(1600, 900, 150, 86);
    expect(t.w).toBe(150);
    // 900 × (150/1600) ≈ 84.4 → 84
    expect(t.h).toBe(84);
    expect(t.w / t.h).toBeCloseTo(1600 / 900, 1);
  });

  it('高窗按高度顶满，宽高比不变', () => {
    const t = fitThumb(600, 1200, 150, 86);
    expect(t.h).toBe(86);
    // 600 × (86/1200) = 43
    expect(t.w).toBe(43);
    expect(t.w / t.h).toBeCloseTo(600 / 1200, 1);
  });

  it('小窗不放大（scale=1，原尺寸显示）', () => {
    const t = fitThumb(100, 60, 150, 86);
    expect(t).toEqual({ w: 100, h: 60, scale: 1 });
  });

  it('默认上限用 THUMB_MAX_W × THUMB_MAX_H', () => {
    // 宽受限：3000×1000 → 宽顶满 150
    expect(fitThumb(3000, 1000).w).toBe(THUMB_MAX_W);
    // 高受限：1000×3000 → 高顶满 86
    expect(fitThumb(1000, 3000).h).toBe(THUMB_MAX_H);
  });

  it('非法尺寸（0 / 负数 / NaN）兜底为正整数像素', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-50, -50], [NaN, NaN]] as const) {
      const t = fitThumb(w, h, 150, 86);
      expect(t.w).toBeGreaterThanOrEqual(1);
      expect(t.h).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(t.w)).toBe(true);
      expect(Number.isInteger(t.h)).toBe(true);
    }
  });

  it('超大窗口也不会缩出 0 像素', () => {
    const t = fitThumb(1e9, 1e9, 150, 86);
    expect(t.w).toBeGreaterThanOrEqual(1);
    expect(t.h).toBeGreaterThanOrEqual(1);
  });
});
