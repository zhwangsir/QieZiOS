import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 首秀引导（U10）：首次进入桌面时弹全屏三页引导（这是什么 / AI 能做什么 / 快捷键）。
// 完成或跳过都写 qz.onboarded 持久化标记 → 之后进桌面不再自动弹、也不再自动开 Welcome 窗
// （Welcome App 本身保留，用户仍可从 Launchpad/Dock 打开看 4 卡片导览）。
// 单独成模块：不入 SETTINGS_KEYS 主题白名单，随 qz.* 同步。
// ───────────────────────────────────────────────────────────
export const onboardPrefs = persisted<{ done: boolean }>('qz.onboarded', { done: false });

// 是否需要展示首秀引导（纯函数，便于单测）：无标记 / 标记未完成 → 展示。
export function shouldShowOnboard(persistedFlag: { done: boolean } | null | undefined): boolean {
  return !persistedFlag?.done;
}

// 运行时开关（不持久化）：Desktop onMount 按上面判定打开；锁屏 z 层在它之上，移动端首启解锁后才可见。
export const onboarding = $state<{ open: boolean }>({ open: false });

export function openOnboarding(): void {
  onboarding.open = true;
}

// 完成或跳过（同语义）：写持久化标记 + 关闭。
export function finishOnboarding(): void {
  onboardPrefs.done = true;
  onboarding.open = false;
}
