import { registerService } from '../kernel/services.svelte';
import { on } from '../kernel/bus.svelte';
import { pushNote, type NoteLevel } from './notifications.svelte';
import { pushClip } from './clipboard.svelte';

// ───────────────────────────────────────────────────────────
// 系统自带服务的注册处（import 本模块即登记；App 在开机时 startServices()）。
// ───────────────────────────────────────────────────────────

// 通知中心：一个常驻服务，订阅总线 → 把事件变成系统 toast。
// 演示「服务消费总线事件、驱动真实 UI」，不只是记日志。
registerService({
  id: 'notifyd',
  name: '通知中心',
  start() {
    const offs = [
      // 任何地方 emit('notify', {...}) 或 sys.notify(...) → 弹一条
      on('notify', (p) => {
        const n = (p ?? {}) as { title?: string; body?: string; level?: NoteLevel; timeout?: number };
        pushNote({ title: n.title ?? '通知', body: n.body, level: n.level, timeout: n.timeout });
      }),
      // 安全可见性：App 调用未声明能力被拒 → 弹警告（总线驱动真实行为）
      on('app.denied', (p) => {
        const tool = (p as { tool?: string })?.tool ?? '?';
        pushNote({ title: '能力被拒绝', body: `App 调用了未声明的「${tool}」`, level: 'warn' });
      }),
    ];
    return () => offs.forEach((off) => off());
  },
});

// 剪贴板：常驻服务，订阅 clip.copy → 维护剪贴板历史（像个剪贴板管理器守护进程）。
registerService({
  id: 'clipd',
  name: '剪贴板',
  start() {
    return on('clip.copy', (p) => pushClip((p as { text?: string })?.text ?? ''));
  },
});
