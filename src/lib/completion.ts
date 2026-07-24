// ───────────────────────────────────────────────────────────
// Tab 补全引擎 —— 纯函数（无 DOM），Terminal 的 Tab 键调它。
// 贴近真实 shell 的行为：
//  · 首词补命令名；参数位按命令感知（cd 只目录、man/which 补命令、kill 补 pid、
//    su 补用户、systemctl 补子命令+服务、pkg 补子命令、fg 补作业号、open 补 App+路径）
//  · 管道/重定向感知（M20）：| || && ; & 之后是「新命令位」补命令名；
//    > >> < 之后是「重定向目标」补路径；ls | grep f<Tab> 按段内真实命令递推
//  · 路径补全支持绝对/相对/..、隐藏文件规则（frag 以 . 开头才补隐藏项）、
//    虚拟挂载 /proc /dev（根目录补全与 ls 一样带上 proc/ dev/）
//  · 多候选先补「最长公共前缀」（bash 第一次 Tab 手感），无进展才列候选
//  · 引号感知：cat "fi<Tab> → cat "file.txt" （补完自动闭合引号）
// 动态数据（命令名/App/用户/服务/进程/作业）经 CompletionSource 注入 → vitest 可裸跑。
// ───────────────────────────────────────────────────────────
import { resolvePath, children, getNode, pathOf } from '../kernel/vfs.svelte';
import { isVirtualPath, virtualList, normAbs, VIRTUAL_MOUNTS } from '../system/vfsVirtual';

export interface CompletionSource {
  commands: readonly string[]; // 可执行命令名（COMMAND_NAMES）
  apps: readonly string[]; // open 可启动的 App id
  users: readonly string[]; // su 的用户名
  services: readonly string[]; // systemctl 的服务 id
  pids: readonly number[]; // kill 的进程 pid
  jobNums: readonly number[]; // fg 的作业号（仅运行中）
  env: readonly string[]; // 环境变量名（HOME/PATH/USER/HOSTNAME…）
}

export interface CompletionResult {
  input?: string; // 有新输入（唯一候选补全 / 公共前缀变长）
  candidates?: string[]; // 无法继续补 → 列出候选（目录已带 / 后缀）
}

interface Cand {
  text: string; // 候选文本（不含路径前缀 pre）
  isDir: boolean; // 目录 → 补全加 /、列表加 /
}

// ── 引号感知的「最后一词」切分 ─────────────────────────────
// head = 词前面的整段（含空白与已闭合部分），word = 正在输入的词（剥掉引号字符），
// quote = 未闭合引号（null = 不在引号里）。重建输入 = head + (quote?) + 新词。
// 已知取舍：引号出现在词中间的罕见形态（foo"bar）重建时不保留原引号位置。
export function lastWord(line: string): { head: string; word: string; quote: '"' | "'" | null } {
  let start = 0;
  let inTok = false;
  let q: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null; // 引号闭合（词可能还在继续：'"a"b'）
    } else if (c === '"' || c === "'") {
      q = c;
      if (!inTok) {
        inTok = true;
        start = i;
      }
    } else if (c === ' ' || c === '\t') {
      inTok = false;
      start = i + 1;
    } else if (!inTok) {
      inTok = true;
      start = i;
    }
  }
  return { head: line.slice(0, start), word: line.slice(start).replace(/["']/g, ''), quote: q };
}

// ── 引号感知分词（M20：管道/重定向感知用）────────────────────────────────
// 操作符在引号外单独成词：| || && & ; > >> <。`2>` 拆成 2 + >（段判定只看 >，够用）。
// 引号字符不进词文本（与 lastWord 同款取舍：只用于识别 cmd/操作符位置，不重建输入行）。
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  const flush = () => {
    if (cur) {
      tokens.push(cur);
      cur = '';
    }
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === ' ' || c === '\t') {
      flush();
      continue;
    }
    if (c === '|' || c === '&') {
      flush();
      tokens.push(line[i + 1] === c ? c + c : c); // && || 双写合并
      if (line[i + 1] === c) i++;
      continue;
    }
    if (c === ';') {
      flush();
      tokens.push(';');
      continue;
    }
    if (c === '>') {
      flush();
      tokens.push(line[i + 1] === '>' ? '>>' : '>');
      if (line[i + 1] === '>') i++;
      continue;
    }
    if (c === '<') {
      flush();
      tokens.push('<');
      continue;
    }
    cur += c;
  }
  flush();
  return tokens;
}

// 管道/序列操作符：其后是「新命令位」；重定向操作符：其后是「目标路径」
const PIPE_OPS = new Set(['|', '||', '&&', '&', ';']);
const REDIR_OPS = new Set(['>', '>>', '<']);

