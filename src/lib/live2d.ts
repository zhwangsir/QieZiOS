// ───────────────────────────────────────────────────────────
// Live2D 渲染装配（被 Companion.svelte 动态 import → 单独 chunk，首屏不背 PixiJS）
// 链路：注入 Cubism Core（专有运行时，不能 npm 装）→ 懒加载 PixiJS + pixi-live2d-display
//      → new Application(canvas) → Live2DModel.from(url) → 摆正缩放。
// ⚠️ WebGL 渲染无法在无头预览里验证，得在真浏览器看。
// ───────────────────────────────────────────────────────────

// Cubism 4/5 Core（官方 CDN）。Cubism 2 老模型需要另一个 runtime，这里先支持 Cubism 3/4。
const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';

let corePromise: Promise<void> | null = null;
export function loadCubismCore(): Promise<void> {
  if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) return Promise.resolve();
  if (!corePromise) {
    corePromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CORE_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Live2D Cubism Core 加载失败（CDN 不通？）'));
      document.head.appendChild(s);
    });
  }
  return corePromise;
}

export interface Pet {
  destroy(): void;
  react(): void; // 触发一个随机动作（AI 回应时让桌宠动一下）
  expression(): void; // 切一个随机表情（回应完表达情绪）
  setMouth(open: number): void; // 设嘴张开度 0..1（说话时做简单口型）
}

export async function createPet(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  modelUrl: string,
): Promise<Pet> {
  await loadCubismCore();
  const PIXI = await import('pixi.js');
  // 先把 PIXI 挂全局，再加载 live2d-display → 它在 import 时就能注册 Pixi 插件（交互/ticker）。
  (window as unknown as { PIXI: unknown }).PIXI = PIXI;
  // 用 cubism4 专用入口：只含 Cubism 3/4 运行时，不会要求 Cubism 2 的 live2d.min.js。
  const { Live2DModel } = await import('pixi-live2d-display/cubism4');
  Live2DModel.registerTicker(PIXI.Ticker);

  const app = new PIXI.Application({
    view: canvas,
    backgroundAlpha: 0, // 透明背景，融进窗口
    resizeTo: container,
    antialias: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: any = await Live2DModel.from(modelUrl);
  app.stage.addChild(model);

  const fit = () => {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 400;
    model.anchor?.set?.(0.5, 0.5);
    const s = Math.min(w / model.width, h / model.height) * 0.9;
    model.scale.set(s);
    model.position.set(w / 2, h / 2);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(container);

  return {
    destroy() {
      ro.disconnect();
      try {
        // removeView=false：canvas 由 Svelte 管，别让 Pixi 摘掉它
        app.destroy(false, { children: true, texture: true, baseTexture: true });
      } catch {
        /* ignore */
      }
    },
    react() {
      try {
        // 随机播一个动作组（模型没动作就静默忽略）
        model.internalModel?.motionManager?.startRandomMotion?.();
      } catch {
        /* ignore */
      }
    },
    expression() {
      try {
        model.expression?.(); // 不传名字 = 随机表情（模型没表情就忽略）
      } catch {
        /* ignore */
      }
    },
    setMouth(open: number) {
      try {
        const v = Math.max(0, Math.min(1, open));
        model.internalModel?.coreModel?.setParameterValueById?.('ParamMouthOpenY', v);
      } catch {
        /* ignore */
      }
    },
  };
}
