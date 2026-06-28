<script lang="ts">
  import { widgets, removeWidget, cycleWidgetKind, type Widget } from './widgetState.svelte';
  import { sys } from '../system/sys';

  // 单个每秒 tick 驱动时钟/日历；只在有小组件时跑，避免空转（读 list.length → 增删时自动重新武装）
  let now = $state(new Date());
  $effect(() => {
    if (widgets.list.length === 0) return;
    const t = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(t);
  });

  // 时钟表盘（复用 Clock App 的 SVG 几何）
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  const hrDeg = $derived((now.getHours() % 12) * 30 + now.getMinutes() * 0.5);
  const minDeg = $derived(now.getMinutes() * 6 + now.getSeconds() * 0.1);
  const secDeg = $derived(now.getSeconds() * 6);
  const timeStr = $derived(now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));

  // 日历
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  const dateStr = $derived(`${now.getFullYear()} 年 ${now.getMonth() + 1} 月`);
  const today = $derived(now.getDate());
  const cells = $derived.by<(number | null)[]>(() => {
    const y = now.getFullYear(),
      m = now.getMonth();
    const first = new Date(y, m, 1).getDay(); // 0=周日
    const days = new Date(y, m + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < first; i++) arr.push(null);
    for (let d = 1; d <= days; d++) arr.push(d);
    return arr;
  });

  // 系统状态：进程数（reactive，读 sys.proc.list）
  const procCount = $derived(sys.proc.list().length);

  // 拖动（镜像 StickyNotes：仅顶栏手柄可拖，夹在视口内）
  let drag: { id: string; sx: number; sy: number; ox: number; oy: number } | null = null;
  function start(e: PointerEvent, w: Widget) {
    if (e.button !== 0) return;
    drag = { id: w.id, sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const w = widgets.list.find((x) => x.id === drag!.id);
    if (!w) return;
    w.x = Math.min(Math.max(0, drag.ox + (e.clientX - drag.sx)), Math.max(0, window.innerWidth - 40));
    w.y = Math.min(Math.max(36, drag.oy + (e.clientY - drag.sy)), Math.max(36, window.innerHeight - 40));
  }
  function end(e: PointerEvent) {
    drag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
</script>

<!-- 小组件层：容器穿透点击（空白处右键落到桌面），单个小组件可交互。在图标之上、窗口之下。 -->
<div class="pointer-events-none absolute inset-0">
  {#each widgets.list as w (w.id)}
    <div
      class="pointer-events-auto absolute overflow-hidden rounded-xl border border-qz-border qz-glass shadow-xl shadow-black/30"
      style="left: {w.x}px; top: {w.y}px"
    >
      <!-- 手柄：拖动 + 切类型 + 移除 -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex cursor-move items-center justify-end gap-1 px-1.5 py-0.5"
        style="background: rgb(0 0 0 / 0.08)"
        onpointerdown={(e) => start(e, w)}
        onpointermove={move}
        onpointerup={end}
      >
        <button class="rounded px-1 text-[11px] text-qz-muted hover:bg-qz-elevated" title="切换类型" onclick={() => cycleWidgetKind(w.id)}>⟳</button>
        <button class="rounded px-1 text-[11px] text-qz-muted hover:bg-qz-elevated" title="移除小组件" onclick={() => removeWidget(w.id)}>✕</button>
      </div>
      <div class="grid place-items-center p-3">
        {#if w.kind === 'clock'}
          <svg viewBox="0 0 100 100" class="h-28 w-28">
            <circle cx="50" cy="50" r="47" fill="color-mix(in srgb, var(--color-qz-text) 4%, transparent)" stroke="var(--color-qz-border)" stroke-width="1.5" />
            {#each ticks as deg (deg)}
              <line x1="50" y1="7" x2="50" y2="12" stroke="var(--color-qz-muted)" stroke-width="1.5" transform="rotate({deg} 50 50)" />
            {/each}
            <line x1="50" y1="52" x2="50" y2="29" stroke="var(--color-qz-text)" stroke-width="3.2" stroke-linecap="round" transform="rotate({hrDeg} 50 50)" />
            <line x1="50" y1="54" x2="50" y2="19" stroke="var(--color-qz-text)" stroke-width="2.2" stroke-linecap="round" transform="rotate({minDeg} 50 50)" />
            <line x1="50" y1="58" x2="50" y2="15" stroke="var(--color-qz-accent)" stroke-width="1" stroke-linecap="round" transform="rotate({secDeg} 50 50)" />
            <circle cx="50" cy="50" r="2.6" fill="var(--color-qz-accent)" />
          </svg>
          <div class="mt-1 text-sm font-semibold tabular-nums">{timeStr}</div>
        {:else if w.kind === 'calendar'}
          <div class="w-44">
            <div class="mb-1 text-center text-xs font-medium text-qz-muted">{dateStr}</div>
            <div class="grid grid-cols-7 gap-0.5 text-center text-[10px]">
              {#each WEEK as wd (wd)}<div class="text-qz-muted">{wd}</div>{/each}
              {#each cells as c, i (i)}
                <div class="rounded py-0.5 {c === today ? 'bg-qz-accent font-semibold text-qz-accent-contrast' : 'text-qz-text'}">{c ?? ''}</div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="w-32 py-2 text-center">
            <div class="text-3xl font-semibold tabular-nums text-qz-accent">{procCount}</div>
            <div class="text-[11px] text-qz-muted">运行中进程</div>
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>
