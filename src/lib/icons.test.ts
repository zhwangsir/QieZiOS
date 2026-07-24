// U1 图标体系 · icons.ts 纯函数测试（M1）
// 目标：emoji 存储键 → Lucide 名的映射永远落在注册表内，未识别键安全回退。
import { describe, it, expect } from 'vitest';
import {
  ICON_NAMES,
  FALLBACK_ICON,
  iconName,
  mappedIconName,
  normalizeIconKey,
  appIconName,
} from './icons';

// 抽样一批系统里真实在用的 emoji 存储键（app 图标 / 文件类型 / 通用 UI / 菜单几何符）
const SAMPLE_EMOJI = [
  '🍆', '🤖', '📁', '🖥️', '🧮', '🕐', '🗑️', '🛠️', '🧩', '📦', '🧚', '📊',
  '📋', '⏰', '📸', '🌐', '⚙️', '📝', '🖼️', '🎬', '📂', '📄', '🎵', '🗜️',
  '🔍', '✏️', '✂️', '📥', 'ℹ️', '🔒', '🔓', '🙈', '👤', '⬆', '⬇', '➕',
  '➖', '✕', '✓', '☰', '🌓', '🪟', '🚪', '🌙', '☀️', '🔔', '🔕', '🤫',
  '🔊', '💾', '🔄', '↺', '↻', '⤢', '↩', '🔐', '💬', '📌', '🪄', '🎨',
  '✨', '➡️', '🔑', '📎', '💭', '⚠️', '📐', '🕘', '⏲', '⏳', '⌨️', '⌫',
  '◀', '▶', '↑', '↓', '↗', '—', '▢', '▣', '▫', '🔲', '▦', '🗂️', '🚀',
];

describe('iconName（存储键 → Lucide 名）', () => {
  it('真实在用的 emoji 键全部映射到已注册图标', () => {
    for (const e of SAMPLE_EMOJI) {
      const name = iconName(e);
      expect(ICON_NAMES, `${e} → ${name} 未注册`).toContain(name);
      // 必须是显式映射命中（而非落兜底）——注意 🧩→Puzzle 合法地等于兜底图标，故用 mappedIconName 判
      expect(mappedIconName(e), `${e} 走了兜底而非显式映射`).toBeDefined();
    }
  });

  it('关键映射语义正确', () => {
    expect(iconName('🗑️')).toBe('Trash2');
    expect(iconName('⚙')).toBe('Settings');
    expect(iconName('🍆')).toBe('Rocket'); // 与移动端 appIcons 同语义
    expect(iconName('📁')).toBe('Folder');
    expect(iconName('↗')).toBe('ExternalLink');
    expect(iconName('⏳')).toBe('Hourglass');
    expect(iconName('⌫')).toBe('Delete');
    expect(iconName('⌨️')).toBe('Keyboard');
  });

  it('剥离 VS16：带/不带 U+FE0F 等价', () => {
    expect(normalizeIconKey('🗑️')).toBe('🗑');
    expect(iconName('🗑️')).toBe(iconName('🗑'));
    expect(iconName('⚙️')).toBe(iconName('⚙'));
  });

  it('Lucide 名直通（新代码可直接传组件名）', () => {
    expect(iconName('ZoomIn')).toBe('ZoomIn');
    expect(iconName('Play')).toBe('Play');
  });

  it('未识别键 / 空串 / 空白 → 兜底图标，绝不返回未注册名', () => {
    expect(iconName('🦄')).toBe(FALLBACK_ICON);
    expect(iconName('')).toBe(FALLBACK_ICON);
    expect(iconName('   ')).toBe(FALLBACK_ICON);
    expect(ICON_NAMES).toContain(FALLBACK_ICON);
  });

  it('mappedIconName 对未映射键返回 undefined（调试/测试通道）', () => {
    expect(mappedIconName('🗑')).toBe('Trash2');
    expect(mappedIconName('🦄')).toBeUndefined();
  });
});

// M4：appIcons.ts 并入 icons.ts 后，appId → 图标名是全系统唯一数据层
describe('appIconName（appId → Lucide 名，移动外壳用）', () => {
  it('内置 App 全部命中显式映射且落在注册表内', () => {
    const builtin = [
      'welcome', 'assistant', 'files', 'terminal', 'calculator', 'clock', 'trash',
      'studio', 'myapps', 'appstore', 'companion', 'sysmon', 'clipboard', 'reminders',
      'screenshot', 'webapps', 'settings',
    ];
    for (const id of builtin) {
      expect(ICON_NAMES, `${id} → ${appIconName(id)} 未注册`).toContain(appIconName(id));
    }
    expect(appIconName('welcome')).toBe('Rocket'); // 与 emoji 键 🍆 同语义
    expect(appIconName('settings')).toBe('Settings');
  });

  it('未知 appId（用户 App）回退 AppWindow', () => {
    expect(appIconName('no-such-app')).toBe('AppWindow');
    expect(ICON_NAMES).toContain('AppWindow');
  });
});
