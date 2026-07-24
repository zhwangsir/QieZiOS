// ───────────────────────────────────────────────────────────
// 极简 POSIX 风格 Shell —— 跑在 VFS 之上的命令解释器。
// 纯逻辑（无 DOM），终端 App 拿来执行每一行。一次执行返回完整输出（MVP 不流式）。
// 设计：命令表 COMMANDS[name] = (args, ctx) => CmdResult。
// 支持：$VAR 替换、引号、基础重定向 > / >>。管道/grep 等留给 Phase G2。
// ───────────────────────────────────────────────────────────
import {
  resolvePath,
  lresolvePath,
  pathOf,
  getNode,
  children,
  createDir,
  createFile,
  createBinaryFile,
  createSymlink,
  readBlob,
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
import { users, getUser, userExists, addUser, passwdContent, userHome } from '../system/users.svelte';
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
import { aliases, setAlias, removeAlias, cmdHistory, addHistory } from '../system/shellPrefs.svelte';
import { jobs, addJob, finishJob } from '../system/jobs.svelte';
import { evalArith } from './arith';
import { braceExpand, tildeExpand, ESC } from './wordexpand';
import { flushPersisted } from '../kernel/persist.svelte';

export interface ShellCtx {
  cwd: string; // 当前目录节点 id
  env: Record<string, string>; // 环境变量
  code: number; // 上次命令退出码（$?）
  pid: number; // 终端自身的进程 pid（给 open 启动的子进程设 ppid；0=未知）
  // Ctrl+C 协作式中断：Terminal 按键置 flag，run 在语句/循环迭代边界检查并中止（退出码 130）。
  // run 内部不清零 —— 调用方（Terminal submit）每次执行前负责复位；嵌套 run（sh 脚本/source）
  // 共享同一 ctx，flag 持续置位让外层循环也一并中止，直到最外层返回。
  intr?: { flag: boolean };
  // M32 函数与位置参数：
  funcs?: Record<string, string>; // 函数表 name → body 文本（fork 时拷贝：子 shell 定义不回流父 shell）
  positional?: string[]; // 位置参数 $1..$9/$@/$#（函数调用与脚本执行期间设置）
  funcDepth?: number; // 函数嵌套深度（return 合法性判定：>0 表示在函数内）
  retFlag?: { code: number } | null; // return 信号：函数/脚本边界检查后清除并作为该边界退出码
  heredocs?: { body: string; expand: boolean }[]; // M35：本次 run 的 here-doc 表（哨兵 \x02N 按索引取用；嵌套 run 保存/恢复）
  // M37 循环控制：loopDepth 记录活跃循环嵌套层数（break/continue 合法性判定）；
  // loopCtl 是 break/continue 置的信号，循环边界消费——n=1 本层生效并清除，n>1 递减后向上传（break 2 断两层）。
  // 信号跨 run 边界自然传播（共享 ctx：函数内 break 断调用处循环，bash 动态作用域）；$(…)/后台作业新上下文从 0 起。
  loopDepth?: number;
  loopCtl?: { op: 'break' | 'continue'; n: number } | null;
  // M43.3 trap：信号陷阱表（信号名 → 命令文本），仅 INT/EXIT。
  // 子 shell（$(…)/后台作业）不继承——构造上下文时不带此字段（bash 子 shell 重置陷阱语义）。
  traps?: Record<string, string>;
  // M43.3：run 嵌套深度（共享引用，同 intr 模式）。INT trap 只在最外层（n===1）触发一次——
  // 嵌套 run（脚本/source/函数）各自把中断吞成 130 返回，只有最外层代表「本次用户命令」。
  runDepth?: { n: number };
  // M43.3：EXIT trap 执行中标志——handler 体内再跑脚本不递归触发 EXIT。
  exitFiring?: boolean;
  // M44.1 local：函数局部变量恢复帧栈（函数调用边界 push/pop）。每帧 Map 记录变量先前状态
  // （existed/value），函数返回时逐条恢复——存在则复原值，不存在则删除。嵌套函数各自一帧。
  locals?: Map<string, { existed: boolean; value: string | undefined }>[];
  // M44.2 set -e：严格模式。开启后命令失败（非豁免上下文）→ 抛 ShellExit 中止本层执行。
  // noErrExit 是豁免深度计数：if/while/until 条件求值期间 +1（bash：条件里的失败不触发 -e，
  // 且豁免深入条件调用的函数体）。$(…) 子 shell 继承两者；后台作业不继承（异步失败不杀前台）。
  errexit?: boolean;
  noErrExit?: number;
  // M52.6 pushd/popd/dirs：目录栈（节点 id 栈，栈底为当前 cwd 的镜像）。
  // newCtx 初始化为 ['root']，pushd 压入新目录、popd 弹出切回。fork 时不深拷贝（与 env 同款共享引用语义，单会话内使用）。
  dirStack?: string[];
}

export interface CmdResult {
  out: string;
  err?: string;
  code: number;
  cd?: string; // 命令要求切换 cwd（cd）
  clear?: boolean; // 命令要求清屏（clear）
  exit?: boolean; // M52.1 exit：要求关闭终端窗口（Terminal 检测后调 sys.proc.close）
}

export function newCtx(): ShellCtx {
  const user = currentUser(); // 登录账号 → 就是你；否则访客 qiezi
  return {
    cwd: 'root',
    env: { USER: user, HOME: user === 'root' ? '/root' : '/', SHELL: 'qzsh', HOSTNAME: 'qiezios', PATH: '/bin' },
    code: 0,
    pid: 0,
    intr: { flag: false },
    funcs: {},
    positional: [],
    funcDepth: 0,
    retFlag: null,
    loopDepth: 0,
    loopCtl: null,
    traps: {},
    runDepth: { n: 0 },
    dirStack: ['root'],
  };
}

// ── 词法：按空白分词，尊重单/双引号 ─────────────────────────
// 产物保留引号类型 q：①单引号强引用 subst 不展开；②引号内 > < 不当重定向算符、* ? 不 glob。
// 已知取舍：裸词拼引号的罕见形态（foo"bar"）以首个引号作为整词 q，不细分段处理。
interface Tok {
  text: string; // 剥掉引号后的文本
  q: '"' | "'" | null; // 包裹引号（null = 裸词）
}

// M26：找与 line[openIdx]=='(' 匹配的 ')' —— 计入嵌套；引号内括号不算；\ 转义的括号不算（单引号内不转义）。
// 返回闭合 ')' 的下标；未闭合返回 -1。
function matchParen(line: string, openIdx: number): number {
  let depth = 0;
  let q: '"' | "'" | null = null;
  for (let i = openIdx; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\') i++; // 双引号内 \" \\ 转义
      else if (c === '"') q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === '\\') {
      i++; // 裸词 \) 是转义括号
      continue;
    }
    if (c === ESC) {
      i++; // M31：token 文本内的转义对（subst 阶段在词文本上调用时）整体跳过
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// M26：命令替换跨度扫描 —— $( … ) 与 ` … `。供 tokenize/分句/分管/分连接符统一把内部文本整体跳过。
// 返回跨度结束下标（含闭合符）；未闭合返回 -1（调用方当普通字符，subst 阶段会抛「未闭合」语法错误）。
function substSpanEnd(line: string, start: number): number {
  if (line[start] === '`') {
    // legacy 反引号：不嵌套，\` 转义；找下一个未转义反引号（M31：ESC 转义对同样跳过）
    for (let i = start + 1; i < line.length; i++) {
      if (line[i] === '\\' || line[i] === ESC) i++;
      else if (line[i] === '`') return i;
    }
    return -1;
  }
  return matchParen(line, start + 1); // $( → 从 '(' 位置配对
}

// M43：[[ … ]] 条件命令跨度 —— 与 $( … ) 同款思路：分句/分管/分连接符把内部文本整体跳过，
// 让 && || | ; < > 在 [[ ]] 内不被当语法符（它们是条件算符）。
// bash：[[ 是保留字，必须独立成词——前面是行首/空白/连接符/括号，后面必须跟空白。
function isCondStart(line: string, i: number): boolean {
  if (line[i] !== '[' || line[i + 1] !== '[') return false;
  const prev = line[i - 1];
  if (prev !== undefined && !/[\s;|&()]/.test(prev)) return false;
  const next = line[i + 2];
  if (next !== undefined && !/\s/.test(next)) return false;
  return true;
}
// 找闭合 ]]（同样独立成词：前空白、后是空白/行尾/连接符）。引号/$( )/\ 转义整体跳过。
// 返回第二个 ] 的下标；未闭合返回 -1。
function condSpanEnd(line: string, start: number): number {
  let q: '"' | "'" | null = null;
  for (let i = start + 2; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\') i++;
      else if (c === '"') q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === '\\') {
      i++;
      continue;
    }
    if ((c === '$' && line[i + 1] === '(') || c === '`') {
      const end = substSpanEnd(line, i);
      if (end !== -1) {
        i = end;
        continue;
      }
    }
    if (c === ']' && line[i + 1] === ']' && /\s/.test(line[i - 1] ?? '')) {
      const next = line[i + 2];
      if (next === undefined || /[\s;|&()]/.test(next)) return i + 1;
    }
  }
  return -1;
}

// M31 反斜杠转义：裸词 \X → ESC+X 字面（X 不再参与展开/glob/分词/引号判定）；\<换行> 续行拼接；
// 行尾孤立 \ 字面保留。双引号内仅 \$ \` \" \\ 转义（bash 弱引用），\d 等其余形态反斜杠字面保留；
// 单引号内一切字面（首分支已拦截）。ESC 哨兵在 expandToks/expandWords 出口统一剥掉。
function tokenize(line: string): Tok[] {
  const toks: Tok[] = [];
  let cur = '';
  let inTok = false;
  let q: '"' | "'" | null = null;
  let tokQ: '"' | "'" | null = null; // 本词首个引号（词级近似）
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      if (c === "'") q = null;
      else cur += c;
      continue;
    }
    // M26：$( … ) / ` … ` 整体留在词内（内部空白不分词、引号不切换），subst 阶段才执行。
    // 单引号内不生效（上面已拦截）——bash 强引用语义。
    if ((c === '$' && line[i + 1] === '(') || c === '`') {
      const end = substSpanEnd(line, i);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        inTok = true;
        i = end;
        continue;
      }
    }
    // M45.2 进程替换 <( … ) / >( … )：仅裸词状态，内部空白不分词，subst 阶段才执行内部命令。
    // 双引号内 < > 是字面（bash：双引号内不进程替换）；单引号已在上面拦截。
    if (q === null && (c === '<' || c === '>') && line[i + 1] === '(') {
      const end = matchParen(line, i + 1);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        inTok = true;
        i = end;
        continue;
      }
    }
    if (q === '"') {
      if (c === '"') {
        q = null;
        continue;
      }
      if (c === '\\') {
        const n = line[i + 1];
        // 双引号内反斜杠仅在 $ ` " \ 前保留特殊义（bash 弱引用）；\<换行> 续行；其余反斜杠字面保留
        if (n === '$' || n === '`' || n === '"' || n === '\\') {
          cur += ESC + n;
          i++;
          continue;
        }
        if (n === '\n') {
          i++;
          continue;
        }
        cur += c;
        continue;
      }
      cur += c;
      continue;
    }
    // 裸词反斜杠：\X → ESC+X 字面（\<换行> 续行；行尾孤立 \ 字面保留）
    if (c === '\\') {
      const n = line[i + 1];
      if (n === '\n') {
        i++;
        continue;
      }
      if (n === undefined) {
        cur += c;
        inTok = true;
        continue;
      }
      cur += ESC + n;
      inTok = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      inTok = true;
      if (!tokQ) tokQ = c;
      continue;
    }
    if (c === ' ' || c === '\t') {
      if (inTok) {
        toks.push({ text: cur, q: tokQ });
        cur = '';
        inTok = false;
        tokQ = null;
      }
      continue;
    }
    cur += c;
    inTok = true;
  }
  if (inTok) toks.push({ text: cur, q: tokQ });
  return toks;
}

// M26 命令替换：$( … ) / ` … ` 在子 shell 执行，stdout（剥尾随换行）替换进来。
// fork ctx：cd/export/赋值不影响父 shell（bash 子 shell 语义）；intr 共享引用 → Ctrl+C 能断替换内循环。
// 取舍：替换结果的 stderr 丢弃（bash 直接打终端，我们的架构是收集式，记录在案）。
const SUBST_DEPTH_MAX = 8; // $( $( $( … )) 递归上限，防栈爆
let substDepth = 0;

async function execCmdSubst(body: string, ctx: ShellCtx): Promise<string> {
  if (substDepth >= SUBST_DEPTH_MAX) return '';
  // M32：funcs 拷贝（子 shell 里定义函数不回流父 shell）、positional 继承副本（bash：子 shell 看到同样的 $1）
  const subCtx: ShellCtx = {
    cwd: ctx.cwd,
    env: { ...ctx.env },
    code: ctx.code,
    pid: ctx.pid,
    intr: ctx.intr,
    funcs: { ...ctx.funcs },
    positional: ctx.positional ? [...ctx.positional] : [],
    funcDepth: ctx.funcDepth ?? 0,
    retFlag: null,
    loopDepth: 0, // M37：$(…) 子 shell 不继承外层循环（bash：替换内 break 只警告，不断外层）
    loopCtl: null,
    // M43.3：traps 不带（bash 子 shell 重置陷阱）；runDepth 共享引用——INT trap 仍只在主链最外层触发
    runDepth: ctx.runDepth,
    // M44.2：子 shell 继承 -e 与豁免深度（替换整体处于 if 条件时内部同样豁免）
    errexit: ctx.errexit,
    noErrExit: ctx.noErrExit ?? 0,
  };
  substDepth++;
  try {
    const res = await run(body, subCtx);
    // Ctrl+C 断替换内循环：内层 run 吞成 130 + flag 仍置位 → 继续向上抛，让最外层整条命令中止（bash 手感）
    if (res.code === 130 && ctx.intr?.flag) throw new ShellInterrupt();
    return res.out.replace(/\n+$/, ''); // bash：剥掉全部尾随换行（内嵌换行保留）
  } finally {
    substDepth--;
  }
}

// M45.2 进程替换 <(cmd)：fork ctx 跑命令取 stdout，落 /tmp 临时文件，返回路径字符串。
// 复用 execCmdSubst 的 fork ctx + run + intr 抛 ShellInterrupt 语义（cd/export 不回流、Ctrl+C 能断内循环）。
// 取舍：文件内容 = execCmdSubst 返回值（已剥尾随换行，与命令替换 $(cmd) 语义一致）。bash 的 <(cmd)
// 文件内容是原始 stdout（含尾随换行），但本 shell 的 run 已统一剥尾随换行，这里保持一致避免 cat 多文件
// join('\n') 时多出空行。临时文件不自动清理（VFS 累积）；>(cmd) 未实现（留作字面参数）。
async function execProcSubst(body: string, ctx: ShellCtx): Promise<string> {
  const content = await execCmdSubst(body, ctx); // 剥尾随换行的 stdout；intr 时抛 ShellInterrupt 不返回
  // 懒创建 /tmp（VFS seed 无此目录，首次进程替换时建）
  let tmpId = resolvePath(ctx.cwd, '/tmp');
  if (!tmpId || getNode(tmpId)?.type !== 'dir') {
    tmpId = createDir('root', 'tmp');
  }
  const name = '.psub_' + Math.random().toString(36).slice(2, 10);
  createFile(tmpId, name, content);
  return '/tmp/' + name;
}

// $VAR / ${VAR} / $? / $(cmd) / `cmd` 单遍展开（bash 语义：左到右单遍扫描，展开结果不再重扫——
// $(echo '$HOME') 输出的 $HOME 不会被二次展开）。单引号是强引用：原样不展开。异步：命令替换要递归 run。
async function subst(tok: string, ctx: ShellCtx, q: '"' | "'" | null = null): Promise<string> {
  if (q === "'") return tok;
  let out = '';
  for (let i = 0; i < tok.length; i++) {
    const c = tok[i];
    if (c === ESC) {
      out += c + (tok[i + 1] ?? ''); // M31：转义对原样通过（$ ` ( 等不再触发展开），出口统一剥 ESC
      i++;
      continue;
    }
    // M45.2 进程替换 <(cmd)：跑内部命令，stdout 落 /tmp 临时文件，替换为路径字符串。
    // 仅 <(cmd)；>(cmd) 语义不同（写端 fd），本次不做，> 当普通字符由调用方处理。
    if (c === '<' && tok[i + 1] === '(') {
      const end = matchParen(tok, i + 1);
      if (end === -1) throw new Error('未闭合的 <( … )');
      out += await execProcSubst(tok.slice(i + 2, end), ctx);
      i = end;
      continue;
    }
    if (c === '`') {
      const end = substSpanEnd(tok, i);
      if (end === -1) throw new Error('未闭合的反引号 `');
      out += await execCmdSubst(tok.slice(i + 1, end), ctx);
      i = end;
      continue;
    }
    if (c === '$') {
      const n = tok[i + 1];
      // M27 算术展开 $((expr))：$( 紧跟 ( 即算术（bash 同款判定；$( (ls) ) 带空格才是子 shell）。
      const end0 = n === '(' ? matchParen(tok, i + 1) : -1;
      if (n === '(' && tok[i + 2] === '(' && end0 !== -1) {
        // end0 是首个 '(' 的配对 ')'（即最末 ')'），内层 ')' 在 end0-1 → 表达式体剥掉 $(( 与 ))
        out += String(evalArith(tok.slice(i + 3, end0 - 1), ctx.env, ctx.positional ?? []));
        i = end0;
        continue;
      }
      if (n === '(') {
        const end = end0;
        if (end === -1) throw new Error('未闭合的 $( … )');
        out += await execCmdSubst(tok.slice(i + 2, end), ctx);
        i = end;
        continue;
      }
      if (n === '?') {
        out += String(ctx.code);
        i++;
        continue;
      }
      // M32 位置参数：$1..$9（bash 单数字，$10 = ${1}0）、$# 个数、$@/$* 空格 join、$0 shell 名。
      // 已知差异：无 word splitting——"$@" 与 $@ 都 join 成一词（与既有变量展开取舍一致，记录在案）。
      if (n === '#') {
        out += String(ctx.positional?.length ?? 0);
        i++;
        continue;
      }
      if (n === '@' || n === '*') {
        out += (ctx.positional ?? []).join(' ');
        i++;
        continue;
      }
      if (n === '0') {
        out += 'qzsh';
        i++;
        continue;
      }
      if (n && n >= '1' && n <= '9') {
        out += ctx.positional?.[Number(n) - 1] ?? '';
        i++;
        continue;
      }
      if (n === '{') {
        // M44.1 附带：${VAR} 之外支持 ${VAR:-word}（bash：未设置或空串时取 word；word 同样经 subst 展开）。
        // word 内不允许出现 }（正则跨度限制，记录在案）。
        const m = /^\{(\w+)(?::-([^}]*))?\}/.exec(tok.slice(i + 1));
        if (m) {
          const v = ctx.env[m[1]];
          if (m[2] !== undefined && (v === undefined || v === '')) out += await subst(m[2], ctx, q);
          else out += v ?? '';
          i += m[0].length;
          continue;
        }
        out += '$';
        continue;
      }
      const m = /^\w+/.exec(tok.slice(i + 1));
      if (m) {
        out += ctx.env[m[0]] ?? '';
        i += m[0].length;
        continue;
      }
      out += '$';
      continue;
    }
    out += c;
  }
  return out;
}

// M31：剥掉转义哨兵。注意 expandToks 不剥——ESC 必须活到 extractRedirs 之后，
// 否则 \> 剥成 > 会被重定向算符表重新吃掉；统一在 runPipeline 抽完重定向后剥。
const stripEsc = (s: string): string => s.replaceAll(ESC, '');

// 变量展开 + bash 空词删除：无引号词因变量未定义展开成空 → 整词移除
// （echo $X x 输出 "x" 而非 " x"）；引号空串是有效参数，保留（echo "" x 输出 " x"）。
// M29：bash 展开顺序——花括号 → 波浪号 → 变量/命令/算术（subst）；引号词全程跳过前两步。
// 已知差异：变量展开产出的 > < 仍会被当重定向（bash 不认）——`A='>'; echo hi $A` 场景极罕见，从简。
// 已知差异：无 word splitting——`for x in $(echo 'a b')` 是 1 次迭代而非 bash 的 2 次（与既有变量展开行为一致，记录在案）。
// M38：glob 参数控制路径名展开——命令参数/别名走 true；case 的词与模式不做路径名展开（bash 语义，模式本身就是 pattern）。
async function expandToks(toks: Tok[], ctx: ShellCtx, glob = true): Promise<string[]> {
  const out: string[] = [];
  for (const t of toks) {
    for (const v0 of t.q === null ? braceExpand(t.text) : [t.text]) {
      const v = t.q === null ? tildeExpand(v0, ctx.env.HOME ?? '/', userHome) : v0;
      const text = await subst(v, ctx, t.q);
      // 空词删除按变体级判定：花括号产出的空变体（{,}）是有效参数，不删
      if (text === '' && t.q === null && v0 !== '') continue;
      // M38：无引号词含通配 → 路径名展开（无匹配原样保留）。ESC 不在此剥——runPipeline 抽完重定向统一剥。
      if (glob && t.q === null && hasGlob(text)) {
        const hits = globExpand(text, ctx);
        if (hits) {
          out.push(...hits);
          continue;
        }
      }
      out.push(text);
    }
  }
  return out;
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

// ── M53.2 sed 脚本解析（地址：N / $ / /re/ 及 N,M 范围；命令：s///[g] p d）──
type SedAddr = { kind: 'num'; n: number } | { kind: 'last' } | { kind: 're'; re: RegExp };
type SedCmd =
  | { a1?: SedAddr; a2?: SedAddr; op: 'p' | 'd' }
  | { a1?: SedAddr; a2?: SedAddr; op: 's'; re: RegExp; rep: string };
function parseSedScript(script: string): SedCmd[] | null {
  const cmds: SedCmd[] = [];
  let i = 0;
  const s = script;
  // 读 /re/ 或 N 或 $；返回 null = 此处无地址
  const parseAddr = (): SedAddr | null => {
    if (i >= s.length) return null;
    const ch = s[i];
    if (ch === '$') {
      i++;
      return { kind: 'last' };
    }
    if (ch === '/') {
      let j = i + 1;
      while (j < s.length && s[j] !== '/') {
        if (s[j] === '\\') j++;
        j++;
      }
      if (j >= s.length) return null;
      try {
        const re = new RegExp(s.slice(i + 1, j));
        i = j + 1;
        return { kind: 're', re };
      } catch {
        return null;
      }
    }
    const m = /^\d+/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      return { kind: 'num', n: parseInt(m[0], 10) };
    }
    return null;
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === ';' || ch === '\n' || ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    const save = i;
    const a1 = parseAddr() ?? undefined;
    let a2: SedAddr | undefined;
    if (i < s.length && s[i] === ',') {
      i++;
      const p = parseAddr();
      if (!p) return null;
      a2 = p;
    }
    if (i >= s.length) return null;
    const op = s[i];
    if (op === 'p' || op === 'd') {
      cmds.push({ a1, a2, op });
      i++;
      continue;
    }
    if (op === 's') {
      i++;
      if (i >= s.length) return null;
      const delim = s[i++]; // sed 允许任意字符作 s 的分隔符
      let j = i;
      while (j < s.length && s[j] !== delim) {
        if (s[j] === '\\') j++;
        j++;
      }
      if (j >= s.length) return null;
      const pat = s.slice(i, j);
      i = j + 1;
      let k = i;
      while (k < s.length && s[k] !== delim) {
        if (s[k] === '\\') k++;
        k++;
      }
      if (k >= s.length) return null;
      const repRaw = s.slice(i, k);
      i = k + 1;
      let gFlag = false;
      while (i < s.length && /[a-z0-9]/i.test(s[i])) {
        if (s[i] === 'g') gFlag = true;
        i++;
      }
      // sed 替换串 → JS 替换串：\N→$N、&→$&、$→$$（防 JS 特殊序列）
      let rep = '';
      for (let q = 0; q < repRaw.length; q++) {
        const c = repRaw[q];
        if (c === '\\' && q + 1 < repRaw.length && /\d/.test(repRaw[q + 1])) rep += '$' + repRaw[++q];
        else if (c === '&') rep += '$&';
        else if (c === '$') rep += '$$';
        else rep += c;
      }
      try {
        cmds.push({ a1, a2, op: 's', re: new RegExp(pat, gFlag ? 'g' : ''), rep });
      } catch {
        return null;
      }
      continue;
    }
    i = save; // 未知命令
    return null;
  }
  return cmds;
}

