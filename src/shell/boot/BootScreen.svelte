<script lang="ts">
  // M3/U7 开机画面：居中 logo + 进度条（1.5s 模拟；hydrate 在 main.ts 挂载前已完成）。
  // 尊重两条「跳过」路径：设置里的 sessionPrefs.skipBoot（永久跳过）、系统「减少动态」
  // （reducedMotion 不放动画直接进下一步）。
  import { onMount } from 'svelte';
  import { viewport } from '../../system/viewport.svelte';
  import { sessionPrefs, bootComplete } from '../../system/session.svelte';

  let progress = $state(0);

  onMount(() => {
    // 跳过开机动画 / 减少动态：立刻完成开机，不进 rAF 循环
    if (sessionPrefs.skipBoot || viewport.reducedMotion) {
      bootComplete();
      return;
    }
    const DURATION = 1500; // 1.2–1.8s 区间取中
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / DURATION);
      progress = k;
      if (k < 1) raf = requestAnimationFrame(tick);
      else bootComplete();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf); // 组件提前卸载时停掉循环，防泄漏
  });
</script>

<div class="fixed inset-0 z-[10004] flex select-none flex-col items-center justify-center bg-black">
  <img src="/favicon.svg" alt="QieZiOS" class="h-20 w-20" draggable="false" />
  <div class="mt-12 h-1 w-44 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="正在启动">
    <div class="h-full rounded-full bg-white/90" style="width: {(progress * 100).toFixed(1)}%"></div>
  </div>
</div>