// 最长公共前缀（多候选时先补到这里，是 bash 的第一次 Tab 手感）
export function longestCommonPrefix(strs: readonly string[]): string {
  if (!strs.length) return '';
  let lcp = strs[0];
  for (const s of strs.slice(1)) {
    let i = 0;
    while (i < lcp.length && i < s.length && lcp[i] === s[i]) i++;
    lcp = lcp.slice(0, i);
    if (!lcp) break;
  }
  return lcp;
}

// ── 候选收束：0 个不响；1 个补全（目录加 /，其余闭合引号+空格）；多个先补 LCP ──
// frag = 词末已输入的片段（路径场景是最后一段，命令名场景是整个词）。
function settle(
  head: string,
  pre: string,
  frag: string,
  quote: '"' | "'" | null,
  cands: Cand[],
): CompletionResult {
  if (!cands.length) return {};
  const openQ = quote ?? '';
  if (cands.length === 1) {
    const c = cands[0];
    // 目录：加 / 不闭合引号（可能还要继续往深补）；其余：闭合引号 + 空格收尾
    const tail = c.isDir ? '/' : (quote ?? '') + ' ';
    return { input: head + openQ + pre + c.text + tail };
  }
  const lcp = longestCommonPrefix(cands.map((c) => c.text));
  if (lcp.length > frag.length) return { input: head + openQ + pre + lcp }; // 只补到公共前缀，不加后缀
  return { candidates: cands.map((c) => c.text + (c.isDir ? '/' : '')) };
}

// ── 路径候选：解析 word 的目录部分，列出其中匹配 frag 的项 ──
// null = 目录部分解析不到（不存在/不是目录）→ 调用方不响。
function pathCands(
  word: string,
  cwd: string,
  dirsOnly: boolean,
): { pre: string; frag: string; cands: Cand[] } | null {
  const slash = word.lastIndexOf('/');
  const dirStr = slash >= 0 ? word.slice(0, slash) || '/' : '.';
  const frag = slash >= 0 ? word.slice(slash + 1) : word;
  const pre = slash >= 0 ? word.slice(0, slash + 1) : '';

  // 虚拟挂载（/proc、/dev）：目录部分规范化后落在挂载点下 → 走 virtualList
  const base = pathOf(cwd);
  const abs = dirStr.startsWith('/') ? normAbs(dirStr) : normAbs((base === '/' ? '' : base) + '/' + dirStr);
  let entries: Cand[];
  if (isVirtualPath(abs)) {
    const list = virtualList(abs);
    if (!list) return null;
    entries = list.map((e) => ({ text: e.name, isDir: e.type === 'dir' }));
  } else {
    const dirId = resolvePath(cwd, dirStr);
    if (!dirId) return null; // 先窄化 dirId：TS 不能从 node 非空反推 dirId 非空
    const node = getNode(dirId);
    if (!node || node.type !== 'dir') return null;
    entries = children(dirId).map((n) => ({ text: n.name, isDir: n.type === 'dir' }));
    // 根目录：与 ls 行为一致，把虚拟挂载点 proc/ dev/ 也带进候选（跳过同名真实项）。
    // dirsOnly（cd）不带——cd /proc 本就会失败，补出来是误导。
    if (dirId === 'root' && !dirsOnly) {
      const existing = new Set(entries.map((e) => e.text));
      for (const m of VIRTUAL_MOUNTS) {
        const name = m.slice(1);
        if (!existing.has(name)) entries.push({ text: name, isDir: true });
      }
    }
  }
  // 隐藏文件规则（bash 同款）：frag 显式以 . 开头才补隐藏项
  if (!frag.startsWith('.')) entries = entries.filter((e) => !e.text.startsWith('.'));
  if (dirsOnly) entries = entries.filter((e) => e.isDir);
  return { pre, frag, cands: entries.filter((e) => e.text.startsWith(frag)) };
}

// 简单词表补全（命令名/用户/服务/pid/作业号共用）
function wordCands(word: string, table: readonly string[]): Cand[] {
  return table.filter((n) => n.startsWith(word)).map((n) => ({ text: n, isDir: false }));
}

const SYSTEMCTL_SUBS = ['list', 'status', 'start', 'stop', 'restart', 'enable', 'disable'];
const SYSTEMCTL_SVC_SUBS = new Set(['status', 'start', 'stop', 'restart', 'enable', 'disable']);
const PKG_SUBS = ['list', 'search', 'install', 'repo'];

