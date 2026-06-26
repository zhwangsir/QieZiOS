import { persisted } from './persist.svelte';
import { putBlob, getBlob, deleteBlob } from './blobStore';
import { emit } from './bus.svelte';

// ───────────────────────────────────────────────────────────
// 虚拟文件系统（VFS）· 又是一张「表」
// 跟进程表同一个思路：把文件/文件夹拍平成一张 inode 风格的节点表，
// 用 parentId 串成树。这样查子项 = 按 parentId 过滤，移动 = 改 parentId，
// 重命名 = 改 name —— 全是对一张表的简单操作。
// 整棵树用 persisted 存进 localStorage（以后可换 IndexedDB / OPFS+SQLite-WASM）。
// ───────────────────────────────────────────────────────────
export interface VNode {
  id: string;
  name: string;
  type: 'dir' | 'file';
  parentId: string | null; // null 仅根节点；'trash' = 在回收站
  content: string; // 文本正文；二进制文件/文件夹恒为空串
  kind?: 'binary'; // 标记二进制文件（默认 undefined = 文本）
  blobId?: string; // 二进制字节在 blobStore（IndexedDB）里的 key
  mime?: string; // 二进制文件的 MIME 类型
  size?: number; // 二进制文件字节数
  prevParent?: string | null; // 进回收站前的父级（用于还原）
  mode?: number; // Unix 风格权限位（八进制，如 0o644）。缺省按类型取默认（见 DEFAULT_MODE）
  owner?: string; // 属主用户名。缺省视为 'qiezi'
  createdAt: number;
  updatedAt: number;
}

// 缺省权限：目录 755、文件 644（旧持久化节点没有 mode 时按此显示）
export const DEFAULT_OWNER = 'qiezi';
export function defaultMode(type: 'dir' | 'file'): number {
  return type === 'dir' ? 0o755 : 0o644;
}

// 新建文件/目录的属主 = 当前登录用户（账号登录 → 你建的文件归你）。
// 用「注入」避免内核反向依赖 system 层：App 启动时 setOwnerProvider 接上账号。
let resolveOwner: () => string = () => DEFAULT_OWNER;
export function setOwnerProvider(fn: () => string): void {
  resolveOwner = fn;
}

// 回收站用一个「哨兵 parentId」标记，不需要真节点：
// children('trash') 即回收站内容；普通文件夹 children 自然不含它们（parentId 已变成 'trash'）。
export const TRASH = 'trash';

const t0 = Date.now();
// 初始种子：让第一次打开文件管理器时不是空的
const seed: Record<string, VNode> = {
  root: { id: 'root', name: '根目录', type: 'dir', parentId: null, content: '', createdAt: t0, updatedAt: t0 },
  docs: { id: 'docs', name: '文档', type: 'dir', parentId: 'root', content: '', createdAt: t0, updatedAt: t0 },
  pics: { id: 'pics', name: '图片', type: 'dir', parentId: 'root', content: '', createdAt: t0, updatedAt: t0 },
  readme: {
    id: 'readme',
    name: '欢迎.txt',
    type: 'file',
    parentId: 'root',
    content:
      '欢迎使用 QieZiOS 文件系统 🍆\n\n· 双击文件夹进入\n· 双击文本文件用记事本打开，改动会自动保存\n· 悬停文件可重命名 / 删除',
    createdAt: t0,
    updatedAt: t0,
  },
};

// 一份全局共享、自动存盘的响应式文件树
export const vfs = persisted<{ nodes: Record<string, VNode> }>('qz.vfs', { nodes: seed }, 300);

export function getNode(id: string): VNode | undefined {
  return vfs.nodes[id];
}

// 列某个文件夹的直接子项（文件夹在前、再按名字排）。在 $derived/模板里调用会自动订阅。
export function children(parentId: string): VNode[] {
  return Object.values(vfs.nodes)
    .filter((n) => n.parentId === parentId)
    .sort((a, b) =>
      a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'zh'),
    );
}

