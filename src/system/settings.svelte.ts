import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 用户设置 —— 高自由度/自定义的「真相源」
// 这些值驱动 theme.svelte.ts 算出 token；改它们 = 改系统外观。
// 用 persisted 包起来 → 改了自动存盘、刷新还在。
// ───────────────────────────────────────────────────────────
export interface Settings {
  mode: 'dark' | 'light';   // 明 / 暗
  accent: string;           // 主色（#hex）
  radius: number;           // 全局圆角（px）
  blur: number;             // 磨砂模糊（px）
  surfaceOpacity: number;   // 面板半透明度（0~1）
  wallpaperId: string;      // 当前壁纸 id
}

const defaults: Settings = {
  mode: 'dark',
  accent: '#8b5cf6',
  radius: 14,
  blur: 18,
  surfaceOpacity: 0.66,
  wallpaperId: 'aurora',
};

// 一份全局共享、会自动存盘的响应式设置对象
export const settings = persisted<Settings>('qz.settings', defaults);

// 几个备选主色（设置面板里点一下就换）
export const accentPresets = [
  '#8b5cf6', // 紫
  '#6366f1', // 靛
  '#0ea5e9', // 天蓝
  '#10b981', // 绿
  '#f59e0b', // 琥珀
  '#ef4444', // 红
  '#ec4899', // 粉
];
