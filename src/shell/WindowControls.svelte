<script lang="ts">
  import { close, minimize, toggleMaximize, type Process } from '../kernel/processes.svelte';
  import { viewport } from '../system/viewport.svelte';

  // onTile：把窗口贴靠到某布局区（由 Window 计算几何并 setBounds）
  // onToggleMax：由 Window 注入（翻状态前先挂弹簧落位过渡）；缺省回退内核直调
  // M8.3 active：非活动窗口红绿灯灰化（macOS 语义——后台窗三灯统一退为石墨灰）
  let {
    proc,
    onTile,
    onToggleMax,
    active = true,
  }: { proc: Process; onTile?: (zone: string) => void; onToggleMax?: () => void; active?: boolean } = $props();

  // 移动端：真实放大按钮尺寸（占布局），不再用 scale 视觉放大（会盖标题文字）
  // 桌面端 M8.3：h-3 w-3 = 12px，与真实 macOS 红绿灯直径一致
  const btnSize = $derived(viewport.isMobile ? 'h-5 w-5' : 'h-3 w-3');
  const gap = $derived(viewport.isMobile ? 'gap-3' : 'gap-2');

  // M8.3：inset 1px 内阴影制造小球体积感（macos27 同款 inset 0 0 1px rgba(0,0,0,.25)）
  const ballShadow = 'inset 0 0 1px rgb(0 0 0 / 0.25)';
  // 非活动窗口三灯统一灰化（macOS #D6D6D6；深色 UI 用略亮的石墨灰保持可辨）
  const gray = '#8e8e93';

  // 贴靠布局区（R4-F8）：悬停最大化键弹出。图标用方块象形字，title 给中文名。
  const HALVES = [
    { k: 'left', i: '◧', t: '左半屏' },
    { k: 'right', i: '◨', t: '右半屏' },
    { k: 'top', i: '⬒', t: '上半屏' },
    { k: 'bottom', i: '⬓', t: '下半屏' },
  ];
  const QUARTERS = [
    { k: 'tl', i: '◰', t: '左上' },
    { k: 'tr', i: '◳', t: '右上' },
    { k: 'bl', i: '◱', t: '左下' },
    { k: 'br', i: '◲', t: '右下' },
  ];
  const THIRDS = [
    { k: 'lthird', i: '左⅓', t: '左三分之一' },
    { k: 'cthird', i: '中⅓', t: '中三分之一' },
    { k: 'rthird', i: '右⅓', t: '右三分之一' },
  ];
</script>

<!-- 红绿灯控件。onpointerdown 阻断冒泡，否则点按钮会被标题栏当成「开始拖拽」 -->
<!-- M8.3：活动窗三色（官方值 #FF5F57/#FEBC2E/#28C840）+ inset 体积感；非活动窗三灯灰化 -->
<div class="group/tl flex items-center {gap}" role="group" aria-label="窗口操作" onpointerdown={(e) => e.stopPropagation()}>
  <button
    class="grid {btnSize} place-items-center rounded-full text-[8px] leading-none text-black/60"
    style="background-color: {active ? '#ff5f57' : gray}; box-shadow: {ballShadow}; transition: background-color var(--qz-dur) var(--qz-ease);"
    aria-label="关闭"
    onclick={() => close(proc.id)}
  >
    <span class="opacity-0 transition-opacity group-hover/tl:opacity-100">✕</span>
  </button>
  <button
    class="grid {btnSize} place-items-center rounded-full text-[9px] leading-none text-black/60"
    style="background-color: {active ? '#febc2e' : gray}; box-shadow: {ballShadow}; transition: background-color var(--qz-dur) var(--qz-ease);"
    aria-label="最小化"
    onclick={() => minimize(proc.id)}
  >
    <span class="opacity-0 transition-opacity group-hover/tl:opacity-100">−</span>
  </button>
  <!-- 最大化键 + 悬停贴靠布局浮层（移动端无贴靠，不渲染浮层） -->
  <div class="group/max relative">
    <button
      class="grid {btnSize} place-items-center rounded-full text-[8px] leading-none text-black/60"
      style="background-color: {active ? '#28c840' : gray}; box-shadow: {ballShadow}; transition: background-color var(--qz-dur) var(--qz-ease);"
      aria-label={proc.maximized ? '还原' : '最大化'}
      onclick={() => (onToggleMax ? onToggleMax() : toggleMaximize(proc.id))}
    >
      <span class="opacity-0 transition-opacity group-hover/tl:opacity-100">+</span>
    </button>
    <!-- 浮层：默认隐藏，悬停最大化键(或浮层自身)时显示。pt-2 桥接鼠标从按钮到浮层不断 hover -->
    {#if !viewport.isMobile}
    <div class="absolute left-0 top-full z-50 hidden pt-2 group-hover/max:block" data-tile-flyout>
      <div class="flex flex-col gap-1 rounded-lg border border-qz-border p-1.5 text-[13px] qz-glass shadow-xl shadow-black/40">
        <div class="flex gap-1">
          {#each HALVES as z (z.k)}
            <button class="grid h-7 w-7 place-items-center rounded hover:bg-qz-accent hover:text-qz-accent-contrast" title={z.t} data-zone={z.k} onclick={() => onTile?.(z.k)}>{z.i}</button>
          {/each}
        </div>
        <div class="flex gap-1">
          {#each QUARTERS as z (z.k)}
            <button class="grid h-7 w-7 place-items-center rounded hover:bg-qz-accent hover:text-qz-accent-contrast" title={z.t} data-zone={z.k} onclick={() => onTile?.(z.k)}>{z.i}</button>
          {/each}
        </div>
        <div class="flex gap-1">
          {#each THIRDS as z (z.k)}
            <button class="grid h-7 flex-1 place-items-center rounded text-[11px] hover:bg-qz-accent hover:text-qz-accent-contrast" title={z.t} data-zone={z.k} onclick={() => onTile?.(z.k)}>{z.i}</button>
          {/each}
        </div>
        <button class="grid h-6 place-items-center rounded text-[11px] hover:bg-qz-accent hover:text-qz-accent-contrast" title="最大化" data-zone="max" onclick={() => onTile?.('max')}>⛶ 最大化</button>
      </div>
    </div>
    {/if}
  </div>
</div>
