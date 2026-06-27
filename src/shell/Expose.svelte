<script lang="ts">
  import { processes, restore } from '../kernel/processes.svelte';
  import { resolveAppDef } from '../apps/desktopApps.svelte';
  import { expose, closeExpose } from './exposeState.svelte';

  // 所有窗口（含最小化）做成卡片网格；点一张 → 还原+聚焦该窗、关闭任务视图。
  function pick(id: string) {
    restore(id);
    closeExpose();
  }
</script>

{#if expose.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10000] overflow-auto bg-black/45 p-8 backdrop-blur-md"
    onpointerdown={closeExpose}
  >
    <div class="mb-4 text-center text-xs uppercase tracking-[0.3em] text-white/70">任务视图 · 点窗口切换 · Esc 退出</div>
    {#if processes.length === 0}
      <div class="grid h-[60vh] place-items-center text-sm text-white/60">没有打开的窗口</div>
    {:else}
      <div
        class="mx-auto grid max-w-5xl gap-4"
        style="grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));"
      >
        {#each processes as p (p.id)}
          {@const def = resolveAppDef(p.appId)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button
            class="group flex aspect-[16/10] flex-col overflow-hidden rounded-xl border border-white/15 bg-qz-surface/80 text-left shadow-xl shadow-black/40 transition-transform hover:scale-[1.03] hover:border-qz-accent"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => pick(p.id)}
          >
            <!-- 标题条 -->
            <div class="flex items-center gap-1.5 border-b border-white/10 bg-black/20 px-2 py-1">
              <span class="text-sm">{def?.icon ?? '🪟'}</span>
              <span class="min-w-0 flex-1 truncate text-xs text-qz-text">{p.title || def?.title || p.appId}</span>
              {#if p.minimized}<span class="shrink-0 rounded bg-white/15 px-1 text-[9px] text-white/70">最小化</span>{/if}
            </div>
            <!-- 缩略主体（图标占位，非实时像素） -->
            <div class="grid flex-1 place-items-center">
              <span class="text-4xl opacity-80 transition-transform group-hover:scale-110">{def?.icon ?? '🪟'}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
