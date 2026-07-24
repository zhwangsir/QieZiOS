import { describe, it, expect } from 'vitest';
import { rsUpdate, rsOlder, rsMatch } from './histsearch';

const HIST = ['ls', 'cd /tmp', 'sudo rm -rf /tmp/foo', 'ls -la', 'echo hello', 'rm a.txt'];

describe('rsUpdate · 查询词变化重新搜', () => {
  it('空查询 → 未命中', () => {
    expect(rsUpdate(HIST, '')).toEqual({ query: '', idx: -1 });
  });
  it('多个匹配 → 取最新（下标最大）', () => {
    expect(rsUpdate(HIST, 'ls').idx).toBe(3); // 'ls' 与 'ls -la' 都含 ls，取 ls -la
  });
  it('子串匹配（非前缀）：rm 命中 sudo rm 与 rm，取最新 rm a.txt', () => {
    expect(rsUpdate(HIST, 'rm').idx).toBe(5);
  });
  it('无匹配 → idx -1', () => {
    expect(rsUpdate(HIST, 'zzz').idx).toBe(-1);
  });
  it('空历史 → idx -1', () => {
    expect(rsUpdate([], 'ls').idx).toBe(-1);
  });
});

describe('rsOlder · 再按 Ctrl+R 找更老匹配', () => {
  it('已命中 → 下一个更老匹配', () => {
    expect(rsOlder(HIST, { query: 'rm', idx: 5 })).toEqual({ query: 'rm', idx: 2 });
  });
  it('连续按：一路向更老走', () => {
    const once = rsOlder(HIST, { query: 'ls', idx: 3 });
    expect(once.idx).toBe(0);
  });
  it('已是最老匹配 → 停原地（bash failed 从简）', () => {
    const s = { query: 'rm', idx: 2 };
    expect(rsOlder(HIST, s)).toEqual(s);
  });
  it('当前未命中（-1）→ 从尾部重新搜', () => {
    expect(rsOlder(HIST, { query: 'rm', idx: -1 }).idx).toBe(5);
  });
  it('空查询 → 原样返回', () => {
    const s = { query: '', idx: -1 };
    expect(rsOlder(HIST, s)).toBe(s);
  });
  it('idx 越界（历史被截短过）→ 夹到合法范围仍能搜', () => {
    expect(rsOlder(HIST, { query: 'rm', idx: 99 }).idx).toBe(5);
  });
});

describe('rsMatch · 命中文本', () => {
  it('命中 → 命令文本', () => {
    expect(rsMatch(HIST, { query: 'ls', idx: 3 })).toBe('ls -la');
  });
  it('未命中 → null', () => {
    expect(rsMatch(HIST, { query: 'zzz', idx: -1 })).toBeNull();
  });
  it('idx 越界 → null（防御）', () => {
    expect(rsMatch(HIST, { query: 'x', idx: 99 })).toBeNull();
  });
  it('空历史 → null', () => {
    expect(rsMatch([], { query: 'ls', idx: 0 })).toBeNull();
  });
});
