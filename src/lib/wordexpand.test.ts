// M29 词展开纯函数测试：花括号 {a,b}/{1..5}/{a..z} 展开 + 波浪号 ~/~user 展开。
// bash 语义：仅无引号词展开（引号判定在 token 层，本文件只测纯函数本身）。
import { describe, it, expect } from 'vitest';
import { braceExpand, tildeExpand } from './wordexpand';

// 模拟用户表：root→/root，qiezi→/，其余不存在→undefined（与 users.svelte userHome 同语义）
const homeOf = (name: string) => (name === 'root' ? '/root' : name === 'qiezi' ? '/' : undefined);

describe('braceExpand · 逗号列表', () => {
  it('a{b,c}d → abd acd', () => {
    expect(braceExpand('a{b,c}d')).toEqual(['abd', 'acd']);
  });
  it('{a,b}{1,2} → a1 a2 b1 b2', () => {
    expect(braceExpand('{a,b}{1,2}')).toEqual(['a1', 'a2', 'b1', 'b2']);
  });
  it('嵌套 {a,{b,c}} → a b c', () => {
    expect(braceExpand('{a,{b,c}}')).toEqual(['a', 'b', 'c']);
  });
  it('嵌套在后缀 x{a,{b,c}d}e → xae xbde xcde', () => {
    expect(braceExpand('x{a,{b,c}d}e')).toEqual(['xae', 'xbde', 'xcde']);
  });
  it('无逗号 {a} 不展开', () => {
    expect(braceExpand('{a}')).toEqual(['{a}']);
  });
  it('无花括号原样返回', () => {
    expect(braceExpand('abc')).toEqual(['abc']);
  });
  it('{,} → 两个空串', () => {
    expect(braceExpand('{,}')).toEqual(['', '']);
  });
  it('未闭合 {a,b 原样保留', () => {
    expect(braceExpand('{a,b')).toEqual(['{a,b']);
  });
  it('首个无效组跳过、展开后续有效组：x{a}y{b,c}z', () => {
    expect(braceExpand('x{a}y{b,c}z')).toEqual(['x{a}ybz', 'x{a}ycz']);
  });
  it('外层无效内层有效：{{a,b}} → {a} {b}（bash 递归语义）', () => {
    expect(braceExpand('{{a,b}}')).toEqual(['{a}', '{b}']);
  });
});

describe('braceExpand · 区间 {x..y[..step]}', () => {
  it('{1..5} → 1 2 3 4 5', () => {
    expect(braceExpand('{1..5}')).toEqual(['1', '2', '3', '4', '5']);
  });
  it('{3..1} 降序 → 3 2 1', () => {
    expect(braceExpand('{3..1}')).toEqual(['3', '2', '1']);
  });
  it('{1..10..3} 步进 → 1 4 7 10', () => {
    expect(braceExpand('{1..10..3}')).toEqual(['1', '4', '7', '10']);
  });
  it('{5..1..2} 降序步进 → 5 3 1', () => {
    expect(braceExpand('{5..1..2}')).toEqual(['5', '3', '1']);
  });
  it('{a..e} → a b c d e', () => {
    expect(braceExpand('{a..e}')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('{c..a} 降序 → c b a', () => {
    expect(braceExpand('{c..a}')).toEqual(['c', 'b', 'a']);
  });
  it('{01..05} 前导零补宽 → 01 02 03 04 05', () => {
    expect(braceExpand('{01..05}')).toEqual(['01', '02', '03', '04', '05']);
  });
  it('混合类型 {1..z} 不展开', () => {
    expect(braceExpand('{1..z}')).toEqual(['{1..z}']);
  });
  it('步进 0 不展开 {1..5..0}', () => {
    expect(braceExpand('{1..5..0}')).toEqual(['{1..5..0}']);
  });
  it('前后拼接 p{1..3}s → p1s p2s p3s', () => {
    expect(braceExpand('p{1..3}s')).toEqual(['p1s', 'p2s', 'p3s']);
  });
});

describe('tildeExpand · 波浪号展开', () => {
  it('单独 ~ → HOME', () => {
    expect(tildeExpand('~', '/', homeOf)).toBe('/');
  });
  it('~/path 拼接 HOME（HOME=/ 不产生双斜杠）', () => {
    expect(tildeExpand('~/pics', '/', homeOf)).toBe('/pics');
  });
  it('HOME=/root 时 ~/x → /root/x', () => {
    expect(tildeExpand('~/x', '/root', homeOf)).toBe('/root/x');
  });
  it('~root → /root', () => {
    expect(tildeExpand('~root', '/', homeOf)).toBe('/root');
  });
  it('~qiezi → /（不看调用方 HOME）', () => {
    expect(tildeExpand('~qiezi', '/whatever', homeOf)).toBe('/');
  });
  it('~root/docs → /root/docs', () => {
    expect(tildeExpand('~root/docs', '/', homeOf)).toBe('/root/docs');
  });
  it('不存在的用户原样保留', () => {
    expect(tildeExpand('~nosuch', '/', homeOf)).toBe('~nosuch');
  });
  it('~nosuch/x 同样原样保留', () => {
    expect(tildeExpand('~nosuch/x', '/', homeOf)).toBe('~nosuch/x');
  });
  it('词中 ~ 不展开', () => {
    expect(tildeExpand('a~b', '/', homeOf)).toBe('a~b');
  });
  it('非 ~ 开头原样返回', () => {
    expect(tildeExpand('/etc', '/', homeOf)).toBe('/etc');
  });
});
