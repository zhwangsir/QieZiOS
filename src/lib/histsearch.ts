// ───────────────────────────────────────────────────────────
// Ctrl+R 历史搜索（reverse-i-search）—— 纯函数核心，Terminal 的交互状态机调它。
// 贴近 bash 语义：
//  · 子串匹配（includes），不是前缀匹配
//  · rsUpdate 总是从最新向最老搜（输入每个字符都重新定位到最新命中）
//  · 再按 Ctrl+R（rsOlder）找「下一个更老的匹配」；没有更老 → 停原地
//    （bash 会显示 failed-reverse-i-search，这里由 UI 层据 query 非空且 idx=-1 显示 failed）
// 不碰 DOM / 不读全局 → vitest 裸跑。
// ───────────────────────────────────────────────────────────

export interface RSearchState {
  query: string;
  idx: number; // 命中的历史下标；-1 = 未命中（空 query 也算未命中）
}

// 从 fromIdx（含）向更老方向找第一个包含 query 的项；fromIdx 越界先夹到合法范围。
function findBackward(hist: readonly string[], query: string, fromIdx: number): number {
  for (let i = Math.min(fromIdx, hist.length - 1); i >= 0; i--) {
    if (hist[i].includes(query)) return i;
  }
  return -1;
}

// 查询词变化 → 从最新重新搜（bash 每敲一个字符就重搜一次的手感）
export function rsUpdate(hist: readonly string[], query: string): RSearchState {
  return { query, idx: query === '' ? -1 : findBackward(hist, query, hist.length - 1) };
}

// 再按一次 Ctrl+R → 找下一个更老的匹配。
// idx=-1（当前未命中）时从尾部重新搜一遍；仍无 → 保持原状态（bash 的 failed 提示从简，停原地）。
export function rsOlder(hist: readonly string[], s: RSearchState): RSearchState {
  if (s.query === '') return s;
  const from = s.idx >= 0 ? s.idx - 1 : hist.length - 1;
  const idx = findBackward(hist, s.query, from);
  return idx >= 0 ? { query: s.query, idx } : s;
}

// 当前命中的命令文本；未命中 → null（UI 层回退显示进入搜索前的输入行）
export function rsMatch(hist: readonly string[], s: RSearchState): string | null {
  return s.idx >= 0 ? (hist[s.idx] ?? null) : null;
}
