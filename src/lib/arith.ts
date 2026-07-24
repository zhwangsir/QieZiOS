// ───────────────────────────────────────────────────────────
// 算术展开求值器（$((expr))）—— 递归下降，无 eval。
// 支持：整数字面量（十进制 / 0x 十六进制）、+ - * / % **、一元 + - ! ~、括号、
// 比较 < <= > >= == !=、位运算 & | ^ << >>、逻辑 && ||（短路）、三元 ?:、
// 变量（裸标识符或 $name；未定义/非数值按 0，bash 语义）、位置参数 $1..$9 与 $#（M32）。
// M46.3：赋值类副作用 —— = += -= *= /= %= <<= >>= &= |= ^=、前置/后置 ++ --。
//   使 $((x=5))、$((i++)) 能驱动算术 for ((init; cond; step))。副作用写入 env。
//   短路 dead 分支内不执行副作用（语法仍解析）；右结合链式 a=b=7。
// 整数语义：除法向零取整、% 取被除数符号（同 C/JS）；除零抛错。
// 已知取舍（记录在案）：前导 0 不当八进制（bash 是八进制）；大整数 ** 走 double 有精度上限。
// ───────────────────────────────────────────────────────────

export function evalArith(src: string, env: Record<string, string>, positional: readonly string[] = []): number {
  const s = src;
  let i = 0;
  // dead > 0：逻辑短路 / 三元未选分支 —— 照常解析消费 token（语法错误仍要报），
  // 但不求值、不报算术错（bash：$((0 && 1/0)) = 0 不报错）。
  let dead = 0;

  const ws = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
  };
  const err = (msg: string): never => {
    throw new Error(`算术语法错误：${msg}`);
  };
  // M46.3：变量当前整数值（未定义/非数值按 0，bash 语义）—— 赋值/自增副作用复用。
  const numVal = (name: string): number => {
    const raw = env[name];
    if (raw === undefined) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };

  // ── 优先级（低 → 高）：赋值(右结合) → ?: → || → && → | → ^ → & → == != →
  //   < <= > >=  →  << >>  →  + -  →  * / %  →  ** （右结合，操作数是 unary）→  一元  →  原子
  // bash 里一元 +/- 优先级高于 **（-2**2 = (-2)**2 = 4），故 power 的操作数取 unary。
  // M46.3：赋值最低优先级（低于三元），使 a=b=7 右结合、a = b ? c : d 整体作 RHS。

  function primary(): number {
    ws();
    const c = s[i];
    if (c === undefined) err('表达式不完整');
    if (c === '(') {
      i++;
      const v = ternary();
      ws();
      if (s[i] !== ')') err('缺少 )');
      i++;
      return v;
    }
    if (c === '$') {
      i++;
      // M32 位置参数：$1..$9（bash 单数字——$10 = ${1}0，首数字是参数位、余数字面拼接）与 $# 参数个数。
      const d = /^\d+/.exec(s.slice(i));
      if (d) {
        i += d[0].length;
        if (dead) return 0;
        const raw = (positional[Number(d[0][0]) - 1] ?? '') + d[0].slice(1);
        const n = Number(raw);
        return Number.isFinite(n) ? Math.trunc(n) : 0;
      }
      if (s[i] === '#') {
        i++;
        return dead ? 0 : positional.length;
      }
      return ident();
    }
    if (/[0-9]/.test(c)) {
      const m = /^(0[xX][0-9a-fA-F]+|\d+)/.exec(s.slice(i))!;
      i += m[0].length;
      return /^0[xX]/.test(m[0]) ? parseInt(m[0], 16) : parseInt(m[0], 10);
    }
    if (/[A-Za-z_]/.test(c)) return ident();
    return err(`意外的字符 '${c}'`);
  }

  function ident(): number {
    const m = /^[A-Za-z_]\w*/.exec(s.slice(i));
    if (!m) return err('变量名无效');
    i += m[0].length;
    const name = m[0];
    // M46.3 后置 ++ / --：返回旧值，变量自增/自减（副作用写入 env）。
    ws();
    if (s[i] === '+' && s[i + 1] === '+') {
      i += 2;
      if (dead) return 0;
      const old = numVal(name);
      env[name] = String(old + 1);
      return old;
    }
    if (s[i] === '-' && s[i + 1] === '-') {
      i += 2;
      if (dead) return 0;
      const old = numVal(name);
      env[name] = String(old - 1);
      return old;
    }
    if (dead) return 0;
    return numVal(name);
  }

  function unary(): number {
    ws();
    // M46.3 前置 ++ / --：仅当后跟变量时是自增自减（副作用写入 env）。
    // bash：--5 当两个一元负号（+5=5），--x 当前置自减；常量/括号不算自减操作数。
    if (s[i] === '+' && s[i + 1] === '+') {
      const saveI = i;
      i += 2;
      ws();
      const m = /^[A-Za-z_]\w*/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        if (dead) return 0;
        const v = numVal(m[0]) + 1;
        env[m[0]] = String(v);
        return v;
      }
      i = saveI; // 回退：当两个一元 +
    }
    if (s[i] === '-' && s[i + 1] === '-') {
      const saveI = i;
      i += 2;
      ws();
      const m = /^[A-Za-z_]\w*/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        if (dead) return 0;
        const v = numVal(m[0]) - 1;
        env[m[0]] = String(v);
        return v;
      }
      i = saveI; // 回退：当两个一元 -
    }
    const c = s[i];
    if (c === '+') {
      i++;
      return unary();
    }
    if (c === '-') {
      i++;
      return -unary();
    }
    if (c === '!') { i++; return unary() === 0 ? 1 : 0; }
    if (c === '~') { i++; return ~unary(); }
    return primary();
  }

  function power(): number {
    const base = unary();
    ws();
    if (s[i] === '*' && s[i + 1] === '*') {
      i += 2;
      const e = power(); // 右结合：2**3**2 = 2**(3**2)
      if (dead) return 0;
      return Math.trunc(Math.pow(base, e));
    }
    return base;
  }

  function mul(): number {
    let v = power();
    for (;;) {
      ws();
      const op = s[i];
      if (op === '*' && s[i + 1] !== '*') {
        i++;
        const r = power();
        v = dead ? 0 : v * r;
      } else if (op === '/' || op === '%') {
        i++;
        const r = power();
        if (!dead && r === 0) err('除数为 0');
        v = dead ? 0 : op === '/' ? Math.trunc(v / r) : v % r;
      } else return v;
    }
  }

  function add(): number {
    let v = mul();
    for (;;) {
      ws();
      const op = s[i];
      if (op === '+' || op === '-') {
        i++;
        const r = mul();
        v = dead ? 0 : op === '+' ? v + r : v - r;
      } else return v;
    }
  }

  function shift(): number {
    let v = add();
    for (;;) {
      ws();
      if (s[i] === '<' && s[i + 1] === '<') {
        i += 2;
        const r = add();
        v = dead ? 0 : v << r;
      } else if (s[i] === '>' && s[i + 1] === '>') {
        i += 2;
        const r = add();
        v = dead ? 0 : v >> r;
      } else return v;
    }
  }

  function rel(): number {
    let v = shift();
    for (;;) {
      ws();
      const two = s.slice(i, i + 2);
      if (two === '<=' || two === '>=') {
        i += 2;
        const r = shift();
        v = dead ? 0 : (two === '<=' ? v <= r : v >= r) ? 1 : 0;
      } else if (s[i] === '<' || s[i] === '>') {
        const op = s[i];
        i++;
        const r = shift();
        v = dead ? 0 : (op === '<' ? v < r : v > r) ? 1 : 0;
      } else return v;
    }
  }

  function eq(): number {
    let v = rel();
    for (;;) {
      ws();
      const two = s.slice(i, i + 2);
      if (two === '==' || two === '!=') {
        i += 2;
        const r = rel();
        v = dead ? 0 : (two === '==' ? v === r : v !== r) ? 1 : 0;
      } else return v;
    }
  }

  function bitAnd(): number {
    let v = eq();
    for (;;) {
      ws();
      if (s[i] === '&' && s[i + 1] !== '&') {
        i++;
        const r = eq();
        v = dead ? 0 : v & r;
      } else return v;
    }
  }

  function bitXor(): number {
    let v = bitAnd();
    for (;;) {
      ws();
      if (s[i] === '^') {
        i++;
        const r = bitAnd();
        v = dead ? 0 : v ^ r;
      } else return v;
    }
  }

  function bitOr(): number {
    let v = bitXor();
    for (;;) {
      ws();
      if (s[i] === '|' && s[i + 1] !== '|') {
        i++;
        const r = bitXor();
        v = dead ? 0 : v | r;
      } else return v;
    }
  }

  function logAnd(): number {
    let v = bitOr();
    for (;;) {
      ws();
      if (s[i] === '&' && s[i + 1] === '&') {
        i += 2;
        if (!dead && v === 0) {
          dead++; // 短路：RHS 只解析不求值
          bitOr();
          dead--;
          v = 0;
        } else {
          const r = bitOr();
          v = dead ? 0 : v !== 0 && r !== 0 ? 1 : 0;
        }
      } else return v;
    }
  }

  function logOr(): number {
    let v = logAnd();
    for (;;) {
      ws();
      if (s[i] === '|' && s[i + 1] === '|') {
        i += 2;
        if (!dead && v !== 0) {
          dead++;
          logAnd();
          dead--;
          v = 1;
        } else {
          const r = logAnd();
          v = dead ? 0 : v !== 0 || r !== 0 ? 1 : 0;
        }
      } else return v;
    }
  }

  function ternary(): number {
    const cond = logOr();
    ws();
    if (s[i] !== '?') return cond;
    i++;
    const thenDead = dead > 0 || cond === 0;
    if (thenDead) dead++;
    const a = ternary();
    if (thenDead) dead--;
    ws();
    if (s[i] !== ':') err('三元运算缺少 :');
    i++;
    const elseDead = dead > 0 || cond !== 0;
    if (elseDead) dead++;
    const b = ternary();
    if (elseDead) dead--;
    if (dead > 0) return 0;
    return cond !== 0 ? a : b;
  }

  // M46.3 赋值（最低优先级，右结合）：lhs OP rhs。lhs 必须是裸标识符（lvalue）。
  // OP ∈ = += -= *= /= %= <<= >>= &= |= ^=。rhs 是 assign()（实现 a=b=7 右结合）。
  // 短路 dead 分支内不执行副作用（语法仍解析、rhs 递归 assign 在 dead 下 return 0）。
  // 注意：= 必须排除 ==（相等比较由 eq 层处理，优先级更高，不会到这里——但 lookahead 要避免误判）。
  function assign(): number {
    ws();
    const m = /^[A-Za-z_]\w*/.exec(s.slice(i));
    if (m) {
      let j = i + m[0].length;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
      const ops = ['<<=', '>>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '='];
      let op = '';
      for (const cand of ops) {
        // = 后跟 = 是 ==（相等比较），不是赋值
        if (cand === '=' && s[j + 1] === '=') continue;
        if (s.slice(j, j + cand.length) === cand) { op = cand; break; }
      }
      if (op) {
        i = j + op.length;
        const r = assign(); // 右结合：a=b=7 → a=(b=7)
        if (dead) return 0;
        const name = m[0];
        const base = numVal(name);
        let v: number;
        switch (op) {
          case '=': v = r; break;
          case '+=': v = base + r; break;
          case '-=': v = base - r; break;
          case '*=': v = base * r; break;
          case '/=': if (r === 0) return err('除数为 0'); v = Math.trunc(base / r); break;
          case '%=': if (r === 0) return err('除数为 0'); v = base % r; break;
          case '<<=': v = base << r; break;
          case '>>=': v = base >> r; break;
          case '&=': v = base & r; break;
          case '|=': v = base | r; break;
          case '^=': v = base ^ r; break;
          default: return err(`未知赋值运算符: ${op}`);
        }
        env[name] = String(v);
        return v;
      }
    }
    return ternary();
  }

  const v = assign();
  ws();
  if (i < s.length) err(`意外的字符 '${s[i]}'`);
  return v;
}