// ── M53.3 awk 程序解析（BEGIN/END/{动作}/模式 {动作}，动作仅支持 print）──
type AwkRule = { re?: RegExp; nrEq?: number; body: string };
function parseAwkProgram(prog: string): { begins: string[]; ends: string[]; rules: AwkRule[] } {
  const begins: string[] = [];
  const ends: string[] = [];
  const rules: AwkRule[] = [];
  const n = prog.length;
  let i = 0;
  // 调用处保证 prog[i] === '{'；返回块体，i 移到配对 } 之后
  const readBlock = (): string => {
    let depth = 0;
    let j = i;
    for (; j < n; j++) {
      if (prog[j] === '{') depth++;
      else if (prog[j] === '}') {
        depth--;
        if (!depth) break;
      }
    }
    const body = prog.slice(i + 1, j);
    i = j + 1;
    return body;
  };
  while (i < n) {
    if (/\s/.test(prog[i])) {
      i++;
      continue;
    }
    const rest = prog.slice(i);
    const m = /^(BEGIN|END)\s*\{/.exec(rest);
    if (m) {
      i += m[0].length - 1; // 指到 {
      (m[1] === 'BEGIN' ? begins : ends).push(readBlock());
      continue;
    }
    if (prog[i] === '{') {
      rules.push({ body: readBlock() });
      continue;
    }
    if (prog[i] === '/') {
      let j = i + 1;
      while (j < n && prog[j] !== '/') {
        if (prog[j] === '\\') j++;
        j++;
      }
      let re: RegExp | undefined;
      try {
        re = new RegExp(prog.slice(i + 1, j));
      } catch {
        re = undefined;
      }
      i = j + 1;
      while (i < n && /\s/.test(prog[i])) i++;
      if (i < n && prog[i] === '{') rules.push({ re, body: readBlock() });
      else rules.push({ re, body: 'print $0' }); // 裸模式 = 打印整行
      continue;
    }
    const mr = /^NR==(\d+)\s*(\{)?/.exec(rest);
    if (mr) {
      i += mr[0].length - (mr[2] ? 1 : 0); // mr[0] 含 { 时回退一格，让 readBlock 从 { 开始
      if (mr[2]) rules.push({ nrEq: parseInt(mr[1], 10), body: readBlock() });
      else rules.push({ nrEq: parseInt(mr[1], 10), body: 'print $0' });
      continue;
    }
    i++; // 不认识的字符跳过（简化容错）
  }
  return { begins, ends, rules };
}
// 执行 awk 动作体里的 print 语句（; 分隔多条）。$0=整行、$N=字段、NR、NF、"串"，逗号 → 空格。
function awkPrintArgs(body: string, line: string, fields: string[], nr: number, out: string[]): void {
  for (const stmt of body.split(';')) {
    const m = /^\s*print\b([\s\S]*)$/.exec(stmt);
    if (!m) continue; // 赋值/运算等非 print 语句本里程碑不支持，忽略
    const argStr = m[1].trim();
    if (argStr === '') {
      out.push(line); // 裸 print = print $0
      continue;
    }
    const parts: string[] = [];
    let cur = '';
    let inQ = false;
    for (const c of argStr) {
      if (c === '"') inQ = !inQ;
      if (c === ',' && !inQ) {
        parts.push(cur);
        cur = '';
      } else cur += c;
    }
    parts.push(cur);
    out.push(
      parts
        .map((p) => {
          const t = p.trim();
          if (t === 'NR') return String(nr);
          if (t === 'NF') return String(fields.length);
          if (t === '$0') return line;
          const fm = /^\$(\d+)$/.exec(t);
          if (fm) return fields[parseInt(fm[1], 10) - 1] ?? '';
          const sm = /^"([\s\S]*)"$/.exec(t);
          if (sm) return sm[1];
          return t; // 数字/裸词原样输出
        })
        .join(' '),
    );
  }
}

// ── M53.5/6 USTAR 与 gzip 编解码（无外部依赖：手写 USTAR + 原生 CompressionStream）──
const te = new TextEncoder();
const td = new TextDecoder();
const tdFatal = new TextDecoder('utf-8', { fatal: true });

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
// 字节能否按 UTF-8 文本还原（决定解压/解压 gzip 后建文本文件还是二进制文件）
function isTextBytes(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try {
    tdFatal.decode(b);
    return true;
  } catch {
    return false;
  }
}
// 读 VFS 文件原始字节：文本 → UTF-8 编码；二进制 → blobStore 取回
async function readFileBytes(n: VNode): Promise<Uint8Array> {
  if (n.kind === 'binary') {
    const blob = await readBlob(n);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
  }
  return te.encode(n.content);
}
async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  return concatBytes(parts);
}
async function gzipBytes(data: Uint8Array, name?: string): Promise<Uint8Array> {
  const gz = await collectStream(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip')));
  if (!name) return gz;
  // 内嵌原始文件名（FNAME 字段）：FLG 置 bit3，头 10B 后插 name\0。
  // FNAME 纯头元数据，deflate 体与 CRC/ISIZE 尾不受影响，直接拼接即可。
  const nb = te.encode(name.replace(/.*\//, '')); // 只存 basename
  const out = new Uint8Array(gz.length + nb.length + 1);
  out.set(gz.subarray(0, 10), 0);
  out[3] |= 0x08; // FLG.FNAME
  out.set(nb, 10);
  out[10 + nb.length] = 0;
  out.set(gz.subarray(10), 10 + nb.length + 1);
  return out;
}
async function gunzipBytes(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    return await collectStream(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')));
  } catch {
    return null; // 非 gzip / 数据损坏
  }
}

// ── hexdump/od 辅助（M53.10）────────────────────────────────
function hex2(b: number): string {
  return b.toString(16).padStart(2, '0');
}
// 地址格式化：x=8 位十六进制（hexdump 惯例）；d/o=7 位零填充（od 惯例）
function fmtAddr(off: number, radix: string): string {
  if (radix === 'd') return String(off).padStart(7, '0');
  if (radix === 'o') return off.toString(8).padStart(7, '0');
  return off.toString(16).padStart(8, '0');
}
// 可转储文件解析：不存在/目录 → err，否则取原始字节
async function dumpable(ctx: ShellCtx, f: string): Promise<{ bytes: Uint8Array } | { err: string }> {
  const id = resolvePath(ctx.cwd, f);
  const n = id ? getNode(id) : undefined;
  if (!n) return { err: `${f}: 没有那个文件或目录` };
  if (n.type === 'dir') return { err: `${f}: 是一个目录` };
  return { bytes: await readFileBytes(n) };
}

// ── diff/patch 辅助（M53.11/12）──────────────────────────────
// 编辑块：aPos/bPos 为 0-based 起始；aCount/bCount 为该块在两侧的行数
interface DiffBlock {
  aPos: number;
  aCount: number;
  bPos: number;
  bCount: number;
  del: string[]; // a 侧被删行
  add: string[]; // b 侧新增行
}
// 行级 LCS：把 a→b 的差异切成最小编辑块序列（块按位置升序）
function diffBlocks(a: string[], b: string[]): DiffBlock[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const blocks: DiffBlock[] = [];
  let cur: DiffBlock | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  const ensure = (i: number, j: number): DiffBlock => {
    if (!cur) cur = { aPos: i, aCount: 0, bPos: j, bCount: 0, del: [], add: [] };
    return cur;
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      const bl = ensure(i, j);
      bl.del.push(a[i]);
      bl.aCount++;
      i++;
    } else {
      const bl = ensure(i, j);
      bl.add.push(b[j]);
      bl.bCount++;
      j++;
    }
  }
  while (i < n) {
    const bl = ensure(i, j);
    bl.del.push(a[i]);
    bl.aCount++;
    i++;
  }
  while (j < m) {
    const bl = ensure(i, j);
    bl.add.push(b[j]);
    bl.bCount++;
    j++;
  }
  flush();
  return blocks;
}
// normal 格式：NcM / NaM / NdM（区间单行只打一个行号）
function diffNormal(blocks: DiffBlock[]): string[] {
  const out: string[] = [];
  const range = (pos: number, cnt: number) => (cnt === 1 ? `${pos + 1}` : `${pos + 1},${pos + cnt}`);
  for (const bl of blocks) {
    if (bl.aCount && bl.bCount) {
      out.push(`${range(bl.aPos, bl.aCount)}c${range(bl.bPos, bl.bCount)}`);
      for (const l of bl.del) out.push(`< ${l}`);
      out.push('---');
      for (const l of bl.add) out.push(`> ${l}`);
    } else if (bl.aCount) {
      out.push(`${range(bl.aPos, bl.aCount)}d${bl.bPos}`);
      for (const l of bl.del) out.push(`< ${l}`);
    } else {
      out.push(`${bl.aPos}a${range(bl.bPos, bl.bCount)}`);
      for (const l of bl.add) out.push(`> ${l}`);
    }
  }
  return out;
}
// unified 格式：上下文 ctx 行；相邻块间隔 ≤ 2*ctx 合并为一个 hunk
function diffUnified(blocks: DiffBlock[], a: string[], na: string, nb: string, ctxLines = 3): string[] {
  const out: string[] = [`--- ${na}`, `+++ ${nb}`];
  const hunks: DiffBlock[][] = [];
  for (const bl of blocks) {
    const last = hunks[hunks.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && bl.aPos - (prev.aPos + prev.aCount) <= ctxLines * 2) last.push(bl);
    else hunks.push([bl]);
  }
  const fmtRange = (start0: number, cnt: number) => `${cnt === 0 ? start0 : start0 + 1}${cnt === 1 ? '' : `,${cnt}`}`;
  for (const hk of hunks) {
    const first = hk[0];
    const lastB = hk[hk.length - 1];
    const s0 = Math.max(0, first.aPos - ctxLines);
    const e0 = Math.min(a.length, lastB.aPos + lastB.aCount + ctxLines);
    let aDel = 0;
    let bAdd = 0;
    for (const bl of hk) {
      aDel += bl.del.length;
      bAdd += bl.add.length;
    }
    const aCnt = e0 - s0;
    const bCnt = aCnt - aDel + bAdd;
    const bS0 = first.bPos - (first.aPos - s0);
    out.push(`@@ -${fmtRange(s0, aCnt)} +${fmtRange(bS0, bCnt)} @@`);
    let pos = s0;
    for (const bl of hk) {
      for (; pos < bl.aPos; pos++) out.push(` ${a[pos]}`);
      for (const l of bl.del) out.push(`-${l}`);
      for (const l of bl.add) out.push(`+${l}`);
      pos = bl.aPos + bl.aCount; // 跳过被删行，避免重复当上下文输出
    }
    for (; pos < e0; pos++) out.push(` ${a[pos]}`);
  }
  return out;
}
// 读 diff 的一个操作数：'-' 用 stdin，其余按路径读原始字节
async function diffSide(ctx: ShellCtx, p: string, stdin: string): Promise<{ bytes: Uint8Array } | { err: string }> {
  if (p === '-') return { bytes: te.encode(stdin) };
  const id = resolvePath(ctx.cwd, p);
  const n = id ? getNode(id) : undefined;
  if (!n) return { err: `diff: ${p}: 没有那个文件或目录` };
  if (n.type === 'dir') return { err: `diff: ${p}: 是一个目录` };
  return { bytes: await readFileBytes(n) };
}
// 单对文件比较：返回差异输出行与是否不同（二进制只报不同；文本按 normal/-u）
async function diffPair(
  ctx: ShellCtx,
  pa: string,
  pb: string,
  stdin: string,
  opts: { u: boolean; q: boolean; hdr: boolean },
): Promise<{ out: string[]; differ: boolean } | { err: string }> {
  const ra = await diffSide(ctx, pa, stdin);
  if ('err' in ra) return ra;
  const rb = await diffSide(ctx, pb, stdin);
  if ('err' in rb) return rb;
  const aText = isTextBytes(ra.bytes);
  const bText = isTextBytes(rb.bytes);
  if (!aText || !bText) {
    const same = ra.bytes.length === rb.bytes.length && ra.bytes.every((v, i) => v === rb.bytes[i]);
    if (same) return { out: [], differ: false };
    return { out: opts.q ? [`文件 ${pa} 和 ${pb} 不同`] : [`二进制文件 ${pa} 和 ${pb} 不同`], differ: true };
  }
  const a = toLines(td.decode(ra.bytes));
  const b = toLines(td.decode(rb.bytes));
  const blocks = diffBlocks(a, b);
  if (!blocks.length) return { out: [], differ: false };
  if (opts.q) return { out: [`文件 ${pa} 和 ${pb} 不同`], differ: true };
  if (opts.u) return { out: diffUnified(blocks, a, pa, pb), differ: true };
  const body = diffNormal(blocks);
  return { out: opts.hdr ? [`diff -r ${pa} ${pb}`, ...body] : body, differ: true };
}

// ── patch 辅助 ──────────────────────────────────────────────
interface PatchHunk {
  aStart: number;
  aCount: number;
  bCount: number;
  lines: string[]; // 带前缀 ' '/'-'/'+' 的 hunk 体
}
interface FilePatch {
  oldName: string | null; // /dev/null → null
  newName: string | null;
  hunks: PatchHunk[];
}
// 解析 unified diff 文本为多文件补丁（无法识别的行跳过）
function parsePatchText(text: string): FilePatch[] {
  const patches: FilePatch[] = [];
  let cur: FilePatch | null = null;
  let hunk: PatchHunk | null = null;
  let seenA = 0;
  let seenB = 0;
  for (const ln of text.split('\n')) {
    if (ln.startsWith('--- ')) {
      cur = { oldName: null, newName: null, hunks: [] };
      patches.push(cur);
      hunk = null;
      const nm = ln.slice(4).split('\t')[0].trim();
      cur.oldName = nm === '/dev/null' ? null : nm;
    } else if (ln.startsWith('+++ ') && cur) {
      const nm = ln.slice(4).split('\t')[0].trim();
      cur.newName = nm === '/dev/null' ? null : nm;
    } else if (ln.startsWith('@@ ') && cur) {
      const mm = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(ln);
      if (!mm) continue;
      hunk = { aStart: parseInt(mm[1], 10), aCount: mm[2] === undefined ? 1 : parseInt(mm[2], 10), bCount: mm[4] === undefined ? 1 : parseInt(mm[4], 10), lines: [] };
      seenA = 0;
      seenB = 0;
      cur.hunks.push(hunk);
    } else if (hunk && (ln.startsWith(' ') || ln.startsWith('-') || ln.startsWith('+'))) {
      // hunk 体按头部声明的行数消费；填满后停止（防止补丁末尾空行等被误吞）
      if (seenA >= hunk.aCount && seenB >= hunk.bCount) continue;
      hunk.lines.push(ln);
      if (ln[0] === ' ' || ln[0] === '-') seenA++;
      if (ln[0] === ' ' || ln[0] === '+') seenB++;
    } else if (hunk && ln.startsWith('\\')) {
      // "\ No newline at end of file"：忽略（本 VFS 不区分末尾换行语义）
    }
  }
  return patches.filter((p) => p.oldName !== null || p.newName !== null);
}
// -pN 路径剪裁：剥掉前 N 段；段数不足 → null（该文件补丁跳过）
function stripPath(name: string, p: number): string | null {
  const parts = name.split('/').filter(Boolean);
  if (parts.length <= p) return null;
  return parts.slice(p).join('/');
}
// 把 hunk 序列应用到文件行数组：先精确位置，再按 GNU 偏移扫描找唯一匹配；失败返回 null（原子不写）
function applyPatchToLines(fileLines: string[], hunks: PatchHunk[]): string[] | null {
  let lines = fileLines.slice();
  let drift = 0; // 已应用 hunk 带来的行数漂移
  for (const hk of hunks) {
    const oldImg = hk.lines.filter((l) => l[0] === ' ' || l[0] === '-').map((l) => l.slice(1));
    const newImg = hk.lines.filter((l) => l[0] === ' ' || l[0] === '+').map((l) => l.slice(1));
    const base0 = hk.aStart === 0 ? 0 : hk.aStart - 1;
    const expected = base0 + drift;
    const max = lines.length - oldImg.length;
    const cands: number[] = [];
    const push = (p: number) => {
      if (p >= 0 && p <= max && !cands.includes(p)) cands.push(p);
    };
    push(expected);
    for (let d = 1; d <= Math.max(max, 1); d++) {
      push(expected + d);
      push(expected - d);
    }
    let at = -1;
    for (const p of cands) {
      if (oldImg.every((l, i) => lines[p + i] === l)) {
        at = p;
        break;
      }
    }
    if (at < 0) return null;
    lines = [...lines.slice(0, at), ...newImg, ...lines.slice(at + oldImg.length)];
    drift = at - base0 + (newImg.length - oldImg.length);
  }
  return lines;
}

// USTAR 头（512B）：name/mode/uid/gid/size/mtime/chksum/typeflag/linkname/magic/version/uname/gname/dev/prefix
interface TarHeaderOpts {
  name: string;
  mode: number;
  size: number;
  mtime: number; // ms
  dir: boolean;
  uname?: string;
}
function ustarHeader(e: TarHeaderOpts): Uint8Array {
  const h = new Uint8Array(512);
  const wr = (off: number, str: string, len: number) => h.set(te.encode(str).subarray(0, len - 1), off);
  const oct = (v: number, len: number) => v.toString(8).padStart(len - 1, '0');
  // 长名拆分 prefix/name（POSIX ustar 方式；拆不下就截断兜底）
  let name = e.name;
  let prefix = '';
  if (te.encode(name).length > 99) {
    const parts = name.split('/');
    name = parts.pop() ?? name;
    prefix = parts.join('/');
    if (te.encode(name).length > 99 || te.encode(prefix).length > 154) {
      name = e.name.slice(-99);
      prefix = '';
    }
  }
  wr(0, name, 100);
  wr(100, oct(e.mode & 0o7777, 8), 8);
  wr(108, oct(0, 8), 8); // uid
  wr(116, oct(0, 8), 8); // gid
  wr(124, oct(e.size, 12), 12);
  wr(136, oct(Math.floor(e.mtime / 1000), 12), 12);
  for (let i = 0; i < 8; i++) h[148 + i] = 0x20; // chksum 先按空格参与求和
  h[156] = e.dir ? 0x35 : 0x30; // '5'=目录 '0'=普通文件
  wr(257, 'ustar', 6);
  h[263] = 0x30;
  h[264] = 0x30; // version "00"
  wr(265, e.uname ?? 'qiezi', 32);
  wr(297, 'qiezi', 32); // gname
  wr(345, prefix, 155);
  let sum = 0;
  for (const b of h) sum += b;
  wr(148, sum.toString(8).padStart(6, '0'), 7);
  h[155] = 0x20;
  return h;
}
interface TarEntry {
  name: string;
  mode: number;
  size: number;
  mtime: number;
  dir: boolean;
  data: Uint8Array;
}
function parseUstar(bytes: Uint8Array): TarEntry[] | null {
  const entries: TarEntry[] = [];
  let off = 0;
  const zstr = (b: Uint8Array) => {
    const i = b.indexOf(0);
    return td.decode(i < 0 ? b : b.subarray(0, i));
  };
  const oct = (b: Uint8Array) => parseInt(zstr(b).trim() || '0', 8) || 0;
  while (off + 512 <= bytes.length) {
    const h = bytes.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break; // 结束零块
    const magic = zstr(h.subarray(257, 263));
    if (magic !== 'ustar') return null; // 非 ustar 归档
    const name = zstr(h.subarray(0, 100));
    const prefix = zstr(h.subarray(345, 500));
    const size = oct(h.subarray(124, 136));
    off += 512;
    if (off + size > bytes.length) return null; // 数据截断
    entries.push({
      name: prefix ? prefix + '/' + name : name,
      mode: oct(h.subarray(100, 108)),
      size,
      mtime: oct(h.subarray(136, 148)) * 1000,
      dir: h[156] === 0x35,
      data: bytes.subarray(off, off + size),
    });
    off += Math.ceil(size / 512) * 512;
  }
  return entries;
}
// 自 baseId 逐级确保目录存在（mkdir -p 语义），返回末级目录 id；同名文件挡路 → null
function ensureDir(baseId: string, parts: string[]): string | null {
  let cur = baseId;
  for (const p of parts) {
    const exist = children(cur).find((n) => n.name === p);
    if (exist) {
      if (exist.type !== 'dir') return null;
      cur = exist.id;
    } else {
      cur = createDir(cur, p);
    }
  }
  return cur;
}
// 八进制权限位 → rwx 九字符（不含类型前缀；permissions.modeStr 要整节点，tar 条目只有数值）
function triadStr(mode: number): string {
  const t = (x: number) => `${x & 4 ? 'r' : '-'}${x & 2 ? 'w' : '-'}${x & 1 ? 'x' : '-'}`;
  return t((mode >> 6) & 7) + t((mode >> 3) & 7) + t(mode & 7);
}

// glob（* ? […]）→ 整串匹配的正则。M31：ESC 转义对 → 字面字符（\* \? 不再当通配符）。
// M38 字符类：[abc] [a-z] [!a] [^a]；] 紧跟开头算字面成员；未闭合的 [ 按字面（bash 同款）。
function globToRe(glob: string): RegExp {
  const reEsc = (ch: string) => ch.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === ESC && i + 1 < glob.length) {
      re += reEsc(glob[++i]);
      continue;
    }
    if (c === '*') {
      re += '.*';
      continue;
    }
    if (c === '?') {
      re += '.';
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      let neg = '';
      if (glob[j] === '!' || glob[j] === '^') {
        neg = '^';
        j++;
      }
      let body = '';
      if (glob[j] === ']') {
        body += '\\]'; // ] 首位是字面成员
        j++;
      }
      while (j < glob.length && glob[j] !== ']') {
        body += glob[j] === '\\' ? '\\\\' : glob[j]; // 类内只需转义反斜杠（] 被循环条件排除）
        j++;
      }
      if (glob[j] === ']' && body !== '') {
        re += '[' + neg + body + ']';
        i = j;
        continue;
      }
      re += '\\['; // 未闭合/空类 → 字面 [
      continue;
    }
    re += reEsc(c);
  }
  return new RegExp(re + '$');
}
// M31：词内是否有未转义的 glob 字符（* ? [）——ESC 转义的不算
function hasGlob(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ESC) {
      i++;
      continue;
    }
    if (s[i] === '*' || s[i] === '?' || s[i] === '[') return true;
  }
  return false;
}
// M38 路径名展开（pathname expansion）：模式按 / 切段逐层下钻 VFS。
// 段无通配 → 按名字面下钻（任一层不存在 → 整体无匹配）；段有通配 → globToRe 匹配该层 children。
// bash 语义：段首显式 . 才匹配隐藏文件；绝对模式从根起且结果带 / 前缀，相对模式结果保持相对形态；
// 尾随 / 只匹配目录；命中按字典序排序；无匹配返回 null（调用方放原词——默认 nullglob off）。
// 已知取舍：. / .. 段不特殊解析（查无此名 → 原样保留）；虚拟挂载（/proc /dev）不参与展开。
function globExpand(pat: string, ctx: ShellCtx): string[] | null {
  const absolute = pat.startsWith('/');
  const dirOnly = pat.length > 1 && pat.endsWith('/');
  const segs = pat.split('/').filter((s) => s !== '');
  if (!segs.length) return null;
  let cur: { id: string; path: string }[] = [{ id: absolute ? 'root' : ctx.cwd, path: '' }];
  for (const seg of segs) {
    const next: { id: string; path: string }[] = [];
    if (hasGlob(seg)) {
      const re = globToRe(seg);
      const dotOk = seg.startsWith('.');
      for (const { id, path } of cur) {
        if (getNode(id)?.type !== 'dir') continue;
        for (const n of children(id)) {
          if (!dotOk && n.name.startsWith('.')) continue;
          if (re.test(n.name)) next.push({ id: n.id, path: `${path}/${n.name}` });
        }
      }
    } else {
      const lit = stripEsc(seg);
      for (const { id, path } of cur) {
        if (getNode(id)?.type !== 'dir') continue;
        const hit = children(id).find((n) => n.name === lit);
        if (hit) next.push({ id: hit.id, path: `${path}/${lit}` });
      }
    }
    cur = next;
    if (!cur.length) return null;
  }
  if (dirOnly) cur = cur.filter(({ id }) => getNode(id)?.type === 'dir');
  if (!cur.length) return null;
  return cur.map(({ path }) => (absolute ? path : path.slice(1)) + (dirOnly ? '/' : '')).sort();
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
    // M49.2：-v 变量已设（含空串）；-s 文件存在且非空
    if (op === '-v') return val in ctx.env;
    if (op === '-e' || op === '-f' || op === '-d') {
      const id = resolvePath(ctx.cwd, val);
      const n = id ? getNode(id) : undefined;
      if (!n) return false;
      if (op === '-d') return n.type === 'dir';
      if (op === '-f') return n.type === 'file';
      return true; // -e：存在即可
    }
    if (op === '-s') {
      const id = resolvePath(ctx.cwd, val);
      const n = id ? getNode(id) : undefined;
      if (!n || n.type !== 'file') return false;
      return n.kind === 'binary' ? (n.size ?? 0) > 0 : n.content.length > 0;
    }
    // M43.2：-r/-w/-x 权限测试（当前用户视角，root 全真）
    if (op === '-r' || op === '-w' || op === '-x') {
      const id = resolvePath(ctx.cwd, val);
      const n = id ? getNode(id) : undefined;
      if (!n) return false;
      return permits(n, ctx.env.USER, op === '-r' ? 4 : op === '-w' ? 2 : 1);
    }
    // M53.7：-L/-h 软链（lresolvePath 最后一段不跟随，悬空链接亦为真）
    if (op === '-L' || op === '-h') {
      const id = lresolvePath(ctx.cwd, val);
      const n = id ? getNode(id) : undefined;
      return !!n && n.linkTo !== undefined;
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
    // M49.2：-nt/-ot 新旧比较（按 updatedAt）
    if (op === '-nt' || op === '-ot') {
      const na = getNode(resolvePath(ctx.cwd, a) ?? '');
      const nb = getNode(resolvePath(ctx.cwd, b) ?? '');
      if (!na || !nb) return false;
      return op === '-nt' ? na.updatedAt > nb.updatedAt : na.updatedAt < nb.updatedAt;
    }
    return false;
  }
  return false;
}

// ── M43：[[ … ]] 条件求值（bash 语义）──────────────────────
// 与 test/[ ] 的差异：不做路径名展开（* ? 不 glob）；不做分词（引号内空格一词）；
// && || ! ( ) 是条件算符而非连接符；==/!= 的 rhs 未加引号时是模式匹配（globToRe 全串匹配）；
// =~ 正则（rhs 加引号按字面）；< > 字典序。
// 已知取舍：变量未定义展开成空词但保留（[[ $UNDEF == x ]] → 假）——与命令参数的「空词删除」相反，bash 同款。
const COND_UNARY = new Set(['-e', '-f', '-d', '-z', '-n', '-r', '-w', '-x', '-v', '-s', '-L', '-h']);
const COND_BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '=~', '-nt', '-ot']);

interface CondWord {
  text: string;
  q: '"' | "'" | null;
}

function condUnary(op: string, val: string, ctx: ShellCtx): boolean {
  if (op === '-z') return val === '';
  if (op === '-n') return val !== '';
  // M49.2：-v 变量已设（含空串）
  if (op === '-v') return val in ctx.env;
  const id = resolvePath(ctx.cwd, val);
  const n = id ? getNode(id) : undefined;
  if (op === '-e') return !!n;
  // M53.7：-L/-h 软链（须在 !n 短路前判：悬空链接 resolvePath 跟随失败，但 -L 仍为真）
  if (op === '-L' || op === '-h') {
    const lid = lresolvePath(ctx.cwd, val);
    const ln = lid ? getNode(lid) : undefined;
    return !!ln && ln.linkTo !== undefined;
  }
  if (!n) return false;
  if (op === '-d') return n.type === 'dir';
  if (op === '-f') return n.type === 'file';
  // M49.2：-s 文件存在且非空
  if (op === '-s') return n.type === 'file' && (n.kind === 'binary' ? (n.size ?? 0) > 0 : n.content.length > 0);
  // M43.2：-r/-w/-x 权限测试（当前用户视角，root 全真）
  if (op === '-r' || op === '-w' || op === '-x') return permits(n, ctx.env.USER, op === '-r' ? 4 : op === '-w' ? 2 : 1);
  return false;
}

