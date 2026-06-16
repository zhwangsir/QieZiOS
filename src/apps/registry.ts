import type { Component } from 'svelte';
import Welcome from './Welcome.svelte';
import Settings from './Settings.svelte';
import Files from './Files.svelte';
import TextEdit from './TextEdit.svelte';
import Calculator from './Calculator.svelte';
import Clock from './Clock.svelte';
import Trash from './Trash.svelte';

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
  hidden?: boolean; // 不在 Dock 显示（如记事本，只由文件管理器打开）
}

export const appRegistry: Record<string, AppDef> = {
  welcome: { title: '欢迎', icon: '🍆', component: Welcome, width: 460, height: 340 },
  files: { title: '文件', icon: '📁', component: Files, width: 600, height: 420 },
  calculator: { title: '计算器', icon: '🧮', component: Calculator, width: 260, height: 380 },
  clock: { title: '时钟', icon: '🕐', component: Clock, width: 300, height: 380 },
  trash: { title: '回收站', icon: '🗑️', component: Trash, width: 420, height: 380 },
  settings: { title: '设置', icon: '⚙️', component: Settings, width: 540, height: 580 },
  textedit: { title: '记事本', icon: '📝', component: TextEdit, width: 480, height: 380, hidden: true },
};
