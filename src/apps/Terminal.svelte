<script lang="ts">
  // 终端 App —— 把 lib/shell 接到一个可交互的命令行界面。
  // 滚动输出区 + 输入行 + 命令历史(↑/↓) + Tab 补全(命令/路径)。
  import { run, newCtx, COMMAND_NAMES, ensureEtcProfile, ensureEtcPasswd } from '../lib/shell';
  import { pathOf, resolvePath, children } from '../kernel/vfs.svelte';
  import { cmdHistory, addHistory, termPrefs, termScheme, TERM_SCHEMES } from '../system/shellPrefs.svelte';
  import { onMount, tick } from 'svelte';

  // 终端外观（配色 + 字号，持久化、跨终端共享）
  const sc = $derived(termScheme());
  let showCfg = $state(false);
  const lineColor = (kind: 'in' | 'out' | 'err') => (kind === 'in' ? sc.in : kind === 'err' ? sc.err : '');

  type Line = { kind: 'in' | 'out' | 'err'; text: string };

  // pid：本终端窗口的进程 pid（Desktop 透传）→ 让 open 启动的子进程挂在本终端名下
  let { pid }: { pid?: number } = $props();

  let ctx = $state(newCtx());
  let lines = $state<Line[]>([
    { kind: 'out', text: 'QieZiOS qzsh —— 输入 help 看命令。Tab 补全，↑/↓ 翻历史。' },
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

  async function submit() {
    if (busy) return;
    const line = input;
    lines.push({ kind: 'in', text: `${prompt} ${line}` });
    input = '';
    histIdx = -1;
    const cmd = line.trim();
    if (cmd) {
      addHistory(cmd);
      busy = true;
      scrollToEnd();
      try {
        const res = await run(cmd, ctx); // 命令可能是异步的（curl）
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

  // Tab 补全：首词补命令名，否则补当前目录下的路径
  function complete() {
    const parts = input.split(/\s+/);
    const last = parts[parts.length - 1] ?? '';
    if (parts.length <= 1) {
      const m = COMMAND_NAMES.filter((c) => c.startsWith(last));
      if (m.length === 1) input = m[0] + ' ';
      else if (m.length > 1) {
        lines.push({ kind: 'out', text: m.join('  ') });
        scrollToEnd();
      }
      return;
    }
    const slash = last.lastIndexOf('/');
    const dirStr = slash >= 0 ? last.slice(0, slash) || '/' : '.';
    const frag = slash >= 0 ? last.slice(slash + 1) : last;
    const dirId = resolvePath(ctx.cwd, dirStr);
    if (!dirId) return;
    const m = children(dirId).filter((n) => n.name.startsWith(frag));
    if (m.length === 1) {
      const pre = slash >= 0 ? last.slice(0, slash + 1) : '';
      parts[parts.length - 1] = pre + m[0].name + (m[0].type === 'dir' ? '/' : ' ');
      input = parts.join(' ');
    } else if (m.length > 1) {
      lines.push({ kind: 'out', text: m.map((n) => n.name + (n.type === 'dir' ? '/' : '')).join('  ') });
      scrollToEnd();
    }
  }

  function onKey(e: KeyboardEvent) {
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
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      lines = [];
    }
  }
</script>

<!-- 点窗口任意处聚焦到输入框，像真终端。配色/字号走持久化偏好（齿轮可调） -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex h-full flex-col font-mono leading-relaxed"
  style="background: {sc.bg}; color: {sc.fg}; font-size: {termPrefs.fontSize}px"
  onclick={() => inputEl?.focus()}
  role="presentation"
>
  <!-- 外观设置：齿轮 + 弹层（配色 / 字号） -->
  <button
    class="absolute right-2 top-1.5 z-10 rounded px-1.5 py-0.5 text-xs opacity-40 hover:opacity-100"
    style="background: rgb(0 0 0 / 0.3)"
    title="终端外观"
    onclick={(e) => { e.stopPropagation(); showCfg = !showCfg; }}>⚙</button>
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
          <button class="grid h-5 w-5 place-items-center rounded bg-black/40 hover:bg-black/60" onclick={() => (termPrefs.fontSize = Math.max(10, termPrefs.fontSize - 1))}>−</button>
          <span class="w-6 text-center tabular-nums">{termPrefs.fontSize}</span>
          <button class="grid h-5 w-5 place-items-center rounded bg-black/40 hover:bg-black/60" onclick={() => (termPrefs.fontSize = Math.min(20, termPrefs.fontSize + 1))}>＋</button>
        </span>
      </label>
    </div>
  {/if}
  <div bind:this={scroller} class="flex-1 overflow-auto px-3 py-2">
    {#each lines as l, i (i)}
      <div class="qz-cv-row whitespace-pre-wrap break-words" style={lineColor(l.kind) ? `color: ${lineColor(l.kind)}` : ''}>{l.text}</div>
    {/each}
    <!-- 输入行 -->
    <div class="flex items-baseline gap-2">
      <span class="shrink-0 whitespace-pre" style="color: {sc.in}">{prompt}</span>
      <input
        bind:this={inputEl}
        bind:value={input}
        onkeydown={onKey}
        disabled={busy}
        class="min-w-0 flex-1 border-0 bg-transparent p-0 outline-none disabled:opacity-50"
        style="color: {sc.fg}; caret-color: {sc.caret}"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
      {#if busy}<span class="shrink-0" style="color: {sc.fg}; opacity: 0.5">⏳</span>{/if}
    </div>
  </div>
</div>
