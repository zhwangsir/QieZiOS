import { settings, fontStack } from './settings.svelte';
import { wallpapers } from './wallpaper';
import { customWallpaperUrl } from './wallpaperBlob.svelte';
import { viewport } from './viewport.svelte';

// 定时模式的分钟信号：每分钟 +1，让 resolvedMode 在跨过 lightStart/darkStart 时重算。
// 仅在 mode='schedule' 时武装（effect 读 settings.mode → 切到/离开定时自动起停），避免空转。
let scheduleTick = $state(0);
$effect.root(() => {
  $effect(() => {
    if (settings.mode !== 'schedule') return;
    const t = setInterval(() => (scheduleTick = (scheduleTick + 1) % 1e9), 60000);
    return () => clearInterval(t);
  });
});

// 'HH:MM' → 当天分钟数
function hm(s: string): number {
  const [h, m] = (s || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
// 当前是否落在「明色时段」[lightStart, darkStart)（支持跨午夜）
function inLightWindow(light: string, dark: string): boolean {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const ls = hm(light), ds = hm(dark);
  if (ls === ds) return true;
  return ls < ds ? cur >= ls && cur < ds : cur >= ls || cur < ds;
}

// 把 settings.mode（含 auto/schedule）解析成最终的 'dark'|'light'。
// 在 effect/模板里调用会订阅 systemDark（auto）与 scheduleTick（schedule）→ 自动切换。
export function resolvedMode(): 'dark' | 'light' {
  const m = settings.mode;
  if (m === 'light' || m === 'dark') return m;
  if (m === 'auto') return viewport.systemDark ? 'dark' : 'light';
  scheduleTick; // 订阅分钟信号
  return inLightWindow(settings.lightStart, settings.darkStart) ? 'light' : 'dark';
}

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
// 把主色按比例渗进中性表面色（accentTint）→ 表面/控件带一点主色调、整体更统一。tint=0 时返回原色（零变化）。
function tintMix(base: string, accent: string, tint: number): string {
  const t = Math.min(0.15, Math.max(0, tint || 0));
  if (t <= 0) return base;
  return `color-mix(in srgb, ${accent} ${Math.round(t * 100)}%, ${base})`;
}

export function activeTokens(): Tokens {
  const base = palettes[resolvedMode()];
  return {
    ...base,
    // 表面/抬升色叠加主色微调（在 base 展开之后覆盖；qz-glass 的 color-mix 会再嵌套一层，现代浏览器支持）
    '--color-qz-surface': tintMix(base['--color-qz-surface'], settings.accent, settings.accentTint),
    '--color-qz-elevated': tintMix(base['--color-qz-elevated'], settings.accent, settings.accentTint),
    '--color-qz-accent': settings.accent,
    '--color-qz-accent-contrast': pickContrast(settings.accent),
    '--radius-qz': `${settings.radius}px`,
    '--qz-blur': `${settings.blur}px`,
    '--qz-surface-opacity': String(settings.surfaceOpacity),
    '--qz-font': fontStack(settings.fontFamily),
    '--qz-wallpaper': wallpaperCss(),
  };
}

// 算当前壁纸的 background 值：自定义纯色/图片优先，否则用内置预设。
// 图片用 background 简写带上 cover/center/no-repeat → 直接铺满；图片还没解析好时先用预设兜底。
function wallpaperCss(): string {
  const cw = settings.customWallpaper;
  if (cw && cw.type === 'color') return cw.value;
  if (cw && cw.type === 'image') {
    const u = customWallpaperUrl();
    if (u) return `center / cover no-repeat url("${u}")`;
  }
  const wp = wallpapers.find((w) => w.id === settings.wallpaperId) ?? wallpapers[0];
  return wp.css;
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
