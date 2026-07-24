// M12.1「键盘完备性」· keymap 纯函数测试
// 目标：matchShortcut 统一判定「Ctrl 或 Cmd + 字母」组合（macOS/Win 双平台等价、大小写不敏感），
//       Desktop.onKey 里散落的组合键判定全部收口到这里，可裸测不碰 DOM。
import { describe, it, expect } from 'vitest';
import { matchShortcut } from './keymap';

// 造一个最小键盘事件（结构化兼容 KeyboardEvent 的子集，免 new KeyboardEvent 的 DOM 依赖）
function ev(key: string, mods: { ctrl?: boolean; meta?: boolean } = {}) {
  return { key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta };
}

describe('M12.1 matchShortcut（Cmd/Ctrl+字母 组合键判定）', () => {
  it('w/h/q/m/k 五键各自命中（Ctrl）', () => {
    for (const k of ['w', 'h', 'q', 'm', 'k'] as const) {
      expect(matchShortcut(ev(k, { ctrl: true }), k)).toBe(true);
    }
  });

  it('Cmd(meta) 与 Ctrl 等价（macOS/Win 双平台）', () => {
    expect(matchShortcut(ev('w', { meta: true }), 'w')).toBe(true);
    expect(matchShortcut(ev('h', { meta: true }), 'h')).toBe(true);
    expect(matchShortcut(ev('q', { meta: true }), 'q')).toBe(true);
    expect(matchShortcut(ev('m', { meta: true }), 'm')).toBe(true);
    expect(matchShortcut(ev('k', { meta: true }), 'k')).toBe(true);
  });

  it('大小写不敏感（Shift 按下时 e.key 是大写）', () => {
    expect(matchShortcut(ev('W', { ctrl: true }), 'w')).toBe(true);
    expect(matchShortcut(ev('H', { meta: true }), 'h')).toBe(true);
    expect(matchShortcut(ev('Q', { meta: true }), 'q')).toBe(true);
    expect(matchShortcut(ev('M', { ctrl: true }), 'm')).toBe(true);
    expect(matchShortcut(ev('K', { meta: true }), 'k')).toBe(true);
  });

  it('无修饰键不命中（裸字母是打字，不是快捷键）', () => {
    for (const k of ['w', 'h', 'q', 'm', 'k'] as const) {
      expect(matchShortcut(ev(k), k)).toBe(false);
      expect(matchShortcut(ev(k.toUpperCase()), k)).toBe(false);
    }
  });

  it('键位不匹配不命中（修饰键按对了也没用）', () => {
    expect(matchShortcut(ev('x', { ctrl: true }), 'w')).toBe(false);
    expect(matchShortcut(ev('w', { ctrl: true }), 'h')).toBe(false);
    expect(matchShortcut(ev('q', { meta: true }), 'k')).toBe(false);
  });

  it('Ctrl+Cmd 同时按也命中（宽松接受，不互斥）', () => {
    expect(matchShortcut(ev('w', { ctrl: true, meta: true }), 'w')).toBe(true);
  });
});
