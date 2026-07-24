<script lang="ts">
  // M5.5 移动控制中心：状态栏右侧点击唤起的全屏毛玻璃面板。
  // 大色块 toggle（明暗/勿扰/声音/AI 在线）+ 音量/界面缩放滑块 + 主色色板。
  // 状态接线全部复用 QuickSettings 的同一批 store（settings/dnd/soundPrefs/aiConfig），
  // 只改外壳形态，不改状态语义 → 桌面零回归。
  import { fade, fly } from 'svelte/transition';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import Bell from '@lucide/svelte/icons/bell';
  import BellOff from '@lucide/svelte/icons/bell-off';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import Volume1 from '@lucide/svelte/icons/volume-1';
  import Bot from '@lucide/svelte/icons/bot';
  import Type from '@lucide/svelte/icons/type';
  import X from '@lucide/svelte/icons/x';
  import Lock from '@lucide/svelte/icons/lock';
  import { settings, accentPresets } from '../../system/settings.svelte';
  import { resolvedMode, toggleTheme } from '../../system/theme.svelte';
  import { dnd } from '../../system/dnd.svelte';
  import { soundPrefs } from '../../system/sound';
  import { aiConfig, aiReady } from '../../system/aiConfig.svelte';
  import { viewport } from '../../system/viewport.svelte';
  import { sys } from '../../system/sys';
  import { lock } from '../../system/session.svelte';
  import { mobileUi, closeControlCenter } from './mobileUi.svelte';

  const dur = $derived(viewport.reducedMotion ? 0 : 1);
  const dark = $derived(resolvedMode() === 'dark');
  // provider 感知判定（M4 起与桌面 QuickSettings 共用 aiReady）：本地/网关无 key 也算在线
  const aiOnline = $derived(aiReady(aiConfig));

  // toggleTheme 由 theme.svelte 导入（M14.1 起统一收口，auto/schedule 也正确切反面）

  function openAiSettings() {
    closeControlCenter();
    sys.openApp('settings');
  }

  // M3 锁定入口：关面板 → 进统一会话锁屏（desktop→locked）
  function lockNow() {
    closeControlCenter();
    lock();
  }
</script>

{#if mobileUi.ccOpen}
  <!--  backdrop：点击空白处关闭 -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10001] bg-black/30"
    transition:fade={{ duration: 160 * dur }}
    onclick={closeControlCenter}
  ></div>

  <!-- 面板本体：全屏毛玻璃，safe-area 内边距，内容可滚 -->
  <div
    class="pointer-events-none fixed inset-0 z-[10001] flex flex-col overflow-y-auto qz-glass px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+3rem)]"
    transition:fly={{ y: -28, duration: 200 * dur }}
    role="dialog"
    aria-label="控制中心"
  >
    <div class="pointer-events-auto mx-auto flex w-full max-w-sm flex-col gap-4">
      <!-- 头部：标题 + 锁定（M3）+ 关闭 -->
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-qz-text">控制中心</span>
        <div class="flex items-center gap-2">
          <button
            class="grid h-9 w-9 place-items-center rounded-full bg-qz-elevated/70 text-qz-text active:opacity-60"
            aria-label="锁定"
            onclick={lockNow}
          >
            <Lock size={17} />
          </button>
          <button
            class="grid h-9 w-9 place-items-center rounded-full bg-qz-elevated/70 text-qz-text active:opacity-60"
            aria-label="关闭控制中心"
            onclick={closeControlCenter}
          >
            <X size={17} />
          </button>
        </div>
      </div>

      <!-- 大色块 toggle 2×2 -->
      <div class="grid grid-cols-2 gap-3">
        <button
          class="flex h-20 flex-col items-start justify-between rounded-3xl p-3.5 text-left transition active:scale-95 {dark
            ? 'bg-qz-accent text-qz-accent-contrast'
            : 'bg-qz-elevated/70 text-qz-text'}"
          onclick={toggleTheme}
        >
          {#if dark}<Moon size={22} strokeWidth={1.8} />{:else}<Sun size={22} strokeWidth={1.8} />{/if}
          <span class="text-[13px] font-medium">{dark ? '暗色' : '亮色'}</span>
        </button>

        <button
          class="flex h-20 flex-col items-start justify-between rounded-3xl p-3.5 text-left transition active:scale-95 {dnd.enabled
            ? 'bg-qz-accent text-qz-accent-contrast'
            : 'bg-qz-elevated/70 text-qz-text'}"
          onclick={() => (dnd.enabled = !dnd.enabled)}
        >
          {#if dnd.enabled}<BellOff size={22} strokeWidth={1.8} />{:else}<Bell size={22} strokeWidth={1.8} />{/if}
          <span class="text-[13px] font-medium">勿扰 {dnd.enabled ? '开' : '关'}</span>
        </button>

        <button
          class="flex h-20 flex-col items-start justify-between rounded-3xl p-3.5 text-left transition active:scale-95 {soundPrefs.enabled
            ? 'bg-qz-accent text-qz-accent-contrast'
            : 'bg-qz-elevated/70 text-qz-text'}"
          onclick={() => (soundPrefs.enabled = !soundPrefs.enabled)}
        >
          {#if soundPrefs.enabled}<Volume2 size={22} strokeWidth={1.8} />{:else}<VolumeX size={22} strokeWidth={1.8} />{/if}
          <span class="text-[13px] font-medium">声音 {soundPrefs.enabled ? '开' : '关'}</span>
        </button>

        <button
          class="flex h-20 flex-col items-start justify-between rounded-3xl p-3.5 text-left transition active:scale-95 {aiOnline
            ? 'bg-qz-accent text-qz-accent-contrast'
            : 'bg-qz-elevated/70 text-qz-text'}"
          title="AI 状态（点击去设置）"
          onclick={openAiSettings}
        >
          <Bot size={22} strokeWidth={1.8} />
          <span class="text-[13px] font-medium">AI {aiOnline ? '在线' : '未配置'}</span>
        </button>
      </div>

      <!-- 滑块：音量 / 界面缩放 -->
      <div class="flex flex-col gap-3 rounded-3xl bg-qz-elevated/70 p-4">
        <label class="flex items-center gap-3">
          <Volume1 size={18} class="shrink-0 text-qz-muted" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            bind:value={soundPrefs.volume}
            class="h-8 w-full accent-qz-accent"
            aria-label="音量"
          />
        </label>
        <label class="flex items-center gap-3">
          <Type size={18} class="shrink-0 text-qz-muted" />
          <input
            type="range"
            min="0.85"
            max="1.2"
            step="0.05"
            bind:value={settings.fontScale}
            class="h-8 w-full accent-qz-accent"
            aria-label="界面缩放"
          />
          <span class="w-10 shrink-0 text-right text-xs tabular-nums text-qz-muted">
            {Math.round(settings.fontScale * 100)}%
          </span>
        </label>
      </div>

      <!-- 主色色板 -->
      <div class="flex flex-col gap-2.5 rounded-3xl bg-qz-elevated/70 p-4">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-qz-muted">主色</span>
        <div class="flex flex-wrap gap-2.5">
          {#each accentPresets as c (c)}
            <button
              class="h-9 w-9 rounded-full outline transition active:scale-90"
              style="background: {c}; outline-color: {settings.accent === c ? c : 'transparent'}; outline-width: {settings.accent === c ? '2px' : '0'}; outline-offset: 2px;"
              title={c}
              aria-label={`主色 ${c}`}
              onclick={() => (settings.accent = c)}
            ></button>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
