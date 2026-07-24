// arith.ts 纯函数测试：$((expr)) 递归下降求值器（无 eval）。
// 覆盖：四则/整除/取模、优先级与结合性、一元与 **、比较/位/逻辑/三元、
// 变量解析（裸名/$ 前缀/未定义/非数值）、短路不求值、错误路径。
import { describe, it, expect } from 'vitest';
import { evalArith } from './arith';

const ENV = { N: '5', S: '3abc', Z: '0' };

describe('evalArith · 四则与整数语义', () => {
  it('加减乘与优先级：1+2*3 → 7', () => {
    expect(evalArith('1+2*3', {})).toBe(7);
  });
  it('括号改变优先级：(1+2)*3 → 9', () => {
    expect(evalArith('(1+2)*3', {})).toBe(9);
  });
  it('整除向零取整：7/2 → 3、-7/2 → -3', () => {
    expect(evalArith('7/2', {})).toBe(3);
    expect(evalArith('-7/2', {})).toBe(-3);
  });
  it('取模取被除数符号：-7%3 → -1、7%-3 → 1', () => {
    expect(evalArith('-7%3', {})).toBe(-1);
    expect(evalArith('7%-3', {})).toBe(1);
  });
  it('空白任意：  2 * ( 3 + 4 )  → 14', () => {
    expect(evalArith('  2 * ( 3 + 4 ) ', {})).toBe(14);
  });
  it('十六进制 0x10 → 16', () => {
    expect(evalArith('0x10+0', {})).toBe(16);
  });
});

describe('evalArith · 一元与幂', () => {
  it('一元负号与连续一元：--5 → 5、- -5 → 5', () => {
    expect(evalArith('--5', {})).toBe(5);
  });
  it('** 右结合：2**3**2 → 512', () => {
    expect(evalArith('2**3**2', {})).toBe(512);
  });
  it('一元负号优先级高于 **（bash）：-2**2 → 4', () => {
    expect(evalArith('-2**2', {})).toBe(4);
  });
  it('逻辑非与位取反：!0 → 1、!9 → 0、~0 → -1', () => {
    expect(evalArith('!0', {})).toBe(1);
    expect(evalArith('!9', {})).toBe(0);
    expect(evalArith('~0', {})).toBe(-1);
  });
  it('负指数截断为 0：2**-1 → 0', () => {
    expect(evalArith('2**-1', {})).toBe(0);
  });
});

describe('evalArith · 比较 / 位 / 逻辑 / 三元', () => {
  it('比较：3>2 → 1、2>=3 → 0、1<2 → 1', () => {
    expect(evalArith('3>2', {})).toBe(1);
    expect(evalArith('2>=3', {})).toBe(0);
    expect(evalArith('1<2', {})).toBe(1);
  });
  it('相等：5==5 → 1、5!=5 → 0', () => {
    expect(evalArith('5==5', {})).toBe(1);
    expect(evalArith('5!=5', {})).toBe(0);
  });
  it('位运算：5&3 → 1、5|3 → 7、5^3 → 6、1<<4 → 16、32>>3 → 4', () => {
    expect(evalArith('5&3', {})).toBe(1);
    expect(evalArith('5|3', {})).toBe(7);
    expect(evalArith('5^3', {})).toBe(6);
    expect(evalArith('1<<4', {})).toBe(16);
    expect(evalArith('32>>3', {})).toBe(4);
  });
  it('逻辑：1&&0 → 0、1&&2 → 1、0||5 → 1、0||0 → 0', () => {
    expect(evalArith('1&&0', {})).toBe(0);
    expect(evalArith('1&&2', {})).toBe(1);
    expect(evalArith('0||5', {})).toBe(1);
    expect(evalArith('0||0', {})).toBe(0);
  });
  it('三元：1?10:20 → 10、0?10:20 → 20', () => {
    expect(evalArith('1?10:20', {})).toBe(10);
    expect(evalArith('0?10:20', {})).toBe(20);
  });
  it('优先级混合：1+2>2&&4|3 → ((3>2)&&7)=1', () => {
    expect(evalArith('1+2>2&&4|3', {})).toBe(1);
  });
});

describe('evalArith · 变量解析', () => {
  it('裸标识符：N+1 → 6、N*N → 25', () => {
    expect(evalArith('N+1', ENV)).toBe(6);
    expect(evalArith('N*N', ENV)).toBe(25);
  });
  it('$ 前缀等价：$N+1 → 6', () => {
    expect(evalArith('$N+1', ENV)).toBe(6);
  });
  it('未定义变量按 0：UNDEF+1 → 1', () => {
    expect(evalArith('UNDEF+1', ENV)).toBe(1);
  });
  it('非数值变量按 0（bash）：S+1 → 1', () => {
    expect(evalArith('S+1', ENV)).toBe(1);
  });
});

describe('evalArith · 短路与错误路径', () => {
  it('&& 短路：0 && 1/0 → 0 不报错', () => {
    expect(evalArith('0 && 1/0', {})).toBe(0);
  });
  it('|| 短路：1 || 1/0 → 1 不报错', () => {
    expect(evalArith('1 || 1/0', {})).toBe(1);
  });
  it('三元未选分支不求值：1 ? 7 : 1/0 → 7', () => {
    expect(evalArith('1 ? 7 : 1/0', {})).toBe(7);
  });
  it('短路分支内语法错误仍报：0 && (1+) → 抛错', () => {
    expect(() => evalArith('0 && (1+)', {})).toThrow('算术语法错误');
  });
  it('除零抛错：1/0', () => {
    expect(() => evalArith('1/0', {})).toThrow('除数为 0');
  });
  it('取模零抛错：1%0', () => {
    expect(() => evalArith('1%0', {})).toThrow('除数为 0');
  });
  it('语法错误：1+ → 表达式不完整；多余尾随 → 意外字符；(1 → 缺少 )', () => {
    expect(() => evalArith('1+', {})).toThrow('算术语法错误');
    expect(() => evalArith('1 2', {})).toThrow('意外的字符');
    expect(() => evalArith('(1', {})).toThrow('缺少 )');
  });
});
