// ───────────────────────────────────────────────────────────
// 图标体系 · 纯数据层（不 import 任何组件，vitest 可直接跑）
// 架构：存量数据（appList.icon / MenuItem.icon / 文件类型判断）仍以 emoji 字符为
// 存储键——渲染时统一经 <Icon name> 映射到 Lucide 组件，emoji 永不直接上屏。
// 新代码也可直接传 Lucide 导出名（如 <Icon name="ZoomIn" />）。
// iconRegistry.ts 负责「名字 → 组件」，并以 Record<IconName, …> 由类型系统保证
// 注册表与下方 ICON_NAMES 完整一致（漏注册 = svelte-check 报错）。
// ───────────────────────────────────────────────────────────

// 本系统注册的全部 Lucide 图标名（与 iconRegistry.ts 的键一一对应）。
export const ICON_NAMES = [
  'Activity',
  'AppWindow',
  'ArrowRight',
  'Bell',
  'BellOff',
  'Bot',
  'Brain',
  'Calculator',
  'Camera',
  'Check',
  'ChevronDown',
  'ChevronLeft',
  'ChevronRight',
  'ChevronUp',
  'Clapperboard',
  'Clipboard',
  'ClipboardPaste',
  'Clock',
  'Delete',
  'DoorOpen',
  'Download',
  'ExternalLink',
  'EyeOff',
  'File',
  'FileArchive',
  'FileText',
  'Folder',
  'FolderOpen',
  'Globe',
  'History',
  'Hourglass',
  'Image',
  'Info',
  'KeyRound',
  'Keyboard',
  'Languages',
  'Layers',
  'LayoutGrid',
  'List',
  'Lock',
  'LockOpen',
  'Maximize2',
  'MessageSquare',
  'Minus',
  'Moon',
  'Music',
  'NotebookPen',
  'Palette',
  'Paperclip',
  'Pencil',
  'Pin',
  'Play',
  'Plus',
  'Puzzle',
  'RefreshCw',
  'Rocket',
  'RotateCcw',
  'Ruler',
  'Save',
  'Scissors',
  'Search',
  'SendHorizontal',
  'Settings',
  'ShieldCheck',
  'ShoppingBag',
  'Sparkles',
  'Square',
  'Sun',
  'SunMoon',
  'Terminal',
  'Timer',
  'Trash2',
  'TriangleAlert',
  'Undo2',
  'Upload',
  'User',
  'Volume2',
  'WandSparkles',
  'Wrench',
  'X',
  'ZoomIn',
  'ZoomOut',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES);

