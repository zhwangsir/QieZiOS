// ───────────────────────────────────────────────────────────
// 持久化 · 让一份 $state 自动存进浏览器、刷新还原
// ───────────────────────────────────────────────────────────

import { idbGet, idbSet } from './idbStore';

// storage 抽象接口：现在用 localStorage 实现；
// 以后整套换成 IndexedDB / OPFS+SQLite-WASM，只要换这一层，上面全不动。
export interface KVStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const localBackend: KVStorage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* 配额满/隐私模式：忽略 */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// 当前后端（导出成 let，将来一行就能换实现）
export let storage: KVStorage = localBackend;

// 所有 persisted/persistedAsync store 登记一个「立即刷盘」函数：若有挂起的防抖写，
// 取消计时器并马上写一次。给 flushPersisted() 用 —— 云同步上传前先把挂起写盘刷干净，
// 避免「改完立刻上传 → 改动还在防抖计时器里没落盘 → 上传陈旧状态、悄悄漏数据」（D2）。
const flushers: Array<() => void | Promise<void>> = [];

// 冻结开关：为真时所有 store 的防抖写盘 effect 都跳过写入。
// 云同步「拉取」时用：pullSync 把云端数据写进后端(IDB/localStorage)后、reload 前有个窗口，
// 此时内存里的 $state 还是旧值且 hydrated=true，任何对 store 的响应式写都会把旧内存序列化
// 盖回刚拉下来的云数据（F1，静默丢失正要恢复的数据）。冻结期间内存→盘的写一律不发生，
// 盘上的已拉取数据安然等到 reload 重新 hydrate。reload 后模块重载，frozen 自然复位。
let frozen = false;
export function freezePersistence(): void {
  frozen = true;
}
export function unfreezePersistence(): void {
  frozen = false;
}

// persisted(key, initial, debounceMs) —— 返回一个「会自己存盘」的响应式对象：
//  · 谁在模板/effect 里读它的字段，字段变就自动更新（这是 $state 的能力）
//  · 任何字段一变，就（防抖后）自动序列化写回 storage
// debounceMs：拖窗时几何每帧都在变，若每次都同步写 localStorage 会卡；
//             所以停下来 debounceMs 毫秒后才真正写一次。
// serialize：可选「存盘前变换」——返回要写进 storage 的形态（如剥掉不该持久化的大字段）。
// 不传则原样存。注意：读回来的就是变换后的形态，所以变换要保证仍能 JSON.parse 回 T 的子集。
export function persisted<T extends object>(
  key: string,
  initial: T,
  debounceMs = 150,
  serialize?: (snapshot: T) => unknown,
): T {
  // 启动时先把上次的存档读回来
  let start = initial;
  const raw = storage.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      // 数组：直接用存档；对象：跟默认值浅合并（以后给 T 新增字段，旧存档缺也不会 undefined）
      start = Array.isArray(initial) ? (parsed as T) : { ...initial, ...parsed };
    } catch { /* 存档损坏：回退默认值 */ }
  }

  const state = $state<T>(start);

  // timer/pending 提到函数作用域 → effect 与 flusher 都能闭包到它们。
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => void) | null = null; // 最近一次「待写盘」动作（捕获最新 snapshot）

  // $effect.root：在「组件之外」（.svelte.ts 模块里）开一个长期存在的 effect 作用域。
  // 普通 $effect 只能在组件里用；想在模块级别跑副作用，就得包一层 $effect.root。
  $effect.root(() => {
    $effect(() => {
      // $state.snapshot：把响应式代理「拍平」成普通对象（深读 → 订阅每个字段，含键增删）。
      // snapshot 必须留在 effect 体内以维持订阅；但更重的 serialize + JSON.stringify 推迟到
      // 防抖回调里——高频变更（如 TextEdit 逐字输入）每次只做一次轻量 snapshot，停手后才序列化
      // 一次整棵树，而不是每个键程都全量序列化（大文件/多文件时这是主要开销）。
      const snap = $state.snapshot(state) as T;
      if (frozen) return; // 冻结（同步拉取期间）：不安排写盘，防旧内存覆盖已拉取数据
      // 防抖写盘：序列化也一并推迟，只有最后一次（防抖窗口内）真正写入。
      clearTimeout(timer);
      pending = () => storage.set(key, JSON.stringify(serialize ? serialize(snap) : snap));
      timer = setTimeout(() => { if (!frozen) pending?.(); pending = null; }, debounceMs);
    });
  });

  // 立即刷盘：取消防抖、马上写当前挂起值（供 flushPersisted）。冻结期间不写。
  flushers.push(() => {
    if (pending && !frozen) { clearTimeout(timer); pending(); pending = null; }
  });

  return state;
}

