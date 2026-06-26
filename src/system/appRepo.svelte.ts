import { persisted } from '../kernel/persist.svelte';
import { importUserAppFromText } from '../apps/appShare';
import { userApps, removeUserApp } from '../apps/userApps.svelte';

// ───────────────────────────────────────────────────────────
// 远程 App 仓库（对标 apt）：从一个 catalog URL 拉取 App 列表、一键安装。
// catalog 是个 JSON：{ name?, apps: [{id,name,icon,description?,app:.qzapp.json内联}] }
// 安装 = 把内联的 app 数据喂给 appShare.importUserAppFromText → 进「我的 App」。
// 默认源指向同源 /apps.json（dev/prod 都同源 → 无 CORS；换源改 repoConfig.url）。
// ───────────────────────────────────────────────────────────
export interface CatalogApp {
  id: string;
  name: string;
  icon: string;
  description?: string;
  app: unknown; // 内联的 .qzapp.json 对象（AppFile）
}
export interface Catalog {
  name?: string;
  apps: CatalogApp[];
}

export const repoConfig = persisted<{ url: string }>('qz.repo', { url: '/apps.json' });

// 拉取并校验 catalog。失败抛错（调用方兜 try/catch）。
export async function fetchCatalog(url = repoConfig.url): Promise<Catalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`仓库返回 HTTP ${res.status}`);
  const j = (await res.json()) as Partial<Catalog>;
  if (!j || !Array.isArray(j.apps)) throw new Error('仓库格式不对（缺 apps 数组）');
  // 过滤掉缺字段的坏条目，避免一条脏数据弄崩整列表
  const apps = (j.apps as unknown[]).filter(
    (a): a is CatalogApp =>
      !!a &&
      typeof (a as CatalogApp).id === 'string' &&
      typeof (a as CatalogApp).name === 'string' &&
      (a as CatalogApp).app != null,
  );
  return { name: j.name, apps };
}

// 安装一个目录条目 → 返回新装 App 的 id（数据无效则抛错）。
// 重装幂等：先删掉同名的旧版本，避免「我的 App」里堆重复。
export function installCatalogApp(entry: CatalogApp): string {
  const name = (entry.app as { name?: string })?.name ?? entry.name;
  for (const dup of userApps.list.filter((a) => a.name === name)) removeUserApp(dup.id);
  const id = importUserAppFromText(JSON.stringify(entry.app));
  if (!id) throw new Error('安装失败：App 数据无效');
  return id;
}

// 该条目是否已装（按名字粗判，给 UI 显示「已安装」）。
export function isInstalled(entry: CatalogApp): boolean {
  return userApps.list.some((a) => a.name === entry.name);
}
