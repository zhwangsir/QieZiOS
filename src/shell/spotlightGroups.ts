// M13.1「Spotlight 分组标题」· 结果分组纯函数。
// 现状：results 扁平数组（构造时已按 calc → 最近/文件 → App → 我的 → 动作 → AI 分段拼接），
// 渲染层 each 平铺，分类只靠行尾小标签 → 缺 macOS Spotlight 式分组标题。
// 这里把「按 kind 聚合 + 记录每项扁平索引」抽成纯函数：
// · 组顺序 = 各 kind 在数组中首次出现的顺序（不重排结果，键盘 selected 索引天然不变）
// · 同 kind 聚合为一组，组内保持原顺序
// · fileTitle 由调用方给（空查询时是「最近打开」，有查询时是「文件」——两种 file 不同时出现）
// 纯函数不碰 DOM/store → vitest 裸跑（见 spotlightGroups.test.ts）。

export interface GroupItem<T> {
  r: T; // 原结果项
  i: number; // 扁平索引（== 原数组下标，selected 高亮/Enter 激活都靠它）
}

export interface ResultGroup<T> {
  title: string;
  items: GroupItem<T>[];
}

// kind → 组标题。file 标题由参数注入（场景相关），ai 恒为「问 AI」。
const TITLES: Record<string, string> = {
  calc: '计算',
  app: '应用程序',
  userapp: '我的 App',
  action: '动作',
  ai: '问 AI',
};

export function groupResults<T extends { kind: string }>(
  results: T[],
  fileTitle = '文件',
): ResultGroup<T>[] {
  const groups: ResultGroup<T>[] = [];
  const byKind = new Map<string, ResultGroup<T>>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    let g = byKind.get(r.kind);
    if (!g) {
      g = { title: r.kind === 'file' ? fileTitle : (TITLES[r.kind] ?? r.kind), items: [] };
      byKind.set(r.kind, g);
      groups.push(g);
    }
    g.items.push({ r, i });
  }
  return groups;
}