// 同一文件夹下重名时自动加序号（保留扩展名）
function uniqueName(parentId: string, base: string): string {
  const taken = new Set(children(parentId).map((n) => n.name));
  if (!taken.has(base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 2;
  while (taken.has(`${stem} ${i}${ext}`)) i++;
  return `${stem} ${i}${ext}`;
}

export function createDir(parentId: string, name = '新建文件夹'): string {
  const id = crypto.randomUUID();
  const t = Date.now();
  const finalName = uniqueName(parentId, name);
  vfs.nodes[id] = { id, name: finalName, type: 'dir', parentId, content: '', mode: 0o755, owner: resolveOwner(), createdAt: t, updatedAt: t };
  emit('fs.create', { kind: '文件夹', name: finalName });
  return id;
}

export function createFile(parentId: string, name = '新建文本.txt', content = ''): string {
  const id = crypto.randomUUID();
  const t = Date.now();
  const finalName = uniqueName(parentId, name);
  vfs.nodes[id] = { id, name: finalName, type: 'file', parentId, content, mode: 0o644, owner: resolveOwner(), createdAt: t, updatedAt: t };
  emit('fs.create', { kind: '文件', name: finalName });
  return id;
}

// 二进制文件：把字节存进 blobStore，节点表里只留引用。异步（写 IndexedDB）。
export async function createBinaryFile(parentId: string, name: string, blob: Blob): Promise<string> {
  const id = crypto.randomUUID();
  const blobId = crypto.randomUUID();
  await putBlob(blobId, blob);
  const t = Date.now();
  const finalName = uniqueName(parentId, name);
  vfs.nodes[id] = {
    id,
    name: finalName,
    type: 'file',
    parentId,
    content: '',
    kind: 'binary',
    blobId,
    mime: blob.type,
    size: blob.size,
    mode: 0o644,
    owner: resolveOwner(),
    createdAt: t,
    updatedAt: t,
  };
  emit('fs.upload', { name: finalName, kb: (blob.size / 1024).toFixed(1) });
  return id;
}

// 取回二进制文件的字节（给图片查看器/Live2D 等用）
export function readBlob(node: VNode): Promise<Blob | undefined> {
  return node.blobId ? getBlob(node.blobId) : Promise.resolve(undefined);
}

// 是否图片（按 MIME 或扩展名）
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
export function isImage(node: VNode): boolean {
  if (node.mime?.startsWith('image/')) return true;
  const ext = node.name.slice(node.name.lastIndexOf('.') + 1).toLowerCase();
  return IMG_EXT.includes(ext);
}

export function rename(id: string, name: string): void {
  const n = vfs.nodes[id];
  if (n && name.trim()) {
    n.name = name.trim();
    n.updatedAt = Date.now();
  }
}

// dest 是否是 id 的子孙（移动时防止把文件夹拖进自己里面 → 成环）
function isInside(dest: string, id: string): boolean {
  let cur: VNode | undefined = vfs.nodes[dest];
  while (cur && cur.parentId) {
    if (cur.parentId === id) return true;
    cur = vfs.nodes[cur.parentId];
  }
  return false;
}

// 移动到另一个文件夹（拖拽用）。目标必须是文件夹，且不能是自己/自己的子孙。
export function move(id: string, destId: string): void {
  const n = vfs.nodes[id];
  const dest = vfs.nodes[destId];
  if (!n || id === 'root' || id === destId) return;
  if (!dest || dest.type !== 'dir') return;
  if (n.parentId === destId) return;
  if (id === destId || isInside(destId, id)) return;
  // 目标目录已有同名条目 → 自动改唯一名，避免「同名并存」导致按路径只能命中第一个、另一个永久不可达。
  // 此刻 n 仍在原目录，children(destId) 不含 n，故 uniqueName 只对目标已有名去重；无冲突则原样返回。
  n.name = uniqueName(destId, n.name);
  n.parentId = destId;
  n.updatedAt = Date.now();
}

export function writeFile(id: string, content: string): void {
  const n = vfs.nodes[id];
  if (n && n.type === 'file') {
    n.content = content;
    n.updatedAt = Date.now();
  }
}

// 改权限位（chmod）。不动 mtime（改的是元数据，非内容）。
export function setMode(id: string, mode: number): void {
  const n = vfs.nodes[id];
  if (n) n.mode = mode;
}
// 改属主（chown）。
export function setOwner(id: string, owner: string): void {
  const n = vfs.nodes[id];
  if (n) n.owner = owner;
}

// 软删除：移入回收站（记住原父级以便还原）。根节点不可删。
export function trash(id: string): void {
  const n = vfs.nodes[id];
  if (!n || id === 'root') return;
  n.prevParent = n.parentId;
  n.parentId = TRASH;
  n.updatedAt = Date.now();
  emit('fs.trash', { name: n.name });
}

// 从回收站还原到原位置（原父级没了就回根目录）
export function restoreFromTrash(id: string): void {
  const n = vfs.nodes[id];
  if (!n) return;
  n.parentId = n.prevParent && vfs.nodes[n.prevParent] ? n.prevParent : 'root';
  n.prevParent = undefined;
  n.updatedAt = Date.now();
}

// 彻底删除（文件夹递归删子项）。根节点不可删。二进制文件顺手清掉 IndexedDB 里的字节。
export function purge(id: string): void {
  if (id === 'root') return;
  for (const child of children(id)) purge(child.id);
  const n = vfs.nodes[id];
  if (n?.blobId) void deleteBlob(n.blobId); // fire-and-forget，不阻塞 UI
  delete vfs.nodes[id];
}

// 清空回收站
export function emptyTrash(): void {
  for (const n of children(TRASH)) purge(n.id);
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzVfs: unknown }).__qzVfs = {
    createBinaryFile,
    readBlob,
    isImage,
    getNode,
  };
}

// 从根到该节点的路径段（面包屑用）
export function pathSegments(id: string): VNode[] {
  const segs: VNode[] = [];
  let cur: VNode | undefined = vfs.nodes[id];
  while (cur) {
    segs.unshift(cur);
    cur = cur.parentId ? vfs.nodes[cur.parentId] : undefined;
  }
  return segs;
}

// ── 路径字符串 ⇄ 节点 id（给 Shell / 终端 / 一切按路径操作的命令用）─────────
// 把路径串解析成节点 id：支持 / 绝对、相对、`.`、`..`、root。找不到返回 undefined。
export function resolvePath(cwd: string, path: string): string | undefined {
  const p = (path ?? '').trim();
  if (p === '' || p === '.') return cwd;
  if (p === '/' || p === '~') return 'root';
  let curId = p.startsWith('/') ? 'root' : cwd;
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      const n = vfs.nodes[curId];
      // 到根就停在根；不越过回收站
      curId = n?.parentId && n.parentId !== 'trash' ? n.parentId : 'root';
      continue;
    }
    const hit = children(curId).find((k) => k.name === part);
    if (!hit) return undefined;
    curId = hit.id;
  }
  return curId;
}

// 节点 → 绝对路径串（root = "/"）
export function pathOf(id: string): string {
  if (id === 'root') return '/';
  const segs = pathSegments(id);
  return '/' + segs.slice(1).map((s) => s.name).join('/');
}
