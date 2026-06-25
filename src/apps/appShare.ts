import { saveUserApp, type UserApp } from './userApps.svelte';

// ───────────────────────────────────────────────────────────
// App 分享 · 把用户 App 序列化成 .qzapp.json 下载，或从文件导入安装。
// 轻量「第三方分发」：写好的 App 存成文件发给别人，对方导入即用。
// serialize / importFromText 是纯函数，便于验证；export/importFile 才碰 DOM。
// ───────────────────────────────────────────────────────────
interface AppFile {
  qzapp: number;
  name: string;
  icon: string;
  code: string;
  caps: string[];
  width?: number;
  height?: number;
}

export function serializeUserApp(a: UserApp): string {
  const file: AppFile = {
    qzapp: 1,
    name: a.name,
    icon: a.icon,
    code: a.code,
    caps: a.caps ?? [],
    width: a.width,
    height: a.height,
  };
  return JSON.stringify(file, null, 2);
}

// 解析 .qzapp.json 文本 → 安装为用户 App，返回新 id；格式不对返回 null。
export function importUserAppFromText(text: string): string | null {
  let o: Partial<AppFile>;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o.code !== 'string') return null; // 至少要有代码
  return saveUserApp({
    name: typeof o.name === 'string' && o.name ? o.name : '导入的 App',
    icon: typeof o.icon === 'string' && o.icon ? o.icon : '🧩',
    code: o.code,
    caps: Array.isArray(o.caps) ? o.caps.filter((c) => typeof c === 'string') : [],
    width: typeof o.width === 'number' ? o.width : undefined,
    height: typeof o.height === 'number' ? o.height : undefined,
  });
}

export function exportUserApp(a: UserApp): void {
  const blob = new Blob([serializeUserApp(a)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${a.name || 'app'}.qzapp.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importUserAppFile(file: File): Promise<string | null> {
  return importUserAppFromText(await file.text());
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzShare: unknown }).__qzShare = { serializeUserApp, importUserAppFromText };
}
