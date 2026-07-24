<script lang="ts">
  // ───────────────────────────────────────────────────────────
  // Quick Look 浮动预览面板（macOS 空格预览同款）
  // 渲染在 Files 窗口内部（absolute 相对 Files 根）：z-50 只压本窗内容、不碰其它 App 窗口。
  // 键盘（空格/Esc/方向键）由 Files 统一处理；本组件只负责按 previewKind 分级渲染 + 关闭按钮。
  // ───────────────────────────────────────────────────────────
  import { readBlob, isVideo, children, type VNode } from '../kernel/vfs.svelte';
  import { previewKind, truncatePreview, fmtBytes, TEXT_PREVIEW_MAX } from '../lib/quicklook';
  import Icon from '../lib/Icon.svelte';

  let { node, onclose }: { node: VNode; onclose: () => void } = $props();

  const kind = $derived(previewKind(node));
  const video = $derived(kind === 'media' && isVideo(node)); // 视频用 <video>，否则 <audio>

  // 图片/媒体的真实 src：照抄 ImageViewer/MediaViewer —— readBlob 取字节 → objectURL。
  // ⚠️ 换节点/关闭面板时 revoke，防 objectURL 内存泄漏。
  let url = $state('');
  let status = $state<'loading' | 'ok' | 'error'>('loading');
  $effect(() => {
    const n = node;
    const k = kind;
    url = '';
    status = 'loading';
    if ((k !== 'image' && k !== 'media') || !n?.blobId) {
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

  // 文本：过长截断（truncatePreview 纯函数），空文件显占位
  const text = $derived(kind === 'text' ? truncatePreview(node.content ?? '') : null);
  const dirCount = $derived(kind === 'dir' ? children(node.id).length : 0);
</script>

<!-- 遮罩 + 居中卡片。遮罩点击关闭；pointerdown preventDefault 让焦点留在文件列表上，
     面板打开期间空格/方向键仍能到达 Files 的容器键盘处理（不断线）。 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="absolute inset-0 z-50 grid place-items-center p-4 sm:p-8" role="dialog" aria-label={`快速预览 ${node.name}`}>
  <div class="absolute inset-0 bg-black/40" onpointerdown={(e) => e.preventDefault()} onclick={onclose}></div>

  <!-- 卡片：毛玻璃 + 圆角 + 窗口级投影（质感对齐 Window.svelte）。点卡片非交互区不抢焦点 -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="qz-glass relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-qz)] border border-qz-border"
    style="box-shadow: var(--qz-shadow-window-active)"
    onpointerdown={(e) => {
      if (!(e.target as HTMLElement).closest('video, audio, button')) e.preventDefault();
    }}
  >
    <!-- 标题条：左文件名，右关闭 -->
    <div class="flex shrink-0 items-center gap-2 border-b border-qz-border px-3 py-2">
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-qz-text" title={node.name}>{node.name}</span>
      <button
        class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-qz-muted hover:bg-qz-elevated hover:text-qz-text"
        title="关闭"
        aria-label="关闭预览"
        onclick={onclose}
      ><Icon name="X" size={13} /></button>
    </div>

    <!-- 内容区：按 previewKind 分级渲染 -->
    <div class="grid min-h-48 flex-1 place-items-center overflow-auto bg-black/20 p-4">
      {#if kind === 'image'}
        {#if status === 'ok'}
          <img src={url} alt={node.name} draggable="false" class="max-h-[55vh] max-w-full select-none rounded object-contain" />
        {:else}
          <span class="text-sm text-qz-muted">{status === 'loading' ? '加载中…' : '读不到图片数据'}</span>
        {/if}
      {:else if kind === 'media'}
        {#if status === 'ok'}
          {#if video}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={url} controls autoplay class="max-h-[55vh] max-w-full rounded" style="background:#000">
              <track kind="captions" />
            </video>
          {:else}
            <div class="flex w-full max-w-sm flex-col items-center gap-4 py-6">
              <div class="text-qz-muted"><Icon name="Music" size={56} strokeWidth={1.5} /></div>
              <audio src={url} controls autoplay class="w-full"></audio>
            </div>
          {/if}
        {:else}
          <span class="text-sm text-qz-muted">{status === 'loading' ? '加载中…' : '读不到媒体数据'}</span>
        {/if}
      {:else if kind === 'text'}
        {#if text && text.text.length}
          <div class="max-h-[55vh] w-full justify-self-stretch self-start overflow-auto">
            <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-qz-text">{text.text}</pre>
            {#if text.truncated}
              <div class="mt-2 text-[11px] text-qz-muted">…（内容过长，仅预览前 {TEXT_PREVIEW_MAX.toLocaleString()} 字符）</div>
            {/if}
          </div>
        {:else}
          <span class="text-sm text-qz-muted">（空文件）</span>
        {/if}
      {:else if kind === 'dir'}
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <div class="text-qz-text"><Icon name="Folder" size={72} strokeWidth={1.2} /></div>
          <div class="break-words text-sm font-medium text-qz-text">{node.name}</div>
          <div class="text-xs text-qz-muted">{dirCount} 个项目</div>
        </div>
      {:else}
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <div class="text-qz-text"><Icon name="File" size={72} strokeWidth={1.2} /></div>
          <div class="break-words text-sm font-medium text-qz-text">{node.name}</div>
          <div class="text-xs text-qz-muted">{fmtBytes(node.size)}{node.mime ? ` · ${node.mime}` : ''}</div>
        </div>
      {/if}
    </div>
  </div>
</div>
