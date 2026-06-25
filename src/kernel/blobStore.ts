// ───────────────────────────────────────────────────────────
// 二进制大对象存储 · IndexedDB
// localStorage 只存字符串、容量也小（~5MB），装不下图片/Live2D 模型/App 资源。
// 所以 VFS 的二进制文件：字节存这里（按 blobId 索引），节点表里只留个引用。
// IndexedDB 是异步的 —— 注意：事务必须在拿到 store 的「同一个任务」里发请求，
// 否则一回事件循环事务就自动提交/失效了。所以这里都是「await db() 后同步建事务+发请求」。
// ───────────────────────────────────────────────────────────
const DB_NAME = 'qz-blobs';
const STORE = 'blobs';
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

export async function putBlob(id: string, blob: Blob): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result as Blob | undefined);
    r.onerror = () => reject(r.error);
  });
}

export async function deleteBlob(id: string): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzBlobs: unknown }).__qzBlobs = { putBlob, getBlob, deleteBlob };
}
