<script lang="ts">
  import { getNode, writeFile } from '../kernel/vfs.svelte';
  import { complete } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';

  // data = 要打开的文件 id（由文件管理器在 launch 时通过启动参数传入）
  let { data }: { data?: unknown } = $props();

  const node = $derived(typeof data === 'string' ? getNode(data) : undefined);
  const hasKey = $derived(!!aiConfig.apiKey);

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
    if (node && aiOut.trim()) writeFile(node.id, aiOut.trim());
    closeAi();
  }
  function appendOut() {
    if (node && aiOut.trim()) writeFile(node.id, (node.content ?? '') + '\n\n' + aiOut.trim());
    closeAi();
  }
  function closeAi() {
    aiOpen = false;
    aiOut = '';
    aiLabel = '';
  }
</script>

{#if node}
  <div class="flex h-full flex-col">
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

    <!-- 正文：bind 到文件节点 content → persisted 自动存盘（防抖） -->
    <textarea
      class="min-h-0 w-full flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-qz-text outline-none"
      bind:value={node.content}
      spellcheck="false"
      placeholder="空文件"
    ></textarea>

    <!-- AI 输出预览面板：流式进来，用户决定替换/追加/丢弃（不自动毁原文） -->
    {#if aiOpen}
      <div class="flex max-h-[45%] shrink-0 flex-col border-t border-qz-border bg-qz-surface/60">
        <div class="flex items-center justify-between gap-2 px-3 py-1.5">
          <span class="truncate text-[11px] text-qz-muted">{aiLabel}{aiBusy ? ' · 生成中…' : ''}</span>
          <div class="flex shrink-0 gap-1">
            {#if aiBusy}
              <button class="rounded px-2 py-0.5 text-[11px] hover:bg-qz-elevated" onclick={stopAi}>停止</button>
            {:else}
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
  </div>
{:else}
  <div class="grid h-full place-items-center text-sm text-qz-muted">文件不存在或已删除</div>
{/if}
