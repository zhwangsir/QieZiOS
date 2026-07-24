// lineedit 纯函数测试：readline 风格行编辑（Ctrl+U/K/W + 词移动 + kill ring 粘贴）的全分支行为。
// M25 起 kill 类返回带 killed 字段（删下的文本进 kill ring）；toEqual 不忽略已定义属性 → 有删除的断言须带 killed。
import { describe, it, expect } from 'vitest';
import { killToStart, killToEnd, killWordBack, killWordForward, wordBack, wordForward, transposeChars, deleteCharForward, yank, yankPop } from './lineedit';

describe('killToStart（Ctrl+U：删光标→行首）', () => {
  it('光标在词中：保留光标后文本，光标归 0，killed = 删下段', () => {
    expect(killToStart({ text: 'echo hello', pos: 5 })).toEqual({ text: 'hello', pos: 0, killed: 'echo ' });
  });
  it('光标在行尾：清空整行', () => {
    expect(killToStart({ text: 'echo hello', pos: 10 })).toEqual({ text: '', pos: 0, killed: 'echo hello' });
  });
  it('光标在行首：不动（killed 不设）', () => {
    expect(killToStart({ text: 'echo', pos: 0 })).toEqual({ text: 'echo', pos: 0 });
  });
  it('空行：不动', () => {
    expect(killToStart({ text: '', pos: 0 })).toEqual({ text: '', pos: 0 });
  });
});

describe('killToEnd（Ctrl+K：删光标→行尾）', () => {
  it('光标在词中：保留光标前文本，光标不动，killed = 删下段', () => {
    expect(killToEnd({ text: 'echo hello', pos: 5 })).toEqual({ text: 'echo ', pos: 5, killed: 'hello' });
  });
  it('光标在行首：清空整行', () => {
    expect(killToEnd({ text: 'echo hello', pos: 0 })).toEqual({ text: '', pos: 0, killed: 'echo hello' });
  });
  it('光标在行尾：不动（killed 不设）', () => {
    expect(killToEnd({ text: 'echo', pos: 4 })).toEqual({ text: 'echo', pos: 4 });
  });
});

describe('wordBack（Alt+B / Ctrl+←：回退到上一个词头）', () => {
  it('词中 → 本词词头', () => {
    expect(wordBack('echo hello', 8)).toBe(5);
  });
  it('词尾 → 本词词头', () => {
    expect(wordBack('echo hello', 10)).toBe(5);
  });
  it('词头 → 上一词词头', () => {
    expect(wordBack('echo hello', 5)).toBe(0);
  });
  it('光标在空白中：先吞空白再吞词', () => {
    expect(wordBack('echo   hello', 7)).toBe(0); // 词头/空白中 → 上一词词头
  });
  it('尾部空白：回退到最后一词词头', () => {
    expect(wordBack('echo hi  ', 9)).toBe(5);
  });
  it('Tab 也算空白', () => {
    expect(wordBack('echo\thi', 7)).toBe(5);
  });
  it('行首原地不动（幂等）', () => {
    expect(wordBack('echo', 0)).toBe(0);
  });
  it('全空白 → 0', () => {
    expect(wordBack('    ', 4)).toBe(0);
  });
  it('空文本 → 0', () => {
    expect(wordBack('', 0)).toBe(0);
  });
});

describe('wordForward（Alt+F / Ctrl+→：前进到词尾）', () => {
  it('词中 → 本词词尾', () => {
    expect(wordForward('echo hello', 1)).toBe(4);
  });
  it('词头 → 本词词尾', () => {
    expect(wordForward('echo hello', 0)).toBe(4);
  });
  it('词尾空白 → 下一词词尾', () => {
    expect(wordForward('echo hello', 4)).toBe(10);
  });
  it('前导空白：先吞空白', () => {
    expect(wordForward('  hi', 0)).toBe(4);
  });
  it('行尾原地不动（幂等）', () => {
    expect(wordForward('echo', 4)).toBe(4);
    expect(wordForward('echo  ', 6)).toBe(6);
  });
  it('全空白 → 行尾', () => {
    expect(wordForward('   ', 0)).toBe(3);
  });
  it('空文本 → 0', () => {
    expect(wordForward('', 0)).toBe(0);
  });
});

