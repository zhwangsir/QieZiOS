<script lang="ts">
  // M5.4 Home Indicator：底部居中横条，常驻所有窗口之上（低于通知/Exposé）。
  // 单击 → 所有窗口最小化（回主屏）；双击 → 开 Exposé 任务视图。
  import { processes, minimize } from '../../kernel/processes.svelte';
  import { resolvedMode } from '../../system/theme.svelte';
  import { viewport } from '../../system/viewport.svelte';
  import { openExpose } from '../exposeState.svelte';
  import { isDoubleTap, DOUBLE_TAP_MS } from './gesture';

  let lastTap = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function goHome() {
    for (const p of processes) {
      if (!p.minimized) minimize(p.id);
    }
  }

  function onTap() {
    const now = Date.now();
    if (isDoubleTap(now, lastTap)) {
      // 双击：取消待执行的单击动作 → 开任务视图
      clearTimeout(timer);
      lastTap = 0;
      openExpose();
      return;
    }
    lastTap = now;
    // 延迟执行单击，给双击留判定窗口
    timer = setTimeout(() => {
      lastTap = 0;
      goHome();
    }, DOUBLE_TAP_MS);
  }
</script>

<!-- 触控热区（比可视横条大，保证 32px+ 命中）；可视横条 w-32 h-1 -->
<div
  class="absolute inset-x-0 bottom-0 z-[9997] flex items-end justify-center pb-[calc(env(safe-area-inset-bottom)+0.375rem)]"
  role="button"
  tabindex="-1"
  aria-label="回主屏（双击打开任务视图）"
  onpointerup={onTap}
>
  <div class="flex h-6 items-center">
    <div
      class="h-1 w-32 rounded-full transition-colors {resolvedMode() === 'dark'
        ? 'bg-white/85'
        : 'bg-black/70'}"
    ></div>
  </div>
</div>
