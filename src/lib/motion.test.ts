import { describe, it, expect } from 'vitest';
import {
  springEasing,
  springSettleTime,
  pop,
  magnify,
  genieClipPath,
  genieFrame,
  GENIE_MS,
} from './motion';

// 从 clip-path 字符串里抽 8 个百分比数值：[tl,0, tr,0, br,100, bl,100] 的 x 在偶数位
const clipXs = (clip: string) =>
  [...clip.matchAll(/([\d.]+)%/g)].map((m) => parseFloat(m[1])).filter((_, i) => i % 2 === 0);

describe('U4 springEasing 弹簧', () => {
  it('端点严格 0→1（归一化）', () => {
    const e = springEasing({ stiffness: 500, damping: 25 });
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    // 越界输入也夹住
    expect(e(-0.5)).toBe(0);
    expect(e(1.5)).toBe(1);
  });
  it('欠阻尼（500/25 配方）有 overshoot 回弹：峰值 >1 后收敛', () => {
    const e = springEasing({ stiffness: 500, damping: 25 });
    let peak = 0;
    for (let i = 0; i <= 200; i++) peak = Math.max(peak, e(i / 200));
    expect(peak).toBeGreaterThan(1.05); // 至少 5% 回弹（理论 ~12%）
    expect(peak).toBeLessThan(1.3);     // 但不至于夸张
    // 回弹后尾段收敛回 1 附近
    expect(Math.abs(e(0.98) - 1)).toBeLessThan(0.05);
  });
  it('过阻尼无 overshoot 且单调不减', () => {
    const e = springEasing({ stiffness: 500, damping: 60 }); // ζ≈1.34 > 1
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = e(i / 100);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it('springSettleTime 落在 200–600ms 手感带（500/25 ≈ 320ms）', () => {
    const s = springSettleTime({ stiffness: 500, damping: 25 });
    expect(s).toBeGreaterThan(0.2);
    expect(s).toBeLessThan(0.6);
    expect(springSettleTime({ stiffness: 500, damping: 0 })).toBe(Infinity); // 无阻尼永不稳定
  });
  it('pop 过渡：easing 是弹簧、css 把 opacity 夹回 [0,1]', () => {
    const tr = pop(null as unknown as HTMLElement, { duration: 300 });
    expect(tr.duration).toBe(300);
    let peak = 0;
    for (let i = 0; i <= 200; i++) peak = Math.max(peak, tr.easing!(i / 200));
    expect(peak).toBeGreaterThan(1.05); // 开窗有回弹
    expect(tr.css!(1.12)).toContain('opacity: 1;'); // overshoot 时透明度不越界（Svelte 5 css 单参签名）
    expect(tr.css!(0)).toContain('scale: 0.92;');
  });
});

describe('U6 magnify Dock 放大波形', () => {
  const SIGMA = 57.6; // 48px 图标 × 1.2
  it('中心最大 = 1 + maxAmp', () => {
    expect(magnify(0, SIGMA, 0.5)).toBeCloseTo(1.5);
  });
  it('远处趋近 1（无限远处等于无放大）', () => {
    // d=400 时 exp(-(400/57.6)²)≈1e-21 浮点下溢恒等于 1；取 d=200（≈1.000003）双向断言才有意义
    const far = magnify(200, SIGMA, 0.5);
    expect(far).toBeGreaterThan(1);
    expect(far).toBeLessThan(1.001);
  });
  it('左右对称', () => {
    expect(magnify(30, SIGMA, 0.5)).toBeCloseTo(magnify(-30, SIGMA, 0.5));
  });
  it('随距离单调衰减（波形连续无跳档）', () => {
    let prev = Infinity;
    for (const d of [0, 20, 40, 56, 80, 112, 200]) {
      const v = magnify(d, SIGMA, 0.5);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    // 相邻图标（中心距 56px）仍有可感知放大，第三格几乎回 1 → 波形够陡
    expect(magnify(56, SIGMA, 0.5)).toBeGreaterThan(1.1);
    expect(magnify(112, SIGMA, 0.5)).toBeLessThan(1.05);
  });
  it('非法参数回退 1（无放大、不 NaN）', () => {
    expect(magnify(10, 0, 0.5)).toBe(1);
    expect(magnify(10, -3, 0.5)).toBe(1);
    expect(magnify(10, SIGMA, 0)).toBe(1);
    expect(magnify(10, SIGMA, -1)).toBe(1);
  });
});

describe('U5 genieClipPath 神灯梯形', () => {
  it('t=0 是全矩形（不裁任何东西）', () => {
    expect(genieClipPath(0.5, 0)).toBe('polygon(0.00% 0%, 100.00% 0%, 100.00% 100%, 0.00% 100%)');
  });
  it('t=1 底边收成指向目标的尖、顶边留 ~14% 塞子对准目标', () => {
    const [tl, tr, br, bl] = clipXs(genieClipPath(0.3, 1));
    expect(bl).toBeCloseTo(30); // 底左 = 目标
    expect(br).toBeCloseTo(30); // 底右 = 目标 → 尖
    expect(tr - tl).toBeCloseTo(14, 0); // 顶边留 14% 宽
    expect((tl + tr) / 2).toBeCloseTo(30, 0); // 塞子中心对准目标
  });
  it('中点呈漏斗：顶边比底边宽、底角已先捏（t^0.6）', () => {
    const [tl, tr, br, bl] = clipXs(genieClipPath(0.5, 0.5));
    const topW = tr - tl;
    const botW = br - bl;
    expect(topW).toBeGreaterThan(botW); // 上宽下窄 = 漏斗
    expect(botW).toBeLessThan(60);      // 底已明显收拢（pinch 0.5^0.6≈0.66 → 底宽≈34%）
    expect(botW).toBeGreaterThan(0);
  });
  it('居中目标任意帧左右对称', () => {
    for (const t of [0.2, 0.5, 0.8]) {
      const [tl, tr, br, bl] = clipXs(genieClipPath(0.5, t));
      expect(tl + tr).toBeCloseTo(100);
      expect(bl + br).toBeCloseTo(100);
    }
  });
  it('底角随 t 单调收拢（吸入方向不反复）', () => {
    let prevW = Infinity;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const [tl, tr, br, bl] = clipXs(genieClipPath(0.4, t));
      const w = br - bl;
      expect(w).toBeLessThanOrEqual(prevW + 1e-9);
      prevW = w;
    }
  });
});

describe('U5 genieFrame 吸入姿态', () => {
  const win = { x: 100, y: 100, w: 400, h: 300 };
  const target = { x: 500, y: 700 };
  it('t=0 恒等：不动、不缩、不透明、clip 全矩形', () => {
    const f = genieFrame(win, target, 0);
    expect(f.dx).toBe(0);
    expect(f.dy).toBe(0);
    expect(f.scale).toBe(1);
    expect(f.opacity).toBe(1);
    expect(f.clip).toBe('polygon(0.00% 0%, 100.00% 0%, 100.00% 100%, 0.00% 100%)');
  });
  it('t=1 窗口中心精确落在 Dock 目标上、收小、全透明（交接最小化态无跳变）', () => {
    const f = genieFrame(win, target, 1);
    expect(win.x + win.w / 2 + f.dx).toBeCloseTo(target.x);
    expect(win.y + win.h / 2 + f.dy).toBeCloseTo(target.y);
    expect(f.scale).toBeLessThan(0.2);
    expect(f.opacity).toBe(0);
  });
  it('目标在窗口外（Dock 在下方）时 clip 目标位置被夹进 [0,1]', () => {
    const f = genieFrame({ x: 0, y: 0, w: 100, h: 100 }, { x: 500, y: 800 }, 1);
    const [tl, tr, br, bl] = clipXs(f.clip);
    for (const v of [tl, tr, br, bl]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
  it('神灯总时长 = 500ms（参考配方）', () => {
    expect(GENIE_MS).toBe(500);
  });
});
