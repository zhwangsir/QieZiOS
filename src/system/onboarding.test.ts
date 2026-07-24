// U10 首秀引导 · 持久化标记门控测试（M4）
// 目标：shouldShowOnboard 对任意存储形态都给出确定判定——无标记/未完成 → 展示，已完成 → 不展示。
import { describe, it, expect } from 'vitest';
import { shouldShowOnboard } from './onboarding.svelte';

describe('shouldShowOnboard（首秀引导门控）', () => {
  it('无持久化标记（首启/老版本升级）→ 展示引导', () => {
    expect(shouldShowOnboard(undefined)).toBe(true);
    expect(shouldShowOnboard(null)).toBe(true);
  });

  it('标记未完成 → 展示；已完成 → 不再展示', () => {
    expect(shouldShowOnboard({ done: false })).toBe(true);
    expect(shouldShowOnboard({ done: true })).toBe(false);
  });
});
