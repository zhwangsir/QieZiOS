import { processes, launch, close, focus, minimize, restore } from '../kernel/processes.svelte';
import { children, getNode, createDir, createFile, writeFile } from '../kernel/vfs.svelte';
import { emit, on } from '../kernel/bus.svelte';
import { logSys } from '../kernel/log.svelte';
import { settings } from './settings.svelte';
import { wallpapers } from './wallpaper';
import { clipboard, currentClip } from './clipboard.svelte';

// ───────────────────────────────────────────────────────────
// 系统调用门面 · 把内核/系统的能力收成「一张系统调用表」。
// 这是「统一边界」的雏形：新代码（及 AI/iframe 桥）都该经 sys.* 访问系统，
// 而不是各自 import 内核内部。导入本模块同时会拉起「总线→日志」桥（log 模块的副作用）。
// 旧内置 App 仍直连内部，后续逐步迁移。
// ───────────────────────────────────────────────────────────
export interface ThemePatch {
  mode?: 'dark' | 'light';
  accent?: string;
  wallpaperId?: string;
  radius?: number;
  blur?: number;
}

export const sys = {
  proc: { list: () => processes, launch, close, focus, minimize, restore },
  fs: { list: children, read: getNode, mkdir: createDir, create: createFile, write: writeFile },
  ui: {
    setTheme(p: ThemePatch) {
      if (p.mode === 'dark' || p.mode === 'light') settings.mode = p.mode;
      if (typeof p.accent === 'string') settings.accent = p.accent;
      if (p.wallpaperId && wallpapers.some((w) => w.id === p.wallpaperId)) settings.wallpaperId = p.wallpaperId;
      if (typeof p.radius === 'number') settings.radius = p.radius;
      if (typeof p.blur === 'number') settings.blur = p.blur;
    },
  },
  clipboard: {
    copy(text: string) {
      emit('clip.copy', { text });
    },
    read: () => currentClip(),
    history: () => clipboard.items,
  },
  bus: { emit, on },
  log: logSys,
  // 发一条系统通知（通知中心服务会接住并弹 toast）
  notify(title: string, opts: { body?: string; level?: 'info' | 'success' | 'warn' | 'error'; timeout?: number } = {}) {
    emit('notify', { title, ...opts });
  },
};

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzSys: typeof sys }).__qzSys = sys;
}
