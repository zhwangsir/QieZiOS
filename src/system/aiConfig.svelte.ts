import { persisted } from '../kernel/persist.svelte';

// AI 配置（浏览器直连方案）。⚠️ 单人自托管：key 存 localStorage、由用户填自己的 key。
// 以后接 Node 后端代理时，把 baseURL 指到后端即可，上层不动。
export interface AiConfig {
  apiKey: string;
  baseURL: string; // 自定义接口地址（留空 = 官方 api.anthropic.com）；可走自己的代理/网关
  model: string; // 任意模型 id（预设只是快填）
  systemPrompt: string; // 额外人设/指令（叠加在默认系统提示之上，留空=仅默认）
  maxTokens: number; // 单次回复最大 token
}

export const aiConfig = persisted<AiConfig>('qz.ai', {
  apiKey: '',
  baseURL: '',
  model: 'claude-opus-4-8',
  systemPrompt: '',
  maxTokens: 8000,
});

export const AI_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8（最强）' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5（快 / 省）' },
];
