import { persisted } from '../kernel/persist.svelte';

// ───────────────────────────────────────────────────────────
// 勿扰 / 专注模式（R5-F3）：开启后不弹 toast、不发系统音，但通知仍进通知中心历史（不丢）。
// 单独成模块（不入 SETTINGS_KEYS 主题白名单）：随 qz.* 同步，但不随主题预设导入/导出。
// notifications.pushNote 据它跳过 live toast；sound.playSound 据它静音。
// ───────────────────────────────────────────────────────────
export const dnd = persisted<{ enabled: boolean }>('qz.dnd', { enabled: false });

export function toggleDnd(): void {
  dnd.enabled = !dnd.enabled;
}
