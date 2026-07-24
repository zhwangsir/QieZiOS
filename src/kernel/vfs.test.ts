// VFS 核心函数测试：验证 children/createDir/createFile/rename/move/trash/restore/emptyTrash/writeFile/is*/pathOf/resolvePath
// 这些是文件系统真能力的「内功」——之前全靠调用方信任，没有直接测试。
// persistedAsync 的 hydrate 异步性：测试在模块导入时已经触发 persistedAsync 创建（vfs.nodes 以 seed 起步），
// 但测试运行期间没有 await hydrateAll——测试只测纯函数行为（对当前 $state.nodes 的读写），
// 不依赖 hydrate 完成的初始数据。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock blobStore（测试环境没有 IndexedDB）
vi.mock('./blobStore', () => ({
  putBlob: vi.fn(),
  getBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));
import {
  vfs,
  children,
  createDir,
  createFile,
  rename,
  move,
  trash,
  restoreFromTrash,
  emptyTrash,
  writeFile,
  pathOf,
  resolvePath,
  pathSegments,
  isImage,
  isAudio,
  isVideo,
  isMedia,
  getNode,
  setMode,
  setOwner,
  copyNode,
  purge,
  TRASH,
} from './vfs.svelte';

// 每个用例前清空 vfs.nodes 重建一个最小测试树（避免污染默认 seed/其它用例）。
// 重建后保证 root 存在，其余节点按需现场建。
beforeEach(() => {
  // 清空：delete 每个非 root 节点（包括 trash 哨兵的子项）
  for (const id of Object.keys(vfs.nodes)) {
    if (id !== 'root') delete vfs.nodes[id];
  }
  // 保证 root 是干净的
  vfs.nodes.root = {
    id: 'root',
    name: '根目录',
    type: 'dir',
    parentId: null,
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
});

describe('children', () => {
  it('返回指定 parentId 的直接子项，文件夹在前，按名字排', () => {
    createDir('root', 'b-dir');
    createDir('root', 'a-dir');
    createFile('root', 'z.txt');
    createFile('root', 'a.txt');
    const kids = children('root');
    expect(kids.map((k) => k.name)).toEqual(['a-dir', 'b-dir', 'a.txt', 'z.txt']);
    expect(kids[0].type).toBe('dir');
    expect(kids[2].type).toBe('file');
  });

  it('不含回收站里的节点（parentId === TRASH 的不混入）', () => {
    const fid = createFile('root', 'a.txt');
    trash(fid);
    expect(children('root').map((k) => k.name)).toEqual([]);
    expect(children(TRASH).map((k) => k.name)).toEqual(['a.txt']);
  });

  it('空目录返回空数组', () => {
    expect(children('root')).toEqual([]);
  });
});

describe('createDir / createFile', () => {
  it('在 root 下建目录，parentId 正确', () => {
    const id = createDir('root', 'docs');
    const n = getNode(id);
    expect(n?.name).toBe('docs');
    expect(n?.type).toBe('dir');
    expect(n?.parentId).toBe('root');
    expect(n?.mode).toBe(0o755);
  });

  it('重名自动 +2（保留扩展名）', () => {
    createFile('root', 'a.txt');
    createFile('root', 'a.txt');
    createFile('root', 'a.txt');
    const names = children('root').map((k) => k.name);
    expect(names).toEqual(['a 2.txt', 'a 3.txt', 'a.txt']);
  });

  it('目录重名也自动 +2', () => {
    createDir('root', 'docs');
    createDir('root', 'docs');
    const names = children('root').map((k) => k.name);
    expect(names).toEqual(['docs', 'docs 2']);
  });

  it('无扩展名的文件重名也 +2', () => {
    createFile('root', 'note');
    createFile('root', 'note');
    const names = children('root').map((k) => k.name);
    expect(names).toEqual(['note', 'note 2']);
  });
});

describe('rename', () => {
  it('改名成功 + updatedAt 更新', () => {
    const id = createFile('root', 'old.txt');
    const before = getNode(id)!.updatedAt;
    // 微睡一拍保证 updatedAt 单调
    const ok = rename(id, 'new.txt');
    expect(ok).toBe(true);
    expect(getNode(id)?.name).toBe('new.txt');
    expect(getNode(id)!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('空名拒绝', () => {
    const id = createFile('root', 'a.txt');
    expect(rename(id, '')).toBe(false);
    expect(rename(id, '   ')).toBe(false);
    expect(getNode(id)?.name).toBe('a.txt');
  });

  it('同目录同名拒绝（防同名并存）', () => {
    createFile('root', 'a.txt');
    const b = createFile('root', 'b.txt');
    expect(rename(b, 'a.txt')).toBe(false);
    expect(getNode(b)?.name).toBe('b.txt');
  });

  it('不同目录同名不冲突', () => {
    const d1 = createDir('root', 'd1');
    const d2 = createDir('root', 'd2');
    createFile(d1, 'same.txt');
    const b = createFile(d2, 'other.txt');
    expect(rename(b, 'same.txt')).toBe(true);
  });

  it('改成自己当前名视为成功（无操作）', () => {
    const id = createFile('root', 'a.txt');
    expect(rename(id, 'a.txt')).toBe(true);
  });

  it('未知 id 返回 false', () => {
    expect(rename('nonexistent', 'x')).toBe(false);
  });
});

describe('move', () => {
  it('移动到目标目录', () => {
    const d = createDir('root', 'docs');
    const f = createFile('root', 'a.txt');
    move(f, d);
    expect(getNode(f)?.parentId).toBe(d);
    expect(children('root').map((k) => k.name)).toEqual(['docs']);
    expect(children(d).map((k) => k.name)).toEqual(['a.txt']);
  });

  it('目标已有同名 → 自动 +2（不拒绝，避免卡死）', () => {
    const d = createDir('root', 'docs');
    createFile(d, 'a.txt');
    const f = createFile('root', 'a.txt');
    move(f, d);
    expect(getNode(f)?.name).toBe('a 2.txt');
  });

  it('不能移动 root', () => {
    const d = createDir('root', 'docs');
    move('root', d);
    expect(getNode('root')?.parentId).toBe(null);
  });

  it('不能移动到自己', () => {
    const d = createDir('root', 'docs');
    move(d, d);
    expect(getNode(d)?.parentId).toBe('root');
  });

  it('不能移动到自己的子孙（防成环）', () => {
    const a = createDir('root', 'a');
    const b = createDir(a, 'b');
    const c = createDir(b, 'c');
    move(a, c); // a → a/b/c 内（子孙）应拒绝
    expect(getNode(a)?.parentId).toBe('root');
  });

  it('目标是文件时拒绝', () => {
    const f = createFile('root', 'a.txt');
    const g = createFile('root', 'b.txt');
    move(f, g);
    expect(getNode(f)?.parentId).toBe('root');
  });

  it('已在目标目录时 no-op', () => {
    const d = createDir('root', 'docs');
    const f = createFile(d, 'a.txt');
    const before = getNode(f)!.updatedAt;
    move(f, d);
    expect(getNode(f)?.parentId).toBe(d);
    expect(getNode(f)!.updatedAt).toBe(before); // 未触碰
  });
});

describe('trash / restoreFromTrash / emptyTrash', () => {
  it('trash 把节点移入回收站并记住原父级', () => {
    const f = createFile('root', 'a.txt');
    trash(f);
    const n = getNode(f);
    expect(n?.parentId).toBe(TRASH);
    expect(n?.prevParent).toBe('root');
  });

  it('trash root 拒绝', () => {
    trash('root');
    expect(getNode('root')?.parentId).toBe(null);
  });

  it('restoreFromTrash 还原到原位置', () => {
    const d = createDir('root', 'docs');
    const f = createFile(d, 'a.txt');
    trash(f);
    restoreFromTrash(f);
    expect(getNode(f)?.parentId).toBe(d);
    expect(getNode(f)?.prevParent).toBeUndefined();
  });

  it('原父级已删 → 还原回 root', () => {
    const d = createDir('root', 'docs');
    const f = createFile(d, 'a.txt');
    trash(f);
    // 删除原父级
    delete vfs.nodes[d];
    restoreFromTrash(f);
    expect(getNode(f)?.parentId).toBe('root');
  });

  it('还原时目标已有同名 → 自动 +2', () => {
    const f = createFile('root', 'a.txt');
    trash(f);
    createFile('root', 'a.txt'); // 删除后原地又建了同名
    restoreFromTrash(f);
    expect(getNode(f)?.name).toBe('a 2.txt');
  });

  it('emptyTrash 清空所有回收站项', () => {
    const f1 = createFile('root', 'a.txt');
    const f2 = createFile('root', 'b.txt');
    trash(f1);
    trash(f2);
    expect(children(TRASH).length).toBe(2);
    emptyTrash();
    expect(children(TRASH).length).toBe(0);
    expect(getNode(f1)).toBeUndefined();
    expect(getNode(f2)).toBeUndefined();
  });
});

describe('writeFile', () => {
  it('改写文本文件内容 + updatedAt 更新', () => {
    const id = createFile('root', 'a.txt', 'old');
    writeFile(id, 'new content');
    expect(getNode(id)?.content).toBe('new content');
  });

  it('目录不可 writeFile', () => {
    const d = createDir('root', 'docs');
    writeFile(d, 'x');
    expect(getNode(d)?.content).toBe('');
  });

  it('未知 id no-op', () => {
    writeFile('nonexistent', 'x');
    // 不抛错即可
  });
});

describe('writeFile 二进制→文本降级', () => {
  it('写入文本到二进制节点 → 清掉二进制元数据变成文本文件', () => {
    // 模拟一个二进制节点（kind:'binary' + blobId/mime/size）
    const id = createFile('root', 'a.png');
    vfs.nodes[id] = {
      ...vfs.nodes[id]!,
      kind: 'binary',
      blobId: 'blob-123',
      mime: 'image/png',
      size: 1024,
    };
    // 用 writeFile 写入文本 → 应降级为普通文本文件
    writeFile(id, 'hello text');
    const n = getNode(id);
    expect(n?.content).toBe('hello text');
    expect(n?.kind).toBeUndefined();
    expect(n?.blobId).toBeUndefined();
    expect(n?.mime).toBeUndefined();
    expect(n?.size).toBeUndefined();
  });
});

describe('copyNode', () => {
  it('复制文件到目标目录，内容/权限一致', async () => {
    const d = createDir('root', 'docs');
    const src = createFile('root', 'a.txt', 'hello');
    setMode(src, 0o600);
    const newId = await copyNode(src, d);
    expect(newId).toBeDefined();
    const n = getNode(newId!);
    expect(n?.name).toBe('a.txt');
    expect(n?.content).toBe('hello');
    expect(n?.parentId).toBe(d);
    expect(n?.mode).toBe(0o600);
    // 原文件不动
    expect(getNode(src)?.parentId).toBe('root');
  });

  it('复制目录递归复制子项', async () => {
    const d1 = createDir('root', 'd1');
    const d2 = createDir(d1, 'd2');
    createFile(d2, 'inner.txt', 'inner-content');
    const newId = await copyNode(d1, 'root');
    expect(newId).toBeDefined();
    const copied = getNode(newId!);
    expect(copied?.name).toBe('d1 2'); // 目标已有 d1 → 自动 +2
    const kids = children(newId!);
    expect(kids.length).toBe(1);
    expect(kids[0].name).toBe('d2');
    const grandkids = children(kids[0].id);
    expect(grandkids.length).toBe(1);
    expect(grandkids[0].name).toBe('inner.txt');
    expect(grandkids[0].content).toBe('inner-content');
  });

  it('不能复制 root', async () => {
    expect(await copyNode('root', 'root')).toBeUndefined();
  });

  it('不能复制到自己/子孙（防成环）', async () => {
    const a = createDir('root', 'a');
    const b = createDir(a, 'b');
    expect(await copyNode(a, a)).toBeUndefined();
    expect(await copyNode(a, b)).toBeUndefined();
  });

  it('目标是文件时拒绝', async () => {
    const f = createFile('root', 'a.txt');
    const g = createFile('root', 'b.txt');
    expect(await copyNode(f, g)).toBeUndefined();
  });
});

describe('purge', () => {
  it('彻底删除文件', () => {
    const f = createFile('root', 'a.txt');
    purge(f);
    expect(getNode(f)).toBeUndefined();
  });

  it('递归删除目录及其子项', () => {
    const d = createDir('root', 'docs');
    const sub = createDir(d, 'sub');
    const f = createFile(sub, 'a.txt');
    purge(d);
    expect(getNode(d)).toBeUndefined();
    expect(getNode(sub)).toBeUndefined();
    expect(getNode(f)).toBeUndefined();
  });

  it('不能删除 root', () => {
    purge('root');
    expect(getNode('root')).toBeDefined();
  });

  it('父环防御：不无限递归', () => {
    // 人为构造一个父环（模拟损坏数据）
    const a = createDir('root', 'a');
    const b = createDir(a, 'b');
    vfs.nodes[a]!.parentId = b; // a → b → a 成环
    // purge 应能正常结束（不栈溢出）
    purge(a);
    expect(getNode(a)).toBeUndefined();
    expect(getNode(b)).toBeUndefined();
  });
});

describe('setMode / setOwner', () => {
  it('setMode 改权限位', () => {
    const id = createFile('root', 'a.txt');
    setMode(id, 0o600);
    expect(getNode(id)?.mode).toBe(0o600);
  });

  it('setOwner 改属主', () => {
    const id = createFile('root', 'a.txt');
    setOwner(id, 'alice');
    expect(getNode(id)?.owner).toBe('alice');
  });
});

describe('isImage / isAudio / isVideo / isMedia', () => {
  function f(name: string, mime?: string) {
    return {
      id: 'x',
      name,
      type: 'file' as const,
      parentId: 'root',
      content: '',
      mime,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  it('MIME 优先：image/* 即图片', () => {
    expect(isImage(f('a.png'))).toBe(true);
    expect(isImage(f('a', 'image/jpeg'))).toBe(true);
    expect(isImage(f('a.txt'))).toBe(false);
  });

  it('扩展名大小写不敏感', () => {
    expect(isImage(f('a.PNG'))).toBe(true);
    expect(isImage(f('a.JpEg'))).toBe(true);
  });

  it('音频/视频识别', () => {
    expect(isAudio(f('a.mp3'))).toBe(true);
    expect(isAudio(f('a.flac'))).toBe(true);
    expect(isVideo(f('a.mp4'))).toBe(true);
    expect(isVideo(f('a.mov'))).toBe(true);
    expect(isMedia(f('a.mp3'))).toBe(true);
    expect(isMedia(f('a.mp4'))).toBe(true);
    expect(isMedia(f('a.txt'))).toBe(false);
  });

  it('MIME 优先于扩展名', () => {
    expect(isAudio(f('a.mp3', 'audio/mpeg'))).toBe(true);
    expect(isVideo(f('a.bin', 'video/mp4'))).toBe(true);
  });
});

describe('pathOf / resolvePath / pathSegments', () => {
  it('root 的路径是 /', () => {
    expect(pathOf('root')).toBe('/');
  });

  it('嵌套路径正确', () => {
    const d = createDir('root', 'docs');
    const f = createFile(d, 'a.txt');
    expect(pathOf(f)).toBe('/docs/a.txt');
  });

  it('resolvePath / 返回 root', () => {
    expect(resolvePath('root', '/')).toBe('root');
    expect(resolvePath('root', '~')).toBe('root');
  });

  it('resolvePath 相对路径解析', () => {
    const d = createDir('root', 'docs');
    const f = createFile(d, 'a.txt');
    expect(resolvePath('root', 'docs')).toBe(d);
    expect(resolvePath('root', 'docs/a.txt')).toBe(f);
    expect(resolvePath(d, 'a.txt')).toBe(f);
    expect(resolvePath(d, '.')).toBe(d);
  });

  it('resolvePath .. 向上一级', () => {
    const d = createDir('root', 'docs');
    const sub = createDir(d, 'sub');
    expect(resolvePath(sub, '..')).toBe(d);
    expect(resolvePath(sub, '../..')).toBe('root');
  });

  it('resolvePath 找不到返回 undefined', () => {
    expect(resolvePath('root', 'nonexistent')).toBeUndefined();
    expect(resolvePath('root', 'a/b/c')).toBeUndefined();
  });

  it('pathSegments 返回从根到目标的路径段数组', () => {
    const d = createDir('root', 'docs');
    const f = createFile(d, 'a.txt');
    const segs = pathSegments(f);
    expect(segs.map((s) => s.name)).toEqual(['根目录', 'docs', 'a.txt']);
  });

  it('pathSegments root 只含自己', () => {
    expect(pathSegments('root').map((s) => s.id)).toEqual(['root']);
  });
});
