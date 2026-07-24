<script lang="ts">
  // M5.3 移动 Home 屏幕：壁纸上方 4 列 App 图标网格 + 底部 Dock 托盘（dockPrefs 排序前 4 + 在跑点）。
  // 始终挂在窗口层之下：有窗口打开时被铺满窗口盖住，全部最小化即「回主屏」。
  import { processes, restore, minimizeApp, closeApp } from '../../kernel/processes.svelte';
  import { type AppDef } from '../../apps/registry';
  import { C } from '../../apps/appList';
  import { visibleAppDefs, launchAppDef } from '../../apps/desktopApps.svelte';
  import { sortDockApps, isPinned, pinApp, unpinApp } from '../../system/dockPrefs.svelte';
  import { openMenuAt, type MenuItem } from '../menu.svelte';
  import { LONG_PRESS_MS, longPressCancelled } from './gesture';
  import Icon from '../../lib/Icon.svelte';
  import { appIconName } from '../../lib/icons';

  const running = $derived(new Set(processes.map((p) => p.appId)));
  const apps = $derived(visibleAppDefs());
  // 托盘：Dock 偏好排序后的前 4 个
  const trayApps = $derived(sortDockApps(visibleAppDefs(), running).slice(0, 4));

  // 点击图标：没在跑 → 启动；在跑 → 还原最上层那个窗口（与 Dock 手感一致）
  function onTap(app: AppDef) {
    if (menuFired) {
      menuFired = false; // 长按已开菜单 → 吞掉随之而来的 click
      return;
    }
    const mine = processes.filter((p) => p.appId === app.id);
    if (mine.length === 0) {
      launchAppDef(app);
    } else {
      restore(mine.reduce((a, b) => (a.z >= b.z ? a : b)).id);
    }
  }

  // ── M5.8 长按菜单：按住 ≥500ms 且无超容差位移 → 唤起全局 ContextMenu（桌面右键同款项）。
  // 位移/抬起/取消都清计时；菜单项与 Dock 右键同语义（打开/窗口操作/固定·移除）。
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressX = 0;
  let pressY = 0;
  let menuFired = false;

  function appMenuItems(app: AppDef): MenuItem[] {
    const items: MenuItem[] = [{ label: '打开', icon: '↗', onClick: () => onTap(app) }];
    if (running.has(app.id)) {
      items.push({ label: '最小化全部', icon: '—', separator: true, onClick: () => minimizeApp(app.id) });
      items.push({ label: '关闭全部', icon: '✕', danger: true, onClick: () => closeApp(app.id) });
    }
    if (isPinned(app.id)) {
      items.push({ label: '从 Dock 移除', icon: '📌', separator: true, onClick: () => unpinApp(app.id) });
    } else {
      items.push({ label: '固定到 Dock', icon: '📌', separator: true, onClick: () => pinApp(app.id) });
    }
    return items;
  }

  function pressStart(e: PointerEvent, app: AppDef) {
    pressX = e.clientX;
    pressY = e.clientY;
    const x = e.clientX;
    const y = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = undefined;
      menuFired = true;
      openMenuAt(x, y, appMenuItems(app));
    }, LONG_PRESS_MS);
  }
  function pressMove(e: PointerEvent) {
    if (pressTimer && longPressCancelled(e.clientX - pressX, e.clientY - pressY)) cancelPress();
  }
  function cancelPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = undefined;
    }
  }
</script>

{#snippet iconTile(app: AppDef)}
  <button
    class="group flex w-full flex-col items-center gap-1.5"
    title={app.title}
    onclick={() => onTap(app)}
    onpointerdown={(e) => pressStart(e, app)}
    onpointermove={pressMove}
    onpointerup={cancelPress}
    onpointercancel={cancelPress}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <!-- M9.1 收尾：per-app 五色相底板（app.color），缺省石墨；圆角/边框/阴影/按压缩放保持移动端既有风格 -->
    <span
      class="relative grid h-14 w-14 place-items-center rounded-[1.1rem] border border-white/20 text-white shadow-lg shadow-black/30 transition-transform group-active:scale-90"
      style="background: {app.color ?? C.graphite};"
    >
      <Icon name={appIconName(app.id)} size={26} strokeWidth={1.8} />
      {#if running.has(app.id)}
        <span class="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/90"></span>
      {/if}
    </span>
    <span class="line-clamp-2 w-full text-center text-[11px] leading-tight text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
      {app.title}
    </span>
  </button>
{/snippet}

<!-- 主屏：顶部让出状态栏（44px + safe-area），底部让出 Home Indicator 区 -->
<div
  class="absolute inset-0 flex flex-col overflow-hidden px-5 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] pt-[calc(env(safe-area-inset-top)+3.5rem)]"
>
  <!-- App 图标网格（4 列） -->
  <div class="grid min-h-0 flex-1 auto-rows-min grid-cols-4 content-start gap-x-3 gap-y-5 overflow-y-auto py-2">
    {#each apps as app (app.id)}
      {@render iconTile(app)}
    {/each}
  </div>

  <!-- Dock 托盘：前 4 个 + 在跑指示点 -->
  <div
    class="mx-auto flex w-full max-w-xs items-center justify-around rounded-[1.75rem] border border-qz-border qz-glass qz-glass-float px-3 py-2.5"
  >
    {#each trayApps as app (app.id)}
      <button
        class="group relative grid h-14 w-14 place-items-center rounded-[1.1rem] border border-white/20 text-white shadow-lg shadow-black/30 transition-transform active:scale-90"
        style="background: {app.color ?? C.graphite};"
        title={app.title}
        onclick={() => onTap(app)}
        onpointerdown={(e) => pressStart(e, app)}
        onpointermove={pressMove}
        onpointerup={cancelPress}
        onpointercancel={cancelPress}
        oncontextmenu={(e) => e.preventDefault()}
      >
        <Icon name={appIconName(app.id)} size={26} strokeWidth={1.8} />
        {#if running.has(app.id)}
          <span class="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/90"></span>
        {/if}
      </button>
    {/each}
  </div>
</div>
