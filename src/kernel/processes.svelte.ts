// ───────────────────────────────────────────────────────────
// 内核 · 进程表（唯一真相源）
// "进程" = 一个正在运行的 App（连同它窗口的几何 + 状态）。
// 这里只放「裸操作」原语；更上层的编排（如 Dock 的点击逻辑）放到外壳里。
// ───────────────────────────────────────────────────────────
export interface Process {
  id: string;        // 进程唯一 id（uuid 串）
  pid: number;       // 数字 PID（每次开机重排，便于人看 / 任务管理器展示）
  ppid: number;      // 父进程 PID（0 = init/内核；由终端 open 启动的进程 = 终端的 pid）
  appId: string;     // 对应注册表里的哪个 App
  title: string;
  x: number;         // 窗口左上角（用 transform 移动 → 走 GPU 合成器）
  y: number;
  width: number;
  height: number;
  z: number;         // 叠放层级（越大越在上）
  minimized: boolean;
  maximized: boolean;
  alwaysOnTop?: boolean; // 置顶：z 段始终高于普通窗口（10000+ vs 0-9999）
  startedAt: number; // 启动时间戳（任务管理器算运行时长）
  data?: unknown;    // 启动参数（如记事本要打开的文件 id）；会随会话一起持久化
}

import { persisted } from './persist.svelte';
import { emit } from './bus.svelte';

// 全局共享的响应式「内核状态」。用 persisted 包起来：
// 开/拖/缩放/关窗口都会（防抖后）自动存盘，刷新后窗口布局原样还原（= 会话还原）。
export const processes = persisted<Process[]>('qz.windows', [], 250);

// PID 每次开机重排（符合真系统语义：PID 不跨重启保留）。
let pidCounter = 0;
const nextPid = () => ++pidCounter;
for (const p of processes) {
  p.pid = nextPid();
  p.ppid = 0; // 重启后父子关系不保留（PID 重排，同真系统：还原的进程全部重挂到 init/0）
  if (p.startedAt == null) p.startedAt = Date.now();
}

// 置顶窗口 z 段：TOP_BASE+；普通窗口 z 段：1..TOP_BASE-1（互不重叠 → 置顶窗始终在普通窗之上）。
const TOP_BASE = 10000;

// 还原会话后，让 nextZ / nextTopZ 从已有最大 z 之上接着发，新窗口才不会被压在底下。
// 普通窗与置顶窗分别维护计数器（会话还原后按 alwaysOnTop 归位到对应段）。
let nextZ = 1;
let nextTopZ = TOP_BASE + 1;
for (const p of processes) {
  if (p.alwaysOnTop) nextTopZ = Math.max(nextTopZ, p.z + 1);
  else nextZ = Math.max(nextZ, p.z + 1);
}

// 最近聚焦窗 id。activeId() 优先返回它 —— 置顶窗 z 始终高于普通窗，
// 若仅按 z 取最大，普通窗在有置顶窗时永远拿不到焦点高亮（破坏既有行为）。
let lastFocusedId: string | null = null;

// z 值无上限递增会缓慢膨胀（focus/restore 每次都 ++）。超过阈值时按当前层级
// 重新编号为 1..n —— 相对顺序不变，只是压缩数值，避免 z-index 无界增长。
// 仅规整化普通窗段（置顶窗通常很少，不会触阈）。
const Z_NORMALIZE_THRESHOLD = 500;
function normalizeZ() {
  if (nextZ < Z_NORMALIZE_THRESHOLD) return;
  const sorted = [...processes].filter((p) => !p.alwaysOnTop).sort((a, b) => a.z - b.z);
  sorted.forEach((p, i) => (p.z = i + 1));
  nextZ = sorted.length + 1;
}

// 分配普通窗 z 值（聚焦/置顶前调用，自动触发规整化）
function allocZ(): number {
  normalizeZ();
  return ++nextZ;
}

// 分配置顶窗 z 值（始终 > TOP_BASE，置顶窗之间仍按点击顺序排列）
function allocTopZ(): number {
  return ++nextTopZ;
}

// 按窗口的置顶态分配对应段的 z
function allocZFor(p: Process): number {
  return p.alwaysOnTop ? allocTopZ() : allocZ();
}

// 启动一个 App = 往进程表加一项（= 开一个窗口）
export function launch(
  appId: string,
  title: string,
  opts: { width?: number; height?: number; data?: unknown; ppid?: number } = {},
) {
  const id = `${appId}-${crypto.randomUUID().slice(0, 8)}`;
  const pid = nextPid();
  const ppid = opts.ppid ?? 0; // 缺省 0 = init/内核启动；终端 open 会传自己的 pid
  const offset = (processes.length % 6) * 28; // 层叠错位，避免新窗口完全重合
  processes.push({
    id,
    pid,
    ppid,
    appId,
    title,
    x: 140 + offset,
    y: 96 + offset,
    width: opts.width ?? 480,
    height: opts.height ?? 340,
    z: allocZ(),
    minimized: false,
    maximized: false,
    startedAt: Date.now(),
    data: opts.data,
  });
  lastFocusedId = id;
  emit('proc.launch', { pid, ppid, appId });
}

