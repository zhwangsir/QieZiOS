<script lang="ts">
  import { runAgent, type AiEvent, type ChatTurn } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';
  import { chat } from '../system/assistantChat.svelte';
  import { renderMarkdown } from '../lib/markdown';
  import { imageFileToThumb } from '../lib/image';
  import { sys } from '../system/sys';

  // data = 可选启动参数：{ ask: string } → 挂载后自动发这条（Spotlight「问 AI」用）
  let { data }: { data?: unknown } = $props();

  let input = $state('');
  let busy = $state(false);
  let pending = $state<string[]>([]); // 待发送的附图（缩放后的 data URL）
  let fileInput: HTMLInputElement;
  let ctrl: AbortController | null = null;
  let scroller: HTMLElement;

  // OpenAI 兼容端点可无 key（本地 LM Studio）；只有 Anthropic 官方强制要 key
  const aiReady = $derived(aiConfig.provider === 'openai' || !!aiConfig.apiKey);

  // 自动提问：只在挂载时跑一次（data 启动后不变，effect 自然只触发一次；autoAsked 兜底防重）
  let autoAsked = false;
  $effect(() => {
    if (autoAsked) return;
    const q =
      data && typeof data === 'object' && 'ask' in data ? String((data as { ask: unknown }).ask).trim() : '';
    if (q) {
      autoAsked = true;
      ask(q);
    }
  });

  // 新内容时滚到底
  $effect(() => {
    chat.msgs.length;
    chat.msgs.at(-1)?.text;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  function openSettings() {
    sys.openApp('settings');
  }

  function clearChat() {
    chat.msgs.splice(0, chat.msgs.length);
  }

  function stop() {
    ctrl?.abort();
    busy = false;
  }

  // 把图片文件缩放后加入待发送列表
  async function addFiles(files: Iterable<File>) {
    for (const f of files) {
      try {
        const thumb = await imageFileToThumb(f);
        if (thumb) pending.push(thumb);
      } catch {
        /* 单张失败：跳过，不打断其它 */
      }
    }
  }
  async function onPick(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (el.files) await addFiles(el.files);
    el.value = ''; // 允许再次选同一文件
  }
  async function onPaste(e: ClipboardEvent) {
    const imgs = [...(e.clipboardData?.items ?? [])]
      .filter((it) => it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault(); // 别把图片名当文本粘进输入框
      await addFiles(imgs);
    }
  }

  async function send() {
    const text = input.trim();
    const imgs = pending.slice();
    if ((!text && !imgs.length) || busy) return;
    input = '';
    pending = [];
    await ask(text, imgs);
  }

  async function ask(text: string, images: string[] = []) {
    if ((!text && !images.length) || busy) return;
    busy = true;
    chat.msgs.push({ role: 'user', text, tools: [], images: images.length ? images : undefined });
    chat.msgs.push({ role: 'assistant', text: '', tools: [] });
    const i = chat.msgs.length - 1; // 助手占位下标（通过下标改 → 触发响应式）

    // 历史：把已有对话转成 API 消息（带图的 user 消息会被引擎拼成多模态）
    const history: ChatTurn[] = chat.msgs
      .slice(0, i)
      .filter((m) => m.text || m.images?.length)
      .map((m) => ({ role: m.role, content: m.text, images: m.images }));

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

  {#if !aiReady}
    <button
      class="shrink-0 border-b border-qz-border bg-qz-accent/15 px-3 py-2 text-left text-xs hover:bg-qz-accent/25"
      onclick={openSettings}>🔑 还没配置 AI——点这里去「设置 → AI」选模型 / 填 Key</button>
  {/if}

  <!-- 对话区 -->
  <div bind:this={scroller} class="flex-1 space-y-3 overflow-auto p-3">
    {#if chat.msgs.length === 0}
      <div class="grid h-full place-items-center px-6 text-center text-sm text-qz-muted">
        <div>
          <div class="mb-2 text-4xl">🤖</div>
          我是 QieZiOS 助手。试试「打开计算器」「新建一个叫 笔记 的文件夹」「把主题调成暗色、主色改成绿色」。
          <div class="mt-2 text-xs opacity-70">📎 还能贴/传图片让我看图回答（需视觉模型，如本地 GLM-4.6V）。</div>
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
          {#if m.images?.length}
            <div class="mb-1 flex flex-wrap gap-1">
              {#each m.images as src, ii (ii)}
                <img {src} alt="附图" class="h-20 w-20 rounded-qz object-cover ring-1 ring-black/10" />
              {/each}
            </div>
          {:else if m.imageCount}
            <!-- 刷新后图片字节已不持久化，仅占位提示 -->
            <div class="mb-1 text-[11px] text-qz-muted">🖼 {m.imageCount} 张附图（历史不保留原图）</div>
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

  <!-- 待发送附图预览 -->
  {#if pending.length}
    <div class="flex shrink-0 flex-wrap gap-2 border-t border-qz-border px-2 pt-2">
      {#each pending as src, pi (pi)}
        <div class="relative">
          <img {src} alt="待发送" class="h-14 w-14 rounded-qz object-cover ring-1 ring-qz-border" />
          <button
            class="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-qz-elevated text-[11px] leading-none ring-1 ring-qz-border hover:bg-qz-accent hover:text-qz-accent-contrast"
            title="移除"
            onclick={() => pending.splice(pi, 1)}>×</button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- 输入区 -->
  <div class="flex shrink-0 items-center gap-2 border-t border-qz-border p-2">
    <input type="file" accept="image/*" multiple bind:this={fileInput} class="hidden" onchange={onPick} />
    <button
      class="shrink-0 rounded-qz px-2 py-2 text-base ring-1 ring-qz-border hover:bg-qz-elevated disabled:opacity-40"
      title="附加图片（也可直接 Ctrl+V 粘贴）"
      disabled={busy}
      onclick={() => fileInput.click()}>📎</button>
    <input
      class="min-w-0 flex-1 rounded-qz bg-qz-surface px-3 py-2 text-sm outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="让助手做点什么…（可贴图）"
      bind:value={input}
      disabled={busy}
      onpaste={onPaste}
      onkeydown={(e) => {
        if (e.key === 'Enter') send();
      }}
    />
    {#if busy}
      <button
        class="rounded-qz bg-qz-elevated px-4 py-2 text-sm font-medium transition-transform active:scale-95"
        onclick={stop}>停止</button>
    {:else}
      <button
        class="rounded-qz bg-qz-accent px-4 py-2 text-sm font-medium text-qz-accent-contrast transition-transform active:scale-95 disabled:opacity-40"
        onclick={send}
        disabled={!input.trim() && !pending.length}>发送</button>
    {/if}
  </div>
</div>
