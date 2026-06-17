<script lang="ts">
  import type Anthropic from '@anthropic-ai/sdk';
  import { runAgent, type AiEvent } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';
  import { launch } from '../kernel/processes.svelte';
  import { appMeta } from './appList';

  interface ChatMsg {
    role: 'user' | 'assistant';
    text: string;
    tools: string[];
  }

  let msgs = $state<ChatMsg[]>([]);
  let input = $state('');
  let busy = $state(false);
  let scroller: HTMLElement;

  const hasKey = $derived(!!aiConfig.apiKey);

  // 新内容时滚到底
  $effect(() => {
    msgs.length;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  function openSettings() {
    const s = appMeta.settings;
    launch('settings', s.title, { width: s.width, height: s.height });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    input = '';
    busy = true;
    msgs.push({ role: 'user', text, tools: [] });
    msgs.push({ role: 'assistant', text: '', tools: [] });
    const i = msgs.length - 1; // 助手占位消息下标（通过下标改 → 触发响应式）

    // 历史：把已有对话转成 API 消息（纯文本，工具上下文由 runAgent 内部维护）
    const history: Anthropic.MessageParam[] = msgs
      .slice(0, i)
      .filter((m) => m.text)
      .map((m) => ({ role: m.role, content: m.text }));

    await runAgent(history, (e: AiEvent) => {
      if (e.type === 'text') msgs[i].text += e.text;
      else if (e.type === 'tool') msgs[i].tools.push(e.name);
      else if (e.type === 'error') msgs[i].text += (msgs[i].text ? '\n\n' : '') + '⚠️ ' + e.message;
    });
    busy = false;
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 没填 key 的提示条 -->
  {#if !hasKey}
    <button
      class="shrink-0 border-b border-qz-border bg-qz-accent/15 px-3 py-2 text-left text-xs text-qz-text hover:bg-qz-accent/25"
      onclick={openSettings}
    >🔑 还没配置 AI——点这里去「设置 → AI」填入 Anthropic API Key</button>
  {/if}

  <!-- 对话区 -->
  <div bind:this={scroller} class="flex-1 space-y-3 overflow-auto p-3">
    {#if msgs.length === 0}
      <div class="grid h-full place-items-center px-6 text-center text-sm text-qz-muted">
        <div>
          <div class="mb-2 text-4xl">🤖</div>
          我是 QieZiOS 助手。试试「打开计算器」「新建一个叫 笔记 的文件夹」「把主题调成暗色、主色改成绿色」。
        </div>
      </div>
    {/if}

    {#each msgs as m (m)}
      <div class="flex" class:justify-end={m.role === 'user'}>
        <div
          class="max-w-[85%] whitespace-pre-wrap rounded-qz px-3 py-2 text-sm leading-relaxed"
          class:bg-qz-accent={m.role === 'user'}
          class:text-qz-accent-contrast={m.role === 'user'}
          class:bg-qz-elevated={m.role === 'assistant'}
        >
          {#if m.tools.length}
            <div class="mb-1 flex flex-wrap gap-1">
              {#each m.tools as t, ti (ti)}
                <span class="rounded bg-qz-surface/70 px-1.5 py-0.5 text-[10px] text-qz-muted"
                  >⚙ {t}</span
                >
              {/each}
            </div>
          {/if}
          {m.text}{#if m.role === 'assistant' && busy && m === msgs[msgs.length - 1]}<span
              class="animate-pulse">▋</span
            >{/if}
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
    <button
      class="rounded-qz bg-qz-accent px-4 text-sm font-medium text-qz-accent-contrast transition-transform active:scale-95 disabled:opacity-40"
      onclick={send}
      disabled={busy || !input.trim()}>{busy ? '…' : '发送'}</button
    >
  </div>
</div>
