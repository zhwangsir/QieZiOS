import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// Dock 偏好（持久化）：自定义排序 + 固定/取消固定。
// ⚠️ 单独成模块、不塞进 settings —— settings 的 SETTINGS_KEYS 是「主题导入/导出」
// 白名单，Dock 布局不该随配色主题一起被导出/覆盖。
// ───────────────────────────────────────────────────────────
interface DockPrefs {
  order: string[];   // 自定义排序的 appId 顺序；不在表里的排到后面（保持默认相对顺序）
  hidden: string[];  // 从 Dock 取消固定（移除）的 appId
}

export const dockPrefs = persisted<DockPrefs>('qz.dock', { order: [], hidden: [] });

// 把传入的 App 列表按 order 排序 + 过滤掉 hidden。
// 运行中的 App 即使被取消固定也保留（圆点可见、可点回原窗）—— 和 macOS 一致。
export function sortDockApps<T extends { id: string }>(apps: T[], running: Set<string>): T[] {
  const visible = apps.filter((a) => !dockPrefs.hidden.includes(a.id) || running.has(a.id));
  const idx = (id: string) => {
    const i = dockPrefs.order.indexOf(id);
    return i === -1 ? Infinity : i;
  };
  // stable sort：order 内的按 order，order 外的（Infinity）保持原相对顺序
  return visible
    .map((a, i) => [a, i] as const)
    .sort(([a, ai], [b, bi]) => idx(a.id) - idx(b.id) || ai - bi)
    .map(([a]) => a);
}

export function isPinned(id: string): boolean {
  return !dockPrefs.hidden.includes(id);
}

export function pinApp(id: string): void {
  if (dockPrefs.hidden.includes(id)) dockPrefs.hidden = dockPrefs.hidden.filter((x) => x !== id);
}

export function unpinApp(id: string): void {
  if (!dockPrefs.hidden.includes(id)) dockPrefs.hidden = [...dockPrefs.hidden, id];
}

// 在「当前展示顺序 orderedIds」里把 id 往左(-1)/右(+1)挪一格，整条写回 order。
// 写整条（而非只写两个）→ 后续排序稳定，不会让没动的项掉到 Infinity 丢相对位。
export function moveDockApp(orderedIds: string[], id: string, dir: -1 | 1): void {
  const ids = [...orderedIds];
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  dockPrefs.order = ids;
}

// 拖拽重排：把 dragId 移到 targetId 之前（插入式，比 swap 更接近拖放手感）。
export function dragReorder(orderedIds: string[], dragId: string, targetId: string): void {
  if (dragId === targetId) return;
  const ids = [...orderedIds];
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  dockPrefs.order = ids;
}

export function resetDock(): void {
  dockPrefs.order = [];
  dockPrefs.hidden = [];
}
