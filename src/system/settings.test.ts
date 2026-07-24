// U3 字体体系 · FONT_FAMILIES / fontStack 纯函数测试（M1）
// 目标：字体预设结构完整（栈锚定通用族），fontStack 查找/回退行为稳定。
import { describe, it, expect } from 'vitest';
import { FONT_FAMILIES, fontStack, SETTINGS_KEYS } from './settings.svelte';

describe('FONT_FAMILIES', () => {
  it('含 Inter 预设（U3），栈以 Inter 开头、锚定 sans-serif 回退', () => {
    const inter = FONT_FAMILIES.find((f) => f.id === 'inter');
    expect(inter).toBeDefined();
    expect(inter!.stack).toMatch(/^"Inter",/);
    expect(inter!.stack).toMatch(/sans-serif$/);
  });

  it('每个预设的栈都锚定到通用族（sans/serif/monospace）', () => {
    for (const f of FONT_FAMILIES) {
      expect(f.stack, `${f.id} 栈未锚定通用族`).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });

  it('id 唯一', () => {
    const ids = FONT_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('fontStack', () => {
  it('已知 id 返回对应栈', () => {
    expect(fontStack('inter')).toContain('"Inter"');
    expect(fontStack('mono')).toContain('monospace');
  });

  it('未知 id 回退第一项（系统默认）', () => {
    expect(fontStack('no-such-font')).toBe(FONT_FAMILIES[0].stack);
    expect(fontStack('')).toBe(FONT_FAMILIES[0].stack);
  });
});

describe('Settings schema（U2）', () => {
  it('glassRefraction 纳入可持久化/预设白名单', () => {
    expect(SETTINGS_KEYS).toContain('glassRefraction');
  });
});
