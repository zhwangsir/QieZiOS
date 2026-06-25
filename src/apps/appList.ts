// App 元数据（不 import 任何组件）——纯数据，谁都能安全 import，不会成环。
// registry.ts 在此基础上挂上组件；aiTools 等只需元数据的就 import 这里。
export interface AppMeta {
  id: string;
  title: string;
  icon: string;
  width?: number;
  height?: number;
  hidden?: boolean; // 不在 Dock 显示（如记事本，由文件管理器/AI 打开）
}

export const appList: AppMeta[] = [
  { id: 'welcome', title: '欢迎', icon: '🍆', width: 460, height: 340 },
  { id: 'assistant', title: '助手', icon: '🤖', width: 420, height: 540 },
  { id: 'files', title: '文件', icon: '📁', width: 600, height: 420 },
  { id: 'calculator', title: '计算器', icon: '🧮', width: 260, height: 380 },
  { id: 'clock', title: '时钟', icon: '🕐', width: 300, height: 380 },
  { id: 'trash', title: '回收站', icon: '🗑️', width: 420, height: 380 },
  { id: 'studio', title: '开发者', icon: '🛠️', width: 760, height: 500 },
  { id: 'settings', title: '设置', icon: '⚙️', width: 540, height: 580 },
  { id: 'textedit', title: '记事本', icon: '📝', width: 480, height: 380, hidden: true },
];

export const appMeta: Record<string, AppMeta> = Object.fromEntries(
  appList.map((a) => [a.id, a]),
);
