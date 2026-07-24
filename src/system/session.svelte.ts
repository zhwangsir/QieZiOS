import { persisted } from '../kernel/persist.svelte';
import { viewport } from './viewport.svelte';

// ───────────────────────────────────────────────────────────
// 会话状态机（M3/U7）：开机 boot → 登录 login → 桌面 desktop ⇄ 锁屏 locked。
// 模块级 $state，不持久化——浏览器刷新 = 重新开机（每次从 boot 重来）。
// 合法迁移由 TRANSITIONS 表驱动；非法迁移一律拒绝（返回 false，状态不变）。
// ───────────────────────────────────────────────────────────
export type SessionPhase = 'boot' | 'login' | 'desktop' | 'locked';

export const session = $state<{ phase: SessionPhase; user: string }>({
  phase: 'boot',
  user: '', // 登录页选中的用户（锁屏上显示）；空 = 未选（移动端跳过登录）
});

// 合法迁移表：任何阶段都可以回 boot（重启 = 重新开机的心智）。
const TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  boot: ['login', 'locked', 'boot'], // boot→locked = 移动端跳过登录直接首启锁屏
  login: ['desktop', 'boot'],
  desktop: ['locked', 'boot'],
  locked: ['desktop', 'boot'],
};

export function canTransition(to: SessionPhase): boolean {
  return TRANSITIONS[session.phase].includes(to);
}

// 迁移入口：非法迁移拒绝（幂等安全，返回 false 且状态不变）。
export function transition(to: SessionPhase): boolean {
  if (!canTransition(to)) return false;
  session.phase = to;
  return true;
}

// 开机完成：移动端跳过登录直接锁屏（M5 首启锁屏语义并入状态机）；桌面端去登录页。
export function bootComplete(): void {
  transition(viewport.isMobile ? 'locked' : 'login');
}

// 登录页点用户即进桌面（无密码；PIN 留待后续）。只在 login 阶段有效。
export function loginAs(name: string): void {
  if (session.phase !== 'login') return;
  session.user = name;
  session.phase = 'desktop';
}

export function lock(): void {
  // 「用户主动锁定」仅 desktop→locked；boot→locked 在迁移表里保留给 bootComplete（移动端首启）直迁。
  if (session.phase === 'desktop') transition('locked');
}
export function unlock(): void {
  if (session.phase === 'locked') transition('desktop');
}
export function reboot(): void {
  session.user = '';
  transition('boot');
}

// ── 会话偏好（持久化）：独立于 settings（SETTINGS_KEYS 是主题白名单，会话开关不随主题导入/导出）──
export const sessionPrefs = persisted<{ skipBoot: boolean }>('qz.session', { skipBoot: false });

// ── 关机（U8）：确认后 power.off=true → App 渲染黑屏「已关机」→ 点击/按键 reload ──
export const power = $state<{ off: boolean }>({ off: false });
export function shutdown(): void {
  power.off = true;
}

// 关机确认框（U8）：系统菜单点「关机」先弹确认（macOS 心智），确认后才真正 power.off。
// 框的键盘语义（Esc 取消 / Enter 确认）由 Desktop 全局键 handler 统一接，避免多 window listener 抢键。
export const powerConfirm = $state<{ open: boolean }>({ open: false });
export function askShutdown(): void {
  powerConfirm.open = true;
}
export function cancelShutdown(): void {
  powerConfirm.open = false;
}
export function confirmShutdown(): void {
  powerConfirm.open = false;
  shutdown();
}

// ───────────────────────────────────────────────────────────
// U8 顶栏菜单构建（纯函数，注入回调 → 可在 vitest 里裸跑，不碰内核/DOM）。
// 返回结构与 shell/menu.svelte.ts 的 MenuItem 一致（结构化兼容，避免 system→shell 反向依赖）。
// ───────────────────────────────────────────────────────────
export interface SessionMenuItem {
  label: string;
  icon?: string; // Lucide 名或存量 emoji 键（经 <Icon> 渲染）
  onClick: () => void;
  danger?: boolean;
  separator?: boolean; // 在此项之前画分割线
  shortcut?: string; // 快捷键提示（只标注 Desktop 全局键 handler 真实接住的键位）
  disabled?: boolean; // 禁用态：灰化不可点（项保留不消失）
  checked?: boolean; // 勾选态：图标列显示 ✓
}

export interface SystemMenuActions {
  about: () => void; // 关于本机
  launchpad: () => void; // 启动台
  lock: () => void; // 锁定
  sleep: () => void; // 睡眠（简化为锁定）
  restart: () => void; // 重新启动
  shutdown: () => void; // 关机（先确认）
}

export function buildSystemMenu(a: SystemMenuActions): SessionMenuItem[] {
  return [
    { label: '关于本机', icon: 'Info', onClick: a.about },
    { label: '启动台', icon: 'LayoutGrid', onClick: a.launchpad },
    // 锁定快捷键 = Desktop 全局键 handler 真实接住的 Ctrl/Cmd+Q；「睡眠」简化为锁定、同效不重复标注
    { label: '锁定', icon: 'Lock', separator: true, shortcut: 'Ctrl+⌘Q', onClick: a.lock },
    { label: '睡眠', icon: 'Moon', onClick: a.sleep },
    { label: '重新启动', icon: 'RotateCcw', separator: true, onClick: a.restart },
    { label: '关机', icon: 'X', danger: true, onClick: a.shutdown },
  ];
}

export interface AppMenuActions {
  aboutApp: (appId: string | null) => void; // 关于<App>（null = 无活动窗 → 关于本机）
  closeActive: () => void; // 关闭活动窗口
  minimizeAll: () => void; // 全部最小化
  hideOthers: () => void; // 隐藏其他（最小化除活动窗外的所有窗）
}

export function buildAppMenu(
  active: { title: string; appId: string } | null,
  a: AppMenuActions,
  appItems?: SessionMenuItem[], // M12.2 App 声明的菜单项（registry.menus），插在「关于」与窗口操作之间
): SessionMenuItem[] {
  if (!active) {
    return [{ label: '关于本机', icon: 'Info', onClick: () => a.aboutApp(null) }];
  }
  // App 声明项成段插入：段首强制带分割线（与「关于<App>」分组，其余项原样）；
  // 未传/空数组 = 无此段，输出与旧版字节级一致（兼容旧测试与无 menus 的 App）。
  const appSection = appItems?.length
    ? appItems.map((it, i) => (i === 0 ? { ...it, separator: true } : it))
    : [];
  return [
    { label: `关于${active.title}`, icon: 'Info', onClick: () => a.aboutApp(active.appId) },
    ...appSection,
    // ⌘W/⌘H = Desktop 全局键 handler 真实接住的 Ctrl/Cmd+W / Ctrl/Cmd+H（M12.1，macOS 惯例写法）；
    // 「全部最小化」不标——⌘M 是最小化「活动窗」而非全部，不虚构键位
    { label: '关闭窗口', icon: 'X', separator: true, shortcut: '⌘W', onClick: a.closeActive },
    { label: '全部最小化', icon: 'Minus', onClick: a.minimizeAll },
    { label: '隐藏其他', icon: 'EyeOff', separator: true, shortcut: '⌘H', onClick: a.hideOthers },
  ];
}
