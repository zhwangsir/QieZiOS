<script lang="ts">
  import { fade } from 'svelte/transition';
  import { processes, restore, minimizeApp, closeApp } from '../kernel/processes.svelte';
  import { type AppDef } from '../apps/registry';
  import { visibleAppDefs, launchAppDef } from '../apps/desktopApps.svelte';
  import { openMenu, type MenuItem } from './menu.svelte';

  // $derived：当前有进程在跑的 appId 集合（显示小圆点）
  const running = $derived(new Set(processes.map((p) => p.appId)));
  // 可见 App（内置非 hidden + 已装用户 App）
  const apps = $derived(visibleAppDefs());

  // 鼠标悬停在第几个图标上（用于放大「波浪」效果）
  let hovered = $state<number | null>(null);

  // 离悬停点越近放得越大（macOS Dock 手感）
  function scaleFor(i: number): number {
    if (hovered === null) return 1;
    const d = Math.abs(i - hovered);
    return d === 0 ? 1.4 : d === 1 ? 1.2 : d === 2 ? 1.06 : 1;
  }

  function onClick(app: AppDef) {
    const mine = processes.filter((p) => p.appId === app.id);
    if (mine.length === 0) {
      launchAppDef(app);
    } else {
      restore(mine.reduce((a, b) => (a.z >= b.z ? a : b)).id);
    }
  }

  function onMenu(e: MouseEvent, app: AppDef) {
    const items: MenuItem[] = [
      { label: '打开新窗口', icon: '➕', onClick: () => launchAppDef(app) },
    ];
    if (processes.some((p) => p.appId === app.id)) {
      items.push({ label: '最小化全部', icon: '—', separator: true, onClick: () => minimizeApp(app.id) });
      items.push({ label: '关闭全部', icon: '✕', danger: true, onClick: () => closeApp(app.id) });
    }
    openMenu(e, items);
  }
</script>

<div
  class="absolute bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-end gap-2 rounded-2xl border border-qz-border qz-glass px-3 py-2 shadow-2xl shadow-black/40"
  role="toolbar"
  tabindex="-1"
  aria-label="程序坞"
  onpointerleave={() => (hovered = null)}
>
  {#each apps as app, i (app.id)}
    <button
      class="group relative grid h-12 w-12 place-items-center rounded-xl text-2xl"
      style="transform: scale({scaleFor(i)}); transform-origin: bottom; transition: transform 150ms var(--qz-ease);"
      title={app.title}
      onpointerenter={() => (hovered = i)}
      onclick={() => onClick(app)}
      oncontextmenu={(e) => onMenu(e, app)}
    >
      {#if hovered === i}
        <span
          class="pointer-events-none absolute -top-9 whitespace-nowrap rounded-md border border-qz-border qz-glass px-2 py-0.5 text-xs text-qz-text shadow-lg"
          transition:fade={{ duration: 120 }}
        >{app.title}</span>
      {/if}
      <span>{app.icon}</span>
      {#if running.has(app.id)}
        <span class="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-qz-text/70"></span>
      {/if}
    </button>
  {/each}
</div>
