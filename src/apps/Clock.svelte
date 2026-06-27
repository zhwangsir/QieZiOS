<script lang="ts">
  import { windowVisible } from '../lib/winctx';
  import { sys } from '../system/sys';
  import { playSound } from '../system/sound';

  type Tab = 'clock' | 'stopwatch' | 'timer' | 'world';
  let tab = $state<Tab>('clock');

  let now = $state(new Date());
  const visible = windowVisible();

  // 每秒：驱动时钟表盘 + 世界时钟。最小化暂停、还原恢复、销毁清定时器。
  $effect(() => {
    if (!visible()) return;
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });

  // ── 秒表 / 计时器：需要更细的 tick（50ms），仅在运行且窗口可见时跑 ──
  let nowPerf = $state(performance.now());
  $effect(() => {
    if (!visible() || !(swRunning || timerRunning)) return;
    const t = setInterval(() => {
      nowPerf = performance.now();
      // 计时器到点：在 tick 里收口（避免自引用 effect），发通知 + 音效，只触发一次
      if (timerRunning && timerEnd - nowPerf <= 0) {
        timerRunning = false;
        timerRemain = 0;
        sys.notify('⏲ 计时结束', { body: '倒计时到了', level: 'success' });
        playSound('notify');
      }
    }, 50);
    return () => clearInterval(t);
  });

  // 时钟指针角度
  const secDeg = $derived(now.getSeconds() * 6);
  const minDeg = $derived(now.getMinutes() * 6 + now.getSeconds() * 0.1);
  const hrDeg = $derived((now.getHours() % 12) * 30 + now.getMinutes() * 0.5);
  const timeStr = $derived(now.toLocaleTimeString('zh-CN', { hour12: false }));
  const dateStr = $derived(
    now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
  );
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);

  const pad = (n: number) => String(n).padStart(2, '0');

  // ── 秒表 ──
  let swRunning = $state(false);
  let swBase = $state(0); // 已累计 ms
  let swStart = $state(0); // 本次启动的 performance.now 基准
  let swLaps = $state<number[]>([]);
  const swElapsed = $derived(swBase + (swRunning ? nowPerf - swStart : 0));
  function swToggle() {
    if (swRunning) {
      swBase = swBase + (performance.now() - swStart); // 落定累计
      swRunning = false;
    } else {
      swStart = performance.now();
      nowPerf = swStart;
      swRunning = true;
    }
  }
  function swLap() {
    if (swRunning || swBase) swLaps = [swElapsed, ...swLaps];
  }
  function swReset() {
    swRunning = false;
    swBase = 0;
    swLaps = [];
  }
  function fmtSW(ms: number): string {
    const cs = Math.floor(ms / 10) % 100;
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000);
    return `${pad(m)}:${pad(s)}.${pad(cs)}`;
  }

  // ── 计时器（倒计时）──
  let timerRunning = $state(false);
  let timerEnd = $state(0); // performance.now 目标点
  let timerRemain = $state(0); // 暂停/空闲时保留的剩余 ms
  let inMin = $state(5);
  let inSec = $state(0);
  const idle = $derived(!timerRunning && timerRemain <= 0);
  const remaining = $derived(timerRunning ? Math.max(0, timerEnd - nowPerf) : timerRemain);
  function timerStart() {
    const dur = timerRemain > 0 ? timerRemain : (Math.max(0, inMin) * 60 + Math.max(0, inSec)) * 1000;
    if (dur <= 0) return;
    timerEnd = performance.now() + dur;
    nowPerf = performance.now();
    timerRunning = true;
  }
  function timerPause() {
    timerRemain = remaining;
    timerRunning = false;
  }
  function timerReset() {
    timerRunning = false;
    timerRemain = 0;
  }
  function fmtTimer(ms: number): string {
    const total = Math.ceil(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // ── 世界时钟 ──
  const ZONES: [string, string | undefined][] = [
    ['本地', undefined],
    ['洛杉矶', 'America/Los_Angeles'],
    ['纽约', 'America/New_York'],
    ['伦敦', 'Europe/London'],
    ['巴黎', 'Europe/Paris'],
    ['东京', 'Asia/Tokyo'],
    ['悉尼', 'Australia/Sydney'],
  ];
  function zoneTime(tz: string | undefined): string {
    void now; // 订阅每秒更新
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        ...(tz ? { timeZone: tz } : {}),
      }).format(now);
    } catch {
      return '—';
    }
  }
  function zoneDay(tz: string | undefined): string {
    void now;
    try {
      return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', ...(tz ? { timeZone: tz } : {}) }).format(now);
    } catch {
      return '';
    }
  }

  const TABS: [Tab, string][] = [
    ['clock', '时钟'],
    ['stopwatch', '秒表'],
    ['timer', '计时器'],
    ['world', '世界时钟'],
  ];
</script>

