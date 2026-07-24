<script lang="ts">
  // 桌面控制中心（U9，原「快捷设置」下拉升级）：顶栏 ⚙️ 弹出的 macOS 风格毛玻璃大面板。
  // 分区圆角卡片：连接（AI 在线/勿扰大色块 toggle）· 显示（明暗四段 + 界面缩放）
  // · 声音（开关 + 音量）· 外观（主色 swatch + 下一张壁纸）。
  // 状态接线与 MobileControlCenter 同源（settings/dnd/soundPrefs/aiConfig），两端语义一致；
  // AI 在线判定共用 aiReady（provider 感知）。自管开关 + 点外部关闭。
  import { settings, accentPresets, nextWallpaper } from '../system/settings.svelte';
  import { dnd } from '../system/dnd.svelte';
  import { soundPrefs } from '../system/sound';
  import { aiConfig, aiReady } from '../system/aiConfig.svelte';
  import { sys } from '../system/sys';
  import Icon from '../lib/Icon.svelte';

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

  const aiOnline = $derived(aiReady(aiConfig));

  function openAiSettings() {
    open = false;
    sys.openApp('settings');
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="relative" bind:this={el}>
  <button
    class="grid h-6 w-6 place-items-center rounded text-sm hover:bg-white/15 {open ? 'bg-white/15' : ''}"
    title="控制中心"
    onclick={() => (open = !open)}><Icon name="⚙️" size={14} /></button>

  {#if open}
    <!-- M39：面板有自己的玻璃底板 → 前景/文字阴影重置回主题语义（顶栏白色前景仅服务于壁纸叠加层） -->
    <div
      class="absolute right-0 top-full z-[9999] mt-1.5 flex w-80 flex-col gap-2.5 rounded-2xl border border-qz-border p-3 text-qz-text qz-glass qz-glass-float"
      style="text-shadow: none;"
    >
      <!-- 连接区：大色块 toggle（AI 在线 / 勿扰） -->
      <div class="grid grid-cols-2 gap-2">
        <button
          class="flex h-16 flex-col items-start justify-between rounded-2xl p-2.5 text-left transition active:scale-95 {aiOnline
            ? 'bg-qz-accent text-qz-accent-contrast'
            : 'bg-qz-elevated/70 text-qz-text'}"
          title="AI 状态（点击去设置）"
          onclick={openAiSettings}
        >
          <Icon name="Bot" size={19} strokeWidth={1.8} />
          <span class="text-xs font-medium">AI {aiOnline ? '在线' : '未配置'}</span>
        </button>
        <button
          class="flex h-16 flex-col items-start justify-between rounded-2xl p-2.5 text-left transition active:scale-95 {dnd.enabled
            ? 'bg-qz-accent text-qz-accent-contrast'
            : 'bg-qz-elevated/70 text-qz-text'}"
          onclick={() => (dnd.enabled = !dnd.enabled)}
        >
          <Icon name={dnd.enabled ? 'BellOff' : 'Bell'} size={19} strokeWidth={1.8} />
          <span class="text-xs font-medium">勿扰 {dnd.enabled ? '开' : '关'}</span>
        </button>
      </div>

      <!-- 显示区：明暗四段 + 界面缩放 -->
      <div class="flex flex-col gap-2.5 rounded-2xl bg-qz-elevated/70 p-3">
        <div class="grid grid-cols-4 gap-1">
          {#each modes as [val, label] (val)}
            <button
              class="rounded px-1 py-1 text-xs transition-colors"
              class:bg-qz-accent={settings.mode === val}
              class:text-qz-accent-contrast={settings.mode === val}
              class:bg-qz-surface={settings.mode !== val}
              onclick={() => (settings.mode = val)}>{label}</button>
          {/each}
        </div>
        <label class="flex items-center gap-2.5">
          <span class="shrink-0 text-qz-muted"><Icon name="ZoomIn" size={15} /></span>
          <input
            type="range"
            min="0.85"
            max="1.2"
            step="0.01"
            bind:value={settings.fontScale}
            class="w-full accent-qz-accent"
            aria-label="界面缩放"
          />
          <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-qz-muted">
            {Math.round(settings.fontScale * 100)}%
          </span>
        </label>
      </div>

      <!-- 声音区：开关 + 音量 -->
      <div class="flex flex-col gap-2 rounded-2xl bg-qz-elevated/70 p-3">
        <button
          class="flex items-center justify-between text-xs"
          onclick={() => (soundPrefs.enabled = !soundPrefs.enabled)}
        >
          <span class="flex items-center gap-1.5 font-medium"><Icon name="🔊" size={15} />声音</span>
          <span class="rounded-full px-2 py-0.5 text-[10px] {soundPrefs.enabled ? 'bg-qz-accent text-qz-accent-contrast' : 'bg-qz-surface text-qz-muted'}">{soundPrefs.enabled ? '开' : '关'}</span>
        </button>
        {#if soundPrefs.enabled}
          <input type="range" min="0" max="1" step="0.05" bind:value={soundPrefs.volume} class="w-full accent-qz-accent" aria-label="音量" />
        {/if}
      </div>

      <!-- 外观区：主色 swatch + 下一张壁纸 -->
      <div class="flex flex-col gap-2.5 rounded-2xl bg-qz-elevated/70 p-3">
        <div class="flex flex-wrap gap-2">
          {#each accentPresets as c (c)}
            <button
              class="h-7 w-7 rounded-full outline transition active:scale-90"
              style="background: {c}; outline-color: {settings.accent === c ? c : 'transparent'}; outline-width: {settings.accent === c ? '2px' : '0'}; outline-offset: 2px;"
              title={c}
              aria-label={`主色 ${c}`}
              onclick={() => (settings.accent = c)}></button>
          {/each}
        </div>
        <button
          class="flex items-center justify-center gap-1.5 rounded-xl bg-qz-surface px-2.5 py-1.5 text-xs transition hover:brightness-110 active:scale-[0.98]"
          onclick={nextWallpaper}><Icon name="🖼️" size={14} />下一张壁纸</button>
      </div>
    </div>
  {/if}
</div>
