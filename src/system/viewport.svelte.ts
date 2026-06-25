// 响应式视口：窄屏（手机）进「移动模式」——窗口铺满、禁拖拽、Dock 可横滚。
// 模块级 $state + matchMedia 监听，全局共享一份。
export const viewport = $state<{ isMobile: boolean; reducedMotion: boolean }>({
  isMobile: false,
  reducedMotion: false,
});

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(max-width: 640px)');
  viewport.isMobile = mq.matches;
  mq.addEventListener('change', (e) => (viewport.isMobile = e.matches));

  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  viewport.reducedMotion = rm.matches;
  rm.addEventListener('change', (e) => (viewport.reducedMotion = e.matches));
}
