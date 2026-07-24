<script lang="ts">
  // M3/U7 统一锁屏（桌面 + 移动共用，由 M5 的 MobileLockScreen 泛化而来）：
  // 壁纸 + 大时钟 + 当前用户 + 解锁提示。锁定 = session.phase 'locked'，全屏覆盖，
  // 解锁回 desktop，窗口状态不动。
  // 解锁方式：移动端 = 上滑手势（判定在 mobile/gesture.ts 纯函数）；桌面端 = 上滑 / 点击 / 任意键。
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import { viewport } from '../../system/viewport.svelte';
  import { session, unlock } from '../../system/session.svelte';
  import { currentUser } from '../../system/account.svelte';
  import { shouldUnlock, rubberBand } from '../mobile/gesture';
  import Icon from '../../lib/Icon.svelte';

  // 锁屏上显示的用户：登录页选过的用 session.user，否则回退当前账号身份（访客 qiezi）
  const name = $derived(session.user || currentUser());

  // 大时钟 / 日期（每秒走）
  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });
  const clock = $derived(
    now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
  );
  const date = $derived(
    now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
  );

  // ── 上滑解锁手势（两端通用；桌面端另有点击/按键捷径） ──
  let offset = $state(0); // 跟手位移（≤0）
  let dragging = $state(false);
  let startY = 0;
  let unlockTimer: ReturnType<typeof setTimeout> | undefined;

  function doUnlock() {
    offset = -window.innerHeight; // 顺势飞出
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(unlock, viewport.reducedMotion ? 0 : 240);
  }
  function onDown(e: PointerEvent) {
    dragging = true;
    startY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return;
    offset = rubberBand(e.clientY - startY); // 上滑为负，带阻尼；下滑归零
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (shouldUnlock(offset, window.innerHeight)) {
      doUnlock();
    } else if (!viewport.isMobile && offset === 0) {
      doUnlock(); // 桌面端：无位移的指针抬起 = 点击 → 解锁
    } else {
      offset = 0; // 弹簧回弹
    }
  }
  // 桌面端：任意键解锁（仅锁屏阶段响应；锁屏期间 Desktop 的全局快捷键已被 phase 守卫拦下）
  function onKey() {
    if (session.phase !== 'locked') return;
    if (!viewport.isMobile) doUnlock();
  }

  // 拖动越深越透明（飞出时恰好到 0）
  const fade = $derived(Math.max(0, 1 + offset / window.innerHeight));
  const motion = $derived(
    dragging
      ? 'none'
      : 'transform 240ms var(--qz-ease), opacity 240ms var(--qz-ease)',
  );
</script>

<!-- 桌面端任意键解锁（Svelte 5 要求 svelte:window 在组件顶层；条件守卫收进 handler） -->
<svelte:window onkeydown={onKey} />

{#if session.phase === 'locked'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10003] flex select-none flex-col items-center justify-between px-8 pb-[calc(env(safe-area-inset-bottom)+3.5rem)] pt-[calc(env(safe-area-inset-top)+5rem)]"
    style="background: var(--qz-wallpaper); touch-action: none;
           transform: translateY({offset}px); opacity: {fade}; transition: {motion};"
    role="button"
    tabindex="-1"
    aria-label={viewport.isMobile ? '向上轻扫以解锁' : '点击或按任意键解锁'}
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
  >
    <!-- 景深压暗（与桌面同款 vignette，锁屏文字更立体） -->
    <div
      class="pointer-events-none absolute inset-0"
      style="background: radial-gradient(125% 85% at 50% 0%, transparent 55%, rgb(0 0 0 / 0.28));"
    ></div>

    <!-- 大时钟 + 日期 + 当前用户 -->
    <div class="pointer-events-none relative mt-6 flex flex-col items-center text-center text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
      <div class="text-lg font-medium opacity-90">{date}</div>
      <div class="mt-1 text-[5rem] font-semibold leading-none tracking-tight tabular-nums">{clock}</div>
      <div class="mt-4 flex items-center gap-2 opacity-90">
        <span class="grid h-7 w-7 place-items-center rounded-full bg-white/20 text-xs font-semibold backdrop-blur-md">
          {name[0].toUpperCase()}
        </span>
        <span class="text-sm font-medium">{name}</span>
      </div>
    </div>

    <!-- 解锁提示 -->
    <div class="pointer-events-none relative flex flex-col items-center gap-1 text-white/85">
      {#if viewport.isMobile}
        <ChevronUp size={22} class="motion-safe:animate-bounce" />
        <span class="text-sm font-medium tracking-wide">向上轻扫以解锁</span>
      {:else}
        <Icon name="LockOpen" size={20} />
        <span class="text-sm font-medium tracking-wide">点击或按任意键解锁</span>
      {/if}
    </div>
  </div>
{/if}
