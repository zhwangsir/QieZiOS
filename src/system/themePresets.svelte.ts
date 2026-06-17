import { persisted } from '../kernel/persist.svelte';
import type { Settings } from './settings.svelte';

// 用户保存的命名主题快照（一套设置 = 一个主题）。
export interface ThemePreset {
  id: string;
  name: string;
  settings: Settings;
}

export const themePresets = persisted<{ list: ThemePreset[] }>('qz.themes', { list: [] }, 200);
