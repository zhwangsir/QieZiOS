import { persisted } from '../kernel/persist.svelte';

// AI 配置（浏览器直连方案）：Anthropic API Key + 模型。
// ⚠️ 单人自托管：key 存在 localStorage、由用户自己填自己的 key。
// 以后接 Node 后端代理时，这里换成「后端地址」即可，上层不动。
export interface AiConfig {
  apiKey: string;
  model: string;
}

export const aiConfig = persisted<AiConfig>('qz.ai', {
  apiKey: '',
  model: 'claude-opus-4-8',
});

export const AI_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8（最强）' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5（快 / 省）' },
];
