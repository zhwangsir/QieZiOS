<script lang="ts">
  import { close, minimize, toggleMaximize, type Process } from '../kernel/processes.svelte';

  // onTile：把窗口贴靠到某布局区（由 Window 计算几何并 setBounds）
  let { proc, onTile }: { proc: Process; onTile?: (zone: string) => void } = $props();

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
<div class="group/tl flex items-center gap-2" role="group" aria-label="窗口操作" onpointerdown={(e) => e.stopPropagation()}>
  <button
    class="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#ff5f57] text-[8px] leading-none text-black/60"
    aria-label="关闭"
    onclick={() => close(proc.id)}
  >
    <span class="opacity-0 transition-opacity group-hover/tl:opacity-100">✕</span>
  </button>
  <button
    class="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#febc2e] text-[9px] leading-none text-black/60"
    aria-label="最小化"
    onclick={() => minimize(proc.id)}
  >
    <span class="opacity-0 transition-opacity group-hover/tl:opacity-100">−</span>
  </button>
  <!-- 最大化键 + 悬停贴靠布局浮层 -->
  <div class="group/max relative">
    <button
      class="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#28c840] text-[8px] leading-none text-black/60"
      aria-label={proc.maximized ? '还原' : '最大化'}
      onclick={() => toggleMaximize(proc.id)}
    >
      <span class="opacity-0 transition-opacity group-hover/tl:opacity-100">+</span>
    </button>
    <!-- 浮层：默认隐藏，悬停最大化键(或浮层自身)时显示。pt-2 桥接鼠标从按钮到浮层不断 hover -->
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
  </div>
</div>
