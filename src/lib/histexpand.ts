// ───────────────────────────────────────────────────────────
// 历史展开纯函数 —— bash 的 ! 展开（history expansion），交互式 shell 的高频复用手段。
// 事件指示符：!!（上一条）· !n（第 n 条，1-based 从旧数）· !-n（倒数第 n 条）·
//            !str（最近以 str 开头的）· !?str?（最近包含 str 的）。
// 词指示符（M28）：事件后可跟 :^（词 1，首个参数）· :$（末词）· :*（词 1..末，无参数为空串）·
//            :n（0-based 含命令名）· :n-m · :n-（到倒数第 2 个）· :n*（到末）；
//            独立简写 !$ / !^ / !* == !!:$ / !!:^ / !!:*。
// 修饰符（M28）：:s/old/new/（换首个匹配）· :gs/old/new/（全局；分隔符任意字符、结尾可省、
//            \<分隔符> 转义字面）· :p（只打印不执行 → printOnly，由调用方跳过 run）；可叠加。
// 规则对齐 bash：单引号内不展开、双引号内展开、\! 转义字面、! 后空白/词尾/= 是字面 !。
// 展开失败不执行（bash: event not found）——返回 ok:false 由调用方报错。
// 已知取舍：词切分近似为空白分词（bash 按完整词法，引号包裹的算一词）；
//            !str 的 str 终止于 :（交给词指示符/修饰符解析，无法识别则报错）；
//            替换结果里 & 不复现匹配文本（bash 的 & 语义，低频不做）。
// ───────────────────────────────────────────────────────────

export type HistExpandResult =
  | { ok: true; line: string; changed: boolean; printOnly?: boolean } // changed=false：行内无可展开项原样返回；printOnly：:p 只打印不执行
  | { ok: false; error: string }; // 事件未找到 / 词下标越界 / 无法识别的修饰符（error 含触发词）

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

// 按序号取历史：n>0 第 n 条（1-based 从旧数）；n<0 倒数第 -n 条（-1 == !!）。
function byIndex(history: readonly string[], n: number): string | null {
  const i = n > 0 ? n - 1 : history.length + n;
  return i >= 0 && i < history.length ? history[i] : null;
}

type ApplyResult =
  | { ok: true; text: string; j: number; printOnly: boolean }
  | { ok: false; error: string };

