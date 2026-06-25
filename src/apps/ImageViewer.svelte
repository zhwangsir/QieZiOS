<script lang="ts">
  import { getNode, readBlob } from '../kernel/vfs.svelte';

  // data = 要看的图片文件 id（Files 双击图片时传入）
  let { data }: { data?: unknown } = $props();
  const node = $derived(typeof data === 'string' ? getNode(data) : undefined);

  let url = $state('');
  let status = $state<'loading' | 'ok' | 'error'>('loading');

  // 取字节 → 造 object URL 给 <img>。⚠️ object URL 用完要 revoke，否则内存泄漏。
  $effect(() => {
    const n = node;
    url = '';
    status = 'loading';
    if (!n?.blobId) {
      status = 'error';
      return;
    }
    let active = true;
    let obj = '';
    readBlob(n)
      .then((blob) => {
        if (!active) return;
        if (!blob) {
          status = 'error';
          return;
        }
        obj = URL.createObjectURL(blob);
        url = obj;
        status = 'ok';
      })
      .catch(() => {
        if (active) status = 'error';
      });
    return () => {
      active = false;
      if (obj) URL.revokeObjectURL(obj); // 清理函数：组件销毁/换图时回收 URL
    };
  });
</script>

<div class="grid h-full place-items-center overflow-auto bg-black/25 p-2">
  {#if !node}
    <span class="text-sm text-qz-muted">文件不存在或已删除</span>
  {:else if status === 'ok'}
    <img src={url} alt={node.name} class="max-h-full max-w-full object-contain" />
  {:else if status === 'loading'}
    <span class="text-sm text-qz-muted">加载中…</span>
  {:else}
    <span class="text-sm text-qz-muted">读不到图片数据</span>
  {/if}
</div>
