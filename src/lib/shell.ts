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
  isMedia,
  setMode,
  setOwner,
  DEFAULT_OWNER,
  type VNode,
} from '../kernel/vfs.svelte';
import { nodeMode, modeStr, permits } from '../system/permissions';
import { sys } from '../system/sys';
import { appList, appMeta } from '../apps/appList';
import { settings } from '../system/settings.svelte';
import { isVirtualPath, virtualList, virtualRead, virtualStat, normAbs, VIRTUAL_MOUNTS } from '../system/vfsVirtual';
import { users, getUser, userExists, addUser, passwdContent } from '../system/users.svelte';
import {
  listServices,
  startService,
  stopService,
  restartService,
  enableService,
  disableService,
} from '../kernel/services.svelte';
import { MAN } from './man';
import { repoConfig, fetchCatalog, installCatalogApp } from '../system/appRepo.svelte';
import { currentUser } from '../system/account.svelte';
import { complete } from '../system/ai';
import { aliases, setAlias, removeAlias } from '../system/shellPrefs.svelte';
import { jobs, addJob, finishJob } from '../system/jobs.svelte';

export interface ShellCtx {
  cwd: string; // 当前目录节点 id
  env: Record<string, string>; // 环境变量
  code: number; // 上次命令退出码（$?）
  pid: number; // 终端自身的进程 pid（给 open 启动的子进程设 ppid；0=未知）
}

export interface CmdResult {
  out: string;
  err?: string;
  code: number;
  cd?: string; // 命令要求切换 cwd（cd）
  clear?: boolean; // 命令要求清屏（clear）
}

export function newCtx(): ShellCtx {
  const user = currentUser(); // 登录账号 → 就是你；否则访客 qiezi
  return {
    cwd: 'root',
    env: { USER: user, HOME: user === 'root' ? '/root' : '/', SHELL: 'qzsh', HOSTNAME: 'qiezios', PATH: '/bin' },
    code: 0,
    pid: 0,
  };
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
    if (!permits(existing, ctx.env.USER, 2)) return `${base}: 权限不够`;
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
  // 夹到非负：`head -n -5` 这种负数会让 slice(0,-5) 退化成「除末 5 行外全部」的错误语义
  return { count: Math.max(0, count), file };
}

// test / [ ] 的条件求值（给 if/while 用）。bit：-f/-d/-e 查文件；字符串/数值比较；前导 ! 取反。
function evalTest(args: string[], ctx: ShellCtx): boolean {
  if (args[0] === '!') return !evalTest(args.slice(1), ctx);
  if (args.length === 0) return false;
  if (args.length === 1) return args[0] !== ''; // 单参：非空字符串为真
  if (args.length === 2) {
    const [op, val] = args;
    if (op === '-z') return val === '';
    if (op === '-n') return val !== '';
    if (op === '-e' || op === '-f' || op === '-d') {
      const id = resolvePath(ctx.cwd, val);
      const n = id ? getNode(id) : undefined;
      if (!n) return false;
      if (op === '-d') return n.type === 'dir';
      if (op === '-f') return n.type === 'file';
      return true; // -e：存在即可
    }
    return false;
  }
  if (args.length === 3) {
    const [a, op, b] = args;
    if (op === '=' || op === '==') return a === b;
    if (op === '!=') return a !== b;
    if (op === '-eq') return Number(a) === Number(b);
    if (op === '-ne') return Number(a) !== Number(b);
    if (op === '-lt') return Number(a) < Number(b);
    if (op === '-le') return Number(a) <= Number(b);
    if (op === '-gt') return Number(a) > Number(b);
    if (op === '-ge') return Number(a) >= Number(b);
    return false;
  }
  return false;
}

