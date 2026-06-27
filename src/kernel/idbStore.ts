// ───────────────────────────────────────────────────────────
// 字符串键值存储 · IndexedDB（给 persistedAsync 用）
// localStorage 只有 ~5–10MB 硬配额且同步阻塞主线程；IndexedDB 容量大几个量级、异步。
// 大块状态（如整棵 VFS 树 + 所有文本）改存这里，破掉 localStorage 天花板。
// 与 blobStore 同一套写法：必须「await db() 后在同一任务里建事务 + 发请求」，否则事务会失效。
// 独立数据库（qz-kv），与二进制库 qz-blobs 分开。所有操作 best-effort（私密模式/旧浏览器
// IDB 不可用时静默降级：读返回 null、写忽略），不让存储层异常炸穿上层。
// ───────────────────────────────────────────────────────────
const DB_NAME = 'qz-kv';
const STORE = 'kv';
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

export async function idbGet(key: string): Promise<string | null> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as string | undefined) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: string): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* IDB 不可用：best-effort 忽略 */
  }
}

export async function idbRemove(key: string): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

// 所有键（给同步/统计枚举 IDB 里的 qz.* 用）
export async function idbKeys(): Promise<string[]> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).getAllKeys();
      r.onsuccess = () => resolve((r.result as IDBValidKey[]).map(String));
      r.onerror = () => reject(r.error);
    });
  } catch {
    return [];
  }
}

// 全部键值（给 sync.gatherState / SysMonitor 用量统计）
export async function idbEntries(): Promise<Record<string, string>> {
  try {
    const d = await db();
    const [keys, vals] = await new Promise<[IDBValidKey[], unknown[]]>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const s = tx.objectStore(STORE);
      const rk = s.getAllKeys();
      const rv = s.getAll();
      tx.oncomplete = () => resolve([rk.result as IDBValidKey[], rv.result as unknown[]]);
      tx.onerror = () => reject(tx.error);
    });
    const out: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (typeof vals[i] === 'string') out[String(k)] = vals[i] as string;
    });
    return out;
  } catch {
    return {};
  }
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzKv: unknown }).__qzKv = { idbGet, idbSet, idbRemove, idbKeys, idbEntries };
}