// ── 主入口：input = 整行原始输入，cwd = 当前目录节点 id ─────────────────────
export function completeLine(input: string, cwd: string, src: CompletionSource): CompletionResult {
  const { head, word, quote } = lastWord(input);
  // 空行 Tab：不列全部命令（真实 shell 会问 "Display all N possibilities?"，这里从简不响）
  if (head.trim() === '' && word === '') return {};

  // 首词（命令位）→ 命令名补全
  if (head.trim() === '') return settle('', '', word, quote, wordCands(word, src.commands));

  // M20 管道/重定向感知（bash 同款）：先按整行分词定位「当前段」再判定命令。
  const tokens = tokenize(head);
  const lastTok = tokens[tokens.length - 1];
  // 管道/序列操作符之后 → 新命令位：补命令名（ls | gr<Tab> → grep）
  if (lastTok && PIPE_OPS.has(lastTok)) {
    return settle(head, '', word, quote, wordCands(word, src.commands));
  }
  // 重定向操作符之后 → 目标路径（echo hi > f<Tab> → file…；目录加 / 可续钻）
  if (lastTok && REDIR_OPS.has(lastTok)) {
    const p = pathCands(word, cwd, false);
    return p ? settle(head, p.pre, p.frag, quote, p.cands) : {};
  }
  // 当前管道段 = 最后一个管道/序列操作符之后（ls | grep f<Tab> 按 grep 的参数补）；
  // 段内重定向操作符不参与 cmd/argIdx 判定（cat > out.txt <Tab> 仍按 cat 的参数补）
  let segStart = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (PIPE_OPS.has(tokens[i])) {
      segStart = i + 1;
      break;
    }
  }
  const seg = tokens.slice(segStart).filter((t) => !REDIR_OPS.has(t));
  if (!seg.length) return settle(head, '', word, quote, wordCands(word, src.commands));
  let cmd = seg[0];
  let argIdx = seg.length - 1; // 正在输入第几个参数（0 = 第一个）
  // sudo 透传：sudo <命令> … → 按真实命令递推（sudo k<Tab> 补命令，sudo kill 1<Tab> 补 pid）
  if (cmd === 'sudo' && argIdx >= 1) {
    cmd = seg[1];
    argIdx -= 1;
  }

  // flag 参数（-开头）不补全（真实 shell 走各命令的 flag 表，这里从简不响）
  if (word.startsWith('-')) return {};

  // M23：$ 前缀 = 环境变量补全（$HO<Tab> → $HOME；支持引号内 $VAR 补全）。
  // 放在命令感知之前，确保 cd $HOME、grep $PATH 等场景都能正常补全。
  if (word.startsWith('$')) {
    const varName = word.slice(1);
    const cands = wordCands(varName, src.env);
    if (cands.length === 1) {
      const c = cands[0];
      return { input: head + (quote ?? '') + '$' + c.text + ' ' };
    }
    const lcp = longestCommonPrefix(cands.map((c) => c.text));
    if (lcp.length > varName.length) return { input: head + (quote ?? '') + '$' + lcp };
    return { candidates: cands.map((c) => '$' + c.text) };
  }

  // 命令名类参数：man/help/which 的第一个参数；sudo 的第一个参数
  if ((cmd === 'man' || cmd === 'help' || cmd === 'which' || cmd === 'sudo') && argIdx === 0) {
    return settle(head, '', word, quote, wordCands(word, src.commands));
  }
  if (cmd === 'cd' && argIdx === 0) {
    const p = pathCands(word, cwd, true);
    return p ? settle(head, p.pre, p.frag, quote, p.cands) : {};
  }
  if (cmd === 'kill') return settle(head, '', word, quote, wordCands(word, src.pids.map(String)));
  if (cmd === 'su' && argIdx === 0) return settle(head, '', word, quote, wordCands(word, src.users));
  if (cmd === 'fg' && argIdx === 0) return settle(head, '', word, quote, wordCands(word, src.jobNums.map(String)));
  if (cmd === 'systemctl') {
    if (argIdx === 0) return settle(head, '', word, quote, wordCands(word, SYSTEMCTL_SUBS));
    if (argIdx === 1 && SYSTEMCTL_SVC_SUBS.has(seg[1])) {
      return settle(head, '', word, quote, wordCands(word, src.services));
    }
    return {};
  }
  if (cmd === 'pkg') {
    return argIdx === 0 ? settle(head, '', word, quote, wordCands(word, PKG_SUBS)) : {};
  }
  if (cmd === 'open' && argIdx === 0) {
    // App id 与路径混合候选（open files / open readme.txt 都合法）。
    // word 含 / 时明确是路径 → 不掺 App。
    const p = pathCands(word, cwd, false);
    const appPart = word.includes('/') ? [] : wordCands(word, src.apps);
    if (!p) return settle(head, '', word, quote, appPart);
    return settle(head, p.pre, p.frag, quote, [...appPart, ...p.cands]);
  }

  // 默认：路径补全（ls/cat/rm/mv/cp/grep/find/mkdir/touch/source/…）
  const p = pathCands(word, cwd, false);
  return p ? settle(head, p.pre, p.frag, quote, p.cands) : {};
}
