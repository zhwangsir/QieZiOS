<script lang="ts">
  import { close, minimize, toggleMaximize, type Process } from '../kernel/processes.svelte';

  let { proc }: { proc: Process } = $props();
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
  <button
    class="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#28c840] text-[8px] leading-none text-black/60"
    aria-label={proc.maximized ? '还原' : '最大化'}
    onclick={() => toggleMaximize(proc.id)}
  >
    <span class="opacity-0 transition-opacity group-hover/tl:opacity-100">+</span>
  </button>
</div>
