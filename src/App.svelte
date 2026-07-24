<script lang="ts">
  import { settings } from './system/settings.svelte';
  import { activeTokens, applyTokens, resolvedMode } from './system/theme.svelte';
  import { setOwnerProvider, setRecentForgetter } from './kernel/vfs.svelte';
  import { forgetRecent } from './system/recents.svelte';
  import { account } from './system/account.svelte';
  import { setShellRunner } from './system/aiTools';
  import { setScheduleRunner } from './system/schedules.svelte';
  import { run as shellRun, newCtx } from './lib/shell';
  import './system/services'; // 登记系统自带服务（通知中心等）
  import { session, power, powerConfirm, cancelShutdown, confirmShutdown } from './system/session.svelte';
  import Desktop from './shell/Desktop.svelte';
  import BootScreen from './shell/boot/BootScreen.svelte';
  import LoginScreen from './shell/boot/LoginScreen.svelte';
  import LockScreen from './shell/boot/LockScreen.svelte';

  // 统一身份：新建文件的属主 = 当前登录账号（未登录 = 访客 qiezi）。
  setOwnerProvider(() => account.username || 'qiezi');

  // 彻底删除文件时把它从「最近文件」抹掉（内核 purge 经注入回调通知 system 层 recents）。
  setRecentForgetter(forgetRecent);

  // AI↔shell 互通：给 AI 的 run_shell 工具接上 shell 运行器（一个常驻 ctx，cd/env 跨调用保留）。
  const aiShellCtx = newCtx();
  setShellRunner(async (command) => {
    const res = await shellRun(command, aiShellCtx);
    if (res.cd) aiShellCtx.cwd = res.cd; // 让 AI 的 cd 在后续命令里生效
    return { out: res.out, err: res.err, code: res.code };
  });

  // 终端定时（at/crontab）：到点的命令也经 shell 跑（独立常驻 ctx，不与 AI 串 cd）。
  const cronShellCtx = newCtx();
  setScheduleRunner(async (command) => {
    const res = await shellRun(command, cronShellCtx);
    if (res.cd) cronShellCtx.cwd = res.cd;
    return { out: res.out, err: res.err, code: res.code };
  });

  // 把主题 token 写进 :root；settings 任意字段一变就重写。
  // $effect 会自动订阅 activeTokens() 里读到的每个 settings 字段。
  // 注意：这里只改 CSS 变量 → 整屏换肤，0 个组件重新渲染。
  $effect(() => {
    applyTokens(activeTokens());
    document.documentElement.style.colorScheme = resolvedMode(); // 用解析后的明/暗（auto/schedule 也对）→ 原生控件/滚动条配色跟上
    // 界面缩放：改根字号 → 所有 rem 尺寸（字号/间距）整体缩放
    document.documentElement.style.fontSize = `${(16 * settings.fontScale).toFixed(2)}px`;
  });

  // 全局自定义 CSS：把用户写的 CSS 注入一个 <style>（深度换肤；用户改即时生效、持久化）
  $effect(() => {
    let el = document.getElementById('qz-custom-css');
    if (!el) {
      el = document.createElement('style');
      el.id = 'qz-custom-css';
      document.head.appendChild(el);
    }
    el.textContent = settings.customCss ?? '';
  });

  // 关机黑屏时：任意键 = 重新启动（reload 回到开机流程）
  function onPowerKey() {
    if (power.off) location.reload();
  }
</script>

<svelte:window onkeydown={onPowerKey} />

<!-- M3/U7 仪式感流程：boot/login 期间不挂载 Desktop（服务/通知在 Desktop 挂载时才启动，见 Desktop onMount）；
     desktop 与 locked 共用同一 Desktop 实例 → 锁定只是盖上锁屏，窗口状态原样保留。 -->
{#if session.phase === 'boot'}
  <BootScreen />
{:else if session.phase === 'login'}
  <LoginScreen />
{:else}
  <Desktop />
  <LockScreen />
{/if}

<!-- 关机确认（U8）：系统菜单「关机」弹出；Esc 取消 / Enter 确认（键盘由 Desktop 全局 handler 统一接） -->
{#if powerConfirm.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[10009] grid select-none place-items-center bg-black/45"
    onclick={cancelShutdown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="w-72 rounded-qz border border-qz-border qz-glass qz-glass-float p-5"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" class="h-8 w-8" draggable="false" />
        <div class="text-sm font-semibold text-qz-text">确定要关机吗？</div>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-qz-muted">桌面布局与文件已自动保存，重新启动后原样还原。</p>
      <div class="mt-4 flex justify-end gap-2 text-xs">
        <button
          class="rounded-qz px-3 py-1.5 ring-1 ring-qz-border transition hover:bg-qz-elevated"
          onclick={cancelShutdown}>取消</button>
        <button
          class="rounded-qz bg-red-500 px-3 py-1.5 font-medium text-white transition active:scale-95"
          onclick={confirmShutdown}>关机</button>
      </div>
    </div>
  </div>
{/if}

<!-- 关机（U8）：确认后整屏黑屏「已关机」，点击或按任意键 = 重新启动（reload → 重新开机） -->
{#if power.off}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[10010] flex select-none flex-col items-center justify-center gap-4 bg-black"
    onclick={() => location.reload()}
  >
    <img src="/favicon.svg" alt="" class="h-14 w-14 opacity-30 grayscale" draggable="false" />
    <div class="text-sm tracking-[0.3em] text-white/60">已关机</div>
    <div class="text-xs text-white/35">点击或按任意键重新启动</div>
  </div>
{/if}

<!-- U2 玻璃折射滤镜（Liquid Glass 配方：turbulence → blur → displacement）。
     供 qz-glass 的 backdrop-filter: url(#qz-glass-refraction) 引用；默认关，设置 → 玻璃折射 可开。 -->
<svg aria-hidden="true" style="position: absolute; width: 0; height: 0; overflow: hidden">
  <filter id="qz-glass-refraction">
    <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="noise" />
    <feGaussianBlur in="noise" stdDeviation="2.2" result="soft" />
    <feDisplacementMap in="SourceGraphic" in2="soft" scale="12" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>
