// M3「仪式感」· U7 会话状态机 + U8 顶栏菜单构建 测试
// 目标：状态机只走 TRANSITIONS 白名单迁移（非法一律幂等拒绝）；
//       buildSystemMenu/buildAppMenu 为纯函数（注入回调 → vitest 裸跑，不碰内核/DOM）。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  session,
  power,
  powerConfirm,
  canTransition,
  transition,
  bootComplete,
  loginAs,
  lock,
  unlock,
  reboot,
  shutdown,
  askShutdown,
  cancelShutdown,
  confirmShutdown,
  buildSystemMenu,
  buildAppMenu,
  type SystemMenuActions,
  type AppMenuActions,
  type SessionMenuItem,
} from './session.svelte';

// 模块级 $state 跨用例共享 → 每个用例前复位（TRANSITIONS 允许任何阶段 →boot）
beforeEach(() => {
  reboot();
  power.off = false;
  powerConfirm.open = false;
});

describe('U7 会话状态机', () => {
  it('复位后为 boot、无用户', () => {
    expect(session.phase).toBe('boot');
    expect(session.user).toBe('');
  });

  it('合法全链：boot→login→desktop→locked→desktop', () => {
    expect(transition('login')).toBe(true);
    expect(session.phase).toBe('login');
    expect(transition('desktop')).toBe(true);
    expect(transition('locked')).toBe(true);
    expect(transition('desktop')).toBe(true);
    expect(session.phase).toBe('desktop');
  });

  it('boot→locked 合法（移动端首启跳过登录直进锁屏）', () => {
    expect(canTransition('locked')).toBe(true);
    expect(transition('locked')).toBe(true);
    expect(session.phase).toBe('locked');
  });

  it('非法迁移一律拒绝（返回 false 且状态不变）', () => {
    expect(transition('desktop')).toBe(false); // boot→desktop 跳过登录
    expect(session.phase).toBe('boot');
    transition('login');
    expect(transition('locked')).toBe(false); // login→locked
    expect(session.phase).toBe('login');
    transition('desktop');
    expect(transition('login')).toBe(false); // desktop 不回 login
    expect(session.phase).toBe('desktop');
    transition('locked');
    expect(transition('login')).toBe(false); // locked 只能回 desktop/boot
    expect(session.phase).toBe('locked');
  });

  it('任何阶段都能 reboot 回 boot（重启 = 重新开机心智）', () => {
    transition('login');
    expect(transition('boot')).toBe(true);
    transition('login');
    transition('desktop');
    expect(transition('boot')).toBe(true);
    transition('login');
    transition('desktop');
    transition('locked');
    expect(transition('boot')).toBe(true);
  });

  it('bootComplete：测试环境无 window.matchMedia → isMobile=false → 去 login', () => {
    bootComplete();
    expect(session.phase).toBe('login');
  });

  it('loginAs 只在 login 阶段生效并记录用户', () => {
    loginAs('guest'); // boot 阶段：静默拒绝
    expect(session.phase).toBe('boot');
    expect(session.user).toBe('');
    transition('login');
    loginAs('qiezi');
    expect(session.phase).toBe('desktop');
    expect(session.user).toBe('qiezi');
  });

  it('lock/unlock 仅 desktop⇄locked，其它阶段静默拒绝', () => {
    lock();
    expect(session.phase).toBe('boot'); // 拒绝
    transition('login');
    transition('desktop');
    lock();
    expect(session.phase).toBe('locked');
    lock();
    expect(session.phase).toBe('locked'); // 已在 locked：幂等拒绝
    unlock();
    expect(session.phase).toBe('desktop');
  });

  it('reboot 清空用户并回 boot', () => {
    transition('login');
    loginAs('qiezi');
    reboot();
    expect(session.phase).toBe('boot');
    expect(session.user).toBe('');
  });
});

