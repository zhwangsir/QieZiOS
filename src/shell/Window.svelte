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
  import { detectSnapZone, zoneBounds, type SnapZone } from './snapPreview';
  import { openMenu } from './menu.svelte';
  import { setAppSize, getAppPref, clearAppPref } from '../system/appPrefs.svelte';
  import { sys } from '../system/sys';
  import {
    pop,
    SPRING_BEZIER,
    SETTLE_MS,
    GENIE_MS,
    genieEase,
    genieFrame,
    dockIconPos,
    type Rect,
  } from '../lib/motion';
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

  // ── M2 动效状态 ─────────────────────────────────────────
  // settling：几何弹簧落位中（吸附/贴靠/最大化 260ms 回弹过渡挂到 transition 上）。
  let settling = $state(false);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  // genie：神灯帧（非 null 时接管 transform/opacity/scale/clip-path，CSS 过渡让位）。
  let genie = $state<{ base: Rect; dx: number; dy: number; scale: number; opacity: number; clip: string } | null>(null);
  let genieRaf = 0;
  // 初始进度跟随挂载时的最小化态：会话还原带 minimized=true 的窗口，genieT 必须起步于 1
  // （概念上已吸到底）——否则首次还原 from=0/to=0 播 500ms 全矩形空动画（M41 真机查获）。
  let genieT = proc.minimized ? 1 : 0; // 当前神灯进度 0..1（普通变量帧内更新；中途反向时从此接续）

  // U4 落位弹簧：先置 settling（挂上过渡）、再改几何 —— 同一渲染批里
  // transition 与几何变化一起提交，浏览器才会对这次变化做过渡。
  function kickSettle() {
    if (viewport.reducedMotion || viewport.isMobile) return;
    settling = true;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => (settling = false), SETTLE_MS);
  }

  // 最大化 ⇄ 还原（双击标题栏/菜单/红绿灯都走这）：带弹簧回弹的几何过渡
  function onToggleMax() {
    kickSettle();
    toggleMaximize(proc.id);
  }

  // 窗口在「窗口层坐标系」的当前几何（最大化/移动 = 铺满层）。
  // base 供渲染分支用，winV（视口系）供神灯插值用（与 dockIconPos 同坐标系）。
  function genieBaseRect(): { base: Rect; winV: Rect } | null {
    const layer = el?.parentElement;
    if (!layer) return null;
    const lr = layer.getBoundingClientRect();
    const base =
      proc.maximized || viewport.isMobile
        ? { x: 0, y: 0, w: lr.width, h: lr.height }
        : { x: proc.x, y: proc.y, w: proc.width, h: proc.height };
    return { base, winV: { x: lr.left + base.x, y: lr.top + base.y, w: base.w, h: base.h } };
  }

  // U5 神灯：out=true 吸入 Dock（最小化），false 反向放出（还原）。
  // 降级：移动端 / reducedMotion / 找不到 Dock 图标坐标 → 不启动，落回现有缩放淡出。
  function startGenie(out: boolean) {
    if (viewport.isMobile || viewport.reducedMotion) return;
    const target = dockIconPos[proc.appId];
    const g = genieBaseRect();
    if (!target || !g) return;
    cancelAnimationFrame(genieRaf);
    const from = genieT; // 中途反向（动画没播完就还原/再最小化）从当前进度接续，不跳变
    const to = out ? 1 : 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const raw = Math.min(1, (now - t0) / GENIE_MS);
      const t = from + (to - from) * genieEase(raw);
      genieT = t;
      genie = { base: g.base, ...genieFrame(g.winV, target, t) };
      if (raw < 1) {
        genieRaf = requestAnimationFrame(tick);
      } else {
        genie = null; // 结束帧：清掉 clip-path/帧姿态，交还 CSS 态（opacity 0↔1 恰好对接无跳变）
        genieRaf = 0;
      }
    };
    genieRaf = requestAnimationFrame(tick);
  }

  // U5 触发器：proc.minimized 任何来源的翻转（红绿灯/标题菜单/Dock/快捷键）都进这里。
  // pre 版 → DOM 提交前起动画：最小化首帧不会先闪一帧「空内容 + 淡出」再被神灯接管。
  let wasMin: boolean | undefined; // 首帧只建基线：会话还原的最小化窗不播神灯
  $effect.pre(() => {
    const m = proc.minimized;
    if (wasMin === undefined) { wasMin = m; return; }
    if (m === wasMin) return;
    wasMin = m;
    startGenie(m);
  });

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
  // 判定规则与阈值收敛到 snapPreview.ts 纯函数（边缘 8px / 角落 96px / 底部 Dock 区不触发）
  let snapZone: SnapZone | null = null;

  function flush() {
    raf = 0;
    if (dragging) setBounds(proc.id, { x: nx, y: ny });
    else if (resizing) setBounds(proc.id, { x: nx, y: ny, width: nw, height: nh });
  }

  function startDrag(e: PointerEvent) {
    if (proc.maximized || viewport.isMobile) return; // 最大化 / 移动模式不拖
    focus(proc.id);
    settling = false; // 抓起即撤掉落位过渡，否则跟手被弹簧拖住
    clearTimeout(settleTimer);
    dragging = true;
    sx = e.clientX; sy = e.clientY; ox = proc.x; oy = proc.y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function startResize(e: PointerEvent, dir: string) {
    e.stopPropagation();
    focus(proc.id);
    settling = false;
    clearTimeout(settleTimer);
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
    if (genieRaf) cancelAnimationFrame(genieRaf);
    clearTimeout(settleTimer);
    if (dragging) snapState.preview = null; // 仅当本窗正在拖（preview 归本窗所有）才收，免误清别窗的
  });

  // 拖拽中：指针位置过纯函数判定吸附区，命中则写预览框（layer 坐标系，
  // 几何与松手落位共用 zoneBounds → 预览框和最终落位像素级一致）
  function updateSnap(e: PointerEvent) {
    // 守卫：移动端 / reducedMotion / 最大化 / 缩放中不做边缘检测
    //（startDrag 已挡最大化与移动端，这里是中途状态翻转的双保险）
    if (viewport.isMobile || viewport.reducedMotion || proc.maximized || resizing) {
      if (snapZone) { snapZone = null; snapState.preview = null; }
      return;
    }
    const layer = el?.parentElement;
    if (!layer) return;
    const r = layer.getBoundingClientRect();
    const W = layer.clientWidth;
    const H = layer.clientHeight;
    snapZone = detectSnapZone(e.clientX - r.left, e.clientY - r.top, W, H);
    snapState.preview = snapZone ? zoneBounds(snapZone, W, H) : null;
  }

  // 松手套用：上边缘 → 最大化；左右边缘 → 半屏（落位带弹簧回弹）
  function applySnap() {
    if (!snapZone) return;
    if (snapZone === 'max') {
      kickSettle();
      setBounds(proc.id, { maximized: true });
    } else if (snapState.preview) {
      const p = snapState.preview;
      kickSettle();
      setBounds(proc.id, { maximized: false, x: p.x, y: p.y, width: p.w, height: p.h });
    }
  }

  // 贴靠布局（R4-F8）：把窗口铺到窗口层的某个区域。给 WindowControls 的悬停浮层用。
  // 几何与拖拽预览共用 zoneBounds 纯函数 —— 点击贴靠与拖拽落位像素级一致。
  function tileTo(zone: string) {
    if (zone === 'max') {
      kickSettle();
      setBounds(proc.id, { maximized: true });
      return;
    }
    const layer = el?.parentElement;
    if (!layer) return;
    const b = zoneBounds(zone, layer.clientWidth, layer.clientHeight);
    if (b) {
      kickSettle();
      setBounds(proc.id, { maximized: false, x: b.x, y: b.y, width: b.w, height: b.h });
    }
  }

  // 标题栏右键菜单
  function onTitleMenu(e: MouseEvent) {
    openMenu(e, [
      { label: '最小化', icon: '—', onClick: () => minimize(proc.id) },
      {
        label: proc.maximized ? '还原' : '最大化',
        icon: '▢',
        onClick: onToggleMax,
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
                sys.notify('已保存默认窗口大小', { body: `${Math.round(proc.width)}×${Math.round(proc.height)}`, level: 'success', timeout: 1500, source: '系统' });
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
  // 最小化的「隐藏态」：神灯播放期间窗口仍可见（帧姿态接管），播完才落入隐藏态。
  const minHidden = $derived(proc.minimized && !genie);

  // 桌面最大化不用 inset:0，而与窗口态同构（translate + width/height:100%）——
  // 同一条 transform/width/height/border-radius 才能对「最大化⇄还原」做弹簧过渡
  // （width 的 px ↔ % 属于 length-percentage，可插值）。
  const style = $derived.by(() => {
    const z = `z-index: ${proc.z};`;
    if (genie) {
      const b = genie.base;
      return (
        `top: 0; left: 0; transform: translate(${b.x + genie.dx}px, ${b.y + genie.dy}px);` +
        ` width: ${b.w}px; height: ${b.h}px; ${z}` +
        ` border-radius: ${proc.maximized ? '0' : 'var(--radius-qz)'}; contain: layout style;`
      );
    }
    if (viewport.isMobile) return `inset: 0; ${z} border-radius: 0;`;
    if (proc.maximized)
      return (
        `top: 0; left: 0; transform: translate(0px, 0px); width: 100%; height: 100%; ${z}` +
        ` border-radius: 0; contain: layout style;`
      );
    return (
      `top: 0; left: 0; transform: translate(${proc.x}px, ${proc.y}px);` +
      ` width: ${proc.width}px; height: ${proc.height}px; ${z}` +
      ` border-radius: var(--radius-qz); contain: layout style;`
    );
  });

  // 过渡编排：神灯帧由 rAF 直驱（任何 CSS 过渡都会拖帧 → none）；
  // 落位弹簧只对几何（transform/width/height/radius，SPRING_BEZIER 带轻微 overshoot）；
  // 平时只有最小化的 opacity/scale 平滑（现有行为）。
  // M8.1：box-shadow 全程可过渡 —— 聚焦/失焦时活动⇄非活动双阴影平滑切换（景深呼吸感）。
  const winTransition = $derived(
    genie
      ? 'none'
      : settling
        ? `transform ${SETTLE_MS}ms ${SPRING_BEZIER}, width ${SETTLE_MS}ms ${SPRING_BEZIER},` +
          ` height ${SETTLE_MS}ms ${SPRING_BEZIER}, border-radius ${SETTLE_MS}ms ${SPRING_BEZIER},` +
          ` opacity var(--qz-dur) var(--qz-ease), scale var(--qz-dur) var(--qz-ease),` +
          ` box-shadow var(--qz-dur) var(--qz-ease)`
        : 'opacity var(--qz-dur) var(--qz-ease), scale var(--qz-dur) var(--qz-ease),' +
          ' box-shadow var(--qz-dur) var(--qz-ease)',
  );
</script>

<!-- 整窗任意位置按下 → 置顶（捕获阶段，先于内部处理） -->
<!-- 开/关：in:pop / out:pop（弹簧缩放淡入淡出，首屏已存在的窗口不播放 → 会话还原不闪）。
     最小化/还原：桌面 + 有 Dock 坐标 → 神灯（clip-path 梯形 + 吸入，genie 帧接管）；
     否则降级为 opacity+scale 的 CSS transition（窗口保持挂载，不 display:none）。
     吸附/贴靠/最大化落位：settling 期挂上 SPRING_BEZIER 几何过渡（260ms 轻微回弹）。 -->
<div
  bind:this={el}
  data-window
  class="absolute flex flex-col select-none overflow-hidden border border-qz-border qz-glass"
  {style}
  style:will-change={interacting || genie ? 'transform' : 'auto'}
  style:border-color={active
    ? 'color-mix(in srgb, var(--color-qz-accent) 60%, var(--color-qz-border))'
    : null}
  style:box-shadow={active ? 'var(--qz-shadow-window-active)' : 'var(--qz-shadow-window-inactive)'}
  style:opacity={genie ? genie.opacity : minHidden ? '0' : '1'}
  style:scale={genie ? genie.scale : minHidden ? '0.96' : '1'}
  style:clip-path={genie?.clip ?? null}
  style:pointer-events={minHidden || genie ? 'none' : 'auto'}
  style:transition={winTransition}
  in:pop={{ duration: 190 }}
  out:pop={{ duration: 150 }}
  onpointerdowncapture={() => focus(proc.id)}
>
  <!-- 标题栏：按住拖动；双击最大化/还原。移动端加高到 h-11（触控热区） -->
  <div
    class="flex {viewport.isMobile ? 'h-11' : 'h-9'} shrink-0 cursor-grab items-center gap-3 px-3 active:cursor-grabbing"
    style="border-bottom: 1px solid var(--color-qz-border)"
    role="toolbar"
    tabindex="-1"
    aria-label="窗口标题栏"
    onpointerdown={startDrag}
    onpointermove={onMove}
    onpointerup={onUp}
    ondblclick={onToggleMax}
    oncontextmenu={onTitleMenu}
  >
    <!-- 移动端按钮已真实放大（WindowControls 内部按 viewport 切尺寸），不再 scale -->
    <!-- M8.3：传 active → 非活动窗红绿灯灰化（与阴影景深同语义） -->
    <WindowControls {proc} onTile={tileTo} {onToggleMax} {active} />
    <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-qz-muted">{proc.title}</span>
  </div>

  <!-- 内容：渲染 App 组件。最小化时 content-visibility:hidden → 浏览器跳过其布局/绘制
       （窗口仍挂载以保持还原动画，但不可见内容不再耗渲染；只作用于内容区、不碰标题栏/边框
       动画；flex-1 决定盒子尺寸故不塌陷；还原时移除→重新渲染）。配合 windowVisible() 暂停定时器。 -->
  <div
    class="flex-1 overflow-auto text-qz-text"
    style:content-visibility={minHidden ? 'hidden' : 'visible'}
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
