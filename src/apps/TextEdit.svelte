<script lang="ts">
  import { getNode, writeFile } from '../kernel/vfs.svelte';
  import { permits } from '../system/permissions';
  import { currentUser } from '../system/account.svelte';
  import { complete } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';
  import { renderMarkdown } from '../lib/markdown';

  // data = 要打开的文件 id（由文件管理器在 launch 时通过启动参数传入）
  let { data }: { data?: unknown } = $props();

  const node = $derived(typeof data === 'string' ? getNode(data) : undefined);
  // 写权限：无写权限则只读（与终端「无写位则拒写」一致）
  const writable = $derived(!!node && permits(node, currentUser(), 2));
  // Markdown 文件：可切「编辑/预览」，预览复用 renderMarkdown（与 AI 回复同一安全渲染器）
  const isMarkdown = $derived(!!node && /\.(md|markdown)$/i.test(node.name));
  let preview = $state(false);
  // provider 感知：OpenAI 兼容端点（本地等）无需 key，仅 Anthropic 强制要 key（与 Assistant 一致）
  const hasKey = $derived(aiConfig.provider === 'openai' || !!aiConfig.apiKey);

  // ── AI 面板的本地状态（组件内 $state：开关 / 忙 / 输出 / 当前动作名 / 中止句柄） ──
  let aiOpen = $state(false);
  let aiBusy = $state(false);
  let aiOut = $state('');
  let aiLabel = $state('');
  let ctrl: AbortController | null = null;

  // 每个动作 = 一段任务系统提示。complete() 用它替换默认提示 → 结果聚焦、可控。
  const ACTIONS = [
    {
      key: 'polish',
      label: '✨ 润色',
      sys: '你是中文写作助手。在保持原意与语言的前提下润色下面的文本，使其更通顺自然。只输出润色后的正文，不要解释、不要加引号或代码块。',
    },
    {
      key: 'summary',
      label: '📝 总结',
      sys: '你是中文写作助手。用简洁的要点总结下面的文本。只输出总结本身，不要解释。',
    },
    {
      key: 'continue',
      label: '➡️ 续写',
      sys: '你是中文写作助手。承接下面的文本自然地往下续写一段，风格保持一致。只输出新增的续写内容，不要重复原文。',
    },
    {
      key: 'en',
      label: '🌐 译英',
      sys: 'You are a professional translator. Translate the following text into natural, fluent English. Output only the translation, nothing else.',
    },
  ];

  async function runAi(a: (typeof ACTIONS)[number]) {
    if (!node || aiBusy) return;
    const src = (node.content ?? '').trim();
    if (!src) {
      aiOpen = true;
      aiLabel = a.label;
      aiOut = '（文件是空的，先写点内容再让 AI 处理）';
      return;
    }
    aiOpen = true;
    aiBusy = true;
    aiOut = '';
    aiLabel = a.label;
    ctrl = new AbortController();
    try {
      await complete(src, { system: a.sys, onText: (t) => (aiOut += t), signal: ctrl.signal });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError'))
        aiOut += (aiOut ? '\n\n' : '') + '⚠️ ' + (e instanceof Error ? e.message : String(e));
    }
    aiBusy = false;
  }

  function stopAi() {
    ctrl?.abort();
    aiBusy = false;
  }
  function replaceWith() {
    if (node && writable && aiOut.trim()) writeFile(node.id, aiOut.trim());
    closeAi();
  }
  function appendOut() {
    if (node && writable && aiOut.trim()) writeFile(node.id, (node.content ?? '') + '\n\n' + aiOut.trim());
    closeAi();
  }
  function closeAi() {
    aiOpen = false;
    aiOut = '';
    aiLabel = '';
  }

  // ── 查找/替换（Ctrl+F 唤起）+ 行/字符统计 ──────────────────────────────
  let textarea = $state<HTMLTextAreaElement>();
  let findInput = $state<HTMLInputElement>();
  let findOpen = $state(false);
  let findQuery = $state('');
  let replaceText = $state('');
  let caseSensitive = $state(false);
  let curMatch = $state(0); // 当前命中序号（1-based，0=未定位）

  const lineCount = $derived((node?.content ?? '').split('\n').length);
  const charCount = $derived((node?.content ?? '').length);

  // 所有命中位置（content/query/大小写一变就重算 → totalMatches 实时更新）
  function matchIndices(): number[] {
    const content = node?.content ?? '';
    const q = findQuery;
    if (!q) return [];
    const hay = caseSensitive ? content : content.toLowerCase();
    const needle = caseSensitive ? q : q.toLowerCase();
    const out: number[] = [];
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push(i);
      i = hay.indexOf(needle, i + needle.length); // 非重叠
    }
    return out;
  }
  const totalMatches = $derived(matchIndices().length);

  // 跳到下一个/上一个命中并在 textarea 里选中（带环绕）
  function gotoMatch(dir: 1 | -1) {
    const ta = textarea;
    const idxs = matchIndices();
    if (!idxs.length || !ta) {
      curMatch = 0;
      return;
    }
    let target: number;
    if (dir === 1) {
      target = idxs.find((i) => i >= ta.selectionEnd) ?? idxs[0];
    } else {
      const prev = idxs.filter((i) => i < ta.selectionStart);
      target = prev.length ? prev[prev.length - 1] : idxs[idxs.length - 1];
    }
    curMatch = idxs.indexOf(target) + 1;
    ta.focus();
    ta.setSelectionRange(target, target + findQuery.length);
  }

  function replaceCurrent() {
    if (!node || !writable || !findQuery || !textarea) return;
    const s = textarea.selectionStart;
    const e = textarea.selectionEnd;
    const sel = (node.content ?? '').slice(s, e);
    const isMatch = caseSensitive ? sel === findQuery : sel.toLowerCase() === findQuery.toLowerCase();
    if (!isMatch) {
      gotoMatch(1); // 当前没选中命中 → 先定位
      return;
    }
    const content = node.content ?? '';
    const ta = textarea;
    node.content = content.slice(0, s) + replaceText + content.slice(e);
    // 等绑定回写后再找下一个
    queueMicrotask(() => {
      ta.setSelectionRange(s + replaceText.length, s + replaceText.length);
      gotoMatch(1);
    });
  }

  function replaceAll() {
    if (!node || !writable || !findQuery) return;
    const content = node.content ?? '';
    const idxs = matchIndices();
    if (!idxs.length) return;
    let out = '';
    let last = 0;
    for (const i of idxs) {
      out += content.slice(last, i) + replaceText;
      last = i + findQuery.length;
    }
    out += content.slice(last);
    node.content = out;
    curMatch = 0;
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      preview = false; // 查找/替换作用于 textarea，先切回编辑态
      findOpen = true;
      queueMicrotask(() => findInput?.focus());
    } else if (e.key === 'Escape' && findOpen) {
      findOpen = false;
      textarea?.focus();
    }
  }
