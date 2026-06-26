// ───────────────────────────────────────────────────────────
// 极简 POSIX 风格 Shell —— 跑在 VFS 之上的命令解释器。
// 纯逻辑（无 DOM），终端 App 拿来执行每一行。一次执行返回完整输出（MVP 不流式）。
// 设计：命令表 COMMANDS[name] = (args, ctx) => CmdResult。
// 支持：$VAR 替换、引号、基础重定向 > / >>。管道/grep 等留给 Phase G2。
// ───────────────────────────────────────────────────────────
import {
  resolvePath,
  pathOf,
  getNode,
  children,
  createDir,
  createFile,
  writeFile,
  rename,
  move,
  trash,
  isImage,
  type VNode,
} from '../kernel/vfs.svelte';
import { sys } from '../system/sys';
import { appList, appMeta } from '../apps/appList';
import { settings } from '../system/settings.svelte';

export interface ShellCtx {
  cwd: string; // 当前目录节点 id
  env: Record<string, string>; // 环境变量
  code: number; // 上次命令退出码（$?）
}

export interface CmdResult {
  out: string;
  err?: string;
  code: number;
  cd?: string; // 命令要求切换 cwd（cd）
  clear?: boolean; // 命令要求清屏（clear）
}

export function newCtx(): ShellCtx {
  return { cwd: 'root', env: { USER: 'qiezi', HOME: '/', SHELL: 'qzsh', HOSTNAME: 'qiezios' }, code: 0 };
}

// ── 词法：按空白分词，尊重单/双引号 ─────────────────────────
function tokenize(line: string): string[] {
  const toks: string[] = [];
  let cur = '';
  let inTok = false;
  let q: '"' | "'" | null = null;
  for (const c of line) {
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      inTok = true;
    } else if (c === ' ' || c === '\t') {
      if (inTok) {
        toks.push(cur);
        cur = '';
        inTok = false;
      }
    } else {
      cur += c;
      inTok = true;
    }
  }
  if (inTok) toks.push(cur);
  return toks;
}

// $VAR / ${VAR} / $? 替换
function subst(tok: string, ctx: ShellCtx): string {
  return tok
    .replace(/\$\?/g, String(ctx.code))
    .replace(/\$\{(\w+)\}/g, (_, n) => ctx.env[n] ?? '')
    .replace(/\$(\w+)/g, (_, n) => ctx.env[n] ?? '');
}

// 把内容写到路径（重定向用）：目录不存在报错，文件存在则覆盖/追加，否则新建
function writeToPath(ctx: ShellCtx, pathStr: string, content: string, append: boolean): string | null {
  const slash = pathStr.lastIndexOf('/');
  const dirStr = slash >= 0 ? pathStr.slice(0, slash) || '/' : '.';
  const base = slash >= 0 ? pathStr.slice(slash + 1) : pathStr;
  if (!base) return '不是有效的文件名';
  const dirId = resolvePath(ctx.cwd, dirStr);
  if (!dirId || getNode(dirId)?.type !== 'dir') return `${dirStr}: 目录不存在`;
  const existing = children(dirId).find((n) => n.name === base);
  if (existing) {
    if (existing.type !== 'file') return `${base}: 不是文件`;
    writeFile(existing.id, append ? existing.content + content : content);
  } else {
    createFile(dirId, base, content);
  }
  return null;
}

