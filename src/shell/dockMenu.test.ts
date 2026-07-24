// Dock 右键菜单构建（纯函数）测试：checked/disabled 三态 + 分割线位置 + 回调接线。
// 复刻 macOS 心智：边界项保留但禁用灰化（不消失）；开关项用 ✓ 而非文本前缀 hack。
import { describe, it, expect } from 'vitest';
import { buildDockMenu, type DockMenuActions, type DockMenuOptions } from './dockMenu';

function makeOptions(overrides: Partial<Omit<DockMenuOptions, 'actions'>> = {}) {
  const calls: Array<string | [string, string, number]> = [];
  const actions: DockMenuActions = {
    openNew: () => calls.push('openNew'),
    minimizeAll: () => calls.push('minimizeAll'),
    closeAll: () => calls.push('closeAll'),
    move: (ids, id, dir) => calls.push(['move', id, dir]),
    pin: () => calls.push('pin'),
    unpin: () => calls.push('unpin'),
    toggleAutohide: () => calls.push('toggleAutohide'),
    reset: () => calls.push('reset'),
  };
  const opts: DockMenuOptions = {
    appId: 'b',
    ids: ['a', 'b', 'c'],
    running: false,
    pinned: false,
    autohide: false,
    actions,
    ...overrides,
  };
  return { calls, opts };
}

const byLabel = (opts: DockMenuOptions, label: string) =>
  buildDockMenu(opts).find((i) => i.label === label)!;

describe('Dock 菜单 · 左移/右移禁用态', () => {
  it('中间项：左移/右移均可用', () => {
    const { opts } = makeOptions();
    expect(byLabel(opts, '左移').disabled).toBe(false);
    expect(byLabel(opts, '右移').disabled).toBe(false);
  });

  it('最左端：左移保留但禁用（macOS 心智，不消失）', () => {
    const { opts } = makeOptions({ appId: 'a' });
    const items = buildDockMenu(opts);
    expect(items.some((i) => i.label === '左移')).toBe(true);
    expect(byLabel(opts, '左移').disabled).toBe(true);
    expect(byLabel(opts, '右移').disabled).toBe(false);
  });

  it('最右端：右移保留但禁用', () => {
    const { opts } = makeOptions({ appId: 'c' });
    expect(byLabel(opts, '右移').disabled).toBe(true);
    expect(byLabel(opts, '左移').disabled).toBe(false);
  });

  it('左移/右移这一组前只有一条分割线（左移 separator=true，右移无）', () => {
    for (const appId of ['a', 'b', 'c']) {
      const { opts } = makeOptions({ appId });
      expect(byLabel(opts, '左移').separator).toBe(true);
      expect(byLabel(opts, '右移').separator).toBeUndefined();
    }
  });

  it('onClick 接线：左移/右移把 (ids, appId, dir) 传给 move', () => {
    const { calls, opts } = makeOptions();
    byLabel(opts, '左移').onClick();
    byLabel(opts, '右移').onClick();
    expect(calls).toEqual([
      ['move', 'b', -1],
      ['move', 'b', 1],
    ]);
  });
});

describe('Dock 菜单 · 自动隐藏勾选态', () => {
  it('autohide=true → checked，且 label 不含 ✓ 文本 hack', () => {
    const { opts } = makeOptions({ autohide: true });
    const item = byLabel(opts, '自动隐藏 Dock');
    expect(item.checked).toBe(true);
    expect(item.label).toBe('自动隐藏 Dock');
  });

  it('autohide=false → 不勾选', () => {
    const { opts } = makeOptions({ autohide: false });
    expect(byLabel(opts, '自动隐藏 Dock').checked).toBe(false);
  });
});

describe('Dock 菜单 · 运行态与固定态', () => {
  it('无进程：不出现最小化全部/关闭全部', () => {
    const { opts } = makeOptions({ running: false });
    const labels = buildDockMenu(opts).map((i) => i.label);
    expect(labels).not.toContain('最小化全部');
    expect(labels).not.toContain('关闭全部');
  });

  it('有进程：最小化全部 + 关闭全部（danger）', () => {
    const { opts } = makeOptions({ running: true });
    expect(byLabel(opts, '最小化全部').separator).toBe(true);
    expect(byLabel(opts, '关闭全部').danger).toBe(true);
  });

  it('未固定 → 固定到 Dock；已固定 → 从 Dock 移除', () => {
    const unpinned = makeOptions({ pinned: false });
    expect(buildDockMenu(unpinned.opts).some((i) => i.label === '固定到 Dock')).toBe(true);
    const pinned = makeOptions({ pinned: true });
    expect(buildDockMenu(pinned.opts).some((i) => i.label === '从 Dock 移除')).toBe(true);
  });
});
