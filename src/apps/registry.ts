import type { Component } from 'svelte';
import { appMeta, type AppMeta } from './appList';
import type { SessionMenuItem } from '../system/session.svelte';
import { createDir, createFile } from '../kernel/vfs.svelte';
import { toggleTheme } from '../system/theme.svelte';
import { clearClipboard } from '../system/clipboard.svelte';
import { fetchCatalog } from '../system/appRepo.svelte';
import { sys } from '../system/sys';
import Welcome from './Welcome.svelte';
import Assistant from './Assistant.svelte';
import Settings from './Settings.svelte';
import Files from './Files.svelte';
import Terminal from './Terminal.svelte';
import TextEdit from './TextEdit.svelte';
import Calculator from './Calculator.svelte';
import Clock from './Clock.svelte';
import Trash from './Trash.svelte';
import Studio from './Studio.svelte';
import AppGallery from './AppGallery.svelte';
import AppStore from './AppStore.svelte';
import UserApp from './UserApp.svelte';
import ImageViewer from './ImageViewer.svelte';
import MediaViewer from './MediaViewer.svelte';
import Companion from './Companion.svelte';
import SysMonitor from './SysMonitor.svelte';
import Clipboard from './Clipboard.svelte';
import Reminders from './Reminders.svelte';
import Screenshot from './Screenshot.svelte';
import WebAppGallery from './WebAppGallery.svelte';
import WebView from './WebView.svelte';

// App 注册表 = 元数据(appList) + 组件。
// · 桌面靠它「按 appId 查出组件」再渲染；Dock 靠它列出可启动 App。
// 加新 App：appList 加一条元数据 + 这里 components 挂一个组件。
export interface AppDef extends AppMeta {
  component: Component;
  data?: unknown; // 启动时带的参数（用户 App 用它把自己的 id 传进通用宿主）
  // M12.2 App 级菜单（可选）：顶栏 App 菜单里插在「关于<App>」与窗口操作之间的 App 专属项。
  // 类型取 system 层的 SessionMenuItem（apps→system 单向依赖，session 不 import 本层 → 不成环）。
  menus?: SessionMenuItem[];
}

const components: Record<string, Component> = {
  welcome: Welcome,
  assistant: Assistant,
  files: Files,
  terminal: Terminal,
  calculator: Calculator,
  clock: Clock,
  trash: Trash,
  studio: Studio,
  myapps: AppGallery,
  appstore: AppStore,
  companion: Companion,
  sysmon: SysMonitor,
  clipboard: Clipboard,
  reminders: Reminders,
  screenshot: Screenshot,
  webapps: WebAppGallery,
  settings: Settings,
  textedit: TextEdit,
  imageviewer: ImageViewer,
  mediaviewer: MediaViewer,
  webview: WebView,
  userapp: UserApp,
};

// M34：App Store「检查更新」—— 拉仓库目录 → 通知结果（成功报条目数 / 失败报原因）。
// onClick 是同步签名，异步体包成 fire-and-forget，异常在内部兜住转通知，不外抛。
async function checkCatalogUpdates(): Promise<void> {
  try {
    const cat = await fetchCatalog();
    sys.notify('已是最新目录', {
      body: `仓库现有 ${cat.apps.length} 款 App`,
      level: 'success',
      timeout: 2000,
      source: 'App Store',
    });
  } catch (e) {
    sys.notify('检查更新失败', {
      body: e instanceof Error ? e.message : String(e),
      level: 'error',
      timeout: 2500,
      source: 'App Store',
    });
  }
}

// M12.2 App 级菜单声明（示范）：动作只接真实存在的全局函数（sys 门面 / vfs 内核 API），
// 不碰窗口实例状态 → 菜单在顶栏点开时对「当前会话」全局生效，与窗口焦点无关。
const appMenus: Record<string, SessionMenuItem[]> = {
  trash: [
    {
      label: '清空回收站',
      icon: 'Trash2',
      danger: true,
      onClick: () => sys.fs.emptyTrashWithNotify(),
    },
  ],
  terminal: [{ label: '新建窗口', icon: 'Plus', onClick: () => sys.openApp('terminal') }],
  // M34：文本编辑「新建文稿」与终端「新建窗口」同语义——开一扇新窗口
  textedit: [{ label: '新建文稿', icon: 'FileText', onClick: () => sys.openApp('textedit') }],
  // M34：剪贴板「清空历史」—— clearClipboard 清数据层 + 通知收口（危险色对齐清空回收站）
  clipboard: [
    {
      label: '清空剪贴板历史',
      icon: 'Trash2',
      danger: true,
      onClick: () => {
        clearClipboard();
        sys.notify('已清空剪贴板历史', { level: 'success', timeout: 1500, source: '剪贴板' });
      },
    },
  ],
  // M34：App Store「检查更新」—— 拉远程目录报条目数（异步结果走通知，不阻塞菜单关闭）
  appstore: [{ label: '检查更新', icon: 'RefreshCw', onClick: () => void checkCatalogUpdates() }],
  // M13.2：与桌面右键同语义（createDir/createFile 落根目录），新建到 root 后 notify 提示位置
  files: [
    {
      label: '新建文件夹',
      icon: 'Folder',
      onClick: () => {
        createDir('root');
        sys.notify('已在桌面新建文件夹', { level: 'success', timeout: 1500, source: '文件' });
      },
    },
    {
      label: '新建文本文件',
      icon: 'FileText',
      onClick: () => {
        createFile('root');
        sys.notify('已在桌面新建文本文件', { level: 'success', timeout: 1500, source: '文件' });
      },
    },
  ],
  settings: [
    {
      label: '切换明暗主题',
      icon: 'SunMoon',
      onClick: toggleTheme,
    },
  ],
};

export const appRegistry: Record<string, AppDef> = Object.fromEntries(
  Object.entries(appMeta).map(([id, m]) => [
    id,
    { ...m, component: components[id], ...(appMenus[id] ? { menus: appMenus[id] } : {}) },
  ]),
);
