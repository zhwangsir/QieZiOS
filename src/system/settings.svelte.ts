import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 用户设置 —— 高自由度/自定义的「真相源」
// 这些值驱动 theme.svelte.ts 算出 token；改它们 = 改系统外观。
// 用 persisted 包起来 → 改了自动存盘、刷新还在。
// ───────────────────────────────────────────────────────────
// 自定义壁纸：纯色/渐变（直接喂 background）或上传的图片（字节存 blobStore，按 blobId 取）。
// null = 用内置预设（wallpaperId）。
export type CustomWallpaper =
  | { type: 'color'; value: string }
  | { type: 'image'; blobId: string }
  | null;

export interface Settings {
  mode: 'dark' | 'light' | 'auto' | 'schedule'; // 明 / 暗 / 跟随系统 / 定时（lightStart~darkStart 为明，余为暗）
  lightStart: string;       // 定时模式：转明色的时刻 'HH:MM'
  darkStart: string;        // 定时模式：转暗色的时刻 'HH:MM'
  accent: string;           // 主色（#hex）
  radius: number;           // 全局圆角（px）
  blur: number;             // 磨砂模糊（px）
  surfaceOpacity: number;   // 面板半透明度（0~1）
  accentTint: number;       // 主色渗入表面色的比例（0~0.15）→ 整体配色更统一；0=纯中性表面
  fontScale: number;        // 界面缩放（根字号倍率，0.85~1.2）
  fontFamily: string;       // 界面字体族 id（见 FONT_FAMILIES）
  wallpaperId: string;      // 当前内置壁纸 id（customWallpaper 为 null 时生效）
  customWallpaper: CustomWallpaper; // 自定义壁纸（图片/纯色），优先于内置预设
  customCss: string;        // 全局自定义 CSS（深度换肤，注入 <style>）
}

const defaults: Settings = {
  mode: 'dark',
  lightStart: '07:00',
  darkStart: '19:00',
  accent: '#8b5cf6',
  radius: 14,
  blur: 18,
  surfaceOpacity: 0.66,
  accentTint: 0,
  fontScale: 1,
  fontFamily: 'system',
  wallpaperId: 'aurora',
  customWallpaper: null,
  customCss: '',
};

// 界面字体族选项（id → 字体栈）。栈都锚定到通用族（sans/serif/monospace）→ 即便没装具体
// 字体也能看出区别。等宽用 font-mono 工具类的元素（终端等）不受全局字体影响。
export const FONT_FAMILIES: { id: string; name: string; stack: string }[] = [
  { id: 'system', name: '系统默认', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'sans', name: '无衬线', stack: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'serif', name: '衬线', stack: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif' },
  { id: 'mono', name: '等宽', stack: 'ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace' },
  { id: 'rounded', name: '圆体', stack: 'ui-rounded, "Hiragino Maru Gothic ProN", "Quicksand", "PingFang SC", sans-serif' },
];
export function fontStack(id: string): string {
  return (FONT_FAMILIES.find((f) => f.id === id) ?? FONT_FAMILIES[0]).stack;
}

// 可被「应用主题预设 / 导入」覆盖的字段（白名单，避免塞进奇怪的键）
export const SETTINGS_KEYS = Object.keys(defaults) as (keyof Settings)[];

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
