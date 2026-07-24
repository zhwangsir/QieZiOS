// M19 通知中心 macOS 化：按来源 App 分组的纯函数。
// 不 import notifications.svelte.ts —— 用泛型结构化类型，任何 { ts, source? } 形的数据都能喂进来（方便测试/复用）。

export interface NoteGroup<T> {
  source: string;
  items: T[];
}

// 按 source 分组（无 source 归 '系统'）：
// - 组内按 ts 新 → 旧；
// - 组之间按「组内最新 ts」新 → 旧（对齐 macOS 通知中心：最新动静的来源排最前）。
export function groupBySource<T extends { ts: number; source?: string }>(
  items: readonly T[],
): NoteGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const n of items) {
    const key = n.source ?? '系统';
    const bucket = map.get(key);
    if (bucket) bucket.push(n);
    else map.set(key, [n]);
  }
  const groups: NoteGroup<T>[] = [];
  for (const [source, list] of map) {
    list.sort((a, b) => b.ts - a.ts); // 组内新 → 旧
    groups.push({ source, items: list });
  }
  // 组间按「组内最新 ts」新 → 旧（上面已排好序，items[0] 即组内最新）
  groups.sort((a, b) => b.items[0].ts - a.items[0].ts);
  return groups;
}
