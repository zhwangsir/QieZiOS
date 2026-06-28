<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
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
  import { setAppSize, getAppPref, clearAppPref } from '../system/appPrefs.svelte';
  import { sys } from '../system/sys';
  import { pop } from '../lib/motion';
  import { viewport } from '../system/viewport.svelte';
  import { provideWindow } from '../lib/winctx';
  import WindowControls from './WindowControls.svelte';

  // active：是不是当前活动窗（由 Desktop 传入，用来高亮焦点边框）
  let { proc, active = false, children }: { proc: Process; active?: boolean; children: Snippet } =
    $props();

  // 把「是否最小化」传给窗口内的 App，让它们最小化时暂停后台定时器
  provideWindow(() => proc.minimized);

  let el: HTMLElement; // 窗口根元素引用：用来拿父级窗口层的尺寸做边缘判定
  let dragging = $state(false);
  let resizing = $state(false);
  // $derived：派生状态。dragging/resizing 任一为真就是「正在交互」
  const interacting = $derived(dragging || resizing);

  // 起点快照（普通变量，无需响应式）
  let sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
  // rAF 批处理：pointermove 触发极密，每帧只写一次几何，稳住帧率
  let raf = 0, nx = 0, ny = 0, nw = 0, nh = 0;
  let resizeDir = ''; // 当前缩放方向（n/s/e/w 的组合，如 'se'/'w'/'ne'）

  // 缩放手柄：四边 + 四角。边缘细条在前、四角小块在后（DOM 顺序靠后 → 重叠处四角胜出，角落双轴缩放）。
  const RESIZE_HANDLES = [
    { dir: 'n', cls: 'inset-x-0 top-0 h-1.5 cursor-ns-resize', label: '向上缩放' },
    { dir: 's', cls: 'inset-x-0 bottom-0 h-1.5 cursor-ns-resize', label: '向下缩放' },
    { dir: 'w', cls: 'inset-y-0 left-0 w-1.5 cursor-ew-resize', label: '向左缩放' },
    { dir: 'e', cls: 'inset-y-0 right-0 w-1.5 cursor-ew-resize', label: '向右缩放' },
    { dir: 'nw', cls: 'left-0 top-0 h-3 w-3 cursor-nwse-resize', label: '左上角缩放' },
    { dir: 'ne', cls: 'right-0 top-0 h-3 w-3 cursor-nesw-resize', label: '右上角缩放' },
    { dir: 'sw', cls: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize', label: '左下角缩放' },
    { dir: 'se', cls: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize', label: '右下角缩放' },
  ];

  // 边缘吸附：当前拖到了哪个吸附区（null = 没吸附）。tl/tr/bl/br = 四角四分之一屏
  let snapZone: 'left' | 'right' | 'max' | 'tl' | 'tr' | 'bl' | 'br' | null = null;
  const SNAP_T = 18; // 边缘判定带宽度（px）
  const CORNER_R = 0.2; // 上/下边缘靠两侧 20% 宽内 → 四分之一屏（角落）

  function flush() {
    raf = 0;
    if (dragging) setBounds(proc.id, { x: nx, y: ny });
    else if (resizing) setBounds(proc.id, { x: nx, y: ny, width: nw, height: nh });
  }

  function startDrag(e: PointerEvent) {
    if (proc.maximized || viewport.isMobile) return; // 最大化 / 移动模式不拖
    focus(proc.id);
    dragging = true;
    sx = e.clientX; sy = e.clientY; ox = proc.x; oy = proc.y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function startResize(e: PointerEvent, dir: string) {
    e.stopPropagation();
    focus(proc.id);
    resizing = true;
    resizeDir = dir;
    sx = e.clientX; sy = e.clientY;
    ow = proc.width; oh = proc.height; ox = proc.x; oy = proc.y; // 左/上边缩放要同时调 x/y，故也快照位置
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (dragging) {
      nx = ox + (e.clientX - sx);
      ny = Math.max(0, oy + (e.clientY - sy)); // 不让标题栏被拖出屏幕顶
      updateSnap(e); // 顺带判断是否进入了边缘吸附区
    } else if (resizing) {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const MINW = 280, MINH = 180;
      nx = ox; ny = oy; nw = ow; nh = oh; // 默认不动；按方向各边调整
      if (resizeDir.includes('e')) nw = Math.max(MINW, ow + dx);
      if (resizeDir.includes('s')) nh = Math.max(MINH, oh + dy);
      if (resizeDir.includes('w')) {
        const right = ox + ow; // 右边固定
        nx = Math.max(0, Math.min(ox + dx, right - MINW)); // 左边不出屏 + 不越过「右边-最小宽」（与 n 分支对称）
        nw = right - nx;
      }
      if (resizeDir.includes('n')) {
        const bottom = oy + oh; // 底边固定
        ny = Math.max(0, Math.min(oy + dy, bottom - MINH)); // 顶不出屏 + 不越过「底-最小高」
        nh = bottom - ny;
      }
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

  // 拖拽/缩放中若窗口被卸载（AI/快捷键关窗、Alt+` 等），onUp 不会触发 →
  // pending rAF 不取消、snapState.preview 残留一个吸附预览框。卸载时兜底清理。
  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    if (dragging) snapState.preview = null; // 仅当本窗正在拖（preview 归本窗所有）才收，免误清别窗的
  });

  // 拖拽中：根据指针离窗口层各边的距离，决定吸附区并写预览框（layer 坐标系）
  function updateSnap(e: PointerEvent) {
    const layer = el?.parentElement;
    if (!layer) return;
    const r = layer.getBoundingClientRect();
    const W = layer.clientWidth;
    const H = layer.clientHeight;
    const half = Math.round(W / 2);
    const halfH = Math.round(H / 2);
    const x = e.clientX - r.left;
    const nearLeftSide = x < W * CORNER_R;
    const nearRightSide = r.right - e.clientX < W * CORNER_R;
    if (e.clientY - r.top <= SNAP_T) {
      // 上边缘：靠左/右 20% → 上半的四分之一屏（tl/tr），中间 → 最大化
      if (nearLeftSide) { snapZone = 'tl'; snapState.preview = { x: 0, y: 0, w: half, h: halfH }; }
      else if (nearRightSide) { snapZone = 'tr'; snapState.preview = { x: W - half, y: 0, w: W - half, h: halfH }; }
      else { snapZone = 'max'; snapState.preview = { x: 0, y: 0, w: W, h: H }; }
    } else if (r.bottom - e.clientY <= SNAP_T) {
      // 下边缘：靠左/右 20% → 下半的四分之一屏（bl/br），中间不吸附
      if (nearLeftSide) { snapZone = 'bl'; snapState.preview = { x: 0, y: halfH, w: half, h: H - halfH }; }
      else if (nearRightSide) { snapZone = 'br'; snapState.preview = { x: W - half, y: halfH, w: W - half, h: H - halfH }; }
      else { snapZone = null; snapState.preview = null; }
    } else if (x <= SNAP_T) {
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

  // 贴靠布局（R4-F8）：把窗口铺到窗口层的某个区域。给 WindowControls 的悬停浮层用。
  function tileTo(zone: string) {
    if (zone === 'max') {
      setBounds(proc.id, { maximized: true });
      return;
    }
    const layer = el?.parentElement;
    if (!layer) return;
    const W = layer.clientWidth;
    const H = layer.clientHeight;
    const half = Math.round(W / 2);
    const halfH = Math.round(H / 2);
    const third = Math.round(W / 3);
    const map: Record<string, { x: number; y: number; width: number; height: number }> = {
      left: { x: 0, y: 0, width: half, height: H },
      right: { x: W - half, y: 0, width: W - half, height: H },
      top: { x: 0, y: 0, width: W, height: halfH },
      bottom: { x: 0, y: halfH, width: W, height: H - halfH },
      tl: { x: 0, y: 0, width: half, height: halfH },
      tr: { x: W - half, y: 0, width: W - half, height: halfH },
      bl: { x: 0, y: halfH, width: half, height: H - halfH },
      br: { x: W - half, y: halfH, width: W - half, height: H - halfH },
      lthird: { x: 0, y: 0, width: third, height: H },
      cthird: { x: third, y: 0, width: W - 2 * third, height: H },
      rthird: { x: W - third, y: 0, width: third, height: H },
    };
    const b = map[zone];
    if (b) setBounds(proc.id, { maximized: false, ...b });
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
      // 仅窗口态（非最大化/移动）可把当前尺寸记为该 App 默认 → 之后都按此开
      ...(fullscreen
        ? []
        : [
            {
              label: '保存当前大小为默认',
              icon: '📐',
              separator: true,
              onClick: () => {
                setAppSize(proc.appId, proc.width, proc.height);
                sys.notify('已保存默认窗口大小', { body: `${Math.round(proc.width)}×${Math.round(proc.height)}`, level: 'success', timeout: 1500 });
              },
            },
          ]),
      // 存过默认尺寸才显示「重置」→ 回到 appList 出厂尺寸
      ...(!fullscreen && getAppPref(proc.appId)
        ? [{ label: '重置默认大小', icon: '↩', onClick: () => clearAppPref(proc.appId) }]
        : []),
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
    <WindowControls {proc} onTile={tileTo} />
    <span class="flex-1 truncate text-[13px] font-medium text-qz-muted">{proc.title}</span>
  </div>

  <!-- 内容：渲染 App 组件。最小化时 content-visibility:hidden → 浏览器跳过其布局/绘制
       （窗口仍挂载以保持还原动画，但不可见内容不再耗渲染；只作用于内容区、不碰标题栏/边框
       动画；flex-1 决定盒子尺寸故不塌陷；还原时移除→重新渲染）。配合 windowVisible() 暂停定时器。 -->
  <div
    class="flex-1 overflow-auto text-qz-text"
    style:content-visibility={proc.minimized ? 'hidden' : 'visible'}
  >
    {@render children()}
  </div>

  <!-- 缩放手柄：四边 + 四角（最大化 / 移动模式隐藏）。左/上边缩放同时调 x/y。 -->
  {#if !fullscreen}
    {#each RESIZE_HANDLES as h (h.dir)}
      <div
        class="absolute {h.cls}"
        role="separator"
        aria-label={h.label}
        onpointerdown={(e) => startResize(e, h.dir)}
        onpointermove={onMove}
        onpointerup={onUp}
      ></div>
    {/each}
  {/if}
</div>
