import { cubicOut } from 'svelte/easing';

// 窗口开/关动画（Svelte 自定义过渡）。
// 只动 opacity 和【独立的 scale 属性】——注意不是 transform: scale()，
// 因为窗口定位已经占用了 transform: translate()，两者用同一属性会打架。
// scale / translate / rotate 是各自独立的 CSS 属性，能和 transform 叠加，且都走 GPU 合成器。
export function pop(_node: HTMLElement, { duration = 190 }: { duration?: number } = {}) {
  return {
    duration,
    easing: cubicOut,
    // t: 0→1（进入）或 1→0（离开），Svelte 已用 easing 处理过
    css: (t: number) => `opacity: ${t}; scale: ${0.92 + 0.08 * t};`,
  };
}
