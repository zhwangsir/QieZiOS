import { persistedAsync } from '../kernel/persist.svelte';

// 助手对话（持久化）：关窗/刷新都不丢，全局共享一份。
export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string; // 推理模型的思考过程（可折叠展示）
  tools: string[];
  images?: string[]; // 用户附图（已缩放的 data URL；喂给视觉模型）。现持久化进 IndexedDB → 刷新后仍在
  imageCount?: number; // 旧数据兼容：早期 localStorage 版剥图后只留张数，刷新用占位提示（新数据用不到）
}

// 存进 IndexedDB（persistedAsync）。早期为防撑爆 localStorage 配额（~5–10MB）必须剥掉附图字节
// （A1），导致刷新后图变占位；P1 把存储迁到 IDB（GB 级容量）后这个限制消失 → 不再剥图，
// 附图（已缩放，单张常 ~4KB）随对话一起持久化、刷新后原样还原。旧 localStorage 数据首次启动
// 会被一次性迁进 IDB（其中老消息仍只有 imageCount、按占位渲染）。
export const chat = persistedAsync<{ msgs: ChatMsg[] }>('qz.chat', { msgs: [] }, 300);

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzChat: typeof chat }).__qzChat = chat;
}
