<script lang="ts">
  import { getNode } from '../kernel/vfs.svelte';

  // data = 要打开的文件 id（由文件管理器在 launch 时通过启动参数传入）
  let { data }: { data?: unknown } = $props();

  const node = $derived(typeof data === 'string' ? getNode(data) : undefined);
</script>

{#if node}
  <!-- 直接 bind 到文件节点的 content：编辑即改 VFS → persisted 自动存盘（防抖） -->
  <textarea
    class="h-full w-full resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-qz-text outline-none"
    bind:value={node.content}
    spellcheck="false"
    placeholder="空文件"
  ></textarea>
{:else}
  <div class="grid h-full place-items-center text-sm text-qz-muted">文件不存在或已删除</div>
{/if}
