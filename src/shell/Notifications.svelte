<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { notifications, dismissNote, type NoteLevel } from '../system/notifications.svelte';
  import { viewport } from '../system/viewport.svelte';

  // 尊重「减少动态效果」：关掉进出动画
  const dur = $derived(viewport.reducedMotion ? 0 : 1);

  // 左边一条彩色竖线标示等级
  const accent: Record<NoteLevel, string> = {
    info: 'var(--color-qz-accent)',
    success: '#22c55e',
    warn: '#f59e0b',
    error: '#ef4444',
  };
</script>

<div class="pointer-events-none fixed right-3 top-11 z-[10001] flex w-72 flex-col gap-2">
  {#each notifications.items as n (n.id)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pointer-events-auto w-full rounded-qz border border-qz-border qz-glass px-3 py-2 text-left shadow-xl shadow-black/30"
      style="border-left: 3px solid {accent[n.level]};"
      in:fly={{ x: 24, duration: 180 * dur }}
      out:fade={{ duration: 150 * dur }}
      title="点击关闭"
      onclick={() => dismissNote(n.id)}
    >
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-qz-text">{n.title}</div>
          {#if n.body}<div class="mt-0.5 break-words text-xs leading-snug text-qz-muted">{n.body}</div>{/if}
        </div>
        {#if n.action}
          <button
            class="shrink-0 rounded-md bg-qz-accent px-2 py-1 text-[11px] font-medium text-qz-accent-contrast active:scale-95"
            onclick={(e) => {
              e.stopPropagation();
              n.action?.run();
              dismissNote(n.id);
            }}>{n.action.label}</button>
        {/if}
      </div>
    </div>
  {/each}
</div>
