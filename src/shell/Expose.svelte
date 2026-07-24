<script lang="ts">
  import { processes, restore } from '../kernel/processes.svelte';
  import { resolveAppDef } from '../apps/desktopApps.svelte';
  import { expose, closeExpose } from './exposeState.svelte';
  import { appIconName } from '../lib/icons';
  import { fitThumb } from './exposeThumb';
  import Icon from '../lib/Icon.svelte';

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
    <div class="mb-4 text-center text-xs tracking-wider text-white/70">任务视图 · 点窗口切换 · Esc 退出</div>
    {#if processes.length === 0}
      <div class="grid h-[60vh] place-items-center text-sm text-white/60">没有打开的窗口</div>
    {:else}
      <div
        class="mx-auto grid max-w-5xl gap-4"
        style="grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));"
      >
        {#each processes as p (p.id)}
          {@const def = resolveAppDef(p.appId)}
          {@const icon = appIconName(p.appId)}
          {@const t = fitThumb(p.width, p.height)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button
            class="group flex aspect-[16/10] flex-col overflow-hidden rounded-xl border border-white/15 bg-qz-surface/80 text-left shadow-xl shadow-black/40 transition-transform hover:scale-[1.03] hover:border-qz-accent"
            class:opacity-50={p.minimized}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => pick(p.id)}
          >
            <!-- 标题条：App 图标 + 窗口标题（最小化的带角标） -->
            <div class="flex items-center gap-1.5 border-b border-white/10 bg-black/20 px-2 py-1">
              <span class="text-qz-text"><Icon name={icon} size={14} /></span>
              <span class="min-w-0 flex-1 truncate text-xs text-qz-text">{p.title || def?.title || p.appId}</span>
              {#if p.minimized}<span class="shrink-0 rounded bg-white/15 px-1 text-[10px] text-white/70">已最小化</span>{/if}
            </div>
            <!-- 迷你窗口预览：按真实宽高比等比缩放（标题栏色条 + App 图标，非实时像素） -->
            <div class="grid flex-1 place-items-center p-2">
              <div
                class="flex flex-col overflow-hidden rounded-md border border-white/25 bg-qz-surface shadow-lg shadow-black/30 transition-transform group-hover:scale-105"
                style="width: {t.w}px; height: {t.h}px;"
              >
                <div class="h-[16%] min-h-[6px] w-full shrink-0 bg-qz-accent/80"></div>
                <div class="grid min-h-0 flex-1 place-items-center text-qz-text/70">
                  <Icon name={icon} size={Math.max(10, Math.round(Math.min(t.w, t.h) * 0.35))} strokeWidth={1.5} />
                </div>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
