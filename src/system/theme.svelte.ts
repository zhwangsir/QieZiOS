import { settings } from './settings.svelte';
import { wallpapers } from './wallpaper';

// ───────────────────────────────────────────────────────────
// 主题 · 把「设置」翻译成一组 CSS token，写进 :root
// 关键点：换肤只是改 CSS 变量 → 浏览器自己重绘，0 个 Svelte 组件重新渲染。
// 这就是「性能 × 美观 × 自定义」共用同一块底座的落点。
// ───────────────────────────────────────────────────────────
type Tokens = Record<string, string>;

// 明/暗两套基础调色板（主色、圆角、模糊等由用户设置另外叠加）
const palettes: Record<'dark' | 'light', Tokens> = {
  dark: {
    '--color-qz-bg': '#0b0b12',
    '--color-qz-surface': '#1b1b27',
    '--color-qz-elevated': '#2a2a3b',
    '--color-qz-text': '#f3f3f8',
    '--color-qz-muted': '#a6a6bd',
    '--color-qz-border': 'rgb(255 255 255 / 0.12)',
  },
  light: {
    '--color-qz-bg': '#eceef4',
    '--color-qz-surface': '#ffffff',
    '--color-qz-elevated': '#f4f5fa',
    '--color-qz-text': '#1b1b26',
    '--color-qz-muted': '#5b5b72',
    '--color-qz-border': 'rgb(0 0 0 / 0.10)',
  },
};

// 纯函数：读当前 settings，算出「应该写到 :root 的全部 token」。
// 在 effect 里调用它 → 会自动订阅它读到的每个 settings 字段。
export function activeTokens(): Tokens {
  const base = palettes[settings.mode];
  const wp = wallpapers.find((w) => w.id === settings.wallpaperId) ?? wallpapers[0];
  return {
    ...base,
    '--color-qz-accent': settings.accent,
    '--color-qz-accent-contrast': pickContrast(settings.accent),
    '--radius-qz': `${settings.radius}px`,
    '--qz-blur': `${settings.blur}px`,
    '--qz-surface-opacity': String(settings.surfaceOpacity),
    '--qz-wallpaper': wp.css,
  };
}

// 把 token 写到 <html> 的 inline style —— inline 优先级高于样式表里的 :root 默认值，
// 所以这一步永远「赢」，实现运行时覆盖。
export function applyTokens(tokens: Tokens) {
  const root = document.documentElement;
  for (const key in tokens) root.style.setProperty(key, tokens[key]);
}

// 按主色亮度自动选黑/白文字，保证主色按钮上的字始终清晰
function pickContrast(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#ffffff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#10101a' : '#ffffff';
}
