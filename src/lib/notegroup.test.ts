// M19 通知中心分组 · notegroup.ts 纯函数测试
// 语义对齐 macOS 通知中心：按来源分组；无 source 归 '系统'；组内新→旧；组间按组内最新 ts 新→旧。
import { describe, it, expect } from 'vitest';
import { groupBySource } from './notegroup';

// 测试夹具：只保留分组在意的字段（id 用于核对顺序身份）
function n(id: number, ts: number, source?: string) {
  return { id, ts, source };
}

describe('groupBySource（按来源分组）', () => {
  it('多来源各自成组', () => {
    const groups = groupBySource([n(1, 100, '文件'), n(2, 200, '截图'), n(3, 300, '文件')]);
    expect([...groups.map((g) => g.source)].sort()).toEqual(['截图', '文件']); // sort 按 UTF-16 码位：截 < 文
    expect(groups.find((g) => g.source === '文件')!.items.map((x) => x.id)).toEqual([3, 1]);
    expect(groups.find((g) => g.source === '截图')!.items.map((x) => x.id)).toEqual([2]);
  });

  it("无 source 的历史旧数据归 '系统'", () => {
    const groups = groupBySource([n(1, 100), n(2, 200, '文件')]);
    const sysGroup = groups.find((g) => g.source === '系统');
    expect(sysGroup).toBeDefined();
    expect(sysGroup!.items.map((x) => x.id)).toEqual([1]);
  });

  it('组内按 ts 新 → 旧', () => {
    const groups = groupBySource([n(1, 100, '文件'), n(2, 300, '文件'), n(3, 200, '文件')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it('组之间按「组内最新 ts」新 → 旧排序', () => {
    const groups = groupBySource([
      n(1, 100, '文件'), // 文件组最新 = 300
      n(2, 300, '文件'),
      n(3, 200, '截图'), // 截图组最新 = 200
      n(4, 50, '截图'),
    ]);
    expect(groups.map((g) => g.source)).toEqual(['文件', '截图']);
  });

  it('单条通知也自成一组', () => {
    const groups = groupBySource([n(1, 100, '时钟')]);
    expect(groups).toEqual([{ source: '时钟', items: [n(1, 100, '时钟')] }]);
  });

  it('空数组 → 空结果', () => {
    expect(groupBySource([])).toEqual([]);
  });

  it('组顺序不受输入顺序影响：旧组里有新项则整组排前', () => {
    // '截图' 组整体更旧，但其中一条比 '文件' 组所有项都新 → 截图组排前
    const input = [n(1, 300, '文件'), n(2, 100, '截图'), n(3, 400, '截图'), n(4, 200, '文件')];
    const groups = groupBySource(input);
    expect(groups.map((g) => g.source)).toEqual(['截图', '文件']);
    expect(groups[0].items.map((x) => x.id)).toEqual([3, 2]);
    expect(groups[1].items.map((x) => x.id)).toEqual([1, 4]);
  });
});
