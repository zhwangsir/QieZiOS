<script lang="ts">
  // data = { url } —— 把外部网址嵌进 iframe 当窗口 App。
  let { data }: { data?: unknown } = $props();
  const url = $derived(
    data && typeof data === 'object' && 'url' in data ? String((data as { url: unknown }).url) : '',
  );
  function openTab() {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }
</script>

{#if url}
  <div class="flex h-full flex-col text-qz-text">
    <div class="flex shrink-0 items-center gap-2 border-b border-qz-border px-2 py-1.5">
      <span class="min-w-0 flex-1 truncate text-[11px] text-qz-muted" title={url}>{url}</span>
      <button
        class="shrink-0 rounded-md bg-qz-elevated px-2 py-1 text-[11px] hover:brightness-110"
        onclick={openTab}>↗ 新标签打开</button>
    </div>
    <div class="relative min-h-0 flex-1">
      <iframe src={url} title="网页" class="absolute inset-0 h-full w-full border-0 bg-white"></iframe>
      <!-- 部分网站设了 X-Frame-Options/CSP 禁止被嵌入，iframe 会空白 → 提示去新标签开 -->
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 bg-black/40 px-2 py-1 text-center text-[10px] text-white/80"
      >
        若一片空白，多半是该网站禁止被嵌入——点上方「新标签打开」
      </div>
    </div>
  </div>
{:else}
  <div class="grid h-full place-items-center text-sm text-qz-muted">无效网址</div>
{/if}
