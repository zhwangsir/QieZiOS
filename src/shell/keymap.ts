// M12.1「键盘完备性」· 全局快捷键判定纯函数。
// 把 Desktop.onKey 里散落的「Ctrl/Cmd + 字母」判定收口到这里：
// · Ctrl 或 Cmd(meta) 都接受（macOS ⌘ / Win·Linux Ctrl 双平台等价）
// · 大小写不敏感（按着 Shift 时 e.key 是大写，不应影响快捷键）
// 纯函数不碰 DOM/内核 → vitest 裸跑（见 keymap.test.ts）。
// 注意：只判 Ctrl/Cmd 两类修饰；Alt 组合（如 Alt+`）语义不同，不走这里。

// 判定用的事件子集：KeyboardEvent 结构化兼容（测试可用普通对象注入）。
export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}

// 目前全局接住的 Cmd/Ctrl+字母键位（新增键位时同步 Shortcuts 速查面板与菜单 shortcut 标注）
export type ShortcutKey = 'w' | 'h' | 'q' | 'm' | 'k';

export function matchShortcut(e: ShortcutEvent, key: ShortcutKey): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === key;
}
