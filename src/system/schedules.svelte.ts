import { persisted } from '../kernel/persist.svelte';

// 定时任务表（持久化 → 刷新后由 schedd 服务重新武装）。
// 一次性：fireAt（时间戳）；循环：every（毫秒间隔）。
export interface Schedule {
  id: string;
  title: string;
  body?: string;
  fireAt?: number;
  every?: number;
  createdAt: number;
}

export const schedules = persisted<{ items: Schedule[] }>('qz.schedules', { items: [] });

export function addSchedule(s: Omit<Schedule, 'id' | 'createdAt'>): Schedule {
  const full: Schedule = { id: crypto.randomUUID().slice(0, 8), createdAt: Date.now(), ...s };
  schedules.items.push(full);
  return full;
}

export function removeSchedule(id: string): void {
  const i = schedules.items.findIndex((x) => x.id === id);
  if (i !== -1) schedules.items.splice(i, 1);
}
