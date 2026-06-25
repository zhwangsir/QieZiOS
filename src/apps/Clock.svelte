<script lang="ts">
  import { windowVisible } from '../lib/winctx';

  let now = $state(new Date());
  const visible = windowVisible();

  // $effect + 清理函数：每秒更新；最小化时暂停（不白跑），还原自动恢复；销毁清掉定时器
  $effect(() => {
    if (!visible()) return;
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });

  // 指针角度（度）
  const secDeg = $derived(now.getSeconds() * 6);
  const minDeg = $derived(now.getMinutes() * 6 + now.getSeconds() * 0.1);
  const hrDeg = $derived((now.getHours() % 12) * 30 + now.getMinutes() * 0.5);

  const timeStr = $derived(now.toLocaleTimeString('zh-CN', { hour12: false }));
  const dateStr = $derived(
    now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
  );

  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
</script>

<div class="flex h-full flex-col items-center justify-center gap-5 p-4">
  <svg viewBox="0 0 100 100" class="h-44 w-44">
    <circle cx="50" cy="50" r="47" fill="color-mix(in srgb, var(--color-qz-text) 4%, transparent)"
      stroke="var(--color-qz-border)" stroke-width="1.5" />
    {#each ticks as deg (deg)}
      <line x1="50" y1="7" x2="50" y2="12" stroke="var(--color-qz-muted)" stroke-width="1.5"
        transform="rotate({deg} 50 50)" />
    {/each}
    <!-- 时针 -->
    <line x1="50" y1="52" x2="50" y2="29" stroke="var(--color-qz-text)" stroke-width="3.2"
      stroke-linecap="round" transform="rotate({hrDeg} 50 50)" />
    <!-- 分针 -->
    <line x1="50" y1="54" x2="50" y2="19" stroke="var(--color-qz-text)" stroke-width="2.2"
      stroke-linecap="round" transform="rotate({minDeg} 50 50)" />
    <!-- 秒针 -->
    <line x1="50" y1="58" x2="50" y2="15" stroke="var(--color-qz-accent)" stroke-width="1"
      stroke-linecap="round" transform="rotate({secDeg} 50 50)" />
    <circle cx="50" cy="50" r="2.6" fill="var(--color-qz-accent)" />
  </svg>

  <div class="text-center">
    <div class="text-2xl font-semibold tabular-nums">{timeStr}</div>
    <div class="mt-1 text-sm text-qz-muted">{dateStr}</div>
  </div>
</div>
