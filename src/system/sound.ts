import { persisted } from '../kernel/persist.svelte';
import { dnd } from './dnd.svelte';

// ───────────────────────────────────────────────────────────
// 系统音效 · WebAudio 合成（无需音频文件）
// 每种音效 = 一串「音符(频率, 时长)」，用振荡器 + 增益包络当场合成。
// 默认关闭（opt-in，避免烦扰）；开了之后由 soundd 服务订阅总线事件触发（见 system/services.ts）。
// 音频失败/不支持一律静默忽略，绝不炸穿上层。
// ───────────────────────────────────────────────────────────
export const soundPrefs = persisted<{ enabled: boolean; volume: number }>('qz.sound', {
  enabled: false,
  volume: 0.3,
});

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    }
    return ctx;
  } catch {
    return null;
  }
}

interface Tone {
  freq: number;
  dur: number;
  type?: OscillatorType;
}
const SOUNDS: Record<string, Tone[]> = {
  open: [{ freq: 523, dur: 0.08 }, { freq: 784, dur: 0.1 }], // 上行：开窗
  close: [{ freq: 440, dur: 0.08 }, { freq: 294, dur: 0.1 }], // 下行：关窗
  notify: [{ freq: 660, dur: 0.09 }, { freq: 880, dur: 0.09 }], // 叮咚：通知
  error: [{ freq: 311, dur: 0.16, type: 'square' }], // 低沉方波：错误/拒绝
  trash: [{ freq: 392, dur: 0.06 }, { freq: 196, dur: 0.12 }], // 下坠：删除
};

export function playSound(kind: string): void {
  if (!soundPrefs.enabled || dnd.enabled) return; // 关闭 或 勿扰 → 彻底不发声（也不创建上下文）
  const tones = SOUNDS[kind];
  if (!tones) return;
  const a = audio();
  if (!a) return;
  try {
    if (a.state === 'suspended') void a.resume(); // 用户手势后恢复
    const vol = Math.max(0, Math.min(1, soundPrefs.volume));
    let t = a.currentTime;
    for (const tone of tones) {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = tone.type ?? 'sine';
      osc.frequency.value = tone.freq;
      // 增益包络：快起 + 指数衰减（避免爆音）
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(vol * 0.25, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur);
      osc.connect(gain).connect(a.destination);
      osc.start(t);
      osc.stop(t + tone.dur);
      t += tone.dur * 0.9; // 音符略叠
    }
  } catch {
    /* 音频失败：静默忽略 */
  }
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzSound: unknown }).__qzSound = { playSound, soundPrefs, SOUNDS };
}