describe('U8 关机与确认', () => {
  it('shutdown 直接置 power.off（黑屏由 App 渲染）', () => {
    shutdown();
    expect(power.off).toBe(true);
  });

  it('askShutdown 打开确认框；cancelShutdown 取消且不关机', () => {
    askShutdown();
    expect(powerConfirm.open).toBe(true);
    cancelShutdown();
    expect(powerConfirm.open).toBe(false);
    expect(power.off).toBe(false);
  });

  it('confirmShutdown 关确认框并真正关机', () => {
    askShutdown();
    confirmShutdown();
    expect(powerConfirm.open).toBe(false);
    expect(power.off).toBe(true);
  });
});

describe('U8 buildSystemMenu（系统菜单）', () => {
  function makeActions() {
    const calls: string[] = [];
    const a: SystemMenuActions = {
      about: () => calls.push('about'),
      launchpad: () => calls.push('launchpad'),
      lock: () => calls.push('lock'),
      sleep: () => calls.push('sleep'),
      restart: () => calls.push('restart'),
      shutdown: () => calls.push('shutdown'),
    };
    return { calls, a };
  }

  it('6 项，label 序列/分割/危险标记符合系统菜单心智', () => {
    const items = buildSystemMenu(makeActions().a);
    expect(items.map((i) => i.label)).toEqual([
      '关于本机',
      '启动台',
      '锁定',
      '睡眠',
      '重新启动',
      '关机',
    ]);
    expect(items.find((i) => i.label === '锁定')!.separator).toBe(true);
    expect(items.find((i) => i.label === '重新启动')!.separator).toBe(true);
    expect(items.find((i) => i.label === '关机')!.danger).toBe(true);
    expect(items.every((i) => typeof i.icon === 'string' && i.icon.length > 0)).toBe(true);
  });

  it('每项 onClick 触发对应注入回调（纯函数、按声明顺序）', () => {
    const { calls, a } = makeActions();
    for (const item of buildSystemMenu(a)) item.onClick();
    expect(calls).toEqual(['about', 'launchpad', 'lock', 'sleep', 'restart', 'shutdown']);
  });

  it('锁定项标注真实快捷键 Ctrl+⌘Q（Desktop 全局键 handler 存在）；睡眠与其同效不重复标注', () => {
    const items = buildSystemMenu(makeActions().a);
    expect(items.find((i) => i.label === '锁定')!.shortcut).toBe('Ctrl+⌘Q');
    expect(items.find((i) => i.label === '睡眠')!.shortcut).toBeUndefined();
    // 全菜单只有锁定一项带快捷键（不虚构未接 handler 的快捷键）
    expect(items.filter((i) => i.shortcut !== undefined)).toHaveLength(1);
  });
});

describe('U8 buildAppMenu（活动 App 菜单）', () => {
  function makeActions() {
    const calls: Array<string | null> = [];
    const a: AppMenuActions = {
      aboutApp: (id) => calls.push(id),
      closeActive: () => calls.push('close'),
      minimizeAll: () => calls.push('minAll'),
      hideOthers: () => calls.push('hide'),
    };
    return { calls, a };
  }

  it('无活动窗：回退只剩「关于本机」，aboutApp 收 null', () => {
    const { calls, a } = makeActions();
    const items = buildAppMenu(null, a);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('关于本机');
    items[0].onClick();
    expect(calls).toEqual([null]);
  });

  it('有活动窗：关于<App>/关闭窗口/全部最小化/隐藏其他', () => {
    const { calls, a } = makeActions();
    const items = buildAppMenu({ title: '文件', appId: 'files' }, a);
    expect(items.map((i) => i.label)).toEqual([
      '关于文件',
      '关闭窗口',
      '全部最小化',
      '隐藏其他',
    ]);
    items[0].onClick();
    expect(calls).toEqual(['files']); // aboutApp 带活动 appId
    items[1].onClick();
    items[2].onClick();
    items[3].onClick();
    expect(calls).toEqual(['files', 'close', 'minAll', 'hide']);
  });

  it('M12.1：关闭窗口标注 ⌘W、隐藏其他标注 ⌘H（Desktop 已接 handler）；全部最小化不标', () => {
    const items = buildAppMenu({ title: '文件', appId: 'files' }, makeActions().a);
    expect(items.find((i) => i.label === '关闭窗口')!.shortcut).toBe('⌘W');
    expect(items.find((i) => i.label === '隐藏其他')!.shortcut).toBe('⌘H');
    // ⌘M 是最小化「活动窗」不是全部 → 「全部最小化」无真实对应键位，不虚构标注
    expect(items.find((i) => i.label === '全部最小化')!.shortcut).toBeUndefined();
    expect(items.filter((i) => i.shortcut !== undefined)).toHaveLength(2);
  });
});