// 「:词指示符 / :修饰符」链统一子流程：从 line[j] 起消费连续的 :xxx 段，返回最终文本与消耗到的下标。
// base：事件展开得到的文本。词指示符先做切词选取；s/gs/p 修饰符作用于当前结果，可多个叠加。
// first：!$ / !^ / !* 独立简写传入的首个词指示符（不带冒号，等价于 !!:X）。
function applyDesignatorsAndMods(base: string, line: string, j: number, first?: string): ApplyResult {
  let text = base;
  let printOnly = false;
  // 词切分（近似）：bash 按完整词法、引号包裹算一词；这里按空白分词（取舍在案）。
  // 每次选取/替换后作废重切 —— 链中词指示符（如 !!:s/a/b/:1）罕见，按当前文本近似即可。
  let words: string[] | null = null;
  const getWords = (): string[] => {
    if (words === null) words = text.split(/\s+/).filter((w) => w !== '');
    return words;
  };
  // 无法识别时的报错：取 ':' 起到空白的整段（如 :xyz、:s/a 缺中间分隔符）
  const bad = (): ApplyResult => {
    let e = j;
    while (e < line.length && line[e] !== ' ' && line[e] !== '\t') e++;
    return { ok: false, error: `无法识别的修饰符 ${line.slice(j, e)}` };
  };

  for (;;) {
    let d: string | undefined;
    let k: number; // 指示符/修饰符内容起始下标（':' 之后；first 则是指示符本身）
    if (first !== undefined) {
      d = first;
      k = j;
      first = undefined;
    } else if (line[j] === ':') {
      d = line[j + 1];
      k = j + 1;
    } else break;

    // 词指示符：^ $ * n n-m n- n*
    if (d !== undefined && (d === '^' || d === '$' || d === '*' || isDigit(d))) {
      const ws = getWords();
      let lo: number;
      let hi: number;
      let spec: string; // 报错里回显的指示符原文
      let emptyOk = false; // :* 无参数时为空串不报错（bash 同款）
      if (d === '^') {
        spec = '^';
        lo = hi = 1;
        k += 1;
      } else if (d === '$') {
        spec = '$';
        lo = hi = ws.length - 1;
        k += 1;
      } else if (d === '*') {
        spec = '*';
        lo = 1;
        hi = ws.length - 1;
        emptyOk = true;
        k += 1;
      } else {
        let e = k;
        while (isDigit(line[e])) e++;
        const n = Number(line.slice(k, e));
        spec = String(n);
        if (line[e] === '-') {
          e++;
          const m0 = e;
          while (isDigit(line[e])) e++;
          if (e > m0) {
            spec = `${n}-${line.slice(m0, e)}`;
            lo = n;
            hi = Number(line.slice(m0, e));
          } else {
            spec = `${n}-`; // :n- = 词 n 到倒数第 2 个（省略末词）
            lo = n;
            hi = ws.length - 2;
          }
        } else if (line[e] === '*') {
          e++;
          spec = `${n}*`; // :n* = 词 n 到末（bash 简写）
          lo = n;
          hi = ws.length - 1;
        } else {
          lo = hi = n;
        }
        k = e;
      }
      if (!emptyOk && (lo < 0 || hi < lo || hi >= ws.length)) {
        return { ok: false, error: `${spec}: 词下标越界` };
      }
      text = emptyOk ? ws.slice(1).join(' ') : ws.slice(lo, hi + 1).join(' ');
      words = null;
      j = k;
      continue;
    }

    // :p 打印修饰符：结果只回显不执行（叠加到结果标志，Terminal 据此跳过 run）
    if (d === 'p') {
      printOnly = true;
      j = k + 1;
      continue;
    }

    // :s/old/new/（换首个匹配）· :gs/old/new/（全局）
    if (d === 's' || (d === 'g' && line[k + 1] === 's')) {
      const g = d === 'g';
      let p = k + (g ? 2 : 1);
      const delim = line[p]; // 分隔符任意字符（bash 允许 :s|a|b|）
      if (delim === undefined) return bad();
      p++;
      // old / new：到未转义的分隔符为止；\<分隔符> 表示字面分隔符
      let old = '';
      while (p < line.length && line[p] !== delim) {
        if (line[p] === '\\' && line[p + 1] === delim) {
          old += delim;
          p += 2;
        } else {
          old += line[p];
          p++;
        }
      }
      if (p >= line.length) return bad(); // 只有 old 没有 new（缺中间分隔符）
      p++;
      let rep = '';
      while (p < line.length && line[p] !== delim) {
        if (line[p] === '\\' && line[p + 1] === delim) {
          rep += delim;
          p += 2;
        } else {
          rep += line[p];
          p++;
        }
      }
      if (line[p] === delim) p++; // 结尾分隔符可省（:s/a/b 亦合法）
      if (old === '') return { ok: false, error: `s/${old}/${rep}/: 替换目标为空` };
      // bash：old 无匹配 → 原样返回不报错（replace/split 天然如此）；
      // 函数式替换避免 new 里的 $ 被 String.replace 当特殊序列。
      text = g ? text.split(old).join(rep) : text.replace(old, () => rep);
      words = null;
      j = p;
      continue;
    }

    // 无法识别的 :xx → 报错不执行（bash: bad word specifier 同款）
    return bad();
  }
  return { ok: true, text, j, printOnly };
}