</script>

{#if node}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="flex h-full flex-col" onkeydown={onKey}>
    <!-- Markdown 工具条：编辑/预览切换（仅 .md/.markdown 文件） -->
    {#if isMarkdown}
      <div class="flex shrink-0 items-center gap-2 border-b border-qz-border px-2 py-1.5">
        <span class="text-[11px] text-qz-muted">📝 Markdown</span>
        <div class="flex overflow-hidden rounded text-[11px] ring-1 ring-qz-border">
          <button
            class="px-2 py-0.5 transition"
            class:bg-qz-accent={!preview}
            class:text-qz-accent-contrast={!preview}
            class:hover:bg-qz-elevated={preview}
            onclick={() => (preview = false)}>编辑</button>
          <button
            class="px-2 py-0.5 transition"
            class:bg-qz-accent={preview}
            class:text-qz-accent-contrast={preview}
            class:hover:bg-qz-elevated={!preview}
            onclick={() => (preview = true)}>预览</button>
        </div>
      </div>
    {/if}

    <!-- AI 动作条（配了 key 才显示） -->
    {#if hasKey}
      <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-qz-border px-2 py-1.5">
        <span class="text-[11px] text-qz-muted">AI</span>
        {#each ACTIONS as a (a.key)}
          <button
            class="rounded bg-qz-elevated px-2 py-1 text-[11px] transition hover:brightness-110 disabled:opacity-40"
            disabled={aiBusy}
            onclick={() => runAi(a)}>{a.label}</button>
        {/each}
      </div>
    {/if}

    {#if !writable}
      <div class="shrink-0 border-b border-qz-border bg-amber-500/15 px-3 py-1 text-[11px] text-amber-300">
        🔒 只读 —— 当前用户对此文件无写权限（chmod +w 或改属主后可编辑）
      </div>
    {/if}

    <!-- 查找/替换条（Ctrl+F 唤起） -->
    {#if findOpen}
      <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-qz-border bg-qz-surface/60 px-2 py-1.5 text-[11px]">
        <input
          bind:this={findInput}
          bind:value={findQuery}
          oninput={() => (curMatch = 0)}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              gotoMatch(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="查找"
          class="min-w-0 flex-1 rounded bg-qz-elevated px-2 py-1 outline-none ring-1 ring-transparent focus:ring-qz-accent"
        />
        <span class="shrink-0 tabular-nums text-qz-muted">{totalMatches ? `${Math.min(curMatch, totalMatches)}/${totalMatches}` : '0/0'}</span>
        <button class="rounded px-1.5 py-1 hover:bg-qz-elevated disabled:opacity-40" disabled={!totalMatches} onclick={() => gotoMatch(-1)} title="上一个">↑</button>
        <button class="rounded px-1.5 py-1 hover:bg-qz-elevated disabled:opacity-40" disabled={!totalMatches} onclick={() => gotoMatch(1)} title="下一个">↓</button>
        <label class="flex shrink-0 items-center gap-1 text-qz-muted" title="区分大小写">
          <input type="checkbox" bind:checked={caseSensitive} /> Aa
        </label>
        {#if writable}
          <input
            bind:value={replaceText}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceCurrent();
              }
            }}
            placeholder="替换为"
            class="min-w-0 flex-1 rounded bg-qz-elevated px-2 py-1 outline-none ring-1 ring-transparent focus:ring-qz-accent"
          />
          <button class="rounded px-2 py-1 hover:bg-qz-elevated" onclick={replaceCurrent}>替换</button>
          <button class="rounded px-2 py-1 hover:bg-qz-elevated" onclick={replaceAll}>全部</button>
        {/if}
        <button class="rounded px-1.5 py-1 text-qz-muted hover:bg-qz-elevated" onclick={() => { findOpen = false; textarea?.focus(); }} title="关闭 (Esc)">✕</button>
      </div>
    {/if}

    <!-- 正文：Markdown 预览态渲染只读 HTML；否则 textarea bind 到 content → persisted 自动存盘 -->
    {#if isMarkdown && preview}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="min-h-0 flex-1 overflow-auto break-words p-4 text-sm leading-relaxed text-qz-text">
        {#if (node.content ?? '').trim()}
          {@html renderMarkdown(node.content ?? '')}
        {:else}
          <span class="text-qz-muted">（空文件 —— 切到「编辑」写点 Markdown）</span>
        {/if}
      </div>
    {:else}
      <textarea
        bind:this={textarea}
        class="min-h-0 w-full flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-qz-text outline-none"
        bind:value={node.content}
        readonly={!writable}
        spellcheck="false"
        placeholder="空文件"
      ></textarea>
    {/if}

    <!-- AI 输出预览面板：流式进来，用户决定替换/追加/丢弃（不自动毁原文） -->
    {#if aiOpen}
      <div class="flex max-h-[45%] shrink-0 flex-col border-t border-qz-border bg-qz-surface/60">
        <div class="flex items-center justify-between gap-2 px-3 py-1.5">
          <span class="truncate text-[11px] text-qz-muted">{aiLabel}{aiBusy ? ' · 生成中…' : ''}</span>
          <div class="flex shrink-0 gap-1">
            {#if aiBusy}
              <button class="rounded px-2 py-0.5 text-[11px] hover:bg-qz-elevated" onclick={stopAi}>停止</button>
            {:else if writable}
              <button
                class="rounded bg-qz-accent px-2 py-0.5 text-[11px] text-qz-accent-contrast active:scale-95"
                onclick={replaceWith}>替换</button>
              <button class="rounded px-2 py-0.5 text-[11px] hover:bg-qz-elevated" onclick={appendOut}>追加</button>
            {/if}
            <button class="rounded px-2 py-0.5 text-[11px] text-qz-muted hover:bg-qz-elevated" onclick={closeAi}
              >丢弃</button>
          </div>
        </div>
        <div class="overflow-auto whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed">{aiOut.replace(/^\s+/, '') || '…'}</div>
      </div>
    {/if}

    <!-- 状态栏：行/字符统计（Ctrl+F 查找替换） -->
    <div class="flex shrink-0 items-center justify-between border-t border-qz-border px-3 py-1 text-[10px] text-qz-muted">
      <span>{lineCount} 行 · {charCount} 字符</span>
      <span>Ctrl+F 查找{writable ? '/替换' : ''}</span>
    </div>
  </div>
{:else}
  <div class="grid h-full place-items-center text-sm text-qz-muted">文件不存在或已删除</div>
{/if}