// 拆出 [flags, 位置参数]（flags 形如 -l、-la）
function splitFlags(args: string[]): { flags: Set<string>; rest: string[] } {
  const flags = new Set<string>();
  const rest: string[] = [];
  for (const a of args) {
    if (a.startsWith('-') && a.length > 1) for (const ch of a.slice(1)) flags.add(ch);
    else rest.push(a);
  }
  return { flags, rest };
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 文本处理命令（grep/wc/...）的共用小工具 ───────────────────
// 读一个路径的文本内容（文本文件）
function readFileText(ctx: ShellCtx, path: string): { text?: string; err?: string } {
  const id = resolvePath(ctx.cwd, path);
  const n = id ? getNode(id) : undefined;
  if (!n) return { err: `${path}: 没有那个文件或目录` };
  if (n.type === 'dir') return { err: `${path}: 是一个目录` };
  return { text: n.kind === 'binary' ? '' : n.content };
}
// 取输入：有文件参数读文件，否则用 stdin（管道）
function inputText(ctx: ShellCtx, file: string | null, stdin: string): { text?: string; err?: string } {
  return file ? readFileText(ctx, file) : { text: stdin };
}
// 递归列出某目录下所有后代节点（文件+目录）
function walk(startId: string): VNode[] {
  const out: VNode[] = [];
  const rec = (id: string) => {
    for (const c of children(id)) {
      out.push(c);
      if (c.type === 'dir') rec(c.id);
    }
  };
  rec(startId);
  return out;
}
// 把文本切成「逻辑行」（去掉末尾单个换行，避免多出空行）
function toLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}
// glob（* ?）→ 整串匹配的正则
function globToRe(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$');
}
// 解析 head/tail 的 -n N / -nN / -N 与可选文件参数
function parseCountAndFile(args: string[], def = 10): { count: number; file: string | null } {
  let count = def;
  let file: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-n') {
      const v = parseInt(args[++i] ?? '', 10); // 注意：合法的 0 不能被 || 当成 falsy 吞掉
      count = Number.isNaN(v) ? def : v;
    } else if (/^-n\d+$/.test(a)) count = parseInt(a.slice(2), 10);
    else if (/^-\d+$/.test(a)) count = parseInt(a.slice(1), 10);
    else if (!a.startsWith('-')) file = a;
  }
  return { count, file };
}

// 命令收到上游/重定向来的 stdin（无则空串），返回 stdout/stderr/退出码
type CmdFn = (args: string[], ctx: ShellCtx, stdin: string) => CmdResult;

