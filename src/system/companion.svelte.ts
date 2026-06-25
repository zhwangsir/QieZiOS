import { persisted } from '../kernel/persist.svelte';

// Live2D 伙伴配置（持久化）：模型 URL（指向某个 .model3.json）。
// 默认用 pixi-live2d-display 的测试模型（Cubism 4 · Haru）。换模型只改这里或在 App 里填。
export const DEFAULT_MODEL =
  'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json';

export const companion = persisted<{ modelUrl: string }>('qz.companion', { modelUrl: DEFAULT_MODEL });
