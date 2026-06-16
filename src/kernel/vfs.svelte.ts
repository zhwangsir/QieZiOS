import { persisted } from './persist.svelte';

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
  parentId: string | null; // null 仅根节点
  content: string; // 文件正文；文件夹恒为空串
  createdAt: number;
  updatedAt: number;
}

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
  vfs.nodes[id] = { id, name: uniqueName(parentId, name), type: 'dir', parentId, content: '', createdAt: t, updatedAt: t };
  return id;
}

export function createFile(parentId: string, name = '新建文本.txt', content = ''): string {
  const id = crypto.randomUUID();
  const t = Date.now();
  vfs.nodes[id] = { id, name: uniqueName(parentId, name), type: 'file', parentId, content, createdAt: t, updatedAt: t };
  return id;
}

export function rename(id: string, name: string): void {
  const n = vfs.nodes[id];
  if (n && name.trim()) {
    n.name = name.trim();
    n.updatedAt = Date.now();
  }
}

export function writeFile(id: string, content: string): void {
  const n = vfs.nodes[id];
  if (n && n.type === 'file') {
    n.content = content;
    n.updatedAt = Date.now();
  }
}

// 删除（文件夹递归删子项）。根节点不可删。
export function remove(id: string): void {
  if (id === 'root') return;
  for (const child of children(id)) remove(child.id);
  delete vfs.nodes[id];
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
