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
