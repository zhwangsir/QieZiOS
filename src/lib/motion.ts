import { cubicInOut } from 'svelte/easing';
import { viewport } from '../system/viewport.svelte';

// ───────────────────────────────────────────────────────────
// 动效库（M2）：弹簧物理 / Genie 神灯 / Dock 放大波形。
// 原则：只动 transform / opacity / 独立 scale 属性（合成器），不触发布局；
// clip-path（神灯）是个例外——它走绘制而非合成，但 500ms 内可接受（macOS 同理），
// 且动画结束立即清除。reducedMotion 一律退化为瞬时。
// ───────────────────────────────────────────────────────────

// ── U4 弹簧物理 ─────────────────────────────────────────────

export interface SpringParams {
  stiffness?: number; // 刚度 k（参考配方 framer-motion：500）
  damping?: number;   // 阻尼 c（参考配方：25 → 阻尼比 ≈0.56，回弹 ~12%）
  mass?: number;      // 质量 m（默认 1）
}

// 阻尼谐振子解析解 → Svelte easing（t∈[0,1] → 进度值）。
// 欠阻尼时中途会 >1（overshoot 回弹，弹簧手感的来源）；
// 归一化保证严格 0→1 端点（除以 raw(1)），Svelte 过渡末帧不差分毫。
// 相比 cubic-bezier 拟合，这是真弹簧：stiffness/damping 直接对应物理参数。
export function springEasing({ stiffness = 500, damping = 25, mass = 1 }: SpringParams = {}): (t: number) => number {
  const omega0 = Math.sqrt(stiffness / mass);               // 固有角频率
  const zeta = damping / (2 * Math.sqrt(stiffness * mass)); // 阻尼比 ζ
  let raw: (t: number) => number;
  if (zeta < 1) {
    // 欠阻尼（有回弹）：x(t) = 1 - e^(-ζωt)·(cos ωd t + ζω/ωd·sin ωd t)
    const wd = omega0 * Math.sqrt(1 - zeta * zeta);
    raw = (t) => 1 - Math.exp(-zeta * omega0 * t) * (Math.cos(wd * t) + ((zeta * omega0) / wd) * Math.sin(wd * t));
  } else if (Math.abs(zeta - 1) < 1e-6) {
    // 临界阻尼（无回弹最快收敛）
    raw = (t) => 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
  } else {
    // 过阻尼（慢、无回弹）：cosh/sinh 形式
    const q = omega0 * Math.sqrt(zeta * zeta - 1);
    raw = (t) => 1 - Math.exp(-zeta * omega0 * t) * (Math.cosh(q * t) + ((zeta * omega0) / q) * Math.sinh(q * t));
  }
  const end = raw(1) || 1;
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : raw(t) / end);
}

// 弹簧 ~2% 稳定时间（秒）≈ 4/(ζω0) = 8m/c —— 给过渡当时长参考用。
export function springSettleTime({ stiffness = 500, damping = 25, mass = 1 }: SpringParams = {}): number {
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const omega0 = Math.sqrt(stiffness / mass);
  if (zeta <= 0) return Infinity;
  return 4 / (zeta * omega0);
}

// CSS transition 版的回弹曲线（给「拖拽释放 / 吸附落位 / 最大化」的几何过渡用，
// 与弹簧 easing 同一手感：轻微 overshoot）。260ms 落在 200–300ms 弹性带内。
export const SPRING_BEZIER = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const SETTLE_MS = 260;

// 窗口开/关动画（Svelte 自定义过渡）—— M2 起从线性 cubicOut 换成真弹簧。
// 只动 opacity 和【独立的 scale 属性】——注意不是 transform: scale()，
// 因为窗口定位已经占用了 transform: translate()，两者用同一属性会打架。
// scale / translate / rotate 是各自独立的 CSS 属性，能和 transform 叠加，且都走 GPU 合成器。
// opacity 做 clamp：欠阻尼回弹会让 t 短暂 >1 / <0，透明度过界无意义。
// M8.4 offsetY：菜单/弹出面板可传负值（如 -4）→ 出现时有轻微下落感（macos27 menuIn 同款：
// opacity 0 + scale(0.97) translateY(-4px) → 无）；窗口默认 0 不动 translate（避免与定位打架）。
export function pop(
  _node: HTMLElement,
  { duration = 300, stiffness = 500, damping = 25, offsetY = 0 }: { duration?: number; offsetY?: number } & SpringParams = {},
) {
  return {
    duration: viewport.reducedMotion ? 0 : duration, // 尊重「减少动态效果」
    easing: springEasing({ stiffness, damping }),
    // t: 0→1（进入）或 1→0（离开），Svelte 已用 easing 处理过（含 overshoot）
    css: (t: number) =>
      `opacity: ${Math.min(1, Math.max(0, t))}; scale: ${0.92 + 0.08 * t};` +
      (offsetY ? ` translate: 0 ${(1 - t) * offsetY}px;` : ''),
  };
}

