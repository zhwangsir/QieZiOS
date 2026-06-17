import { persisted } from '../kernel/persist.svelte';

// 助手对话（持久化）：关窗/刷新都不丢，全局共享一份。
export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  tools: string[];
}

export const chat = persisted<{ msgs: ChatMsg[] }>('qz.chat', { msgs: [] }, 300);
