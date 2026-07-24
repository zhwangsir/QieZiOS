import { persisted } from '../kernel/persist.svelte';
import { settings } from './settings.svelte';
import { wallpapers } from './wallpaper';

// ───────────────────────────────────────────────────────────
// 壁纸轮播配置（持久化）—— 由 wallpaperd 守护服务按 intervalSec 定时切换。
// · wallpaperIds：参与轮播的内置壁纸 id 列表（多选）
// · intervalSec：切换间隔（秒）
// · currentIndex：当前轮播到的下标（持久化是为了刷新后不重置到第一张）
// · enabled：总开关；关时 wallpaperd 不武装计时器
// 切换走「现有壁纸 setter」：清掉 customWallpaper + 设置 wallpaperId（与 nextWallpaper 同路径）。
// ───────────────────────────────────────────────────────────
export interface WallpaperSlideshowConfig {
  enabled: boolean;
  wallpaperIds: string[];
  intervalSec: number;
  currentIndex: number;
}

const defaults: WallpaperSlideshowConfig = {
  enabled: false,
  wallpaperIds: [],
  intervalSec: 60,
  currentIndex: 0,
};

export const wallpaperSlideshow = persisted<WallpaperSlideshowConfig>('qz.wpSlideshow', defaults);

// 间隔预设（Settings UI 的下拉项）。秒数取整、最小 30s 避免频繁刷新干扰。
export const SLIDESHOW_INTERVALS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 30, label: '30 秒' },
  { value: 60, label: '1 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
];

// 过滤掉已被删除的内置壁纸 id（防止存档里残留不存在的 id 让轮播空转）。
function validIds(): string[] {
  const set = new Set(wallpapers.map((w) => w.id));
  return wallpaperSlideshow.wallpaperIds.filter((id) => set.has(id));
}

// 轮播到下一张（循环）。由 wallpaperd 计时器到点调用。
export function advanceSlideshow(): void {
  const ids = validIds();
  if (ids.length === 0) return;
  const next = (wallpaperSlideshow.currentIndex + 1) % ids.length;
  wallpaperSlideshow.currentIndex = next;
  // 与 settings.nextWallpaper 同一路径：清自定义 → 切内置预设
  settings.customWallpaper = null;
  settings.wallpaperId = ids[next];
}

// 立即应用当前 index 指向的壁纸（启用轮播时给一点即时反馈，不必等满一个间隔）。
export function applyCurrentSlideshow(): void {
  const ids = validIds();
  if (ids.length === 0) return;
  const i = Math.min(wallpaperSlideshow.currentIndex, ids.length - 1);
  wallpaperSlideshow.currentIndex = i;
  settings.customWallpaper = null;
  settings.wallpaperId = ids[i];
}

// Settings 多选：增/减一张壁纸。改完顺手修正 currentIndex 防越界。
export function toggleSlideshowWallpaper(id: string): void {
  const list = wallpaperSlideshow.wallpaperIds;
  if (list.includes(id)) {
    wallpaperSlideshow.wallpaperIds = list.filter((x) => x !== id);
  } else {
    wallpaperSlideshow.wallpaperIds = [...list, id];
  }
  if (wallpaperSlideshow.currentIndex >= wallpaperSlideshow.wallpaperIds.length) {
    wallpaperSlideshow.currentIndex = 0;
  }
}

export function setSlideshowEnabled(v: boolean): void {
  wallpaperSlideshow.enabled = v;
  if (v) applyCurrentSlideshow(); // 开启即切到轮播列表当前项，反馈立即可见
}

export function setSlideshowInterval(sec: number): void {
  wallpaperSlideshow.intervalSec = sec;
}
