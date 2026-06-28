import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 每 App 偏好（R4-F5）：目前只存「默认窗口尺寸」。
// App 出厂尺寸在 appList 硬编码；这里让用户把当前窗口大小记成某 App 的默认，
// 之后该 App 都按这个尺寸开。sys.openApp 启动时回退：appPrefs → appMeta。
// 持久化 qz.appprefs，随账号同步（qz.* gather）。
// ───────────────────────────────────────────────────────────
export interface AppPref {
  w?: number;
  h?: number;
}

export const appPrefs = persisted<{ map: Record<string, AppPref> }>('qz.appprefs', { map: {} });

export function setAppSize(appId: string, w: number, h: number): void {
  appPrefs.map[appId] = { ...appPrefs.map[appId], w: Math.round(w), h: Math.round(h) };
}
export function getAppPref(appId: string): AppPref | undefined {
  return appPrefs.map[appId];
}
export function clearAppPref(appId: string): void {
  if (appPrefs.map[appId]) delete appPrefs.map[appId];
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzAppPrefs: unknown }).__qzAppPrefs = { appPrefs, setAppSize, getAppPref, clearAppPref };
}
