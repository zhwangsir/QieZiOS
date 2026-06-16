<script lang="ts">
  import type { Snippet } from 'svelte';
  import { focus, toggleMaximize, type Process } from '../kernel/processes.svelte';
  import WindowControls from './WindowControls.svelte';

  let { proc, children }: { proc: Process; children: Snippet } = $props();

  let dragging = $state(false);
  let resizing = $state(false);
  // $derived：派生状态。dragging/resizing 任一为真就是「正在交互」
  const active = $derived(dragging || resizing);

  // 起点快照（普通变量，无需响应式）
  let sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
  // rAF 批处理：pointermove 触发极密，每帧只写一次几何，稳住帧率
  let raf = 0, nx = 0, ny = 0, nw = 0, nh = 0;

  function flush() {
    raf = 0;
    if (dragging) { proc.x = nx; proc.y = ny; }
    else if (resizing) { proc.width = nw; proc.height = nh; }
  }

  function startDrag(e: PointerEvent) {
    if (proc.maximized) return; // 最大化时标题栏不拖
    focus(proc.id);
    dragging = true;
    sx = e.clientX; sy = e.clientY; ox = proc.x; oy = proc.y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function startResize(e: PointerEvent) {
    e.stopPropagation();
    focus(proc.id);
    resizing = true;
    sx = e.clientX; sy = e.clientY; ow = proc.width; oh = proc.height;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (dragging) {
      nx = ox + (e.clientX - sx);
      ny = Math.max(0, oy + (e.clientY - sy)); // 不让标题栏被拖出屏幕顶
    } else if (resizing) {
      nw = Math.max(280, ow + (e.clientX - sx));
      nh = Math.max(180, oh + (e.clientY - sy));
    } else {
      return;
    }
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function onUp() {
    dragging = false; resizing = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  // 最大化用 CSS 铺满（几何数值不动，取消时自然还原）；否则 transform 定位走 GPU
  const style = $derived(
    proc.maximized
      ? `inset: 0; z-index: ${proc.z}; border-radius: 0;`
      : `top: 0; left: 0; transform: translate(${proc.x}px, ${proc.y}px);` +
        ` width: ${proc.width}px; height: ${proc.height}px; z-index: ${proc.z};` +
        ` border-radius: var(--radius-qz); contain: layout style;`,
  );
</script>

<!-- 整窗任意位置按下 → 置顶（捕获阶段，先于内部处理） -->
<div
  class="absolute flex flex-col select-none overflow-hidden border border-qz-border qz-glass shadow-2xl shadow-black/40"
  class:hidden={proc.minimized}
  {style}
  style:will-change={active ? 'transform' : 'auto'}
  onpointerdowncapture={() => focus(proc.id)}
>
  <!-- 标题栏：按住拖动；双击最大化/还原 -->
  <div
    class="flex h-9 shrink-0 cursor-grab items-center gap-3 px-3 active:cursor-grabbing"
    style="border-bottom: 1px solid var(--color-qz-border)"
    role="toolbar"
    tabindex="-1"
    aria-label="窗口标题栏"
    onpointerdown={startDrag}
    onpointermove={onMove}
    onpointerup={onUp}
    ondblclick={() => toggleMaximize(proc.id)}
  >
    <WindowControls {proc} />
    <span class="flex-1 truncate text-[13px] font-medium text-qz-muted">{proc.title}</span>
  </div>

  <!-- 内容：渲染 App 组件 -->
  <div class="flex-1 overflow-auto text-qz-text">
    {@render children()}
  </div>

  <!-- 右下角缩放手柄（最大化时隐藏） -->
  {#if !proc.maximized}
    <div
      class="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
      role="separator"
      aria-label="缩放窗口"
      onpointerdown={startResize}
      onpointermove={onMove}
      onpointerup={onUp}
    ></div>
  {/if}
</div>