// ───────────────────────────────────────────────────────────
// persistedAsync · 同样的「自动存盘响应式对象」，但后端是 IndexedDB（异步、容量大）。
// 给大块状态用（如整棵 VFS 树）—— 破掉 localStorage ~5–10MB 配额天花板。
// 与同步版的两点关键差异：
//  1) 异步 hydrate：IDB 读是异步的 → store 先以 initial（默认值）启动，登记一个 hydrator，
//     由启动期 hydrateAll() 统一 await 后再挂载 UI（main.ts 门控，避免默认值闪烁）。
//  2) hydrated 守卫：hydrate 完成前绝不写盘 —— 否则启动早期 effect 会把「默认值」写进 IDB、
//     覆盖掉还没读回来的真数据（这是异步化最危险的坑）。
// 一次性迁移：IDB 无此键但 localStorage 有（老用户）→ 搬进 IDB 并删 localStorage 旧键释放配额。
// ───────────────────────────────────────────────────────────

// 哪些键存在 IDB（而非 localStorage）—— sync / 存储统计据此路由到正确后端。
export const ASYNC_KEYS = new Set<string>();
const hydrators: Array<() => Promise<void>> = [];

// 把响应式 state 的内容「就地替换」成 next（保持同一个代理引用 → 既有订阅全部继续有效）。
function replaceInPlace<T extends object>(state: T, next: T): void {
  if (Array.isArray(state) && Array.isArray(next)) {
    (state as unknown[]).splice(0, (state as unknown[]).length, ...(next as unknown[]));
  } else {
    for (const k of Object.keys(state)) if (!(k in (next as object))) delete (state as Record<string, unknown>)[k];
    Object.assign(state, next);
  }
}

export function persistedAsync<T extends object>(
  key: string,
  initial: T,
  debounceMs = 150,
  serialize?: (snapshot: T) => unknown,
): T {
  ASYNC_KEYS.add(key);
  const state = $state<T>(initial); // 先以默认值启动；hydrateAll 后填真数据
  let hydrated = false;

  hydrators.push(async () => {
    let raw = await idbGet(key);
    if (raw == null) {
      // 一次性迁移：老用户的数据还在 localStorage → 搬进 IDB、删旧键释放配额
      const ls = localBackend.get(key);
      if (ls != null) {
        raw = ls;
        await idbSet(key, ls);
        localBackend.remove(key);
      }
    }
    if (raw != null) {
      try {
        const parsed = JSON.parse(raw);
        replaceInPlace(state, (Array.isArray(initial) ? parsed : { ...initial, ...parsed }) as T);
      } catch {
        /* 存档损坏：保留默认值 */
      }
    }
    hydrated = true; // 之后才允许写盘
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: (() => Promise<void>) | null = null; // 最近一次「待写 IDB」动作

  $effect.root(() => {
    $effect(() => {
      const snap = $state.snapshot(state) as T; // 留在 effect 体内维持订阅（含键增删）
      if (!hydrated) return; // hydrate 完成前不写，避免默认值覆盖真数据
      if (frozen) return; // 冻结（拉取期间）：不安排写盘，防旧内存覆盖已拉取数据
      clearTimeout(timer);
      pending = () => idbSet(key, JSON.stringify(serialize ? serialize(snap) : snap));
      timer = setTimeout(() => { if (!frozen) void pending?.(); pending = null; }, debounceMs);
    });
  });

  // 立即刷盘：取消防抖、马上写并返回其 Promise（idbSet 异步，flushPersisted 会 await）。冻结期间不写。
  flushers.push(() => {
    if (!pending || frozen) return;
    clearTimeout(timer);
    const p = pending();
    pending = null;
    return p;
  });

  return state;
}

// 启动门：挂载 UI 前 await 这个，让所有 IDB store 把真数据读回来（首屏不闪默认值）。
export async function hydrateAll(): Promise<void> {
  await Promise.all(hydrators.map((h) => h()));
}

// 把所有 store 挂起的防抖写盘立刻落地（同步后端立即返回、IDB 后端返回 Promise）。
// 云同步上传前调用 → 收集状态时不会漏掉「还在防抖窗口里」的最新改动。
export async function flushPersisted(): Promise<void> {
  await Promise.all(flushers.map((f) => f()));
}
