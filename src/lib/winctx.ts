import { getContext, setContext } from 'svelte';

// 窗口可见性上下文：Window 把「是否最小化」往下传，窗口内的 App 可据此暂停后台工作
// （定时器等），避免最小化的窗口白白每秒 tick。无窗口上下文（少见）默认当可见。
const KEY = Symbol('qzwin');
interface WinCtx {
  minimized: () => boolean;
}

export function provideWindow(minimized: () => boolean): void {
  setContext<WinCtx>(KEY, { minimized });
}

// 返回 visible() getter：在 $effect 里调用会随最小化状态变化而重跑。
export function windowVisible(): () => boolean {
  const ctx = getContext<WinCtx | undefined>(KEY);
  return () => !(ctx?.minimized() ?? false);
}
