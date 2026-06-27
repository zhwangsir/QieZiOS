import type { Component } from 'svelte';
import { appMeta, type AppMeta } from './appList';
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

export const appRegistry: Record<string, AppDef> = Object.fromEntries(
  Object.entries(appMeta).map(([id, m]) => [id, { ...m, component: components[id] }]),
);
