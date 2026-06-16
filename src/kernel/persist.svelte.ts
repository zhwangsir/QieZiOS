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

// persisted(key, initial) —— 返回一个「会自己存盘」的响应式对象：
//  · 谁在模板/effect 里读它的字段，字段变就自动更新（这是 $state 的能力）
//  · 任何字段一变，就自动序列化写回 storage（靠下面那个 $effect）
export function persisted<T extends object>(key: string, initial: T): T {
  // 启动时先把上次的存档读回来，跟默认值做浅合并
  // （这样以后给 T 新增字段，旧存档缺这个字段也不会变 undefined）
  let start = initial;
  const raw = storage.get(key);
  if (raw) {
    try {
      start = { ...initial, ...JSON.parse(raw) };
    } catch { /* 存档损坏：回退默认值 */ }
  }

  const state = $state<T>(start);

  // $effect.root：在「组件之外」（.svelte.ts 模块里）开一个长期存在的 effect 作用域。
  // 普通 $effect 只能在组件里用；想在模块级别跑副作用，就得包一层 $effect.root。
  $effect.root(() => {
    $effect(() => {
      // $state.snapshot：把响应式代理「拍平」成普通对象，才能 JSON 序列化。
      // 它会深度读取每个字段 → 任何字段（含嵌套）变化都会触发这次保存。
      storage.set(key, JSON.stringify($state.snapshot(state)));
    });
  });

  return state;
}
