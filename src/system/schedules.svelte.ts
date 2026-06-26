import { persisted } from '../kernel/persist.svelte';

// 定时任务表（持久化 → 刷新后由 schedd 服务重新武装）。
// 一次性：fireAt（时间戳）；循环：every（毫秒间隔）。
// command：可选 shell 命令——到点由 schedd 经注入的运行器执行（at/crontab 用）；无则只发通知（提醒用）。
export interface Schedule {
  id: string;
  title: string;
  body?: string;
  fireAt?: number;
  every?: number;
  command?: string;
  createdAt: number;
}

export const schedules = persisted<{ items: Schedule[] }>('qz.schedules', { items: [] });

// 定时命令的运行器（注入式，避免 system 反向 import lib/shell 成环）。App 启动时接上一个常驻 shell ctx。
type SchedRunner = (cmd: string) => Promise<{ out?: string; err?: string; code: number }>;
let scheduleRunner: SchedRunner | null = null;
export function setScheduleRunner(fn: SchedRunner): void {
  scheduleRunner = fn;
}
export function runScheduled(cmd: string): Promise<{ out?: string; err?: string; code: number }> {
  return scheduleRunner ? scheduleRunner(cmd) : Promise.resolve({ err: 'shell 未就绪', code: 1 });
}

export function addSchedule(s: Omit<Schedule, 'id' | 'createdAt'>): Schedule {
  const full: Schedule = { id: crypto.randomUUID().slice(0, 8), createdAt: Date.now(), ...s };
  schedules.items.push(full);
  return full;
}

export function removeSchedule(id: string): void {
  const i = schedules.items.findIndex((x) => x.id === id);
  if (i !== -1) schedules.items.splice(i, 1);
}
