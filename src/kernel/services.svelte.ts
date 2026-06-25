import { emit } from './bus.svelte';

// ───────────────────────────────────────────────────────────
// 服务层 · 无窗口的常驻后台进程（守护进程）
// 「进程 ≠ 窗口」：窗口进程在 processes 表；后台服务在这里。
// 服务在开机时启动，通常订阅事件总线、提供系统功能（如通知中心）。
// start() 可返回一个 stop 清理函数（取消订阅等）。
// ───────────────────────────────────────────────────────────
export interface ServiceDef {
  id: string;
  name: string;
  start: () => (() => void) | void;
}

export interface RunningService {
  id: string;
  name: string;
  startedAt: number;
  stop?: () => void;
}

const defs: ServiceDef[] = [];
export const services = $state<{ running: RunningService[] }>({ running: [] });

export function registerService(def: ServiceDef): void {
  if (!defs.some((d) => d.id === def.id)) defs.push(def);
}

// 开机启动所有已注册服务（幂等：已在跑的跳过）
export function startServices(): void {
  for (const def of defs) {
    if (services.running.some((s) => s.id === def.id)) continue;
    const stop = def.start() || undefined;
    services.running.push({ id: def.id, name: def.name, startedAt: Date.now(), stop });
    emit('svc.start', { id: def.id, name: def.name });
  }
}

export function stopService(id: string): void {
  const i = services.running.findIndex((s) => s.id === id);
  if (i === -1) return;
  const s = services.running[i];
  try {
    s.stop?.();
  } catch (e) {
    console.error('[svc stop]', id, e);
  }
  services.running.splice(i, 1);
  emit('svc.stop', { id: s.id, name: s.name });
}
