<script lang="ts">
  import { getNode, readBlob } from '../kernel/vfs.svelte';

  // data = 要看的图片文件 id（Files 双击图片时传入）
  let { data }: { data?: unknown } = $props();
  const node = $derived(typeof data === 'string' ? getNode(data) : undefined);

  let url = $state('');
  let status = $state<'loading' | 'ok' | 'error'>('loading');

  // 视图变换：只动 transform（translate/scale/rotate）→ 走 GPU 合成层，缩放/旋转/平移丝滑。
  let scale = $state(1); // 1 = 适应窗口（object-contain 的基准）
  let rot = $state(0); // 旋转角度（度）
  let tx = $state(0); // 平移 x（px）
  let ty = $state(0); // 平移 y
  const pct = $derived(Math.round(scale * 100));

  function clampScale(s: number): number {
    return Math.min(8, Math.max(0.1, s));
  }
  function zoom(factor: number): void {
    scale = clampScale(scale * factor);
  }
  function rotate(deg: number): void {
    rot = (((rot + deg) % 360) + 360) % 360;
  }
  function reset(): void {
    scale = 1;
    rot = 0;
    tx = 0;
    ty = 0;
  }

  // 换图时重置视图（一个窗口通常只看一张，但防御性处理）
  $effect(() => {
    node; // 订阅
    reset();
  });

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

  // 滚轮缩放（向中心缩放，简单稳健）
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  // 拖拽平移（指针按下拖动；用 pointer capture 保证拖出元素也跟手）
  let dragging = $state(false);
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    ox = tx;
    oy = ty;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    tx = ox + (e.clientX - sx);
    ty = oy + (e.clientY - sy);
  }
  function onPointerUp(e: PointerEvent): void {
    dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // 键盘：+/- 缩放、0 适应、r 旋转（Shift+R 反向）。仅在查看区聚焦时。
  function onKey(e: KeyboardEvent): void {
    if (e.key === '+' || e.key === '=') {
      zoom(1.2);
      e.preventDefault();
    } else if (e.key === '-' || e.key === '_') {
      zoom(1 / 1.2);
      e.preventDefault();
    } else if (e.key === '0') {
      reset();
      e.preventDefault();
    } else if (e.key === 'r' || e.key === 'R') {
      rotate(e.shiftKey ? -90 : 90);
      e.preventDefault();
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if status === 'ok'}
    <!-- 工具条：缩放 / 旋转 / 适应 -->
    <div class="flex shrink-0 items-center gap-1 border-b border-qz-border bg-qz-surface/60 px-2 py-1.5 text-xs">
      <button class="rounded px-2 py-1 hover:bg-qz-elevated" title="缩小 (-)" onclick={() => zoom(1 / 1.2)}>➖</button>
      <button class="min-w-[3.5rem] rounded px-2 py-1 tabular-nums hover:bg-qz-elevated" title="适应窗口 (0)" onclick={reset}>{pct}%</button>
      <button class="rounded px-2 py-1 hover:bg-qz-elevated" title="放大 (+)" onclick={() => zoom(1.2)}>➕</button>
      <span class="mx-1 h-4 w-px bg-qz-border"></span>
      <button class="rounded px-2 py-1 hover:bg-qz-elevated" title="逆时针旋转 (Shift+R)" onclick={() => rotate(-90)}>↺</button>
      <button class="rounded px-2 py-1 hover:bg-qz-elevated" title="顺时针旋转 (R)" onclick={() => rotate(90)}>↻</button>
      <span class="mx-1 h-4 w-px bg-qz-border"></span>
      <button class="rounded px-2 py-1 hover:bg-qz-elevated" title="适应窗口 (0)" onclick={reset}>⤢ 适应</button>
      <span class="ml-auto truncate pl-2 text-qz-muted">{node?.name}</span>
    </div>
  {/if}

  <!-- 查看区：overflow-hidden 当平移画布；滚轮缩放、拖拽平移、键盘 -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-black/25 p-2"
    style="cursor: {dragging ? 'grabbing' : status === 'ok' ? 'grab' : 'default'}; touch-action: none;"
    tabindex="0"
    role="presentation"
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onkeydown={onKey}
  >
    {#if !node}
      <span class="text-sm text-qz-muted">文件不存在或已删除</span>
    {:else if status === 'ok'}
      <img
        src={url}
        alt={node.name}
        draggable="false"
        class="max-h-full max-w-full select-none object-contain"
        style="transform: translate({tx}px, {ty}px) scale({scale}) rotate({rot}deg); transform-origin: center center; transition: {dragging ? 'none' : 'transform 80ms var(--qz-ease)'};"
      />
    {:else if status === 'loading'}
      <span class="text-sm text-qz-muted">加载中…</span>
    {:else}
      <span class="text-sm text-qz-muted">读不到图片数据</span>
    {/if}
  </div>
</div>
