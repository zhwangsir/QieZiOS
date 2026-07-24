// ───────────────────────────────────────────────────────────
// 词展开纯函数（M29）：花括号 {a,b} / {1..5} / {a..z} 展开 + 波浪号 ~/~user 展开。
// 纯函数无依赖——引号判定在调用方（token 层 q 字段）：仅无引号词调用本模块。
// bash 展开顺序：花括号 → 波浪号 → 变量/命令/算术展开（subst）→ glob。
// 已知差异：花括号扫描不识别 $( … ) 跨度（x$(echo {a,b})y 的展开路径与 bash 不同），记录在案。
// ───────────────────────────────────────────────────────────

// M31 转义哨兵：tokenize 把 \X 转成 ESC+X（双引号内仅 \$ \` \" \\；单引号内不处理）。
// 下游所有扫描（花括号/波浪号/变量/命令替换/glob）遇到 ESC 整对跳过、不作特殊语义；
// 最终在 expandToks/expandWords 出口统一剥掉 ESC。定义在本模块避免 shell.ts ↔ wordexpand 循环依赖。
export const ESC = '\u0001';

// 找与 s[open]=='{' 匹配的 '}'（计入嵌套）；未闭合返回 -1。ESC 转义的括号不算。
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === ESC) {
      i++; // 转义对整体跳过
      continue;
    }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 顶层逗号切分（嵌套花括号内的逗号不切；ESC 转义的逗号/括号不算）。
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === ESC && i + 1 < s.length) {
      cur += c + s[i + 1]; // 转义对原样保留（逗号不切、括号不计深度），留待出口剥 ESC
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

// 区间 {x..y[..step]}：两端同为整数或同为单字符；步进取绝对值（0 非法→不展开）；
// 数字任一端带前导零 → 按两端数字部分最大宽度补零（{01..5} → 01 02 03 04 05）。
// 非区间形态返回 null（调用方退化为逗号列表/字面）。
function rangeAlts(inner: string): string[] | null {
  const m = /^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])(?:\.\.(-?\d+))?$/.exec(inner);
  if (!m) return null;
  const [, a, b, stepRaw] = m;
  const step = stepRaw === undefined ? 1 : Math.abs(Number(stepRaw));
  if (step === 0) return null;
  const aNum = /^-?\d+$/.test(a);
  const bNum = /^-?\d+$/.test(b);
  if (aNum !== bNum) return null; // 混合类型 {1..z} bash 不展开
  const out: string[] = [];
  if (aNum) {
    const lo = Number(a);
    const hi = Number(b);
    const width = /^-?0\d/.test(a) || /^-?0\d/.test(b) ? Math.max(a.replace('-', '').length, b.replace('-', '').length) : 0;
    const fmt = (n: number) => (n < 0 ? '-' : '') + String(Math.abs(n)).padStart(width, '0');
    if (lo <= hi) for (let n = lo; n <= hi; n += step) out.push(fmt(n));
    else for (let n = lo; n >= hi; n -= step) out.push(fmt(n));
  } else {
    const lo = a.charCodeAt(0);
    const hi = b.charCodeAt(0);
    if (lo <= hi) for (let n = lo; n <= hi; n += step) out.push(String.fromCharCode(n));
    else for (let n = lo; n >= hi; n -= step) out.push(String.fromCharCode(n));
  }
  return out;
}

// 找第一个「可展开」的花括号组（顶层含逗号或是合法区间）；无效组跳过继续向右扫
// （{{a,b}} 外层无顶层逗号 → 跳过外层后能命中内层，对齐 bash 递归语义）。
function findExpandable(s: string): { start: number; end: number } | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    const end = matchBrace(s, i);
    if (end === -1) return null; // 未闭合 → 整串当字面
    const inner = s.slice(i + 1, end);
    if (rangeAlts(inner) !== null || splitTop(inner).length > 1) return { start: i, end };
  }
  return null;
}

// 花括号展开：{a,b} 逗号列表 / {1..5} / {a..z} 区间，支持嵌套与多组（笛卡尔积）。
// 无有效组 → 原样单元素返回。引号词不要调（调用方按 token.q 过滤）。
export function braceExpand(word: string): string[] {
  const b = findExpandable(word);
  if (!b) return [word];
  const pre = word.slice(0, b.start);
  const inner = word.slice(b.start + 1, b.end);
  const post = word.slice(b.end + 1);
  const alts = rangeAlts(inner) ?? splitTop(inner);
  const out: string[] = [];
  for (const a of alts) out.push(...braceExpand(pre + a + post));
  return out;
}

// 波浪号展开：仅词首 ~ 生效。~ → home；~name → homeOf(name)；未知用户原样保留。
// 拼接剥掉 home 尾随斜杠，避免 HOME=/ 时产出 //pics；home 本身为 '/' 时保持。
export function tildeExpand(word: string, home: string, homeOf: (user: string) => string | undefined): string {
  if (!word.startsWith('~')) return word;
  const slash = word.indexOf('/');
  const name = slash === -1 ? word.slice(1) : word.slice(1, slash);
  const rest = slash === -1 ? '' : word.slice(slash);
  const base = name === '' ? home : homeOf(name);
  if (base === undefined) return word;
  return rest ? base.replace(/\/+$/, '') + rest : base;
}