// 二元算符求值。=~ 可能抛「无效的正则表达式」（→ 码 2）。
// M49.2：-nt/-ot 需 ctx 访问文件系统，新增 ctx 参数。
function condBinary(a: string, op: string, b: CondWord, ctx: ShellCtx): boolean {
  // ==/!=：rhs 未加引号 → 模式匹配（无通配符时等价字面全串匹配）；加引号 → 纯字面
  if (op === '=' || op === '==') return b.q === null ? globToRe(b.text).test(a) : a === b.text;
  if (op === '!=') return !(b.q === null ? globToRe(b.text).test(a) : a === b.text);
  if (op === '=~') {
    let re: RegExp;
    try {
      re = b.q === null ? new RegExp(b.text) : new RegExp(b.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    } catch {
      throw new Error(`无效的正则表达式：${b.text}`);
    }
    return re.test(a);
  }
  if (op === '<') return a < b.text;
  if (op === '>') return a > b.text;
  if (op === '-eq') return Number(a) === Number(b.text);
  if (op === '-ne') return Number(a) !== Number(b.text);
  if (op === '-lt') return Number(a) < Number(b.text);
  if (op === '-le') return Number(a) <= Number(b.text);
  if (op === '-gt') return Number(a) > Number(b.text);
  if (op === '-ge') return Number(a) >= Number(b.text);
  // M49.2：-nt/-ot 新旧比较（按 updatedAt）
  if (op === '-nt' || op === '-ot') {
    const na = getNode(resolvePath(ctx.cwd, a) ?? '');
    const nb = getNode(resolvePath(ctx.cwd, b.text) ?? '');
    if (!na || !nb) return false;
    return op === '-nt' ? na.updatedAt > nb.updatedAt : na.updatedAt < nb.updatedAt;
  }
  return false;
}

// 求值 [[ 与 ]] 之间的条件文本。返回 { ok } 或 { err }（语法/正则错误 → 调用方报错码 2）。
async function evalCond(body: string, ctx: ShellCtx): Promise<{ ok: boolean } | { err: string }> {
  // 展开变量/命令/算术（subst），但不做 glob、不拆重定向；引号标记保留给 ==/!=/=~ 的 rhs 判定
  const words: CondWord[] = [];
  for (const t of tokenize(body)) {
    for (const v0 of t.q === null ? braceExpand(t.text) : [t.text]) {
      const v = t.q === null ? tildeExpand(v0, ctx.env.HOME ?? '/', userHome) : v0;
      words.push({ text: stripEsc(await subst(v, ctx, t.q)), q: t.q });
    }
  }
  let pos = 0;
  function parseOr(): boolean {
    let v = parseAnd();
    while (words[pos]?.text === '||' && words[pos]?.q === null) {
      pos++;
      const r = parseAnd();
      v = v || r;
    }
    return v;
  }
  function parseAnd(): boolean {
    let v = parseNot();
    while (words[pos]?.text === '&&' && words[pos]?.q === null) {
      pos++;
      const r = parseNot();
      v = v && r;
    }
    return v;
  }
  function parseNot(): boolean {
    if (words[pos]?.text === '!' && words[pos]?.q === null) {
      pos++;
      return !parseNot();
    }
    return parsePrimary();
  }
  function parsePrimary(): boolean {
    const t = words[pos];
    if (!t) throw new Error('条件表达式不完整');
    if (t.text === '(' && t.q === null) {
      pos++;
      const v = parseOr();
      if (words[pos]?.text !== ')' || words[pos]?.q !== null) throw new Error('缺少 )');
      pos++;
      return v;
    }
    const next = words[pos + 1];
    if (next && t.q === null && COND_UNARY.has(t.text)) {
      pos += 2;
      return condUnary(t.text, next.text, ctx);
    }
    if (next && next.q === null && COND_BINARY.has(next.text)) {
      const rhs = words[pos + 2];
      if (!rhs) throw new Error(`${next.text} 之后缺少参数`);
      pos += 3;
      return condBinary(t.text, next.text, rhs, ctx);
    }
    pos++; // 单参：非空字符串为真
    return t.text !== '';
  }
  if (!words.length) return { err: '缺少条件表达式' };
  try {
    const v = parseOr();
    if (pos !== words.length) return { err: `意外的参数 ${words[pos].text}` };
    return { ok: v };
  } catch (e) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
}

// M43.2：chmod 符号模式求值——按逗号分子句逐条套用 who+op+perms。
// who 省略 = a（三段全套）；op：+ 加位 / - 减位 / = 该段精确赋值。（无 umask 概念，记录在案）
function applySymbolicMode(mode: number, spec: string): number {
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([+-=])([rwx]+)$/.exec(clause);
    if (!m) continue; // 调用方已整串校验，这里兜底跳过
    const [, whoRaw, op, perms] = m;
    const bits = (perms.includes('r') ? 4 : 0) | (perms.includes('w') ? 2 : 0) | (perms.includes('x') ? 1 : 0);
    for (const w of new Set((whoRaw || 'a').replaceAll('a', 'ugo'))) {
      const shift = w === 'u' ? 6 : w === 'g' ? 3 : 0;
      const triad = (mode >> shift) & 7;
      const next = op === '+' ? triad | bits : op === '-' ? triad & ~bits & 7 : bits;
      mode = (mode & ~(7 << shift)) | (next << shift);
    }
  }
  return mode;
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

// M52.6 pushd/popd/dirs：目录栈渲染（节点 id → 路径字符串，空格分隔，栈顶在右）。
function dirStackLines(stack: string[]): string {
  return stack.map((id) => pathOf(id)).join(' ');
}

// 权限判定（nodeMode/modeStr/permits）已抽到 system/permissions.ts，终端与 GUI 共用一套。

// 命令收到上游/重定向来的 stdin（无则空串），返回 stdout/stderr/退出码（可同步或异步——curl 等用 Promise）
type CmdFn = (args: string[], ctx: ShellCtx, stdin: string) => CmdResult | Promise<CmdResult>;

let sourceDepth = 0; // source 嵌套深度（防循环 source 把栈打爆）
let evalDepth = 0; // M44.3 eval 递归深度（x='eval $x' 自引用防栈爆）

// 信号号 → 名（kill -9 等）。本系统映射：TERM/KILL/HUP/INT→关闭，STOP→挂起，CONT→恢复
const SIGNALS: Record<number, string> = { 1: 'HUP', 2: 'INT', 9: 'KILL', 15: 'TERM', 18: 'CONT', 19: 'STOP' };

// M37：break/continue [n] 共用实现 —— 置 loopCtl 信号（循环边界消费：n=1 本层生效并清除，
// n>1 递减后向上传）。循环外是警告非致命（bash 同款，退出码 0）；n 非正整数报错码 1、不置信号。
function loopCtlCmd(args: string[], ctx: ShellCtx, op: 'break' | 'continue'): CmdResult {
  let n = 1;
  if (args.length) {
    n = Number(args[0]);
    if (!Number.isInteger(n) || n < 1)
      return { out: '', err: `qzsh: ${op}: ${args[0]}: 需要正整数参数`, code: 1 };
  }
  if ((ctx.loopDepth ?? 0) === 0)
    return { out: '', err: `qzsh: ${op}: 只有在循环中才有意义`, code: 0 };
  ctx.loopCtl = { op, n };
  return { out: '', code: 0 };
}

// ── M51.1 date 辅助：strftime 格式化 + 时间字符串解析 ─────────────
// 支持 GNU date 常用格式符：%Y %y %m %d %H %M %S %j %s %w %A %a %B %b %Z %z %%
function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}
const WD_CN = ['日', '一', '二', '三', '四', '五', '六'];
function fmtDate(d: Date, fmt: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  let out = '';
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === '%' && i + 1 < fmt.length) {
      const c = fmt[++i];
      switch (c) {
        case 'Y': out += d.getFullYear(); break;
        case 'y': out += String(d.getFullYear()).slice(-2); break;
        case 'm': out += pad(d.getMonth() + 1); break;
        case 'd': out += pad(d.getDate()); break;
        case 'H': out += pad(d.getHours()); break;
        case 'M': out += pad(d.getMinutes()); break;
        case 'S': out += pad(d.getSeconds()); break;
        case 'j': out += pad(dayOfYear(d), 3); break;
        case 's': out += Math.floor(d.getTime() / 1000); break;
        case 'w': out += d.getDay(); break;
        case 'A': out += `星期${WD_CN[d.getDay()]}`; break;
        case 'a': out += `周${WD_CN[d.getDay()]}`; break;
        case 'B': out += `${d.getMonth() + 1}月`; break;
        case 'b': out += `${d.getMonth() + 1}月`; break;
        case 'Z': out += Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local'; break;
        case 'z': {
          const off = -d.getTimezoneOffset();
          out += `${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`;
          break;
        }
        case '%': out += '%'; break;
        default: out += '%' + c; break; // 未知格式符原样保留
      }
    } else out += fmt[i];
  }
  return out;
}
// 解析 -d 时间字符串。纯日期 YYYY-MM-DD 或日期+时间当作本地时间（非 UTC）。
function parseDateStr(s: string): Date | null {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m1) {
    const Y = Number(m1[1]), Mo = Number(m1[2]) - 1, D = Number(m1[3]);
    const d = new Date(Y, Mo, D);
    if (isNaN(d.getTime()) || d.getFullYear() !== Y || d.getMonth() !== Mo || d.getDate() !== D) return null;
    return d;
  }
  const m2 = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m2) {
    const Y = Number(m2[1]), Mo = Number(m2[2]) - 1, D = Number(m2[3]), H = Number(m2[4]), Mi = Number(m2[5]), S = Number(m2[6]);
    const d = new Date(Y, Mo, D, H, Mi, S);
    if (isNaN(d.getTime()) || d.getFullYear() !== Y || d.getMonth() !== Mo || d.getDate() !== D ||
        d.getHours() !== H || d.getMinutes() !== Mi || d.getSeconds() !== S) return null;
    return d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ── M51.4 uptime：shell 模块加载时刻作为系统启动时间 ──────────────
const BOOT_TIME = Date.now();

// ── M51.5 cal 辅助：单月/全年日历渲染 ─────────────
function renderMonth(year: number, month: number): string {
  const monthName = `${month}月`;
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=周日
  const daysInMonth = new Date(year, month, 0).getDate();
  const lines = [`      ${monthName} ${year}`, '日 一 二 三 四 五 六'];
  let line = '';
  for (let i = 0; i < firstDay; i++) line += '   ';
  for (let d = 1; d <= daysInMonth; d++) {
    line += String(d).padStart(2, ' ');
    if ((firstDay + d) % 7 === 0 || d === daysInMonth) {
      lines.push(line.replace(/\s+$/, ''));
      line = '';
    } else {
      line += ' ';
    }
  }
  return lines.join('\n');
}
function renderYear(year: number): string {
  const blocks = [`                              ${year}`];
  for (let m = 1; m <= 12; m++) blocks.push(renderMonth(year, m));
  return blocks.join('\n\n');
}

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
      '  if/then/fi · for…in…do…done · while · test/[ ]/[[ ]] · trap · sh 脚本.sh —— 脚本/控制流\n' +
      '  date theme clear  man <命令>（详细用法）\n' +
      '支持：$VAR 变量、" " 引号、\X 转义、{a,b} 花括号、~ 波浪号、$(cmd)/$((x)) 替换、管道 | 、重定向 > >> < 2>、; && || 序列、末尾 & 后台、!!/!n/!str 历史展开。\n' +
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
  // M51.1 date 增强：-u UTC、-d 解析时间串、+FORMAT strftime 格式化
  date: (args) => {
    let utc = false;
    let dateStr = '';
    let fmt = '';
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-u') utc = true;
      else if (a === '-d' || a === '--date') dateStr = args[++i] ?? '';
      else if (a.startsWith('+')) fmt = a.slice(1);
    }
    let d: Date;
    if (dateStr) {
      const parsed = parseDateStr(dateStr);
      if (!parsed) return { out: '', err: `date: 无效的时间字符串 "${dateStr}"`, code: 1 };
      d = parsed;
    } else {
      d = new Date();
    }
    if (!fmt) {
      // 默认输出本地时间字符串（-u 时用 UTC 字符串）
      return { out: utc ? d.toUTCString() : d.toLocaleString('zh-CN'), code: 0 };
    }
    // 格式化：-u 时用 UTC 方法取值
    if (utc) {
      const ud = new Date(d.getTime());
      // 借用本地方法：把 UTC 字段塞进一个用本地时区表示相同时刻的 Date
      const shifted = new Date(ud.getTime() + ud.getTimezoneOffset() * 60000);
      return { out: fmtDate(shifted, fmt), code: 0 };
    }
    return { out: fmtDate(d, fmt), code: 0 };
  },
  clear: () => ({ out: '', code: 0, clear: true }),
  echo: (args) => ({ out: args.join(' '), code: 0 }),

  // M46.1 read：从 stdin 读一行到变量。支持 -r（原样保留反斜杠，本 shell 不续行故无行为差异，
  // 接受标志即可）、-p "prompt"（提示走 stderr）、多变量按 IFS（默认空白）分词、最后一个变量取剩余。
  // 无 stdin（EOF）返回 1。无变量名消费一行返回 0。已知限制：stdin 是快照模型（非流），
  // `while read line; do …; done < file` 无法逐行消费（每次迭代拿到同一份 stdin）——bash 的流式
  // 逐行读取需要 stdin 游标，本 shell 架构不支持，记录在案。
  read: (args, ctx, stdin) => {
    let prompt = '';
    const names: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-r') continue; // 接受 -r，行为无差异（不续行）
      if (a === '-p') { prompt = args[++i] ?? ''; continue; }
      if (a.startsWith('-p') && a.length > 2) { prompt = a.slice(2); continue; } // -pprompt 粘连
      if (a === '--') { names.push(...args.slice(i + 1)); break; }
      names.push(a);
    }
    const err = prompt || undefined;
    if (stdin === '') return { out: '', err, code: 1 }; // EOF
    const nl = stdin.indexOf('\n');
    const line = nl === -1 ? stdin : stdin.slice(0, nl);
    if (!names.length) return { out: '', err, code: 0 }; // 无变量名，消费一行
    if (names.length === 1) {
      ctx.env[names[0]] = line;
      return { out: '', err, code: 0 };
    }
    // 多变量按 IFS（默认空白）分词，最后一个取剩余（剩余字段用单空格连接）
    const fields = line.split(/[ \t]+/).filter(Boolean);
    for (let i = 0; i < names.length; i++) {
      ctx.env[names[i]] = i < names.length - 1 ? (fields[i] ?? '') : fields.slice(i).join(' ');
    }
    return { out: '', err, code: 0 };
  },

  // M46.2 printf：格式化输出。支持 %s %d %f(.N 精度) %x %X %o %c %% 与 \n \t \r \\ 等转义。
  // 格式串循环消费参数（参数多于占位符时重复扫描直到耗尽）；参数不足：%s 补空串、数值补 0。
  // 转义在格式串层处理（双引号内 \n 是字面反斜杠+n，printf 负责解释为换行）——与 bash 一致。
  printf: (args) => {
    if (!args.length) return { out: '', err: 'printf: 缺少格式串', code: 1 };
    // 转义序列解释（\n \t \r \\ \" \' \a \b \f \v \0；未知保留原样）
    const unesc = (s: string) => s.replace(/\\(.)/g, (_m, c: string) => {
      switch (c) {
        case 'n': return '\n'; case 't': return '\t'; case 'r': return '\r';
        case '\\': return '\\'; case '"': return '"'; case "'": return "'";
        case 'a': return '\x07'; case 'b': return '\b'; case 'f': return '\f';
        case 'v': return '\v'; case '0': return '\0';
        default: return '\\' + c;
      }
    });
    const fmt = unesc(args[0]);
    const params = args.slice(1);
    let out = '';
    let idx = 0;
    for (;;) {
      let consumed = false;
      let i = 0;
      while (i < fmt.length) {
        if (fmt[i] !== '%') { out += fmt[i++]; continue; }
        i++;
        if (fmt[i] === '%') { out += '%'; i++; continue; }
        let prec = -1;
        if (fmt[i] === '.') { i++; let p = ''; while (/\d/.test(fmt[i] ?? '')) p += fmt[i++]; prec = parseInt(p) || 0; }
        const spec = fmt[i++] ?? '';
        const arg = idx < params.length ? params[idx++] : (spec === 's' ? '' : '0');
        consumed = true;
        switch (spec) {
          case 's': out += prec >= 0 ? arg.slice(0, prec) : arg; break;
          case 'd': case 'i': out += String(Math.trunc(Number(arg) || 0)); break;
          case 'f': { const n = Number(arg) || 0; out += prec >= 0 ? n.toFixed(prec) : String(n); break; }
          case 'x': out += (Math.trunc(Number(arg) || 0) >>> 0).toString(16); break;
          case 'X': out += (Math.trunc(Number(arg) || 0) >>> 0).toString(16).toUpperCase(); break;
          case 'o': out += (Math.trunc(Number(arg) || 0) >>> 0).toString(8); break;
          case 'c': out += arg[0] ?? ''; break;
          default: out += '%' + (prec >= 0 ? '.' + prec : '') + spec;
        }
      }
      if (!consumed || idx >= params.length) break;
    }
    return { out, code: 0 };
  },

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
  // M32：文件名后的实参作为脚本位置参数；脚本内 return 提前结束（信号在此边界清除并转为退出码）。
  source: async (args, ctx) => {
    const f = args[0];
    if (!f) return { out: '', err: 'source: 用法 source <文件>', code: 2 };
    if (sourceDepth >= 25) return { out: '', err: 'source: 嵌套过深（疑似循环）', code: 1 };
    const r = readFileText(ctx, f);
    if (r.err) return { out: '', err: `source: ${r.err}`, code: 1 };
    sourceDepth++;
    const savedPos = ctx.positional;
    ctx.positional = args.slice(1);
    try {
      const res = await run(r.text ?? '', ctx); // 整文件解释执行（多行 if/for/while 都能跨行）
      if (ctx.retFlag) {
        const c = ctx.retFlag.code;
        ctx.retFlag = null;
        return { ...res, code: c };
      }
      return res;
    } finally {
      sourceDepth--;
      ctx.positional = savedPos;
    }
  },
  '.': (args, ctx, stdin) => COMMANDS.source(args, ctx, stdin), // `.` 是 source 的别名
  sh: (args, ctx, stdin) => COMMANDS.source(args, ctx, stdin), // sh <脚本> 跑脚本文件（同 source）
  // M32 return：函数/脚本内提前返回（retFlag 信号，边界清除）；无参用上个命令退出码；& 0xff 截断。
  return: (args, ctx) => {
    if ((ctx.funcDepth ?? 0) === 0 && sourceDepth === 0)
      return { out: '', err: 'return: 只能在函数或脚本内使用', code: 1 };
    let code = ctx.code; // bash：无参 return 沿用 $?
    if (args[0] !== undefined) {
      if (!/^-?\d+$/.test(args[0])) return { out: '', err: `return: ${args[0]}: 需要数字参数`, code: 2 };
      code = Number(args[0]) & 0xff; // bash：退出码截断到 0-255（return -1 → 255）
    }
    ctx.retFlag = { code };
    return { out: '', code };
  },
  // M37 break/continue [n]：置 loopCtl 信号，循环边界消费（n>1 逐层递减外传）。
  // 循环外使用：bash 是警告 + 退出码 0（不致命、脚本照跑）；参数非正整数 → 码 1 不置信号。
  break: (args, ctx) => loopCtlCmd(args, ctx, 'break'),
  continue: (args, ctx) => loopCtlCmd(args, ctx, 'continue'),
  // POSIX 内建：true 恒 0、false 恒 1（脚本条件/占位的最小命令）
  true: () => ({ out: '', code: 0 }),
  false: () => ({ out: '', code: 1 }),
  // M43.3 trap：注册/列举/重置信号陷阱（仅 INT/EXIT）。INT 在最外层 run 边界触发（Ctrl+C → 130 时），
  // EXIT 在最外层脚本边界触发（fireExitTrap）。`trap - SIG` / `trap '' SIG` 重置（MVP 语义，bash 的 '' 是忽略）。
  trap: (args, ctx) => {
    const traps = (ctx.traps ??= {});
    if (args.length === 0)
      return { out: Object.entries(traps).map(([sig, cmd]) => `trap -- '${cmd}' ${sig}`).join('\n'), code: 0 };
    if (args.length === 1) return { out: '', err: 'trap: 用法: trap [-] [命令] 信号...', code: 2 };
    const [cmd, ...sigs] = args;
    const norm = sigs.map((s) => (s === '0' ? 'EXIT' : s === '2' || s.toUpperCase() === 'SIGINT' ? 'INT' : s));
    const bad = norm.filter((s) => s !== 'INT' && s !== 'EXIT');
    if (bad.length) return { out: '', err: `trap: 不支持的信号: ${bad.join(' ')}（仅 INT/EXIT）`, code: 1 };
    for (const sig of norm) {
      if (cmd === '-' || cmd === '') delete traps[sig];
      else traps[sig] = cmd;
    }
    return { out: '', code: 0 };
  },
  // M44.1 local：函数内声明局部变量。当前帧记录原状态（existed/value），函数返回时恢复。
  // 重声明不带 = 不清值（bash：local x=1; local x 后 x 仍是 1）；带 = 才改值。
  // 已知差异：local 后 unset 该变量，bash 会透出外层值，我们函数返回前是「未设置」（帧恢复在边界）。
  local: (args, ctx) => {
    if ((ctx.funcDepth ?? 0) === 0) return { out: '', err: 'local: 只能在函数中使用', code: 1 };
    if (!args.length) return { out: '', code: 0 };
    const stack = (ctx.locals ??= []);
    // 防御：funcDepth>0 但帧栈空（$(…) fork 未继承帧栈的边角）——现场补一帧，丢弃无害（env 是副本）
    if (!stack.length) stack.push(new Map());
    const frame = stack[stack.length - 1];
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)(=(.*))?$/s.exec(a);
      if (!m) return { out: '', err: `local: 「${a}」不是有效的变量名`, code: 1 };
      const [, name, eq, val] = m;
      const fresh = !frame.has(name);
      if (fresh) frame.set(name, { existed: name in ctx.env, value: ctx.env[name] });
      // 新声明：无 = 遮蔽成空串、有 = 用其值；重声明：仅带 = 时改值
      if (fresh || eq !== undefined) ctx.env[name] = eq !== undefined ? val : '';
    }
    return { out: '', code: 0 };
  },
  // M44.2 set：±e 开关严格模式；无参按序列出全部变量（bash 还列函数，MVP 只变量）。
  set: (args, ctx) => {
    if (!args.length)
      return { out: Object.keys(ctx.env).sort().map((k) => `${k}=${ctx.env[k]}`).join('\n'), code: 0 };
    for (const a of args) {
      if (a === '-e') ctx.errexit = true;
      else if (a === '+e') ctx.errexit = false;
      else return { out: '', err: `set: 不支持的选项: ${a}（仅 ±e）`, code: 2 };
    }
    return { out: '', code: 0 };
  },
  // M44.3 eval：参数空格拼接后作为 shell 文本二次执行（共享 ctx：赋值/cd/定义函数/return 全传染）。
  // 退出码即内部命令退出码；evalDepth 防自引用递归（x='eval $x'）。
  eval: async (args, ctx) => {
    const line = args.join(' ');
    if (!line.trim()) return { out: '', code: 0 };
    if (evalDepth >= 25) return { out: '', err: 'eval: 嵌套过深（疑似循环）', code: 1 };
    evalDepth++;
    try {
      return await run(line, ctx);
    } finally {
      evalDepth--;
    }
  },

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
        // M53.7：软链大小 = 目标路径串长（Unix 惯例），名字后接 -> target
        const size = n.type === 'dir' ? '-' : String(n.linkTo !== undefined ? n.linkTo.length : n.kind === 'binary' ? (n.size ?? 0) : n.content.length);
        return `${modeStr(n)}  ${(n.owner ?? DEFAULT_OWNER).padEnd(6)}  ${size.padStart(7)}  ${fmtTime(n.updatedAt)}  ${n.name}${n.linkTo !== undefined ? ` -> ${n.linkTo}` : ''}${n.type === 'dir' ? '/' : ''}`;
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
    if (args.length < 2) return { out: '', err: 'chmod: 用法 chmod <模式如 644 / u+x / go-w / a=r> <路径...>', code: 2 };
    const modeArg = args[0];
    // M43.2：八进制（644/755）或符号模式（[ugoa][+-=][rwx]，逗号多子句，省略 who = a）
    const isOctal = /^[0-7]{3,4}$/.test(modeArg);
    const isSymbolic = /^[ugoa]*[+-=][rwx]+(,[ugoa]*[+-=][rwx]+)*$/.test(modeArg);
    if (!isOctal && !isSymbolic)
      return { out: '', err: `chmod: ${modeArg}: 无效模式（用八进制 644 / 755，或符号 u+x / go-w / a=r）`, code: 1 };
    for (const p of args.slice(1)) {
      const id = resolvePath(ctx.cwd, p);
      const n = id ? getNode(id) : undefined;
      if (!id || !n) return { out: '', err: `chmod: ${p}: 没有那个文件或目录`, code: 1 };
      setMode(id, isOctal ? parseInt(modeArg, 8) : applySymbolicMode(nodeMode(n), modeArg));
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
    const { flags, rest } = splitFlags(args); // i=忽略大小写 n=行号 r=递归 v=反选 c=计数 E=扩展正则（JS 正则天然 ERE，-E 仅兼容）
    const pattern = rest[0];
    if (pattern == null) return { out: '', err: 'grep: 用法 grep [-vinrcE] 模式 [文件...]', code: 2 };
    const files = rest.slice(1);
    let re: RegExp | null = null;
    try {
      re = new RegExp(pattern, flags.has('i') ? 'i' : '');
    } catch {
      re = null; // 非法正则 → 退化为字面量匹配
    }
    const invert = flags.has('v');
    const countOnly = flags.has('c');
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
      let cnt = 0;
      toLines(text).forEach((ln, i) => {
        if (test(ln)) {
          matched = true;
          cnt++;
          if (!countOnly) results.push((prefix ? prefix + ':' : '') + (flags.has('n') ? i + 1 + ':' : '') + ln);
        }
      });
      if (countOnly) results.push((prefix ? prefix + ':' : '') + String(cnt)); // GNU：单文件裸计数，多文件带前缀
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

  // M53.2 sed：极简流编辑器。地址 N/$//re/ 及 N,M 范围；命令 s///[g]、p、d；-n 静默。
  sed: (args, ctx, stdin) => {
    const { flags, rest } = splitFlags(args);
    const script = rest[0];
    if (script == null) return { out: '', err: 'sed: 用法 sed [-n] 脚本 [文件]', code: 2 };
    const cmds = parseSedScript(script);
    if (!cmds || !cmds.length) return { out: '', err: `sed: ${script}: 无法解析的脚本`, code: 2 };
    const r = inputText(ctx, rest[1] ?? null, stdin);
    if (r.err) return { out: '', err: `sed: ${r.err}`, code: 1 };
    const quiet = flags.has('n');
    const lines = toLines(r.text ?? '');
    const out: string[] = [];
    const states = cmds.map(() => ({ inRange: false }));
    for (let li = 0; li < lines.length; li++) {
      const lc = li + 1;
      const isLast = li === lines.length - 1;
      let ps = lines[li]; // 模式空间
      let deleted = false;
      for (let ci = 0; ci < cmds.length; ci++) {
        const cmd = cmds[ci];
        const st = states[ci];
        const hit = (a: SedAddr) => (a.kind === 'num' ? lc === a.n : a.kind === 'last' ? isLast : a.re.test(ps));
        let active: boolean;
        if (!cmd.a1) active = true;
        else if (!cmd.a2) active = hit(cmd.a1);
        else if (st.inRange) {
          active = true;
          if (hit(cmd.a2)) st.inRange = false;
          else if (cmd.a2.kind === 'num' && lc > cmd.a2.n) st.inRange = false; // N,M：M<N 已越过也收尾
        } else if (hit(cmd.a1)) {
          active = true;
          // GNU：数字第二地址 <= 当前行 → 单行范围，不进入 inRange
          st.inRange = !(cmd.a2.kind === 'num' && cmd.a2.n <= lc);
        } else active = false;
        if (!active) continue;
        if (cmd.op === 'd') {
          deleted = true;
          break; // d 立即进入下一周期
        } else if (cmd.op === 'p') out.push(ps);
        else ps = ps.replace(cmd.re, cmd.rep); // s
      }
      if (!deleted && !quiet) out.push(ps);
    }
    return { out: out.join('\n'), code: 0 };
  },

  // M53.3 awk：极简模式扫描。-F 分隔符；BEGIN/END 块；/re/ 与 NR==N 模式；动作仅 print。
  awk: (args, ctx, stdin) => {
    let fs: string | null = null;
    let prog: string | undefined;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-F') fs = args[++i] ?? null;
      else if (a.startsWith('-F')) fs = a.slice(2);
      else if (prog === undefined) prog = a;
      else files.push(a);
    }
    if (prog == null) return { out: '', err: 'awk: 用法 awk [-F 分隔符] 程序 [文件...]', code: 2 };
    const { begins, ends, rules } = parseAwkProgram(prog);
    if (!begins.length && !ends.length && !rules.length)
      return { out: '', err: `awk: ${prog}: 无法解析的程序`, code: 2 };
    const splitF = (ln: string): string[] =>
      fs != null ? ln.split(fs) : ln.trim() === '' ? [] : ln.trim().split(/\s+/);
    const out: string[] = [];
    for (const b of begins) awkPrintArgs(b, '', [], 0, out);
    let nr = 0;
    const feed = (text: string) => {
      for (const ln of toLines(text)) {
        nr++;
        const fields = splitF(ln);
        for (const r of rules) {
          if (r.re && !r.re.test(ln)) continue;
          if (r.nrEq != null && nr !== r.nrEq) continue;
          awkPrintArgs(r.body, ln, fields, nr, out);
        }
      }
    };
    if (!files.length) feed(stdin);
    else {
      for (const f of files) {
        const r = readFileText(ctx, f);
        if (r.err) return { out: out.join('\n'), err: `awk: ${r.err}`, code: 1 };
        feed(r.text ?? '');
      }
    }
    for (const b of ends) awkPrintArgs(b, '', [], nr, out);
    return { out: out.join('\n'), code: 0 };
  },

  // M53.4 join：按公共字段连接两文件。默认首字段、空白分列、空格输出；-t 分隔、-1/-2 字段、-a 未配对。
  join: (args, ctx) => {
    let t: string | null = null;
    let f1 = 1;
    let f2 = 1;
    let a1 = false;
    let a2 = false;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-t') t = args[++i] ?? null;
      else if (a.startsWith('-t')) t = a.slice(2);
      else if (a === '-1') f1 = parseInt(args[++i] ?? '1', 10) || 1;
      else if (a.startsWith('-1')) f1 = parseInt(a.slice(2), 10) || 1;
      else if (a === '-2') f2 = parseInt(args[++i] ?? '1', 10) || 1;
      else if (a.startsWith('-2')) f2 = parseInt(a.slice(2), 10) || 1;
      else if (a === '-a') {
        const w = args[++i];
        if (w === '1') a1 = true;
        if (w === '2') a2 = true;
      } else if (a.startsWith('-a')) {
        if (a.includes('1')) a1 = true;
        if (a.includes('2')) a2 = true;
      } else if (!a.startsWith('-')) files.push(a);
    }
    if (files.length < 2) return { out: '', err: 'join: 用法 join [-t 分隔符] [-1 N] [-2 N] [-a 1|2] 文件1 文件2', code: 2 };
    const r1 = readFileText(ctx, files[0]);
    if (r1.err) return { out: '', err: `join: ${r1.err}`, code: 1 };
    const r2 = readFileText(ctx, files[1]);
    if (r2.err) return { out: '', err: `join: ${r2.err}`, code: 1 };
    const split = t != null ? (ln: string) => ln.split(t) : (ln: string) => ln.trim().split(/\s+/);
    const ofs = t ?? ' ';
    const rows1 = toLines(r1.text ?? '').map((ln) => split(ln));
    const rows2 = toLines(r2.text ?? '').map((ln) => split(ln));
    // 右文件按键建索引（同键取首行 —— 简化，不做 GNU 的多对多笛卡尔展开）
    const idx2 = new Map<string, string[]>();
    for (const r of rows2) {
      const k = r[f2 - 1] ?? '';
      if (!idx2.has(k)) idx2.set(k, r);
    }
    const out: string[] = [];
    const matched2 = new Set<string>();
    for (const ra of rows1) {
      const k = ra[f1 - 1] ?? '';
      const rest1 = ra.filter((_, x) => x !== f1 - 1);
      const rb = idx2.get(k);
      if (rb) {
        matched2.add(k);
        const rest2 = rb.filter((_, x) => x !== f2 - 1);
        out.push([k, ...rest1, ...rest2].join(ofs));
      } else if (a1) out.push([k, ...rest1].join(ofs));
    }
    if (a2) {
      for (const rb of rows2) {
        const k = rb[f2 - 1] ?? '';
        if (!matched2.has(k)) out.push(rb.join(ofs));
      }
    }
    return { out: out.join('\n'), code: 0 };
  },

  // M53.5 tar：USTAR 归档。c=创建 x=解压 t=列表；f=归档文件（必需）；z=gzip 过滤；v=详细；-C=解压目标目录。
  // 支持传统风格（tar cf …，首参数不带 -）。归档存为二进制文件（blobStore）；
  // 目录递归打包；解压按字节探测文本/二进制还原，已存在文件覆盖；含 ../绝对路径的条目拒绝（防 zip-slip）。
  tar: async (args, ctx) => {
    let mode: 'c' | 'x' | 't' | null = null;
    let useZ = false;
    let verbose = false;
    let archive: string | null = null;
    let targetDir: string | null = null;
    const ops: string[] = [];
    for (let i = 0; i < args.length; i++) {
      let a = args[i];
      if (i === 0 && a && !a.startsWith('-')) a = '-' + a; // 传统风格 tar cf …
      if (a.startsWith('-') && a.length > 1) {
        for (let j = 1; j < a.length; j++) {
          const ch = a[j];
          if (ch === 'c' || ch === 'x' || ch === 't') mode = ch;
          else if (ch === 'z') useZ = true;
          else if (ch === 'v') verbose = true;
          else if (ch === 'f' || ch === 'C') {
            const v = j + 1 < a.length ? a.slice(j + 1) : (args[++i] ?? null);
            if (ch === 'f') archive = v;
            else targetDir = v;
            break; // f/C 吃掉本参数剩余
          } // 其余字母忽略（p/O 等默认即所求语义）
        }
      } else ops.push(a);
    }
    if (!mode) return { out: '', err: 'tar: 需要操作符 c/x/t（用法 tar [c|x|t][zv] -f 归档 [文件...] [-C 目录]）', code: 2 };
    if (!archive) return { out: '', err: 'tar: 缺少归档文件（用 -f 指定）', code: 2 };

    // 读归档字节（t/x 共用）：gzip 魔数自动识别（不强制 -z）
    const readArchive = async (): Promise<{ bytes?: Uint8Array; err?: string }> => {
      const id = resolvePath(ctx.cwd, archive!);
      const n = id ? getNode(id) : undefined;
      if (!id || !n) return { err: `tar: ${archive}: 没有那个文件或目录` };
      if (n.type === 'dir') return { err: `tar: ${archive}: 是一个目录` };
      let bytes = await readFileBytes(n);
      if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const g = await gunzipBytes(bytes);
        if (!g) return { err: `tar: ${archive}: gzip 解压失败（数据损坏）` };
        bytes = g;
      }
      return { bytes };
    };

    if (mode === 'c') {
      if (!ops.length) return { out: '', err: 'tar: 缺少要归档的文件', code: 2 };
      // 展开操作数：条目名 = 命令行所给路径（去尾 / 与头 ./），目录递归
      const items: { name: string; node: VNode }[] = [];
      for (const op of ops) {
        const clean = op.replace(/\/+$/, '').replace(/^\.\//, '');
        const id = resolvePath(ctx.cwd, op);
        const n = id ? getNode(id) : undefined;
        if (!id || !n) return { out: '', err: `tar: ${op}: 没有那个文件或目录`, code: 1 };
        items.push({ name: clean, node: n });
        if (n.type === 'dir') {
          const rec = (pid: string, prefix: string) => {
            for (const c of children(pid)) {
              items.push({ name: `${prefix}/${c.name}`, node: c });
              if (c.type === 'dir') rec(c.id, `${prefix}/${c.name}`);
            }
          };
          rec(id, clean);
        }
      }
      const chunks: Uint8Array[] = [];
      const vlines: string[] = [];
      for (const it of items) {
        const dir = it.node.type === 'dir';
        const data = dir ? new Uint8Array() : await readFileBytes(it.node);
        chunks.push(ustarHeader({ name: it.name, mode: nodeMode(it.node), size: data.length, mtime: it.node.updatedAt, dir, uname: it.node.owner }));
        if (!dir) {
          chunks.push(data);
          const pad = (512 - (data.length % 512)) % 512;
          if (pad) chunks.push(new Uint8Array(pad));
        }
        vlines.push(it.name + (dir ? '/' : ''));
      }
      chunks.push(new Uint8Array(1024)); // 双零块结尾
      const tarBytes = concatBytes(chunks);
      const outBytes = useZ ? await gzipBytes(tarBytes) : tarBytes;
      // 覆盖语义（同 GNU tar cf 截断重建）；归档可带子路径
      const slash = archive.lastIndexOf('/');
      const parentStr = slash >= 0 ? archive.slice(0, slash) || '/' : '.';
      const base = slash >= 0 ? archive.slice(slash + 1) : archive;
      const parentId = resolvePath(ctx.cwd, parentStr);
      if (!parentId || getNode(parentId)?.type !== 'dir') return { out: '', err: `tar: ${parentStr}: 目录不存在`, code: 1 };
      const old = children(parentId).find((n) => n.name === base);
      if (old) {
        if (old.type === 'dir') return { out: '', err: `tar: ${archive}: 是一个目录`, code: 1 };
        trash(old.id);
      }
      await createBinaryFile(parentId, base, new Blob([outBytes as BlobPart], { type: useZ ? 'application/gzip' : 'application/x-tar' }));
      return { out: verbose ? vlines.join('\n') : '', code: 0 };
    }

    const ra = await readArchive();
    if (ra.err) return { out: '', err: ra.err, code: 2 };
    const entries = parseUstar(ra.bytes!);
    if (!entries) return { out: '', err: `tar: ${archive}: 不是有效的 ustar 归档`, code: 2 };

    if (mode === 't') {
      const lines = entries.map((e) =>
        verbose
          ? `${e.dir ? 'd' : '-'}${triadStr(e.mode)} ${String(e.size).padStart(8)} ${e.name}${e.dir ? '/' : ''}`
          : e.name + (e.dir ? '/' : ''),
      );
      return { out: lines.join('\n'), code: 0 };
    }

    // x：解压
    let baseId = ctx.cwd;
    if (targetDir) {
      const tid = resolvePath(ctx.cwd, targetDir);
      if (!tid || getNode(tid)?.type !== 'dir') return { out: '', err: `tar: ${targetDir}: 不是目录`, code: 2 };
      baseId = tid;
    }
    const vlines: string[] = [];
    for (const e of entries) {
      const parts = e.name.split('/').filter((p) => p && p !== '.');
      if (!parts.length || parts.some((p) => p === '..') || e.name.startsWith('/')) continue; // zip-slip 防护
      vlines.push(e.name + (e.dir ? '/' : ''));
      if (e.dir) {
        ensureDir(baseId, parts);
        continue;
      }
      const parentId = ensureDir(baseId, parts.slice(0, -1));
      if (!parentId) continue; // 路径被同名文件挡住 → 跳过该条目
      const fname = parts[parts.length - 1];
      const old = children(parentId).find((n) => n.name === fname);
      if (old) trash(old.id); // 覆盖语义
      if (isTextBytes(e.data)) createFile(parentId, fname, td.decode(e.data));
      else await createBinaryFile(parentId, fname, new Blob([e.data as BlobPart]));
    }
    return { out: verbose ? vlines.join('\n') : '', code: 0 };
  },

  // M53.6 gzip/gunzip：RFC 1952（原生 CompressionStream）。压缩：f → f.gz 并删原文件（-k 保留）；
  // -d 解压（gunzip 等价）；-l 压缩信息（原名取文件名去 .gz、未压缩大小取尾部 ISIZE）。.gz 已存在不覆盖（码 1）。
  gzip: async (args, ctx) => {
    const { flags, rest } = splitFlags(args);
    if (!rest.length) return { out: '', err: 'gzip: 用法 gzip [-dklv] 文件...（gunzip 等价 gzip -d）', code: 2 };
    const decomp = flags.has('d');
    const keep = flags.has('k');
    const list = flags.has('l');
    const outs: string[] = [];
    for (const f of rest) {
      const id = resolvePath(ctx.cwd, f);
      const n = id ? getNode(id) : undefined;
      if (!id || !n) return { out: outs.join('\n'), err: `gzip: ${f}: 没有那个文件或目录`, code: 1 };
      if (n.type === 'dir') return { out: outs.join('\n'), err: `gzip: ${f}: 是一个目录`, code: 1 };
      const parentId = n.parentId ?? 'root';
      if (list) {
        if (!n.name.endsWith('.gz')) return { out: outs.join('\n'), err: `gzip: ${f}: 后缀不是 .gz`, code: 1 };
        const bytes = await readFileBytes(n);
        if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b)
          return { out: outs.join('\n'), err: `gzip: ${f}: 不是 gzip 格式`, code: 1 };
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const usize = dv.getUint32(bytes.length - 4, true); // ISIZE：未压缩大小 mod 2^32
        if (!outs.length) outs.push('  compressed  uncompressed  ratio  name');
        const ratio = usize ? (100 - (bytes.length / usize) * 100).toFixed(1) : '0.0';
        outs.push(`${String(bytes.length).padStart(12)} ${String(usize).padStart(12)}  ${ratio.padStart(5)}%  ${n.name.replace(/\.gz$/, '')}`);
        continue;
      }
      if (!decomp) {
        const gzName = n.name + '.gz';
        if (children(parentId).some((x) => x.name === gzName)) return { out: outs.join('\n'), err: `gzip: ${gzName} 已存在`, code: 1 };
        const gz = await gzipBytes(await readFileBytes(n), n.name);
        await createBinaryFile(parentId, gzName, new Blob([gz as BlobPart], { type: 'application/gzip' }));
        if (!keep) trash(id);
        if (flags.has('v')) outs.push(`${f}: → ${gzName}`);
      } else {
        if (!n.name.endsWith('.gz')) return { out: outs.join('\n'), err: `gzip: ${f}: 后缀不是 .gz`, code: 1 };
        const raw = await gunzipBytes(await readFileBytes(n));
        if (!raw) return { out: outs.join('\n'), err: `gzip: ${f}: 解压失败（非 gzip 或数据损坏）`, code: 1 };
        const outName = n.name.replace(/\.gz$/, '');
        if (children(parentId).some((x) => x.name === outName)) return { out: outs.join('\n'), err: `gzip: ${outName} 已存在`, code: 1 };
        if (isTextBytes(raw)) createFile(parentId, outName, td.decode(raw));
        else await createBinaryFile(parentId, outName, new Blob([raw as BlobPart]));
        if (!keep) trash(id);
        if (flags.has('v')) outs.push(`${f}: → ${outName}`);
      }
    }
    return { out: outs.join('\n'), code: 0 };
  },
  gunzip: async (args, ctx) => COMMANDS.gzip(['-d', ...args], ctx, '') as Promise<CmdResult>, // 等价 gzip -d（重复 -d 无害）

  // M53.7 ln：链接。-s 软链（可悬空；相对目标基于链接所在目录，由 resolvePath 透明跟随）；
  // 默认硬链——VFS 树模型（单 parentId）无法共享节点，模拟为同内容/同权限副本（事后各自独立）。
  // -f：落点已存在时先删除旧项。链接名缺省 = basename(目标)；落点是目录则放进其内。
  ln: async (args, ctx) => {
    let symbolic = false;
    let force = false;
    const ops: string[] = [];
    for (const a of args) {
      if (a.startsWith('-') && a.length > 1)
        for (const ch of a.slice(1)) {
          if (ch === 's') symbolic = true;
          else if (ch === 'f') force = true;
        }
      else ops.push(a);
    }
    const [target, nameArg] = ops;
    if (!target) return { out: '', err: 'ln: 用法 ln [-s] [-f] 目标 [链接名]', code: 2 };
    const base = target.replace(/\/+$/, '').split('/').pop() ?? target;
    let parentId = ctx.cwd;
    let linkName = nameArg ?? base;
    if (nameArg) {
      const nid = resolvePath(ctx.cwd, nameArg);
      if (nid && getNode(nid)?.type === 'dir') {
        parentId = nid;
        linkName = base;
      } else {
        const slash = nameArg.lastIndexOf('/');
        const pStr = slash >= 0 ? nameArg.slice(0, slash) || '/' : '.';
        linkName = slash >= 0 ? nameArg.slice(slash + 1) : nameArg;
        const pid = resolvePath(ctx.cwd, pStr);
        if (!pid || getNode(pid)?.type !== 'dir') return { out: '', err: `ln: ${pStr}: 目录不存在`, code: 1 };
        parentId = pid;
      }
    }
    const existing = children(parentId).find((x) => x.name === linkName);
    if (existing) {
      if (!force) return { out: '', err: `ln: ${linkName}: 文件已存在`, code: 1 };
      trash(existing.id);
    }
    if (symbolic) {
      createSymlink(parentId, linkName, target);
      return { out: '', code: 0 };
    }
    // 硬链（模拟副本）：目标必须存在且为文件
    const tid = resolvePath(ctx.cwd, target);
    const tn = tid ? getNode(tid) : undefined;
    if (!tn) return { out: '', err: `ln: ${target}: 没有那个文件或目录`, code: 1 };
    if (tn.type === 'dir') return { out: '', err: `ln: ${target}: 不允许对目录建立硬链接`, code: 1 };
    if (tn.kind === 'binary') await createBinaryFile(parentId, linkName, new Blob([(await readFileBytes(tn)) as BlobPart]));
    else createFile(parentId, linkName, tn.content);
    if (tn.mode !== undefined) {
      const newId = children(parentId).find((x) => x.name === linkName)?.id;
      if (newId) setMode(newId, tn.mode);
    }
    return { out: '', code: 0 };
  },

  // M53.7 readlink：输出软链目标串（最后一段不跟随；非链接 → 码 1）
  readlink: (args, ctx) => {
    if (!args.length) return { out: '', err: 'readlink: 用法 readlink 链接...', code: 2 };
    const outs: string[] = [];
    for (const a of args) {
      const id = lresolvePath(ctx.cwd, a);
      const n = id ? getNode(id) : undefined;
      if (!n) return { out: outs.join('\n'), err: `readlink: ${a}: 没有那个文件或目录`, code: 1 };
      if (n.linkTo === undefined) return { out: outs.join('\n'), err: `readlink: ${a}: 无效参数`, code: 1 };
      outs.push(n.linkTo);
    }
    return { out: outs.join('\n'), code: 0 };
  },

  // M53.8 wget：下载 URL 存文件。默认名 = URL 末段（重名自动 .1/.2，wget 风格）；
  // -O 指定输出（覆盖已存在）；-c 断点续传（发 Range 头并拼接已有字节）；
  // -q 静默。文本/二进制按字节自动识别（isTextBytes）。
  wget: async (args, ctx) => {
    let quiet = false;
    let cont = false;
    let outPath: string | null = null;
    const ops: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-q') quiet = true;
      else if (a === '-c') cont = true;
      else if (a === '-O') outPath = args[++i] ?? null;
      else if (a.startsWith('-O')) outPath = a.slice(2);
      else if (!a.startsWith('-')) ops.push(a);
    }
    const url = ops[0];
    if (!url) return { out: '', err: 'wget: 用法 wget [-q] [-c] [-O 文件] URL', code: 2 };
    let name = 'index.html';
    try {
      name = new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'index.html';
    } catch {
      return { out: '', err: `wget: 无效 URL: ${url}`, code: 2 };
    }
    let parentId = ctx.cwd;
    let existId: string | undefined;
    if (outPath) {
      const nid = resolvePath(ctx.cwd, outPath);
      if (nid && getNode(nid)?.type === 'dir') parentId = nid;
      else {
        const slash = outPath.lastIndexOf('/');
        const pStr = slash >= 0 ? outPath.slice(0, slash) || '/' : '.';
        name = slash >= 0 ? outPath.slice(slash + 1) : outPath;
        const pid = resolvePath(ctx.cwd, pStr);
        if (!pid || getNode(pid)?.type !== 'dir') return { out: '', err: `wget: ${pStr}: 目录不存在`, code: 1 };
        parentId = pid;
        existId = children(pid).find((x) => x.name === name)?.id;
      }
    } else {
      const taken = new Set(children(parentId).map((x) => x.name));
      if (taken.has(name)) {
        if (cont) {
          // -c 断点续传：同名不另起 .1，基于已有文件续传
          existId = children(parentId).find((x) => x.name === name)?.id;
        } else {
          let i = 1;
          while (taken.has(`${name}.${i}`)) i++;
          name = `${name}.${i}`;
        }
      }
    }
    const existNode = existId ? getNode(existId) : undefined;
    const existBytes = cont && existNode ? await readFileBytes(existNode) : null;
    let res: Response;
    try {
      res = await fetch(url, existBytes && existBytes.length > 0 ? { headers: { Range: `bytes=${existBytes.length}-` } } : undefined);
    } catch (e) {
      return { out: '', err: `wget: 下载失败: ${e instanceof Error ? e.message : String(e)}`, code: 1 };
    }
    if (!res.ok) return { out: '', err: `wget: 服务器返回 ${res.status}`, code: 1 };
    const got = new Uint8Array(await res.arrayBuffer());
    const bytes = existBytes && existBytes.length > 0 ? concatBytes([existBytes, got]) : got;
    if (existNode) trash(existNode.id); // 覆盖/续传都是整文件重写
    if (isTextBytes(bytes)) createFile(parentId, name, td.decode(bytes));
    else await createBinaryFile(parentId, name, new Blob([bytes as BlobPart]));
    return { out: quiet ? '' : `'${name}' 已保存 [${bytes.length}B]`, code: 0 };
  },

  // M53.9 strings：提取文件中的可打印 ASCII 串（0x20-0x7E，默认 ≥4，-n 调整）
  strings: async (args, ctx) => {
    let min = 4;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-n') min = Math.max(1, parseInt(args[++i] ?? '', 10) || 4);
      else if (/^-n\d+$/.test(a)) min = Math.max(1, parseInt(a.slice(2), 10));
      else if (!a.startsWith('-')) files.push(a);
    }
    if (!files.length) return { out: '', err: 'strings: 用法 strings [-n 长度] 文件...', code: 2 };
    const outs: string[] = [];
    for (const f of files) {
      const id = resolvePath(ctx.cwd, f);
      const n = id ? getNode(id) : undefined;
      if (!n) return { out: outs.join('\n'), err: `strings: ${f}: 没有那个文件或目录`, code: 1 };
      if (n.type === 'dir') return { out: outs.join('\n'), err: `strings: ${f}: 是一个目录`, code: 1 };
      const bytes = await readFileBytes(n);
      let cur: number[] = [];
      const flush = () => {
        if (cur.length >= min) outs.push(String.fromCharCode(...cur));
        cur = [];
      };
      for (const b of bytes) {
        if (b >= 0x20 && b <= 0x7e) cur.push(b);
        else flush();
      }
      flush();
    }
    return { out: outs.join('\n'), code: 0 };
  },

  // M53.10 hexdump：十六进制转储（规范 -C 格式为默认；文档化简化：无 -C 亦同）。
  // -A x|d|o|n 地址进制（n = 不显示地址与结束行）。
  hexdump: async (args, ctx) => {
    let radix = 'x';
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-C') continue;
      else if (a === '-A') radix = args[++i] ?? 'x';
      else if (a.startsWith('-A')) radix = a.slice(2);
      else if (!a.startsWith('-')) files.push(a);
    }
    if (!files.length) return { out: '', err: 'hexdump: 用法 hexdump [-C] [-A x|d|o|n] 文件...', code: 2 };
    if (!'xdon'.includes(radix)) return { out: '', err: `hexdump: 无效地址进制: ${radix}`, code: 2 };
    const lines: string[] = [];
    for (const f of files) {
      const r = await dumpable(ctx, f);
      if ('err' in r) return { out: lines.join('\n'), err: `hexdump: ${r.err}`, code: 1 };
      const bytes = r.bytes;
      for (let off = 0; off < bytes.length; off += 16) {
        const chunk = bytes.subarray(off, off + 16);
        const cells: string[] = [];
        for (let i = 0; i < 16; i++) cells.push(i < chunk.length ? hex2(chunk[i]) : '  ');
        const hexStr = cells.slice(0, 8).join(' ') + '  ' + cells.slice(8).join(' ');
        const ascii = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
        lines.push(radix === 'n' ? `${hexStr}  |${ascii}|` : `${fmtAddr(off, radix)}  ${hexStr}  |${ascii}|`);
      }
      if (radix !== 'n') lines.push(fmtAddr(bytes.length, radix));
    }
    return { out: lines.join('\n'), code: 0 };
  },

  // M53.10 od：字节转储（默认 -A o -t x1；文档化简化：真 od 默认为八进制 16 位字）。
  // -A x|d|o|n 地址进制；-t x1 十六进制字节 | c 字符（\0 \n \t \r，余者八进制转义）。
  od: async (args, ctx) => {
    let radix = 'o';
    let type = 'x1';
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-A') radix = args[++i] ?? 'o';
      else if (a.startsWith('-A')) radix = a.slice(2);
      else if (a === '-t') type = args[++i] ?? 'x1';
      else if (a.startsWith('-t')) type = a.slice(2);
      else if (!a.startsWith('-')) files.push(a);
    }
    if (!files.length) return { out: '', err: 'od: 用法 od [-A x|d|o|n] [-t x1|c] 文件...', code: 2 };
    if (!'xdon'.includes(radix)) return { out: '', err: `od: 无效地址进制: ${radix}`, code: 2 };
    if (type !== 'x1' && type !== 'c') return { out: '', err: `od: 不支持的类型: ${type}（仅 x1/c）`, code: 2 };
    const lines: string[] = [];
    for (const f of files) {
      const r = await dumpable(ctx, f);
      if ('err' in r) return { out: lines.join('\n'), err: `od: ${r.err}`, code: 1 };
      const bytes = r.bytes;
      for (let off = 0; off < bytes.length; off += 16) {
        const chunk = bytes.subarray(off, off + 16);
        const cells = Array.from(chunk, (b) => {
          if (type === 'x1') return hex2(b);
          if (b === 0) return '\\0';
          if (b === 10) return '\\n';
          if (b === 9) return '\\t';
          if (b === 13) return '\\r';
          return b >= 0x20 && b < 0x7f ? ` ${String.fromCharCode(b)}` : `\\${b.toString(8).padStart(3, '0')}`;
        });
        lines.push((radix === 'n' ? '' : fmtAddr(off, radix) + ' ') + cells.join(' '));
      }
      if (radix !== 'n') lines.push(fmtAddr(bytes.length, radix));
    }
    return { out: lines.join('\n'), code: 0 };
  },

  // M53.11 diff：比较两个文件的差异。码 0 相同 / 1 不同 / 2 出错。
  // -u 统一格式（上下文 3 行）、-r 目录递归、-q 只报不同；操作数 - 读标准输入。
  diff: async (args, ctx, stdin) => {
    let u = false;
    let r = false;
    let q = false;
    const ops: string[] = [];
    for (const a of args) {
      if (a === '--') continue;
      else if (a === '-') ops.push(a);
      else if (a.startsWith('-') && a.length > 1) {
        for (const ch of a.slice(1)) {
          if (ch === 'u') u = true;
          else if (ch === 'r') r = true;
          else if (ch === 'q') q = true;
          else return { out: '', err: `diff: 无效选项: -${ch}`, code: 2 };
        }
      } else ops.push(a);
    }
    if (ops.length !== 2) return { out: '', err: 'diff: 用法 diff [-urq] 文件1 文件2', code: 2 };
    const [pa, pb] = ops;
    // 目录情形：必须双目录且带 -r
    const idA = pa === '-' ? null : resolvePath(ctx.cwd, pa);
    const idB = pb === '-' ? null : resolvePath(ctx.cwd, pb);
    const nA = idA ? getNode(idA) : undefined;
    const nB = idB ? getNode(idB) : undefined;
    const isDirA = nA?.type === 'dir';
    const isDirB = nB?.type === 'dir';
    if (isDirA || isDirB) {
      if (!r || !isDirA || !isDirB) return { out: '', err: `diff: ${isDirA ? pa : pb}: 是一个目录（递归请用 -r）`, code: 2 };
      // 递归：按相对路径对齐两侧文件
      const relsOf = (rootId: string): Map<string, VNode> => {
        const rootPath = pathOf(rootId);
        const map = new Map<string, VNode>();
        for (const nd of walk(rootId)) {
          if (nd.type === 'file') map.set(pathOf(nd.id).slice(rootPath.length + 1), nd);
        }
        return map;
      };
      const mapA = relsOf(idA!);
      const mapB = relsOf(idB!);
      const rels = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();
      const outs: string[] = [];
      let differ = false;
      const holder = (base: string, rel: string) => {
        const slash = rel.lastIndexOf('/');
        return slash >= 0 ? `${base}/${rel.slice(0, slash)}` : base;
      };
      for (const rel of rels) {
        const inA = mapA.get(rel);
        const inB = mapB.get(rel);
        if (inA && !inB) {
          differ = true;
          outs.push(`仅在 ${holder(pa, rel)} 中存在: ${rel.slice(rel.lastIndexOf('/') + 1)}`);
        } else if (!inA && inB) {
          differ = true;
          outs.push(`仅在 ${holder(pb, rel)} 中存在: ${rel.slice(rel.lastIndexOf('/') + 1)}`);
        } else {
          const rp = await diffPair(ctx, `${pa}/${rel}`, `${pb}/${rel}`, stdin, { u, q, hdr: !u });
          if ('err' in rp) return { out: outs.join('\n'), err: rp.err, code: 2 };
          if (rp.differ) differ = true;
          outs.push(...rp.out);
        }
      }
      return { out: outs.join('\n'), code: differ ? 1 : 0 };
    }
    const rp = await diffPair(ctx, pa, pb, stdin, { u, q, hdr: false });
    if ('err' in rp) return { out: '', err: rp.err, code: 2 };
    return { out: rp.out.join('\n'), code: rp.differ ? 1 : 0 };
  },

  // M53.12 patch：应用 unified diff 补丁。-i 补丁文件（否则 stdin）、-pN 路径剪裁、--dry-run 只验不写。
  // 单文件内所有 hunk 全部命中才落盘（原子）；删除型补丁（+++ /dev/null）把文件移入回收站。
  patch: async (args, ctx, stdin) => {
    let strip = 0;
    let dry = false;
    let infile: string | null = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--dry-run') dry = true;
      else if (a === '-i') infile = args[++i] ?? '';
      else if (a.startsWith('-i')) infile = a.slice(2);
      else if (a === '-p') strip = parseInt(args[++i] ?? '', 10);
      else if (/^-p\d+$/.test(a)) strip = parseInt(a.slice(2), 10);
      else return { out: '', err: `patch: 无效选项: ${a}`, code: 2 };
    }
    if (infile === '' || Number.isNaN(strip)) return { out: '', err: 'patch: 用法 patch [-pN] [--dry-run] [-i 补丁文件]', code: 2 };
    let text: string;
    if (infile !== null) {
      const rd = readFileText(ctx, infile);
      if (rd.err) return { out: '', err: `patch: ${rd.err}`, code: 2 };
      text = rd.text!;
    } else {
      if (!stdin) return { out: '', err: 'patch: 没有补丁输入（用管道喂入或 -i 指定补丁文件）', code: 2 };
      text = stdin;
    }
    const patches = parsePatchText(text);
    if (!patches.length) return { out: '', err: 'patch: 无法识别的补丁内容（仅支持 unified diff）', code: 1 };
    const outs: string[] = [];
    let code = 0;
    for (const p of patches) {
      const rawName = p.oldName ?? p.newName!;
      const name = stripPath(rawName, strip);
      if (!name) {
        outs.push(`patch: ${rawName}: 无法用 -p${strip} 剥离路径，跳过`);
        code = 1;
        continue;
      }
      const creating = p.oldName === null;
      const deleting = p.newName === null;
      outs.push(`${dry ? 'checking' : 'patching'} file ${name}`);
      if (creating) {
        const newLines = applyPatchToLines([], p.hunks);
        if (newLines === null) {
          outs.push('Hunk #1 FAILED');
          code = 1;
          continue;
        }
        if (!dry) {
          const werr = writeToPath(ctx, name, newLines.join('\n') + (newLines.length ? '\n' : ''), false);
          if (werr) {
            outs.push(`patch: ${werr}`);
            code = 1;
          }
        }
        continue;
      }
      const id = resolvePath(ctx.cwd, name);
      const node = id ? getNode(id) : undefined;
      if (!node || node.type !== 'file') {
        outs.push(`patch: ${name}: 没有那个文件或目录`);
        code = 1;
        continue;
      }
      const cur = node.kind === 'binary' ? td.decode(await readFileBytes(node)) : node.content;
      const newLines = applyPatchToLines(toLines(cur), p.hunks);
      if (newLines === null) {
        outs.push(`Hunk #1 FAILED at ${p.hunks[0]?.aStart ?? 1}`);
        code = 1;
        continue;
      }
      if (dry) continue;
      if (deleting) trash(node.id);
      else writeFile(node.id, newLines.join('\n') + (newLines.length ? '\n' : ''));
    }
    return { out: outs.join('\n'), code };
  },

  // M53.13 sync：把所有挂起的持久化写立即刷盘（对标 sync(2)；浏览器里对应 flush 到 localStorage/IDB）。
  sync: async () => {
    await flushPersisted();
    return { out: '', code: 0 };
  },

  // M48.1 xargs：从 stdin 读词拼到命令后执行（管道终端必备）。
  // 默认命令 echo；-n N 每 N 词一组；-I STR 占位符替换（每词一次调用）。
  // 退出码取最后一次命令的码；空输入不调用命令（码 0）。仅支持内建命令（外部命令 → 127）。
  xargs: async (args, ctx, stdin) => {
    let maxArgs = 0;
    let placeholder = '';
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === '-n') maxArgs = Number(args[++i]) || 0;
      else if (a.startsWith('-n')) maxArgs = Number(a.slice(2)) || 0;
      else if (a === '-I') placeholder = args[++i] ?? '';
      else if (a.startsWith('-I')) placeholder = a.slice(2);
      else if (a === '--') { i++; break; }
      else if (!a.startsWith('-')) break;
      // 忽略其他选项（-t/-p/-r 等）
    }
    const cmd = args[i] ?? 'echo';
    const cmdArgs = args.slice(i + 1);
    const words = (stdin || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { out: '', code: 0 };
    const fn = COMMANDS[cmd];
    if (!fn) return { out: '', err: `xargs: ${cmd}: 未找到命令`, code: 127 };
    const outs: string[] = [];
    let code = 0;
    const callOne = async (extra: string[]) => {
      let finalArgs: string[];
      if (placeholder) {
        finalArgs = cmdArgs.map((a) => (a === placeholder ? extra[0] : a.split(placeholder).join(extra[0])));
      } else {
        finalArgs = [...cmdArgs, ...extra];
      }
      const res = await fn(finalArgs, ctx, '');
      if (res.out) outs.push(res.out.replace(/\n+$/, ''));
      code = res.code;
    };
    if (placeholder) {
      for (const w of words) await callOne([w]);
    } else if (maxArgs > 0) {
      for (let j = 0; j < words.length; j += maxArgs) await callOne(words.slice(j, j + maxArgs));
    } else {
      await callOne(words);
    }
    return { out: outs.join('\n'), code };
  },

  // M48.2 tee：stdin 写文件 + stdout 转发（调试管道必备）。
  // -a 追加；多文件全写。输出到 stdout 供下游消费（剥尾随换行与 echo 一致）。
  tee: (args, ctx, stdin) => {
    let append = false;
    const files: string[] = [];
    for (const a of args) {
      if (a === '-a') append = true;
      else if (a === '--') continue;
      else if (!a.startsWith('-')) files.push(a);
    }
    const text = stdin;
    // 写文件补尾随换行（bash 命令输出天然带 \n；echo a | tee f → f 内容 "a\n"）。
    const fileContent = text && !text.endsWith('\n') ? text + '\n' : text;
    for (const f of files) {
      const e = writeToPath(ctx, f, fileContent, append);
      if (e) return { out: '', err: `tee: ${e}`, code: 1 };
    }
    return { out: text.replace(/\n+$/, ''), code: 0 };
  },

  // M48.3 tr：字符变换（映射/删除/压缩）。支持区间 a-z、字符类 [:upper:]/[:lower:]/[:digit:]/[:alpha:]/[:alnum:]/[:space:]、
  // -d 删除、-s 压缩连续重复、-c 补集（与 -d 配合保留 set1 字符）。转义 \n \t \\。
  tr: (args, _ctx, stdin) => {
    let deleteMode = false;
    let squeeze = false;
    let complement = false;
    const sets: string[] = [];
    for (const a of args) {
      if (a.startsWith('-') && a.length > 1 && /^[acds]+$/.test(a.slice(1))) {
        for (const ch of a.slice(1)) {
          if (ch === 'd') deleteMode = true;
          else if (ch === 's') squeeze = true;
          else if (ch === 'c') complement = true;
        }
      } else sets.push(a);
    }
    const unescape = (s: string): string =>
      s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    const expand = (s: string): number[] => {
      const out: number[] = [];
      let i = 0;
      while (i < s.length) {
        const m = /^\[:(\w+):\]/.exec(s.slice(i));
        if (m) {
          const cls = m[1];
          if (cls === 'upper') for (let c = 65; c <= 90; c++) out.push(c);
          else if (cls === 'lower') for (let c = 97; c <= 122; c++) out.push(c);
          else if (cls === 'digit') for (let c = 48; c <= 57; c++) out.push(c);
          else if (cls === 'alpha') { for (let c = 65; c <= 90; c++) out.push(c); for (let c = 97; c <= 122; c++) out.push(c); }
          else if (cls === 'alnum') { for (let c = 48; c <= 57; c++) out.push(c); for (let c = 65; c <= 90; c++) out.push(c); for (let c = 97; c <= 122; c++) out.push(c); }
          else if (cls === 'space') [32, 9, 10, 13, 11, 12].forEach((c) => out.push(c));
          i += m[0].length;
          continue;
        }
        if (i + 2 < s.length && s[i + 1] === '-') {
          const start = s.charCodeAt(i);
          const end = s.charCodeAt(i + 2);
          for (let c = start; c <= end; c++) out.push(c);
          i += 3;
        } else {
          out.push(s.charCodeAt(i));
          i++;
        }
      }
      return out;
    };
    let set1 = expand(unescape(sets[0] ?? ''));
    const set2 = expand(unescape(sets[1] ?? ''));
    if (complement) {
      const s1set = new Set(set1);
      const comp: number[] = [];
      for (let c = 0; c < 128; c++) if (!s1set.has(c)) comp.push(c);
      set1 = comp;
    }
    const map = new Map<number, number>();
    for (let i = 0; i < set1.length; i++) {
      if (deleteMode) continue;
      const to = set2.length ? set2[Math.min(i, set2.length - 1)] : set1[i];
      map.set(set1[i], to);
    }
    const delSet = new Set(set1);
    let result = '';
    let lastPushed = -1;
    for (const ch of stdin) {
      const c = ch.codePointAt(0)!;
      if (deleteMode) {
        if (delSet.has(c)) continue;
        if (squeeze && c === lastPushed) continue;
        result += ch;
        lastPushed = c;
      } else {
        const mapped = map.get(c) ?? c;
        const mc = String.fromCodePoint(mapped);
        if (squeeze && mapped === lastPushed) continue;
        result += mc;
        lastPushed = mapped;
      }
    }
    return { out: result.replace(/\n+$/, ''), code: 0 };
  },

  // M48.4 seq：数字序列（循环词表常用）。
  // seq END | seq START END | seq START STEP END；-w 等宽补零；支持浮点步长。
  seq: (args) => {
    let eqWidth = false;
    const rest: string[] = [];
    for (const a of args) {
      if (a === '-w') eqWidth = true;
      else if (!a.startsWith('-') || /^-?\d+(\.\d+)?$/.test(a)) rest.push(a);
    }
    let start = 1, step = 1, end = 1;
    if (rest.length === 1) end = Number(rest[0]);
    else if (rest.length === 2) { start = Number(rest[0]); end = Number(rest[1]); }
    else if (rest.length >= 3) { start = Number(rest[0]); step = Number(rest[1]); end = Number(rest[2]); }
    else return { out: '', err: 'seq: 需要至少一个参数', code: 1 };
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step))
      return { out: '', err: 'seq: 无效数字', code: 1 };
    if (step === 0) return { out: '', err: 'seq: 步长不能为 0', code: 1 };
    const decimals = Math.max(
      0,
      ...[start, step, end].map((n) => (String(n).includes('.') ? String(n).split('.')[1].length : 0)),
    );
    const fmt = (n: number): string => {
      if (decimals === 0) return String(Math.round(n));
      const s = n.toFixed(decimals);
      return s.replace(/\.?0+$/, '');
    };
    const nums: number[] = [];
    if (step > 0) {
      for (let n = start; n <= end + 1e-9; n += step) nums.push(n);
    } else {
      for (let n = start; n >= end - 1e-9; n += step) nums.push(n);
    }
    if (eqWidth && nums.length) {
      const maxLen = Math.max(...nums.map((n) => fmt(n).length));
      return { out: nums.map((n) => fmt(n).padStart(maxLen, '0')).join('\n'), code: 0 };
    }
    return { out: nums.map(fmt).join('\n'), code: 0 };
  },

  // M48.5 basename / dirname：路径拆分。
  basename: (args) => {
    if (!args[0]) return { out: '', err: 'basename: 需要参数', code: 1 };
    let path = args[0].replace(/\/+$/, '');
    if (!path) path = '/';
    const parts = path.split('/');
    let name = parts[parts.length - 1] || '/';
    if (args[1] && name.endsWith(args[1]) && name !== args[1]) name = name.slice(0, name.length - args[1].length);
    return { out: name, code: 0 };
  },
  dirname: (args) => {
    if (!args[0]) return { out: '', err: 'dirname: 需要参数', code: 1 };
    const path = args[0].replace(/\/+$/, '');
    if (!path || path === '/') return { out: '/', code: 0 };
    const idx = path.lastIndexOf('/');
    if (idx === -1) return { out: '.', code: 0 };
    const dir = path.slice(0, idx);
    return { out: dir || '/', code: 0 };
  },

  // M48.6 shift：参数移位（函数/脚本参数处理）。
  // 只能在函数或脚本内使用（与 return 一致）；shift N 移 N 位；超过参数数 → 码 1；shift 0 不移位码 0。
  shift: (args, ctx) => {
    if ((ctx.funcDepth ?? 0) === 0 && sourceDepth === 0)
      return { out: '', err: 'shift: 只能在函数或脚本内使用', code: 1 };
    const n = args[0] !== undefined ? Number(args[0]) : 1;
    if (!Number.isInteger(n) || n < 0)
      return { out: '', err: `shift: ${args[0]}: 需要非负整数`, code: 1 };
    const pos = ctx.positional ?? [];
    if (n > pos.length) return { out: '', err: 'shift: 超出参数数量', code: 1 };
    ctx.positional = pos.slice(n);
    return { out: '', code: 0 };
  },

  // M49.1 expr：POSIX 风格表达式求值。算术/比较/逻辑 + length/substr/index + : 正则匹配。
  // 优先级（低→高）：| & 比较 +-* /% : 一元(函数/括号)。退出码：结果非空非0→0；空或0→1；语法错→2。
  expr: (args) => {
    let pos = 0;
    const peek = () => args[pos];
    const next = () => args[pos++];
    const isInt = (s: string) => /^-?\d+$/.test(s);
    function parseOr(): string {
      let v = parseAnd();
      while (peek() === '|') {
        next();
        const r = parseAnd();
        if (v !== '' && v !== '0') return v; // 短路：左真返回左
        v = r;
      }
      return v;
    }
    function parseAnd(): string {
      let v = parseCmp();
      while (peek() === '&') {
        next();
        const r = parseCmp();
        if (v === '' || v === '0') return '0'; // 短路：左假返回 0
        v = r;
      }
      return v;
    }
    function parseCmp(): string {
      let v = parseAdd();
      while (['<', '<=', '=', '==', '!=', '>=', '>'].includes(peek() ?? '')) {
        const op = next()!;
        const r = parseAdd();
        const numMode = isInt(v) && isInt(r);
        const a = numMode ? Number(v) : v, b = numMode ? Number(r) : r;
        let res: boolean;
        if (op === '<') res = a < b;
        else if (op === '<=') res = a <= b;
        else if (op === '=' || op === '==') res = a === b;
        else if (op === '!=') res = a !== b;
        else if (op === '>=') res = a >= b;
        else res = a > b;
        v = res ? '1' : '0';
      }
      return v;
    }
    function parseAdd(): string {
      let v = parseMul();
      while (peek() === '+' || peek() === '-') {
        const op = next()!;
        const r = parseMul();
        v = String(op === '+' ? Number(v) + Number(r) : Number(v) - Number(r));
      }
      return v;
    }
    function parseMul(): string {
      let v = parseMatch();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = next()!;
        const r = parseMatch();
        const a = Number(v), b = Number(r);
        v = String(op === '*' ? a * b : op === '/' ? Math.trunc(a / b) : a % b);
      }
      return v;
    }
    function parseMatch(): string {
      let v = parsePrimary();
      while (peek() === ':') {
        next();
        const re = parsePrimary();
        let reStr = re.replace(/\\\(/g, '(').replace(/\\\)/g, ')'); // bash \( \) → JS ( )
        let rx: RegExp;
        try { rx = new RegExp('^(' + reStr + ')'); } catch { v = '0'; continue; }
        const m = rx.exec(v);
        if (!m) v = '0';
        else if (reStr.includes('(')) v = m[1] ?? ''; // 有捕获组返回捕获内容
        else v = String(m[0].length); // 无捕获组返回匹配长度
      }
      return v;
    }
    function parsePrimary(): string {
      const t = peek();
      if (t === undefined) throw new Error('参数不足');
      // 运算符裸现（无左操作数）→ 语法错误（如 `expr + 1`）
      if (['+', '-', '*', '/', '%', '|', '&', '<', '<=', '=', '==', '!=', '>=', '>', ':'].includes(t)) {
        throw new Error('语法错误');
      }
      if (t === '(') {
        next();
        const v = parseOr();
        if (peek() !== ')') throw new Error('缺少 )');
        next();
        return v;
      }
      if (t === 'length') { next(); return String(parsePrimary().length); }
      if (t === 'substr') {
        next();
        const s = parsePrimary();
        const start = Number(parsePrimary());
        const len = Number(parsePrimary());
        return s.slice(Math.max(0, start - 1), Math.max(0, start - 1) + len);
      }
      if (t === 'index') {
        next();
        const s = parsePrimary();
        const chars = parsePrimary();
        for (let i = 0; i < s.length; i++) if (chars.includes(s[i])) return String(i + 1);
        return '0';
      }
      if (t === 'match') {
        next();
        const s = parsePrimary();
        const re = parsePrimary();
        let reStr = re.replace(/\\\(/g, '(').replace(/\\\)/g, ')');
        let rx: RegExp;
        try { rx = new RegExp('^(' + reStr + ')'); } catch { return '0'; }
        const m = rx.exec(s);
        if (!m) return '0';
        return reStr.includes('(') ? (m[1] ?? '') : String(m[0].length);
      }
      return next()!;
    }
    if (!args.length) return { out: '', err: 'expr: 缺少表达式', code: 2 };
    try {
      const result = parseOr();
      const code = result !== '' && result !== '0' ? 0 : 1;
      return { out: result, code };
    } catch (e) {
      return { out: '', err: `expr: ${(e as Error).message}`, code: 2 };
    }
  },

  // M49.3 tac：反向行序。stdin 按行分割后逆序输出。
  tac: (_args, _ctx, stdin) => {
    const lines = stdin.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return { out: lines.reverse().join('\n'), code: 0 };
  },

  // M49.4 rev：每行字符反转。按 Unicode 码点反转（Array.from 处理中文）。
  rev: (_args, _ctx, stdin) => {
    const lines = stdin.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return { out: lines.map((l) => Array.from(l).reverse().join('')).join('\n'), code: 0 };
  },

  // M49.5 nl：行号标注。默认 6 位右对齐 + tab；空行不编号但占逻辑行号；-b a 空行也编号。
  nl: (args, _ctx, stdin) => {
    let bodyAll = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-b' && args[i + 1] === 'a') bodyAll = true;
      else if (args[i] === '-ba') bodyAll = true;
    }
    const lines = stdin.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    let n = 0;
    const out = lines.map((l) => {
      n++; // 逻辑行号总是递增
      if (l === '' && !bodyAll) return ''; // 空行不编号
      return String(n).padStart(6, ' ') + '\t' + l;
    });
    return { out: out.join('\n'), code: 0 };
  },

  // M49.6 column -t：列对齐表格化。按分隔符（默认空白）切列，列间两空格拼接对齐。
  column: (args, _ctx, stdin) => {
    let tableMode = false;
    let sep: RegExp = /\s+/; // 默认空白分隔
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-t') tableMode = true;
      else if (args[i] === '-s') { sep = new RegExp(args[++i] ?? '\\s+'); }
      else if (args[i].startsWith('-s')) { sep = new RegExp(args[i].slice(2) || '\\s+'); }
    }
    if (!tableMode) return { out: stdin, code: 0 }; // 非 -t 原样输出（简化）
    const lines = stdin.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (!lines.length) return { out: '', code: 0 };
    const rows = lines.map((l) => (sep.source === '\\s+' ? l.trim().split(/\s+/).filter(Boolean) : l.split(sep)));
    const out = rows.map((r) => r.join('  '));
    return { out: out.join('\n'), code: 0 };
  },

  // M50.1 sleep：延时执行。参数为秒数（支持小数），支持 s/m/h 后缀。
  // 0 秒立即返回；非数字报错码 1；缺参数码 2。
  sleep: async (args) => {
    if (!args.length) return { out: '', err: 'sleep: 缺少操作数', code: 2 };
    const spec = args[0];
    // 先剥后缀再转换：s 秒（默认）、m 分（×60）、h 时（×3600）
    let mult = 1;
    let numPart = spec;
    const last = spec[spec.length - 1];
    if (last === 's') { numPart = spec.slice(0, -1); mult = 1; }
    else if (last === 'm') { numPart = spec.slice(0, -1); mult = 60; }
    else if (last === 'h') { numPart = spec.slice(0, -1); mult = 3600; }
    const n = Number(numPart) * mult;
    if (!isFinite(n) || numPart === '') return { out: '', err: `sleep: ${spec}: 无效时间间隔`, code: 1 };
    if (n < 0) return { out: '', err: `sleep: ${spec}: 无效时间间隔`, code: 1 };
    if (n > 0) await new Promise((r) => setTimeout(r, n * 1000));
    return { out: '', code: 0 };
  },

  // M50.2 yes：重复输出字符串直到管道消费方关闭。本 shell 管道是快照模型（生产者先全产出），
  // 无 SIGPIPE → 内部封顶 1000 行防挂死；管道到 head 时由 head 截取所需行数。
  yes: (args) => {
    const s = args.length ? args.join(' ') : 'y';
    const N = 1000;
    const out = Array.from({ length: N }, () => s).join('\n');
    return { out, code: 0 };
  },

  // M50.3 shuf：随机打乱输入行。-n N 采样 N 行；-e 按参数（非 stdin）打乱。
  shuf: (args, _ctx, stdin) => {
    let count = 0;
    let fromArgs = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-n') count = parseInt(args[++i] ?? '', 10) || 0;
      else if (a.startsWith('-n')) count = parseInt(a.slice(2), 10) || 0;
      else if (a === '-e') fromArgs = true;
    }
    let items: string[];
    if (fromArgs) items = args.filter((a) => !a.startsWith('-') && a !== '-e');
    else items = toLines(stdin);
    // Fisher-Yates 洗牌
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    if (count > 0) items = items.slice(0, Math.min(count, items.length));
    return { out: items.join('\n'), code: 0 };
  },

  // M50.4 paste：按行合并多个文件（默认 tab 分隔）。-d 指定分隔符；-s 串行（每文件变一行）。
  // `-` 表示从 stdin 读；多个 `-` 时按 round-robin 轮流分配 stdin 行（GNU paste 语义）。
  // 不等长文件用空串补齐（bash 同款）。
  paste: (args, ctx, stdin) => {
    let delim = '\t';
    let serial = false;
    const files: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-d') delim = args[++i] ?? '\t';
      else if (a.startsWith('-d')) delim = a.slice(2) || '\t';
      else if (a === '-s') serial = true;
      else files.push(a);
    }
    const stdinLines = toLines(stdin);
    // 读各源（文件或 stdin）；`-` 按 round-robin 轮流分配 stdin 行
    const dashIndices: number[] = [];
    const sources: string[][] = files.map((f, idx) => {
      if (f === '-') { dashIndices.push(idx); return []; }
      const r = readFileText(ctx, f);
      if (r.err) return [];
      return toLines(r.text ?? '');
    });
    if (dashIndices.length > 0) {
      const numDash = dashIndices.length;
      dashIndices.forEach((srcIdx, dashNo) => {
        const lines: string[] = [];
        for (let i = dashNo; i < stdinLines.length; i += numDash) lines.push(stdinLines[i]);
        sources[srcIdx] = lines;
      });
    }
    if (!sources.length) sources.push(stdinLines);
    if (serial) {
      // 串行：每个源的所有行用 delim 连接成一行
      const out = sources.map((lines) => lines.join(delim));
      return { out: out.join('\n'), code: 0 };
    }
    // 并行：按最大行数对齐，每行取各源同序号行用 delim 连接，缺则空串
    const max = Math.max(...sources.map((s) => s.length), 0);
    const out: string[] = [];
    for (let i = 0; i < max; i++) {
      out.push(sources.map((s) => s[i] ?? '').join(delim));
    }
    return { out: out.join('\n'), code: 0 };
  },

  // M50.5 comm：逐行对比两个已排序文件。-1/-2/-3 隐藏对应列（第一列仅A、第二列仅B、第三列交集）。
  // 支持合并标志（-12、-23、-123 等）。隐藏列后对应 tab 消失：每列前导 tab 数 = 该列之前未隐藏列数。
  comm: (args, ctx) => {
    let hide1 = false, hide2 = false, hide3 = false;
    const files: string[] = [];
    for (const a of args) {
      if (a.startsWith('-') && /^[0-9]+$/.test(a.slice(1))) {
        for (const ch of a.slice(1)) {
          if (ch === '1') hide1 = true;
          else if (ch === '2') hide2 = true;
          else if (ch === '3') hide3 = true;
        }
      } else if (!a.startsWith('-')) {
        files.push(a);
      }
    }
    if (files.length < 2) return { out: '', err: 'comm: 需要两个文件参数', code: 2 };
    const ra = readFileText(ctx, files[0]);
    const rb = readFileText(ctx, files[1]);
    if (ra.err) return { out: '', err: `comm: ${ra.err}`, code: 1 };
    if (rb.err) return { out: '', err: `comm: ${rb.err}`, code: 1 };
    const a = toLines(ra.text ?? '');
    const b = toLines(rb.text ?? '');
    // 每列前导 tab 数 = 该列之前未隐藏列数
    const tab1 = 0;
    const tab2 = hide1 ? 0 : 1;
    const tab3 = (hide1 ? 0 : 1) + (hide2 ? 0 : 1);
    const out: string[] = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] < b[j]) {
        if (!hide1) out.push('\t'.repeat(tab1) + a[i]);
        i++;
      } else if (a[i] > b[j]) {
        if (!hide2) out.push('\t'.repeat(tab2) + b[j]);
        j++;
      } else {
        if (!hide3) out.push('\t'.repeat(tab3) + a[i]);
        i++; j++;
      }
    }
    while (i < a.length) { if (!hide1) out.push('\t'.repeat(tab1) + a[i]); i++; }
    while (j < b.length) { if (!hide2) out.push('\t'.repeat(tab2) + b[j]); j++; }
    return { out: out.join('\n'), code: 0 };
  },

  // M50.6 expand：tab → 空格。-t N 指定 tab 宽度（默认 8）。
  expand: (args, _ctx, stdin) => {
    let tab = 8;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-t') tab = parseInt(args[++i] ?? '8', 10) || 8;
      else if (args[i].startsWith('-t')) tab = parseInt(args[i].slice(2), 10) || 8;
    }
    const lines = toLines(stdin);
    const out = lines.map((ln) => {
      let col = 0;
      let res = '';
      for (const ch of ln) {
        if (ch === '\t') { res += ' '.repeat(tab - (col % tab)); col += tab - (col % tab); }
        else { res += ch; col++; }
      }
      return res;
    });
    return { out: out.join('\n'), code: 0 };
  },

  // M50.6 unexpand：空格 → tab。-t N 指定宽度（默认 8）；-a 转换所有空格组（默认仅行首）。
  // 按列位置动态追踪 tab 边界：空格组中每跨越一个 tab 边界即转换为一个 tab。
  // 本实现简化语义：默认即转换所有对齐到 tab 边界的空格组（与 GNU unexpand -a 等价），
  // -a 作为兼容标志保留（行为相同）。
  unexpand: (args, _ctx, stdin) => {
    let tab = 8;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-t') tab = parseInt(args[++i] ?? '8', 10) || 8;
      else if (args[i].startsWith('-t')) tab = parseInt(args[i].slice(2), 10) || 8;
    }
    const lines = toLines(stdin);
    const out = lines.map((ln) => {
      let res = '';
      let col = 0; // 当前列位置（tab 边界感知）
      let i = 0;
      while (i < ln.length) {
        const ch = ln[i];
        if (ch === ' ') {
          // 收集连续空格组
          let j = i;
          while (j < ln.length && ln[j] === ' ') j++;
          const spaceCount = j - i;
          // 按列位置切分：每跨越一个 tab 边界转换为一个 tab，剩余原样输出
          let curCol = col;
          let remaining = spaceCount;
          while (remaining > 0) {
            const distToBoundary = tab - (curCol % tab);
            if (remaining >= distToBoundary) {
              res += '\t';
              curCol += distToBoundary;
              remaining -= distToBoundary;
            } else {
              res += ' '.repeat(remaining);
              curCol += remaining;
              remaining = 0;
            }
          }
          col += spaceCount;
          i = j;
        } else if (ch === '\t') {
          res += '\t';
          col += tab - (col % tab);
          i++;
        } else {
          res += ch;
          col++;
          i++;
        }
      }
      return res;
    });
    return { out: out.join('\n'), code: 0 };
  },

  // M50.7 base64：编解码。-d 解码（默认编码）。编码用 btoa（UTF-8 先 encodeURIComponent），
  // 解码用 atob（UTF-8 后 decodeURIComponent），解码忽略换行。
  base64: (args, _ctx, stdin) => {
    let decode = false;
    for (const a of args) { if (a === '-d') decode = true; }
    const input = stdin ?? '';
    if (decode) {
      const cleaned = input.replace(/\s+/g, '');
      if (!cleaned) return { out: '', code: 0 };
      try {
        const bin = atob(cleaned);
        // UTF-8 解码：每字节转 %XX 后 decodeURIComponent
        const utf8 = decodeURIComponent(Array.from(bin, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
        return { out: utf8, code: 0 };
      } catch {
        return { out: '', err: 'base64: 无效输入', code: 1 };
      }
    }
    if (!input) return { out: '', code: 0 };
    // UTF-8 编码：encodeURIComponent → %XX → 每字节取字符
    const utf8 = unescape(encodeURIComponent(input));
    return { out: btoa(utf8), code: 0 };
  },

  // M50.8 type：显示命令类型。-t 简短输出（builtin/alias/keyword）；无 -t 给描述。
  type: (args, ctx) => {
    let terse = false;
    const names: string[] = [];
    for (const a of args) {
      if (a === '-t') terse = true;
      else if (!a.startsWith('-')) names.push(a);
    }
    if (!names.length) return { out: '', err: 'type: 用法 type [-t] <命令...>', code: 2 };
    const outs: string[] = [];
    const errs: string[] = [];
    let allFound = true;
    for (const name of names) {
      // 别名优先（bash 同款：alias 覆盖 builtin）
      if (aliases.map[name]) {
        if (terse) outs.push('alias');
        else outs.push(`${name} 是 \`${aliases.map[name]}' 的别名`);
      } else if (COMMAND_NAMES.includes(name)) {
        if (terse) outs.push('builtin');
        else outs.push(`${name} 是 shell 内建`);
      } else if (CTRL_KW.has(name)) {
        if (terse) outs.push('keyword');
        else outs.push(`${name} 是 shell 关键字`);
      } else {
        allFound = false;
        errs.push(`type: ${name}: 未找到`);
      }
    }
    return { out: outs.join('\n'), err: errs.join('\n'), code: allFound ? 0 : 1 };
  },

  // M51.2 time：命令计时。把 args join 成命令字符串调 run 执行（支持管道/重定向），
  // real 时间用 performance.now() 实测；user/sys 无法区分均报 0（bash 格式兼容）。
  // 计时信息输出到 stderr，子命令 stdout/err 透传，退出码取子命令码。
  time: async (args, ctx, stdin) => {
    if (!args.length) return { out: '', err: 'time: 用法 time <命令>', code: 2 };
    const line = args.join(' ');
    const t0 = performance.now();
    const res = await run(line, ctx);
    const dt = (performance.now() - t0) / 1000;
    const mins = Math.floor(dt / 60);
    const secs = (dt - mins * 60).toFixed(3);
    const timing = `real\t${mins}m${secs}s\nuser\t0m0.000s\nsys\t0m0.000s`;
    return { out: res.out, err: res.err ? `${timing}\n${res.err}` : timing, code: res.code };
  },

  // M51.3 uname：系统信息。-s 内核名（默认）、-n 节点名、-r 版本、-m 硬件、-a 全部
  uname: (args) => {
    const flags = new Set<string>();
    for (const a of args) if (a.startsWith('-')) for (const c of a.slice(1)) flags.add(c);
    const kernel = 'QieZiOS';
    const node = 'qiezios';
    const release = '1.0.0';
    const machine = 'x86_64';
    if (flags.has('a')) {
      return { out: `${kernel} ${node} ${release} #1 SMP ${machine} GNU/Linux`, code: 0 };
    }
    if (flags.size === 0) flags.add('s');
    const parts: string[] = [];
    if (flags.has('s')) parts.push(kernel);
    if (flags.has('n')) parts.push(node);
    if (flags.has('r')) parts.push(release);
    if (flags.has('m')) parts.push(machine);
    return { out: parts.join(' '), code: 0 };
  },

  // M51.4 uptime：当前时间 + 启动时长 + 用户数 + 负载（模拟）
  uptime: () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const upSec = Math.max(0, Math.floor((Date.now() - BOOT_TIME) / 1000));
    let upStr: string;
    if (upSec < 60) upStr = `${upSec} sec`;
    else if (upSec < 3600) upStr = `${Math.floor(upSec / 60)}:${pad(upSec % 60)}`;
    else {
      const h = Math.floor(upSec / 3600);
      const m = Math.floor((upSec % 3600) / 60);
      upStr = h >= 24 ? `${Math.floor(h / 24)} day${h >= 48 ? 's' : ''}, ${h % 24}:${pad(m)}` : `${h}:${pad(m)}`;
    }
    return { out: ` ${time} up ${upStr}, 1 user, load average: 0.00, 0.00, 0.00`, code: 0 };
  },

  // M51.5 cal：日历。cal 当月、cal M YYYY 指定月、cal YYYY 全年
  cal: (args) => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    if (args.length === 0) return { out: renderMonth(curYear, curMonth), code: 0 };
    if (args.length === 1) {
      const n = Number(args[0]);
      if (!Number.isInteger(n) || n < 1) return { out: '', err: `cal: ${args[0]}: 非法参数`, code: 1 };
      // 单参数：> 31 当年份，否则当月份（同年）
      if (n > 31) return { out: renderYear(n), code: 0 };
      return { out: renderMonth(curYear, n), code: 0 };
    }
    const m = Number(args[0]);
    const y = Number(args[1]);
    if (!Number.isInteger(m) || m < 1 || m > 12) return { out: '', err: `cal: ${args[0]}: 非法月份`, code: 1 };
    if (!Number.isInteger(y) || y < 1) return { out: '', err: `cal: ${args[1]}: 非法年份`, code: 1 };
    return { out: renderMonth(y, m), code: 0 };
  },

  // M51.6 nproc：CPU 核数
  nproc: () => {
    const n = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
    return { out: String(n), code: 0 };
  },

  // M51.7 mktemp：在 /tmp 创建临时文件（默认）或目录（-d），返回路径
  mktemp: (args, ctx) => {
    const makeDir = args.includes('-d');
    let tmpId = resolvePath('root', '/tmp');
    if (!tmpId || getNode(tmpId)?.type !== 'dir') {
      const rootId = resolvePath('root', '/');
      tmpId = createDir(rootId, 'tmp');
    }
    const name = '.tmp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    if (makeDir) createDir(tmpId, name);
    else createFile(tmpId, name, '');
    return { out: `/tmp/${name}`, code: 0 };
  },

  // M51.8 realpath：解析 . 和 ..，返回绝对路径（基于 cwd）
  realpath: (args, ctx) => {
    if (!args.length) return { out: '', err: 'realpath: 用法 realpath <路径>', code: 2 };
    return { out: toAbsPath(ctx, args[0]), code: 0 };
  },

  // M51.9 printenv：无参列全部环境变量；带参逐行打印指定变量值（未定义码 1）
  printenv: (args, ctx) => {
    if (!args.length) {
      return { out: Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`).join('\n'), code: 0 };
    }
    const outs: string[] = [];
    let allFound = true;
    for (const k of args) {
      if (ctx.env[k] !== undefined) outs.push(ctx.env[k]);
      else allFound = false;
    }
    return { out: outs.join('\n'), code: allFound ? 0 : 1 };
  },

  // ── M52 Shell 常用命令补全 ────────────────────────────────

  // M52.1 exit：退出当前 shell 会话。返回 exit:true 让 Terminal 关闭窗口；code 取参数（默认 0）。
  exit: (args) => {
    const n = args.length ? Number(args[0]) : 0;
    const code = Number.isFinite(n) ? n : 0;
    return { out: '', code, exit: true };
  },

  // M52.2 history：命令历史列表。-c 清空、-d N 删第 N 条（1-based）、无参/数字 N 显示最近 N 条。
  history: (args, ctx) => {
    const list = cmdHistory.list;
    if (args[0] === '-c') {
      cmdHistory.list = [];
      return { out: '', code: 0 };
    }
    if (args[0] === '-d') {
      const idx = Number(args[1]);
      if (!Number.isInteger(idx) || idx < 1 || idx > list.length)
        return { out: '', err: `history: ${args[1]}: 历史位置超出范围`, code: 1 };
      list.splice(idx - 1, 1);
      return { out: '', code: 0 };
    }
    let limit = list.length;
    if (args.length && Number.isInteger(Number(args[0]))) limit = Math.min(Number(args[0]), list.length);
    const start = list.length - limit;
    const lines = list.slice(start).map((c, i) => `  ${String(start + i + 1).padStart(4)}  ${c}`);
    void ctx;
    return { out: lines.join('\n'), code: 0 };
  },

  // M52.3 df：磁盘空间（navigator.storage.estimate 取配额/用量，兜底模拟）。
  df: async () => {
    let quota = 1024 * 1024 * 1024; // 1GB 兜底
    let usage = 0;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota) quota = est.quota;
        if (est.usage) usage = est.usage;
      }
    } catch { /* 兜底 */ }
    const sizeM = Math.round(quota / (1024 * 1024));
    const usedM = Math.round(usage / (1024 * 1024));
    const availM = sizeM - usedM;
    const pct = sizeM > 0 ? Math.round((usedM / sizeM) * 100) : 0;
    const header = 'Filesystem      1M-blocks    Used Available Use% Mounted on';
    const row = `qzfs            ${String(sizeM).padStart(8)} ${String(usedM).padStart(8)} ${String(availM).padStart(8)} ${String(pct).padStart(3)}% /`;
    return { out: `${header}\n${row}`, code: 0 };
  },

  // M52.4 du：目录递归大小统计（文本按 content.length、二进制按 size）。-s 仅总计。
  du: (args, ctx) => {
    let summarize = false;
    let path = '';
    for (const a of args) {
      if (a === '-s') summarize = true;
      else if (a.startsWith('-')) continue;
      else path = a;
    }
    const id = resolvePath(ctx.cwd, path || '.');
    if (!id || !getNode(id)) return { out: '', err: `du: ${path || '.'}: 没有那个文件或目录`, code: 1 };
    const sizes: { path: string; size: number }[] = [];
    const calc = (nodeId: string, rel: string): number => {
      const n = getNode(nodeId);
      if (!n) return 0;
      if (n.type === 'file') {
        const s = n.kind === 'binary' ? (n.size ?? 0) : n.content.length;
        sizes.push({ path: rel, size: s });
        return s;
      }
      let sum = 0;
      for (const c of children(nodeId)) {
        sum += calc(c.id, rel === '/' ? `/${c.name}` : `${rel}/${c.name}`);
      }
      sizes.push({ path: rel, size: sum });
      return sum;
    };
    const total = calc(id, path || '.');
    if (summarize) return { out: `${String(total).padStart(4)}\t${path || '.'}`, code: 0 };
    const lines = sizes.map((s) => `${String(s.size).padStart(4)}\t${s.path}`);
    return { out: lines.join('\n'), code: 0 };
  },

  // M52.5 free：内存使用（navigator.deviceMemory + performance.memory，兜底模拟）。
  free: () => {
    const dm = (typeof navigator !== 'undefined' && (navigator as any).deviceMemory) || 8; // GB
    const totalM = Math.round(dm * 1024);
    let usedM = 0;
    let limitM = totalM;
    const perf = (typeof performance !== 'undefined' && (performance as any).memory);
    if (perf) {
      usedM = Math.round(perf.usedJSHeapSize / (1024 * 1024));
      limitM = Math.round(perf.jsHeapSizeLimit / (1024 * 1024));
    }
    const freeM = Math.max(0, totalM - usedM);
    const header = '              total        used        free      shared  buff/cache  available';
    const mem = `Mem:    ${String(totalM).padStart(12)} ${String(usedM).padStart(12)} ${String(freeM).padStart(12)} ${String(0).padStart(12)} ${String(0).padStart(12)} ${String(Math.max(0, limitM - usedM)).padStart(12)}`;
    const swap = `Swap:   ${String(0).padStart(12)} ${String(0).padStart(12)} ${String(0).padStart(12)}`;
    return { out: `${header}\n${mem}\n${swap}`, code: 0 };
  },

  // M52.6 pushd：压栈切目录。无参交换栈顶与下一项（bash 语义）；有参切到目标并压栈。
  pushd: (args, ctx) => {
    const stack = ctx.dirStack ?? (ctx.dirStack = ['root']);
    if (!args.length) {
      // 交换栈顶两个：无第二项时报错（bash：pushd: no other directory）
      if (stack.length < 2) return { out: '', err: 'pushd: 没有其他目录', code: 1 };
      const top = stack[stack.length - 1];
      const next = stack[stack.length - 2];
      stack[stack.length - 1] = next;
      stack[stack.length - 2] = top;
      return { out: dirStackLines(stack), code: 0, cd: next };
    }
    const id = resolvePath(ctx.cwd, args[0]);
    if (!id || getNode(id)?.type !== 'dir') return { out: '', err: `pushd: ${args[0]}: 没有那个目录`, code: 1 };
    stack.push(id);
    return { out: dirStackLines(stack), code: 0, cd: id };
  },

  // M52.6 popd：弹栈切回上一目录。栈仅 1 项时报错（bash：directory stack empty）。
  popd: (args, ctx) => {
    void args;
    const stack = ctx.dirStack ?? ['root'];
    if (stack.length <= 1) return { out: '', err: 'popd: 目录栈空', code: 1 };
    stack.pop();
    const top = stack[stack.length - 1];
    return { out: dirStackLines(stack), code: 0, cd: top };
  },

  // M52.6 dirs：列目录栈。-c 清空（保留当前 cwd 镜像）。
  dirs: (args, ctx) => {
    const stack = ctx.dirStack ?? (ctx.dirStack = ['root']);
    if (args[0] === '-c') {
      ctx.dirStack = [ctx.cwd];
      return { out: '', code: 0 };
    }
    return { out: dirStackLines(stack), code: 0 };
  },

  // M52.7 pgrep：按名称/appId 查进程。-l 同时显示进程名。
  pgrep: (args, ctx) => {
    let showName = false;
    let pattern = '';
    for (const a of args) {
      if (a === '-l') showName = true;
      else if (a.startsWith('-')) continue;
      else pattern = a;
    }
    void ctx;
    if (!pattern) return { out: '', err: 'pgrep: 用法 pgrep [-l] <模式>', code: 2 };
    const matches = sys.proc.list().filter((p) => p.appId.includes(pattern) || (p.title ?? '').includes(pattern));
    if (!matches.length) return { out: '', code: 1 };
    const lines = matches.map((p) => (showName ? `${p.pid} ${p.appId}` : `${p.pid}`));
    return { out: lines.join('\n'), code: 0 };
  },

  // M52.7 pkill：按名称/appId 杀进程。默认 TERM（sys.proc.close）。
  pkill: (args) => {
    let pattern = '';
    for (const a of args) {
      if (a.startsWith('-')) continue;
      else pattern = a;
    }
    if (!pattern) return { out: '', err: 'pkill: 用法 pkill <模式>', code: 2 };
    const matches = sys.proc.list().filter((p) => p.appId.includes(pattern) || (p.title ?? '').includes(pattern));
    if (!matches.length) return { out: '', err: `pkill: ${pattern}: 未匹配到进程`, code: 1 };
    for (const p of matches) sys.proc.close(p.id);
    return { out: '', code: 0 };
  },

  // M52.8 timeout：带超时执行命令。N 秒后未完成则置 intr 标志中止，返回码 124。
  timeout: async (args, ctx, stdin) => {
    if (args.length < 2) return { out: '', err: 'timeout: 用法 timeout <秒> <命令>', code: 2 };
    const n = Number(args[0]);
    if (!Number.isFinite(n) || n < 0) return { out: '', err: `timeout: ${args[0]}: 非法时长`, code: 2 };
    const line = args.slice(1).join(' ');
    const ms = n * 1000;
    // 0 秒：直接判定超时（与 GNU timeout 一致：不执行命令直接发信号）
    if (ms === 0) return { out: '', err: `timeout: 已超时，杀死「${line}」`, code: 124 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<CmdResult>((r) => {
      timer = setTimeout(() => {
        if (ctx.intr) ctx.intr.flag = true; // 协作式中断：run 在语句/循环边界检查并中止
        r({ out: '', err: `timeout: 已超时，杀死「${line}」`, code: 124 });
      }, ms);
    });
    const runP = run(line, ctx);
    try {
      const res = await Promise.race([runP, timeoutP]);
      return res;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  // M52.9 file：文件类型报告。VFS 节点 kind/mime 推断；目录/文本/二进制。
  file: (args, ctx) => {
    if (!args.length) return { out: '', err: 'file: 用法 file <路径...>', code: 2 };
    const outs: string[] = [];
    let allOk = true;
    for (const p of args) {
      const id = resolvePath(ctx.cwd, p);
      const n = id ? getNode(id) : undefined;
      if (!n) {
        outs.push(`${p}: 没有那个文件或目录`);
        allOk = false;
        continue;
      }
      if (n.type === 'dir') {
        outs.push(`${p}: directory`);
      } else if (n.kind === 'binary') {
        const mime = n.mime ?? 'application/octet-stream';
        outs.push(`${p}: data (${mime}${n.size ? ` ${n.size}B` : ''})`);
      } else {
        // 文本：判断 ASCII/UTF-8
        const c = n.content;
        const isAscii = /^[\x00-\x7F]*$/.test(c);
        outs.push(`${p}: ${isAscii ? 'ASCII text' : 'UTF-8 text'}`);
      }
    }
    return { out: outs.join('\n'), code: allOk ? 0 : 1 };
  },

  // M52.10 command：绕过别名/函数直接找内建命令。本 shell 无外部命令，与 builtin 等价。
  command: (args, ctx) => {
    if (!args.length) return { out: '', code: 0 };
    const [name, ...rest] = args;
    const fn = COMMANDS[name];
    if (!fn) return { out: '', err: `command: ${name}: 未找到`, code: 127 };
    return fn(rest, ctx, '');
  },

  // M52.10 builtin：强制走内建命令（与 command 等价，本 shell 无外部命令）。
  builtin: (args, ctx) => {
    if (!args.length) return { out: '', code: 0 };
    const [name, ...rest] = args;
    const fn = COMMANDS[name];
    if (!fn) return { out: '', err: `builtin: ${name}: 不是内建命令`, code: 1 };
    return fn(rest, ctx, '');
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
// M31：\| 等转义不切分（反斜杠原样保留，交给 tokenize 转 ESC）；双引号内 \" 不闭合引号。
function splitTopLevel(line: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      cur += c;
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\' && i + 1 < line.length) {
        cur += c + line[i + 1]; // \" 不闭合引号
        i++;
        continue;
      }
      cur += c;
      if (c === '"') q = null;
      continue;
    }
    // M26：$( … ) / ` … ` 内部的分隔符不切分（整体跳过；未闭合不当跨度，照常逐字符）
    if ((c === '$' && line[i + 1] === '(') || c === '`') {
      const end = substSpanEnd(line, i);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M45.2 进程替换 <( … ) / >( … ) 内部的分隔符不切分（整体跳过）
    if ((c === '<' || c === '>') && line[i + 1] === '(') {
      const end = matchParen(line, i + 1);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M43：[[ … ]] 内部的 | 不是管道（整体跳过）
    if (c === '[' && isCondStart(line, i)) {
      const end = condSpanEnd(line, i);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      cur += c;
      q = c;
      continue;
    }
    // M31：转义对整体跳过——\| 不是分隔符
    if (c === '\\' && i + 1 < line.length) {
      cur += c + line[i + 1];
      i++;
      continue;
    }
    if (c === sep) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

// 把粘连的重定向算符从 token 里拆出来：>foo → > foo、2>err → 2> err、<in → < in、<<<x → <<< x。
// ⚠️ 本身就是算符的 token（如裸 `>>`）原样保留——否则正则会回溯把 `>>` 拆成 `>` `>`。
// 引号词整体跳过（bash 语义：echo ">x" 的 > 不是算符）。
// M35：<<< / << 长算符必须排在 < 前面匹配（正则交替从左到右）。
const REDIR_OPS = ['<<<', '<<', '2>', '>>', '>', '<'];
function splitRedirToks(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (const t of toks) {
    if (t.q || REDIR_OPS.includes(t.text)) {
      out.push(t);
      continue;
    }
    // M45.2 进程替换 <( … ) / >( … )：整体是一个参数（subst 会替换成路径），不拆出 < / >
    if (t.text.startsWith('<(') || t.text.startsWith('>(')) {
      out.push(t);
      continue;
    }
    const m = /^(<<<|<<|2>|>>|>|<)(.+)$/.exec(t.text);
    if (m) out.push({ text: m[1], q: null }, { text: m[2], q: null });
    else out.push(t);
  }
  return out;
}

interface Redir {
  in: string | null;
  out: string | null;
  append: boolean;
  err: string | null;
  heredoc: number | null; // M35：<< 后哨兵 \x02N → here-doc 表索引
  herestr: string | null; // M35：<<< 后一词（已展开）
}

// 从一段命令的 token 里抽出重定向，返回 [纯命令 token, 重定向, 语法错误?]
function extractRedirs(toks: string[]): { rest: string[]; redir: Redir; error?: string } {
  const redir: Redir = { in: null, out: null, append: false, err: null, heredoc: null, herestr: null };
  const rest: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '<' || t === '>' || t === '>>' || t === '2>' || t === '<<' || t === '<<<') {
      const file = toks[++i];
      if (file == null) return { rest, redir, error: 'qzsh: 语法错误：重定向缺少目标文件' };
      if (t === '<') redir.in = file;
      else if (t === '2>') redir.err = file;
      else if (t === '<<<') redir.herestr = file;
      else if (t === '<<') {
        // M35：heredoc 哨兵由 scanHeredocs 生成（`<< \x02N`）；不是哨兵说明预处理没见到它（理论不可达）
        const m = /^\x02(\d+)$/.exec(file);
        if (!m) return { rest, redir, error: 'qzsh: 语法错误：here-document 缺少分隔符' };
        redir.heredoc = Number(m[1]);
      } else {
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
    if (q === "'") {
      cur += c;
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\' && n !== undefined) {
        cur += c + n; // M31：\" 不闭合引号
        i++;
        continue;
      }
      cur += c;
      if (c === '"') q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      cur += c;
      q = c;
      continue;
    }
    // M26：$( … ) / ` … ` 内部的 ; && || 不当连接符
    if ((c === '$' && n === '(') || c === '`') {
      const end = substSpanEnd(line, i);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M45.2 进程替换 <( … ) / >( … ) 内部的 ; && || 不当连接符（整体跳过）
    if ((c === '<' || c === '>') && n === '(') {
      const end = matchParen(line, i + 1);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M43：[[ … ]] 内部的 ; && || 不当连接符（整体跳过）
    if (c === '[' && isCondStart(line, i)) {
      const end = condSpanEnd(line, i);
      if (end !== -1) {
        cur += line.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M31：\; \& \| 转义不当连接符
    if (c === '\\' && n !== undefined) {
      cur += c + n;
      i++;
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
  let exit = false; // M52.1：exit 跨语句段传播
  let ran = false;
  // M44.2 set -e：最后一个非空段的索引——只有末段失败才中止；前面段的失败属「&&/|| 非末段」
  // 豁免（bash：set -e; false && echo x 不退出；true && false 才退出）。被跳过的段不更新 lastCode，
  // 故「最后运行的段 = 末段」与「失败段是末段」等价，在失败当场判定即可。
  let lastSegIdx = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].cmd.trim()) lastSegIdx = i;
  for (let i = 0; i < segs.length; i++) {
    const { before, cmd } = segs[i];
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
    if (res.exit) exit = true; // M52.1：exit 跨语句段传播
    // M44.2：errexit 开 + 非豁免上下文 + 末段失败 → 抛 ShellExit（携带本行已产出 out/err 防丢失）
    if (res.code !== 0 && i === lastSegIdx && ctx.errexit && !(ctx.noErrExit ?? 0))
      throw new ShellExit(res.code, outs.join('\n'), errs.join('\n'));
  }
  if (!ran) return { out: '', code: 0 };
  return { out: outs.join('\n'), err: errs.length ? errs.join('\n') : undefined, code: lastCode, cd, clear, exit };
}

// ── 脚本/控制流解释器（if/for/while + ; 与换行分句；叶子语句交给 runLine）──────────
type SNode =
  | { t: 'cmd'; text: string }
  | { t: 'if'; branches: { cond: string; body: SNode[] }[]; elseBody: SNode[] | null }
  | { t: 'for'; varName: string; words: string; body: SNode[] }
  | { t: 'forArith'; init: string; cond: string; step: string; body: SNode[] } // M46.3：for ((init; cond; step)); do …; done
  | { t: 'group'; body: SNode[] } // M47.2：{ …; } 当前 shell 分组（赋值/cd 生效，区别于 ( ) 子 shell）
  | { t: 'subshell'; body: string } // M47.3：( …; ) 子 shell（fork ctx，cd/export 不回流；body 存文本，executor fork 后 run）
  | { t: 'while'; cond: string; body: SNode[]; until?: boolean } // M37：until = until: true（条件取反）
  | { t: 'funcdef'; name: string; body: string } // M32：函数定义 name() { … }，body 存语句文本（注册进 ctx.funcs）
  | { t: 'case'; word: string; arms: { patterns: string[]; body: SNode[] }[] }; // M33：case 词 in 模式) 体 ;; esac

const CTRL_KW = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', '}', 'case', 'esac']);

// M35：here-document 表项。body 在执行时按 expand 决定是否经 subst 展开（分隔符带引号 → 字面）。
interface Heredoc {
  body: string;
  expand: boolean;
}

// M35：here-doc 预处理 —— 在分句前把 <<[-]DELIM\n…body…\nDELIM 整段替换为哨兵词 `<< \x02N`。
// 为什么独立一层：body 里的 ; / 换行 / 引号 / # 都不该参与分句与引号扫描（逐字传给命令 stdin）。
// 哨兵走 \x02（区别于 M31 转义哨兵 \x01——stripEsc 不会误剥）；索引指向本函数的 heredocs 表。
// 头行剩余内容（如 `cat <<EOF; echo after`）留在原文继续正常扫描；body 从头行换行后开始吞。
// 同头行多 heredoc（cat <<A; cat <<B）按出现顺序排队依次吞 body（bash 同序）。
// 未闭合 → 抛「缺少闭合行」（脚本=语法错；交互层 needsContinuation 借此判续行）。
function scanHeredocs(text: string): { text: string; heredocs: Heredoc[] } {
  const heredocs: Heredoc[] = [];
  let out = '';
  let q: '"' | "'" | null = null;
  let pending: { delim: string; stripTabs: boolean; idx: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q === "'") {
      out += c;
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\' && i + 1 < text.length) {
        out += c + text[i + 1];
        i++;
        continue;
      }
      out += c;
      if (c === '"') q = null;
      continue;
    }
    // $( … ) / ` … ` 整体跳过：内部若有 heredoc 由 subst 递归 run 时自行预处理
    if ((c === '$' && text[i + 1] === '(') || c === '`') {
      const end = substSpanEnd(text, i);
      if (end !== -1) {
        out += text.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      out += c;
      q = c;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      out += c + text[i + 1]; // 转义对整体通过（\<< 不触发 heredoc）
      i++;
      continue;
    }
    // heredoc 检测：<< 且非 <<<（here-string 是行内语法，留给 extractRedirs），前一个字符也不是 <
    if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<' && text[i - 1] !== '<') {
      let j = i + 2;
      let stripTabs = false;
      if (text[j] === '-') {
        stripTabs = true;
        j++;
      }
      while (text[j] === ' ' || text[j] === '\t') j++;
      // 分隔符词：支持引号段拼接（'EOF'/"EOF" → 字面 body）；\X 转义并入词
      let delim = '';
      let quoted = false;
      let badQuote = false;
      while (j < text.length) {
        const d = text[j];
        if (d === "'" || d === '"') {
          const close = text.indexOf(d, j + 1);
          if (close === -1) {
            badQuote = true; // 分隔符引号未闭合 → 不当 heredoc（留给引号扫描/续行判定处理）
            break;
          }
          quoted = true;
          delim += text.slice(j + 1, close);
          j = close + 1;
          continue;
        }
        if (d === ' ' || d === '\t' || d === ';' || d === '\n') break;
        if (d === '\\' && j + 1 < text.length && text[j + 1] !== '\n') {
          delim += text[j + 1];
          j += 2;
          continue;
        }
        if (d === '\\') break; // \<换行> 续行：分隔符到此为止
        delim += d;
        j++;
      }
      if (badQuote) {
        out += c;
        continue;
      }
      if (!delim) throw new Error('here-document 缺少分隔符');
      const idx = heredocs.length;
      heredocs.push({ body: '', expand: !quoted });
      pending.push({ delim, stripTabs, idx });
      out += '<< \x02' + idx;
      i = j - 1; // 同行剩余（; echo …）回主循环继续扫描
      continue;
    }
    out += c;
    // 头行结束（换行）→ 依 pending 队列顺序吞各 heredoc 的 body
    if (c === '\n' && pending.length) {
      for (const ph of pending) {
        let body = '';
        let k = i + 1;
        for (;;) {
          const nl = text.indexOf('\n', k);
          const lineRaw = nl === -1 ? text.slice(k) : text.slice(k, nl);
          const line = ph.stripTabs ? lineRaw.replace(/^\t+/, '') : lineRaw;
          if (line === ph.delim) {
            k = nl === -1 ? text.length : nl + 1;
            break;
          }
          body += line + '\n';
          if (nl === -1) throw new Error(`here-document 缺少闭合行（${ph.delim}）`);
          k = nl + 1;
        }
        heredocs[ph.idx].body = body;
        i = k - 1; // 主循环 i++ 后从闭合行之后继续
      }
      pending = [];
    }
  }
  if (pending.length) throw new Error(`here-document 缺少闭合行（${pending[0].delim}）`);
  return { text: out, heredocs };
}

// 按 ; 与换行切成语句（尊重引号 + M26 命令替换跨度）。trim、去空。
// M31：\; 转义不分句；\<换行> 续行拼接；双引号内 \" 不闭合引号。
// M35：先经 scanHeredocs 抽走 here-doc body（哨兵替换），返回 heredocs 表供执行层按索引取用。
function splitStatements(text: string): { stmts: string[]; heredocs: Heredoc[] } {
  const scanned = scanHeredocs(text);
  text = scanned.text;
  const out: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q === "'") {
      cur += c;
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\' && i + 1 < text.length) {
        cur += c + text[i + 1]; // \" 不闭合引号
        i++;
        continue;
      }
      cur += c;
      if (c === '"') q = null;
      continue;
    }
    // M26：$( … ) / ` … ` 内部的 ; 换行不切断语句
    if ((c === '$' && text[i + 1] === '(') || c === '`') {
      const end = substSpanEnd(text, i);
      if (end !== -1) {
        cur += text.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M45.2 进程替换 <( … ) / >( … ) 内部的 ; 换行不切断语句（整体跳过）
    if ((c === '<' || c === '>') && text[i + 1] === '(') {
      const end = matchParen(text, i + 1);
      if (end !== -1) {
        cur += text.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M43：[[ … ]] 内部的 ; 换行不切断语句（整体跳过）
    if (c === '[' && isCondStart(text, i)) {
      const end = condSpanEnd(text, i);
      if (end !== -1) {
        cur += text.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    // M46.3：(( … )) 算术跨度（for ((init; cond; step)) 形式）内部 ; 不切断语句。
    // 判定：紧邻双左括号且前字符是命令起始边界（行首/空白/;/&/|）—— 区别于 ( (cmd) ) 子 shell 嵌套（中间有空格）。
    if (c === '(' && text[i + 1] === '(') {
      const prev = text[i - 1];
      if (i === 0 || prev === undefined || /[\s;|&]/.test(prev)) {
        const end = matchParen(text, i);
        if (end !== -1) {
          cur += text.slice(i, end + 1);
          i = end;
          continue;
        }
      }
    }
    // M47.3：( … ) 子 shell 跨度（单括号，非 (( 算术）内部 ; 换行不切断语句。
    // 判定：单左括号（text[i+1] !== '('）且前字符是命令起始边界（行首/空白/;/&/|）。
    // $( / </>( 已被前置分支处理（continue 走不到这里），故此处 ( 必是子 shell 起始。
    if (c === '(' && text[i + 1] !== '(') {
      const prev = text[i - 1];
      if (i === 0 || prev === undefined || /[\s;|&]/.test(prev)) {
        const end = matchParen(text, i);
        if (end !== -1) {
          cur += text.slice(i, end + 1);
          i = end;
          continue;
        }
      }
    }
    if (c === '"' || c === "'") {
      cur += c;
      q = c;
      continue;
    }
    // M31：转义对整体跳过（\; 不分句）；\<换行> 续行——两字符都丢弃
    if (c === '\\' && i + 1 < text.length) {
      if (text[i + 1] === '\n') {
        i++;
        continue;
      }
      cur += c + text[i + 1];
      i++;
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
  return { stmts: out, heredocs: scanned.heredocs };
}
const firstWord = (s: string): string => (s ?? '').trim().split(/\s+/)[0] ?? '';
const afterWord = (s: string): string => (s ?? '').trim().replace(/^\S+\s*/, ''); // 去掉首词

// M46.3：把 for ((init; cond; step)) 的算术头按顶层 ; 切成三段。
// 尊重括号嵌套（如 i<f(a;b)）与引号；缺项补空串（for ((; ;)) 合法）。
function splitArithFor(s: string): [string, string, string] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let q: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { cur += c; if (c === "'") q = null; continue; }
    if (q === '"') {
      if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++; continue; }
      cur += c; if (c === '"') q = null; continue;
    }
    if (c === '"' || c === "'") { cur += c; q = c; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i++; continue; }
    if (c === '(') { depth++; cur += c; continue; }
    if (c === ')') { depth--; cur += c; continue; }
    if (c === ';' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  while (parts.length < 3) parts.push('');
  return [parts[0].trim(), parts[1].trim(), parts[2].trim()];
}

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
    const head = (stmts[p] ?? '').trim();
    p++;
    // M46.3：for ((init; cond; step)); do …; done —— C 风格算术 for。
    // ((…)) 内部 ; 已被 splitStatements 整体跳过，此处 head 形如 "for ((init; cond; step))"。
    const arith = /^for\s*\(\(([\s\S]*)\)\)\s*$/.exec(head);
    if (arith) {
      const parts = splitArithFor(arith[1]);
      const body = inlineDoBody();
      expect('done');
      p++;
      return { t: 'forArith', init: parts[0], cond: parts[1], step: parts[2], body };
    }
    // 经典 for-in：for VAR in WORDS
    const toks = head.split(/\s+/);
    const varName = toks[1] ?? '';
    const inIdx = toks.indexOf('in');
    if (!varName || inIdx < 1) throw new Error('for 语法：for 变量 in 词…; do … done');
    const words = toks.slice(inIdx + 1).join(' ');
    const body = inlineDoBody();
    expect('done');
    p++;
    return { t: 'for', varName, words, body };
  }
  // M47.2 { …; } 命令分组：当前 shell 执行一组命令（赋值/cd 生效，区别于 ( ) 子 shell）。
  // 语法：{ 后需空白/换行（{ 是保留字），} 前需 ;/换行。splitStatements 按 ;/换行切后：
  //   { echo a; echo b; } → stmts = ['{ echo a', 'echo b', '}']
  //   { 独占行 → stmts = ['{', 'echo a', 'echo b', '}']
  // 首条 stmt '{ xxx' 的 xxx 可能是控制结构头（{ if true），reinject 让 parseSeq 配合后续 stmts。
  // } 闭合：} 后有内容（} > f / } && cmd）报错——已知限制：未做 splitStatements 跨度改造。
  function parseGroup(): SNode {
    const head = stmts[p];
    const after = afterWord(head).trim(); // 剥首 { 后剩余（{ echo a → echo a；{ 单独 → ''）
    p++;
    if (after) stmts.splice(p, 0, after); // reinject：让 parseSeq 自然解析（含控制结构头）
    const body = parseSeq(new Set(['}'])); // 收集体到 } 闭合（嵌套 { } 递归自然生效）
    if (p >= stmts.length || firstWord(stmts[p]) !== '}') {
      throw new Error('{ 缺少闭合 }');
    }
    const afterClose = afterWord(stmts[p]).trim();
    if (afterClose) {
      throw new Error(`} 之后意外的 ${afterClose}`);
    }
    p++;
    return { t: 'group', body };
  }
  // M47.3 ( …; ) 子 shell：fork ctx 执行，cd/export/赋值不回流父 shell。
  // splitStatements 已把 ( … ) 当跨度跳过（matchParen 配对），故 stmts[p] 形如 '( cmd1; cmd2 )'。
  // 用 matchParen 提取括号内文本作为 body（存文本，executor fork subCtx 后调 run() 重新解析执行，
  // 复用命令替换 $(…) 的 fork ctx 模式）。) 后剩余（重定向/连接符）报错——已知限制。
  function parseSubshell(): SNode {
    const raw = stmts[p].trim();
    const end = matchParen(raw, 0);
    if (end === -1) throw new Error('( 缺少闭合 )');
    const inner = raw.slice(1, end).trim(); // 括号内文本（可能含 ; 控制结构，executor 重新解析）
    const after = raw.slice(end + 1).trim(); // ) 后剩余
    if (after) throw new Error(`) 之后意外的 ${after}`);
    p++;
    return { t: 'subshell', body: inner };
  }
  // M37：while / until 共用解析——until 是条件取反的 while（until: true 标志，执行层翻转条件判定）
  function parseWhile(): SNode {
    const isUntil = firstWord(stmts[p]) === 'until';
    const cond = afterWord(stmts[p]);
    p++;
    const body = inlineDoBody();
    expect('done');
    p++;
    return { t: 'while', cond, body, until: isUntil };
  }
  // M32 函数定义：name() { … } 或 name () { … }。`{` 后同行内容作为 body 首句；
  // 闭合判定：语句首词是 `}`（bash：`}` 是保留字，只在命令位置生效），`}` 后剩余 reinject 回解析。
  // 已知差异：不支持嵌套函数定义（f() { g() { …; }; } 会在内层 `}` 提前闭合），记录在案。
  const FUNC_HEAD = /^([A-Za-z_]\w*)\s*\(\s*\)\s*\{(.*)$/;
  function parseFuncdef(): SNode {
    const m = FUNC_HEAD.exec(stmts[p]);
    const name = m![1];
    let rest = m![2].trim();
    p++;
    const parts: string[] = [];
    for (;;) {
      if (firstWord(rest) === '}') {
        const tail = afterWord(rest);
        if (tail) stmts.splice(p, 0, tail); // `} && echo x` 的尾巴回到解析流
        break;
      }
      if (rest) parts.push(rest);
      if (p >= stmts.length) throw new Error(`函数 ${name} 缺少闭合 }`);
      rest = stmts[p];
      p++;
    }
    return { t: 'funcdef', name, body: parts.join('; ') };
  }
  // M33 case：case 词 in [模式|模式) 体 ;;]… esac。`;;` 已被 splitStatements 按 `;` 自然分句（空段丢弃），
  // 故每个 arm 起始语句形如 `模式) 体首句`（体跨语句时后续语句自动流入，直到下一 arm 开头或 esac）。
  // 已知差异：体内命令含未引号 `)` 会被误判为 arm 边界（bash 同样不允许裸 `)`）；模式里的 `|` 不支持引号包裹（记录在案）。
  const ARM = /^\(?\s*([^()]+?)\)\s*(.*)$/s; // 可选前括号 + 模式列表 + ) + 体首句
  const isArmStart = (s: string): boolean => ARM.test(s);
  function parseCase(): SNode {
    let word: string;
    let rest: string | undefined;
    const m = /^case\s+(.+?)\s+in(?:\s+(.*))?$/.exec(stmts[p]);
    if (m) {
      word = m[1];
      rest = m[2];
      p++;
    } else {
      // bash 允许 `case 词` 换行后单独一行 `in`
      const m2 = /^case\s+(.+)$/.exec(stmts[p]);
      if (m2 && firstWord(stmts[p + 1] ?? '') === 'in') {
        word = m2[1];
        rest = afterWord(stmts[p + 1]);
        p += 2;
      } else throw new Error('case 语法：case 词 in 模式) 命令 ;; esac');
    }
    if (rest?.trim()) stmts.splice(p, 0, rest.trim()); // in 同行的首个 arm 回插解析流
    const arms: { patterns: string[]; body: SNode[] }[] = [];
    while (p < stmts.length) {
      if (firstWord(stmts[p]) === 'esac') {
        p++;
        return { t: 'case', word, arms };
      }
      const am = ARM.exec(stmts[p]);
      if (!am) throw new Error(`case 缺少闭合 esac（或模式语法错误：${stmts[p]}）`);
      const patterns = am[1]
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const bodyFirst = am[2].trim();
      p++;
      if (bodyFirst) stmts.splice(p, 0, bodyFirst);
      // 体：直到下一 arm 开头或 esac —— 复用 parseSeq 递归（嵌套 if/for/while/case 自然生效）
      arms.push({ patterns, body: parseSeq(new Set(['esac']), isArmStart) });
    }
    throw new Error('case 缺少闭合 esac');
  }
  function parseSeq(stops: Set<string>, stopPred?: (s: string) => boolean): SNode[] {
    const nodes: SNode[] = [];
    while (p < stmts.length) {
      const fw = firstWord(stmts[p]);
      if (stops.has(fw)) break;
      // 控制结构优先于 stopPred：`case b in b) …` 这类「控制头里恰好有 )」的语句不能被误判为 arm 边界
      if (fw === 'if') {
        nodes.push(parseIf());
        continue;
      }
      if (fw === 'for') {
        nodes.push(parseFor());
        continue;
      }
      if (fw === 'while' || fw === 'until') {
        // M37：until 与 while 同节点（until 标志区分）
        nodes.push(parseWhile());
        continue;
      }
      if (fw === 'case') {
        nodes.push(parseCase());
        continue;
      }
      if (fw === '{') {
        // M47.2：{ …; } 命令分组（当前 shell 执行，赋值/cd 生效）
        nodes.push(parseGroup());
        continue;
      }
      if (fw === '(') {
        // M47.3：( …; ) 子 shell（fork ctx，cd/export 不回流）
        nodes.push(parseSubshell());
        continue;
      }
      if (FUNC_HEAD.test(stmts[p])) {
        nodes.push(parseFuncdef());
        continue;
      }
      if (stopPred?.(stmts[p])) break; // M33：case 体遇下一 arm 起始（模式) ）停止
      if (CTRL_KW.has(fw)) throw new Error(`意外的 ${fw}`);
      nodes.push({ t: 'cmd', text: stmts[p] });
      p++;
    }
    return nodes;
  }
  const result = parseSeq(new Set());
  if (p < stmts.length) throw new Error(`意外的 ${firstWord(stmts[p])}`);
  return result;
}

// for 词表展开：subst $VAR + 按空白切 + glob（* ? […]）路径名展开。
// bash 语义：引号词不 glob（"*" 是字面星号）；无引号变量展开为空 → 空词删除。
// M29：词表同走花括号/波浪号展开（for i in {1..3} / for d in ~/*）。
// M38：glob 升级为路径感知（for f in sub/*.txt），与命令参数共用 globExpand。
async function expandWords(text: string, ctx: ShellCtx): Promise<string[]> {
  if (!text.trim()) return [];
  const out: string[] = [];
  for (const t of tokenize(text)) {
    for (const v0 of t.q === null ? braceExpand(t.text) : [t.text]) {
      const v = t.q === null ? tildeExpand(v0, ctx.env.HOME ?? '/', userHome) : v0;
      const w = await subst(v, ctx, t.q);
      if (w === '' && t.q === null && v0 !== '') continue; // 空词删除（同 expandToks）
      if (!t.q && hasGlob(w)) {
        const hits = globExpand(w, ctx);
        out.push(...(hits ?? [stripEsc(w)]));
      } else out.push(stripEsc(w));
    }
  }
  return out;
}

const MAX_LOOP = 5000; // while/for 迭代上限（防失控；够交互用，又不至于卡死/堆爆输出）
const OUT_CAP = 100000; // 单次执行累计输出上限（字符）；超了就截断，防失控循环堆出几 MB

// Ctrl+C 中断信号：checkIntr 在语句/迭代边界抛出，一路 unwind 到 run 顶层转成 130 退出码。
// 用异常而非标志位逐级返回：嵌套的 if/for/while 与递归 execNode 不用各自传递「已中断」状态。
class ShellInterrupt extends Error {}

// M44.2 set -e 中止信号：runLine 在「非豁免 + 失败」处抛出，携带本行已产出 out/err 防丢失，
// 一路 unwind 到最近一层 run 转成退出码（嵌套函数/脚本逐层转成结果码，外层按自身上下文再判）。
class ShellExit extends Error {
  constructor(
    public code: number,
    public out = '',
    public err = '',
  ) {
    super('errexit');
  }
}

// 后台作业的 promise 表（作业号 → 该作业的执行 promise）。给 fg/wait 等待用。
const bgPromises = new Map<number, Promise<CmdResult>>();

// 后台执行一条命令（cmd &）：不 await、登记一条作业、立刻返回。
// 用 ctx 的副本，免得后台作业的 cd/export 串改前台 shell。完成时发通知。
function backgroundRun(cmd: string, ctx: ShellCtx): CmdResult {
  const job = addJob(cmd);
  // 裁剪 bgPromises：jobs.list 已封顶 30，掉出列表的作业号对应的 promise 一并清掉，免 Map 只增不减（长会话泄漏）。
  const live = new Set(jobs.list.map((j) => j.n));
  for (const k of bgPromises.keys()) if (!live.has(k)) bgPromises.delete(k);
  const bgCtx: ShellCtx = {
    cwd: ctx.cwd,
    env: { ...ctx.env },
    code: 0,
    pid: ctx.pid,
    funcs: { ...ctx.funcs }, // M32：后台作业拷贝函数表，定义不回流前台
    positional: ctx.positional ? [...ctx.positional] : [],
    funcDepth: ctx.funcDepth ?? 0,
    retFlag: null,
    loopDepth: 0, // M37：后台作业是独立执行环境，不继承前台循环
    loopCtl: null,
  };
  const p = run(cmd, bgCtx)
    .catch((e): CmdResult => ({ out: '', err: e instanceof Error ? e.message : String(e), code: 1 }))
    .then((res) => {
      finishJob(job.n, res.code);
      try {
        sys.notify(`作业 [${job.n}] 结束`, { body: cmd.slice(0, 50), level: res.code === 0 ? 'success' : 'warn', source: '终端' });
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
  // M52.2：记录命令历史。Terminal 在调用前已 addHistory（dedup 守卫防重复）；
  // 脚本/测试直接调 run 时由这里补登，保证 history 命令在任何入口都能看到刚执行的命令。
  addHistory(t);
  // 末尾单个 &（非 &&）→ 后台标记；但 \&（奇数个反斜杠紧贴前缀）是 M31 转义字面 &，不触发后台
  const trailingBg = (() => {
    if (!t.endsWith('&') || t.endsWith('&&')) return false;
    let bs = 0;
    for (let i = t.length - 2; i >= 0 && t[i] === '\\'; i--) bs++;
    return bs % 2 === 0;
  })();
  if (trailingBg) {
    const body = t.slice(0, -1).trim();
    if (body) return backgroundRun(body, ctx);
  }
  let ast: SNode[];
  let heredocs: Heredoc[];
  try {
    const split = splitStatements(text);
    ast = parseStatements(split.stmts);
    heredocs = split.heredocs;
  } catch (e) {
    return { out: '', err: 'qzsh: 语法错误：' + (e instanceof Error ? e.message : String(e)), code: 2 };
  }
  // M35：here-doc 表挂 ctx 供 runPipeline 按哨兵索引取用；嵌套 run（脚本/函数/$(…)）各自一张表，
  // 本层返回前恢复父表——哨兵索引只在本层文本内有效。
  const savedHeredocs = ctx.heredocs;
  ctx.heredocs = heredocs;
  const outs: string[] = [];
  const errs: string[] = [];
  let lastCode = 0;
  let cd: string | undefined;
  let clear = false;
  let exit = false; // M52.1：exit 命令传播——置位后本层 execNodes 立即停，result.exit=true 传给 Terminal
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
    // M35：语句输出统一剥尾随换行——echo 惯例本无尾换行，heredoc/here-string/文件内容的
    // 结构性尾换行只活在 stdin 层（wc -l 等需要），不透到语句显示输出（bash 手感一致）。
    const out = res.out.replace(/\n+$/, '');
    if (out) collect(outs, out);
    if (res.err) collect(errs, res.err);
    if (res.cd) {
      cd = res.cd;
      ctx.cwd = res.cd;
    }
    if (res.clear) clear = true;
    if (res.exit) exit = true; // M52.1：exit 命令——置位让 execNodes 停止后续语句
    lastCode = res.code;
    ctx.code = res.code; // 同步回 ctx：后续语句的 $? 实时反映上一条命令退出码（bash 语义）
  };
  const execNodes = async (nodes: SNode[]) => {
    // retFlag（return 信号）：语句边界检查——函数/脚本体内后续语句不再执行，信号向上传到边界清除
    // loopCtl（break/continue 信号，M37）：同语句边界检查——`break; echo x` 的 echo 不再执行，信号传到循环边界消费
    // exit（M52.1）：exit 命令——本层立即停，result.exit=true 向上传给 Terminal 关窗
    for (const n of nodes) {
      await execNode(n);
      if (ctx.retFlag || ctx.loopCtl || exit) return;
    }
  };
  // Ctrl+C 检查点：语句边界 + 每次循环迭代。粒度是「语句级」——单条长命令（如 curl）体内不打断。
  const checkIntr = () => {
    if (ctx.intr?.flag) throw new ShellInterrupt();
  };
  // M37：循环迭代边界消费 loopCtl 信号。返回 'break' 本层出圈 / 'continue' 跳过本迭代剩余 /
  // 'propagate'（n>1 已递减，调用方 return 向上传，外层循环边界再消费）/ null 无信号。
  const consumeLoopCtl = (): 'break' | 'continue' | 'propagate' | null => {
    const ctl = ctx.loopCtl;
    if (!ctl) return null;
    if (ctl.n === 1) {
      ctx.loopCtl = null;
      return ctl.op;
    }
    ctx.loopCtl = { op: ctl.op, n: ctl.n - 1 };
    return 'propagate';
  };
  const execNode = async (n: SNode): Promise<void> => {
    checkIntr();
    if (n.t === 'cmd') return runLeaf(n.text);
    if (n.t === 'funcdef') {
      // M32：函数定义 = 注册进 ctx.funcs（bash：定义时函数体不展开不执行，原样存文本）
      (ctx.funcs ??= {})[n.name] = n.body;
      lastCode = 0;
      ctx.code = 0;
      return;
    }
    if (n.t === 'case') {
      // M33：word 展开（剥哨兵字面）；模式逐个展开后 globToRe 匹配（保留 ESC——转义的 * 是字面）。
      // 首个命中 arm 执行体（bash ;; 语义：执行完即结束）；无匹配/空体 → 退出码 0。
      lastCode = 0;
      ctx.code = 0;
      const word = stripEsc((await expandToks(tokenize(n.word), ctx, false)).join(' '));
      for (const arm of n.arms) {
        let hit = false;
        for (const pat of arm.patterns) {
          const pExp = (await expandToks(tokenize(pat), ctx, false)).join(' ');
          if (globToRe(pExp).test(word)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          await execNodes(arm.body);
          return;
        }
      }
      return;
    }
    if (n.t === 'if') {
      for (const br of n.branches) {
        // M44.2：条件求值期间豁免 set -e（bash：if/elif 条件里的失败不触发中止，且深入条件调用的函数体）
        ctx.noErrExit = (ctx.noErrExit ?? 0) + 1;
        try {
          await runLeaf(br.cond); // 条件命令的退出码决定走哪支
        } finally {
          ctx.noErrExit!--;
        }
        if (lastCode === 0) return execNodes(br.body);
      }
      if (n.elseBody) await execNodes(n.elseBody);
      return;
    }
    if (n.t === 'for') {
      // M37：loopDepth++ 使体内 break/continue 合法化；迭代边界消费 loopCtl 信号
      ctx.loopDepth = (ctx.loopDepth ?? 0) + 1;
      try {
        for (const w of await expandWords(n.words, ctx)) {
          checkIntr();
          if (ctx.retFlag) return; // return 信号：中止循环向上传
          ctx.env[n.varName] = w;
          await execNodes(n.body);
          if (ctx.retFlag) return;
          const ctl = consumeLoopCtl();
          if (ctl === 'break') break;
          if (ctl === 'propagate') return; // n>1：信号已递减，外层循环边界继续消费
          if (++loops > MAX_LOOP || truncated) return;
          if (loops % 256 === 0) await new Promise((r) => setTimeout(r)); // 周期性让出主线程，别冻 UI
        }
      } finally {
        ctx.loopDepth!--;
      }
      return;
    }
    if (n.t === 'forArith') {
      // M46.3：C 风格 for ((init; cond; step))。init/step 可有赋值副作用；cond 非零为真（空 cond 视为真）。
      // 算术错误（除零/语法错）推 errs + lastCode=1 终止循环。break/continue 同 for-in。
      ctx.loopDepth = (ctx.loopDepth ?? 0) + 1;
      try {
        let arithFailed = false;
        const evalNoErr = (expr: string): void => {
          if (!expr || arithFailed) return;
          try {
            evalArith(expr, ctx.env, ctx.positional ?? []);
          } catch (e) {
            errs.push(String((e as Error).message ?? e));
            lastCode = 1; ctx.code = 1;
            arithFailed = true;
          }
        };
        const evalCond = (expr: string): boolean => {
          if (!expr) return true;
          try {
            return evalArith(expr, ctx.env, ctx.positional ?? []) !== 0;
          } catch (e) {
            errs.push(String((e as Error).message ?? e));
            lastCode = 1; ctx.code = 1;
            arithFailed = true;
            return false;
          }
        };
        evalNoErr(n.init);
        for (;;) {
          if (arithFailed) return;
          checkIntr();
          if (ctx.retFlag) return;
          const condOk = evalCond(n.cond);
          if (arithFailed) return;
          if (!condOk) break; // cond 假正常出循环
          await execNodes(n.body);
          if (ctx.retFlag) return;
          const ctl = consumeLoopCtl();
          if (ctl === 'break') break;
          if (ctl === 'propagate') return;
          evalNoErr(n.step);
          if (++loops > MAX_LOOP || truncated) return;
          if (loops % 256 === 0) await new Promise((r) => setTimeout(r));
        }
      } finally {
        ctx.loopDepth!--;
      }
      return;
    }
    if (n.t === 'group') {
      // M47.2：当前 shell 执行分组体（赋值/cd 生效，与 ( ) 子 shell 对照）。
      // 退出码 = 最后一条命令的码（execNodes 已逐条更新 lastCode/ctx.code）。
      await execNodes(n.body);
      return;
    }
    if (n.t === 'subshell') {
      // M47.3：( …; ) 子 shell：fork ctx 执行，cd/export/赋值不回流父 shell。
      // 复用 $(…) 的 fork ctx 模式（execCmdSubst line 327）：env/funcs/positional 副本、
      // intr 共享引用（Ctrl+C 能断子 shell 内循环）、loopDepth=0、traps 不带（bash 子 shell 重置陷阱）。
      // 子 shell 的 stdout/stderr 流回父 shell（区别于 $(…) 是捕获作字符串替换），
      // 退出码回流父 shell（( false ) → 父 $? = 1，bash 语义）。
      const subCtx: ShellCtx = {
        cwd: ctx.cwd,
        env: { ...ctx.env },
        code: ctx.code,
        pid: ctx.pid,
        intr: ctx.intr,
        funcs: { ...ctx.funcs },
        positional: ctx.positional ? [...ctx.positional] : [],
        funcDepth: ctx.funcDepth ?? 0,
        retFlag: null,
        loopDepth: 0,
        loopCtl: null,
        runDepth: ctx.runDepth,
        errexit: ctx.errexit,
        noErrExit: ctx.noErrExit ?? 0,
      };
      const res = await run(n.body, subCtx);
      // Ctrl+C 断子 shell 内循环：内层 run 吞成 130 + flag 仍置位 → 抛 ShellInterrupt 向上 unwind
      if (res.code === 130 && ctx.intr?.flag) throw new ShellInterrupt();
      const out = res.out.replace(/\n+$/, '');
      if (out) collect(outs, out);
      if (res.err) collect(errs, res.err);
      lastCode = res.code;
      ctx.code = res.code;
      return;
    }
    // while / until（M37：until 条件取反——条件为假时跑体，转真即停）
    ctx.loopDepth = (ctx.loopDepth ?? 0) + 1;
    try {
      for (;;) {
        checkIntr();
        if (ctx.retFlag) return;
        // M44.2：条件求值豁免 set -e（条件转假是正常出循环，不是错误）
        ctx.noErrExit = (ctx.noErrExit ?? 0) + 1;
        try {
          await runLeaf(n.cond);
        } finally {
          ctx.noErrExit!--;
        }
        const condOk = n.until ? lastCode !== 0 : lastCode === 0;
        if (!condOk) break;
        await execNodes(n.body);
        if (ctx.retFlag) return;
        const ctl = consumeLoopCtl();
        if (ctl === 'break') break;
        if (ctl === 'propagate') return;
        if (++loops > MAX_LOOP) {
          errs.push(`${n.until ? 'until' : 'while'}: 超过最大迭代次数`);
          break;
        }
        if (truncated) break; // 输出已截断，没必要再空转
        if (loops % 256 === 0) await new Promise((r) => setTimeout(r));
      }
    } finally {
      ctx.loopDepth!--;
    }
  };

  // M43.3：run 深度计数（共享引用随 ctx 走，同 intr 模式）——INT trap 只在最外层边界触发。
  const rd = (ctx.runDepth ??= { n: 0 });
  rd.n++;
  const outermost = rd.n === 1;
  try {
    let result: CmdResult;
    try {
      await execNodes(ast);
      result = { out: outs.join('\n'), err: errs.length ? errs.join('\n') : undefined, code: lastCode, cd, clear, exit };
    } catch (e) {
      if (e instanceof ShellInterrupt) {
        // Ctrl+C：flag 不清零（调用方每次执行前复位）→ 嵌套 run（sh 脚本/source）的外层循环也会中止
        errs.push('^C');
        result = { out: outs.join('\n'), err: errs.join('\n'), code: 130, cd, clear, exit };
      } else if (e instanceof ShellExit) {
        // M44.2 set -e：保留本层与抛出点已产出输出，按携带码静默收尾（bash 不追加报错）。
        // 嵌套 run（函数/脚本/source/eval）各自在此转成结果码，外层按自身 errexit/豁免上下文再判是否继续中止。
        const eo = e.out.replace(/\n+$/, '');
        if (eo) collect(outs, eo);
        if (e.err) collect(errs, e.err);
        result = { out: outs.join('\n'), err: errs.length ? errs.join('\n') : undefined, code: e.code, cd, clear, exit };
      } else {
        // 展开阶段错误（未闭合 $( … )/反引号、算术语法错误、除零）：保留已产出输出，报错收尾。
        // bash 对算术错误退出码 1、对未闭合替换是解析错误 2——这里统一 1，记录在案。
        errs.push('qzsh: ' + (e instanceof Error ? e.message : String(e)));
        result = { out: outs.join('\n'), err: errs.join('\n'), code: 1, cd, clear, exit };
      }
    } finally {
      ctx.heredocs = savedHeredocs; // M35：恢复父层 here-doc 表（哨兵索引局部有效）
    }
    // M43.3 INT trap：最外层 + 退出码 130 + 中断标志在置位（真 Ctrl+C，非脚本恰好 return 130）。
    // 放在 catch 之外判定：单语句 ./s.sh 场景内层 run 已把中断吞成 130 返回，外层没有更多
    // 语句检查点再抛 ShellInterrupt——但 flag 仍在置位，这里兜底触发一次。
    const intTrap = outermost && result.code === 130 && ctx.intr?.flag ? ctx.traps?.INT : undefined;
    if (intTrap) {
      // 暂清 flag 让 handler 完整跑完（残留 flag 会让 handler 首条语句即被 130 秒断）；
      // 跑完恢复置位——本次执行语义上确是被 Ctrl+C 终止的，Terminal 下次 submit 前自会复位。
      ctx.intr!.flag = false;
      try {
        const tr = await run(intTrap, ctx);
        const tOut = tr.out.replace(/\n+$/, '');
        if (tOut) result.out = result.out ? result.out + '\n' + tOut : tOut;
        if (tr.err) result.err = result.err ? result.err + '\n' + tr.err : tr.err;
      } finally {
        ctx.intr!.flag = true;
      }
    }
    return result;
  } finally {
    rd.n--;
  }
}

// M43.3：EXIT trap —— 最外层脚本边界（调用方判 sourceDepth===1）触发一次；exitFiring 防 handler 内脚本递归。
// 输出并入脚本结果（trap 输出排脚本输出之后）；脚本退出码不变（bash：EXIT trap 不改写 $?）。
// 暂清中断标志：脚本被 Ctrl+C 中止时 EXIT trap 仍应完整跑完（bash 语义）。
async function fireExitTrap(ctx: ShellCtx, res: CmdResult): Promise<CmdResult> {
  const cmd = ctx.traps?.EXIT;
  if (!cmd || ctx.exitFiring) return res;
  ctx.exitFiring = true;
  const savedFlag = ctx.intr?.flag;
  if (ctx.intr) ctx.intr.flag = false;
  try {
    const tr = await run(cmd, ctx);
    const tOut = tr.out.replace(/\n+$/, '');
    return {
      ...res,
      out: [res.out, tOut].filter(Boolean).join('\n'),
      err: [res.err, tr.err].filter(Boolean).join('\n') || undefined,
    };
  } finally {
    if (ctx.intr) ctx.intr.flag = savedFlag ?? false;
    ctx.exitFiring = false;
  }
}

// ── M35：续行判定（Terminal PS2 地基）─────────────────────────
// 判断一段输入是否「不完整、需要继续读下一行」（bash 的 PS2 `>` 提示场景）。纯函数。
// 覆盖：①行尾孤立反斜杠续行；②引号/命令替换未闭合；③引号外尾部 | && ||；
// ④here-doc 未闭合；⑤控制结构未闭合（if/for/while/case/函数缺 fi/done/esac/}）。
// 完整但有语法错误（如孤立 then）→ false：不该续行，直接执行报错（bash 同款手感）。
export function needsContinuation(text: string): boolean {
  if (!text.trim()) return false;
  // ① 行尾孤立反斜杠：奇数个连续 \ 结尾 → 续行（须最先判，否则 \<换行> 会干扰后续扫描）
  let bs = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) bs++;
  if (bs % 2 === 1) return true;
  // ②④ 引号/替换/heredoc 未闭合：先跑 scanHeredocs（未闭合 heredoc 抛「缺少闭合行」→ 续行；
  // 拿掉 body 后的文本再做引号扫描，body 里的引号字符不会误判）
  let stripped: string;
  try {
    stripped = scanHeredocs(text).text;
  } catch (e) {
    return e instanceof Error && e.message.includes('缺少');
  }
  let q: '"' | "'" | null = null;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (q === "'") {
      if (c === "'") q = null;
      continue;
    }
    if (q === '"') {
      if (c === '\\') i++; // \" 不闭合引号
      else if (c === '"') q = null;
      continue;
    }
    if (c === '\\') {
      i++; // 转义对跳过
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if ((c === '$' && stripped[i + 1] === '(') || c === '`') {
      const end = substSpanEnd(stripped, i);
      if (end === -1) return true; // 未闭合 $( … ) / ` … `
      i = end;
      continue;
    }
    // M43：未闭合 [[ … → 续行（闭合则整体跳过，内部 && || 不影响尾部算符判定）
    if (c === '[' && isCondStart(stripped, i)) {
      const end = condSpanEnd(stripped, i);
      if (end === -1) return true;
      i = end;
    }
  }
  if (q !== null) return true; // 引号未闭合
  // ③ 引号外尾部算符 | && ||（排除转义 \|：算符前奇数个 \ 才是字面）
  const t = stripped.trimEnd();
  if (t.endsWith('||') || t.endsWith('&&')) return true;
  if (t.endsWith('|')) {
    let b = 0;
    for (let i = t.length - 2; i >= 0 && t[i] === '\\'; i--) b++;
    if (b % 2 === 0) return true;
  }
  // ⑤ 控制结构未闭合：试解析，错误消息含「缺少」（缺 fi/done/esac/}、case/heredoc 未闭合）→ 续行；
  // 「意外的 xxx」等完整语法错 → false（让执行层直接报错）
  try {
    parseStatements(splitStatements(text).stmts);
    return false;
  } catch (e) {
    return e instanceof Error && e.message.includes('缺少');
  }
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
  let exit = false; // M52.1：exit 命令跨管道段传播

  for (const seg of segments) {
    // M43：[[ … ]] 条件命令——独立通道：内部不做 glob/分词/重定向解析（< > && || 是条件算符）。
    // ]] 之后的剩余文本只允许重定向（[[ x ]] > f），走普通重定向通道。
    const condSeg = seg.trimStart();
    if (isCondStart(condSeg, 0)) {
      const end = condSpanEnd(condSeg, 0);
      if (end === -1) {
        errAccum.push('qzsh: 语法错误：缺少 ]]');
        code = 2;
        pipedOut = '';
        lastRedirectedOut = false;
        break;
      }
      const body = condSeg.slice(2, end - 1);
      const after = condSeg.slice(end + 1);
      const cRedir = extractRedirs(await expandToks(splitRedirToks(tokenize(after)), ctx));
      if (cRedir.error) return { out: '', err: cRedir.error, code: 2 };
      const cRest = cRedir.rest.map(stripEsc);
      if (cRedir.redir.in) cRedir.redir.in = stripEsc(cRedir.redir.in);
      if (cRedir.redir.out) cRedir.redir.out = stripEsc(cRedir.redir.out);
      if (cRedir.redir.err) cRedir.redir.err = stripEsc(cRedir.redir.err);
      if (cRest.length) {
        errAccum.push(`qzsh: 语法错误：]] 之后意外的参数 ${cRest[0]}`);
        code = 2;
        pipedOut = '';
        lastRedirectedOut = false;
        break;
      }
      const r = await evalCond(body, ctx);
      let res: CmdResult;
      if ('err' in r) res = { out: '', err: `qzsh: [[ … ]]: ${r.err}`, code: 2 };
      else res = { out: '', code: r.ok ? 0 : 1 };
      code = res.code;
      if (res.err) {
        if (cRedir.redir.err != null) {
          const e = writeToPath(ctx, cRedir.redir.err, res.err, false);
          if (e) errAccum.push(e);
        } else errAccum.push(res.err);
      }
      if (cRedir.redir.out != null) {
        if (res.code === 0) {
          const e = writeToPath(ctx, cRedir.redir.out, res.out, cRedir.redir.append);
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
      continue;
    }
    // M47.1：((expr)) 算术命令——独立形态（无 $），求值 expr，退出码 = expr≠0 ? 0 : 1，无 stdout。
    // 与 $((expr)) 展开不同：((expr)) 是命令（退出码回流，无输出），类似 [[ ]] 条件命令通道。
    // 复用 arith.ts（含 M46.3 赋值/自增副作用，副作用写当前 ctx.env）。常作 if/while 条件或 && || 串联。
    // for ((init; cond; step)) 不会走到这里——parseFor 在 parseStatements 层已拦截。
    const arithCmd = /^\(\(([\s\S]*)\)\)\s*$/.exec(condSeg);
    if (arithCmd) {
      let res: CmdResult;
      try {
        const v = evalArith(arithCmd[1].trim(), ctx.env, ctx.positional ?? []);
        res = { out: '', code: v !== 0 ? 0 : 1 };
      } catch (e) {
        res = { out: '', err: String((e as Error).message ?? e), code: 1 };
      }
      code = res.code;
      if (res.err) errAccum.push(res.err);
      // 算术命令无 stdout：管道下游收空输入（((5)) | cat → 空）
      stdin = '';
      pipedOut = '';
      lastRedirectedOut = false;
      continue;
    }
    const toks = await expandToks(splitRedirToks(tokenize(seg)), ctx);
    const { rest, redir, error } = extractRedirs(toks);
    if (error) return { out: '', err: error, code: 2 };
    // M31：抽完重定向后统一剥 ESC——此前必须保留哨兵，否则 \> 会被 extractRedirs 当算符吃掉
    const stripped = rest.map(stripEsc);
    if (redir.in) redir.in = stripEsc(redir.in);
    if (redir.out) redir.out = stripEsc(redir.out);
    if (redir.err) redir.err = stripEsc(redir.err);
    if (redir.herestr) redir.herestr = stripEsc(redir.herestr); // M35：here-string 词同样剥转义哨兵
    // bash 语义：变量展开后整段为空（如未定义变量单独成行）→ 无操作跳过，不是语法错误。
    // （`> file` 式空命令+重定向仍走下方报错——不创建文件，与 bash 有别，记录在案。）
    if (!stripped.length && !redir.in && !redir.out && !redir.err && redir.heredoc == null && redir.herestr == null)
      continue;

    let [cmd, ...args] = stripped;
    if (!cmd) return { out: '', err: 'qzsh: 语法错误：空命令', code: 2 };
    // 别名展开（单次、非递归）：首词是别名 → 替换成别名内容 + 原参数
    const aliasVal = aliases.map[cmd];
    if (aliasVal) {
      const exp = (await expandToks(tokenize(aliasVal), ctx)).map(stripEsc);
      if (exp.length) {
        args = [...exp.slice(1), ...args];
        cmd = exp[0];
      }
    }
    // M32 函数调用：bash 优先级——别名展开后、内建命令前（函数可覆盖内建，ls() { … } 能劫持 ls）。
    // 共享 ctx（函数内赋值/cd 影响调用者，bash 语义）；位置参数保存/恢复；return 信号在此清除。
    const funcBody = ctx.funcs?.[cmd];
    const fn = funcBody === undefined ? COMMANDS[cmd] : undefined;
    // bash 纯赋值语句：整行全是 VAR=value（无命令名）→ 设置 shell 变量（X=5 无需 export）。
    // 函数体内共享 ctx → 函数内赋值影响调用者（无 typeset/local 语义，记录在案）。
    const assigns = [cmd, ...args].map((w) => /^([A-Za-z_]\w*)=(.*)$/s.exec(w));
    const isAssign = assigns.every((m) => m !== null);
    // 不是函数也不是内置命令、但形如路径（./x、a/b）且指向文本文件 → 当脚本执行（sh/./file）
    // M43.2：./script.sh 消费 x 位——无执行权限 → 126 权限不够；指向目录 → 126 是个目录（bash 同款）
    let scriptNode: VNode | undefined;
    let execErr: { err: string; code: number } | undefined;
    if (funcBody === undefined && !fn && cmd.includes('/')) {
      const sid = resolvePath(ctx.cwd, cmd);
      const sn = sid ? getNode(sid) : undefined;
      if (sn?.type === 'dir') execErr = { err: `qzsh: ${cmd}: 是个目录`, code: 126 };
      else if (sn?.type === 'file' && sn.kind !== 'binary') {
        if (permits(sn, ctx.env.USER, 1)) scriptNode = sn;
        else execErr = { err: `qzsh: ${cmd}: 权限不够`, code: 126 };
      }
    }
    if (funcBody === undefined && !fn && !scriptNode && !isAssign) {
      errAccum.push(execErr?.err ?? `qzsh: ${cmd}: 未找到命令`);
      code = execErr?.code ?? 127;
      pipedOut = '';
      lastRedirectedOut = false;
      break;
    }

    // 输入重定向：M35 heredoc > here-string > < 文件 > 管道 stdin。
    // （bash 真语义是「同行后出现覆盖先出现」；我们按算符类型定固定优先级，记录在案。）
    let stageStdin = stdin;
    if (redir.heredoc != null) {
      const hd = ctx.heredocs?.[redir.heredoc];
      // 未引号分隔符 → body 做参数/命令/算术展开（\$ \` \\ 先转哨兵再过 subst，出口剥哨兵）；引号分隔符 → 字面
      stageStdin = hd ? (hd.expand ? stripEsc(await subst(hd.body.replace(/\\([$`\\])/g, ESC + '$1'), ctx)) : hd.body) : '';
    } else if (redir.herestr != null) {
      stageStdin = redir.herestr + '\n'; // bash：here-string 自动补尾随换行
    } else if (redir.in != null) {
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
    if (isAssign) {
      for (const m of assigns) ctx.env[m![1]] = m![2];
      res = { out: '', code: 0 };
    } else if (funcBody !== undefined) {
      // M32 函数调用：保存/替换位置参数，funcDepth+1（return 合法化），body 走完共享 ctx。
      // return 信号在此边界清除：retFlag.code 作为函数退出码（bash return 语义）。
      // M44.1：每次调用压一帧 local 表，返回时按记录恢复/删除帧内声明的变量（遮蔽复原）。
      const savedPos = ctx.positional;
      ctx.positional = args;
      ctx.funcDepth = (ctx.funcDepth ?? 0) + 1;
      (ctx.locals ??= []).push(new Map());
      try {
        res = await run(funcBody, ctx);
        if (ctx.retFlag) {
          res = { ...res, code: ctx.retFlag.code };
          ctx.retFlag = null;
        }
      } finally {
        ctx.funcDepth!--;
        ctx.positional = savedPos;
        const frame = ctx.locals!.pop()!;
        for (const [name, orig] of frame) {
          if (orig.existed) ctx.env[name] = orig.value!;
          else delete ctx.env[name];
        }
      }
    } else if (fn) {
      res = await fn(args, ctx, stageStdin);
    } else if (sourceDepth >= 25) {
      res = { out: '', err: 'qzsh: 脚本嵌套过深', code: 1 };
    } else {
      sourceDepth++; // 脚本文件：解释执行其内容（含多行控制流），共享 ctx
      // M32：脚本位置参数 = 脚本名后的实参；脚本内 return 提前结束（信号在此清除）
      const savedPos = ctx.positional;
      // M44.2：脚本内 set -e 止于脚本边界（./s.sh 不泄漏回父 shell；source 走 fn 分支天然泄漏，bash 语义）
      const savedErrexit = ctx.errexit;
      ctx.positional = args;
      try {
        res = await run(scriptNode!.content, ctx);
        if (ctx.retFlag) {
          res = { ...res, code: ctx.retFlag.code };
          ctx.retFlag = null;
        }
        // M43.3：EXIT trap 只在最外层脚本边界触发（source 走 fn 分支不进这里，天然不触发）。
        // 中断场景 run 已吞成 130 返回，这里照常触发（bash：被信号杀死也跑 EXIT trap）。
        if (sourceDepth === 1) res = await fireExitTrap(ctx, res);
      } finally {
        sourceDepth--;
        ctx.positional = savedPos;
        ctx.errexit = savedErrexit;
      }
    }
    code = res.code;
    if (res.cd) cd = res.cd;
    if (res.clear) clear = true;
    if (res.exit) exit = true; // M52.1：exit 跨管道段传播

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
    exit,
  };
}
