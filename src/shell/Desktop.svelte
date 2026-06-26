<script lang="ts">
  import {
    processes,
    activeId,
    close,
    minimize,
    cycleWindows,
    closeAll,
    cascade,
    setBounds,
  } from '../kernel/processes.svelte';
  import { createDir, createFile } from '../kernel/vfs.svelte';
  import { sys } from '../system/sys';
  import { resolveAppDef } from '../apps/desktopApps.svelte';
  import { openMenu, closeMenu, menu } from './menu.svelte';
  import { openSpotlight } from './spotlightState.svelte';
  import { shortcuts, openShortcuts, closeShortcuts } from './shortcutsState.svelte';
  import { launchpad, closeLaunchpad } from './launchpadState.svelte';
  import Window from './Window.svelte';
  import Spotlight from './Spotlight.svelte';
  import Shortcuts from './Shortcuts.svelte';
  import Launchpad from './Launchpad.svelte';
  import Dock from './Dock.svelte';
  import TopBar from './TopBar.svelte';
  import Notifications from './Notifications.svelte';
  import DesktopPet from './DesktopPet.svelte';
  import { pet } from '../system/pet.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import DesktopIcons from './DesktopIcons.svelte';
  import { snapState } from './snapState.svelte';

  // 当前活动窗 id（派生）：传给每个 Window 决定是否高亮
  const active = $derived(activeId());

  // 键盘平铺：把活动窗吸到左半/右半/最大化/还原（几何用窗口层尺寸算，和拖拽吸附一致）
  let winLayer = $state<HTMLElement>();
  function tile(zone: 'left' | 'right' | 'max' | 'restore') {
    const id = activeId();
    if (!id) return;
    if (zone === 'max') return setBounds(id, { maximized: true });
    if (zone === 'restore') return setBounds(id, { maximized: false });
    const layer = winLayer;
    if (!layer) return;
    const W = layer.clientWidth;
    const H = layer.clientHeight;
    const half = Math.round(W / 2);
    const rect = zone === 'left' ? { x: 0, y: 0, width: half, height: H } : { x: W - half, y: 0, width: W - half, height: H };
    setBounds(id, { maximized: false, ...rect });
  }

  // 桌面空白处右键菜单（窗口内的右键由窗口/App 自己处理）
  function onDesktopMenu(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-window]')) return;
    openMenu(e, [
      { label: '新建文件夹', icon: '📁', onClick: () => createDir('root') },
      { label: '新建文本文件', icon: '📄', onClick: () => createFile('root') },
      { label: '打开设置', icon: '⚙️', separator: true, onClick: () => sys.openApp('settings') },
      {
        label: pet.enabled ? '隐藏桌宠' : '显示桌宠',
        icon: '🧚',
        separator: true,
        onClick: () => (pet.enabled = !pet.enabled),
      },
      { label: '层叠窗口', icon: '🗂️', onClick: cascade },
      { label: '关闭所有窗口', icon: '✕', danger: true, onClick: closeAll },
      { label: '键盘快捷键 (?)', icon: '⌨️', separator: true, onClick: openShortcuts },
    ]);
  }

  // 全局快捷键。注意：在输入框/可编辑区里打字时不拦截。
  function onKey(e: KeyboardEvent) {
    // 菜单开着时，Esc 先关菜单
    if (menu.open) {
      if (e.key === 'Escape') closeMenu();
      return;
    }
    // 快捷键速查开着时，Esc 或 ? 关掉它，吞掉其它快捷键
    if (shortcuts.open) {
      if (e.key === 'Escape' || e.key === '?') closeShortcuts();
      return;
    }
    // Launchpad 开着时，Esc 关掉（搜索输入照常用 input 事件，键盘其它快捷键吞掉）
    if (launchpad.open) {
      if (e.key === 'Escape') closeLaunchpad();
      return;
    }
    // Ctrl/Cmd+K 打开命令面板（即使焦点在输入框也响应）
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
      openSpotlight();
      e.preventDefault();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    if (e.key === '?') {
      openShortcuts();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      const id = activeId();
      if (id) close(id);
    } else if ((e.key === 'm' || e.key === 'M') && (e.ctrlKey || e.metaKey)) {
      const id = activeId();
      if (id) { minimize(id); e.preventDefault(); }
    } else if (e.key === '`' && (e.altKey || e.ctrlKey)) {
      cycleWindows();
      e.preventDefault();
    } else if (e.ctrlKey && e.altKey && e.key.startsWith('Arrow')) {
      // Ctrl+Alt+方向键 平铺活动窗：←左半 →右半 ↑最大化 ↓还原
      const zone = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'max', ArrowDown: 'restore' } as const)[
        e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
      ];
      if (zone) { tile(zone); e.preventDefault(); }
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- 桌面外壳：壁纸（吃 token）+ 顶栏 + 窗口层 + Dock -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative h-full w-full overflow-hidden"
  style="background: var(--qz-wallpaper)"
  oncontextmenu={onDesktopMenu}
