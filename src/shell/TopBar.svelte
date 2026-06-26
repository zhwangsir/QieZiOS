<script lang="ts">
  import { processes, minimize, restore, activeId, type Process } from '../kernel/processes.svelte';
  import { resolveAppDef } from '../apps/desktopApps.svelte';
  import { settings } from '../system/settings.svelte';
  import {
    noteHistory,
    unreadCount,
    markNotesSeen,
    clearHistory,
    type NoteLevel,
  } from '../system/notifications.svelte';
  import { openLaunchpad } from './launchpadState.svelte';

  // 当前活动窗 id（内核统一计算，键盘/焦点高亮/任务栏共用同一份逻辑）
  const activeWin = $derived(activeId());

  function onChip(p: Process) {
    if (activeWin === p.id) {
      minimize(p.id); // 点当前活动窗 → 收起
    } else {
      restore(p.id); // 否则 → 还原 + 聚焦置顶
    }
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

  function toggleMode() {
    settings.mode = settings.mode === 'dark' ? 'light' : 'dark';
  }

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

<div
  class="absolute inset-x-0 top-0 z-[9998] flex h-9 items-center gap-2 border-b border-qz-border qz-glass px-3"
>
  <button
    class="grid h-6 w-6 select-none place-items-center rounded text-sm hover:bg-qz-elevated"
    title="所有 App (Launchpad)"
    onclick={openLaunchpad}>🍆</button>

  <!-- 窗口切换 chips：一个窗口一个 -->
  <div class="flex flex-1 items-center gap-1.5 overflow-hidden">
    {#each processes as p (p.id)}
      {@const icon = resolveAppDef(p.appId)?.icon ?? '▫'}
      {@const isActive = activeWin === p.id}
      <button
        class="flex min-w-0 max-w-40 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors"
        class:opacity-50={p.minimized}
        style="border-color: {isActive ? 'var(--color-qz-border)' : 'transparent'};
               background: {isActive
          ? 'color-mix(in srgb, var(--color-qz-accent) 28%, transparent)'
          : 'transparent'};"
        title={p.title}
        onclick={() => onChip(p)}
      >
        <span class="shrink-0">{icon}</span>
        <span class="truncate">{p.title}</span>
      </button>
    {/each}
  </div>

  <!-- 系统托盘：明暗切换 -->
  <button
    class="grid h-6 w-6 place-items-center rounded text-sm hover:bg-qz-elevated"
    title="切换明暗"
    onclick={toggleMode}>{settings.mode === 'dark' ? '🌙' : '☀️'}</button>

  <!-- 通知中心铃铛 -->
  <div class="relative" bind:this={trayEl}>
    <button
      class="relative grid h-6 w-6 place-items-center rounded text-sm hover:bg-qz-elevated"
      title="通知中心"
      onclick={toggleTray}
    >
      🔔
      {#if unread > 0}
        <span
          class="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full px-0.5 text-[9px] font-bold leading-none text-white"
          style="background: #ef4444;">{unread > 9 ? '9+' : unread}</span>
      {/if}
    </button>

    {#if trayOpen}
      <div
        class="absolute right-0 top-full z-[9999] mt-1.5 flex max-h-96 w-72 flex-col overflow-hidden rounded-qz border border-qz-border qz-glass shadow-2xl shadow-black/40"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-qz-border px-3 py-2">
          <span class="text-xs font-semibold">通知中心</span>
          {#if noteHistory.items.length}
            <button class="rounded px-1.5 py-0.5 text-[11px] text-qz-muted hover:bg-qz-elevated" onclick={clearHistory}>清空</button>
          {/if}
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          {#if noteHistory.items.length === 0}
            <div class="grid place-items-center px-4 py-8 text-center text-xs text-qz-muted">
              <div><div class="mb-1 text-2xl">🔕</div>暂无通知</div>
            </div>
          {:else}
            {#each [...noteHistory.items].reverse() as n (n.id)}
              <div class="flex gap-2 border-b border-qz-border/50 px-3 py-2 last:border-b-0">
                <span class="mt-0.5 w-0.5 shrink-0 self-stretch rounded" style="background: {levelColor[n.level]}"></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="truncate text-xs font-medium">{n.title}</span>
                    <span class="shrink-0 text-[10px] tabular-nums text-qz-muted">{fmtTime(n.ts)}</span>
                  </div>
                  {#if n.body}<div class="mt-0.5 break-words text-[11px] text-qz-muted">{n.body}</div>{/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <span class="select-none text-xs tabular-nums text-qz-muted">{clock}</span>
</div>