const COMMANDS: Record<string, CmdFn> = {
  help: () => ({
    out:
      '可用命令：\n' +
      '  pwd ls cd cat echo  —— 浏览/查看\n' +
      '  mkdir touch rm mv cp —— 文件操作\n' +
      '  open apps ps kill    —— 应用/进程\n' +
      '  grep find wc head tail sort uniq cut —— 文本处理（配合管道）\n' +
      '  whoami date env export theme clear help\n' +
      '支持：$VAR 变量、" " 引号、管道 | 、重定向 > >> < 2>。\n' +
      '试试：ls | grep txt  /  cat a.txt | wc -l  /  find / -name "*.txt"',
    code: 0,
  }),

  pwd: (_a, ctx) => ({ out: pathOf(ctx.cwd), code: 0 }),
  whoami: (_a, ctx) => ({ out: ctx.env.USER || 'qiezi', code: 0 }),
  date: () => ({ out: new Date().toLocaleString('zh-CN'), code: 0 }),
  clear: () => ({ out: '', code: 0, clear: true }),
  echo: (args) => ({ out: args.join(' '), code: 0 }),

  env: (_a, ctx) => ({
    out: Object.entries(ctx.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    code: 0,
  }),
  export: (args, ctx) => {
    for (const a of args) {
      const eq = a.indexOf('=');
      if (eq > 0) ctx.env[a.slice(0, eq)] = a.slice(eq + 1);
    }
    return { out: '', code: 0 };
  },

  ls: (args, ctx) => {
    const { flags, rest } = splitFlags(args);
    const targetId = resolvePath(ctx.cwd, rest[0] ?? '.');
    if (!targetId) return { out: '', err: `ls: ${rest[0]}: 没有那个文件或目录`, code: 2 };
    const node = getNode(targetId);
    if (!node) return { out: '', err: 'ls: 无效路径', code: 2 };
    const items = node.type === 'dir' ? children(targetId) : [node];
    if (flags.has('l')) {
      const lines = items.map((n) => {
        const t = n.type === 'dir' ? 'd' : '-';
        const size = n.type === 'dir' ? '-' : String(n.kind === 'binary' ? (n.size ?? 0) : n.content.length);
        return `${t}  ${size.padStart(7)}  ${fmtTime(n.updatedAt)}  ${n.name}${n.type === 'dir' ? '/' : ''}`;
      });
      return { out: lines.join('\n'), code: 0 };
    }
    return { out: items.map((n) => (n.type === 'dir' ? n.name + '/' : n.name)).join('  '), code: 0 };
  },

  cd: (args, ctx) => {
    const id = resolvePath(ctx.cwd, args[0] ?? '/');
    if (!id) return { out: '', err: `cd: ${args[0]}: 没有那个目录`, code: 1 };
    if (getNode(id)?.type !== 'dir') return { out: '', err: `cd: ${args[0]}: 不是目录`, code: 1 };
    return { out: '', code: 0, cd: id };
  },

  cat: (args, ctx, stdin) => {
    if (!args.length) return { out: stdin, code: 0 }; // 无参数 → 透传 stdin（支持管道）
    const parts: string[] = [];
    for (const a of args) {
      const id = resolvePath(ctx.cwd, a);
      const n = id ? getNode(id) : undefined;
      if (!n) return { out: parts.join('\n'), err: `cat: ${a}: 没有那个文件`, code: 1 };
      if (n.type === 'dir') return { out: parts.join('\n'), err: `cat: ${a}: 是一个目录`, code: 1 };
      parts.push(n.kind === 'binary' ? `[二进制文件 ${n.mime ?? ''} ${n.size ?? 0}B]` : n.content);
    }
    return { out: parts.join('\n'), code: 0 };
  },

  mkdir: (args, ctx) => {
    if (!args.length) return { out: '', err: 'mkdir: 缺少目录名', code: 1 };
    for (const a of args) {
      const slash = a.lastIndexOf('/');
      const parentStr = slash >= 0 ? a.slice(0, slash) || '/' : '.';
      const base = slash >= 0 ? a.slice(slash + 1) : a;
      const parentId = resolvePath(ctx.cwd, parentStr);
      if (!parentId || getNode(parentId)?.type !== 'dir') return { out: '', err: `mkdir: ${parentStr}: 目录不存在`, code: 1 };
      createDir(parentId, base);
    }
    return { out: '', code: 0 };
  },

  touch: (args, ctx) => {
    if (!args.length) return { out: '', err: 'touch: 缺少文件名', code: 1 };
    for (const a of args) {
      const slash = a.lastIndexOf('/');
      const parentStr = slash >= 0 ? a.slice(0, slash) || '/' : '.';
      const base = slash >= 0 ? a.slice(slash + 1) : a;
      const parentId = resolvePath(ctx.cwd, parentStr);
      if (!parentId || getNode(parentId)?.type !== 'dir') return { out: '', err: `touch: ${parentStr}: 目录不存在`, code: 1 };
      if (!children(parentId).some((n) => n.name === base)) createFile(parentId, base, '');
    }
    return { out: '', code: 0 };
  },

  rm: (args, ctx) => {
    const { rest } = splitFlags(args);
    if (!rest.length) return { out: '', err: 'rm: 缺少操作对象', code: 1 };
    for (const a of rest) {
      const id = resolvePath(ctx.cwd, a);
      if (!id || !getNode(id)) return { out: '', err: `rm: ${a}: 没有那个文件或目录`, code: 1 };
      if (id === 'root') return { out: '', err: 'rm: 不能删除根目录', code: 1 };
      trash(id); // 软删除 → 进回收站
    }
    return { out: '', code: 0 };
  },

  mv: (args, ctx) => {
    if (args.length < 2) return { out: '', err: 'mv: 用法 mv <源> <目标>', code: 1 };
    const srcId = resolvePath(ctx.cwd, args[0]);
    if (!srcId || !getNode(srcId)) return { out: '', err: `mv: ${args[0]}: 没有那个文件`, code: 1 };
    if (srcId === 'root') return { out: '', err: 'mv: 不能移动根目录', code: 1 };
    const dstId = resolvePath(ctx.cwd, args[1]);
    if (dstId && getNode(dstId)?.type === 'dir') {
      move(srcId, dstId); // 目标是已存在目录 → 移进去
      return { out: '', code: 0 };
    }
    // 否则当作重命名（取目标 basename，移到其父目录）
    const slash = args[1].lastIndexOf('/');
    const parentStr = slash >= 0 ? args[1].slice(0, slash) || '/' : '.';
    const base = slash >= 0 ? args[1].slice(slash + 1) : args[1];
    const parentId = resolvePath(ctx.cwd, parentStr);
    if (!parentId || getNode(parentId)?.type !== 'dir') return { out: '', err: `mv: ${parentStr}: 目录不存在`, code: 1 };
    if (parentId !== getNode(srcId)!.parentId) move(srcId, parentId);
    rename(srcId, base);
    return { out: '', code: 0 };
  },

  cp: (args, ctx) => {
    if (args.length < 2) return { out: '', err: 'cp: 用法 cp <源文件> <目标>', code: 1 };
    const srcId = resolvePath(ctx.cwd, args[0]);
    const src = srcId ? getNode(srcId) : undefined;
    if (!src) return { out: '', err: `cp: ${args[0]}: 没有那个文件`, code: 1 };
    if (src.type !== 'file' || src.kind === 'binary') return { out: '', err: 'cp: 暂只支持复制文本文件', code: 1 };
    const dstId = resolvePath(ctx.cwd, args[1]);
    if (dstId && getNode(dstId)?.type === 'dir') {
      createFile(dstId, src.name, src.content);
      return { out: '', code: 0 };
    }
    const slash = args[1].lastIndexOf('/');
    const parentStr = slash >= 0 ? args[1].slice(0, slash) || '/' : '.';
    const base = slash >= 0 ? args[1].slice(slash + 1) : args[1];
    const parentId = resolvePath(ctx.cwd, parentStr);
    if (!parentId || getNode(parentId)?.type !== 'dir') return { out: '', err: `cp: ${parentStr}: 目录不存在`, code: 1 };
    createFile(parentId, base, src.content);
    return { out: '', code: 0 };
  },

  apps: () => ({
    out: appList
      .filter((a) => !a.hidden)
      .map((a) => `${a.icon} ${a.id.padEnd(12)} ${a.title}`)
      .join('\n'),
    code: 0,
  }),

  open: (args, ctx) => {
    const target = args[0];
    if (!target) return { out: '', err: 'open: 缺少 App id 或文件路径', code: 1 };
    if (appMeta[target]) {
      sys.openApp(target);
      return { out: `已启动 ${appMeta[target].title}`, code: 0 };
    }
    const id = resolvePath(ctx.cwd, target);
    const n = id ? getNode(id) : undefined;
    if (!n) return { out: '', err: `open: ${target}: 不是 App 也不是文件`, code: 1 };
    if (n.type === 'dir') {
      sys.openApp('files', { data: n.id });
      return { out: `已在文件管理器打开 ${n.name}`, code: 0 };
    }
    sys.openApp(isImage(n) ? 'imageviewer' : 'textedit', { title: n.name, data: n.id });
    return { out: `已打开 ${n.name}`, code: 0 };
  },

  ps: () => {
    const lines = sys.proc.list().map((p) => {
      const state = p.minimized ? '已最小化' : '运行中';
      return `${String(p.pid).padStart(4)}  ${p.appId.padEnd(12)} ${state}  ${p.title}`;
    });
    return { out: '  PID  APP          STATE     TITLE\n' + lines.join('\n'), code: 0 };
  },

  kill: (args) => {
    const pid = Number(args[0]);
    if (!pid) return { out: '', err: 'kill: 用法 kill <pid>', code: 1 };
    const p = sys.proc.list().find((q) => q.pid === pid);
    if (!p) return { out: '', err: `kill: (${args[0]}): 没有那个进程`, code: 1 };
    sys.proc.close(p.id);
    return { out: '', code: 0 };
  },

  theme: (args) => {
    const a = args[0];
    if (a === 'dark' || a === 'light') {
      sys.ui.setTheme({ mode: a });
      return { out: `主题已切到${a === 'dark' ? '暗色' : '亮色'}`, code: 0 };
    }
    if (a && /^#[0-9a-fA-F]{6}$/.test(a)) {
      sys.ui.setTheme({ accent: a });
      return { out: `主色已设为 ${a}`, code: 0 };
    }
    return { out: `当前：${settings.mode} / 主色 ${settings.accent}\n用法：theme dark|light 或 theme #8b5cf6`, code: 0 };
  },

  // ── 文本处理（配合管道）─────────────────────────────
  grep: (args, ctx, stdin) => {
    const { flags, rest } = splitFlags(args); // i=忽略大小写 n=行号 r=递归
    const pattern = rest[0];
    if (pattern == null) return { out: '', err: 'grep: 用法 grep [-inr] 模式 [文件...]', code: 2 };
    const files = rest.slice(1);
    let re: RegExp | null = null;
    try {
      re = new RegExp(pattern, flags.has('i') ? 'i' : '');
    } catch {
      re = null; // 非法正则 → 退化为字面量匹配
    }
    const test = (line: string) =>
      re
        ? re.test(line)
        : flags.has('i')
          ? line.toLowerCase().includes(pattern.toLowerCase())
          : line.includes(pattern);
    const results: string[] = [];
    let matched = false;
    const scan = (text: string, prefix: string) => {
      toLines(text).forEach((ln, i) => {
        if (test(ln)) {
          matched = true;
          results.push((prefix ? prefix + ':' : '') + (flags.has('n') ? i + 1 + ':' : '') + ln);
        }
      });
    };
    if (!files.length) {
      scan(stdin, '');
    } else {
      const targets: { path: string; text: string }[] = [];
      for (const f of files) {
        const id = resolvePath(ctx.cwd, f);
        const n = id ? getNode(id) : undefined;
        if (!id || !n) return { out: results.join('\n'), err: `grep: ${f}: 没有那个文件或目录`, code: 2 };
        if (n.type === 'dir') {
          if (flags.has('r')) {
            for (const d of walk(id)) if (d.type === 'file' && d.kind !== 'binary') targets.push({ path: pathOf(d.id), text: d.content });
          } else return { out: results.join('\n'), err: `grep: ${f}: 是一个目录`, code: 2 };
        } else targets.push({ path: f, text: n.kind === 'binary' ? '' : n.content });
      }
      const multi = targets.length > 1 || flags.has('r'); // 递归模式总带文件名前缀（同 grep -r）
      for (const t of targets) scan(t.text, multi ? t.path : '');
    }
    return { out: results.join('\n'), code: matched ? 0 : 1 }; // 有匹配 0、无匹配 1（同 grep）
  },

  find: (args, ctx) => {
    let startPath = '.';
    let nameGlob: string | null = null;
    let typeFilter: string | null = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-name') nameGlob = args[++i] ?? null;
      else if (a === '-type') typeFilter = args[++i] ?? null;
      else if (!a.startsWith('-')) startPath = a;
    }
    const startId = resolvePath(ctx.cwd, startPath);
    const start = startId ? getNode(startId) : undefined;
    if (!start || !startId) return { out: '', err: `find: ${startPath}: 没有那个文件或目录`, code: 1 };
    const re = nameGlob ? globToRe(nameGlob) : null;
    const out: string[] = [];
    const consider = (n: VNode) => {
      if (typeFilter === 'f' && n.type !== 'file') return;
      if (typeFilter === 'd' && n.type !== 'dir') return;
      if (re && !re.test(n.name)) return;
      out.push(pathOf(n.id));
    };
    consider(start);
    for (const d of walk(startId)) consider(d);
    return { out: out.join('\n'), code: 0 };
  },

  wc: (args, ctx, stdin) => {
    const { flags, rest } = splitFlags(args); // l=行 w=词 c=字符
    const r = inputText(ctx, rest[0] ?? null, stdin);
    if (r.err) return { out: '', err: `wc: ${r.err}`, code: 1 };
    const text = r.text ?? '';
    const lines = toLines(text).length;
    const words = (text.match(/\S+/g) || []).length;
    const chars = text.length;
    const showAll = !flags.has('l') && !flags.has('w') && !flags.has('c');
    const nums: number[] = [];
    if (showAll || flags.has('l')) nums.push(lines);
    if (showAll || flags.has('w')) nums.push(words);
    if (showAll || flags.has('c')) nums.push(chars);
    return { out: nums.join('\t') + (rest[0] ? ' ' + rest[0] : ''), code: 0 };
  },

  head: (args, ctx, stdin) => {
    const { count, file } = parseCountAndFile(args, 10);
    const r = inputText(ctx, file, stdin);
    if (r.err) return { out: '', err: `head: ${r.err}`, code: 1 };
    return { out: toLines(r.text ?? '').slice(0, count).join('\n'), code: 0 };
  },

  tail: (args, ctx, stdin) => {
    const { count, file } = parseCountAndFile(args, 10);
    const r = inputText(ctx, file, stdin);
    if (r.err) return { out: '', err: `tail: ${r.err}`, code: 1 };
    const lines = toLines(r.text ?? '');
    return { out: lines.slice(Math.max(0, lines.length - count)).join('\n'), code: 0 };
  },

  sort: (args, ctx, stdin) => {
    const { flags, rest } = splitFlags(args); // r=逆序 n=数值
    const r = inputText(ctx, rest[0] ?? null, stdin);
    if (r.err) return { out: '', err: `sort: ${r.err}`, code: 1 };
    const lines = toLines(r.text ?? '');
    if (flags.has('n')) lines.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
    else lines.sort((a, b) => a.localeCompare(b, 'zh'));
    if (flags.has('r')) lines.reverse();
    return { out: lines.join('\n'), code: 0 };
  },

  uniq: (args, ctx, stdin) => {
    const { flags, rest } = splitFlags(args); // c=计数前缀
    const r = inputText(ctx, rest[0] ?? null, stdin);
    if (r.err) return { out: '', err: `uniq: ${r.err}`, code: 1 };
    const out: string[] = [];
    let prev: string | null = null;
    let count = 0;
    for (const ln of toLines(r.text ?? '')) {
      if (ln === prev) count++;
      else {
        if (prev !== null) out.push(flags.has('c') ? `${count} ${prev}` : prev);
        prev = ln;
        count = 1;
      }
    }
    if (prev !== null) out.push(flags.has('c') ? `${count} ${prev}` : prev);
    return { out: out.join('\n'), code: 0 };
  },

  cut: (args, ctx, stdin) => {
    let delim = '\t';
    let fieldsSpec: string | null = null;
    let file: string | null = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-d') delim = args[++i] ?? '\t';
      else if (a.startsWith('-d')) delim = a.slice(2);
      else if (a === '-f') fieldsSpec = args[++i] ?? null;
      else if (a.startsWith('-f')) fieldsSpec = a.slice(2);
      else if (!a.startsWith('-')) file = a;
    }
    if (!fieldsSpec) return { out: '', err: 'cut: 需要用 -f 指定字段（如 -f1 或 -f1,3）', code: 2 };
    const fields = fieldsSpec.split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0);
    const r = inputText(ctx, file, stdin);
    if (r.err) return { out: '', err: `cut: ${r.err}`, code: 1 };
    const out = toLines(r.text ?? '').map((ln) => {
      const parts = ln.split(delim);
      return fields.map((f) => parts[f - 1] ?? '').join(delim);
    });
    return { out: out.join('\n'), code: 0 };
  },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

