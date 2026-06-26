// ───────────────────────────────────────────────────────────
// 持久化 · 让一份 $state 自动存进浏览器、刷新还原
// ───────────────────────────────────────────────────────────

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

  // $effect.root：在「组件之外」（.svelte.ts 模块里）开一个长期存在的 effect 作用域。
  // 普通 $effect 只能在组件里用；想在模块级别跑副作用，就得包一层 $effect.root。
  $effect.root(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
      // $state.snapshot：把响应式代理「拍平」成普通对象，才能 JSON 序列化。
      // 这里深度读取每个字段 → 任何字段（含嵌套）变化都会触发这次 effect。
      const snap = $state.snapshot(state) as T;
      const json = JSON.stringify(serialize ? serialize(snap) : snap);
      // 防抖写盘
      clearTimeout(timer);
      timer = setTimeout(() => storage.set(key, json), debounceMs);
    });
  });

  return state;
}
