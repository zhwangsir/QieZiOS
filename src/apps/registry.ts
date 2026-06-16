import type { Component } from 'svelte';
import Hello from './Hello.svelte';

// App 注册表：appId → { 元信息 + 组件 }
// · 桌面靠它"按 appId 查出组件"再渲染
// · Dock 靠它列出所有可启动的 App
// 以后第三方 App、把博客做成 App，都是往这里登记一条。
export interface AppDef {
  title: string;
  icon: string;
  component: Component;
}

export const appRegistry: Record<string, AppDef> = {
  hello: { title: 'Hello', icon: '🍆', component: Hello },
};