// emoji（存储键）→ Lucide 图标名。键一律不写 VS16（U+FE0F），查找前会先剥离。
// 语义与下方 APP_TO_ICON 对齐（同一 App 在桌面/移动外壳用同一图标）。
const EMOJI_TO_ICON: Record<string, IconName> = {
  // ── App 图标（appList.icon） ──
  '🍆': 'Rocket', // 欢迎 / 品牌（移动端同：Rocket）
  '🚀': 'Rocket', // 启动 App 能力 / 运行
  '🤖': 'Bot', // 助手
  '📁': 'Folder', // 文件 / 文件夹
  '🖥': 'Terminal', // 终端（移动端同：Terminal）
  '🧮': 'Calculator', // 计算器
  '🕐': 'Clock', // 时钟
  '🗑': 'Trash2', // 回收站
  '🛠': 'Wrench', // 开发者
  '🧩': 'Puzzle', // 我的 App / 用户 App / 代码文件
  '📦': 'ShoppingBag', // 应用商店（移动端同：ShoppingBag）
  '🧚': 'Sparkles', // 伙伴
  '📊': 'Activity', // 任务管理器
  '📋': 'Clipboard', // 剪贴板
  '⏰': 'Timer', // 提醒（移动端同：Timer）
  '📸': 'Camera', // 截图
  '🌐': 'Globe', // 网页 App / 网页
  '⚙': 'Settings', // 设置（⚙️ / ⚙ 两种写法都命中）
  '📝': 'NotebookPen', // 记事本 / Markdown 文件 / 便签
  '🖼': 'Image', // 图片查看器 / 图片文件 / 壁纸
  '🎬': 'Clapperboard', // 媒体查看器 / 视频文件
  // ── 文件类型 ──
  '📂': 'FolderOpen', // 打开中的文件夹
  '📄': 'File', // 通用文件
  '🎵': 'Music', // 音频文件
  '🗜': 'FileArchive', // 压缩包
  // ── 通用 UI ──
  '🔍': 'Search',
  '✏': 'Pencil',
  '✂': 'Scissors',
  '📥': 'ClipboardPaste',
  'ℹ': 'Info',
  '🔒': 'Lock',
  '🔓': 'LockOpen',
  '🙈': 'EyeOff',
  '👤': 'User',
  '⬆': 'Upload',
  '⬇': 'Download',
  '➕': 'Plus',
  '➖': 'Minus',
  '✕': 'X',
  '✓': 'Check',
  '☰': 'List',
  '🌓': 'SunMoon',
  '🪟': 'AppWindow',
  '🚪': 'DoorOpen',
  '🌙': 'Moon',
  '☀': 'Sun',
  '🔔': 'Bell',
  '🔕': 'BellOff',
  '🤫': 'BellOff', // 勿扰
  '🔊': 'Volume2',
  '💾': 'Save',
  '🔄': 'RefreshCw',
  '⟳': 'RefreshCw',
  '↺': 'RotateCcw',
  '↻': 'RefreshCw',
  '⤢': 'Maximize2',
  '↩': 'Undo2',
  '🔐': 'ShieldCheck',
  '💬': 'MessageSquare',
  '📌': 'Pin',
  '🪄': 'WandSparkles',
  '🎨': 'Palette',
  '✨': 'Sparkles',
  '➡': 'ArrowRight',
  '🔑': 'KeyRound',
  '📎': 'Paperclip',
  '💭': 'Brain',
  '⚠': 'TriangleAlert',
  '📐': 'Ruler',
  '🕘': 'History',
  '⏲': 'Timer',
  '⏳': 'Hourglass',
  '⌨': 'Keyboard',
  '⌫': 'Delete',
  // ── 菜单几何符（存量 MenuItem.icon 数据） ──
  '◀': 'ChevronLeft',
  '▶': 'ChevronRight',
  '↑': 'ChevronUp',
  '↓': 'ChevronDown',
  '↗': 'ExternalLink',
  '—': 'Minus',
  '▢': 'Square',
  '▣': 'Maximize2',
  '▫': 'Square',
  '🔲': 'LayoutGrid',
  '▦': 'LayoutGrid',
  '🗂': 'Layers',
};

// 未识别键的兜底图标（与 appIconName 的 AppWindow 兜底同语义：一个「通用 App」形）。
export const FALLBACK_ICON: IconName = 'Puzzle';

// 剥离 VS16（U+FE0F）：🗑️ / 🗑 视为同一键。
export function normalizeIconKey(key: string): string {
  return key.replace(/\uFE0F/g, '');
}

// 把「存储键（emoji）或 Lucide 名」解析成注册表内的 Lucide 图标名；永不返回未注册名。
export function iconName(key: string): IconName {
  const k = normalizeIconKey(key.trim());
  const mapped = EMOJI_TO_ICON[k];
  if (mapped) return mapped;
  if (NAME_SET.has(k)) return k as IconName;
  return FALLBACK_ICON;
}

// 供测试/调试：emoji 键 → 映射名（未映射返回 undefined）。
export function mappedIconName(emoji: string): IconName | undefined {
  return EMOJI_TO_ICON[normalizeIconKey(emoji)];
}

// ───────────────────────────────────────────────────────────
// appId → Lucide 图标名（M4 自 shell/mobile/appIcons.ts 并入，全系统唯一图标数据层）。
// 移动端 Home/托盘按 appId 取图标（桌面侧 App 图标走 appList.icon 的 emoji 存储键）。
// 语义与上方 EMOJI_TO_ICON 的 App 段一一对应（同一 App 两端同图标）。
// ───────────────────────────────────────────────────────────
const APP_TO_ICON: Record<string, IconName> = {
  welcome: 'Rocket',
  assistant: 'Bot',
  files: 'Folder',
  terminal: 'Terminal',
  calculator: 'Calculator',
  clock: 'Clock',
  trash: 'Trash2',
  studio: 'Wrench',
  myapps: 'Puzzle',
  appstore: 'ShoppingBag',
  companion: 'Sparkles',
  sysmon: 'Activity',
  clipboard: 'Clipboard',
  reminders: 'Timer',
  screenshot: 'Camera',
  webapps: 'Globe',
  settings: 'Settings',
};

// appId → 注册表内图标名；未知 appId（用户 App）回退 AppWindow（「通用 App」形）。
export function appIconName(appId: string): IconName {
  return APP_TO_ICON[appId] ?? 'AppWindow';
}
