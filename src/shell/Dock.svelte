<script lang="ts">
  import { fade } from 'svelte/transition';
  import { processes, launch, restore } from '../kernel/processes.svelte';
  import { appRegistry, type AppDef } from '../apps/registry';

  // $derived：当前有进程在跑的 appId 集合（显示小圆点）
  const running = $derived(new Set(processes.map((p) => p.appId)));
  // 可见 App（过滤掉 hidden，如记事本）
  const apps = $derived(Object.entries(appRegistry).filter(([, a]) => !a.hidden));

  // 鼠标悬停在第几个图标上（用于放大「波浪」效果）
  let hovered = $state<number | null>(null);

  // 离悬停点越近放得越大（macOS Dock 手感）
  function scaleFor(i: number): number {
    if (hovered === null) return 1;
    const d = Math.abs(i - hovered);
    return d === 0 ? 1.4 : d === 1 ? 1.2 : d === 2 ? 1.06 : 1;
  }

  function onClick(appId: string, app: AppDef) {
    const mine = processes.filter((p) => p.appId === appId);
    if (mine.length === 0) {
      launch(appId, app.title, { width: app.width, height: app.height });
    } else {
      restore(mine.reduce((a, b) => (a.z >= b.z ? a : b)).id);
    }
  }
</script>

<div
  class="absolute bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-end gap-2 rounded-2xl border border-qz-border qz-glass px-3 py-2 shadow-2xl shadow-black/40"
  role="toolbar"
  tabindex="-1"
  aria-label="程序坞"
  onpointerleave={() => (hovered = null)}
>
  {#each apps as [appId, app], i (appId)}
    <button
      class="group relative grid h-12 w-12 place-items-center rounded-xl text-2xl"
      style="transform: scale({scaleFor(i)}); transform-origin: bottom; transition: transform 150ms var(--qz-ease);"
      title={app.title}
      onpointerenter={() => (hovered = i)}
      onclick={() => onClick(appId, app)}
    >
      {#if hovered === i}
        <span
          class="pointer-events-none absolute -top-9 whitespace-nowrap rounded-md border border-qz-border qz-glass px-2 py-0.5 text-xs text-qz-text shadow-lg"
          transition:fade={{ duration: 120 }}
        >{app.title}</span>
      {/if}
      <span>{app.icon}</span>
      {#if running.has(appId)}
        <span class="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-qz-text/70"></span>
      {/if}
    </button>
  {/each}
</div>
