<script lang="ts">
  import { processes, minimize, restore, activeId, type Process } from '../kernel/processes.svelte';
  import { resolveAppDef } from '../apps/desktopApps.svelte';

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
</script>

<div
  class="absolute inset-x-0 top-0 z-[9998] flex h-9 items-center gap-2 border-b border-qz-border qz-glass px-3"
>
  <span class="select-none text-sm">🍆</span>

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

  <span class="select-none text-xs tabular-nums text-qz-muted">{clock}</span>
</div>
