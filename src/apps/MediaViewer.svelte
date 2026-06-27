<script lang="ts">
  import { getNode, readBlob, isVideo } from '../kernel/vfs.svelte';

  // data = 要播放的音/视频文件 id（Files 双击媒体文件时传入）
  let { data }: { data?: unknown } = $props();
  const node = $derived(typeof data === 'string' ? getNode(data) : undefined);
  const video = $derived(!!node && isVideo(node)); // 视频用 <video>，否则 <audio>

  let url = $state('');
  let status = $state<'loading' | 'ok' | 'error'>('loading');

  function fmtSize(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  // 取字节 → 造 object URL 喂 <audio>/<video>。⚠️ 用完要 revoke 防内存泄漏（同 ImageViewer）。
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
      if (obj) URL.revokeObjectURL(obj);
    };
  });
</script>

<div class="flex h-full flex-col bg-black/25">
  <!-- 信息条 -->
  <div class="flex shrink-0 items-center gap-2 border-b border-qz-border bg-qz-surface/60 px-3 py-1.5 text-xs">
    <span class="shrink-0">{video ? '🎬' : '🎵'}</span>
    <span class="min-w-0 flex-1 truncate" title={node?.name}>{node?.name ?? '未知'}</span>
    {#if node?.size}<span class="shrink-0 text-qz-muted">{fmtSize(node.size)}</span>{/if}
  </div>

  <!-- 播放区 -->
  <div class="grid min-h-0 flex-1 place-items-center overflow-hidden p-3">
    {#if !node}
      <span class="text-sm text-qz-muted">文件不存在或已删除</span>
    {:else if status === 'loading'}
      <span class="text-sm text-qz-muted">加载中…</span>
    {:else if status === 'error'}
      <span class="text-sm text-qz-muted">读不到媒体数据</span>
    {:else if video}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={url} controls autoplay class="max-h-full max-w-full rounded" style="background:#000">
        <track kind="captions" />
      </video>
    {:else}
      <div class="flex w-full max-w-sm flex-col items-center gap-4">
        <div class="text-6xl">🎵</div>
        <audio src={url} controls autoplay class="w-full"></audio>
      </div>
    {/if}
  </div>
</div>
