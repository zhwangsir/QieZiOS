<script lang="ts">
  import { settings, accentPresets, SETTINGS_KEYS, type Settings } from '../system/settings.svelte';
  import { wallpapers } from '../system/wallpaper';
  import { themePresets, type ThemePreset } from '../system/themePresets.svelte';
  import { aiConfig, AI_MODELS } from '../system/aiConfig.svelte';

  const modes: Array<['dark' | 'light', string]> = [
    ['dark', '暗色'],
    ['light', '明色'],
  ];

  let presetName = $state('');
  let importText = $state('');
  let importError = $state(false);

  const exportJson = $derived(JSON.stringify($state.snapshot(settings), null, 2));

  // 只挑白名单里的键覆盖到 settings（避免塞进奇怪字段）
  function applySettings(src: Partial<Settings>) {
    const picked: Record<string, unknown> = {};
    for (const k of SETTINGS_KEYS) if (src[k] !== undefined) picked[k] = src[k];
    Object.assign(settings, picked);
  }

  function savePreset() {
    const name = presetName.trim() || `主题 ${themePresets.list.length + 1}`;
    themePresets.list.push({
      id: crypto.randomUUID(),
      name,
      settings: $state.snapshot(settings) as Settings,
    });
    presetName = '';
  }
  function applyPreset(p: ThemePreset) {
    applySettings(p.settings);
  }
  function deletePreset(id: string) {
    const i = themePresets.list.findIndex((p) => p.id === id);
    if (i !== -1) themePresets.list.splice(i, 1);
  }

  function importJson() {
    try {
      applySettings(JSON.parse(importText));
      importText = '';
      importError = false;
    } catch {
      importError = true;
    }
  }
</script>

<div class="flex h-full flex-col gap-6 overflow-auto p-6 text-sm">
  <!-- AI（浏览器直连） -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">AI 助手</h2>
    <input
      type="password"
      class="w-full rounded-qz bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="Anthropic API Key（sk-ant-… 存本地浏览器）"
      bind:value={aiConfig.apiKey}
    />
    <div class="flex gap-2">
      {#each AI_MODELS as m (m.id)}
        <button
          class="flex-1 rounded-qz border px-2 py-1.5 text-xs transition-colors"
          class:bg-qz-elevated={aiConfig.model === m.id}
          style="border-color: {aiConfig.model === m.id
            ? 'var(--color-qz-accent)'
            : 'var(--color-qz-border)'}"
          onclick={() => (aiConfig.model = m.id)}>{m.label}</button>
      {/each}
    </div>
    <p class="text-[11px] leading-relaxed text-qz-muted">
      key 只存本地、浏览器直连 Anthropic。助手能启动 App、增删改文件、改主题。
    </p>
  </section>

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

  <!-- 界面缩放 -->
  <section class="flex flex-col gap-1.5">
    <div class="flex justify-between text-xs text-qz-muted">
      <span>界面缩放</span><span>{Math.round(settings.fontScale * 100)}%</span>
    </div>
    <input
      type="range"
      min="0.85"
      max="1.2"
      step="0.01"
      bind:value={settings.fontScale}
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

  <!-- 我的主题：把当前外观存成命名预设 -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">我的主题</h2>
    <div class="flex gap-2">
      <input
        class="min-w-0 flex-1 rounded-qz bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        placeholder="主题名称"
        bind:value={presetName}
        onkeydown={(e) => {
          if (e.key === 'Enter') savePreset();
        }}
      />
      <button
        class="rounded-qz bg-qz-accent px-3 py-1.5 text-xs font-medium text-qz-accent-contrast transition-transform active:scale-95"
        onclick={savePreset}>保存当前</button>
    </div>
    {#if themePresets.list.length}
      <div class="flex flex-col gap-1">
        {#each themePresets.list as p (p.id)}
          <div class="flex items-center gap-2 rounded-qz bg-qz-surface px-2 py-1.5">
            <span
              class="h-4 w-4 shrink-0 rounded-full border border-qz-border"
              style="background: {p.settings.accent}"
            ></span>
            <span class="flex-1 truncate text-xs">{p.name}</span>
            <button class="rounded px-2 py-0.5 text-xs text-qz-accent hover:bg-qz-elevated" onclick={() => applyPreset(p)}>应用</button>
            <button class="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-qz-elevated" onclick={() => deletePreset(p.id)}>删除</button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- 导入 / 导出（JSON） -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">导入 / 导出</h2>
    <textarea
      class="h-28 w-full resize-none rounded-qz bg-qz-surface p-2 font-mono text-[11px] leading-relaxed outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      class:ring-red-400={importError}
      spellcheck="false"
      bind:value={importText}
      placeholder={exportJson}
    ></textarea>
    <div class="flex items-center gap-2">
      <button
        class="rounded-qz bg-qz-elevated px-3 py-1.5 text-xs hover:brightness-110"
        onclick={() => (importText = exportJson)}>填入当前(导出)</button>
      <button
        class="rounded-qz bg-qz-accent px-3 py-1.5 text-xs font-medium text-qz-accent-contrast active:scale-95"
        onclick={importJson}>应用 JSON</button>
      {#if importError}<span class="text-xs text-red-400">JSON 无效</span>{/if}
    </div>
  </section>
</div>
