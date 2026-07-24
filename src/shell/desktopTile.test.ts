// M9.1 收尾 · 桌面文件/文件夹图标底板配色（纯函数）测试。
// 映射语义复用 appList 五色相：文件夹=蓝、图片=绿、音视频=橙、代码/标记=紫、其它=石墨。
// 返回值必须与 appList.ts 的 C 常量严格全等（同一字符串引用）→ 保证单一来源，不走样。
import { describe, it, expect } from 'vitest';
import { desktopTileColor } from './desktopTile';
import { C } from '../apps/appList';

// 只取纯函数关心的三个字段（VNode 结构子集）
const file = (name: string) => ({ type: 'file' as const, name });
const dir = (name: string) => ({ type: 'dir' as const, name });

describe('desktopTileColor · 类型 → 五色相映射', () => {
  it('文件夹 → 蓝', () => {
    expect(desktopTileColor(dir('照片'))).toBe(C.blue);
    expect(desktopTileColor(dir('untitled folder'))).toBe(C.blue);
  });

  it('图片扩展名 → 绿（png/jpg/jpeg/gif/webp/svg/bmp）', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']) {
      expect(desktopTileColor(file(`a.${ext}`)), ext).toBe(C.green);
    }
  });

  it('音频扩展名 → 橙（与 vfs isAudio 同清单）', () => {
    for (const ext of ['mp3', 'wav', 'ogg', 'oga', 'flac', 'aac', 'm4a', 'opus', 'weba']) {
      expect(desktopTileColor(file(`song.${ext}`)), ext).toBe(C.orange);
    }
  });

  it('视频扩展名 → 橙（与 vfs isVideo 同清单）', () => {
    for (const ext of ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv', 'avi']) {
      expect(desktopTileColor(file(`clip.${ext}`)), ext).toBe(C.orange);
    }
  });

  it('代码/标记扩展名 → 紫（json/js/ts/css/html/md/markdown）', () => {
    for (const ext of ['json', 'js', 'ts', 'css', 'html', 'md', 'markdown']) {
      expect(desktopTileColor(file(`src.${ext}`)), ext).toBe(C.violet);
    }
  });

  it('未知扩展名 → 石墨兜底', () => {
    for (const name of ['readme.txt', 'data.csv', 'app.zip', 'notes.pdf']) {
      expect(desktopTileColor(file(name)), name).toBe(C.graphite);
    }
  });

  it('无扩展名 → 石墨兜底', () => {
    expect(desktopTileColor(file('Makefile'))).toBe(C.graphite);
    expect(desktopTileColor(file('LICENSE'))).toBe(C.graphite);
  });

  it('扩展名大小写不敏感', () => {
    expect(desktopTileColor(file('PHOTO.PNG'))).toBe(C.green);
    expect(desktopTileColor(file('Cover.Jpg'))).toBe(C.green);
    expect(desktopTileColor(file('Song.MP3'))).toBe(C.orange);
    expect(desktopTileColor(file('Movie.MKV'))).toBe(C.orange);
    expect(desktopTileColor(file('App.TS'))).toBe(C.violet);
    expect(desktopTileColor(file('Doc.Md'))).toBe(C.violet);
  });
});
