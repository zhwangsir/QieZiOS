<script lang="ts">
  import {
    children,
    restoreFromTrash,
    purge,
    emptyTrash,
    TRASH,
    type VNode,
  } from '../kernel/vfs.svelte';

  const items = $derived(children(TRASH));

  function iconFor(n: VNode): string {
    if (n.type === 'dir') return '📁';
    const ext = n.name.slice(n.name.lastIndexOf('.') + 1).toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
    if (['md', 'markdown'].includes(ext)) return '📝';
    return '📄';
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <div class="flex items-center justify-between border-b border-qz-border px-3 py-2">
    <span class="text-xs text-qz-muted">回收站 · {items.length} 项</span>
    <button
      class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110 disabled:opacity-40"
      disabled={items.length === 0}
      onclick={emptyTrash}>清空回收站</button>
  </div>

  <div class="flex-1 overflow-auto p-2">
    {#if items.length === 0}
      <div class="grid h-full place-items-center text-sm text-qz-muted">🗑️ 回收站是空的</div>
    {:else}
      {#each items as n (n.id)}
        <div class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-qz-elevated">
          <span class="text-xl">{iconFor(n)}</span>
          <span class="flex-1 truncate text-sm">{n.name}</span>
          <button
            class="rounded px-2 py-0.5 text-xs text-qz-accent hover:bg-qz-surface"
            onclick={() => restoreFromTrash(n.id)}>还原</button>
          <button
            class="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-qz-surface"
            onclick={() => purge(n.id)}>彻底删除</button>
        </div>
      {/each}
    {/if}
  </div>
</div>
