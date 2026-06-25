import { launch } from '../kernel/processes.svelte';
import { appRegistry, type AppDef } from './registry';
import { userApps, type UserApp } from './userApps.svelte';
import UserAppHost from './UserApp.svelte';

// ───────────────────────────────────────────────────────────
// 桌面 App 视图 · 把「内置注册表」+「已装用户 App」合并成统一的 AppDef 列表。
// 这些函数读 userApps.list（响应式 $state）→ 在组件的模板/$derived 里调用时会自动追踪，
// 用户装/删 App 时 Dock/任务栏/窗口渲染会跟着更新。无需把注册表整个改成 $derived。
// 用户 App 都用同一个通用宿主 UserAppHost 渲染，靠 data.appId 区分跑哪个。
// ───────────────────────────────────────────────────────────

function defForUserApp(a: UserApp): AppDef {
  return {
    id: a.id,
    title: a.name,
    icon: a.icon,
    width: a.width,
    height: a.height,
    hidden: false,
    component: UserAppHost,
    data: { appId: a.id },
  };
}

// Dock / Spotlight 用：所有可见 App（内置非 hidden + 已装用户 App）
export function visibleAppDefs(): AppDef[] {
  const builtins = Object.values(appRegistry).filter((a) => !a.hidden);
  return [...builtins, ...userApps.list.map(defForUserApp)];
}

// 渲染窗口 / 任务栏图标用：按 appId 解析出 AppDef（内置或用户 App；都没有则 undefined）
export function resolveAppDef(appId: string): AppDef | undefined {
  if (appRegistry[appId]) return appRegistry[appId];
  const a = userApps.list.find((x) => x.id === appId);
  return a ? defForUserApp(a) : undefined;
}

export function launchAppDef(def: AppDef): void {
  launch(def.id, def.title, { width: def.width, height: def.height, data: def.data });
}
export function launchUserApp(a: UserApp): void {
  launchAppDef(defForUserApp(a));
}
