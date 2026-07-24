<script lang="ts">
  // M5.2 移动状态栏：替代桌面 TopBar。左侧实时时钟，右侧 信号/Wi-Fi/电池 + 电量百分比，
  // 点右侧区域 → 开控制中心。safe-area 顶部内边距 + 毛玻璃。
  import Signal from '@lucide/svelte/icons/signal';
  import Wifi from '@lucide/svelte/icons/wifi';
  import BatteryFull from '@lucide/svelte/icons/battery-full';
  import BatteryMedium from '@lucide/svelte/icons/battery-medium';
  import BatteryLow from '@lucide/svelte/icons/battery-low';
  import { openControlCenter } from './mobileUi.svelte';

  // 实时时钟（HH:MM），镜像顶栏模式：interval + effect 清理函数
  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });
  const clock = $derived(
    now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
  );

  // 电池电量（best-effort：Battery Status API 非全平台支持，拿不到就只显图标不显百分比）
  interface BatteryLike {
    level: number;
    addEventListener?: (type: string, fn: () => void) => void;
    removeEventListener?: (type: string, fn: () => void) => void;
  }
  let level = $state<number | null>(null);
  $effect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery) return;
    let alive = true;
    let batt: BatteryLike | null = null;
    const update = () => {
      if (batt) level = Math.round(batt.level * 100);
    };
    nav
      .getBattery()
      .then((b) => {
        if (!alive) return;
        batt = b;
        update();
        b.addEventListener?.('levelchange', update);
      })
      .catch(() => {});
    return () => {
      alive = false;
      batt?.removeEventListener?.('levelchange', update);
    };
  });
</script>

<div
  class="absolute inset-x-0 top-0 z-[9998] flex items-center justify-between border-b border-qz-border px-5 pb-1 qz-glass pt-[calc(env(safe-area-inset-top)+0.5rem)]"
>
  <!-- 左侧：实时时钟 -->
  <span class="select-none text-sm font-semibold tabular-nums text-qz-text">{clock}</span>

  <!-- 中间留白（灵动岛胶囊浮在这一层之上） -->
  <div class="flex-1"></div>

  <!-- 右侧：信号 / Wi-Fi / 电池。点击 → 控制中心 -->
  <button
    class="flex min-h-8 items-center gap-1.5 rounded-full px-2 text-qz-text active:opacity-60"
    title="控制中心"
    aria-label="打开控制中心"
    onclick={openControlCenter}
  >
    <Signal size={15} strokeWidth={2.2} />
    <Wifi size={15} strokeWidth={2.2} />
    <span class="flex items-center gap-0.5">
      {#if level !== null}
        <span class="text-[11px] tabular-nums text-qz-muted">{level}%</span>
      {/if}
      {#if level !== null && level <= 20}
        <BatteryLow size={19} />
      {:else if level !== null && level <= 60}
        <BatteryMedium size={19} />
      {:else}
        <BatteryFull size={19} />
      {/if}
    </span>
  </button>
</div>
