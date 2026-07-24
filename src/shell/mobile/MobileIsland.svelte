<script lang="ts">
  // M5.7 灵动岛等价物：顶部常驻黑色胶囊（硬件岛观感），
  // sys.notify 事件流（= notifications.items，与桌面 toast 同一数据源）来通知时
  // 胶囊展开成活动卡片：等级色点 + 标题/副标题 + 可选操作；通知自动消隐后收回胶囊。
  // 勿扰在 pushNote 上游已拦截（不进 items）→ 岛上同样不弹，逻辑免重复。
  import { scale } from 'svelte/transition';
  import { notifications, dismissNote, type NoteLevel } from '../../system/notifications.svelte';
  import { viewport } from '../../system/viewport.svelte';

  const dur = $derived(viewport.reducedMotion ? 0 : 1);
  // 最新一条活动通知（items 自带 timeout 自动 dismiss → 岛的 ttl 免维护）
  const latest = $derived(notifications.items[notifications.items.length - 1]);

  // 与桌面 toast 一致的等级色
  const accent: Record<NoteLevel, string> = {
    info: 'var(--color-qz-accent)',
    success: '#22c55e',
    warn: '#f59e0b',
    error: '#ef4444',
  };
</script>

<div
  class="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.375rem)] z-[9999] -translate-x-1/2"
>
  {#if latest}
    <!-- 展开态：活动胶囊卡片（点击卡片关闭；操作键单独响应，结构镜像桌面 toast） -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pointer-events-auto flex h-14 max-w-[82vw] items-center gap-2.5 rounded-full bg-black/90 pl-3.5 pr-4 text-left shadow-xl shadow-black/40 backdrop-blur-md"
      in:scale={{ start: 0.6, duration: 220 * dur }}
      out:scale={{ start: 0.6, duration: 160 * dur }}
      title="点击关闭"
      onclick={() => dismissNote(latest.id)}
    >
      <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {accent[latest.level]}"></span>
      <span class="min-w-0">
        <span class="block truncate text-[13px] font-medium text-white">{latest.title}</span>
        {#if latest.body}
          <span class="block truncate text-[11px] text-white/65">{latest.body}</span>
        {/if}
      </span>
      {#if latest.action}
        <button
          class="ml-1 shrink-0 rounded-full bg-qz-accent px-2.5 py-1 text-[11px] font-medium text-qz-accent-contrast active:scale-95"
          onclick={(e) => {
            e.stopPropagation();
            latest.action?.run();
            dismissNote(latest.id);
          }}>{latest.action.label}</button>
      {/if}
    </div>
  {:else}
    <!-- 空闲态：硬件岛小黑条 -->
    <div class="h-7 w-28 rounded-full bg-black shadow-md shadow-black/30" in:scale={{ start: 1.4, duration: 180 * dur }}></div>
  {/if}
</div>
