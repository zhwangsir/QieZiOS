<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { notifications, dismissNote, type NoteLevel } from '../system/notifications.svelte';

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
    <button
      class="pointer-events-auto w-full rounded-qz border border-qz-border qz-glass px-3 py-2 text-left shadow-xl shadow-black/30"
      style="border-left: 3px solid {accent[n.level]};"
      in:fly={{ x: 24, duration: 180 }}
      out:fade={{ duration: 150 }}
      title="点击关闭"
      onclick={() => dismissNote(n.id)}
    >
      <div class="text-sm font-medium text-qz-text">{n.title}</div>
      {#if n.body}<div class="mt-0.5 text-xs leading-snug text-qz-muted">{n.body}</div>{/if}
    </button>
  {/each}
</div>
