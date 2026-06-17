<script lang="ts">
  import { runAgent, type AiEvent, type ChatTurn } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';
  import { chat } from '../system/assistantChat.svelte';
  import { renderMarkdown } from '../lib/markdown';
  import { launch } from '../kernel/processes.svelte';
  import { appMeta } from './appList';

  let input = $state('');
  let busy = $state(false);
  let ctrl: AbortController | null = null;
  let scroller: HTMLElement;

  const hasKey = $derived(!!aiConfig.apiKey);

  // 新内容时滚到底
  $effect(() => {
    chat.msgs.length;
    chat.msgs.at(-1)?.text;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  function openSettings() {
    const s = appMeta.settings;
    launch('settings', s.title, { width: s.width, height: s.height });
  }

  function clearChat() {
    chat.msgs.splice(0, chat.msgs.length);
  }

  function stop() {
    ctrl?.abort();
    busy = false;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    input = '';
    busy = true;
    chat.msgs.push({ role: 'user', text, tools: [] });
    chat.msgs.push({ role: 'assistant', text: '', tools: [] });
    const i = chat.msgs.length - 1; // 助手占位下标（通过下标改 → 触发响应式）

    // 历史：把已有对话转成 API 消息（纯文本，工具上下文由 runAgent 内部维护）
    const history: ChatTurn[] = chat.msgs
      .slice(0, i)
      .filter((m) => m.text)
      .map((m) => ({ role: m.role, content: m.text }));

    ctrl = new AbortController();
    await runAgent(
      history,
      (e: AiEvent) => {
        if (e.type === 'text') chat.msgs[i].text += e.text;
        else if (e.type === 'reasoning')
          chat.msgs[i].reasoning = (chat.msgs[i].reasoning ?? '') + e.text;
        else if (e.type === 'tool') chat.msgs[i].tools.push(e.name);
        else if (e.type === 'error')
          chat.msgs[i].text += (chat.msgs[i].text ? '\n\n' : '') + '⚠️ ' + e.message;
      },
      ctrl.signal,
    );
    busy = false;
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 顶栏：标题 + 清空 -->
  <div class="flex h-8 shrink-0 items-center justify-between border-b border-qz-border px-3">
    <span class="text-xs text-qz-muted">🤖 助手</span>
    {#if chat.msgs.length}
      <button class="rounded px-1.5 py-0.5 text-[11px] text-qz-muted hover:bg-qz-elevated" onclick={clearChat}
        >清空</button>
    {/if}
  </div>

  {#if !hasKey}
    <button
      class="shrink-0 border-b border-qz-border bg-qz-accent/15 px-3 py-2 text-left text-xs hover:bg-qz-accent/25"
      onclick={openSettings}>🔑 还没配置 AI——点这里去「设置 → AI」填入 Anthropic API Key</button>
  {/if}

  <!-- 对话区 -->
  <div bind:this={scroller} class="flex-1 space-y-3 overflow-auto p-3">
    {#if chat.msgs.length === 0}
      <div class="grid h-full place-items-center px-6 text-center text-sm text-qz-muted">
        <div>
          <div class="mb-2 text-4xl">🤖</div>
          我是 QieZiOS 助手。试试「打开计算器」「新建一个叫 笔记 的文件夹」「把主题调成暗色、主色改成绿色」。
        </div>
      </div>
    {/if}

    {#each chat.msgs as m, mi (mi)}
      <div class="flex" class:justify-end={m.role === 'user'}>
        <div
          class="max-w-[85%] rounded-qz px-3 py-2 text-sm leading-relaxed"
          class:whitespace-pre-wrap={m.role === 'user'}
          class:bg-qz-accent={m.role === 'user'}
          class:text-qz-accent-contrast={m.role === 'user'}
          class:bg-qz-elevated={m.role === 'assistant'}
        >
          {#if m.tools.length}
            <div class="mb-1 flex flex-wrap gap-1">
              {#each m.tools as t, ti (ti)}
                <span class="rounded bg-qz-surface/70 px-1.5 py-0.5 text-[10px] text-qz-muted">⚙ {t}</span>
              {/each}
            </div>
          {/if}
          {#if m.role === 'assistant' && m.reasoning}
            <details class="mb-1 text-[11px] text-qz-muted">
              <summary class="cursor-pointer select-none opacity-70 hover:opacity-100">💭 思考过程</summary>
              <div class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap border-l-2 border-qz-border pl-2 opacity-80">{m.reasoning}</div>
            </details>
          {/if}
          {#if m.role === 'assistant'}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderMarkdown(
              (m.text ?? '').replace(/^\s+/, '') || (busy && mi === chat.msgs.length - 1 ? '…' : ''),
            )}
          {:else}{m.text}{/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- 输入区 -->
  <div class="flex shrink-0 gap-2 border-t border-qz-border p-2">
    <input
      class="min-w-0 flex-1 rounded-qz bg-qz-surface px-3 py-2 text-sm outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="让助手做点什么…"
      bind:value={input}
      disabled={busy}
      onkeydown={(e) => {
        if (e.key === 'Enter') send();
      }}
    />
    {#if busy}
      <button
        class="rounded-qz bg-qz-elevated px-4 text-sm font-medium transition-transform active:scale-95"
        onclick={stop}>停止</button>
    {:else}
      <button
        class="rounded-qz bg-qz-accent px-4 text-sm font-medium text-qz-accent-contrast transition-transform active:scale-95 disabled:opacity-40"
        onclick={send}
        disabled={!input.trim()}>发送</button>
    {/if}
  </div>
</div>
