import { describe, it, expect } from 'vitest';
import {
  shouldUnlock,
  rubberBand,
  isDoubleTap,
  DOUBLE_TAP_MS,
  isLongPress,
  longPressCancelled,
  LONG_PRESS_MS,
  LONG_PRESS_TOLERANCE,
} from './gesture';

describe('锁屏手势判定', () => {
  it('上滑超过 1/3 屏 → 解锁', () => {
    expect(shouldUnlock(-400, 800)).toBe(true); // 正好一半
    expect(shouldUnlock(-Math.ceil(800 / 3), 800)).toBe(true); // 恰好阈值
  });
  it('不足 1/3 屏 → 回弹', () => {
    expect(shouldUnlock(-100, 800)).toBe(false);
    expect(shouldUnlock(-266, 800)).toBe(false); // 差 1px
  });
  it('下滑 / 零高度 永不解锁', () => {
    expect(shouldUnlock(50, 800)).toBe(false);
    expect(shouldUnlock(0, 800)).toBe(false);
    expect(shouldUnlock(-500, 0)).toBe(false);
  });
  it('橡皮筋阻尼：下滑归零，上滑带 0.85 阻尼', () => {
    expect(rubberBand(30)).toBe(0);
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-100)).toBeCloseTo(-85);
  });
  it('双击判定窗口', () => {
    expect(isDoubleTap(1000, 1000 - DOUBLE_TAP_MS + 1)).toBe(true);
    expect(isDoubleTap(1000, 1000 - DOUBLE_TAP_MS)).toBe(false);
    expect(isDoubleTap(1000, 0)).toBe(false);
  });
});

// M5.8：图标长按 → 上下文菜单的判定（时长阈值 + 位移容差）
describe('长按判定（M5.8）', () => {
  it('按住 ≥500ms 才算长按', () => {
    expect(isLongPress(LONG_PRESS_MS - 1)).toBe(false);
    expect(isLongPress(LONG_PRESS_MS)).toBe(true);
    expect(isLongPress(LONG_PRESS_MS + 500)).toBe(true);
  });

  it('位移超容差取消长按（取 x/y 较大者）；容差内微抖不取消', () => {
    expect(longPressCancelled(0, 0)).toBe(false);
    expect(longPressCancelled(LONG_PRESS_TOLERANCE, -LONG_PRESS_TOLERANCE)).toBe(false); // 恰在容差边界
    expect(longPressCancelled(LONG_PRESS_TOLERANCE + 1, 0)).toBe(true);
    expect(longPressCancelled(0, -(LONG_PRESS_TOLERANCE + 1))).toBe(true);
  });
});
