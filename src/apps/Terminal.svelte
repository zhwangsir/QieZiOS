<script lang="ts">
  // 终端 App —— 把 lib/shell 接到一个可交互的命令行界面。
  // 滚动输出区 + 输入行 + 命令历史(↑/↓ 翻 + Ctrl+R 搜) + Tab 补全(lib/completion 引擎：命令/路径/命令感知)
  // + readline 键族（lib/lineedit：Ctrl+A/E/U/K/W、Ctrl+←/→、Alt+B/F、Ctrl+Y/Alt+Y kill ring）
  // + Ctrl+C 中断 + Ctrl+D 空行退出 + 历史展开（lib/histexpand：!!/!n/!-n/!str/!?str?）。
  // + 选中即复制 + 右键菜单（粘贴/复制/清空/新建窗口）+ PS2 多行续行（lib/ps2：不完整输入 > 提示续读）。
  import { run, newCtx, COMMAND_NAMES, ensureEtcProfile, ensureEtcPasswd } from '../lib/shell';
  import { getNode, pathOf } from '../kernel/vfs.svelte';
  import { completeLine } from '../lib/completion';
  import { killToStart, killToEnd, killWordBack, killWordForward, wordBack, wordForward, transposeChars, deleteCharForward, yank, yankPop, type EditState } from '../lib/lineedit';
  import { histExpand } from '../lib/histexpand';
  import { rsUpdate, rsOlder, rsMatch, type RSearchState } from '../lib/histsearch';
  import { ps2New, ps2Push, ps2Cancel, ps2Active } from '../lib/ps2';
  import { appList } from './appList';
  import { users } from '../system/users.svelte';
  import { listServices } from '../kernel/services.svelte';
  import { processes, close } from '../kernel/processes.svelte';
  import { jobs } from '../system/jobs.svelte';
  import { cmdHistory, addHistory, termPrefs, termScheme, TERM_SCHEMES } from '../system/shellPrefs.svelte';
  import { sys } from '../system/sys';
  import { openMenu } from '../shell/menu.svelte';
  import { onMount, tick } from 'svelte';
  import Icon from '../lib/Icon.svelte';

  // 终端外观（配色 + 字号，持久化、跨终端共享）
  const sc = $derived(termScheme());
  let showCfg = $state(false);
  const lineColor = (kind: 'in' | 'out' | 'err') => (kind === 'in' ? sc.in : kind === 'err' ? sc.err : '');

  type Line = { kind: 'in' | 'out' | 'err'; text: string };

  // pid：本终端窗口的进程 pid（Desktop 透传）→ 让 open 启动的子进程挂在本终端名下
  // data：启动参数（Desktop 透传 Process.data）——Files「在终端打开」经此传入 { cwd }
  let { pid, data }: { pid?: number; data?: unknown } = $props();

  let ctx = $state(newCtx());
  let lines = $state<Line[]>([
    { kind: 'out', text: 'QieZiOS qzsh —— 输入 help 看命令。Tab 补全，↑/↓ 翻历史，Ctrl+R 搜历史，Ctrl+C 中断，Ctrl+D 退出。' },
  ]);
  // 回卷上限：长会话/循环命令输出无限累积会撑大 DOM/内存 → 只保留最近 N 行。
  // 配合每行 content-visibility（离屏行不渲染），终端在海量输出下仍流畅。
  const MAX_LINES = 5000;
  function trimScrollback() {
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
  }
  let input = $state('');
  // 命令历史改用持久化共享存储（cmdHistory）→ 跨终端/刷新保留
  let histIdx = $state(-1); // -1 = 不在翻历史
  let scroller: HTMLElement;
  let inputEl: HTMLInputElement;

  const prompt = $derived(
    `${ctx.env.USER}@${ctx.env.HOSTNAME}:${pathOf(ctx.cwd)}${ctx.env.USER === 'root' ? '#' : '$'}`,
  );

  // 启动时执行 /etc/profile（出厂自带；用户改它即可持久化 export/启动命令）。
  // 防御式：rc 出错绝不影响终端可用。
  onMount(() => {
    // Files「在终端打开」入口：启动参数带合法 cwd（存在且为目录）→ 静默设为初始工作目录。
    // 非法 data 一律忽略；注意 /etc/profile 里的 cd 仍可覆盖它（与真实 shell rc 优先级一致）。
    if (data && typeof data === 'object' && 'cwd' in data) {
      const cwd = (data as { cwd?: unknown }).cwd;
      if (typeof cwd === 'string' && getNode(cwd)?.type === 'dir') ctx.cwd = cwd;
    }
    ctx.pid = pid ?? 0; // 记下本终端 pid，供 open 设子进程 ppid
    void (async () => {
      try {
        ensureEtcPasswd(); // 生成/同步 /etc/passwd
        if (ensureEtcProfile()) {
          const res = await run('source /etc/profile', ctx); // run 现为异步
          if (res.out) lines.push({ kind: 'out', text: res.out });
          if (res.err) lines.push({ kind: 'err', text: res.err });
          if (res.cd) ctx.cwd = res.cd;
        }
      } catch {
        /* rc 失败：忽略，终端照常可用 */
      }
    })();
  });

  async function scrollToEnd() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  let busy = $state(false); // 异步命令（curl 等）执行中 → 暂时锁输入

  // M36：PS2 续行累积器。输入不完整（缺 fi/done/esac、引号或 $( 未闭合、heredoc 缺分隔行、
  // 行尾 \、尾部 | && ||）→ 回车不执行，提示符变 > 继续读；完整即拼接执行（bash 手感）。
  let ps2 = $state(ps2New());

  async function submit() {
    if (busy) return;
    const line = input;
    lines.push({ kind: 'in', text: `${ps2Active(ps2) ? '>' : prompt} ${line}` });
    input = '';
    histIdx = -1;
    // 不完整 → 累积续行，本轮不执行；完整 → 拼接文本进入正常执行流
    const acc = ps2Push(ps2, line);
    if (!acc.done) {
      scrollToEnd();
      return;
    }
    const cmd = acc.text.trim();
    if (cmd) {
      // M25 历史展开（bash 语义）：!!/!n/!-n/!str/!?str? 在执行前对整行展开。
      // 展开改了命令 → 先原样回显展开结果再执行（bash 同款）；失败（事件未找到）→ 报错且不执行。
      // 必须用「加入当前行之前」的历史展开，!! 才是上一条；历史里记原始行（含展开失败的行，bash 同款）。
      const ex = histExpand(cmd, cmdHistory.list);
      addHistory(cmd);
      if (!ex.ok) {
        lines.push({ kind: 'err', text: `qzsh: ${ex.error}` });
        trimScrollback();
        scrollToEnd();
        return;
      }
      let runLine = cmd;
      if (ex.changed) {
        runLine = ex.line;
        lines.push({ kind: 'out', text: ex.line }); // bash：回显展开后的完整命令
      }
      // M28：:p 打印修饰符 —— 展开行已回显、原始行已入历史，只打印不执行（bash 同款）
      if (ex.printOnly) {
        trimScrollback();
        scrollToEnd();
        return;
      }
      if (ctx.intr) ctx.intr.flag = false; // 执行前复位中断标志：上次 Ctrl+C 的残留不能影响新命令
      busy = true;
      scrollToEnd();
      try {
        const res = await run(runLine, ctx); // 命令可能是异步的（curl）
        if (res.exit) {
          // M52.1 exit：关闭终端窗口。先把 exit 退出码写入 ctx，再调 sys.proc.close 关窗。
          ctx.code = res.code;
          sys.proc.close(ctx.pid);
          return;
        }
        if (res.clear) lines = [];
        if (res.out) lines.push({ kind: 'out', text: res.out });
        if (res.err) lines.push({ kind: 'err', text: res.err });
        if (res.cd) ctx.cwd = res.cd;
        ctx.code = res.code;
      } catch (e) {
        // run 理论上自己兜底，但万一 reject 也要解锁 + 报错，绝不让终端卡死
        lines.push({ kind: 'err', text: 'qzsh: ' + (e instanceof Error ? e.message : String(e)) });
        ctx.code = 1;
      } finally {
        busy = false;
      }
    }
    trimScrollback();
    scrollToEnd();
  }

  function recallHistory(dir: -1 | 1) {
    const hist = cmdHistory.list;
    if (!hist.length) return;
    if (histIdx === -1) histIdx = hist.length;
    histIdx = Math.min(hist.length, Math.max(0, histIdx + dir));
    // 防御：cmdHistory 多终端共享，理论上每次调用已按当前长度重夹 histIdx，但用 >= + ?? '' 兜底，
    // 万一未来出现「列表中途缩短」的路径也不会把字面 undefined 灌进输入框。
    input = histIdx >= hist.length ? '' : (hist[histIdx] ?? '');
  }

  // Tab 补全：lib/completion 引擎——首词命令名；参数位命令感知（cd 只目录、kill 补 pid、
  // man 补命令、systemctl 补服务、open 补 App+路径…）；多候选先补公共前缀，无进展才列候选。
  // M23：$ 前缀补环境变量（$HO<Tab> → $HOME）。
  function complete() {
    const r = completeLine(input, ctx.cwd, {
      commands: COMMAND_NAMES,
      apps: appList.map((a) => a.id),
      users: users.list.map((u) => u.name),
      services: listServices().map((s) => s.id),
      pids: processes.map((p) => p.pid),
      jobNums: jobs.list.filter((j) => j.status === 'running').map((j) => j.n),
      env: Object.keys(ctx.env),
    });
    if (r.input !== undefined) input = r.input;
    else if (r.candidates?.length) {
      lines.push({ kind: 'out', text: r.candidates.join('  ') });
      scrollToEnd();
    }
  }

  // ── readline 键族（贴近真实 shell 的行编辑）──────────────────────────────
  // 光标位置兜底：input 失焦时 selectionStart 可能为 null → 按行尾处理（与 bash 默认行尾编辑一致）。
  const cursorPos = () => inputEl?.selectionStart ?? input.length;

  // 应用一次行编辑：纯函数算新文本+新光标，写回 input 后等 DOM 更新再落光标。
  // kill 类（Ctrl+U/K/W）删下的文本顺手进 kill ring 顶部，供 Ctrl+Y 粘贴。
  async function applyEdit(fn: (s: EditState) => EditState) {
    const next = fn({ text: input, pos: cursorPos() });
    input = next.text;
    if (next.killed) ringPush(next.killed);
    await tick();
    inputEl?.setSelectionRange(next.pos, next.pos);
  }
  function moveCursor(pos: number) {
    inputEl?.setSelectionRange(pos, pos);
  }

  // ── kill ring（Ctrl+Y yank / Alt+Y yank-pop，bash 语义）───────────────────
  // ring[0] = 最近一次 kill 删下的文本。取舍：bash 会把「连续 kill」合并成一项，这里每次 kill
  // 独立入环（实现简单、行为可预期，Alt+Y 逐段回溯反而更细粒度）。环设上限防无限增长。
  let killRing: string[] = [];
  const RING_CAP = 32;
  let ringIdx = 0; // Alt+Y 当前循环到的环位（Ctrl+Y 永远取环顶并复位 0）
  // 上次粘贴段在输入行中的区间 + 标志。Alt+Y 只能「紧跟」yank/上一次 Alt+Y（bash 语义），
  // 任何其他按键（打字/移动/回车…）都会在 onKey 入口把它清掉，链即断。
  let lastYank: { start: number; end: number } | null = null;

  function ringPush(text: string) {
    killRing.unshift(text);
    if (killRing.length > RING_CAP) killRing.length = RING_CAP;
  }
  function setCursorSoon(pos: number) {
    void tick().then(() => inputEl?.setSelectionRange(pos, pos));
  }
  // Ctrl+Y：把环顶文本粘到光标处，记下粘贴段区间（给 Alt+Y 用）。
  function doYank() {
    const top = killRing[0];
    if (top === undefined) return; // 空环：bash 会响铃，这里静默无操作
    const next = yank({ text: input, pos: cursorPos() }, top);
    input = next.text;
    ringIdx = 0;
    lastYank = { start: next.pos - top.length, end: next.pos };
    setCursorSoon(next.pos);
  }
  // Alt+Y：用环里下一项「替换」上次粘贴段；环内循环取模。无前置 yank 或环只有一项 → 无操作。
  function doYankPop() {
    if (!lastYank || killRing.length < 2) return;
    ringIdx = (ringIdx + 1) % killRing.length;
    const t = killRing[ringIdx];
    const next = yankPop({ text: input, pos: cursorPos() }, t, lastYank);
    input = next.text;
    lastYank = { start: next.pos - t.length, end: next.pos };
    setCursorSoon(next.pos);
  }

  // Ctrl+C（空闲时）：取消当前输入行 —— bash 手感是 echo 出 ^C 然后给新提示符。
  // M36：续行中也一并丢弃已累积的 PS2 缓冲（bash：Ctrl+C 放弃整条复合命令回 PS1）。
  function cancelLine() {
    lines.push({ kind: 'in', text: `${ps2Active(ps2) ? '>' : prompt} ${input}^C` });
    ps2Cancel(ps2);
    input = '';
    histIdx = -1;
    scrollToEnd();
  }
  // Ctrl+C（busy 时）：置协作式中断标志，shell 在下一语句/迭代边界中止（退出码 130）。
  function interrupt() {
    if (ctx.intr) ctx.intr.flag = true;
  }
  // Ctrl+D：空行 = EOF → 退出 shell（关掉本终端窗口），与真实终端一致。非空行不响（从简）。
  // M36：PS2 续行中 Ctrl+D = 意外 EOF（bash 报 syntax error 并放弃续行）→ 取消缓冲 + 报错，不关窗。
  function eofExit() {
    if (input !== '' || pid == null) return;
    if (ps2Active(ps2)) {
      ps2Cancel(ps2);
      lines.push({ kind: 'err', text: 'qzsh: 语法错误：意外结束（EOF）' });
      scrollToEnd();
      return;
    }
    const self = processes.find((p) => p.pid === pid); // close 吃进程 id（字符串），手里是 pid → 先换算
    if (self) close(self.id);
  }

  // ── Ctrl+R 历史搜索（reverse-i-search，贴近 bash）────────────────────────
  // null = 不在搜索模式。搜索中输入行实时显示命中命令（未命中则回退显示进入前的输入）。
  let rsearch = $state<RSearchState | null>(null);
  let rsSaved = ''; // 进入搜索前的输入行（取消时还原）

  function rsApply(s: RSearchState) {
    rsearch = s;
    input = rsMatch(cmdHistory.list, s) ?? rsSaved;
  }
  function rsStart() {
    rsSaved = input;
    rsApply(rsUpdate(cmdHistory.list, ''));
  }
  // Enter = 直接执行命中命令（bash 手感）；→ / Ctrl+E = 只取到输入行，留待编辑后再回车
  function rsAccept(execute: boolean) {
    if (!rsearch) return;
    const cmd = rsMatch(cmdHistory.list, rsearch) ?? rsSaved;
    rsearch = null;
    input = cmd;
    if (execute) void submit();
  }
  function rsCancel() {
    rsearch = null;
    input = rsSaved;
  }

  // Ctrl+字母 和弦：统一入口。macOS 上 Cmd 系留给浏览器，这里只吃纯 Ctrl。
  function ctrlChord(e: KeyboardEvent) {
    switch (e.key.toLowerCase()) {
      case 'c': e.preventDefault(); cancelLine(); break;
      case 'd': e.preventDefault(); eofExit(); if (input !== '') void applyEdit(deleteCharForward); break;
      case 'a': e.preventDefault(); moveCursor(0); break;
      case 'e': e.preventDefault(); moveCursor(input.length); break;
      case 'b': e.preventDefault(); moveCursor(Math.max(0, cursorPos() - 1)); break;
      case 'f': e.preventDefault(); moveCursor(Math.min(input.length, cursorPos() + 1)); break;
      case 't': e.preventDefault(); void applyEdit(transposeChars); break;
      case 'u': e.preventDefault(); void applyEdit(killToStart); break;
      case 'k': e.preventDefault(); void applyEdit(killToEnd); break;
      case 'w': e.preventDefault(); void applyEdit(killWordBack); break;
      case 'y': e.preventDefault(); doYank(); break;
      case 'l': e.preventDefault(); lines = []; break;
      case 'r': e.preventDefault(); rsStart(); break;
    }
  }

  // M22：选中即复制（macOS Terminal 经典交互：鼠标松开选中区域 → 自动复制）。
  // 选中区域可能跨多行（行内连续空白被折叠，与真实终端一致）。
  function onMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (text) sys.clipboard.copy(text);
  }

  // M22：右键菜单（粘贴/复制/清空/新建窗口）。
  // 粘贴优先从系统剪贴板读（navigator.clipboard），失败回退到内部剪贴板。
  async function onContextMenu(e: MouseEvent) {
    // 点在输入框上 → 不弹菜单（保留浏览器默认右键菜单，方便粘贴）
    if ((e.target as HTMLElement).closest('input')) return;
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed && sel.toString().trim();
    const pasteText = async () => {
      try {
        const text = await navigator.clipboard?.readText() ?? sys.clipboard.read();
        if (text) input += text;
      } catch {
        const text = sys.clipboard.read();
        if (text) input += text;
      }
    };
    openMenu(e, [
      { label: '粘贴', icon: '📋', onClick: pasteText },
      { label: '复制', icon: '📄', disabled: !hasSelection, onClick: () => sys.clipboard.copy(sel!.toString().trim()) },
      { label: '清空', icon: '🗑️', separator: true, onClick: () => { lines = []; } },
      { label: '新建窗口', icon: '➕', onClick: () => sys.openApp('terminal') },
    ]);
  }

  function onKey(e: KeyboardEvent) {
    // busy（命令执行中）：只拦截 Ctrl+C 中断；其余键放行默认行为 → 字符照常进输入框，
    // 白赚真实终端的 type-ahead（命令跑完，提前敲的内容已经在输入行里等着）。
    if (busy) {
      if (e.key === 'c' && e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        interrupt();
      }
      return;
    }
    // Ctrl+R 搜索模式：接管几乎全部按键（打字改查询词、Ctrl+R 找更老、Backspace 删词、
    // Enter 执行命中、→/Ctrl+E 取到输入行、Esc/Ctrl+C/Ctrl+G 取消）；其余键一律吃掉避免半态。
    if (rsearch) {
      e.preventDefault();
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
      if (e.key === 'Escape' || (ctrl && (e.key === 'c' || e.key === 'g'))) rsCancel();
      else if (e.key === 'Enter') rsAccept(true);
      else if (e.key === 'ArrowRight' || (ctrl && e.key === 'e')) rsAccept(false);
      else if (e.key === 'Backspace') {
        if (rsearch.query) rsApply(rsUpdate(cmdHistory.list, rsearch.query.slice(0, -1)));
      } else if (ctrl && e.key === 'r') rsApply(rsOlder(cmdHistory.list, rsearch));
      else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        rsApply(rsUpdate(cmdHistory.list, rsearch.query + e.key));
      }
      return;
    }
    // M25：除 Ctrl+Y/Alt+Y 外任何按键都断开「连续粘贴」链（bash 语义：Alt+Y 只能紧跟 yank/Alt+Y）。
    // 放在分派之前统一判定，打字/移动/翻历史/回车自然全部断链，无需逐处清理。
    const isYankKey =
      (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'y') ||
      (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyY');
    if (!isYankKey) lastYank = null;
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      recallHistory(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      recallHistory(1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'ArrowLeft' && e.ctrlKey) {
      e.preventDefault();
      moveCursor(wordBack(input, cursorPos()));
    } else if (e.key === 'ArrowRight' && e.ctrlKey) {
      e.preventDefault();
      moveCursor(wordForward(input, cursorPos()));
    } else if (e.altKey && e.code === 'KeyB') {
      // 用 e.code 不用 e.key：macOS Option+b 会产出 '∫'，物理键位才是稳定语义
      e.preventDefault();
      moveCursor(wordBack(input, cursorPos()));
    } else if (e.altKey && e.code === 'KeyF') {
      e.preventDefault();
      moveCursor(wordForward(input, cursorPos()));
    } else if (e.altKey && !e.ctrlKey && e.code === 'KeyD') {
      // Alt+D（kill-word）：删光标后一词，进 kill ring。用 e.code：macOS Option+d 产出 '∂'
      e.preventDefault();
      void applyEdit(killWordForward);
    } else if (e.altKey && !e.ctrlKey && e.code === 'KeyY') {
      // 同 Alt+B/F 用 e.code：macOS Option+y 产出 '¥'，物理键位才是稳定语义
      e.preventDefault();
      doYankPop();
    } else if (e.ctrlKey && !e.altKey && !e.metaKey) {
      ctrlChord(e);
    }
  }
</script>

<!-- 点窗口任意处聚焦到输入框，像真终端。配色/字号走持久化偏好（齿轮可调） -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex h-full flex-col font-mono leading-relaxed"
  style="background: {sc.bg}; color: {sc.fg}; font-size: {termPrefs.fontSize}px"
  onclick={() => inputEl?.focus()}
  onmouseup={onMouseUp}
  oncontextmenu={onContextMenu}
  role="presentation"
>
  <!-- 外观设置：齿轮 + 弹层（配色 / 字号） -->
  <button
    class="absolute right-2 top-1.5 z-10 rounded px-1.5 py-0.5 text-xs opacity-40 hover:opacity-100"
    style="background: rgb(0 0 0 / 0.3)"
    title="终端外观"
    onclick={(e) => { e.stopPropagation(); showCfg = !showCfg; }}><Icon name="⚙" size={12} /></button>
  {#if showCfg}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="absolute right-2 top-9 z-10 flex flex-col gap-2 rounded-lg border border-white/15 p-2.5 text-xs shadow-xl backdrop-blur"
      style="background: rgb(20 20 28 / 0.92); color: #e8e8f0"
      onclick={(e) => e.stopPropagation()}
    >
      <label class="flex items-center justify-between gap-3">配色
        <select class="rounded bg-black/40 px-1.5 py-0.5 outline-none" bind:value={termPrefs.scheme}>
          {#each TERM_SCHEMES as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>
      <label class="flex items-center justify-between gap-3">字号
        <span class="flex items-center gap-1">
          <button class="grid h-5 w-5 place-items-center rounded bg-black/40 hover:bg-black/60" onclick={() => (termPrefs.fontSize = Math.max(10, termPrefs.fontSize - 1))}><Icon name="Minus" size={11} /></button>
          <span class="w-6 text-center tabular-nums">{termPrefs.fontSize}</span>
          <button class="grid h-5 w-5 place-items-center rounded bg-black/40 hover:bg-black/60" onclick={() => (termPrefs.fontSize = Math.min(20, termPrefs.fontSize + 1))}><Icon name="Plus" size={11} /></button>
        </span>
      </label>
    </div>
  {/if}
  <div bind:this={scroller} class="flex-1 overflow-auto px-3 py-2">
    {#each lines as l, i (i)}
      <div class="qz-cv-row whitespace-pre-wrap break-words" style={lineColor(l.kind) ? `color: ${lineColor(l.kind)}` : ''}>{l.text}</div>
    {/each}
    <!-- 输入行（Ctrl+R 搜索中提示符换成 reverse-i-search 行，与 bash 一致） -->
    <div class="flex items-baseline gap-2">
      <span class="shrink-0 whitespace-pre" style="color: {sc.in}"
        >{#if rsearch}{rsearch.query !== '' && rsearch.idx === -1 ? '(failed reverse-i-search)' : '(reverse-i-search)'}`{rsearch.query}':{:else}{ps2Active(ps2) ? '>' : prompt}{/if}</span
      >
      <input
        bind:this={inputEl}
        bind:value={input}
        onkeydown={onKey}
        class="min-w-0 flex-1 border-0 bg-transparent p-0 outline-none"
        style="color: {sc.fg}; caret-color: {sc.caret}"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      {#if busy}<span class="flex shrink-0 items-center" style="color: {sc.fg}; opacity: 0.5"><Icon name="⏳" size={13} /></span>{/if}
    </div>
  </div>
</div>
