<script lang="ts">
  import { fade } from 'svelte/transition';
  import { processes, restore, minimizeApp, closeApp } from '../kernel/processes.svelte';
  import { magnify, trackDockIcon } from '../lib/motion';
  import { type AppDef } from '../apps/registry';
  import { visibleAppDefs, launchAppDef } from '../apps/desktopApps.svelte';
  import { viewport } from '../system/viewport.svelte';
  import Icon from '../lib/Icon.svelte';
  import { openMenu } from './menu.svelte';
  import { buildDockMenu } from './dockMenu';
  import {
    dockPrefs,
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

  // 鼠标悬停在第几个图标上（用于气泡 title）
  let hovered = $state<number | null>(null);
  // U6：指针 x（视口系）驱动高斯放大波形；null = 指针不在 Dock 上
  let mouseX = $state<number | null>(null);
  // 各图标按钮元素（按下标 bind:this 收集），用来量屏幕中心算距离
  let iconEls: HTMLElement[] = [];
  // 正在拖拽重排的 appId（null = 没在拖）
  let dragId = $state<string | null>(null);

  const ICON = 48;          // 图标边长 px（h-12 w-12）
  const SIGMA = ICON * 1.2; // 波形陡度：σ ≈ 图标宽度的 1.2 倍
  const MAX_AMP = 0.5;      // 波峰放大幅度（悬停图标 1.5×）

  // U6 高斯距离衰减波形：离指针越近放得越大（连续函数，无旧阶梯的跳档）。
  // 对称 margin 把放大量摊回布局 → 相邻图标被平滑推开；
  // 自身中心不受自己的对称 margin 影响、邻居被推开 → 距离负反馈，波形稳定不抖。
  // 移动端（触控无悬停）/ 减少动效 / 拖拽重排时不放大。
  function scaleFor(i: number): number {
    if (mouseX === null || dragId || viewport.isMobile || viewport.reducedMotion) return 1;
    const b = iconEls[i];
    if (!b) return 1;
    const r = b.getBoundingClientRect(); // transform-origin:bottom → 水平中心不随 scale 偏移
    return magnify(Math.abs(mouseX - (r.left + r.width / 2)), SIGMA, MAX_AMP);
  }

  // 自动隐藏：平时滑出屏幕底，鼠标进底边热区或 Dock 才滑回。移动端不启用（用横滚 Dock）。
  let revealed = $state(false);
  const autohide = $derived(!!dockPrefs.autohide && !viewport.isMobile);
  const hidden = $derived(autohide && !revealed && !dragId); // 拖拽重排时不收起

  function onClick(app: AppDef) {
    const mine = processes.filter((p) => p.appId === app.id);
    if (mine.length === 0) {
      launchAppDef(app);
    } else {
      restore(mine.reduce((a, b) => (a.z >= b.z ? a : b)).id);
    }
  }

  // M9.2 启动弹跳（macos27 dockLaunch 同款）：仅「新启动」（无进程 → launch）时播放；
  // 已运行只是聚焦不跳。动画加在内层 squircle 上，不与按钮的悬停 scale 抢 transform。
  // 0.62 倍图标高度上跳、600ms、cubic-bezier(0.2,0.6,0.35,1) 还原 macOS 手感。
  function bounce(i: number) {
    if (viewport.isMobile || viewport.reducedMotion) return;
    const tile = iconEls[i]?.querySelector<HTMLElement>('[data-dock-tile]');
    tile?.animate(
      [
        { translate: '0 0' },
        { translate: '0 -30px', offset: 0.35 },
        { translate: '0 0', offset: 0.62 },
        { translate: '0 -12px', offset: 0.8 },
        { translate: '0 0' },
      ],
      { duration: 620, easing: 'cubic-bezier(0.2, 0.6, 0.35, 1)' },
    );
  }

  function onLaunch(app: AppDef, i: number) {
    const isFresh = !processes.some((p) => p.appId === app.id);
    if (isFresh) bounce(i);
    onClick(app);
  }

  // 右键菜单：构建逻辑抽成纯函数 buildDockMenu（见 dockMenu.ts，可单测）
  function onMenu(e: MouseEvent, app: AppDef) {
    const ids = apps.map((a) => a.id);
    openMenu(e, buildDockMenu({
      appId: app.id,
      ids,
      running: processes.some((p) => p.appId === app.id),
      pinned: isPinned(app.id),
      autohide: !!dockPrefs.autohide,
      actions: {
        openNew: () => launchAppDef(app),
        minimizeAll: () => minimizeApp(app.id),
        closeAll: () => closeApp(app.id),
        move: (orderedIds, id, dir) => moveDockApp(orderedIds, id, dir),
        pin: () => pinApp(app.id),
        unpin: () => unpinApp(app.id),
        toggleAutohide: () => (dockPrefs.autohide = !dockPrefs.autohide),
        reset: resetDock,
      },
    }));
  }

  // ── 拖拽重排（HTML5 native drag）。pointer 悬停放大与 draggable 不冲突。
  function onDragStart(e: DragEvent, app: AppDef) {
    dragId = app.id;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    hovered = null; // 拖拽时不要放大动效
    mouseX = null;
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

{#if autohide}
  <!-- 底边热区：Dock 收起时移到这里把它唤出 -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-x-0 bottom-0 z-[9998] h-2" onpointerenter={() => (revealed = true)}></div>
{/if}

<div
  class="absolute bottom-4 left-1/2 z-[9999] flex items-end gap-2 rounded-2xl border border-qz-border qz-glass qz-glass-float px-3 py-2"
  class:max-w-[94vw]={viewport.isMobile}
  class:overflow-x-auto={viewport.isMobile}
  style="transform: translateX(-50%) translateY({hidden ? 'calc(100% + 1.5rem)' : '0'}); transition: transform 250ms var(--qz-ease);"
  role="toolbar"
  tabindex="-1"
  aria-label="程序坞"
  onpointerenter={() => (revealed = true)}
  onpointermove={(e) => { if (!viewport.isMobile) mouseX = e.clientX; }}
  onpointerleave={() => { hovered = null; mouseX = null; if (autohide) revealed = false; }}
>
  {#each apps as app, i (app.id)}
    {@const s = scaleFor(i)}
    <button
      bind:this={iconEls[i]}
      use:trackDockIcon={app.id}
      class="group relative grid h-12 w-12 place-items-center rounded-xl text-2xl"
      class:opacity-40={dragId === app.id}
      style="transform: scale({s}); transform-origin: bottom; margin-inline: {((s - 1) * ICON) / 2}px; transition: transform 140ms var(--qz-ease), margin 140ms var(--qz-ease);"
      title={app.title}
      draggable="true"
      ondragstart={(e) => onDragStart(e, app)}
      ondragover={onDragOver}
      ondrop={(e) => onDrop(e, app)}
      ondragend={() => (dragId = null)}
      onpointerenter={() => (hovered = i)}
      onclick={() => onLaunch(app, i)}
      oncontextmenu={(e) => onMenu(e, app)}
    >
      {#if hovered === i}
        <span
          class="pointer-events-none absolute -top-9 whitespace-nowrap rounded-md border border-qz-border qz-glass px-2 py-0.5 text-xs text-qz-text shadow-lg"
          transition:fade={{ duration: 120 }}
        >{app.title}</span>
      {/if}
      <!-- M9.1 squircle 底板（22.37% 圆角 ≈ Apple 连续曲率）+ 顶部镜面高光 + Lucide 白图标；
           底板色走 appList color token（五色相），缺省石墨 -->
      <span
        data-dock-tile
        class="grid h-11 w-11 place-items-center text-white"
        style="border-radius: 22.37%; background: {app.color ?? 'linear-gradient(135deg, #4b5563 0%, #1f2937 100%)'};
               box-shadow: inset 0 1px 1px rgb(255 255 255 / 0.28), inset 0 -1px 2px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.35);"
      ><Icon name={app.icon} size={22} strokeWidth={1.8} /></span>
      {#if running.has(app.id)}
        <span class="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-qz-text/70"></span>
      {/if}
    </button>
  {/each}
</div>
