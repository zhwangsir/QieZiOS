// ───────────────────────────────────────────────────────────
// 内核 · 进程表（唯一真相源）
// "进程" = 一个正在运行的 App（连同它窗口的几何 + 状态）。
// 这里只放「裸操作」原语；更上层的编排（如 Dock 的点击逻辑）放到外壳里。
// ───────────────────────────────────────────────────────────
export interface Process {
  id: string;        // 进程唯一 id
  appId: string;     // 对应注册表里的哪个 App
  title: string;
  x: number;         // 窗口左上角（用 transform 移动 → 走 GPU 合成器）
  y: number;
  width: number;
  height: number;
  z: number;         // 叠放层级（越大越在上）
  minimized: boolean;
  maximized: boolean;
  data?: unknown;    // 启动参数（如记事本要打开的文件 id）；会随会话一起持久化
}

import { persisted } from './persist.svelte';

// 全局共享的响应式「内核状态」。用 persisted 包起来：
// 开/拖/缩放/关窗口都会（防抖后）自动存盘，刷新后窗口布局原样还原（= 会话还原）。
export const processes = persisted<Process[]>('qz.windows', [], 250);

// 还原会话后，让 nextZ 从已有最大 z 之上接着发，新窗口才不会被压在底下。
let nextZ = processes.reduce((m, p) => Math.max(m, p.z), 0) + 1;

// 启动一个 App = 往进程表加一项（= 开一个窗口）
export function launch(
  appId: string,
  title: string,
  opts: { width?: number; height?: number; data?: unknown } = {},
) {
  const id = `${appId}-${crypto.randomUUID().slice(0, 8)}`;
  const offset = (processes.length % 6) * 28; // 层叠错位，避免新窗口完全重合
  processes.push({
    id,
    appId,
    title,
    x: 140 + offset,
    y: 96 + offset,
    width: opts.width ?? 480,
    height: opts.height ?? 340,
    z: ++nextZ,
    minimized: false,
    maximized: false,
    data: opts.data,
  });
}

export function close(id: string) {
  const i = processes.findIndex((p) => p.id === id);
  if (i !== -1) processes.splice(i, 1);
}

// 聚焦：提到最上层
export function focus(id: string) {
  const p = byId(id);
  if (p) p.z = ++nextZ;
}

export function minimize(id: string) {
  const p = byId(id);
  if (p) p.minimized = true;
}

// 还原：取消最小化并聚焦（Dock 点图标时也走它）
export function restore(id: string) {
  const p = byId(id);
  if (p) {
    p.minimized = false;
    p.z = ++nextZ;
  }
}

// 最大化 ⇄ 还原。最大化时几何数值不动，只切一个标志位，
// 由窗口组件用 CSS 铺满；取消时自然回到原来的 x/y/宽高。
export function toggleMaximize(id: string) {
  const p = byId(id);
  if (!p) return;
  p.maximized = !p.maximized;
  p.z = ++nextZ;
}

// 设置窗口几何/最大化状态。窗口拖拽/缩放/吸附都走它 ——
// 让「改进程」这件事统一归内核，组件不直接改 proc（也避免 Svelte 的 ownership 警告）。
export function setBounds(
  id: string,
  b: Partial<Pick<Process, 'x' | 'y' | 'width' | 'height' | 'maximized'>>,
) {
  const p = byId(id);
  if (!p) return;
  if (b.x !== undefined) p.x = b.x;
  if (b.y !== undefined) p.y = b.y;
  if (b.width !== undefined) p.width = b.width;
  if (b.height !== undefined) p.height = b.height;
  if (b.maximized !== undefined) p.maximized = b.maximized;
}

// 当前活动窗 id = 没最小化的里 z 最大那个。键盘快捷键、焦点高亮都靠它。
// 在 effect/模板里调用会自动订阅 processes（读了每个 p 的 z/minimized）。
export function activeId(): string | null {
  let top: Process | null = null;
  for (const p of processes) {
    if (p.minimized) continue;
    if (!top || p.z > top.z) top = p;
  }
  return top ? top.id : null;
}

// 窗口轮换：把最底层的可见窗提到最前 → 反复调用即在所有窗口间循环（Alt+`）。
export function cycleWindows() {
  const visible = processes.filter((p) => !p.minimized);
  if (visible.length < 2) return;
  const bottom = visible.reduce((b, p) => (p.z < b.z ? p : b));
  bottom.z = ++nextZ;
}

function byId(id: string): Process | undefined {
  return processes.find((p) => p.id === id);
}
