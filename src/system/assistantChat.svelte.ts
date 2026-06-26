import { persisted } from '../kernel/persist.svelte';

// 助手对话（持久化）：关窗/刷新都不丢，全局共享一份。
export interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string; // 推理模型的思考过程（可折叠展示）
  tools: string[];
  images?: string[]; // 用户附图（已缩放的 data URL；喂给视觉模型）——仅本会话内存，不持久化
  imageCount?: number; // 持久化时记下附图数量，刷新后用占位提示
}

// 持久化时剥离 images 字节（图已喂过模型；只留张数做占位）。
// 否则多图对话累积会撑爆 localStorage 配额 → persisted 静默吞写盘失败 → 整段对话刷新后丢失。
export const chat = persisted<{ msgs: ChatMsg[] }>('qz.chat', { msgs: [] }, 300, (snap) => ({
  msgs: snap.msgs.map((m) =>
    m.images?.length ? { ...m, images: undefined, imageCount: m.images.length } : m,
  ),
}));

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzChat: typeof chat }).__qzChat = chat;
}
