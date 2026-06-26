import { emit } from './bus.svelte';
import { persisted } from './persist.svelte';

// ───────────────────────────────────────────────────────────
// 服务层 · 无窗口的常驻后台进程（守护进程）+ 监督（崩溃自愈）+ 可配置 init
// 「进程 ≠ 窗口」：窗口进程在 processes 表；后台服务在这里。
// 监督：start() 抛错自动重试；运行时崩溃可 crashService 触发自愈；重启次数封顶 MAX_RESTARTS。
// init：服务可声明 after（排序）/ requires（硬依赖）；开机按拓扑序启动、禁用的不启动（持久化）。
// ───────────────────────────────────────────────────────────
export interface ServiceDef {
  id: string;
  name: string;
  after?: string[]; // 这些服务先于我启动（仅排序）
  requires?: string[]; // 硬依赖：任一被禁用则我不启动
  start: () => (() => void) | void;
}

export type ServiceStatus = 'running' | 'stopped' | 'crashed' | 'disabled';

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

// 持久化的「开机禁用」清单（systemctl enable/disable）。不在清单 = 启用。
const config = persisted<{ disabled: string[] }>('qz.svccfg', { disabled: [] });
export function isEnabled(id: string): boolean {
  return !config.disabled.includes(id);
}
export function enableService(id: string): void {
  config.disabled = config.disabled.filter((x) => x !== id);
  emit('svc.enable', { id });
}
export function disableService(id: string): void {
  if (!config.disabled.includes(id)) config.disabled = [...config.disabled, id];
  stopService(id); // 禁用即停掉当前运行的
  emit('svc.disable', { id });
}

function entry(id: string): RunningService | undefined {
  return services.running.find((s) => s.id === id);
}

export function registerService(def: ServiceDef): void {
  if (!defs.some((d) => d.id === def.id)) defs.push(def);
}

// 按 after/requires 拓扑排序（依赖在前）。遇环忽略该边，回退到注册序。
function orderedDefs(): ServiceDef[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const done = new Set<string>();
  const result: ServiceDef[] = [];
  const visit = (d: ServiceDef, stack: Set<string>) => {
    if (done.has(d.id) || stack.has(d.id)) return;
    stack.add(d.id);
    for (const dep of [...(d.after ?? []), ...(d.requires ?? [])]) {
      const dd = byId.get(dep);
      if (dd) visit(dd, stack);
    }
    stack.delete(d.id);
    done.add(d.id);
    result.push(d);
  };
  for (const d of defs) visit(d, new Set());
  return result;
}

// 全部已注册服务的状态视图（含禁用/未启动的，给 systemctl 与任务管理器用）
export function listServices(): {
  id: string;
  name: string;
  status: ServiceStatus;
  restarts: number;
  after: string[];
  requires: string[];
  startedAt?: number;
}[] {
  return defs.map((d) => {
    const e = entry(d.id);
    const status: ServiceStatus = !isEnabled(d.id) ? 'disabled' : e ? e.status : 'stopped';
    return {
      id: d.id,
      name: d.name,
      status,
      restarts: e?.restarts ?? 0,
      after: d.after ?? [],
      requires: d.requires ?? [],
      startedAt: e?.startedAt,
    };
  });
}

// 启动单个服务（运行时操作，不看 enabled——systemctl start 可启动被禁用的服务）
export function startService(id: string): void {
  const def = defs.find((d) => d.id === id);
  if (!def) return;
  const e = entry(id);
  if (e && e.status === 'running') return;
  launch(def);
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
    // 退避后重试；但若期间被 disable 了，就别复活（disable 必须胜过 in-flight 自愈）
    if (restarts < MAX_RESTARTS) setTimeout(() => { if (isEnabled(def.id)) launch(def, restarts + 1); }, 800);
  }
}

// 开机启动：按拓扑序、跳过禁用的、硬依赖未满足的也跳过（幂等：已在跑的跳过）
export function startServices(): void {
  for (const def of orderedDefs()) {
    if (!isEnabled(def.id)) continue; // 被禁用 → 不开机启动
    if ((def.requires ?? []).some((r) => !isEnabled(r))) {
      emit('svc.skip', { id: def.id, reason: 'requires 未满足' });
      continue; // 硬依赖被禁用 → 我也不启动
    }
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
  if (e.restarts < MAX_RESTARTS) setTimeout(() => { if (isEnabled(id)) launch(def, e.restarts + 1); }, 300);
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzSvc: unknown }).__qzSvc = {
    services,
    startServices,
    startService,
    stopService,
    restartService,
    crashService,
    enableService,
    disableService,
    isEnabled,
    listServices,
  };
}
