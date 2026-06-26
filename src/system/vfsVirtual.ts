// ───────────────────────────────────────────────────────────
// 只读虚拟文件系统（对标 Linux 的 /proc、/dev）。
// 不进真 VFS 节点表（不持久化）——按需根据系统实时状态「现算」内容。
// Shell 的 ls/cat 在解析到这些挂载点前缀时改走这里（见 lib/shell.ts）。
// 设计成纯查询函数 + 一张挂载点前缀表，方便以后加 /sys 等。
// ───────────────────────────────────────────────────────────
import { sys } from './sys';

export interface VEntry {
  name: string;
  type: 'dir' | 'file';
}

// 已挂载的只读虚拟前缀（绝对路径）
export const VIRTUAL_MOUNTS = ['/proc', '/dev'];

// 这个绝对路径是否落在某个虚拟挂载点下
export function isVirtualPath(abs: string): boolean {
  const n = normAbs(abs);
  return VIRTUAL_MOUNTS.some((m) => n === m || n.startsWith(m + '/'));
}

// 规范化绝对路径：折叠 `.`、`..`、多余斜杠 → /a/b
export function normAbs(path: string): string {
  const segs: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return '/' + segs.join('/');
}

// 取挂载点之下的子段数组（[] = 挂载根）
function sub(absNorm: string, mount: string): string[] {
  const rest = absNorm.slice(mount.length).replace(/^\//, '');
  return rest === '' ? [] : rest.split('/');
}

// 列虚拟目录；null = 该路径不存在或不是目录
export function virtualList(abs: string): VEntry[] | null {
  const n = normAbs(abs);
  if (n === '/proc') {
    return [
      { name: 'version', type: 'file' },
      { name: 'uptime', type: 'file' },
      ...sys.proc.list().map((p) => ({ name: String(p.pid), type: 'dir' as const })),
    ];
  }
  if (n.startsWith('/proc/')) {
    const segs = sub(n, '/proc');
    if (segs.length === 1 && sys.proc.list().some((p) => p.pid === Number(segs[0]))) {
      return [
        { name: 'status', type: 'file' },
        { name: 'cmdline', type: 'file' },
      ];
    }
    return null;
  }
  if (n === '/dev') {
    return [
      { name: 'null', type: 'file' },
      { name: 'clipboard', type: 'file' },
      { name: 'random', type: 'file' },
    ];
  }
  return null;
}

// 读虚拟文件；null = 不存在或不是文件
export function virtualRead(abs: string): string | null {
  const n = normAbs(abs);
  if (n === '/proc/version') return `QieZiOS qzsh · Web OS (Svelte 5)\n${navigator.userAgent}`;
  if (n === '/proc/uptime') return `${Math.floor(performance.now() / 1000)} 秒（自本页加载）`;
  if (n.startsWith('/proc/')) {
    const segs = sub(n, '/proc'); // [pid, 文件名]
    if (segs.length === 2) {
      const p = sys.proc.list().find((q) => q.pid === Number(segs[0]));
      if (!p) return null;
      if (segs[1] === 'cmdline') return p.appId;
      if (segs[1] === 'status') {
        return [
          `Pid:\t${p.pid}`,
          `App:\t${p.appId}`,
          `Title:\t${p.title}`,
          `State:\t${p.minimized ? 'minimized' : 'running'}`,
          `Uptime:\t${Math.floor((Date.now() - p.startedAt) / 1000)}s`,
        ].join('\n');
      }
    }
    return null;
  }
  if (n === '/dev/null') return '';
  if (n === '/dev/clipboard') return sys.clipboard.read();
  if (n === '/dev/random') return String(Math.random());
  return null;
}

// 判断虚拟路径是 dir / file / 不存在
export function virtualStat(abs: string): 'dir' | 'file' | null {
  if (virtualList(abs)) return 'dir';
  if (virtualRead(abs) !== null) return 'file';
  return null;
}