export function histExpand(line: string, history: readonly string[]): HistExpandResult {
  let out = '';
  let changed = false;
  let printOnly = false;
  let q: '"' | "'" | null = null;
  const fail = (word: string): HistExpandResult => ({ ok: false, error: `${word}: 事件未找到` });

  let i = 0;
  while (i < line.length) {
    const c = line[i];
    // 单引号内：一切字面（bash 强引用不展开）——其后的 :s 等自然也不解析
    if (q === "'") {
      out += c;
      if (c === "'") q = null;
      i++;
      continue;
    }
    if (c === "'") {
      q = "'";
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      q = q === '"' ? null : '"';
      out += c;
      i++;
      continue;
    }
    // \! 转义：字面 !（反斜杠本身丢弃）
    if (c === '\\' && line[i + 1] === '!') {
      out += '!';
      i += 2;
      continue;
    }
    if (c !== '!') {
      out += c;
      i++;
      continue;
    }

    // ── 遇到 !：判定展开形态 ──
    const next = line[i + 1];
    // 词尾 / 空白 / = / 引号紧随 → 字面 !（bash 同款：echo a!、!= 不展开）
    if (next === undefined || next === ' ' || next === '\t' || next === '=' || next === '"' || next === "'") {
      out += '!';
      i++;
      continue;
    }
    // 事件找到后统一走词指示符/修饰符子流程，再拼回输出
    const apply = (cmd: string, j: number, first?: string): ApplyResult | null => {
      const r = applyDesignatorsAndMods(cmd, line, j, first);
      if (!r.ok) return r;
      out += r.text;
      changed = true;
      printOnly = printOnly || r.printOnly;
      i = r.j;
      return null;
    };
    // !! → 上一条
    if (next === '!') {
      const cmd = byIndex(history, -1);
      if (cmd === null) return fail('!!');
      const bad = apply(cmd, i + 2);
      if (bad) return bad;
      continue;
    }
    // !$ / !^ / !* 独立简写 == !!:$ / !!:^ / !!:*（bash 同款）
    if (next === '$' || next === '^' || next === '*') {
      const cmd = byIndex(history, -1);
      if (cmd === null) return fail(`!${next}`);
      const bad = apply(cmd, i + 1, next);
      if (bad) return bad;
      continue;
    }
    // !-n → 倒数第 n 条
    if (next === '-' && isDigit(line[i + 2])) {
      let j = i + 2;
      while (isDigit(line[j])) j++;
      const cmd = byIndex(history, -Number(line.slice(i + 2, j)));
      if (cmd === null) return fail(line.slice(i, j));
      const bad = apply(cmd, j);
      if (bad) return bad;
      continue;
    }
    // !n → 第 n 条（1-based）
    if (isDigit(next)) {
      let j = i + 1;
      while (isDigit(line[j])) j++;
      const cmd = byIndex(history, Number(line.slice(i + 1, j)));
      if (cmd === null) return fail(line.slice(i, j));
      const bad = apply(cmd, j);
      if (bad) return bad;
      continue;
    }
    // !?str? → 最近「包含」str 的（闭合 ? 可省，取到行尾/空白；修饰符需跟在闭合 ? 后）
    if (next === '?') {
      let j = i + 2;
      while (j < line.length && line[j] !== '?' && line[j] !== ' ' && line[j] !== '\t') j++;
      const str = line.slice(i + 2, j);
      if (line[j] === '?') j++; // 吃闭合 ?
      const cmd = str ? [...history].reverse().find((h) => h.includes(str)) : undefined;
      if (!cmd) return fail(line.slice(i, j));
      const bad = apply(cmd, j);
      if (bad) return bad;
      continue;
    }
    // !str → 最近「以 str 开头」的（str 取到空白/引号/行尾/冒号；
    // 冒号起交给词指示符/修饰符解析 —— !git:s/a/b/ 的 str 是 'git'，bash 同款）
    let j = i + 1;
    while (j < line.length && line[j] !== ' ' && line[j] !== '\t' && line[j] !== '"' && line[j] !== "'" && line[j] !== ':') j++;
    const str = line.slice(i + 1, j);
    const cmd = [...history].reverse().find((h) => h.startsWith(str));
    if (!cmd) return fail(line.slice(i, j));
    const bad = apply(cmd, j);
    if (bad) return bad;
  }
  const res: HistExpandResult = { ok: true, line: out, changed };
  if (printOnly) res.printOnly = true; // 默认不设，只有 :p 出现过才带
  return res;
}
