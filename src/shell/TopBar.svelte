<script lang="ts">
  import {
    processes,
    minimize,
    restore,
    close,
    toggleMaximize,
    activeId,
    type Process,
  } from '../kernel/processes.svelte';
  import { resolveAppDef } from '../apps/desktopApps.svelte';
  import { settings } from '../system/settings.svelte';
  import { resolvedMode, toggleTheme } from '../system/theme.svelte';
  import QuickSettings from './QuickSettings.svelte';
  import Icon from '../lib/Icon.svelte';
  import {
    noteHistory,
    unreadCount,
    markNotesSeen,
    clearHistory,
    removeFromHistory,
    removeSourceFromHistory,
    type NoteLevel,
  } from '../system/notifications.svelte';
  import { groupBySource } from '../lib/notegroup';
  import { openLaunchpad } from './launchpadState.svelte';
  import { openMenu, openMenuAt } from './menu.svelte';
  import { sys } from '../system/sys';
  import {
    buildSystemMenu,
    buildAppMenu,
    askShutdown,
    lock,
    type SystemMenuActions,
    type AppMenuActions,
  } from '../system/session.svelte';

  // 当前活动窗 id（内核统一计算，键盘/焦点高亮/任务栏共用同一份逻辑）
  const activeWin = $derived(activeId());
  // 活动窗进程（U8 App 菜单按钮标题用；无活动窗 = 桌面）
  const activeProc = $derived(processes.find((p) => p.id === activeWin) ?? null);

  // ── U8 系统菜单（🍆 下拉 = macOS  菜单位）──
  const sysMenuActions: SystemMenuActions = {
    about: () => sys.openApp('sysmon'), // 关于本机 → 任务管理器概况（DEVPLAN U7）
    launchpad: openLaunchpad,
    lock,
    sleep: lock, // Web 无真睡眠：简化为锁定
    restart: () => location.reload(),
    shutdown: askShutdown, // 先弹确认框（App.svelte 渲染），确认后才黑屏
  };
  function onSystemMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenuAt(r.left, r.bottom + 6, buildSystemMenu(sysMenuActions));
  }

  // ── U8 活动 App 菜单（macOS 粗体 App 名位；无声明 menus 的 App 回退窗口操作）──
  const appMenuActions: AppMenuActions = {
    aboutApp: () => sys.openApp('sysmon'), // 关于<App>/关于本机 统一进任务管理器概况
    closeActive: () => {
      const id = activeId();
      if (id) close(id);
    },
    minimizeAll: () => {
      for (const p of processes) minimize(p.id);
    },
    hideOthers: () => {
      const id = activeId();
      for (const p of processes) if (p.id !== id) minimize(p.id);
    },
  };
  function onAppMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenuAt(
      r.left,
      r.bottom + 6,
      buildAppMenu(
        activeProc ? { title: activeProc.title, appId: activeProc.appId } : null,
        appMenuActions,
        // M12.2 App 级菜单：活动 App 在注册表声明了 menus 就插进「关于」与窗口操作之间
        activeProc ? resolveAppDef(activeProc.appId)?.menus : undefined,
      ),
    );
  }

  function onChip(p: Process) {
    if (activeWin === p.id) {
      minimize(p.id); // 点当前活动窗 → 收起
    } else {
      restore(p.id); // 否则 → 还原 + 聚焦置顶
    }
  }

  // 任务栏 chip 右键菜单（与 Dock/Window 标题栏一致：能直接关/最小化/最大化，不必先切到它）
  function onChipMenu(e: MouseEvent, p: Process) {
    openMenu(e, [
      p.minimized
        ? { label: '还原', icon: '▢', onClick: () => restore(p.id) }
        : { label: '最小化', icon: '—', onClick: () => minimize(p.id) },
      { label: p.maximized ? '还原大小' : '最大化', icon: '▣', onClick: () => toggleMaximize(p.id) },
      { label: '关闭', icon: '✕', danger: true, separator: true, onClick: () => close(p.id) },
    ]);
  }

  // 实时时钟
  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t); // effect 清理函数：组件销毁时清掉定时器，避免泄漏
  });
  const clock = $derived(
    now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
  );

  // 系统托盘：通知中心
  let trayOpen = $state(false);
  let trayEl = $state<HTMLElement>();
  const unread = $derived(unreadCount());
  function toggleTray() {
    trayOpen = !trayOpen;
    if (trayOpen) markNotesSeen(); // 打开即标记已读 → 角标清零
  }
  // 点托盘外部 → 关闭
  function onWindowClick(e: MouseEvent) {
    if (trayOpen && trayEl && !trayEl.contains(e.target as Node)) trayOpen = false;
  }

  // 点一下设成「当前外观的反面」的显式模式（从 auto/schedule 切到固定 明/暗）
  function toggleMode() {
    toggleTheme();
  }

  // M19 通知中心 macOS 化：按来源 App 分组（组内新→旧，组间按组内最新排序，groupBySource 自理）
  const noteGroups = $derived(groupBySource(noteHistory.items));

  // 通知等级 → 左侧竖条颜色
  const levelColor: Record<NoteLevel, string> = {
    info: 'var(--color-qz-accent)',
    success: '#10b981',
    warn: '#f59e0b',
    error: '#ef4444',
  };
  function fmtTime(ts: number): string {
    const d = now.getTime() - ts;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return `${Math.floor(d / 60000)} 分前`;
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
</script>

<svelte:window onclick={onWindowClick} />

<!-- M9.3 顶栏透明融入壁纸（macos27 Tahoe 式）：去磨砂/去分隔线，只留顶部微暗渐变
     保证文字在浅色壁纸上也可读（无 backdrop-blur → 真正透出壁纸）。
     高度 h-9→h-8（32px）向 macOS 24px 菜单栏靠拢；窗口层 top-9 同步改 top-8。
     M39 修复：前景强制白色系——顶栏是「壁纸叠加层」，不能随主题亮色变深，
     否则亮模式 + 深色壁纸下文字/图标全灭（时钟原本就硬编码 text-white/85，对齐同语义）；
     下拉面板（通知中心/控制中心）在各自面板根重置回主题前景色。 -->
<div
  class="absolute inset-x-0 top-0 z-[9998] flex h-8 items-center gap-2 px-3 text-white/90"
  style="background: linear-gradient(rgb(0 0 0 / 0.18), rgb(0 0 0 / 0)); text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);"
>
  <button
    class="grid h-6 w-6 select-none place-items-center rounded text-sm hover:bg-white/15"
    title="系统菜单"
    onclick={onSystemMenu}>🍆</button>

  <!-- U8 活动 App 菜单：粗体 App 名（无活动窗 = 桌面），下拉窗口操作 -->
  <button
    class="flex h-6 max-w-40 select-none items-center truncate rounded px-2 text-xs font-semibold hover:bg-white/15"
    title="应用菜单"
    onclick={onAppMenu}>{activeProc?.title ?? '桌面'}</button>

  <!-- 窗口切换 chips：一个窗口一个 -->
  <div class="flex flex-1 items-center gap-1.5 overflow-hidden">
    {#each processes as p (p.id)}
      {@const icon = resolveAppDef(p.appId)?.icon ?? '▫'}
      {@const isActive = activeWin === p.id}
      <button
        class="flex min-w-0 max-w-40 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors"
        class:opacity-50={p.minimized}
        style="border-color: {isActive ? 'rgb(255 255 255 / 0.25)' : 'transparent'};
               background: {isActive
          ? 'color-mix(in srgb, var(--color-qz-accent) 38%, transparent)'
          : 'rgb(0 0 0 / 0.15)'};"
        title={p.title}
        onclick={() => onChip(p)}
        oncontextmenu={(e) => onChipMenu(e, p)}
      >
        <span class="shrink-0"><Icon name={icon} size={12} /></span>
        <span class="truncate">{p.title}</span>
      </button>
    {/each}
  </div>

  <!-- 系统托盘：明暗切换（一键）-->
  <button
    class="grid h-6 w-6 place-items-center rounded hover:bg-white/15"
    title="切换明暗"
    onclick={toggleMode}><Icon name={resolvedMode() === 'dark' ? 'Moon' : 'Sun'} size={14} /></button>

  <!-- 快捷设置面板：外观/勿扰/声音/主色/壁纸 -->
  <QuickSettings />

  <!-- 通知中心铃铛 -->
  <div class="relative" bind:this={trayEl}>
    <button
      class="relative grid h-6 w-6 place-items-center rounded hover:bg-white/15"
      title="通知中心"
      onclick={toggleTray}
    >
      <Icon name="Bell" size={14} />
      {#if unread > 0}
        <span
          class="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full px-0.5 text-[9px] font-bold leading-none text-white"
          style="background: #ef4444;">{unread > 9 ? '9+' : unread}</span>
      {/if}
    </button>

    {#if trayOpen}
      <!-- M39：面板有自己的玻璃底板 → 前景/文字阴影重置回主题语义（顶栏白色前景仅服务于壁纸叠加层） -->
      <div
        class="absolute right-0 top-full z-[9999] mt-1.5 flex max-h-96 w-80 flex-col overflow-hidden rounded-qz border border-qz-border text-qz-text qz-glass qz-glass-float"
        style="text-shadow: none;"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-qz-border px-3 py-2">
          <span class="text-xs font-semibold">通知中心</span>
          {#if noteHistory.items.length}
            <button class="rounded px-1.5 py-0.5 text-[11px] text-qz-muted hover:bg-qz-elevated" onclick={clearHistory}>清空</button>
          {/if}
        </div>
        <div class="min-h-0 flex-1 overflow-auto px-1.5 py-1">
          {#if noteHistory.items.length === 0}
            <div class="grid place-items-center px-4 py-8 text-center text-xs text-qz-muted">
              <div class="mb-1"><Icon name="BellOff" size={28} strokeWidth={1.5} /></div>
              <div>暂无通知</div>
            </div>
          {:else}
            {#each noteGroups as g (g.source)}
              <div class="group/g mt-1.5 first:mt-0">
                <!-- 组头：来源名 + 数量 + 悬停出现「清除该组」（macOS 通知中心式） -->
                <div class="flex items-center justify-between px-1.5 pb-0.5">
                  <span class="text-[10px] font-semibold text-qz-muted">{g.source} · {g.items.length}</span>
                  <button
                    class="grid h-4 w-4 place-items-center rounded text-qz-muted opacity-0 transition-opacity hover:bg-qz-elevated group-hover/g:opacity-100"
                    title="清除该组"
                    onclick={() => removeSourceFromHistory(g.source)}
                  ><Icon name="X" size={11} /></button>
                </div>
                {#each g.items as n (n.id)}
                  <div class="group/n flex gap-2 rounded-md px-1.5 py-2 hover:bg-qz-elevated/60">
                    <span class="mt-0.5 w-0.5 shrink-0 self-stretch rounded" style="background: {levelColor[n.level]}"></span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-baseline justify-between gap-2">
                        <span class="truncate text-xs font-medium">{n.title}</span>
                        <span class="flex shrink-0 items-center gap-1">
                          <span class="text-[10px] tabular-nums text-qz-muted">{fmtTime(n.ts)}</span>
                          <button
                            class="grid h-4 w-4 place-items-center rounded text-qz-muted opacity-0 transition-opacity hover:bg-qz-elevated group-hover/n:opacity-100"
                            title="删除此通知"
                            onclick={() => removeFromHistory(n.id)}
                          ><Icon name="X" size={11} /></button>
                        </span>
                      </div>
                      {#if n.body}<div class="mt-0.5 break-words text-[11px] text-qz-muted">{n.body}</div>{/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <span class="select-none text-xs tabular-nums text-white/85">{clock}</span>
</div>
