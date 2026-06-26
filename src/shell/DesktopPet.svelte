<script lang="ts">
  import { pet } from '../system/pet.svelte';
  import { companion } from '../system/companion.svelte';
  import { createPet, type Pet } from '../lib/live2d';
  import { complete } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';
  import { sys } from '../system/sys';

  let canvas = $state<HTMLCanvasElement>();
  let container = $state<HTMLElement>();
  let status = $state<'loading' | 'ok' | 'error'>('loading');
  let errMsg = $state('');
  let petInst: Pet | null = null;

  // 聊天气泡
  let chatting = $state(false);
  let question = $state('');
  let reply = $state('');
  let busy = $state(false);
  let ctrl: AbortController | null = null;
  // AI 是否就绪（provider 感知，与 Assistant 一致）：OpenAI 兼容端点（本地 LM Studio 等）无需 key，
  // 仅 Anthropic 强制要 key。原来只看 !!apiKey → 本地 provider 会被误判「没配 AI」。
  const hasKey = $derived(aiConfig.provider === 'openai' || !!aiConfig.apiKey);

  $effect(() => {
    if (!pet.enabled || !canvas || !container) return;
    let destroyed = false;
    status = 'loading';
    errMsg = '';
    createPet(canvas, container, companion.modelUrl)
      .then((x) => {
        if (destroyed) x.destroy();
        else {
          petInst = x;
          status = 'ok';
        }
      })
      .catch((e) => {
        if (!destroyed) {
          status = 'error';
          errMsg = e instanceof Error ? e.message : String(e);
        }
      });
    return () => {
      destroyed = true;
      petInst?.destroy();
      petInst = null;
    };
  });

  // 桌宠是助手的「脸」：用 complete 做轻量对话，回复完做个动作
  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    question = '';
    reply = '';
    busy = true;
    ctrl = new AbortController();
    let mouth: ReturnType<typeof setInterval> | null = null;
    const stopMouth = () => {
      if (mouth) {
        clearInterval(mouth);
        mouth = null;
      }
      petInst?.setMouth(0);
    };
    try {
      await complete(q, {
        system: '你是 QieZiOS 的桌面伙伴，一只机灵可爱的小助手。用一两句俏皮、温暖的中文回应主人，别太长。',
        onText: (t) => {
          reply += t;
          // 首个正文块开始 → 做简单口型（best-effort，模型无该参数则无视）
          if (!mouth) mouth = setInterval(() => petInst?.setMouth(Math.random() * 0.8), 120);
        },
        signal: ctrl.signal,
      });
      stopMouth();
      petInst?.react(); // 动作
      petInst?.expression(); // 表情
    } catch (e) {
      stopMouth();
      if (!(e instanceof Error && e.name === 'AbortError'))
        reply = '⚠️ ' + (e instanceof Error ? e.message : String(e));
    }
    busy = false;
  }

  // 拖动手柄
  let sx = 0,
    sy = 0,
    ox = 0,
    oy = 0,
    dragging = false;
  function down(e: PointerEvent) {
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    ox = pet.x;
    oy = pet.y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    pet.x = Math.max(0, ox + (e.clientX - sx));
    pet.y = Math.max(36, oy + (e.clientY - sy));
  }
  function up() {
    dragging = false;
  }
</script>

{#if pet.enabled}
  <div class="fixed left-0 top-0 z-[9500] select-none" style="transform: translate({pet.x}px, {pet.y}px);">
    <!-- 聊天气泡 -->
    {#if chatting}
      <div class="mb-1 w-[220px] rounded-2xl border border-qz-border qz-glass p-2 text-xs text-qz-text shadow-xl">
        {#if reply}
          <div class="mb-1.5 max-h-32 overflow-auto whitespace-pre-wrap leading-snug">
            {reply.replace(/^\s+/, '')}
          </div>
        {/if}
        {#if hasKey}
          <div class="flex gap-1">
            <input
              class="min-w-0 flex-1 rounded-md bg-qz-surface px-2 py-1 outline-none ring-1 ring-qz-border focus:ring-qz-accent"
              placeholder="跟我说点什么…"
              bind:value={question}
              disabled={busy}
              onkeydown={(e) => {
                if (e.key === 'Enter') ask();
              }}
            />
            <button
              class="shrink-0 rounded-md bg-qz-accent px-2 font-medium text-qz-accent-contrast active:scale-95 disabled:opacity-40"
              disabled={busy || !question.trim()}
              onclick={ask}>{busy ? '…' : '问'}</button>
          </div>
        {:else}
          <div class="flex flex-col gap-1.5 text-qz-muted">
            <span>还没配 AI，配置后就能和我聊天啦～</span>
            <button
              class="self-start rounded-md bg-qz-accent px-2 py-1 text-[11px] font-medium text-qz-accent-contrast active:scale-95"
              onclick={() => {
                sys.openApp('settings');
                chatting = false;
              }}>去设置 AI →</button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- 手柄行：拖动 + 聊天 + 关闭 -->
    <div class="flex items-center gap-1 px-1">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="h-4 flex-1 cursor-grab active:cursor-grabbing"
        title="拖动桌宠"
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
      >
        <div class="mx-auto mt-1 h-1 w-10 rounded-full bg-qz-text/30"></div>
      </div>
      <button
        class="grid h-4 w-4 place-items-center rounded text-[10px] hover:bg-qz-elevated"
        class:text-qz-accent={chatting}
        class:text-qz-muted={!chatting}
        title="聊天"
        onclick={() => (chatting = !chatting)}>💬</button>
      <button
        class="grid h-4 w-4 place-items-center rounded text-[10px] text-qz-muted hover:bg-qz-elevated"
        title="隐藏桌宠"
        onclick={() => (pet.enabled = false)}>✕</button>
    </div>

    <div bind:this={container} class="relative h-[280px] w-[220px]">
      <canvas bind:this={canvas} class="block h-full w-full"></canvas>
      {#if status === 'loading'}
        <div class="pointer-events-none absolute inset-0 grid place-items-center text-xs text-qz-muted">召唤中…</div>
      {:else if status === 'error'}
        <div class="absolute inset-0 grid place-items-center px-2 text-center text-[10px] text-red-400">⚠️ {errMsg}</div>
      {/if}
    </div>
  </div>
{/if}