>
  <!-- 景深 vignette：壁纸四周/底部压暗一点，更有层次（不挡交互） -->
  <div
    class="pointer-events-none absolute inset-0"
    style="background: radial-gradient(125% 85% at 50% 0%, transparent 55%, rgb(0 0 0 / 0.22));"
  ></div>

  <!-- 中央 logo（不挡交互） -->
  <div class="pointer-events-none absolute inset-0 grid place-items-center">
    <div class="select-none text-center text-qz-text/15">
      <div class="mb-2 text-7xl">🍆</div>
      <div class="text-lg tracking-[0.4em]">QieZiOS</div>
    </div>
  </div>

  <!-- 桌面图标（VFS 根目录的项；在窗口层之下） -->
  <DesktopIcons />

  <TopBar />

  <!-- 窗口层：top-9 让出顶栏高度；isolate 把窗口的 z-index 关进自己的层叠上下文，
       不会盖过顶栏/Dock。遍历进程 → 按 appId 查注册表拿组件 → 塞进窗口渲染。 -->
  <div class="absolute inset-x-0 bottom-0 top-9 isolate" bind:this={winLayer}>
    {#each processes as proc (proc.id)}
      {@const def = resolveAppDef(proc.appId)}
      <Window {proc} active={active === proc.id}>
        {#if def?.component}
          {@const App = def.component}
          <App data={proc.data} pid={proc.pid} />
        {:else}
          <div class="grid h-full place-items-center text-sm text-qz-muted">App 不存在或已卸载</div>
        {/if}
      </Window>
    {/each}

    <!-- 边缘吸附预览框：拖窗到边缘时出现，提示松手后窗口会落到哪里 -->
    {#if snapState.preview}
      <div
        class="pointer-events-none absolute left-0 top-0 z-[9000] rounded-qz border-2 transition-[transform,width,height] duration-100"
        style="transform: translate({snapState.preview.x}px, {snapState.preview.y}px);
               width: {snapState.preview.w}px; height: {snapState.preview.h}px;
               border-color: var(--color-qz-accent);
               background: color-mix(in srgb, var(--color-qz-accent) 16%, transparent);"
      ></div>
    {/if}
  </div>

  <Dock />

  <!-- 右键菜单（全局单例，谁右键就显示谁的菜单） -->
  <ContextMenu />

  <!-- 命令面板（Ctrl/Cmd+K） -->
  <Spotlight />

  <!-- 键盘快捷键速查（? 唤起） -->
  <Shortcuts />

  <!-- Launchpad 全 App 网格（点顶栏 🍆 唤起） -->
  <Launchpad />

  <!-- 系统通知 toast 层（通知中心服务驱动） -->
  <Notifications />

  <!-- Live2D 桌面浮层桌宠（可拖/可关） -->
  <DesktopPet />
</div>
