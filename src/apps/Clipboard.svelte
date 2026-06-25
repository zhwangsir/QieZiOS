<script lang="ts">
  import { clipboard, clearClipboard } from '../system/clipboard.svelte';
  import { sys } from '../system/sys';

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function reuse(text: string) {
    sys.clipboard.copy(text); // 重新复制 → 置顶 + 写回浏览器剪贴板
    sys.notify('已复制到剪贴板', { level: 'success', timeout: 1500 });
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <div class="flex shrink-0 items-center justify-between border-b border-qz-border px-3 py-2">
    <span class="text-xs text-qz-muted">📋 剪贴板 · {clipboard.items.length}</span>
    {#if clipboard.items.length}
      <button class="rounded px-1.5 py-0.5 text-[11px] text-qz-muted hover:bg-qz-elevated" onclick={clearClipboard}
        >清空</button>
    {/if}
  </div>

  {#if clipboard.items.length === 0}
    <div class="grid flex-1 place-items-center px-6 text-center text-sm text-qz-muted">
      <div>
        <div class="mb-2 text-4xl">📋</div>
        还没有内容。在文件管理器右键「复制名称」，或任意地方调用 <code>sys.clipboard.copy(...)</code> 就会出现在这里。
      </div>
    </div>
  {:else}
    <div class="flex-1 overflow-auto p-2">
      {#each clipboard.items as it (it.id)}
        <button
          class="mb-1.5 flex w-full items-start gap-2 rounded-qz bg-qz-surface px-3 py-2 text-left hover:bg-qz-elevated"
          title="点击重新复制"
          onclick={() => reuse(it.text)}
        >
          <span class="min-w-0 flex-1 truncate text-sm">{it.text}</span>
          <span class="shrink-0 text-[10px] tabular-nums text-qz-muted">{fmtTime(it.ts)}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
