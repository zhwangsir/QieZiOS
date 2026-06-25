import { emit } from './bus.svelte';

// ───────────────────────────────────────────────────────────
// 服务层 · 无窗口的常驻后台进程（守护进程）+ 监督（崩溃自愈）
// 「进程 ≠ 窗口」：窗口进程在 processes 表；后台服务在这里。
// 监督：start() 抛错自动重试；运行时崩溃可 crashService 触发自愈；重启次数封顶 MAX_RESTARTS。
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
  restarts: number;
  status: 'running' | 'crashed';
  stop?: () => void;
}

const MAX_RESTARTS = 5;
const defs: ServiceDef[] = [];
export const services = $state<{ running: RunningService[] }>({ running: [] });

function entry(id: string): RunningService | undefined {
  return services.running.find((s) => s.id === id);
}

export function registerService(def: ServiceDef): void {
  if (!defs.some((d) => d.id === def.id)) defs.push(def);
}

// 启动（或重启）一个服务，带监督：start() 抛错 → 标记 crashed + 退避重试。
function launch(def: ServiceDef, restarts = 0): void {
  try {
    const stop = def.start() || undefined;
    const e = entry(def.id);
    if (e) {
      e.stop = stop;
      e.status = 'running';
      e.restarts = restarts;
      e.startedAt = Date.now();
    } else {
      services.running.push({ id: def.id, name: def.name, startedAt: Date.now(), restarts, status: 'running', stop });
    }
    emit(restarts > 0 ? 'svc.restart' : 'svc.start', { id: def.id, name: def.name, restarts });
  } catch (err) {
    const e = entry(def.id);
    if (e) e.status = 'crashed';
    else services.running.push({ id: def.id, name: def.name, startedAt: Date.now(), restarts, status: 'crashed' });
    emit('svc.crash', { id: def.id, name: def.name, error: err instanceof Error ? err.message : String(err) });
    if (restarts < MAX_RESTARTS) setTimeout(() => launch(def, restarts + 1), 800); // 退避后重试
  }
}

// 开机启动所有已注册服务（幂等：已在跑的跳过）
export function startServices(): void {
  for (const def of defs) {
    const e = entry(def.id);
    if (e && e.status === 'running') continue;
    launch(def);
  }
}

export function stopService(id: string): void {
  const i = services.running.findIndex((s) => s.id === id);
  if (i === -1) return;
  try {
    services.running[i].stop?.();
  } catch {
    /* ignore */
  }
  services.running.splice(i, 1);
  emit('svc.stop', { id });
}

// 手动重启（健康检查/用户触发）：停掉再起，重启次数 +1。
export function restartService(id: string): void {
  const def = defs.find((d) => d.id === id);
  const e = entry(id);
  if (!def) return;
  try {
    e?.stop?.();
  } catch {
    /* ignore */
  }
  launch(def, (e?.restarts ?? 0) + 1);
}

// 模拟/上报一次运行时崩溃 → 监督自愈（停掉 + 退避后自动重启）。
export function crashService(id: string, reason = 'crash'): void {
  const def = defs.find((d) => d.id === id);
  const e = entry(id);
  if (!def || !e) return;
  try {
    e.stop?.();
  } catch {
    /* ignore */
  }
  e.status = 'crashed';
  emit('svc.crash', { id, name: e.name, error: reason });
  if (e.restarts < MAX_RESTARTS) setTimeout(() => launch(def, e.restarts + 1), 300);
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzSvc: unknown }).__qzSvc = {
    services,
    startServices,
    stopService,
    restartService,
    crashService,
  };
}
