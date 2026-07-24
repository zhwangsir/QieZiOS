// App 元数据（不 import 任何组件）——纯数据，谁都能安全 import，不会成环。
// registry.ts 在此基础上挂上组件；aiTools 等只需元数据的就 import 这里。
export interface AppMeta {
  id: string;
  title: string;
  icon: string;
  width?: number;
  height?: number;
  hidden?: boolean; // 不在 Dock 显示（如记事本，由文件管理器/AI 打开）
  color?: string; // M9.1 Dock/Launchpad squircle 底板渐变（background 值；缺省走石墨）
}

// M9.1 五色相色板（用户约束：内容配色不超过五种）——蓝/紫/绿/橙/石墨。
// 导出为全系统图标底板配色的单一来源：Dock/Launchpad/桌面文件/Spotlight 都从这里取值。
export const C = {
  blue: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
  violet: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  green: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)',
  orange: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
  graphite: 'linear-gradient(135deg, #4b5563 0%, #1f2937 100%)',
} as const;

export const appList: AppMeta[] = [
  { id: 'welcome', title: '欢迎', icon: '🍆', width: 460, height: 340, color: C.violet },
  { id: 'assistant', title: '助手', icon: '🤖', width: 420, height: 540, color: C.violet },
  { id: 'files', title: '文件', icon: '📁', width: 600, height: 420, color: C.blue },
  { id: 'terminal', title: '终端', icon: '🖥️', width: 640, height: 420, color: C.graphite },
  { id: 'calculator', title: '计算器', icon: '🧮', width: 300, height: 470, color: C.orange },
  { id: 'clock', title: '时钟', icon: '🕐', width: 300, height: 380, color: C.graphite },
  { id: 'trash', title: '回收站', icon: '🗑️', width: 420, height: 380, color: C.graphite },
  { id: 'studio', title: '开发者', icon: '🛠️', width: 760, height: 500, color: C.violet },
  { id: 'myapps', title: '我的 App', icon: '🧩', width: 480, height: 420, color: C.green },
  { id: 'appstore', title: '应用商店', icon: '📦', width: 480, height: 500, color: C.blue },
  { id: 'companion', title: '伙伴', icon: '🧚', width: 360, height: 480, color: C.violet },
  { id: 'sysmon', title: '任务管理器', icon: '📊', width: 560, height: 460, color: C.green },
  { id: 'clipboard', title: '剪贴板', icon: '📋', width: 360, height: 420, color: C.orange },
  { id: 'reminders', title: '提醒', icon: '⏰', width: 340, height: 420, color: C.orange },
  { id: 'screenshot', title: '截图', icon: '📸', width: 560, height: 460, color: C.blue },
  { id: 'webapps', title: '网页 App', icon: '🌐', width: 480, height: 420, color: C.green },
  { id: 'settings', title: '设置', icon: '⚙️', width: 540, height: 580, color: C.graphite },
  { id: 'textedit', title: '记事本', icon: '📝', width: 480, height: 380, hidden: true },
  { id: 'imageviewer', title: '图片', icon: '🖼️', width: 540, height: 440, hidden: true },
  { id: 'mediaviewer', title: '媒体', icon: '🎬', width: 560, height: 420, hidden: true },
  { id: 'webview', title: '网页', icon: '🌐', width: 900, height: 600, hidden: true, color: C.blue },
  { id: 'userapp', title: 'App', icon: '🧩', width: 460, height: 380, hidden: true, color: C.violet },
];

export const appMeta: Record<string, AppMeta> = Object.fromEntries(
  appList.map((a) => [a.id, a]),
);
