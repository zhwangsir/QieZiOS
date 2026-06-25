<script lang="ts">
  import type { Snippet } from 'svelte';
  import {
    focus,
    close,
    minimize,
    toggleMaximize,
    setBounds,
    type Process,
  } from '../kernel/processes.svelte';
  import { snapState } from './snapState.svelte';
  import { openMenu } from './menu.svelte';
  import { pop } from '../lib/motion';
  import { viewport } from '../system/viewport.svelte';
  import WindowControls from './WindowControls.svelte';

  // active：是不是当前活动窗（由 Desktop 传入，用来高亮焦点边框）
  let { proc, active = false, children }: { proc: Process; active?: boolean; children: Snippet } =
    $props();

  let el: HTMLElement; // 窗口根元素引用：用来拿父级窗口层的尺寸做边缘判定
  let dragging = $state(false);
  let resizing = $state(false);
  // $derived：派生状态。dragging/resizing 任一为真就是「正在交互」
  const interacting = $derived(dragging || resizing);

  // 起点快照（普通变量，无需响应式）
  let sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
  // rAF 批处理：pointermove 触发极密，每帧只写一次几何，稳住帧率
  let raf = 0, nx = 0, ny = 0, nw = 0, nh = 0;

  // 边缘吸附：当前拖到了哪个吸附区（null = 没吸附）
  let snapZone: 'left' | 'right' | 'max' | null = null;
  const SNAP_T = 18; // 边缘判定带宽度（px）

  function flush() {
    raf = 0;
    if (dragging) setBounds(proc.id, { x: nx, y: ny });
    else if (resizing) setBounds(proc.id, { width: nw, height: nh });
  }

  function startDrag(e: PointerEvent) {
    if (proc.maximized || viewport.isMobile) return; // 最大化 / 移动模式不拖
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
      updateSnap(e); // 顺带判断是否进入了边缘吸附区
    } else if (resizing) {
      nw = Math.max(280, ow + (e.clientX - sx));
      nh = Math.max(180, oh + (e.clientY - sy));
    } else {
      return;
    }
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function onUp() {
    if (dragging) applySnap(); // 松手时若在吸附区 → 套用吸附几何
    dragging = false; resizing = false;
    snapZone = null;
    snapState.preview = null; // 收掉预览框
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  // 拖拽中：根据指针离窗口层各边的距离，决定吸附区并写预览框（layer 坐标系）
  function updateSnap(e: PointerEvent) {
    const layer = el?.parentElement;
    if (!layer) return;
    const r = layer.getBoundingClientRect();
    const W = layer.clientWidth;
    const H = layer.clientHeight;
    const half = Math.round(W / 2);
    if (e.clientY - r.top <= SNAP_T) {
      snapZone = 'max';
      snapState.preview = { x: 0, y: 0, w: W, h: H };
    } else if (e.clientX - r.left <= SNAP_T) {
      snapZone = 'left';
      snapState.preview = { x: 0, y: 0, w: half, h: H };
    } else if (r.right - e.clientX <= SNAP_T) {
      snapZone = 'right';
      snapState.preview = { x: W - half, y: 0, w: W - half, h: H };
    } else {
      snapZone = null;
      snapState.preview = null;
    }
  }

  // 松手套用：上边缘 → 最大化；左右边缘 → 半屏
  function applySnap() {
    if (!snapZone) return;
    if (snapZone === 'max') {
      setBounds(proc.id, { maximized: true });
    } else if (snapState.preview) {
      const p = snapState.preview;
      setBounds(proc.id, { maximized: false, x: p.x, y: p.y, width: p.w, height: p.h });
    }
  }

  // 标题栏右键菜单
  function onTitleMenu(e: MouseEvent) {
    openMenu(e, [
      { label: '最小化', icon: '—', onClick: () => minimize(proc.id) },
      {
        label: proc.maximized ? '还原' : '最大化',
        icon: '▢',
        onClick: () => toggleMaximize(proc.id),
      },
      { label: '关闭', icon: '✕', danger: true, separator: true, onClick: () => close(proc.id) },
    ]);
  }

  // 移动模式 或 最大化 → CSS 铺满；否则 transform 定位走 GPU。
  // 移动模式下所有窗口铺满 + 按 z 叠放 → 顶层那个可见，靠顶栏/Dock 切换（手机 App 切换器手感）。
  const fullscreen = $derived(viewport.isMobile || proc.maximized);
  const style = $derived(
    fullscreen
      ? `inset: 0; z-index: ${proc.z}; border-radius: 0;`
      : `top: 0; left: 0; transform: translate(${proc.x}px, ${proc.y}px);` +
        ` width: ${proc.width}px; height: ${proc.height}px; z-index: ${proc.z};` +
        ` border-radius: var(--radius-qz); contain: layout style;`,
  );
</script>

<!-- 整窗任意位置按下 → 置顶（捕获阶段，先于内部处理） -->
<!-- 开/关：in:pop / out:pop（缩放淡入淡出，首屏已存在的窗口不播放 → 会话还原不闪）。
     最小化/还原：靠下面 opacity+scale 的 CSS transition 平滑过渡（窗口保持挂载，不 display:none）。 -->
<div
  bind:this={el}
  data-window
  class="absolute flex flex-col select-none overflow-hidden border border-qz-border qz-glass shadow-2xl shadow-black/40"
  {style}
  style:will-change={interacting ? 'transform' : 'auto'}
  style:border-color={active
    ? 'color-mix(in srgb, var(--color-qz-accent) 60%, var(--color-qz-border))'
    : null}
  style:opacity={proc.minimized ? '0' : '1'}
  style:scale={proc.minimized ? '0.96' : '1'}
  style:pointer-events={proc.minimized ? 'none' : null}
  style:transition="opacity var(--qz-dur) var(--qz-ease), scale var(--qz-dur) var(--qz-ease)"
  in:pop={{ duration: 190 }}
  out:pop={{ duration: 150 }}
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
    oncontextmenu={onTitleMenu}
  >
    <WindowControls {proc} />
    <span class="flex-1 truncate text-[13px] font-medium text-qz-muted">{proc.title}</span>
  </div>

  <!-- 内容：渲染 App 组件 -->
  <div class="flex-1 overflow-auto text-qz-text">
    {@render children()}
  </div>

  <!-- 右下角缩放手柄（最大化 / 移动模式隐藏） -->
  {#if !fullscreen}
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