<div class="flex h-full flex-col">
  <!-- 分段切换 -->
  <div class="flex shrink-0 gap-1 border-b border-qz-border p-1.5 text-xs">
    {#each TABS as [id, label] (id)}
      <button
        class="flex-1 rounded px-2 py-1 transition"
        class:bg-qz-accent={tab === id}
        class:text-qz-accent-contrast={tab === id}
        class:hover:bg-qz-elevated={tab !== id}
        onclick={() => (tab = id)}>{label}</button>
    {/each}
  </div>

  <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-4">
    {#if tab === 'clock'}
      <svg viewBox="0 0 100 100" class="h-40 w-40">
        <circle cx="50" cy="50" r="47" fill="color-mix(in srgb, var(--color-qz-text) 4%, transparent)" stroke="var(--color-qz-border)" stroke-width="1.5" />
        {#each ticks as deg (deg)}
          <line x1="50" y1="7" x2="50" y2="12" stroke="var(--color-qz-muted)" stroke-width="1.5" transform="rotate({deg} 50 50)" />
        {/each}
        <line x1="50" y1="52" x2="50" y2="29" stroke="var(--color-qz-text)" stroke-width="3.2" stroke-linecap="round" transform="rotate({hrDeg} 50 50)" />
        <line x1="50" y1="54" x2="50" y2="19" stroke="var(--color-qz-text)" stroke-width="2.2" stroke-linecap="round" transform="rotate({minDeg} 50 50)" />
        <line x1="50" y1="58" x2="50" y2="15" stroke="var(--color-qz-accent)" stroke-width="1" stroke-linecap="round" transform="rotate({secDeg} 50 50)" />
        <circle cx="50" cy="50" r="2.6" fill="var(--color-qz-accent)" />
      </svg>
      <div class="text-center">
        <div class="text-2xl font-semibold tabular-nums">{timeStr}</div>
        <div class="mt-1 text-sm text-qz-muted">{dateStr}</div>
      </div>
    {:else if tab === 'stopwatch'}
      <div class="text-5xl font-light tabular-nums">{fmtSW(swElapsed)}</div>
      <div class="flex gap-2">
        <button class="rounded-qz bg-qz-accent px-4 py-1.5 text-sm font-medium text-qz-accent-contrast active:scale-95" onclick={swToggle}>{swRunning ? '暂停' : '开始'}</button>
        <button class="rounded-qz bg-qz-elevated px-4 py-1.5 text-sm active:scale-95 disabled:opacity-40" disabled={!swRunning && !swBase} onclick={swLap}>计圈</button>
        <button class="rounded-qz bg-qz-elevated px-4 py-1.5 text-sm active:scale-95 disabled:opacity-40" disabled={!swBase && !swRunning && swLaps.length === 0} onclick={swReset}>复位</button>
      </div>
      {#if swLaps.length}
        <div class="max-h-32 w-full max-w-xs overflow-auto rounded-qz bg-qz-surface/60 p-2 text-sm tabular-nums">
          {#each swLaps as lap, i (swLaps.length - i)}
            <div class="flex justify-between px-1 py-0.5"><span class="text-qz-muted">第 {swLaps.length - i} 圈</span><span>{fmtSW(lap)}</span></div>
          {/each}
        </div>
      {/if}
    {:else if tab === 'timer'}
      {#if idle}
        <div class="flex items-end gap-2 tabular-nums">
          <label class="flex flex-col items-center text-[11px] text-qz-muted">分
            <input type="number" min="0" max="999" class="w-16 rounded bg-qz-surface px-2 py-1 text-center text-2xl outline-none ring-1 ring-qz-border focus:ring-qz-accent" bind:value={inMin} />
          </label>
          <span class="pb-2 text-2xl">:</span>
          <label class="flex flex-col items-center text-[11px] text-qz-muted">秒
            <input type="number" min="0" max="59" class="w-16 rounded bg-qz-surface px-2 py-1 text-center text-2xl outline-none ring-1 ring-qz-border focus:ring-qz-accent" bind:value={inSec} />
          </label>
        </div>
        <button class="rounded-qz bg-qz-accent px-5 py-1.5 text-sm font-medium text-qz-accent-contrast active:scale-95 disabled:opacity-40" disabled={inMin <= 0 && inSec <= 0} onclick={timerStart}>开始</button>
      {:else}
        <div class="text-5xl font-light tabular-nums" class:text-qz-accent={remaining <= 0}>{fmtTimer(remaining)}</div>
        <div class="flex gap-2">
          {#if timerRunning}
            <button class="rounded-qz bg-qz-elevated px-4 py-1.5 text-sm active:scale-95" onclick={timerPause}>暂停</button>
          {:else}
            <button class="rounded-qz bg-qz-accent px-4 py-1.5 text-sm font-medium text-qz-accent-contrast active:scale-95" onclick={timerStart}>继续</button>
          {/if}
          <button class="rounded-qz bg-qz-elevated px-4 py-1.5 text-sm active:scale-95" onclick={timerReset}>复位</button>
        </div>
      {/if}
    {:else}
      <div class="w-full max-w-xs overflow-auto">
        {#each ZONES as [name, tz] (name)}
          <div class="flex items-center justify-between border-b border-qz-border/50 px-1 py-2">
            <div><div class="text-sm">{name}</div><div class="text-[11px] text-qz-muted">{zoneDay(tz)}</div></div>
            <div class="text-xl tabular-nums">{zoneTime(tz)}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