// ── 终端定时辅助（at/crontab 用）─────────────────────────────
// 解析延时/间隔：+10s / 5m / 1h / 30（裸数字=秒）。返回毫秒，非法返回 null。
function parseDelay(spec: string): number | null {
  const m = /^\+?(\d+)([smh]?)$/.exec((spec ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  return n * (unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000);
}
// 把毫秒格式化成 3s / 5m / 1h（整除才用大单位）。
function fmtDur(ms: number): string {
  if (ms >= 3600000 && ms % 3600000 === 0) return `${ms / 3600000}h`;
  if (ms >= 60000 && ms % 60000 === 0) return `${ms / 60000}m`;
  return `${Math.round(ms / 1000)}s`;
}
// 列出有 command 的定时任务（at=一次性、crontab=循环），按 filter 过滤。
function listSchedCmds(filter: (s: { every?: number }) => boolean): CmdResult {
  const items = sys.schedule.list().filter((s) => s.command && filter(s));
  if (!items.length) return { out: '（无定时任务）', code: 0 };
  const lines = items.map((s) => {
    const when = s.every ? `每 ${fmtDur(s.every)}` : s.fireAt ? new Date(s.fireAt).toLocaleTimeString() : '?';
    return `[${s.id}]  ${when}\t${s.command}`;
  });
  return { out: lines.join('\n'), code: 0 };
}
// 取消一个定时命令（只取消符合 filter 的命令型任务，不误删提醒）。
function cancelSchedCmd(id: string | undefined, filter: (s: { every?: number }) => boolean): CmdResult {
  if (!id) return { out: '', err: '用法：-r <id>', code: 2 };
  const s = sys.schedule.list().find((x) => x.id === id && x.command && filter(x));
  if (!s) return { out: '', err: `没有这个定时任务 [${id}]`, code: 1 };
  sys.schedule.cancel(id);
  return { out: `已取消 [${id}]`, code: 0 };
}

// 把（可能相对的）路径参数解析成规范绝对路径串。cwd 永远是真实节点 → 用 pathOf 取其绝对路径。
function toAbsPath(ctx: ShellCtx, path: string): string {
  if (path.startsWith('/')) return normAbs(path);
  const base = pathOf(ctx.cwd);
  return normAbs((base === '/' ? '' : base) + '/' + path);
}

// 权限判定（nodeMode/modeStr/permits）已抽到 system/permissions.ts，终端与 GUI 共用一套。

// 命令收到上游/重定向来的 stdin（无则空串），返回 stdout/stderr/退出码（可同步或异步——curl 等用 Promise）
type CmdFn = (args: string[], ctx: ShellCtx, stdin: string) => CmdResult | Promise<CmdResult>;

let sourceDepth = 0; // source 嵌套深度（防循环 source 把栈打爆）

// 信号号 → 名（kill -9 等）。本系统映射：TERM/KILL/HUP/INT→关闭，STOP→挂起，CONT→恢复
const SIGNALS: Record<number, string> = { 1: 'HUP', 2: 'INT', 9: 'KILL', 15: 'TERM', 18: 'CONT', 19: 'STOP' };

const COMMANDS: Record<string, CmdFn> = {
  help: (args, ctx, stdin) => {
    if (args.length) return COMMANDS.man(args, ctx, stdin); // help <命令> = man <命令>
    return {
    out:
      '可用命令：\n' +
      '  pwd ls cd cat echo  —— 浏览/查看\n' +
      '  mkdir touch rm mv cp —— 文件操作\n' +
      '  chmod chown stat     —— 权限/属主（ls -l 看权限）\n' +
      '  whoami id su sudo useradd users —— 用户/账户\n' +
      '  open apps ps pstree kill[-9/-STOP/-CONT] —— 应用/进程\n' +
      '  cmd & · jobs · fg [n] · bg · wait —— 后台作业\n' +
      '  at +<N>[s|m|h] <命令> · atq · crontab <间隔> <命令> —— 终端定时\n' +
      '  systemctl [list|status|start|stop|enable|disable] —— 后台服务\n' +
      '  pkg [list|search|install|repo] —— 远程 App 仓库（apt 式）\n' +
      '  curl[-i/-I] fetch hostname —— 网络（受浏览器 CORS 限制）\n' +
      '  ai <问题> —— 命令行问 AI（可管道喂入）\n' +
      '  grep find wc head tail sort uniq cut —— 文本处理（配合管道）\n' +
      '  env export unset alias unalias which source(.) —— 环境/配置\n' +
      '  if/then/fi · for…in…do…done · while · test/[ ] · sh 脚本.sh —— 脚本/控制流\n' +
      '  date theme clear  man <命令>（详细用法）\n' +
      '支持：$VAR 变量、" " 引号、管道 | 、重定向 > >> < 2>、; && || 序列、末尾 & 后台。\n' +
      '/etc/profile 在每次开终端时执行（改它=持久化你的 export/别名）。\n' +
      '虚拟文件系统（只读）：ls /proc（进程）、cat /proc/<pid>/status、ls /dev、cat /dev/clipboard。\n' +
      '试试：man ls  /  ls /proc  /  cat /dev/clipboard  /  ls | grep txt',
      code: 0,
    };
  },
  // man：查看命令手册页（man <命令>），无参数列出所有手册页
  man: (args) => {
    const name = args[0];
    if (!name) return { out: '有手册页的命令：\n' + Object.keys(MAN).sort().join('  ') + '\n\n用法：man <命令>', code: 0 };
    const p = MAN[name];
    if (!p) return { out: '', err: `man: 没有 ${name} 的手册页（试试 man 看列表）`, code: 1 };
    return {
      out: `NAME\n    ${name} — ${p.title}\n\nSYNOPSIS\n    ${p.syn}\n\nDESCRIPTION\n    ${p.desc}`,
      code: 0,
    };
  },

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
  unset: (args, ctx) => {
    for (const k of args) delete ctx.env[k];
    return { out: '', code: 0 };
  },
  // 别名：alias（列出）/ alias 名=值（定义，持久化）/ alias 名（查一条）
  alias: (args) => {
    if (!args.length) {
      const lines = Object.entries(aliases.map).map(([k, v]) => `alias ${k}='${v}'`);
      return { out: lines.join('\n'), code: 0 };
    }
    const joined = args.join(' ');
    const eq = joined.indexOf('=');
    if (eq < 0) {
      const v = aliases.map[joined];
      return v ? { out: `alias ${joined}='${v}'`, code: 0 } : { out: '', err: `alias: ${joined}: 未定义`, code: 1 };
    }
    const name = joined.slice(0, eq).trim();
    const value = joined.slice(eq + 1).trim();
    if (!name) return { out: '', err: 'alias: 用法 alias 名=值（如 alias ll=\'ls -l\'）', code: 2 };
    setAlias(name, value);
    return { out: '', code: 0 };
  },
  unalias: (args) => {
    if (!args.length) return { out: '', err: 'unalias: 用法 unalias <名>', code: 2 };
    for (const a of args) removeAlias(a);
    return { out: '', code: 0 };
  },
  // test / [ … ]：条件判断，返回退出码（0=真 1=假）。给 if/while 用。
  test: (args, ctx) => ({ out: '', code: evalTest(args, ctx) ? 0 : 1 }),
  '[': (args, ctx) => {
    if (args[args.length - 1] !== ']') return { out: '', err: '[: 缺少结尾 ]', code: 2 };
    return { out: '', code: evalTest(args.slice(0, -1), ctx) ? 0 : 1 };
  },
  // which：命令在不在「PATH」里（内置命令一律算在 PATH 第一段下）
  which: (args, ctx) => {
    if (!args.length) return { out: '', err: 'which: 用法 which <命令>', code: 2 };
    const bin = (ctx.env.PATH || '/bin').split(':')[0] || '/bin';
    const outs: string[] = [];
    let allFound = true;
    for (const c of args) {
      if (COMMAND_NAMES.includes(c)) outs.push(`${bin}/${c}`);
      else allFound = false;
    }
    return { out: outs.join('\n'), code: allFound ? 0 : 1 };
  },
  // source / . ：读一个文件并执行（rc/profile/脚本用）。整文件交给 run（支持多行控制流）+ 共享 ctx。
  source: async (args, ctx) => {
    const f = args[0];
    if (!f) return { out: '', err: 'source: 用法 source <文件>', code: 2 };
    if (sourceDepth >= 25) return { out: '', err: 'source: 嵌套过深（疑似循环）', code: 1 };
    const r = readFileText(ctx, f);
    if (r.err) return { out: '', err: `source: ${r.err}`, code: 1 };
    sourceDepth++;
    try {
      return await run(r.text ?? '', ctx); // 整文件解释执行（多行 if/for/while 都能跨行）
    } finally {
      sourceDepth--;
    }
  },
  '.': (args, ctx, stdin) => COMMANDS.source(args, ctx, stdin), // `.` 是 source 的别名
  sh: (args, ctx, stdin) => COMMANDS.source(args, ctx, stdin), // sh <脚本> 跑脚本文件（同 source）

  ls: (args, ctx) => {
    const { flags, rest } = splitFlags(args);
    const arg = rest[0] ?? '.';
    const abs = toAbsPath(ctx, arg);

    // 虚拟挂载（/proc、/dev）
    if (isVirtualPath(abs)) {
      const stat = virtualStat(abs);
      if (stat === null) return { out: '', err: `ls: ${arg}: 没有那个文件或目录`, code: 2 };
      if (stat === 'file') return { out: abs.split('/').pop() ?? abs, code: 0 };
      const entries = virtualList(abs) ?? [];
      if (flags.has('l'))
        return {
          out: entries.map((e) => `${e.type === 'dir' ? 'd' : '-'}  (虚拟)  ${e.name}${e.type === 'dir' ? '/' : ''}`).join('\n'),
          code: 0,
        };
      return { out: entries.map((e) => (e.type === 'dir' ? e.name + '/' : e.name)).join('  '), code: 0 };
    }

    const targetId = resolvePath(ctx.cwd, arg);
    if (!targetId) return { out: '', err: `ls: ${arg}: 没有那个文件或目录`, code: 2 };
    const node = getNode(targetId);
    if (!node) return { out: '', err: 'ls: 无效路径', code: 2 };
    const items = node.type === 'dir' ? children(targetId) : [node];
    // 列根目录时把虚拟挂载点也显示出来（proc/ dev/），方便发现；跳过与真实同名项避免重复
    const existing = new Set(items.map((n) => n.name));
    const mounts =
      targetId === 'root' && node.type === 'dir'
        ? VIRTUAL_MOUNTS.map((m) => m.slice(1)).filter((m) => !existing.has(m))
        : [];
    if (flags.has('l')) {
      const lines = items.map((n) => {
        const size = n.type === 'dir' ? '-' : String(n.kind === 'binary' ? (n.size ?? 0) : n.content.length);
        return `${modeStr(n)}  ${(n.owner ?? DEFAULT_OWNER).padEnd(6)}  ${size.padStart(7)}  ${fmtTime(n.updatedAt)}  ${n.name}${n.type === 'dir' ? '/' : ''}`;
      });
      for (const m of mounts) lines.push(`dr-xr-xr-x  root    ${'-'.padStart(7)}  ${m}/`);
      return { out: lines.join('\n'), code: 0 };
    }
    const names = items.map((n) => (n.type === 'dir' ? n.name + '/' : n.name));
    for (const m of mounts) names.push(m + '/');
    return { out: names.join('  '), code: 0 };
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
      const abs = toAbsPath(ctx, a);
      if (isVirtualPath(abs)) {
        const txt = virtualRead(abs);
        if (txt === null)
          return { out: parts.join('\n'), err: virtualStat(abs) === 'dir' ? `cat: ${a}: 是一个目录` : `cat: ${a}: 没有那个文件`, code: 1 };
        parts.push(txt);
        continue;
      }
      const id = resolvePath(ctx.cwd, a);
      const n = id ? getNode(id) : undefined;
      if (!n) return { out: parts.join('\n'), err: `cat: ${a}: 没有那个文件`, code: 1 };
      if (n.type === 'dir') return { out: parts.join('\n'), err: `cat: ${a}: 是一个目录`, code: 1 };
      if (!permits(n, ctx.env.USER, 4)) return { out: parts.join('\n'), err: `cat: ${a}: 权限不够`, code: 1 };
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
    // 目标已存在同名（排除自己）→ 拒绝，不像 bash 那样覆盖（避免同名并存路径不可达）。先查再动，免半移动。
    if (children(parentId).some((c) => c.id !== srcId && c.name === base)) {
      return { out: '', err: `mv: ${args[1]}: 目标已存在`, code: 1 };
    }
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
    const ppid = ctx.pid; // 由终端 open 启动 → 父进程是本终端
    if (appMeta[target]) {
      sys.openApp(target, { ppid });
      return { out: `已启动 ${appMeta[target].title}`, code: 0 };
    }
    const id = resolvePath(ctx.cwd, target);
    const n = id ? getNode(id) : undefined;
    if (!n) return { out: '', err: `open: ${target}: 不是 App 也不是文件`, code: 1 };
    if (n.type === 'dir') {
      sys.openApp('files', { data: n.id, ppid });
      return { out: `已在文件管理器打开 ${n.name}`, code: 0 };
    }
    const viewer = isImage(n) ? 'imageviewer' : isMedia(n) ? 'mediaviewer' : 'textedit';
    sys.openApp(viewer, { title: n.name, data: n.id, ppid });
    return { out: `已打开 ${n.name}`, code: 0 };
  },

  ps: () => {
    const lines = sys.proc.list().map((p) => {
      const state = p.minimized ? 'T(停)' : 'R(运行)';
      return `${String(p.pid).padStart(4)} ${String(p.ppid ?? 0).padStart(4)}  ${p.appId.padEnd(12)} ${state.padEnd(8)} ${p.title}`;
    });
    return { out: ' PID PPID  APP          STAT     TITLE\n' + lines.join('\n'), code: 0 };
  },

  // pstree：以 init(0) 为根画进程树
  pstree: () => {
    const procs = sys.proc.list();
    const out: string[] = ['init(0)'];
    const drawn = new Set<number>();
    const childrenOf = (ppid: number) => procs.filter((p) => (p.ppid ?? 0) === ppid);
    const draw = (ppid: number, prefix: string) => {
      const kids = childrenOf(ppid);
      kids.forEach((p, i) => {
        const last = i === kids.length - 1;
        drawn.add(p.pid);
        out.push(`${prefix}${last ? '└─ ' : '├─ '}${p.appId}(${p.pid})${p.minimized ? ' [停]' : ''}`);
        draw(p.pid, prefix + (last ? '   ' : '│  '));
      });
    };
    draw(0, '');
    // 孤儿（父进程已退出）：挂回 init 显示，避免遗漏（与任务管理器进程树一致）
    for (const p of procs)
      if (!drawn.has(p.pid)) out.push(`└─ ${p.appId}(${p.pid})${p.minimized ? ' [停]' : ''} [孤儿]`);
    return { out: out.join('\n'), code: 0 };
  },

  // jobs：把窗口进程当作作业列出（运行/停止）。本 shell 无 & 后台作业，这是简化视图。
  // jobs：列出本 shell 的后台作业（cmd & 启动的）。状态 Running/Done/Failed。
  jobs: () => {
    if (!jobs.list.length) return { out: '无后台作业', code: 0 };
    const label = (s: string) => (s === 'running' ? 'Running' : s === 'done' ? 'Done' : 'Failed');
    return {
      out: jobs.list.map((j) => `[${j.n}]  ${label(j.status)}\t${j.cmd}`).join('\n'),
      code: 0,
    };
  },
  // fg [n]：把后台作业「前台化」——等它完成并显示输出。无参取最近一个仍在跑的。
  fg: async (args) => {
    const running = jobs.list.filter((j) => j.status === 'running');
    const n = args[0] ? Number(args[0]) : (running[running.length - 1]?.n ?? jobs.list[jobs.list.length - 1]?.n);
    if (!n) return { out: '', err: 'fg: 没有作业', code: 1 };
    const p = bgPromises.get(n);
    if (!p) return { out: '', err: `fg: 没有作业 [${n}]`, code: 1 };
    const res = await p; // 阻塞等它跑完
    return { out: res.out, err: res.err, code: res.code };
  },
  // bg：本 shell 的后台作业本就异步在跑，无「停止态」可恢复 → 提示即可。
  bg: () => ({ out: '后台作业已在运行（本 shell 的 & 作业总是异步执行）', code: 0 }),
  // wait：等所有仍在跑的后台作业完成。
  wait: async () => {
    const ps = jobs.list.filter((j) => j.status === 'running').map((j) => bgPromises.get(j.n)).filter(Boolean);
    await Promise.all(ps as Promise<CmdResult>[]);
    return { out: '', code: 0 };
  },

  // ── 终端定时（对标 at/crontab）：到点经 schedd 服务跑 shell 命令 ──────────────
  // at +<N>[s|m|h] <命令>：一次性定时；at -l / atq 列出；at -r <id> 取消。
  at: (args) => {
    const sub = args[0];
    if (sub === '-l' || sub === '-q') return listSchedCmds((s) => !s.every);
    if (sub === '-r' || sub === '-d') return cancelSchedCmd(args[1], (s) => !s.every);
    const delay = parseDelay(sub ?? '');
    if (delay == null) return { out: '', err: 'at: 用法 at +<N>[s|m|h] <命令>  /  at -l  /  at -r <id>', code: 2 };
    const command = args.slice(1).join(' ').trim();
    if (!command) return { out: '', err: 'at: 缺少要执行的命令', code: 2 };
    const id = sys.schedule.add({ title: `at: ${command}`, in: delay, command });
    return { out: `已排程 [${id}]：${fmtDur(delay)}后执行  ${command}`, code: 0 };
  },
  atq: (args, ctx, stdin) => COMMANDS.at(['-l'], ctx, stdin), // at -l 的别名
  // crontab <间隔>[s|m|h] <命令>：循环定时；crontab -l 列出；crontab -r <id> 删除。
  crontab: (args) => {
    const sub = args[0];
    if (sub === '-l') return listSchedCmds((s) => !!s.every);
    if (sub === '-r' || sub === '-d') return cancelSchedCmd(args[1], (s) => !!s.every);
    const every = parseDelay(sub ?? '');
    if (every == null) return { out: '', err: 'crontab: 用法 crontab <间隔>[s|m|h] <命令>  /  crontab -l  /  crontab -r <id>', code: 2 };
    const command = args.slice(1).join(' ').trim();
    if (!command) return { out: '', err: 'crontab: 缺少要执行的命令', code: 2 };
    const id = sys.schedule.add({ title: `cron: ${command}`, every: Math.max(1000, every), command });
    return { out: `已添加循环任务 [${id}]：每 ${fmtDur(Math.max(1000, every))}执行  ${command}`, code: 0 };
  },

  // kill [-信号] <pid>：TERM/KILL/HUP/INT→关闭，STOP→挂起(最小化)，CONT→恢复
  kill: (args) => {
    let sig = 'TERM';
    const rest: string[] = [];
    for (const a of args) {
      if (a.startsWith('-') && a.length > 1) {
        const s = a.slice(1).toUpperCase().replace(/^SIG/, '');
        sig = /^\d+$/.test(s) ? SIGNALS[Number(s)] ?? 'TERM' : s;
      } else rest.push(a);
    }
    const pid = Number(rest[0]);
    if (!pid) return { out: '', err: 'kill: 用法 kill [-9|-STOP|-CONT|-TERM] <pid>', code: 1 };
    const p = sys.proc.list().find((q) => q.pid === pid);
    if (!p) return { out: '', err: `kill: (${rest[0]}): 没有那个进程`, code: 1 };
    if (sig === 'STOP') sys.proc.minimize(p.id);
    else if (sig === 'CONT') sys.proc.restore(p.id);
    else sys.proc.close(p.id); // TERM/KILL/HUP/INT/...
    return { out: '', code: 0 };
  },

  // systemctl：管理后台服务（init）。list/status/start/stop/restart/enable/disable
  systemctl: (args) => {
    const [sub, id] = args;
    const list = listServices();
    if (!sub || sub === 'list' || sub === 'list-units') {
      const lines = list.map(
        (s) =>
          `${s.id.padEnd(10)} ${s.status.padEnd(9)} ${s.name}` +
          (s.after.length || s.requires.length ? `  (after:${s.after.join(',') || '-'} requires:${s.requires.join(',') || '-'})` : ''),
      );
      return { out: 'UNIT       STATUS    NAME\n' + lines.join('\n'), code: 0 };
    }
    if (sub === 'status') {
      if (!id) return { out: '', err: 'systemctl status <服务>', code: 2 };
      const s = list.find((x) => x.id === id);
      if (!s) return { out: '', err: `systemctl: 找不到服务 ${id}`, code: 1 };
      return {
        out: [
          `● ${s.id} — ${s.name}`,
          `   状态: ${s.status}`,
          `   开机: ${s.status === 'disabled' ? 'disabled' : 'enabled'}`,
          `   重启: ${s.restarts}`,
          `   after: ${s.after.join(', ') || '-'}`,
          `   requires: ${s.requires.join(', ') || '-'}`,
        ].join('\n'),
        code: 0,
      };
    }
    if (!id) return { out: '', err: `systemctl ${sub} <服务>`, code: 2 };
    if (!list.some((x) => x.id === id)) return { out: '', err: `systemctl: 找不到服务 ${id}`, code: 1 };
    switch (sub) {
      case 'start':
        if (list.find((x) => x.id === id)?.status === 'disabled')
          return { out: '', err: `${id} 已禁用，先 systemctl enable ${id}`, code: 1 };
        startService(id);
        return { out: `已启动 ${id}`, code: 0 };
      case 'stop':
        stopService(id);
        return { out: `已停止 ${id}`, code: 0 };
      case 'restart':
        restartService(id);
        return { out: `已重启 ${id}`, code: 0 };
      case 'enable':
        enableService(id);
        return { out: `已设为开机启动 ${id}`, code: 0 };
      case 'disable':
        disableService(id);
        return { out: `已禁用并停止 ${id}`, code: 0 };
      default:
        return { out: '', err: `systemctl: 未知子命令 ${sub}（list/status/start/stop/restart/enable/disable）`, code: 2 };
    }
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

  // ── 包管理（远程 App 仓库，对标 apt）────────────────────
  pkg: async (args) => {
    const [sub, arg] = args;
    if (!sub || sub === 'help')
      return { out: 'pkg list / pkg search <词> / pkg install <id> / pkg repo [URL]', code: 0 };
    if (sub === 'repo') {
      if (arg) {
        repoConfig.url = arg;
        return { out: `仓库源已设为 ${arg}`, code: 0 };
      }
      return { out: repoConfig.url, code: 0 };
    }
    try {
      const cat = await fetchCatalog();
      if (sub === 'list' || sub === 'search') {
        let apps = cat.apps;
        if (sub === 'search' && arg) {
          const q = arg.toLowerCase();
          apps = apps.filter((a) => (a.id + a.name + (a.description ?? '')).toLowerCase().includes(q));
        }
        const lines = apps.map((a) => `${a.icon} ${a.id.padEnd(12)} ${a.name}${a.description ? ' — ' + a.description : ''}`);
        return { out: (cat.name ? cat.name + '\n' : '') + (lines.join('\n') || '（空）'), code: 0 };
      }
      if (sub === 'install') {
        if (!arg) return { out: '', err: 'pkg install <id>', code: 2 };
        const entry = cat.apps.find((a) => a.id === arg);
        if (!entry) return { out: '', err: `pkg: 仓库里没有 ${arg}`, code: 1 };
        installCatalogApp(entry);
        return { out: `已安装 ${entry.name}（在「我的 App」里启动）`, code: 0 };
      }
      return { out: '', err: `pkg: 未知子命令 ${sub}（list/search/install/repo）`, code: 2 };
    } catch (e) {
      return { out: '', err: `pkg: ${e instanceof Error ? e.message : String(e)}`, code: 1 };
    }
  },

  // ── 网络 ─────────────────────────────────────────────
  hostname: (_a, ctx) => ({ out: ctx.env.HOSTNAME || 'qiezios', code: 0 }),
  // curl：浏览器 fetch 一个 URL（受同源/CORS 限制，对 CORS 友好的端点可用）。-i 含状态行、-I 只看响应头
  curl: async (args) => {
    const { flags, rest } = splitFlags(args);
    const raw = rest[0];
    if (!raw) return { out: '', err: 'curl: 用法 curl [-i|-I] <url>', code: 2 };
    const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    try {
      const res = await fetch(url, { method: flags.has('I') ? 'HEAD' : 'GET' });
      const head = `HTTP ${res.status} ${res.statusText}`;
      if (flags.has('I')) {
        const hs = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
        return { out: head + (hs ? '\n' + hs : ''), code: res.ok ? 0 : 22 };
      }
      let body = await res.text();
      if (body.length > 20000) body = body.slice(0, 20000) + '\n…(已截断)';
      return { out: (flags.has('i') ? head + '\n\n' : '') + body, code: res.ok ? 0 : 22 };
    } catch (e) {
      return {
        out: '',
        err: `curl: (${url}) 请求失败：${e instanceof Error ? e.message : String(e)}（可能是 CORS 限制或网络不可达）`,
        code: 7,
      };
    }
  },
  fetch: (a, c, s) => COMMANDS.curl(a, c, s), // 别名
  // ai：在命令行问 AI（也可管道喂入，如 cat f | ai 总结）。和助手共用一个引擎。
  ai: async (args, _ctx, stdin) => {
    const prompt = [args.join(' ').trim(), stdin.trim()].filter(Boolean).join('\n\n');
    if (!prompt) return { out: '', err: 'ai: 用法 ai <问题>（或 管道喂入：cat f | ai 总结）', code: 2 };
    try {
      const ans = await complete(prompt, {});
      return { out: ans.trim(), code: 0 };
    } catch (e) {
      return { out: '', err: `ai: ${e instanceof Error ? e.message : String(e)}`, code: 1 };
    }
  },

  // ── 权限与所有权 ─────────────────────────────────────
  chmod: (args, ctx) => {
    if (args.length < 2) return { out: '', err: 'chmod: 用法 chmod <八进制如644> <路径...>', code: 2 };
    const modeArg = args[0];
    if (!/^[0-7]{3,4}$/.test(modeArg)) return { out: '', err: `chmod: ${modeArg}: 无效模式（用八进制，如 644 / 755 / 600）`, code: 1 };
    const mode = parseInt(modeArg, 8);
    for (const p of args.slice(1)) {
      const id = resolvePath(ctx.cwd, p);
      const n = id ? getNode(id) : undefined;
      if (!id || !n) return { out: '', err: `chmod: ${p}: 没有那个文件或目录`, code: 1 };
      setMode(id, mode);
    }
    return { out: '', code: 0 };
  },
  chown: (args, ctx) => {
    if (args.length < 2) return { out: '', err: 'chown: 用法 chown <用户> <路径...>', code: 2 };
    const owner = args[0];
    for (const p of args.slice(1)) {
      const id = resolvePath(ctx.cwd, p);
      const n = id ? getNode(id) : undefined;
      if (!id || !n) return { out: '', err: `chown: ${p}: 没有那个文件或目录`, code: 1 };
      setOwner(id, owner);
    }
    return { out: '', code: 0 };
  },
  stat: (args, ctx) => {
    const p = args[0];
    if (!p) return { out: '', err: 'stat: 用法 stat <路径>', code: 2 };
    const id = resolvePath(ctx.cwd, p);
    const n = id ? getNode(id) : undefined;
    if (!n) return { out: '', err: `stat: ${p}: 没有那个文件或目录`, code: 1 };
    const size = n.type === 'dir' ? 0 : n.kind === 'binary' ? (n.size ?? 0) : n.content.length;
    return {
      out: [
        `  文件: ${n.name}`,
        `  类型: ${n.type === 'dir' ? '目录' : n.kind === 'binary' ? '二进制文件' : '文本文件'}`,
        `  大小: ${size}`,
        `  权限: ${modeStr(n)}  (${nodeMode(n).toString(8).padStart(3, '0')})`,
        `  属主: ${n.owner ?? DEFAULT_OWNER}`,
        `  修改: ${fmtTime(n.updatedAt)}`,
        `  创建: ${fmtTime(n.createdAt)}`,
      ].join('\n'),
      code: 0,
    };
  },

  // ── 用户/账户 ────────────────────────────────────────
  id: (args, ctx) => {
    const name = args[0] || ctx.env.USER;
    const u = getUser(name);
    if (!u) return { out: '', err: `id: ${name}: 无此用户`, code: 1 };
    return { out: `uid=${u.uid}(${u.name}) gid=${u.gid}(${u.name})`, code: 0 };
  },
  users: () => ({ out: users.list.map((u) => u.name).join('  '), code: 0 }),
  // su：切换当前 shell 的身份（无密码，单机自托管隐喻）。无参 → root。
  su: (args, ctx) => {
    const target = args[0] || 'root';
    if (!userExists(target)) return { out: '', err: `su: 用户 ${target} 不存在`, code: 1 };
    ctx.env.USER = target;
    ctx.env.HOME = target === 'root' ? '/root' : '/';
    return { out: '', code: 0 };
  },
  // sudo：以 root 身份跑「一条简单命令」（跑完恢复原身份）。
  // 直接把已解析的 argv 派发给命令函数（不重新拼字符串 → 不二次分词/二次 $VAR 展开、保留引号、透传 stdin）。
  // 注：管道/重定向在外层 run 已先拆分，故 sudo 只提升其后的单条命令，符合预期。
  sudo: async (args, ctx, stdin) => {
    if (!args.length) return { out: '', err: 'sudo: 用法 sudo <命令>', code: 2 };
    const [cmd, ...rest] = args;
    const fn = COMMANDS[cmd];
    if (!fn) return { out: '', err: `sudo: ${cmd}: 未找到命令`, code: 127 };
    const prev = ctx.env.USER;
    ctx.env.USER = 'root';
    try {
      return await fn(rest, ctx, stdin); // await：异步命令完成后再在 finally 恢复身份
    } finally {
      ctx.env.USER = prev;
    }
  },
  useradd: (args, ctx) => {
    const name = args[0];
    if (!name) return { out: '', err: 'useradd: 用法 useradd <用户名>', code: 2 };
    if (ctx.env.USER !== 'root') return { out: '', err: 'useradd: 权限不够（试试 sudo useradd ...）', code: 1 };
    if (!/^[a-z_][a-z0-9_-]*$/i.test(name)) return { out: '', err: `useradd: 非法用户名 ${name}`, code: 1 };
    if (userExists(name)) return { out: '', err: `useradd: 用户 ${name} 已存在`, code: 1 };
    const u = addUser(name);
    ensureEtcPasswd();
    return { out: `已创建用户 ${name} (uid=${u.uid})`, code: 0 };
  },

  // ── 文本处理（配合管道）─────────────────────────────
  grep: (args, ctx, stdin) => {
    const { flags, rest } = splitFlags(args); // i=忽略大小写 n=行号 r=递归 v=反选
    const pattern = rest[0];
    if (pattern == null) return { out: '', err: 'grep: 用法 grep [-vinr] 模式 [文件...]', code: 2 };
    const files = rest.slice(1);
    let re: RegExp | null = null;
    try {
      re = new RegExp(pattern, flags.has('i') ? 'i' : '');
    } catch {
      re = null; // 非法正则 → 退化为字面量匹配
    }
    const invert = flags.has('v');
    const test = (line: string) => {
      const hit = re
        ? re.test(line)
        : flags.has('i')
          ? line.toLowerCase().includes(pattern.toLowerCase())
          : line.includes(pattern);
      return invert ? !hit : hit;
    };
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

// 确保 /etc/profile 存在（首次缺失就建一个带模板的）。返回其节点 id。
// 像真系统出厂自带 /etc/profile：终端启动会 source 它 → 用户改它即可持久化环境/启动命令。
const DEFAULT_PROFILE =
  '# /etc/profile —— 每次打开终端时自动执行（类似 /etc/profile + .bashrc）\n' +
  '# 在这里写 export 让环境变量对每个新终端生效，或放开机要跑的命令。\n' +
  '# 例：\n' +
  '#   export GREETING=你好\n' +
  '#   echo 欢迎回来，$USER\n';
export function ensureEtcProfile(): string | null {
  let etcId = resolvePath('root', '/etc');
  if (!etcId || getNode(etcId)?.type !== 'dir') etcId = createDir('root', 'etc');
  let profId = resolvePath('root', '/etc/profile');
  if (!profId || getNode(profId)?.type !== 'file') profId = createFile(etcId, 'profile', DEFAULT_PROFILE);
  return profId ?? null;
}

// 确保 /etc/passwd 存在且与用户表同步（每次开终端/新增用户时刷新）。是真实文件、随用户表更新。
export function ensureEtcPasswd(): void {
  ensureEtcProfile(); // 顺带保证 /etc 存在
  const etcId = resolvePath('root', '/etc');
  if (!etcId) return;
  const content = passwdContent();
  const pid = resolvePath('root', '/etc/passwd');
  const node = pid ? getNode(pid) : undefined;
  if (node?.type === 'file') {
    if (node.content !== content) writeFile(node.id, content);
  } else {
    createFile(etcId, 'passwd', content);
  }
}

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

// 把一行按顶层连接符 ; && || 切成「管道段 + 它前面的连接符」。尊重引号；单个 | 是管道（留给段内）。
function splitConnectors(line: string): { before: ';' | '&&' | '||' | null; cmd: string }[] {
  const segs: { before: ';' | '&&' | '||' | null; cmd: string }[] = [];
  let cur = '';
  let before: ';' | '&&' | '||' | null = null;
  let q: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const n = line[i + 1];
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      cur += c;
      q = c;
      continue;
    }
    if (c === ';') {
      segs.push({ before, cmd: cur });
      before = ';';
      cur = '';
      continue;
    }
    if (c === '&' && n === '&') {
      segs.push({ before, cmd: cur });
      before = '&&';
      cur = '';
      i++;
      continue;
    }
    if (c === '|' && n === '|') {
      segs.push({ before, cmd: cur });
      before = '||';
      cur = '';
      i++;
      continue;
    }
    cur += c; // 单个 | 是管道、单个 & 暂当普通字符（后台作业见 H4）
  }
  segs.push({ before, cmd: cur });
  return segs;
}

// 执行一条「语句」：先按 ; && || 切分顺序执行（短路），每段再交给 runPipeline 跑管道+重定向。
// 由脚本解释器（run/runScript）对每条叶子语句调用；语句内无 ;（已被 splitStatements 切走）。
async function runLine(line: string, ctx: ShellCtx): Promise<CmdResult> {
  const trimmed = line.trim();
  if (!trimmed) return { out: '', code: 0 };
  const segs = splitConnectors(trimmed);
  const outs: string[] = [];
  const errs: string[] = [];
  let lastCode = 0;
  let cd: string | undefined;
  let clear = false;
  let ran = false;
  for (const { before, cmd } of segs) {
    const c = cmd.trim();
    if (!c) continue; // 跳过空段（首/尾连接符）
    if (before === '&&' && lastCode !== 0) continue; // 前者失败 → 跳过
    if (before === '||' && lastCode === 0) continue; // 前者成功 → 跳过
    const res = await runPipeline(c, ctx);
    ran = true;
    lastCode = res.code;
    if (res.out) outs.push(res.out);
    if (res.err) errs.push(res.err);
    if (res.cd) {
      cd = res.cd;
      ctx.cwd = res.cd; // 立即落地 → 同一行后续段（如 cd d && pwd）能看到新 cwd
    }
    if (res.clear) clear = true;
  }
  if (!ran) return { out: '', code: 0 };
  return { out: outs.join('\n'), err: errs.length ? errs.join('\n') : undefined, code: lastCode, cd, clear };
}

// ── 脚本/控制流解释器（if/for/while + ; 与换行分句；叶子语句交给 runLine）──────────
type SNode =
  | { t: 'cmd'; text: string }
  | { t: 'if'; branches: { cond: string; body: SNode[] }[]; elseBody: SNode[] | null }
  | { t: 'for'; varName: string; words: string; body: SNode[] }
  | { t: 'while'; cond: string; body: SNode[] };

const CTRL_KW = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while']);

// 按 ; 与换行切成语句（尊重引号），trim、去空。
function splitStatements(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  for (const c of text) {
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      cur += c;
      q = c;
      continue;
    }
    if (c === ';' || c === '\n') {
      const t = cur.trim();
      if (t && !t.startsWith('#')) out.push(t); // 跳过整行注释
      cur = '';
      continue;
    }
    cur += c;
  }
  const last = cur.trim();
  if (last && !last.startsWith('#')) out.push(last);
  return out;
}
const firstWord = (s: string): string => (s ?? '').trim().split(/\s+/)[0] ?? '';
const afterWord = (s: string): string => (s ?? '').trim().replace(/^\S+\s*/, ''); // 去掉首词

// 语句列表 → AST（递归下降）。语法错误抛 Error。
function parseStatements(stmts: string[]): SNode[] {
  let p = 0;
  const IF_STOPS = new Set(['elif', 'else', 'fi']);
  const expect = (kw: string) => {
    if (firstWord(stmts[p] ?? '') !== kw) throw new Error(`缺少 ${kw}`);
  };
  // then/do/else 后面同一语句的内联内容：作为下一条语句重新注入解析（这样 `do if …`、`then for …`
  // 这种「内联起一个控制结构」也能正确递归解析，而不是被当成一条普通命令。
  const reinjectInline = (kw: string) => {
    expect(kw);
    const inline = afterWord(stmts[p]);
    p++;
    if (inline) stmts.splice(p, 0, inline);
  };
  const inlineThen = (kw: string, branches: { cond: string; body: SNode[] }[], cond: string) => {
    reinjectInline(kw); // 'then'
    branches.push({ cond, body: parseSeq(IF_STOPS) });
  };
  const inlineDoBody = (): SNode[] => {
    reinjectInline('do');
    return parseSeq(new Set(['done']));
  };
  function parseIf(): SNode {
    const cond0 = afterWord(stmts[p]);
    p++; // "if COND"
    const branches: { cond: string; body: SNode[] }[] = [];
    inlineThen('then', branches, cond0);
    while (firstWord(stmts[p] ?? '') === 'elif') {
      const c = afterWord(stmts[p]);
      p++;
      inlineThen('then', branches, c);
    }
    let elseBody: SNode[] | null = null;
    if (firstWord(stmts[p] ?? '') === 'else') {
      const inline = afterWord(stmts[p]);
      p++;
      if (inline) stmts.splice(p, 0, inline);
      elseBody = parseSeq(new Set(['fi']));
    }
    expect('fi');
    p++;
    return { t: 'if', branches, elseBody };
  }
  function parseFor(): SNode {
    const toks = (stmts[p] ?? '').trim().split(/\s+/);
    p++; // "for VAR in WORDS"
    const varName = toks[1] ?? '';
    const inIdx = toks.indexOf('in');
    if (!varName || inIdx < 1) throw new Error('for 语法：for 变量 in 词…; do … done');
    const words = toks.slice(inIdx + 1).join(' ');
    const body = inlineDoBody();
    expect('done');
    p++;
    return { t: 'for', varName, words, body };
  }
  function parseWhile(): SNode {
    const cond = afterWord(stmts[p]);
    p++;
    const body = inlineDoBody();
    expect('done');
    p++;
    return { t: 'while', cond, body };
  }
  function parseSeq(stops: Set<string>): SNode[] {
    const nodes: SNode[] = [];
    while (p < stmts.length) {
      const fw = firstWord(stmts[p]);
      if (stops.has(fw)) break;
      if (fw === 'if') nodes.push(parseIf());
      else if (fw === 'for') nodes.push(parseFor());
      else if (fw === 'while') nodes.push(parseWhile());
      else if (CTRL_KW.has(fw)) throw new Error(`意外的 ${fw}`);
      else {
        nodes.push({ t: 'cmd', text: stmts[p] });
        p++;
      }
    }
    return nodes;
  }
  const result = parseSeq(new Set());
  if (p < stmts.length) throw new Error(`意外的 ${firstWord(stmts[p])}`);
  return result;
}

// for 词表展开：subst $VAR + 按空白切 + glob（* ?）匹配 cwd
function expandWords(text: string, ctx: ShellCtx): string[] {
  if (!text.trim()) return [];
  const out: string[] = [];
  for (const t of tokenize(text).map((x) => subst(x, ctx))) {
    if (/[*?]/.test(t)) {
      const re = globToRe(t);
      const hits = children(ctx.cwd).filter((n) => re.test(n.name)).map((n) => n.name);
      out.push(...(hits.length ? hits : [t]));
    } else out.push(t);
  }
  return out;
}

const MAX_LOOP = 5000; // while/for 迭代上限（防失控；够交互用，又不至于卡死/堆爆输出）
const OUT_CAP = 100000; // 单次执行累计输出上限（字符）；超了就截断，防失控循环堆出几 MB

// 后台作业的 promise 表（作业号 → 该作业的执行 promise）。给 fg/wait 等待用。
const bgPromises = new Map<number, Promise<CmdResult>>();

// 后台执行一条命令（cmd &）：不 await、登记一条作业、立刻返回。
// 用 ctx 的副本，免得后台作业的 cd/export 串改前台 shell。完成时发通知。
function backgroundRun(cmd: string, ctx: ShellCtx): CmdResult {
  const job = addJob(cmd);
  // 裁剪 bgPromises：jobs.list 已封顶 30，掉出列表的作业号对应的 promise 一并清掉，免 Map 只增不减（长会话泄漏）。
  const live = new Set(jobs.list.map((j) => j.n));
  for (const k of bgPromises.keys()) if (!live.has(k)) bgPromises.delete(k);
  const bgCtx: ShellCtx = { cwd: ctx.cwd, env: { ...ctx.env }, code: 0, pid: ctx.pid };
  const p = run(cmd, bgCtx)
    .catch((e): CmdResult => ({ out: '', err: e instanceof Error ? e.message : String(e), code: 1 }))
    .then((res) => {
      finishJob(job.n, res.code);
      try {
        sys.notify(`作业 [${job.n}] 结束`, { body: cmd.slice(0, 50), level: res.code === 0 ? 'success' : 'warn' });
      } catch {
        /* 通知失败不影响作业 */
      }
      return res;
    });
  bgPromises.set(job.n, p);
  return { out: `[${job.n}] ${cmd}`, code: 0 };
}

// 顶层执行：解析成 AST 后逐节点执行。含 if/for/while；叶子语句走 runLine。
// 末尾单个 &（非 &&）→ 后台作业：剥掉 & 后台跑、立刻返回提示。
export async function run(text: string, ctx: ShellCtx): Promise<CmdResult> {
  const t = text.trim();
  if (!t) return { out: '', code: 0 };
  if (t.endsWith('&') && !t.endsWith('&&')) {
    const body = t.slice(0, -1).trim();
    if (body) return backgroundRun(body, ctx);
  }
  let ast: SNode[];
  try {
    ast = parseStatements(splitStatements(text));
  } catch (e) {
    return { out: '', err: 'qzsh: 语法错误：' + (e instanceof Error ? e.message : String(e)), code: 2 };
  }
  const outs: string[] = [];
  const errs: string[] = [];
  let lastCode = 0;
  let cd: string | undefined;
  let clear = false;
  let loops = 0;
  let outLen = 0;
  let truncated = false;
  const collect = (arr: string[], s: string) => {
    if (truncated) return;
    arr.push(s);
    outLen += s.length;
    if (outLen > OUT_CAP) {
      truncated = true;
      errs.push('…（输出过多，已截断）');
    }
  };

  const runLeaf = async (line: string) => {
    const res = await runLine(line, ctx);
    if (res.out) collect(outs, res.out);
    if (res.err) collect(errs, res.err);
    if (res.cd) {
      cd = res.cd;
      ctx.cwd = res.cd;
    }
    if (res.clear) clear = true;
    lastCode = res.code;
  };
  const execNodes = async (nodes: SNode[]) => {
    for (const n of nodes) await execNode(n);
  };
  const execNode = async (n: SNode): Promise<void> => {
    if (n.t === 'cmd') return runLeaf(n.text);
    if (n.t === 'if') {
      for (const br of n.branches) {
        await runLeaf(br.cond); // 条件命令的退出码决定走哪支
        if (lastCode === 0) return execNodes(br.body);
      }
      if (n.elseBody) await execNodes(n.elseBody);
      return;
    }
    if (n.t === 'for') {
      for (const w of expandWords(n.words, ctx)) {
        ctx.env[n.varName] = w;
        await execNodes(n.body);
        if (++loops > MAX_LOOP || truncated) return;
        if (loops % 256 === 0) await new Promise((r) => setTimeout(r)); // 周期性让出主线程，别冻 UI
      }
      return;
    }
    // while
    for (;;) {
      await runLeaf(n.cond);
      if (lastCode !== 0) break;
      await execNodes(n.body);
      if (++loops > MAX_LOOP) {
        errs.push('while: 超过最大迭代次数');
        break;
      }
      if (truncated) break; // 输出已截断，没必要再空转
      if (loops % 256 === 0) await new Promise((r) => setTimeout(r));
    }
  };

  await execNodes(ast);
  return { out: outs.join('\n'), err: errs.length ? errs.join('\n') : undefined, code: lastCode, cd, clear };
}

// 执行单个管道（含 | 与重定向 < > >> 2>）。改 ctx.cwd/env/code 由调用方按返回值落地。
// 异步：命令可能是异步的（curl 等），故按段 await。
async function runPipeline(line: string, ctx: ShellCtx): Promise<CmdResult> {
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

    let [cmd, ...args] = rest;
    if (!cmd) return { out: '', err: 'qzsh: 语法错误：空命令', code: 2 };
    // 别名展开（单次、非递归）：首词是别名 → 替换成别名内容 + 原参数
    const aliasVal = aliases.map[cmd];
    if (aliasVal) {
      const exp = tokenize(aliasVal).map((t) => subst(t, ctx));
      if (exp.length) {
        args = [...exp.slice(1), ...args];
        cmd = exp[0];
      }
    }
    const fn = COMMANDS[cmd];
    // 不是内置命令、但形如路径（./x、a/b）且指向文本文件 → 当脚本执行（sh/./file）
    let scriptNode: VNode | undefined;
    if (!fn && cmd.includes('/')) {
      const sid = resolvePath(ctx.cwd, cmd);
      const sn = sid ? getNode(sid) : undefined;
      if (sn?.type === 'file' && sn.kind !== 'binary') scriptNode = sn;
    }
    if (!fn && !scriptNode) {
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

    let res: CmdResult;
    if (fn) {
      res = await fn(args, ctx, stageStdin);
    } else if (sourceDepth >= 25) {
      res = { out: '', err: 'qzsh: 脚本嵌套过深', code: 1 };
    } else {
      sourceDepth++; // 脚本文件：解释执行其内容（含多行控制流），共享 ctx
      try {
        res = await run(scriptNode!.content, ctx);
      } finally {
        sourceDepth--;
      }
    }
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
