<script lang="ts">
  import { settings, accentPresets, SETTINGS_KEYS, type Settings } from '../system/settings.svelte';
  import { wallpapers } from '../system/wallpaper';
  import { themePresets, type ThemePreset } from '../system/themePresets.svelte';
  import { aiConfig, AI_MODELS, AI_PRESETS, ENV_AI_KEY, type AiPreset } from '../system/aiConfig.svelte';
  import { runAgent } from '../system/ai';
  import { syncToken, pushSync, pullSync } from '../system/sync';
  import { sys } from '../system/sys';

  const modes: Array<['dark' | 'light', string]> = [
    ['dark', '暗色'],
    ['light', '明色'],
  ];

  let presetName = $state('');
  let importText = $state('');
  let importError = $state(false);

  // AI 配色：用一句话描述外观 → 让带 set_theme 工具的 agent 直接改主题
  let themeWish = $state('');
  let aiBusy = $state(false);
  let aiErr = $state('');

  // 一键套用某个 AI 服务预设（provider+地址+模型；工作站预设还会从环境变量填 key）
  function applyAiPreset(p: AiPreset) {
    aiConfig.provider = p.provider;
    aiConfig.baseURL = p.baseURL;
    aiConfig.model = p.model;
    if (p.useEnvKey && ENV_AI_KEY) aiConfig.apiKey = ENV_AI_KEY;
  }

  // 云同步（雏形，需 npm run serve 部署）
  let syncBusy = $state(false);
  let syncMsg = $state('');
  async function doPush() {
    syncBusy = true;
    syncMsg = '';
    try {
      const n = await pushSync();
      syncMsg = `已上传 ${n} 项到云端`;
      sys.notify('云同步', { body: syncMsg, level: 'success' });
    } catch (e) {
      syncMsg = e instanceof Error ? e.message : String(e);
    }
    syncBusy = false;
  }
  async function doPull() {
    syncBusy = true;
    syncMsg = '';
    try {
      const n = await pullSync();
      syncMsg = `已从云端恢复 ${n} 项，即将刷新…`;
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      syncMsg = e instanceof Error ? e.message : String(e);
      syncBusy = false;
    }
  }

  async function aiTheme() {
    const wish = themeWish.trim();
    if (!wish || aiBusy) return;
    aiBusy = true;
    aiErr = '';
    await runAgent(
      [
        {
          role: 'user',
          content: `把系统外观改成：${wish}。直接调用 set_theme 工具调整 mode/accent/wallpaperId/radius/blur，不用多问、不用确认。`,
        },
      ],
      (e) => {
        if (e.type === 'error') aiErr = e.message;
      },
    );
    aiBusy = false;
    themeWish = '';
  }

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
  <!-- AI（双协议 + 全开配置） -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">AI 助手</h2>

    <!-- 一键预设 -->
    <div class="flex flex-wrap gap-1.5">
      {#each AI_PRESETS as p (p.label)}
        <button
          class="rounded-md bg-qz-elevated px-2 py-1 text-[11px] transition hover:brightness-110"
          onclick={() => applyAiPreset(p)}>{p.label}</button>
      {/each}
    </div>

    <!-- 协议 -->
    <div class="flex gap-2 text-xs">
      {#each [['openai', 'OpenAI 兼容'], ['anthropic', 'Anthropic']] as [val, label] (val)}
        <button
          class="flex-1 rounded-qz border px-3 py-1.5 transition-colors"
          class:bg-qz-elevated={aiConfig.provider === val}
          style="border-color: {aiConfig.provider === val
            ? 'var(--color-qz-accent)'
            : 'var(--color-qz-border)'}"
          onclick={() => (aiConfig.provider = val as typeof aiConfig.provider)}>{label}</button>
      {/each}
    </div>

    <input
      type="password"
      class="w-full rounded-qz bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="API Key（存本地浏览器；Anthropic 填 sk-ant-…，网关填 Bearer）"
      bind:value={aiConfig.apiKey}
    />
    <input
      type="text"
      class="w-full rounded-qz bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="接口地址（Anthropic 留空=官方；OpenAI 兼容填 /aiproxy/lm/v1 走同源代理）"
      bind:value={aiConfig.baseURL}
    />
    <input
      type="text"
      class="w-full rounded-qz bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="模型 id"
      bind:value={aiConfig.model}
    />
    <div class="flex flex-wrap gap-1.5">
      {#each AI_MODELS as m (m.id)}
        <button
          class="rounded-md bg-qz-elevated px-2 py-1 text-[11px] transition hover:brightness-110"
          class:ring-1={aiConfig.model === m.id}
          class:ring-qz-accent={aiConfig.model === m.id}
          onclick={() => (aiConfig.model = m.id)}>{m.label}</button>
      {/each}
    </div>
    <textarea
      class="h-20 w-full resize-none rounded-qz bg-qz-surface px-2 py-1.5 text-xs leading-relaxed outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="额外人设/指令（叠加在默认系统提示之上，例如：说话简洁、用猫娘语气…）"
      bind:value={aiConfig.systemPrompt}
    ></textarea>
    <div class="flex items-center justify-between text-xs text-qz-muted">
      <span>单次最大 tokens</span>
      <input
        type="number"
        min="1000"
        max="32000"
        step="1000"
        class="w-24 rounded-qz bg-qz-surface px-2 py-1 text-right text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        bind:value={aiConfig.maxTokens}
      />
    </div>
    <p class="text-[11px] leading-relaxed text-qz-muted">
      key 只存本地。Anthropic 浏览器直连；OpenAI 兼容网关因 CORS 走同源代理（/aiproxy，见 vite.config）。模型可填任意
      id；人设叠加但保留工具能力。
    </p>
  </section>

  <!-- AI 配色：一句话换肤（复用 set_theme 工具） -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">🪄 AI 配色</h2>
    <div class="flex gap-2">
      <input
        class="min-w-0 flex-1 rounded-qz bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent disabled:opacity-50"
        placeholder="一句话描述想要的外观，如「深色赛博朋克、霓虹紫」"
        bind:value={themeWish}
        disabled={aiBusy || !aiConfig.apiKey}
        onkeydown={(e) => {
          if (e.key === 'Enter') aiTheme();
        }}
      />
      <button
        class="rounded-qz bg-qz-accent px-3 py-1.5 text-xs font-medium text-qz-accent-contrast transition-transform active:scale-95 disabled:opacity-40"
        onclick={aiTheme}
        disabled={aiBusy || !themeWish.trim() || !aiConfig.apiKey}>{aiBusy ? '配色中…' : '生成'}</button>
    </div>
    {#if !aiConfig.apiKey}
      <p class="text-[11px] text-qz-muted">先在上面配置 AI 才能用。</p>
    {:else if aiErr}
      <p class="text-[11px] text-red-400">⚠️ {aiErr}</p>
    {/if}
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

  <!-- 云同步（雏形，需 npm run serve 部署） -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">☁️ 云同步</h2>
    <p class="text-[11px] leading-relaxed text-qz-muted">
      把桌面布局/文件/主题/已装 App 同步到自托管后端，多设备共享。token = <code>{syncToken()}</code>（当密钥，别外泄）。
      不含 AI key。⚠️ 需 <code>npm run serve</code> 部署后可用。
    </p>
    <div class="flex items-center gap-2">
      <button
        class="rounded-qz bg-qz-accent px-3 py-1.5 text-xs font-medium text-qz-accent-contrast active:scale-95 disabled:opacity-40"
        disabled={syncBusy}
        onclick={doPush}>上传到云</button>
      <button
        class="rounded-qz bg-qz-elevated px-3 py-1.5 text-xs hover:brightness-110 disabled:opacity-40"
        disabled={syncBusy}
        onclick={doPull}>从云恢复</button>
      {#if syncMsg}<span class="text-[11px] text-qz-muted">{syncMsg}</span>{/if}
    </div>
  </section>

  <!-- 全局自定义 CSS：深度换肤，注入 <style> 即时生效 -->
  <section class="flex flex-col gap-2">
    <h2 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">🎨 自定义 CSS</h2>
    <p class="text-[11px] leading-relaxed text-qz-muted">
      粘 CSS 即时全局生效（持久化、随主题导出/同步）。覆盖 token 加 <code>!important</code>，如
      <code>html&#123;--color-qz-accent:#f06 !important&#125;</code>。
    </p>
    <textarea
      class="h-28 w-full resize-none rounded-qz bg-qz-surface p-2 font-mono text-[11px] leading-relaxed outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      spellcheck="false"
      placeholder={'/* 例如 */\n.qz-glass { border-radius: 20px; }\nbody { letter-spacing: .3px; }'}
      bind:value={settings.customCss}
    ></textarea>
  </section>
</div>
