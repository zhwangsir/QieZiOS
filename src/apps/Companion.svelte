<script lang="ts">
  import { createPet, type Pet } from '../lib/live2d';
  import { companion, DEFAULT_MODEL } from '../system/companion.svelte';

  let canvas = $state<HTMLCanvasElement>();
  let container = $state<HTMLElement>();
  let status = $state<'idle' | 'loading' | 'ok' | 'error'>('idle');
  let errMsg = $state('');
  let pet: Pet | null = null;

  async function load() {
    if (!canvas || !container) return;
    status = 'loading';
    errMsg = '';
    pet?.destroy();
    pet = null;
    try {
      pet = await createPet(canvas, container, companion.modelUrl.trim() || DEFAULT_MODEL);
      status = 'ok';
    } catch (e) {
      status = 'error';
      errMsg = e instanceof Error ? e.message : String(e);
    }
  }

  // 首次挂载（canvas/container 就绪）自动召唤一次
  $effect(() => {
    if (canvas && container && status === 'idle') load();
  });
  // 仅卸载时清理（无响应式依赖 → 只跑一次）
  $effect(() => () => pet?.destroy());
</script>

<div class="flex h-full flex-col text-qz-text">
  <div class="flex shrink-0 items-center gap-2 border-b border-qz-border px-2 py-1.5">
    <span class="shrink-0 text-xs text-qz-muted">🧚 伙伴</span>
    <input
      class="min-w-0 flex-1 rounded-md bg-qz-surface px-2 py-1 text-[11px] outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="模型 .model3.json URL"
      bind:value={companion.modelUrl}
      onkeydown={(e) => {
        if (e.key === 'Enter') load();
      }}
    />
    <button
      class="shrink-0 rounded-md bg-qz-accent px-2.5 py-1 text-[11px] font-medium text-qz-accent-contrast active:scale-95 disabled:opacity-50"
      disabled={status === 'loading'}
      onclick={load}>{status === 'loading' ? '召唤中…' : '加载'}</button>
  </div>

  <div bind:this={container} class="relative min-h-0 flex-1">
    <canvas bind:this={canvas} class="absolute inset-0 block h-full w-full"></canvas>
    {#if status === 'loading'}
      <div class="pointer-events-none absolute inset-0 grid place-items-center text-sm text-qz-muted">
        召唤伙伴中…（首次要下 PixiJS + 模型）
      </div>
    {:else if status === 'error'}
      <div class="absolute inset-0 grid place-items-center px-4 text-center text-xs text-red-400">
        ⚠️ {errMsg}<br /><span class="text-qz-muted">换个 .model3.json URL 再试</span>
      </div>
    {/if}
  </div>
</div>