export function close(id: string) {
  const i = processes.findIndex((p) => p.id === id);
  if (i !== -1) {
    emit('proc.exit', { pid: processes[i].pid, appId: processes[i].appId });
    if (lastFocusedId === id) lastFocusedId = null;
    processes.splice(i, 1);
  }
}

// 聚焦：提到最上层（普通窗在普通段、置顶窗在置顶段）
export function focus(id: string) {
  const p = byId(id);
  if (p) {
    p.z = allocZFor(p);
    lastFocusedId = id;
  }
}

export function minimize(id: string) {
  const p = byId(id);
  if (p && !p.minimized) {
    p.minimized = true;
    emit('proc.minimize', { pid: p.pid, appId: p.appId });
  }
}

// 还原：取消最小化并聚焦（Dock 点图标时也走它）
export function restore(id: string) {
  const p = byId(id);
  if (p) {
    if (p.minimized) emit('proc.restore', { pid: p.pid, appId: p.appId });
    p.minimized = false;
    p.z = allocZFor(p);
    lastFocusedId = id;
  }
}

// 最大化 ⇄ 还原。最大化时几何数值不动，只切一个标志位，
// 由窗口组件用 CSS 铺满；取消时自然回到原来的 x/y/宽高。
export function toggleMaximize(id: string) {
  const p = byId(id);
  if (!p) return;
  p.maximized = !p.maximized;
  p.z = allocZFor(p);
  lastFocusedId = id;
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

// 置顶 ⇄ 取消。切换 alwaysOnTop 后重分配 z 到对应段（置顶段 10000+ / 普通段 1+），
// 确保置顶窗始终在普通窗之上。置顶窗之间、普通窗之间仍按点击顺序排列。
export function setAlwaysOnTop(id: string, value: boolean) {
  const p = byId(id);
  if (!p || p.alwaysOnTop === value) return;
  p.alwaysOnTop = value;
  p.z = value ? allocTopZ() : allocZ();
  lastFocusedId = id;
  emit('proc.alwaysOnTop', { pid: p.pid, appId: p.appId, value });
}

// 改窗口的启动参数 data（与可选 title）—— M54.4 R5-F6：把文件拖进查看器窗口时
// 用它切换当前查看的文件。统一经内核改 proc，避免组件直接改 prop 触发 Svelte ownership 警告
// （与 setBounds 同语义：组件不直接改 proc）。
export function setData(id: string, data: unknown, title?: string): void {
  const p = byId(id);
  if (!p) return;
  p.data = data;
  if (title !== undefined) p.title = title;
}

// 当前活动窗 id。优先返回最近聚焦的窗口（置顶窗 z 始终更高，但焦点可以落在普通窗上）；
// 回退到 z 最大的可见窗口（首次启动 / 活动窗被关闭后）。
// 在 effect/模板里调用会自动订阅 processes（读了每个 p 的 z/minimized）。
export function activeId(): string | null {
  if (lastFocusedId) {
    const p = byId(lastFocusedId);
    if (p && !p.minimized) return p.id;
  }
  let top: Process | null = null;
  for (const p of processes) {
    if (p.minimized) continue;
    if (!top || p.z > top.z) top = p;
  }
  return top ? top.id : null;
}

// 窗口轮换：把最底层的可见窗提到最前 → 反复调用即在所有窗口间循环（Alt+`）。
// 按置顶态分配对应段 z（置顶窗只在置顶窗之间轮换，普通窗只在普通窗之间轮换）。
export function cycleWindows() {
  const visible = processes.filter((p) => !p.minimized);
  if (visible.length < 2) return;
  const bottom = visible.reduce((b, p) => (p.z < b.z ? p : b));
  bottom.z = allocZFor(bottom);
  lastFocusedId = bottom.id;
}

// 关闭所有窗口
export function closeAll() {
  processes.splice(0, processes.length);
  lastFocusedId = null;
}

// 层叠排列：所有可见窗口取消最大化、错位摆放
export function cascade() {
  let i = 0;
  for (const p of processes) {
    if (p.minimized) continue;
    p.maximized = false;
    p.x = 80 + i * 32;
    p.y = 60 + i * 32;
    p.z = allocZFor(p);
    i++;
  }
}

// 关闭某个 App 的全部窗口
export function closeApp(appId: string) {
  for (let i = processes.length - 1; i >= 0; i--) {
    if (processes[i].appId === appId) processes.splice(i, 1);
  }
}

// 最小化某个 App 的全部窗口
export function minimizeApp(appId: string) {
  for (const p of processes) if (p.appId === appId) p.minimized = true;
}

function byId(id: string): Process | undefined {
  return processes.find((p) => p.id === id);
}
