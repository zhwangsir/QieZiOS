// ───────────────────────────────────────────────────────────
// 内核事件总线 · IPC 地基（pub/sub）
// 内核/系统在真实事件点 emit；任何子系统/App 都能 on 订阅。
// 系统日志、事件检查器都只是它的「订阅者」——系统从此事件驱动、可被旁观。
// 叶子模块：不 import 任何内部模块 → 谁依赖它都不会成环。
// ───────────────────────────────────────────────────────────
type Handler = (payload: unknown, event: string) => void;

const listeners = new Map<string, Set<Handler>>();

export interface BusEvent {
  seq: number;
  ts: number;
  event: string;
  payload: unknown;
}

const MAX = 300;
let seq = 0;

// 最近事件的环形缓冲（事件检查器读它；不持久化）
export const eventLog = $state<{ items: BusEvent[] }>({ items: [] });

// 订阅某事件（或 '*' 收全部）；返回取消订阅函数。
export function on(event: string, handler: Handler): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

// 发布一个事件：记进缓冲 + 同步通知订阅者（含 '*'）。处理器抛错不影响发布方。
export function emit(event: string, payload?: unknown): void {
  eventLog.items.push({ seq: ++seq, ts: Date.now(), event, payload });
  const over = eventLog.items.length - MAX;
  if (over > 0) eventLog.items.splice(0, over);

  const run = (set?: Set<Handler>) => {
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload, event);
      } catch (e) {
        console.error('[bus]', event, e);
      }
    }
  };
  run(listeners.get(event));
  run(listeners.get('*'));
}
