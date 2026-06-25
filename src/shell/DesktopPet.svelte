<script lang="ts">
  import { pet } from '../system/pet.svelte';
  import { companion } from '../system/companion.svelte';
  import { createPet, type Pet } from '../lib/live2d';

  let canvas = $state<HTMLCanvasElement>();
  let container = $state<HTMLElement>();
  let status = $state<'loading' | 'ok' | 'error'>('loading');
  let errMsg = $state('');

  // enabled 且 canvas/container 就绪 → 起一个 Live2D 实例；关掉/卸载就销毁。
  $effect(() => {
    if (!pet.enabled || !canvas || !container) return;
    let inst: Pet | null = null;
    let destroyed = false;
    status = 'loading';
    errMsg = '';
    createPet(canvas, container, companion.modelUrl)
      .then((x) => {
        if (destroyed) x.destroy();
        else {
          inst = x;
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
      inst?.destroy();
    };
  });

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
  <!-- 浮在窗口之上、Dock/顶栏之下；可拖、可关 -->
  <div class="fixed left-0 top-0 z-[9500] select-none" style="transform: translate({pet.x}px, {pet.y}px);">
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