// ── U5 Genie 神灯最小化 ─────────────────────────────────────

export const GENIE_MS = 500; // 神灯总时长（参考配方 500ms）
export const genieEase: (t: number) => number = cubicInOut; // 吸入先慢-快-慢的节奏

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// 神灯 clip 梯形插值（纯函数，易测）：t=0 全矩形 → t=1 底边收成指向 Dock 的尖、
// 顶边留 ~14% 宽的小「塞子」。tc = 目标点相对窗口宽度的水平位置（0..1）。
// 顶边慢收（lerp t）、底角快捏（t^0.6，指数 <1 → 前快后慢、底边进度超前顶边）
// → 任意中间帧都是上宽下窄的漏斗梯形（真 macOS：靠 Dock 侧先捏拢）。
export function genieClipPath(tc: number, t: number): string {
  const c = clamp01(tc);
  const topHalf = lerp(0.5, 0.07, t);      // 顶边半宽 50% → 7%
  const topCenter = lerp(0.5, c, t);       // 顶边中心同时缓慢滑向目标
  const pinch = Math.pow(t, 0.6);          // 底角先捏（指数 <1 → 前快后慢）
  const bl = lerp(0, c, pinch);
  const br = lerp(1, c, pinch);
  const f = (n: number) => `${(clamp01(n) * 100).toFixed(2)}%`;
  return `polygon(${f(topCenter - topHalf)} 0%, ${f(topCenter + topHalf)} 0%, ${f(br)} 100%, ${f(bl)} 100%)`;
}

// 单帧神灯姿态（纯函数）：平移吸入 + 缩放 + 尾段淡出 + clip 梯形。
// win / target 均为屏幕坐标（getBoundingClientRect 系）；t=0 恒等 → t=1 窗口中心落在目标上。
// 返回的 dx/dy/scale 由调用方拼进 transform（translate 链 + scale，GPU 合成），
// clip 走绘制（500ms 可接受，结束帧后由调用方清掉 clip-path）。
export function genieFrame(win: Rect, target: Point, t: number) {
  const dx = (target.x - (win.x + win.w / 2)) * t;
  const dy = (target.y - (win.y + win.h / 2)) * t;
  const scale = 1 - 0.88 * t;   // 收到 ~12%（配合梯形像被吸进 Dock）
  const opacity = 1 - t * t;    // 尾段加速淡出，t=1 恰好 0 → 交接给最小化态无跳变
  const tc = win.w > 0 ? clamp01((target.x - win.x) / win.w) : 0.5;
  return { dx, dy, scale, opacity, clip: genieClipPath(tc, t) };
}

// Dock 各 App 图标的屏幕中心坐标表（Dock 上报、窗口最小化时读取）。
// 无需响应式——写入发生在挂载/resize，读取只发生在动画启动那一瞬。
export const dockIconPos: Record<string, Point> = {};

// Svelte action：绑在 Dock 图标按钮上，上报其屏幕中心坐标。
// 卸载/改 id 时清掉旧键，避免留下指向已消失图标的死坐标。
export function trackDockIcon(node: HTMLElement, appId: string) {
  let id = appId;
  const report = () => {
    const r = node.getBoundingClientRect();
    if (r.width > 0) dockIconPos[id] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  report();
  window.addEventListener('resize', report);
  return {
    update(next: string) {
      if (next !== id) {
        delete dockIconPos[id];
        id = next;
        report();
      }
    },
    destroy() {
      delete dockIconPos[id];
      window.removeEventListener('resize', report);
    },
  };
}

// ── U6 Dock 悬停放大波形 ────────────────────────────────────

// 高斯距离衰减波形：scale = 1 + maxAmp·exp(-(d/σ)²)。
// d = 鼠标与图标中心的水平距离(px)，σ ≈ 图标宽度的 1.2 倍（波形陡度），
// maxAmp = 最大放大幅度（如 0.5 → 悬停图标 1.5×）。比旧线性阶梯更陡更弹，
// 且相邻图标连续过渡（波形是连续函数，没有跳档）。
export function magnify(d: number, sigma: number, maxAmp: number): number {
  if (sigma <= 0 || maxAmp <= 0) return 1;
  return 1 + maxAmp * Math.exp(-((d / sigma) ** 2));
}
