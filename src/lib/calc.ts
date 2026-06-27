// 安全的算术表达式求值 —— 递归下降解析，**不用 eval**（避免任意代码执行）。
// 支持：+ - * / ^（幂，右结合）、一元正负、括号、阶乘 !、
//       函数 sin/cos/tan/asin/acos/atan/ln/log/sqrt/exp/abs（角度按弧度）、常量 pi/e。
// 显示符号 ×÷−π√ 会先归一化成 * / - pi sqrt。
//
// 优先级（低→高）：加减 → 乘除 → 一元正负 → 幂 → 阶乘 → 基元（数/括号/函数/常量）。
// 把一元正负放在幂「之上」，使 -2^2 = -(2^2) = -4（与常规约定一致），而 2^-3 仍合法。

type Tok =
  | { t: 'num'; v: number }
  | { t: 'op'; v: string }
  | { t: 'name'; v: string }
  | { t: 'lp' }
  | { t: 'rp' };

const FUNCS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  sqrt: Math.sqrt,
  exp: Math.exp,
  abs: Math.abs,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n > 170) return Infinity; // 171! 已溢出 double
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function tokenize(src: string): Tok[] {
  const s = src
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt');
  const toks: Tok[] = [];
  const isDigit = (c: string) => c >= '0' && c <= '9';
  const isAlpha = (c: string) => /[a-z]/i.test(c);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') {
      i++;
      continue;
    }
    if (isDigit(c) || c === '.') {
      let j = i;
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++;
      const num = parseFloat(s.slice(i, j));
      if (!Number.isFinite(num)) throw new Error('数字格式错误');
      toks.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < s.length && isAlpha(s[j])) j++;
      toks.push({ t: 'name', v: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if (c === '(') {
      toks.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ t: 'rp' });
      i++;
      continue;
    }
    if ('+-*/^!'.includes(c)) {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new Error('无法识别的符号: ' + c);
  }
  return toks;
}

export function evalExpr(input: string): number {
  const toks = tokenize(input);
  if (!toks.length) throw new Error('空表达式');
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const eat = (): Tok => toks[pos++];
  const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === 'op' && t.v === v;

  // 加减
  function parseAdd(): number {
    let v = parseMul();
    for (;;) {
      const t = peek();
      if (isOp(t, '+')) {
        eat();
        v += parseMul();
      } else if (isOp(t, '-')) {
        eat();
        v -= parseMul();
      } else return v;
    }
  }
  // 乘除
  function parseMul(): number {
    let v = parseUnary();
    for (;;) {
      const t = peek();
      if (isOp(t, '*')) {
        eat();
        v *= parseUnary();
      } else if (isOp(t, '/')) {
        eat();
        v /= parseUnary();
      } else return v;
    }
  }
  // 一元正负（在幂之上 → -2^2 = -4）
  function parseUnary(): number {
    const t = peek();
    if (isOp(t, '-')) {
      eat();
      return -parseUnary();
    }
    if (isOp(t, '+')) {
      eat();
      return parseUnary();
    }
    return parsePow();
  }
  // 幂（右结合，右操作数可带一元正负：2^-3）
  function parsePow(): number {
    const base = parseFactorial();
    if (isOp(peek(), '^')) {
      eat();
      return Math.pow(base, parseUnary());
    }
    return base;
  }
  // 阶乘（后缀）
  function parseFactorial(): number {
    let v = parsePrimary();
    while (isOp(peek(), '!')) {
      eat();
      v = factorial(v);
    }
    return v;
  }
  // 基元：数 / 括号 / 函数(...) / 常量
  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new Error('表达式不完整');
    if (t.t === 'num') {
      eat();
      return t.v;
    }
    if (t.t === 'lp') {
      eat();
      const v = parseAdd();
      if (peek()?.t !== 'rp') throw new Error('缺少右括号');
      eat();
      return v;
    }
    if (t.t === 'name') {
      eat();
      if (t.v in CONSTS) return CONSTS[t.v];
      const fn = FUNCS[t.v];
      if (!fn) throw new Error('未知标识符: ' + t.v);
      if (peek()?.t !== 'lp') throw new Error(t.v + ' 需要括号');
      eat();
      const arg = parseAdd();
      if (peek()?.t !== 'rp') throw new Error('缺少右括号');
      eat();
      return fn(arg);
    }
    throw new Error('意外符号');
  }

  const result = parseAdd();
  if (pos !== toks.length) throw new Error('多余符号');
  return result;
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzCalc: typeof evalExpr }).__qzCalc = evalExpr;
}
