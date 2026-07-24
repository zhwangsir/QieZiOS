// M9.1 收尾 · 桌面文件/文件夹图标的 squircle 底板配色（纯函数，可单测）。
// 色相语义与 appList 五色相一一对应：文件夹=蓝、图片=绿、音视频=橙、代码/标记=紫、其它=石墨。
// 直接返回 appList 的 C 常量引用（不复制字符串）→ 配色永远单一来源，改 C 一处全局生效。
import { C } from '../apps/appList';
import type { VNode } from '../kernel/vfs.svelte';

// 图片扩展名（与 DesktopIcons.emojiFor 的判定清单一致）
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
// 音视频扩展名（与 vfs.svelte.ts 的 isAudio/isVideo 清单一致）
const MEDIA_EXT = [
  'mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus', 'weba', // 音频
  'mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv', 'avi', // 视频
];
// 代码 / 标记扩展名
const CODE_EXT = ['json', 'js', 'ts', 'css', 'html', 'md', 'markdown'];

// 输入 VNode（只用 type/name/kind 三个字段，结构子集即可）；输出底板 background 渐变值
export function desktopTileColor(n: Pick<VNode, 'type' | 'name' | 'kind'>): string {
  if (n.type === 'dir') return C.blue;
  const ext = n.name.slice(n.name.lastIndexOf('.') + 1).toLowerCase();
  if (IMG_EXT.includes(ext)) return C.green;
  if (MEDIA_EXT.includes(ext)) return C.orange;
  if (CODE_EXT.includes(ext)) return C.violet;
  return C.graphite;
}
