// M34 App 级自定义菜单（U8 清账）注册表级测试：
// ① 声明了 menus 的 App 经 appRegistry 暴露；② 菜单 onClick 接的是真实全局函数
// （拉起进程 / 清剪贴板 / 拉仓库目录），不是空壳；③ 未声明的 App menus 为 undefined（TopBar 回退窗口操作四项）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock blobStore（测试环境没有 IndexedDB），同 vfs.test 手法
vi.mock('../kernel/blobStore', () => ({
  putBlob: vi.fn(),
  getBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

import { appRegistry } from './registry';
import { processes, closeAll } from '../kernel/processes.svelte';
import { clipboard, pushClip, clearClipboard } from '../system/clipboard.svelte';
import { on } from '../kernel/bus.svelte';

// 捕获 notify 事件（sys.notify → bus emit('notify')）
function watchNotify() {
  const events: Array<{ title: string; level?: string; body?: string; source?: string }> = [];
  const off = on('notify', (p) => events.push(p as (typeof events)[number]));
  return { events, off };
}

describe('M34 appRegistry · App 级菜单声明结构', () => {
  it('textedit / clipboard / appstore 均暴露 menus（新增三家）', () => {
    expect(appRegistry.textedit.menus?.map((m) => m.label)).toEqual(['新建文稿']);
    expect(appRegistry.clipboard.menus?.map((m) => m.label)).toEqual(['清空剪贴板历史']);
    expect(appRegistry.appstore.menus?.map((m) => m.label)).toEqual(['检查更新']);
  });

  it('存量 trash / terminal / files / settings 菜单不受新增影响', () => {
    expect(appRegistry.trash.menus?.map((m) => m.label)).toEqual(['清空回收站']);
    expect(appRegistry.terminal.menus?.map((m) => m.label)).toEqual(['新建窗口']);
    expect(appRegistry.files.menus?.map((m) => m.label)).toEqual(['新建文件夹', '新建文本文件']);
    expect(appRegistry.settings.menus?.map((m) => m.label)).toEqual(['切换明暗主题']);
  });

  it('未声明的 App（calculator）menus 为 undefined → TopBar 回退窗口操作四项', () => {
    expect(appRegistry.calculator.menus).toBeUndefined();
    expect(appRegistry.clock.menus).toBeUndefined();
    expect(appRegistry.assistant.menus).toBeUndefined();
  });

  it('清空类菜单带 danger 标记、图标走 Lucide 注册名', () => {
    const clip = appRegistry.clipboard.menus![0];
    expect(clip.danger).toBe(true);
    expect(clip.icon).toBe('Trash2');
    expect(appRegistry.appstore.menus![0].icon).toBe('RefreshCw');
    expect(appRegistry.textedit.menus![0].icon).toBe('FileText');
  });
});

describe('M34 菜单动作 · 真实全局效果', () => {
  beforeEach(() => {
    closeAll();
    clearClipboard();
  });
  afterEach(() => {
    closeAll();
    clearClipboard();
    vi.unstubAllGlobals();
  });

  it('textedit「新建文稿」：onClick 经 sys.openApp 拉起 textedit 进程', () => {
    expect(processes.some((p) => p.appId === 'textedit')).toBe(false);
    appRegistry.textedit.menus![0].onClick();
    expect(processes.some((p) => p.appId === 'textedit')).toBe(true);
  });

  it('clipboard「清空剪贴板历史」：pushClip 后点击 → items 清空 + notify success', () => {
    const { events, off } = watchNotify();
    pushClip('第一段');
    pushClip('第二段');
    expect(clipboard.items.length).toBe(2);
    appRegistry.clipboard.menus![0].onClick();
    expect(clipboard.items.length).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('已清空剪贴板历史');
    expect(events[0].level).toBe('success');
    expect(events[0].source).toBe('剪贴板');
    off();
  });

  it('appstore「检查更新」成功：mock fetch 返回目录 → notify success 含条目数', async () => {
    const { events, off } = watchNotify();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          name: '测试仓库',
          apps: [
            { id: 'a', name: '甲', icon: 'x', app: {} },
            { id: 'b', name: '乙', icon: 'y', app: {} },
          ],
        }),
      })),
    );
    appRegistry.appstore.menus![0].onClick(); // fire-and-forget：内部 async 兜异常
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0].title).toBe('已是最新目录');
    expect(events[0].level).toBe('success');
    expect(events[0].body).toContain('2 款 App');
    expect(events[0].source).toBe('App Store');
    off();
  });

  it('appstore「检查更新」失败：fetch 抛错 → notify error（异常不外抛、不崩菜单）', async () => {
    const { events, off } = watchNotify();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('网络不可达'))));
    appRegistry.appstore.menus![0].onClick();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0].title).toBe('检查更新失败');
    expect(events[0].level).toBe('error');
    expect(events[0].body).toContain('网络不可达');
    off();
  });

  it('appstore「检查更新」HTTP 非 2xx：fetchCatalog 抛 HTTP 状态 → notify error', async () => {
    const { events, off } = watchNotify();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })));
    appRegistry.appstore.menus![0].onClick();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0].level).toBe('error');
    expect(events[0].body).toContain('502');
    off();
  });
});