describe('M12.2 buildAppMenu（App 级菜单合并）', () => {
  function makeActions() {
    const calls: Array<string | null> = [];
    const a: AppMenuActions = {
      aboutApp: (id) => calls.push(id),
      closeActive: () => calls.push('close'),
      minimizeAll: () => calls.push('minAll'),
      hideOthers: () => calls.push('hide'),
    };
    return { calls, a };
  }
  const active = { title: '回收站', appId: 'trash' };
  // App 声明的示范菜单项（动作在 registry 侧绑定，这里只验证合并结构）
  const appItems: SessionMenuItem[] = [
    { label: '清空回收站', icon: 'Trash2', danger: true, onClick: () => {} },
    { label: '回收站设置', icon: 'Settings', onClick: () => {} },
  ];

  it('有 appItems：关于<App> → App 声明项 → 窗口操作四项，顺序正确', () => {
    const items = buildAppMenu(active, makeActions().a, appItems);
    expect(items.map((i) => i.label)).toEqual([
      '关于回收站',
      '清空回收站',
      '回收站设置',
      '关闭窗口',
      '全部最小化',
      '隐藏其他',
    ]);
  });

  it('有 appItems：首个 App 项强制带分割线（与「关于」分组），原分割线语义不变', () => {
    const items = buildAppMenu(active, makeActions().a, appItems);
    const at = (label: string) => items.find((i) => i.label === label)!;
    expect(at('清空回收站').separator).toBe(true); // 注入的分组线
    expect(at('回收站设置').separator).toBeUndefined(); // 后续 App 项不重复画线
    expect(at('关闭窗口').separator).toBe(true); // 窗口操作段原分割线保留
    expect(at('隐藏其他').separator).toBe(true);
    // App 项原有属性（danger/icon）不被合并过程吞掉
    expect(at('清空回收站').danger).toBe(true);
    expect(at('清空回收站').icon).toBe('Trash2');
  });

  it('appItems 首项原本就带 separator：不重复、不丢失', () => {
    const items = buildAppMenu(active, makeActions().a, [
      { label: '清空回收站', separator: true, onClick: () => {} },
    ]);
    expect(items.find((i) => i.label === '清空回收站')!.separator).toBe(true);
  });

  it('不传 appItems（undefined）：回退原样，与现状字节级一致', () => {
    const items = buildAppMenu(active, makeActions().a);
    expect(items.map((i) => i.label)).toEqual([
      '关于回收站',
      '关闭窗口',
      '全部最小化',
      '隐藏其他',
    ]);
    expect(items[1].separator).toBe(true);
  });

  it('appItems 为空数组：无多余分割线、无多余项', () => {
    const items = buildAppMenu(active, makeActions().a, []);
    expect(items.map((i) => i.label)).toEqual([
      '关于回收站',
      '关闭窗口',
      '全部最小化',
      '隐藏其他',
    ]);
    // 「关闭窗口」仍是第一根分割线，没有被空 App 段插入额外项
    expect(items.filter((i) => i.separator).map((i) => i.label)).toEqual(['关闭窗口', '隐藏其他']);
  });

  it('无活动窗：忽略 appItems，仍回退「关于本机」单项', () => {
    const { calls, a } = makeActions();
    const items = buildAppMenu(null, a, appItems);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('关于本机');
    items[0].onClick();
    expect(calls).toEqual([null]);
  });
});
