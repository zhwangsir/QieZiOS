import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 最近使用（R4-F2）：最近打开的文件 + 最近启动的 App。
// 由 sys.openApp 这个统一边界推进来（文件查看器带文件 id → 记文件；可见 App → 记 App）。
// Spotlight 空查询时把最近文件置顶、并按最近度给 App 排序 → 「跳回刚才在做的事」。
// 持久化（qz.recents）：刷新/重开后最近列表还在。
// ───────────────────────────────────────────────────────────
const CAP = 20;

export interface Recents {
  files: string[]; // 最近打开文件的节点 id，最新在前
  apps: string[]; // 最近启动 App 的 appId，最新在前
}

export const recents = persisted<Recents>('qz.recents', { files: [], apps: [] });

// 置顶去重：把 id 移到队首、去掉旧的同项、封顶 CAP
function pushFront(arr: string[], id: string): string[] {
  return [id, ...arr.filter((x) => x !== id)].slice(0, CAP);
}

export function pushRecentFile(id: string): void {
  recents.files = pushFront(recents.files, id);
}
export function pushRecentApp(id: string): void {
  recents.apps = pushFront(recents.apps, id);
}

// 从最近列表里抹掉某 id（节点被删/App 被卸载时调用，避免悬挂死引用）
export function forgetRecent(id: string): void {
  if (recents.files.includes(id)) recents.files = recents.files.filter((x) => x !== id);
  if (recents.apps.includes(id)) recents.apps = recents.apps.filter((x) => x !== id);
}
