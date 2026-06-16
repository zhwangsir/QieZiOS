import type { Component } from 'svelte';
import Welcome from './Welcome.svelte';
import Settings from './Settings.svelte';

// App 注册表：appId → { 元信息 + 组件 }
// · 桌面靠它「按 appId 查出组件」再渲染
// · Dock 靠它列出所有可启动的 App，并用 width/height 作为首次打开尺寸
// 以后第三方 App、把博客做成 App，都是往这里登记一条。
export interface AppDef {
  title: string;
  icon: string;
  component: Component;
  width?: number;
  height?: number;
}

export const appRegistry: Record<string, AppDef> = {
  welcome: { title: '欢迎', icon: '🍆', component: Welcome, width: 460, height: 340 },
  settings: { title: '设置', icon: '⚙️', component: Settings, width: 540, height: 580 },
};
