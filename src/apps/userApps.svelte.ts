import { persisted } from '../kernel/persist.svelte';

// 用户在「开发者」里写好、保存下来的命名 App（持久化 → 装上后反复可用）。
export interface UserApp {
  id: string;
  name: string;
  icon: string;
  code: string;
  width: number;
  height: number;
  createdAt: number;
}

export const userApps = persisted<{ list: UserApp[] }>('qz.userApps', { list: [] }, 400);

export function getUserApp(id: string): UserApp | undefined {
  return userApps.list.find((a) => a.id === id);
}

// 新增或更新（传 id 且存在 = 更新），返回 App id。
export function saveUserApp(input: {
  id?: string;
  name: string;
  icon: string;
  code: string;
  width?: number;
  height?: number;
}): string {
  const existing = input.id ? userApps.list.find((a) => a.id === input.id) : undefined;
  if (existing) {
    existing.name = input.name;
    existing.icon = input.icon;
    existing.code = input.code;
    if (input.width) existing.width = input.width;
    if (input.height) existing.height = input.height;
    return existing.id;
  }
  const id = input.id ?? crypto.randomUUID();
  userApps.list.push({
    id,
    name: input.name,
    icon: input.icon,
    code: input.code,
    width: input.width ?? 480,
    height: input.height ?? 400,
    createdAt: Date.now(),
  });
  return id;
}

export function removeUserApp(id: string): void {
  const i = userApps.list.findIndex((a) => a.id === id);
  if (i !== -1) userApps.list.splice(i, 1);
}
