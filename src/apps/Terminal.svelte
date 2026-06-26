<script lang="ts">
  // 终端 App —— 把 lib/shell 接到一个可交互的命令行界面。
  // 滚动输出区 + 输入行 + 命令历史(↑/↓) + Tab 补全(命令/路径)。
  import { run, newCtx, COMMAND_NAMES, ensureEtcProfile } from '../lib/shell';
  import { pathOf, resolvePath, children } from '../kernel/vfs.svelte';
  import { onMount, tick } from 'svelte';

  type Line = { kind: 'in' | 'out' | 'err'; text: string };

  let ctx = $state(newCtx());
  let lines = $state<Line[]>([
    { kind: 'out', text: 'QieZiOS qzsh —— 输入 help 看命令。Tab 补全，↑/↓ 翻历史。' },
  ]);
  let input = $state('');
  let history = $state<string[]>([]);
  let histIdx = $state(-1); // -1 = 不在翻历史
  let scroller: HTMLElement;
  let inputEl: HTMLInputElement;

  const prompt = $derived(`${ctx.env.USER}@${ctx.env.HOSTNAME}:${pathOf(ctx.cwd)}$`);

  // 启动时执行 /etc/profile（出厂自带；用户改它即可持久化 export/启动命令）。
  // 防御式：rc 出错绝不影响终端可用。
  onMount(() => {
    try {
      if (ensureEtcProfile()) {
        const res = run('source /etc/profile', ctx);
        if (res.out) lines.push({ kind: 'out', text: res.out });
        if (res.err) lines.push({ kind: 'err', text: res.err });
        if (res.cd) ctx.cwd = res.cd;
      }
    } catch {
      /* rc 失败：忽略，终端照常可用 */
    }
  });

  async function scrollToEnd() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function submit() {
    const line = input;
    lines.push({ kind: 'in', text: `${prompt} ${line}` });
    input = '';
    histIdx = -1;
    const cmd = line.trim();
    if (cmd) {
      history.push(cmd);
      const res = run(cmd, ctx);
      if (res.clear) lines = [];
      if (res.out) lines.push({ kind: 'out', text: res.out });
      if (res.err) lines.push({ kind: 'err', text: res.err });
      if (res.cd) ctx.cwd = res.cd;
      ctx.code = res.code;
    }
    scrollToEnd();
  }

  function recallHistory(dir: -1 | 1) {
    if (!history.length) return;
    if (histIdx === -1) histIdx = history.length;
    histIdx = Math.min(history.length, Math.max(0, histIdx + dir));
    input = histIdx === history.length ? '' : history[histIdx];
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

<!-- 点窗口任意处聚焦到输入框，像真终端 -->
<div
  class="flex h-full flex-col bg-[#0c0d12] font-mono text-[13px] leading-relaxed text-[#d6deeb]"
  onclick={() => inputEl?.focus()}
  role="presentation"
>
  <div bind:this={scroller} class="flex-1 overflow-auto px-3 py-2">
    {#each lines as l, i (i)}
      <div
        class="whitespace-pre-wrap break-words"
        class:text-[#7ee787]={l.kind === 'in'}
        class:text-[#ff7b72]={l.kind === 'err'}
      >{l.text}</div>
    {/each}
    <!-- 输入行 -->
    <div class="flex items-baseline gap-2">
      <span class="shrink-0 whitespace-pre text-[#7ee787]">{prompt}</span>
      <input
        bind:this={inputEl}
        bind:value={input}
        onkeydown={onKey}
        class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[#d6deeb] caret-[#7ee787] outline-none"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      />
    </div>
  </div>
</div>
