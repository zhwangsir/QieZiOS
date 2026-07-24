import { describe, it, expect } from 'vitest';
import { groupResults } from './spotlightGroups';

// 测试桩：只带 kind（groupResults 只消费 kind + 下标）
const r = (kind: string) => ({ kind });

describe('groupResults', () => {
  it('按 kind 首见顺序分组，组内保持原顺序', () => {
    const rs = [r('calc'), r('app'), r('app'), r('action'), r('file'), r('ai')];
    const gs = groupResults(rs);
    expect(gs.map((g) => g.title)).toEqual(['计算', '应用程序', '动作', '文件', '问 AI']);
    expect(gs[1].items.map((x) => x.i)).toEqual([1, 2]); // 两个 App 的扁平索引
  });

  it('同类不相邻也聚合为一组', () => {
    const rs = [r('app'), r('file'), r('app')];
    const gs = groupResults(rs);
    expect(gs).toHaveLength(2);
    expect(gs[0].items.map((x) => x.i)).toEqual([0, 2]); // App 组收 0 和 2
  });

  it('扁平索引恒等于原数组下标（selected 高亮不受影响）', () => {
    const rs = [r('calc'), r('userapp'), r('file'), r('file'), r('ai')];
    const gs = groupResults(rs);
    const flat = gs.flatMap((g) => g.items.map((x) => x.i));
    expect(flat).toEqual([0, 1, 2, 3, 4]);
  });

  it('fileTitle 参数注入：空查询场景叫「最近打开」', () => {
    const gs = groupResults([r('file')], '最近打开');
    expect(gs[0].title).toBe('最近打开');
  });

  it('file 组默认标题「文件」', () => {
    expect(groupResults([r('file')])[0].title).toBe('文件');
  });

  it('userapp 标题「我的 App」、ai 标题「问 AI」', () => {
    const gs = groupResults([r('userapp'), r('ai')]);
    expect(gs.map((g) => g.title)).toEqual(['我的 App', '问 AI']);
  });

  it('未知 kind 兜底用 kind 原文', () => {
    expect(groupResults([r('plugin')])[0].title).toBe('plugin');
  });

  it('空数组 → 空分组', () => {
    expect(groupResults([])).toEqual([]);
  });
});
