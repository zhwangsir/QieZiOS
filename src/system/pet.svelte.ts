import { persisted } from '../kernel/persist.svelte';

// 桌面浮层桌宠的状态（持久化）：是否显示 + 位置。
// 模型 URL 复用 companion.modelUrl（和「伙伴」窗口共用一个模型设置）。
export const pet = persisted<{ enabled: boolean; x: number; y: number }>('qz.pet', {
  enabled: false,
  x: 24,
  y: 340,
});
