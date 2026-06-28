<script lang="ts">
  import {
    children,
    restoreFromTrash,
    purge,
    emptyTrash,
    TRASH,
    type VNode,
  } from '../kernel/vfs.svelte';
  import { onDestroy } from 'svelte';

  const items = $derived(children(TRASH));

  // 不可逆操作（彻底删除/清空）用「两次点击确认」防误删：首次点变成「确认?」3s，再点才真执行。
  let confirmEmpty = $state(false);
  let confirmPurgeId = $state<string | null>(null);
  let emptyTimer: ReturnType<typeof setTimeout> | undefined;
  let purgeTimer: ReturnType<typeof setTimeout> | undefined;

  function clickEmpty() {
    if (confirmEmpty) {
      clearTimeout(emptyTimer);
      confirmEmpty = false;
      emptyTrash();
      return;
    }
    confirmEmpty = true;
    confirmPurgeId = null; // 互斥
    clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => (confirmEmpty = false), 3000);
  }
  function clickPurge(id: string) {
    if (confirmPurgeId === id) {
      clearTimeout(purgeTimer);
      confirmPurgeId = null;
      purge(id);
      return;
    }
    confirmPurgeId = id;
    confirmEmpty = false; // 互斥
    clearTimeout(purgeTimer);
    purgeTimer = setTimeout(() => (confirmPurgeId = null), 3000);
  }
  onDestroy(() => {
    clearTimeout(emptyTimer);
    clearTimeout(purgeTimer);
  });

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
      class="rounded-md px-2 py-1 text-xs hover:brightness-110 disabled:opacity-40"
      class:bg-qz-elevated={!confirmEmpty}
      class:bg-red-500={confirmEmpty}
      class:text-white={confirmEmpty}
      disabled={items.length === 0}
      onclick={clickEmpty}>{confirmEmpty ? '确认清空？' : '清空回收站'}</button>
  </div>

  <div class="flex-1 overflow-auto p-2">
    {#if items.length === 0}
      <div class="grid h-full place-items-center content-center gap-1 text-center text-qz-muted">
        <div class="text-4xl opacity-50">🗑️</div>
        <div class="text-sm">回收站是空的</div>
        <div class="text-xs">删除的文件会先到这里，可还原或彻底删除</div>
      </div>
    {:else}
      {#each items as n (n.id)}
        <div class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-qz-elevated">
          <span class="text-xl">{iconFor(n)}</span>
          <span class="flex-1 truncate text-sm">{n.name}</span>
          <button
            class="rounded px-2 py-0.5 text-xs text-qz-accent hover:bg-qz-surface"
            onclick={() => restoreFromTrash(n.id)}>还原</button>
          <button
            class="rounded px-2 py-0.5 text-xs hover:bg-qz-surface"
            class:text-red-400={confirmPurgeId !== n.id}
            class:bg-red-500={confirmPurgeId === n.id}
            class:text-white={confirmPurgeId === n.id}
            onclick={() => clickPurge(n.id)}>{confirmPurgeId === n.id ? '确认?' : '彻底删除'}</button>
        </div>
      {/each}
    {/if}
  </div>
</div>
