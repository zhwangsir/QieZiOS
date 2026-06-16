<script lang="ts">
  import type { Snippet } from 'svelte';
  import { focus, close, type Process } from '../kernel/processes.svelte';

  // $props() 取组件入参（相当于 React 的 props，但用解构 + runes）
  let { proc, children }: { proc: Process; children: Snippet } = $props();

  let dragging = $state(false);
  let resizing = $state(false);
  // 拖拽起点的快照（普通变量即可，不需要响应式）
  let sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;

  function startDrag(e: PointerEvent) {
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
      proc.x = ox + (e.clientX - sx);
      proc.y = oy + (e.clientY - sy);
    } else if (resizing) {
      proc.width = Math.max(240, ow + (e.clientX - sx));
      proc.height = Math.max(160, oh + (e.clientY - sy));
    }
  }
  function onUp() { dragging = false; resizing = false; }
</script>

<!-- 用 transform 定位（走合成器/GPU → 拖动丝滑）；z-index 控制叠放 -->
<div
  class="absolute top-0 left-0 flex flex-col rounded-xl overflow-hidden border border-white/10
         bg-slate-800/80 backdrop-blur-xl shadow-2xl shadow-black/50 select-none"
  style="transform: translate({proc.x}px, {proc.y}px); width: {proc.width}px; height: {proc.height}px; z-index: {proc.z};"
  onpointerdowncapture={() => focus(proc.id)}
>
  <!-- 标题栏：按住拖动 -->
  <div
    class="flex items-center gap-2 px-3 h-9 shrink-0 bg-white/5 cursor-grab active:cursor-grabbing"
    role="toolbar"
    tabindex="-1"
    aria-label="窗口标题栏（按住拖动）"
    onpointerdown={startDrag}
    onpointermove={onMove}
    onpointerup={onUp}
  >
    <span class="text-sm text-slate-200 font-medium truncate flex-1">{proc.title}</span>
    <button
      class="w-5 h-5 rounded-full bg-red-500/80 hover:bg-red-500 text-white text-xs leading-none grid place-items-center"
      onclick={() => close(proc.id)}
      aria-label="关闭窗口"
    >×</button>
  </div>

  <!-- 内容：渲染 App -->
  <div class="flex-1 overflow-auto">
    {@render children()}
  </div>

  <!-- 右下角缩放手柄 -->
  <div
    class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
    onpointerdown={startResize}
    onpointermove={onMove}
    onpointerup={onUp}
    aria-label="缩放窗口"
    role="separator"
  ></div>
</div>
