<script lang="ts">
  // 顶栏快捷设置面板（R5-F2）：把常用开关收进一个 ⚙️ 下拉——外观(明/暗/自动/定时)、勿扰、
  // 声音开关+音量、主色、下一张壁纸。多为已有状态的接线，少开 Settings App。
  // 自管开关 + 点外部关闭，镜像通知中心托盘的模式。
  import { settings, accentPresets } from '../system/settings.svelte';
  import { dnd } from '../system/dnd.svelte';
  import { soundPrefs } from '../system/sound';
  import { wallpapers } from '../system/wallpaper';

  let open = $state(false);
  let el = $state<HTMLElement>();
  function onWindowClick(e: MouseEvent) {
    if (open && el && !el.contains(e.target as Node)) open = false;
  }

  const modes: Array<[typeof settings.mode, string]> = [
    ['light', '明'],
    ['dark', '暗'],
    ['auto', '自动'],
    ['schedule', '定时'],
  ];

  function nextWallpaper() {
    const ids = wallpapers.map((w) => w.id);
    const i = ids.indexOf(settings.wallpaperId);
    settings.customWallpaper = null; // 清掉自定义壁纸 → 预设可见
    settings.wallpaperId = ids[(i + 1) % ids.length];
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="relative" bind:this={el}>
  <button
    class="grid h-6 w-6 place-items-center rounded text-sm hover:bg-qz-elevated"
    class:bg-qz-elevated={open}
    title="快捷设置"
    onclick={() => (open = !open)}>⚙️</button>

  {#if open}
    <div
      class="absolute right-0 top-full z-[9999] mt-1.5 flex w-64 flex-col gap-3 rounded-qz border border-qz-border p-3 qz-glass shadow-2xl shadow-black/40"
    >
      <!-- 外观 -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-qz-muted">外观</span>
        <div class="grid grid-cols-4 gap-1">
          {#each modes as [val, label] (val)}
            <button
              class="rounded px-1 py-1 text-xs transition-colors"
              class:bg-qz-accent={settings.mode === val}
              class:text-qz-accent-contrast={settings.mode === val}
              class:bg-qz-elevated={settings.mode !== val}
              onclick={() => (settings.mode = val)}>{label}</button>
          {/each}
        </div>
      </div>

      <!-- 勿扰 -->
      <button
        class="flex items-center justify-between rounded-md bg-qz-elevated px-2.5 py-1.5 text-xs transition hover:brightness-110"
        onclick={() => (dnd.enabled = !dnd.enabled)}
      >
        <span>🤫 勿扰</span>
        <span class="rounded-full px-2 py-0.5 text-[10px] {dnd.enabled ? 'bg-qz-accent text-qz-accent-contrast' : 'bg-qz-surface text-qz-muted'}">{dnd.enabled ? '开' : '关'}</span>
      </button>

      <!-- 声音 -->
      <div class="flex flex-col gap-1.5">
        <button
          class="flex items-center justify-between rounded-md bg-qz-elevated px-2.5 py-1.5 text-xs transition hover:brightness-110"
          onclick={() => (soundPrefs.enabled = !soundPrefs.enabled)}
        >
          <span>🔊 声音</span>
          <span class="rounded-full px-2 py-0.5 text-[10px] {soundPrefs.enabled ? 'bg-qz-accent text-qz-accent-contrast' : 'bg-qz-surface text-qz-muted'}">{soundPrefs.enabled ? '开' : '关'}</span>
        </button>
        {#if soundPrefs.enabled}
          <input type="range" min="0" max="1" step="0.05" bind:value={soundPrefs.volume} class="w-full accent-qz-accent" />
        {/if}
      </div>

      <!-- 主色 -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-qz-muted">主色</span>
        <div class="flex flex-wrap gap-1.5">
          {#each accentPresets as c (c)}
            <button
              class="h-6 w-6 rounded-full ring-2 transition"
              style="background: {c}; --tw-ring-color: {settings.accent === c ? c : 'transparent'}"
              class:ring-offset-1={settings.accent === c}
              title={c}
              aria-label={`主色 ${c}`}
              onclick={() => (settings.accent = c)}></button>
          {/each}
        </div>
      </div>

      <!-- 壁纸 -->
      <button
        class="rounded-md bg-qz-elevated px-2.5 py-1.5 text-xs transition hover:brightness-110"
        onclick={nextWallpaper}>🖼️ 下一张壁纸</button>
    </div>
  {/if}
</div>