// 按分隔符切分，但尊重引号（管道 | 不在引号里才算分隔）。保留引号交给 tokenize 去剥。
function splitTopLevel(line: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  for (const c of line) {
    if (q) {
      cur += c;
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      cur += c;
      q = c;
    } else if (c === sep) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

// 把粘连的重定向算符从 token 里拆出来：>foo → > foo、2>err → 2> err、<in → < in。
// ⚠️ 本身就是算符的 token（如裸 `>>`）原样保留——否则正则会回溯把 `>>` 拆成 `>` `>`。
const REDIR_OPS = ['2>', '>>', '>', '<'];
function splitRedirToks(toks: string[]): string[] {
  const out: string[] = [];
  for (const t of toks) {
    if (REDIR_OPS.includes(t)) {
      out.push(t);
      continue;
    }
    const m = /^(2>|>>|>|<)(.+)$/.exec(t);
    if (m) out.push(m[1], m[2]);
    else out.push(t);
  }
  return out;
}

interface Redir {
  in: string | null;
  out: string | null;
  append: boolean;
  err: string | null;
}

// 从一段命令的 token 里抽出重定向，返回 [纯命令 token, 重定向, 语法错误?]
function extractRedirs(toks: string[]): { rest: string[]; redir: Redir; error?: string } {
  const redir: Redir = { in: null, out: null, append: false, err: null };
  const rest: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '<' || t === '>' || t === '>>' || t === '2>') {
      const file = toks[++i];
      if (file == null) return { rest, redir, error: 'qzsh: 语法错误：重定向缺少目标文件' };
      if (t === '<') redir.in = file;
      else if (t === '2>') redir.err = file;
      else {
        redir.out = file;
        redir.append = t === '>>';
      }
    } else rest.push(t);
  }
  return { rest, redir };
}

