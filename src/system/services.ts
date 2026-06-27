import { registerService } from '../kernel/services.svelte';
import { on, emit } from '../kernel/bus.svelte';
import { pushNote, type NoteLevel } from './notifications.svelte';
import { pushClip } from './clipboard.svelte';
import { schedules, removeSchedule, runScheduled, type Schedule } from './schedules.svelte';

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

// 定时器：常驻服务，给每个日程武装计时器，到点经总线发 notify。
// 开机时重新武装所有持久化的日程（一次性的过期就立刻补发），并订阅运行时的 add/cancel。
registerService({
  id: 'schedd',
  name: '定时器',
  after: ['notifyd'], // 定时器到点要经 notifyd 弹通知 → 让 notifyd 先起（演示依赖排序）
  start() {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const fire = (s: Schedule) => {
      // 有 command（at/crontab）→ 经注入的运行器跑 shell，到点用通知回报结果；否则只是提醒。
      if (s.command) {
        void runScheduled(s.command)
          .then((res) => {
            const tail = (res.out || res.err || '').trim().split('\n').pop()?.slice(0, 60) ?? '';
            emit('notify', {
              title: `⏰ ${s.title || s.command}`,
              body: tail || '已执行',
              level: res.code === 0 ? 'success' : 'warn',
            });
          })
          .catch(() => emit('notify', { title: `⏰ ${s.command}`, body: '执行出错', level: 'warn' }));
        return;
      }
      emit('notify', { title: s.title || '提醒', body: s.body, level: 'info' });
    };
    const arm = (s: Schedule, boot = false) => {
      if (timers.has(s.id)) return;
      if (s.every && s.every > 0) {
        timers.set(s.id, setInterval(() => fire(s), Math.max(1000, s.every)));
      } else if (s.fireAt) {
        // 开机重新武装时，过期的「命令型」一次性任务只移除不执行 —— 否则刷新/隔天打开系统会
        // 把早该跑的 `at <命令>` 立刻重跑（可能是 rm 等破坏性副作用，用户已不在预期场景）。
        // 对命令取保守策略（过期不补）；提醒型仍照常补发一次通知（非破坏性、提示「你错过了」有用）。
        if (boot && s.command && s.fireAt <= Date.now()) {
          emit('notify', { title: '⏰ 跳过已过期命令', body: s.command, level: 'warn' });
          removeSchedule(s.id);
          return;
        }
        const delay = Math.max(0, Math.min(s.fireAt - Date.now(), 2_000_000_000)); // setTimeout 上限
        timers.set(
          s.id,
          setTimeout(() => {
            fire(s);
            timers.delete(s.id);
            removeSchedule(s.id);
          }, delay),
        );
      }
    };
    const disarm = (id: string) => {
      const t = timers.get(id);
      if (t !== undefined) {
        clearTimeout(t);
        clearInterval(t);
        timers.delete(id);
      }
    };
    // 开机重新武装（boot=true）：迭代副本——过期命令型会同步 removeSchedule、改原数组会漏项。
    for (const s of [...schedules.items]) arm(s, true);
    const offs = [
      on('sched.add', (p) => arm(p as Schedule)), // 运行时新增 boot=false：用户当下显式加的（即便 +0s）照常执行

      on('sched.cancel', (p) => disarm((p as { id: string }).id)),
    ];
    return () => {
      for (const id of [...timers.keys()]) disarm(id);
      offs.forEach((o) => o());
    };
  },
});
