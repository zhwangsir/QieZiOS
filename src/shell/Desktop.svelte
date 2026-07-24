<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
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
  import { createDir, createFile, vfs } from '../kernel/vfs.svelte';
  import { startServices } from '../kernel/services.svelte';
  import { sys } from '../system/sys';
  import { session, lock, powerConfirm, cancelShutdown, confirmShutdown } from '../system/session.svelte';
  import { resolveAppDef } from '../apps/desktopApps.svelte';
  import { openMenu, closeMenu, menu } from './menu.svelte';
  import { spotlight, openSpotlight } from './spotlightState.svelte';
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
  import { iconPos } from './iconLayout.svelte';
  import { nextWallpaper } from '../system/settings.svelte';
  import StickyNotes from './StickyNotes.svelte';
  import { addNote } from './notes.svelte';
  import Widgets from './Widgets.svelte';
  import { addWidget } from './widgetState.svelte';
  import Expose from './Expose.svelte';
  import { expose, openExpose, closeExpose } from './exposeState.svelte';
  import { snapState } from './snapState.svelte';
  import { matchShortcut } from './keymap';
  import { viewport } from '../system/viewport.svelte';
  import MobileStatusBar from './mobile/MobileStatusBar.svelte';
  import MobileHome from './mobile/MobileHome.svelte';
  import MobileHomeIndicator from './mobile/MobileHomeIndicator.svelte';
  import MobileControlCenter from './mobile/MobileControlCenter.svelte';
  import MobileIsland from './mobile/MobileIsland.svelte';
  import Onboarding from './Onboarding.svelte';
  import { onboarding, onboardPrefs, shouldShowOnboard, openOnboarding, finishOnboarding } from '../system/onboarding.svelte';

  // 开机 init 序列（M3 起从 App 挪到 Desktop）：boot/login 阶段不挂载 Desktop，
  // 服务/通知在首次进入 desktop（移动端首启为 locked）时才启动，不受开机动画影响。
  // 走总线发事件 → 日志/事件检查器都会收到（事件驱动）
  onMount(() => {
    sys.bus.emit('sys.boot');
    sys.bus.emit('sys.mount', { nodes: Object.keys(vfs.nodes).length });
    startServices(); // 启动后台服务（通知中心等）
    if (shouldShowOnboard(onboardPrefs)) {
      // U10 首秀：未完成引导 → 全屏三页引导（取代旧的首启自动开 Welcome 窗）；
      // 引导写在 Desktop onMount（boot/login 之后），不会在开机/登录阶段弹出。
      openOnboarding();
    } else if (processes.length === 0) {
      // 已完成首秀且无会话还原：不再自动开 Welcome（仍可从 Launchpad/Dock 手动打开）
      sys.bus.emit('sys.restore', { count: 0 });
    } else {
      sys.bus.emit('sys.restore', { count: processes.length });
    }
    sys.bus.emit('sys.ready');
    sys.notify('QieZiOS 已就绪', { body: '系统服务已启动', level: 'success', source: '系统' });
  });

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

  // 网格平铺：把所有未最小化的窗口铺成接近正方形的网格（2 个=并排，4 个=田字，依此类推）。
  function tileGrid() {
    const wins = processes.filter((p) => !p.minimized);
    const n = wins.length;
    if (!n || !winLayer) return;
    const W = winLayer.clientWidth;
    const H = winLayer.clientHeight;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const cw = Math.floor(W / cols);
    const ch = Math.floor(H / rows);
    wins.forEach((p, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      setBounds(p.id, { maximized: false, x: c * cw, y: r * ch, width: cw, height: ch });
    });
  }

  // 整理桌面图标：清掉手动拖放的存档位置 → 图标全部回落到自动网格排布（见 DesktopIcons.posOf）。
  function tidyDesktopIcons() {
    iconPos.pos = {};
  }

  // 桌面空白处右键菜单（窗口内的右键由窗口/App 自己处理）
  function onDesktopMenu(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-window]')) return;
    openMenu(e, [
      { label: '新建文件夹', icon: 'Folder', onClick: () => createDir('root') },
      { label: '新建文本文件', icon: 'FileText', onClick: () => createFile('root') },
      { label: '新建便签', icon: 'NotebookPen', onClick: () => addNote() },
      { label: '新建小组件', icon: 'Puzzle', onClick: () => addWidget() },
      { label: '整理桌面图标', icon: 'WandSparkles', separator: true, onClick: tidyDesktopIcons },
      { label: '更换壁纸', icon: 'Image', onClick: nextWallpaper },
      { label: '个性化设置', icon: 'Settings', onClick: () => sys.openApp('settings') },
      {
        // 切换类项用 checked 表达状态（✓ = 桌宠显示中），label 保持稳定不翻转
        label: '桌宠',
        icon: 'Sparkles',
        separator: true,
        checked: pet.enabled,
        onClick: () => (pet.enabled = !pet.enabled),
      },
      { label: '任务视图', icon: 'AppWindow', shortcut: 'F3', onClick: openExpose },
      { label: '平铺窗口', icon: 'LayoutGrid', onClick: tileGrid },
      { label: '层叠窗口', icon: 'Layers', onClick: cascade },
      { label: '关闭所有窗口', icon: 'X', danger: true, onClick: closeAll },
      { label: '键盘快捷键', icon: 'Keyboard', separator: true, shortcut: '?', onClick: openShortcuts },
    ]);
  }

  // 全局快捷键。注意：在输入框/可编辑区里打字时不拦截。
  function onKey(e: KeyboardEvent) {
    // 关机确认框开着：Esc 取消 / Enter 确认，吞掉其它键（防 Esc 误关背后的窗）
    if (powerConfirm.open) {
      if (e.key === 'Escape') cancelShutdown();
      else if (e.key === 'Enter') confirmShutdown();
      return;
    }
    // 锁屏中：一切桌面快捷键吞掉（解锁由 LockScreen 自己接键盘），防 Esc 在锁屏背后关窗
    if (session.phase === 'locked') return;
    // 首秀引导开着：Esc/Enter 完成（=跳过），吞掉其它键（防 Esc 误关引导背后的窗）
    if (onboarding.open) {
      if (e.key === 'Escape' || e.key === 'Enter') finishOnboarding();
      return;
    }
    // Ctrl/Cmd+Q 锁定（macOS 是 Ctrl+Cmd+Q；这里 Ctrl 或 Cmd 都接受）
    if (matchShortcut(e, 'q')) {
      lock();
      e.preventDefault();
      return;
    }
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
    // 任务视图（Exposé）开着时，Esc 或 F3 关掉，吞掉其它键
    if (expose.open) {
      if (e.key === 'Escape' || e.key === 'F3') { closeExpose(); e.preventDefault(); }
      return;
    }
    // 命令面板开着：键盘全交给 Spotlight 自己（搜索/AI 模式各有 Esc/Enter 语义；
    // 不拦会出事故——焦点在面板按钮上时 Esc 会误关背后的活动窗口）
    if (spotlight.open) return;
    // F3 打开任务视图（Exposé 约定键；preventDefault 防浏览器「查找下一个」）
    if (e.key === 'F3') {
      openExpose();
      e.preventDefault();
      return;
    }
    // Ctrl/Cmd+K 打开命令面板（即使焦点在输入框也响应）
    if (matchShortcut(e, 'k')) {
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
    } else if (matchShortcut(e, 'm')) {
      // Ctrl/Cmd+M 最小化活动窗
      const id = activeId();
      if (id) { minimize(id); e.preventDefault(); }
    } else if (matchShortcut(e, 'w')) {
      // M12.1 Ctrl/Cmd+W 关闭活动窗（与顶栏 App 菜单「关闭窗口」同一动作；macOS 惯例）
      const id = activeId();
      if (id) { close(id); e.preventDefault(); }
    } else if (matchShortcut(e, 'h')) {
      // M12.1 Ctrl/Cmd+H 隐藏其他（最小化除活动窗外所有窗；与顶栏 App 菜单「隐藏其他」同一动作）
      const id = activeId();
      for (const p of processes) if (p.id !== id) minimize(p.id);
      e.preventDefault();
    } else if (e.key === '`' && (e.altKey || e.ctrlKey)) {
      cycleWindows();
      e.preventDefault();
    } else if (e.ctrlKey && e.altKey && e.key.startsWith('Arrow')) {
      // Ctrl+Alt+方向键 平铺活动窗：←左半 →右半 ↑最大化 ↓还原
      const zone = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'max', ArrowDown: 'restore' } as const)[
        e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
      ];
      if (zone) { tile(zone); e.preventDefault(); }
    } else if (e.ctrlKey && e.altKey && (e.key === 'g' || e.key === 'G')) {
      // Ctrl+Alt+G 网格平铺所有窗口
      tileGrid();
      e.preventDefault();
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

  <!-- 中央 logo（不挡交互）。M14：🍆 为品牌符号例外（与 TopBar.svelte:157 同款），
       不走 <Icon name="🍆" /> 间接映射——保留裸字符以便设定任意 text-7xl 字号与 opacity/15 透明度。 -->
  <div class="pointer-events-none absolute inset-0 grid place-items-center">
    <div class="select-none text-center text-qz-text/15">
      <div class="mb-2 text-7xl">🍆</div>
      <div class="text-lg tracking-[0.4em]">QieZiOS</div>
    </div>
  </div>

  <!-- 桌面图标（VFS 根目录的项；在窗口层之下）。移动端由 MobileHome 网格替代 -->
  {#if !viewport.isMobile}
    <DesktopIcons />

    <!-- 桌面便签小组件（在窗口层之下、随桌面） -->
    <StickyNotes />

    <!-- 桌面活动小组件（时钟/日历/系统状态；同便签层，窗口层之下） -->
    <Widgets />
  {/if}

  <!-- 移动外壳：iOS 化 Home 屏幕（图标网格 + Dock 托盘，常驻窗口层之下） -->
  {#if viewport.isMobile}
    <MobileHome />
  {/if}

  {#if !viewport.isMobile}
    <TopBar />
  {/if}

  <!-- 窗口层：top-8 让出顶栏高度（移动端让出状态栏+safe-area）；isolate 把窗口的 z-index 关进自己的层叠上下文，
       不会盖过顶栏/Dock。遍历进程 → 按 appId 查注册表拿组件 → 塞进窗口渲染。
       pointer-events-none 让空区点击穿透到下方 Home 图标/桌面图标；窗口自身显式 pointer-events:auto 恢复命中。 -->
  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 isolate {viewport.isMobile
      ? 'top-[calc(env(safe-area-inset-top)+2.75rem)]'
      : 'top-8'}"
    bind:this={winLayer}
  >
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

    <!-- 边缘吸附预览框：拖窗到边缘时出现，提示松手后窗口会落到哪里。
         几何 = 吸附区目标 bounds（与落位共用 zoneBounds 纯函数，像素级一致）；
         出现/消失 150ms 淡入淡出（reducedMotion 归 0），吸附区切换时的形变走 100ms 过渡。 -->
    {#if snapState.preview}
      <div
        class="pointer-events-none absolute left-0 top-0 z-[9000] rounded-qz border-2 border-qz-accent/40 bg-qz-accent/20 transition-[transform,width,height] duration-100"
        style="transform: translate({snapState.preview.x}px, {snapState.preview.y}px);
               width: {snapState.preview.w}px; height: {snapState.preview.h}px;"
        transition:fade={{ duration: viewport.reducedMotion ? 0 : 150 }}
      ></div>
    {/if}
  </div>

  {#if !viewport.isMobile}
    <Dock />
  {/if}

  <!-- 移动外壳悬浮层：状态栏 / 灵动岛 / Home Indicator / 控制中心（锁屏由 App 层统一挂载） -->
  {#if viewport.isMobile}
    <MobileStatusBar />
    <MobileIsland />
    <MobileHomeIndicator />
    <MobileControlCenter />
  {/if}

  <!-- 右键菜单（全局单例，谁右键就显示谁的菜单） -->
  <ContextMenu />

  <!-- 任务视图 Exposé（F3 唤起） -->
  <Expose />

  <!-- 命令面板（Ctrl/Cmd+K） -->
  <Spotlight />

  <!-- 键盘快捷键速查（? 唤起） -->
  <Shortcuts />

  <!-- Launchpad 全 App 网格（点顶栏 🍆 唤起） -->
  <Launchpad />

  <!-- 系统通知 toast 层（通知中心服务驱动）。移动端由灵动岛替代 -->
  {#if !viewport.isMobile}
    <Notifications />
  {/if}

  <!-- Live2D 桌面浮层桌宠（可拖/可关） -->
  <DesktopPet />

  <!-- 首秀引导（U10：仅首启自动开；完成/跳过后不再弹） -->
  <Onboarding />
</div>
