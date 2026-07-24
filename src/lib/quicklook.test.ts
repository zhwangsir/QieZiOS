// Quick Look 纯函数测试：previewKind 分级 / truncatePreview 截断 / stepSelection 步进 / fmtBytes 格式化
import { describe, it, expect, vi } from 'vitest';

// mock blobStore（测试环境没有 IndexedDB；vfs.svelte 传递依赖它）
vi.mock('../kernel/blobStore', () => ({
  putBlob: vi.fn(),
  getBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

import {
  previewKind,
  truncatePreview,
  stepSelection,
  fmtBytes,
  TEXT_PREVIEW_MAX,
} from './quicklook';
import type { VNode } from '../kernel/vfs.svelte';

// 造一个最小合法 VNode，按用例覆盖字段
function node(partial: Partial<VNode>): VNode {
  return {
    id: 'x',
    name: 'x',
    type: 'file',
    parentId: 'root',
    content: '',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('previewKind 预览分级', () => {
  it('null / undefined → null（面板不渲染）', () => {
    expect(previewKind(null)).toBeNull();
    expect(previewKind(undefined)).toBeNull();
  });

  it('目录 → dir', () => {
    expect(previewKind(node({ type: 'dir', name: '文件夹' }))).toBe('dir');
  });

  it('图片按扩展名 → image', () => {
    expect(previewKind(node({ name: 'cat.png', kind: 'binary' }))).toBe('image');
    expect(previewKind(node({ name: 'photo.JPG', kind: 'binary' }))).toBe('image');
  });

  it('图片按 MIME（无扩展名）→ image', () => {
    expect(previewKind(node({ name: 'noext', kind: 'binary', mime: 'image/webp' }))).toBe('image');
  });

  it('音频 → media', () => {
    expect(previewKind(node({ name: 'song.mp3', kind: 'binary', mime: 'audio/mpeg' }))).toBe('media');
  });

  it('视频按 MIME / 扩展名 → media', () => {
    expect(previewKind(node({ name: 'clip', kind: 'binary', mime: 'video/mp4' }))).toBe('media');
    expect(previewKind(node({ name: 'movie.mkv', kind: 'binary' }))).toBe('media');
  });

  it('图片与媒体同时命中时图片优先（与 Files 双击分流同序）', () => {
    // 名字像音频、MIME 是图片 → 双击进 ImageViewer，预览也必须是 image
    expect(previewKind(node({ name: 'song.mp3', kind: 'binary', mime: 'image/png' }))).toBe('image');
  });

  it('文本文件（kind 缺省、有内容）→ text', () => {
    expect(previewKind(node({ name: '笔记.txt', content: '你好' }))).toBe('text');
  });

  it('代码/配置文件也算文本 → text', () => {
    expect(previewKind(node({ name: 'main.ts', content: 'let x = 1' }))).toBe('text');
    expect(previewKind(node({ name: 'README.md', content: '# hi' }))).toBe('text');
  });

  it('空文本文件 → text（UI 显示空文件占位）', () => {
    expect(previewKind(node({ name: 'empty.txt', content: '' }))).toBe('text');
  });

  it('二进制且非图非媒体 → binary', () => {
    expect(previewKind(node({ name: 'pack.zip', kind: 'binary', mime: 'application/zip', size: 10 }))).toBe('binary');
  });
});

describe('truncatePreview 文本截断', () => {
  it('短文本原样返回、不截断', () => {
    expect(truncatePreview('hello', 10)).toEqual({ text: 'hello', truncated: false });
  });

  it('正好 max 长度不截断（边界）', () => {
    expect(truncatePreview('abcde', 5)).toEqual({ text: 'abcde', truncated: false });
  });

  it('超长截到 max 且标记 truncated', () => {
    expect(truncatePreview('abcdefgh', 5)).toEqual({ text: 'abcde', truncated: true });
  });

  it('默认上限 TEXT_PREVIEW_MAX = 20000', () => {
    expect(TEXT_PREVIEW_MAX).toBe(20000);
    const s = 'a'.repeat(TEXT_PREVIEW_MAX + 5);
    const r = truncatePreview(s);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(TEXT_PREVIEW_MAX);
  });

  it('空串 → 空结果、不截断', () => {
    expect(truncatePreview('', 10)).toEqual({ text: '', truncated: false });
  });

  it('非法 max（负数/小数）兜底为非负整数', () => {
    expect(truncatePreview('abc', -1)).toEqual({ text: '', truncated: true });
    expect(truncatePreview('abc', 2.7)).toEqual({ text: 'ab', truncated: true });
  });
});

describe('stepSelection 方向键步进', () => {
  const ids = ['a', 'b', 'c'];

  it('向后一步（→ / ↓）', () => {
    expect(stepSelection(ids, 'a', 1)).toBe('b');
  });

  it('向前一步（← / ↑）', () => {
    expect(stepSelection(ids, 'b', -1)).toBe('a');
  });

  it('两端到头停住、不循环', () => {
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
  });

  it('当前项不在列表（被过滤/删除）→ 回到第一项', () => {
    expect(stepSelection(ids, 'zzz', 1)).toBe('a');
    expect(stepSelection(ids, null, -1)).toBe('a');
  });

  it('空列表 → null', () => {
    expect(stepSelection([], 'a', 1)).toBeNull();
  });

  it('单元素列表怎么按都停在它身上', () => {
    expect(stepSelection(['only'], 'only', 1)).toBe('only');
    expect(stepSelection(['only'], 'only', -1)).toBe('only');
  });
});

describe('fmtBytes 大小格式化', () => {
  it('B / KB / MB 分级', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(5 * 1048576)).toBe('5.0 MB');
  });

  it('undefined → 0 B（二进制节点缺 size 的兜底）', () => {
    expect(fmtBytes(undefined)).toBe('0 B');
  });
});
