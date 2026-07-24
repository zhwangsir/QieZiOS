// ───────────────────────────────────────────────────────────
// Quick Look（空格快速预览）· 纯函数层
// 预览分级 / 文本截断 / 方向键步进 / 大小格式化 —— 全部无副作用，vitest 直测。
// UI 在 src/apps/QuickLook.svelte，接线在 src/apps/Files.svelte。
// ───────────────────────────────────────────────────────────
import { isImage, isMedia, type VNode } from '../kernel/vfs.svelte';

// 预览分级：大图 / 音视频 / 文本 / 目录卡片 / 二进制兜底卡片
export type PreviewKind = 'image' | 'media' | 'text' | 'dir' | 'binary';

// 判定优先级与 Files 双击分流（open()）一致：图片 > 媒体 > 文本/二进制。
// 目录最优先——目录永远不会是图片/媒体，但先判掉语义最清楚。
export function previewKind(node: VNode | null | undefined): PreviewKind | null {
  if (!node) return null;
  if (node.type === 'dir') return 'dir';
  if (isImage(node)) return 'image';
  if (isMedia(node)) return 'media';
  if (node.kind === 'binary') return 'binary';
  return 'text';
}

// 文本预览的长度上限：内容过长时截断，避免整棵大文件灌进 DOM 卡死面板
export const TEXT_PREVIEW_MAX = 20000;

export interface TruncatedText {
  text: string; // 截断后的正文（未超限时为原文）
  truncated: boolean; // 是否发生了截断（UI 据此显示「已截断」提示）
}

// 文本截断：超过 max 只保留前 max 个字符。max 兜底为非负整数。
export function truncatePreview(text: string, max: number = TEXT_PREVIEW_MAX): TruncatedText {
  const limit = Math.max(0, Math.floor(max));
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

// Quick Look 开着时 ←/→（↑/↓）移动选中：在当前可见 items 序列上前/后走一步。
// macOS 手感：两端到头停住不循环；当前项不在列表里（被过滤/删除）→ 回到第一项；空列表 → null。
export function stepSelection(ids: string[], currentId: string | null | undefined, delta: number): string | null {
  if (!ids.length) return null;
  const i = currentId ? ids.indexOf(currentId) : -1;
  if (i === -1) return ids[0];
  const next = i + delta;
  if (next < 0 || next >= ids.length) return currentId ?? null; // 到头不动
  return ids[next];
}

// 二进制/兜底卡片的大小行（与 MediaViewer 的 fmtSize 同款分级）
export function fmtBytes(bytes: number | undefined): string {
  const b = bytes ?? 0;
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}
