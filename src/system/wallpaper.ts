// 壁纸预设 —— 现在用纯 CSS 渐变（零资源、永远丝滑）。
// 以后可以扩展成 { id, name, css }，css 换成 url(...) 指向图片或动态壁纸。
export interface Wallpaper {
  id: string;
  name: string;
  css: string; // 直接喂给 background 的值
  /** 这张壁纸偏暗还是偏亮——给 UI 一点提示（暂未强用） */
  tone: 'dark' | 'light';
}

export const wallpapers: Wallpaper[] = [
  { id: 'aurora',  name: '极光', tone: 'dark',  css: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 45%, #2e1065 100%)' },
  { id: 'dusk',    name: '黄昏', tone: 'dark',  css: 'linear-gradient(135deg, #1a1a2e 0%, #3d1e3d 50%, #7a2048 100%)' },
  { id: 'ocean',   name: '深海', tone: 'dark',  css: 'linear-gradient(160deg, #0b1f33 0%, #0d3b54 55%, #0f6b6b 100%)' },
  { id: 'graphite',name: '石墨', tone: 'dark',  css: 'radial-gradient(circle at 30% 20%, #26262f 0%, #121217 70%)' },
  { id: 'sunrise', name: '晨曦', tone: 'light', css: 'linear-gradient(135deg, #fde1d3 0%, #e9c0e9 50%, #c9b3f0 100%)' },
  { id: 'mist',    name: '薄雾', tone: 'light', css: 'linear-gradient(160deg, #eef2f7 0%, #dfe7f3 55%, #cdd8ee 100%)' },
];