describe('killWordBack（Ctrl+W：删光标前一个词）', () => {
  it('行尾删一词：空白分隔语义，/tmp/foo 整体是一个词，killed = 删下段', () => {
    expect(killWordBack({ text: 'sudo rm -rf /tmp/foo', pos: 20 })).toEqual({
      text: 'sudo rm -rf ',
      pos: 12,
      killed: '/tmp/foo',
    });
  });
  it('连按连删：第二次再删 -rf（含词后空白）', () => {
    const once = killWordBack({ text: 'sudo rm -rf /tmp/foo', pos: 20 });
    expect(killWordBack(once)).toEqual({ text: 'sudo rm ', pos: 8, killed: '-rf ' });
  });
  it('光标在词中：只删光标前那段词，光标后文本保留', () => {
    expect(killWordBack({ text: 'echo hello world', pos: 8 })).toEqual({
      text: 'echo lo world',
      pos: 5,
      killed: 'hel',
    });
  });
  it('光标在词后空白：连空白带词一起删', () => {
    expect(killWordBack({ text: 'echo hello   ', pos: 13 })).toEqual({
      text: 'echo ',
      pos: 5,
      killed: 'hello   ',
    });
  });
  it('行首：无词可删，原样返回（killed 不设）', () => {
    expect(killWordBack({ text: 'echo', pos: 0 })).toEqual({ text: 'echo', pos: 0 });
  });
  it('空行：不动', () => {
    expect(killWordBack({ text: '', pos: 0 })).toEqual({ text: '', pos: 0 });
  });
});

describe('yank（Ctrl+Y：粘贴 kill ring 顶部文本）', () => {
  it('行尾粘贴：追加文本，光标落段尾', () => {
    expect(yank({ text: 'sudo ', pos: 5 }, 'rm -rf')).toEqual({ text: 'sudo rm -rf', pos: 11 });
  });
  it('词中粘贴：插入光标处，后半截保留', () => {
    expect(yank({ text: 'echoworld', pos: 4 }, ' hello ')).toEqual({ text: 'echo hello world', pos: 11 });
  });
  it('行首粘贴：文本插到最前', () => {
    expect(yank({ text: 'bar', pos: 0 }, 'foo ')).toEqual({ text: 'foo bar', pos: 4 });
  });
  it('空文本粘贴：等于输入', () => {
    expect(yank({ text: '', pos: 0 }, 'hello')).toEqual({ text: 'hello', pos: 5 });
  });
});

describe('yankPop（Alt+Y：用 ring 下一项替换上次粘贴段）', () => {
  it('替换上次粘贴段，光标仍落段尾', () => {
    const last = { start: 5, end: 11 }; // 上次 yank 进来的 "rm -rf"
    expect(yankPop({ text: 'sudo rm -rf', pos: 11 }, 'hello', last)).toEqual({ text: 'sudo hello', pos: 10 });
  });
  it('连续 Alt+Y：以本次粘贴段为区间再替换', () => {
    const s1 = yank({ text: '', pos: 0 }, 'aaa'); // { text:'aaa', pos:3 }，区间 [0,3)
    const s2 = yankPop(s1, 'bb', { start: 0, end: 3 }); // → { text:'bb', pos:2 }，区间 [0,2)
    expect(s2).toEqual({ text: 'bb', pos: 2 });
    expect(yankPop(s2, 'cccc', { start: 0, end: 2 })).toEqual({ text: 'cccc', pos: 4 });
  });
  it('lastYank 区间越界时夹到文本长度内（健壮性）', () => {
    expect(yankPop({ text: 'ab', pos: 2 }, 'X', { start: 0, end: 99 })).toEqual({ text: 'X', pos: 1 });
  });
  it('替换段在中间：前后文本保留', () => {
    const last = { start: 3, end: 6 }; // 'AAA' 段
    expect(yankPop({ text: 'fooAAAbar', pos: 6 }, 'BB', last)).toEqual({ text: 'fooBBbar', pos: 5 });
  });
});

