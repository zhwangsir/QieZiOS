<script lang="ts">
  import { settings, accentPresets } from '../system/settings.svelte';
  import { wallpapers } from '../system/wallpaper';

  const modes: Array<['dark' | 'light', string]> = [
    ['dark', '暗色'],
    ['light', '明色'],
  ];
</script>

<div class="flex h-full flex-col gap-6 overflow-auto p-6 text-sm">
  <!-- 明 / 暗 -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">外观</h2>
    <div class="flex gap-2">
      {#each modes as [val, label] (val)}
        <button
          class="flex-1 rounded-qz border px-3 py-2 transition-colors"
          class:bg-qz-elevated={settings.mode === val}
          style="border-color: {settings.mode === val ? 'var(--color-qz-accent)' : 'var(--color-qz-border)'}"
          onclick={() => (settings.mode = val)}
        >{label}</button>
      {/each}
    </div>
  </section>

  <!-- 主色 -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">主色</h2>
    <div class="flex flex-wrap items-center gap-2">
      {#each accentPresets as c (c)}
        <button
          class="h-7 w-7 rounded-full transition-transform hover:scale-110"
          style="background: {c}; outline: {settings.accent === c
            ? '2px solid var(--color-qz-text)'
            : 'none'}; outline-offset: 2px;"
          aria-label={c}
          onclick={() => (settings.accent = c)}
        ></button>
      {/each}
      <label
        class="ml-1 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-qz-border text-xs"
        title="自定义颜色"
      >
        🎨
        <input type="color" bind:value={settings.accent} class="sr-only" />
      </label>
    </div>
  </section>

  <!-- 圆角 -->
  <section class="flex flex-col gap-1.5">
    <div class="flex justify-between text-xs text-qz-muted">
      <span>圆角</span><span>{settings.radius}px</span>
    </div>
    <input type="range" min="0" max="28" bind:value={settings.radius} class="w-full accent-qz-accent" />
  </section>

  <!-- 磨砂模糊 -->
  <section class="flex flex-col gap-1.5">
    <div class="flex justify-between text-xs text-qz-muted">
      <span>磨砂模糊</span><span>{settings.blur}px</span>
    </div>
    <input type="range" min="0" max="40" bind:value={settings.blur} class="w-full accent-qz-accent" />
  </section>

  <!-- 面板透明度 -->
  <section class="flex flex-col gap-1.5">
    <div class="flex justify-between text-xs text-qz-muted">
      <span>面板透明度</span><span>{Math.round(settings.surfaceOpacity * 100)}%</span>
    </div>
    <input
      type="range"
      min="0.3"
      max="1"
      step="0.01"
      bind:value={settings.surfaceOpacity}
      class="w-full accent-qz-accent"
    />
  </section>

  <!-- 壁纸 -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">壁纸</h2>
    <div class="grid grid-cols-3 gap-2">
      {#each wallpapers as w (w.id)}
        <button
          class="h-14 rounded-qz transition-transform hover:scale-[1.03]"
          style="background: {w.css}; border: {settings.wallpaperId === w.id
            ? '2px solid var(--color-qz-accent)'
            : '1px solid var(--color-qz-border)'};"
          title={w.name}
          onclick={() => (settings.wallpaperId = w.id)}
        ></button>
      {/each}
    </div>
  </section>
</div>