// 执行一行（可含管道 | 与重定向 < > >> 2>）。改 ctx.cwd/env/code 由调用方按返回值落地。
export function run(line: string, ctx: ShellCtx): CmdResult {
  const trimmed = line.trim();
  if (!trimmed) return { out: '', code: 0 };

  const segments = splitTopLevel(trimmed, '|').map((s) => s.trim());
  if (segments.some((s) => s === '')) return { out: '', err: 'qzsh: 语法错误：管道 | 两侧都需要命令', code: 2 };

  let stdin = ''; // 流向当前段的输入（上游 stdout 或 < 文件）
  let pipedOut = ''; // 最近一段未被重定向的 stdout（最终显示用）
  let lastRedirectedOut = false;
  const errAccum: string[] = [];
  let code = 0;
  let cd: string | undefined;
  let clear = false;

  for (const seg of segments) {
    const toks = splitRedirToks(tokenize(seg)).map((t) => subst(t, ctx));
    const { rest, redir, error } = extractRedirs(toks);
    if (error) return { out: '', err: error, code: 2 };

    const [cmd, ...args] = rest;
    if (!cmd) return { out: '', err: 'qzsh: 语法错误：空命令', code: 2 };
    const fn = COMMANDS[cmd];
    if (!fn) {
      errAccum.push(`qzsh: ${cmd}: 未找到命令`);
      code = 127;
      pipedOut = '';
      lastRedirectedOut = false;
      break;
    }

    // 输入：< 文件优先于管道 stdin
    let stageStdin = stdin;
    if (redir.in != null) {
      const id = resolvePath(ctx.cwd, redir.in);
      const n = id ? getNode(id) : undefined;
      if (!n || n.type !== 'file') {
        errAccum.push(`qzsh: ${redir.in}: 没有那个文件`);
        code = 1;
        pipedOut = '';
        lastRedirectedOut = false;
        break;
      }
      stageStdin = n.kind === 'binary' ? '' : n.content;
    }

    const res = fn(args, ctx, stageStdin);
    code = res.code;
    if (res.cd) cd = res.cd;
    if (res.clear) clear = true;

    // stderr：2> 写文件，否则累积显示
    if (res.err) {
      if (redir.err != null) {
        const e = writeToPath(ctx, redir.err, res.err, false);
        if (e) errAccum.push(e);
      } else errAccum.push(res.err);
    }

    // stdout：> / >> 写文件（不再下游），否则作为下游 stdin + 候选最终输出
    if (redir.out != null) {
      if (res.code === 0) {
        const e = writeToPath(ctx, redir.out, res.out, redir.append);
        if (e) {
          errAccum.push(e);
          code = 1;
        }
      }
      stdin = '';
      pipedOut = '';
      lastRedirectedOut = true;
    } else {
      stdin = res.out;
      pipedOut = res.out;
      lastRedirectedOut = false;
    }
  }

  return {
    out: lastRedirectedOut ? '' : pipedOut,
    err: errAccum.length ? errAccum.join('\n') : undefined,
    code,
    cd,
    clear,
  };
}
