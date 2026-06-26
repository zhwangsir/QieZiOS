<script lang="ts">
  import { fade } from 'svelte/transition';
  import { processes, restore, minimizeApp, closeApp } from '../kernel/processes.svelte';
  import { type AppDef } from '../apps/registry';
  import { visibleAppDefs, launchAppDef } from '../apps/desktopApps.svelte';
  import { viewport } from '../system/viewport.svelte';
  import { openMenu, type MenuItem } from './menu.svelte';
  import {
    sortDockApps,
    isPinned,
    pinApp,
    unpinApp,
    moveDockApp,
    dragReorder,
    resetDock,
  } from '../system/dockPrefs.svelte';

  // $derived：当前有进程在跑的 appId 集合（显示小圆点）
  const running = $derived(new Set(processes.map((p) => p.appId)));
  // 可见 App（内置非 hidden + 已装用户 App），按 Dock 偏好排序 + 过滤取消固定的
  const apps = $derived(sortDockApps(visibleAppDefs(), running));

  // 鼠标悬停在第几个图标上（用于放大「波浪」效果）
  let hovered = $state<number | null>(null);
  // 正在拖拽重排的 appId（null = 没在拖）
  let dragId = $state<string | null>(null);

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
    const ids = apps.map((a) => a.id);
    const i = ids.indexOf(app.id);
    const items: MenuItem[] = [
      { label: '打开新窗口', icon: '➕', onClick: () => launchAppDef(app) },
    ];
    if (processes.some((p) => p.appId === app.id)) {
      items.push({ label: '最小化全部', icon: '—', separator: true, onClick: () => minimizeApp(app.id) });
      items.push({ label: '关闭全部', icon: '✕', danger: true, onClick: () => closeApp(app.id) });
    }
    // 排序：左移/右移（到头则禁用）
    if (i > 0) items.push({ label: '左移', icon: '◀', separator: true, onClick: () => moveDockApp(ids, app.id, -1) });
    if (i >= 0 && i < ids.length - 1)
      items.push({ label: '右移', icon: '▶', separator: i === 0, onClick: () => moveDockApp(ids, app.id, 1) });
    // 固定 / 取消固定
    if (isPinned(app.id))
      items.push({ label: '从 Dock 移除', icon: '📌', separator: true, onClick: () => unpinApp(app.id) });
    else
      items.push({ label: '固定到 Dock', icon: '📌', separator: true, onClick: () => pinApp(app.id) });
    items.push({ label: '重置 Dock 布局', icon: '↺', onClick: resetDock });
    openMenu(e, items);
  }

  // ── 拖拽重排（HTML5 native drag）。pointer 悬停放大与 draggable 不冲突。
  function onDragStart(e: DragEvent, app: AppDef) {
    dragId = app.id;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    hovered = null; // 拖拽时不要放大动效
  }
  function onDragOver(e: DragEvent) {
    if (dragId) e.preventDefault(); // 允许 drop
  }
  function onDrop(e: DragEvent, app: AppDef) {
    e.preventDefault();
    if (dragId && dragId !== app.id) dragReorder(apps.map((a) => a.id), dragId, app.id);
    dragId = null;
  }
</script>

<div
  class="absolute bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-end gap-2 rounded-2xl border border-qz-border qz-glass px-3 py-2 shadow-2xl shadow-black/40"
  class:max-w-[94vw]={viewport.isMobile}
  class:overflow-x-auto={viewport.isMobile}
  role="toolbar"
  tabindex="-1"
  aria-label="程序坞"
  onpointerleave={() => (hovered = null)}
>
  {#each apps as app, i (app.id)}
    <button
      class="group relative grid h-12 w-12 place-items-center rounded-xl text-2xl"
      class:opacity-40={dragId === app.id}
      style="transform: scale({scaleFor(i)}); transform-origin: bottom; transition: transform 150ms var(--qz-ease);"
      title={app.title}
      draggable="true"
      ondragstart={(e) => onDragStart(e, app)}
      ondragover={onDragOver}
      ondrop={(e) => onDrop(e, app)}
      ondragend={() => (dragId = null)}
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
