import { persisted } from '../kernel/persist.svelte';

// 助手对话（持久化）：关窗/刷新都不丢，全局共享一份。
export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string; // 推理模型的思考过程（可折叠展示）
  tools: string[];
  images?: string[]; // 用户附图（已缩放的 data URL；喂给视觉模型）
}

export const chat = persisted<{ msgs: ChatMsg[] }>('qz.chat', { msgs: [] }, 300);