describe('transposeChars（Ctrl+T：交换光标前/处两字符）', () => {
  it('光标在词中：交换前字符与处字符，光标前进一位', () => {
    // "abcd" pos=2（c 处）→ 交换 b(1) 与 c(2) → "acbd"，光标 3
    expect(transposeChars({ text: 'abcd', pos: 2 })).toEqual({ text: 'acbd', pos: 3 });
  });
  it('光标在行尾：交换最后两字符，光标不动', () => {
    // "abcd" pos=4（行尾）→ 交换 c(2) 与 d(3) → "abdc"，光标 4
    expect(transposeChars({ text: 'abcd', pos: 4 })).toEqual({ text: 'abdc', pos: 4 });
  });
  it('光标在词头（pos=1）：交换首字符与第二字符', () => {
    // "abcd" pos=1 → 交换 a(0) 与 b(1) → "bacd"，光标 2
    expect(transposeChars({ text: 'abcd', pos: 1 })).toEqual({ text: 'bacd', pos: 2 });
  });
  it('光标在行首（pos=0）：不足两字符，不动', () => {
    expect(transposeChars({ text: 'abc', pos: 0 })).toEqual({ text: 'abc', pos: 0 });
  });
  it('单字符：不动', () => {
    expect(transposeChars({ text: 'a', pos: 1 })).toEqual({ text: 'a', pos: 1 });
  });
  it('空文本：不动', () => {
    expect(transposeChars({ text: '', pos: 0 })).toEqual({ text: '', pos: 0 });
  });
  it('两字符行尾：交换两字符', () => {
    expect(transposeChars({ text: 'ab', pos: 2 })).toEqual({ text: 'ba', pos: 2 });
  });
});

describe('killWordForward（Alt+D：删光标→词尾）', () => {
  it('光标在词头：删整词，光标不动', () => {
    // "echo hello" pos=0 → wordForward=4 → 删 [0,4)="echo" → " hello"，光标 0
    expect(killWordForward({ text: 'echo hello', pos: 0 })).toEqual({ text: ' hello', pos: 0, killed: 'echo' });
  });
  it('光标在词中：删光标到词尾，保留前段', () => {
    // "echo hello" pos=1 → wordForward=4 → 删 [1,4)="cho" → "e hello"，光标 1
    expect(killWordForward({ text: 'echo hello', pos: 1 })).toEqual({ text: 'e hello', pos: 1, killed: 'cho' });
  });
  it('光标在词后空白：连空白带下一词一起删', () => {
    // "echo   hello" pos=4 → wordForward=9（吞空白到hello词尾）→ 删 [4,9)="   hel"？
    // wordForward(4): i=4 空白 → i=7, 词体 hello → i=12。删 [4,12)="   hello"
    expect(killWordForward({ text: 'echo   hello', pos: 4 })).toEqual({ text: 'echo', pos: 4, killed: '   hello' });
  });
  it('光标在行尾：无词可删，原样返回（killed 不设）', () => {
    expect(killWordForward({ text: 'echo', pos: 4 })).toEqual({ text: 'echo', pos: 4 });
  });
  it('连按连删：第二次删下一词（含前导空白）', () => {
    const once = killWordForward({ text: 'echo hello world', pos: 0 });
    // once = { text: ' hello world', pos: 0 }（删了 echo，前留一个空格）
    // 第二次：wordForward(' hello world',0) 先吞空白再吞 hello → 删 [0,6)=" hello"
    expect(killWordForward(once)).toEqual({ text: ' world', pos: 0, killed: ' hello' });
  });
  it('空行：不动', () => {
    expect(killWordForward({ text: '', pos: 0 })).toEqual({ text: '', pos: 0 });
  });
});

describe('deleteCharForward（Ctrl+D：删光标处一字符）', () => {
  it('光标在词中：删光标处字符，光标不动', () => {
    // "abcd" pos=1 → 删 'b' → "acd"，pos=1
    expect(deleteCharForward({ text: 'abcd', pos: 1 })).toEqual({ text: 'acd', pos: 1 });
  });
  it('光标在词头：删首字符', () => {
    expect(deleteCharForward({ text: 'abcd', pos: 0 })).toEqual({ text: 'bcd', pos: 0 });
  });
  it('光标在行尾：不动（EOF 由调用方处理）', () => {
    expect(deleteCharForward({ text: 'abc', pos: 3 })).toEqual({ text: 'abc', pos: 3 });
  });
  it('空行：不动', () => {
    expect(deleteCharForward({ text: '', pos: 0 })).toEqual({ text: '', pos: 0 });
  });
  it('不进 kill ring（无 killed 字段）', () => {
    const r = deleteCharForward({ text: 'ab', pos: 0 });
    expect(r).toEqual({ text: 'b', pos: 0 });
    expect('killed' in r).toBe(false);
  });
});
