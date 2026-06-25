// ───────────────────────────────────────────────────────────
// 内核日志 · dmesg 式系统日志（可观测性地基）
// 内核/VFS/App SDK 在真实事件点调用 logSys() 写一条 → 任务管理器实时展示。
// 不持久化：每次「开机」（刷新）重置，反映本次会话的真实活动（符合 dmesg 语义）。
// 封顶 MAX 条防无限增长。
// ───────────────────────────────────────────────────────────
export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
  seq: number;
  ts: number;
  level: LogLevel;
  source: string; // 来源子系统：kernel / vfs / app / ai …
  msg: string;
}

const MAX = 500;
let seq = 0;

export const klog = $state<{ entries: LogEntry[] }>({ entries: [] });

export function logSys(source: string, msg: string, level: LogLevel = 'info'): void {
  klog.entries.push({ seq: ++seq, ts: Date.now(), level, source, msg });
  const over = klog.entries.length - MAX;
  if (over > 0) klog.entries.splice(0, over);
}

// ── 总线 → 日志桥：把总线上的语义事件格式化成一条日志 ──
// 系统日志因此是「事件流的一个视图」。任何 emit 的事件经这里落进 dmesg。
import { on } from './bus.svelte';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fmt(event: string, p: any): { source: string; msg: string; level: LogLevel } | null {
  switch (event) {
    case 'sys.boot': return { source: 'kernel', msg: 'QieZiOS 内核启动', level: 'info' };
    case 'sys.mount': return { source: 'vfs', msg: `挂载文件系统（${p?.nodes} 个节点）`, level: 'info' };
    case 'sys.ready': return { source: 'shell', msg: '外壳就绪', level: 'info' };
    case 'sys.restore': return { source: 'kernel', msg: `会话还原：${p?.count} 个进程`, level: 'info' };
    case 'proc.launch': return { source: 'kernel', msg: `启动 ${p?.appId}（pid ${p?.pid}）`, level: 'info' };
    case 'proc.exit': return { source: 'kernel', msg: `退出 ${p?.appId}（pid ${p?.pid}）`, level: 'info' };
    case 'proc.minimize': return { source: 'kernel', msg: `挂起 ${p?.appId}（pid ${p?.pid}）`, level: 'info' };
    case 'proc.restore': return { source: 'kernel', msg: `恢复 ${p?.appId}（pid ${p?.pid}）`, level: 'info' };
    case 'fs.create': return { source: 'vfs', msg: `新建${p?.kind} ${p?.name}`, level: 'info' };
    case 'fs.upload': return { source: 'vfs', msg: `上传 ${p?.name}（${p?.kb}KB → IndexedDB）`, level: 'info' };
    case 'fs.trash': return { source: 'vfs', msg: `删除 ${p?.name} → 回收站`, level: 'warn' };
    case 'app.call': return { source: 'appsdk', msg: `App 调用 ${p?.tool}`, level: 'info' };
    case 'app.denied': return { source: 'appsdk', msg: `拒绝能力 ${p?.tool}（未声明）`, level: 'warn' };
    case 'svc.start': return { source: 'service', msg: `服务启动 ${p?.name}`, level: 'info' };
    case 'svc.stop': return { source: 'service', msg: `服务停止 ${p?.name}`, level: 'warn' };
    case 'notify': return { source: 'notify', msg: `通知：${p?.title}`, level: 'info' };
    default:
      // 用户 App 经 IPC 发的事件（app:*）也落日志，方便观测
      if (event.startsWith('app:'))
        return { source: 'app', msg: `${event}${p != null ? ' ' + JSON.stringify(p).slice(0, 80) : ''}`, level: 'info' };
      return null;
  }
}

on('*', (payload, event) => {
  const f = fmt(event, payload);
  if (f) logSys(f.source, f.msg, f.level);
});
