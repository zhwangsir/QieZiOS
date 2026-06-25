import { persisted } from '../kernel/persist.svelte';

// 固定的「网页 App」：把任意网址当成系统里的一个 App（iframe 嵌入窗口）。
// 兑现「平台兼容异构 App」——胡桃博客等外部站点以后就这么进系统。
export interface WebApp {
  id: string;
  name: string;
  url: string;
  icon: string;
  createdAt: number;
}

export const webApps = persisted<{ list: WebApp[] }>('qz.webApps', { list: [] });

export function getWebApp(id: string): WebApp | undefined {
  return webApps.list.find((a) => a.id === id);
}

function normUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
}

export function addWebApp(input: { name: string; url: string; icon?: string }): WebApp | null {
  const url = normUrl(input.url);
  if (!url) return null;
  const wa: WebApp = {
    id: crypto.randomUUID().slice(0, 8),
    name: input.name.trim() || url.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    url,
    icon: input.icon?.trim() || '🌐',
    createdAt: Date.now(),
  };
  webApps.list.push(wa);
  return wa;
}

export function removeWebApp(id: string): void {
  const i = webApps.list.findIndex((a) => a.id === id);
  if (i !== -1) webApps.list.splice(i, 1);
}
