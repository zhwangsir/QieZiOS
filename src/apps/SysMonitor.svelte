<script lang="ts">
  import { processes, restore, minimize, close, activeId } from '../kernel/processes.svelte';
  import { klog, type LogLevel } from '../kernel/log.svelte';
  import { eventLog } from '../kernel/bus.svelte';
  import { services, restartService, startService, enableService, disableService, listServices } from '../kernel/services.svelte';
  import { vfs, TRASH } from '../kernel/vfs.svelte';
  import { idbEntries } from '../kernel/idbStore';
  import { windowVisible } from '../lib/winctx';
  import { appMeta } from './appList';
  import { userApps, getUserApp } from './userApps.svelte';

  // ⚠️ 不能 import registry/desktopApps（registry 会 import 本组件 → 成环）。
  // 图标改用纯数据的 appMeta + userApps，二者都不 import registry。
  let tab = $state<'proc' | 'log' | 'evt' | 'info'>('proc');

  // 秒级心跳：驱动「运行时长」与存储统计刷新；最小化时暂停
  let now = $state(Date.now());
  const visible = windowVisible();
  $effect(() => {
    if (!visible()) return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const active = $derived(activeId());

  // 全部后台服务（含禁用/停止的）。listServices 内部读 services.running + 禁用清单 → 响应式。
  const svcList = $derived(listServices());

  // 进程树：以 init(0) 为根按父子排序，带 depth 缩进。子进程紧跟父进程。
  const procTree = $derived.by(() => {
    const out: { p: (typeof processes)[number]; depth: number }[] = [];
    const visit = (ppid: number, depth: number) => {
      for (const p of processes)
        if ((p.ppid ?? 0) === ppid) {
          out.push({ p, depth });
          visit(p.pid, depth + 1);
        }
    };
    visit(0, 0);
    // 兜底：父已不存在的孤儿（理论上不会，重启已重挂到 0）也收进来
    for (const p of processes) if (!out.some((o) => o.p.id === p.id)) out.push({ p, depth: 0 });
    return out;
  });

  function iconFor(appId: string): string {
    return appMeta[appId]?.icon ?? getUserApp(appId)?.icon ?? '▫';
  }
  function stateOf(p: { id: string; minimized: boolean }): { label: string; cls: string } {
    if (p.minimized) return { label: '挂起', cls: 'text-amber-400' };
    if (active === p.id) return { label: '活动', cls: 'text-qz-accent' };
    return { label: '运行', cls: 'text-emerald-400' };
  }
  function fmtUptime(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h${m % 60}m`;
  }
  function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  const levelCls: Record<LogLevel, string> = {
    info: 'text-qz-muted',
    warn: 'text-amber-400',
    error: 'text-red-400',
  };

  // 概况统计（计数从响应式状态来，自动更新；存储大小绑 now 每秒刷）
  const stats = $derived.by(() => {
    const nodes = Object.values(vfs.nodes);
    const files = nodes.filter((n) => n.id !== 'root' && n.parentId !== TRASH && n.type === 'file').length;
    const dirs = nodes.filter((n) => n.id !== 'root' && n.parentId !== TRASH && n.type === 'dir').length;
    const trashed = nodes.filter((n) => n.parentId === TRASH).length;
    const running = processes.filter((p) => !p.minimized).length;
    return {
      proc: processes.length,
      running,
      suspended: processes.length - running,
      files,
      dirs,
      trashed,
      apps: userApps.list.length,
      logs: klog.entries.length,
    };
  });
  // 存储用量：IDB qz.* 字节 + 浏览器配额估算。每秒重算整棵树太浪费 → 节流 ~5s 刷一次。
  let idbBytes = $state(0);
  let estUsage = $state(0); // navigator.storage.estimate().usage（含 IDB/blob/localStorage 全部源）
  let estQuota = $state(0); // 浏览器给本源的配额上限
  let lastIdbAt = 0;
  $effect(() => {
    void now;
    const t = Date.now();
    if (t - lastIdbAt < 5000) return;
    lastIdbAt = t;
    idbEntries().then((e) => {
      let b = 0;
      for (const [k, v] of Object.entries(e)) if (k.startsWith('qz.')) b += k.length + v.length;
      idbBytes = b;
    });
    // 真实配额估算（异步、可能不支持 → 优雅降级为 0）
    navigator.storage?.estimate?.().then((q) => {
      estUsage = q.usage ?? 0;
      estQuota = q.quota ?? 0;
    }).catch(() => {});
  });
  // 本应用自己的 qz.* 字节（localStorage 同步 + IDB 节流值）
  const qzBytes = $derived.by(() => {
    void now;
    let bytes = idbBytes;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('qz.')) bytes += k.length + (localStorage.getItem(k)?.length ?? 0);
    }
    return bytes;
  });
  const usedPct = $derived(estQuota > 0 ? Math.min(100, (estUsage / estQuota) * 100) : 0);
  function fmtBytes(n: number): string {
    if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }

  // 日志自动滚到底
  let logScroller = $state<HTMLElement>();
  $effect(() => {
    klog.entries.length;
    if (logScroller && tab === 'log') logScroller.scrollTop = logScroller.scrollHeight;
  });
  // 事件流自动滚到底
  let evtScroller = $state<HTMLElement>();
  $effect(() => {
    eventLog.items.length;
    if (evtScroller && tab === 'evt') evtScroller.scrollTop = evtScroller.scrollHeight;
  });
  function payloadStr(p: unknown): string {
    if (p == null) return '';
    try {
      return JSON.stringify(p);
    } catch {
      return String(p);
    }
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 标签页 -->
  <div class="flex shrink-0 gap-1 border-b border-qz-border px-2 py-1.5 text-xs">
    {#each [['proc', '进程'], ['log', '日志'], ['evt', '事件'], ['info', '概况']] as [key, label] (key)}
      <button
        class="rounded-md px-3 py-1 transition-colors"
        class:bg-qz-elevated={tab === key}
        class:text-qz-muted={tab !== key}
        onclick={() => (tab = key as typeof tab)}>{label}</button>
    {/each}
  </div>

  {#if tab === 'proc'}
    <div class="min-h-0 flex-1 overflow-auto">
      <!-- 表头 -->
      <div class="sticky top-0 flex items-center gap-2 border-b border-qz-border bg-qz-surface/80 px-3 py-1.5 text-[11px] text-qz-muted backdrop-blur">
        <span class="w-10">PID</span>
        <span class="w-10">PPID</span>
        <span class="flex-1">进程（树）</span>
        <span class="w-12">状态</span>
        <span class="w-14 text-right">运行</span>
        <span class="w-24"></span>
      </div>
      {#each procTree as { p, depth } (p.id)}
        {@const st = stateOf(p)}
        <div class="flex items-center gap-2 border-b border-qz-border/50 px-3 py-1.5 text-xs hover:bg-qz-elevated/50">
          <span class="w-10 tabular-nums text-qz-muted">{p.pid}</span>
          <span class="w-10 tabular-nums text-qz-muted">{p.ppid ?? 0}</span>
          <span class="flex min-w-0 flex-1 items-center gap-1.5" style="padding-left: {depth * 14}px">
            {#if depth > 0}<span class="text-qz-muted/60">└</span>{/if}
            <span>{iconFor(p.appId)}</span>
            <span class="truncate" title={p.title}>{p.title}</span>
          </span>
          <span class="w-12 {st.cls}">{st.label}</span>
          <span class="w-14 text-right tabular-nums text-qz-muted">{fmtUptime(now - p.startedAt)}</span>
          <span class="flex w-24 justify-end gap-1">
            <button class="rounded px-1.5 py-0.5 text-[10px] hover:bg-qz-surface" title="聚焦" onclick={() => restore(p.id)}>聚焦</button>
            <button class="rounded px-1.5 py-0.5 text-[10px] hover:bg-qz-surface" title="挂起" onclick={() => minimize(p.id)}>挂起</button>
            <button class="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-qz-surface" title="结束" onclick={() => close(p.id)}>结束</button>
          </span>
        </div>
      {/each}
      {#if processes.length === 0}
        <div class="px-3 py-6 text-center text-sm text-qz-muted">没有窗口进程</div>
      {/if}

      <!-- 后台服务：无窗口常驻进程（init / systemctl）。列全部已注册服务含禁用 -->
      <div class="mt-2 border-t border-qz-border px-3 py-1.5 text-[11px] text-qz-muted">后台服务（init / systemctl）</div>
      {#each svcList as s (s.id)}
        {@const color =
          s.status === 'running'
            ? 'text-emerald-400'
            : s.status === 'crashed'
              ? 'text-red-400'
              : s.status === 'disabled'
                ? 'text-amber-400'
                : 'text-qz-muted'}
        {@const label = s.status === 'running' ? '运行' : s.status === 'crashed' ? '崩溃' : s.status === 'disabled' ? '禁用' : '停止'}
        <div class="flex items-center gap-2 border-b border-qz-border/50 px-3 py-1.5 text-xs hover:bg-qz-elevated/50">
          <span class="w-10 text-qz-muted">⚙</span>
          <span
            class="flex min-w-0 flex-1 items-center gap-1 truncate"
            title={s.after.length || s.requires.length ? `after:${s.after.join(',') || '-'} requires:${s.requires.join(',') || '-'}` : ''}
          >
            {s.name}
            {#if s.restarts > 0}<span class="rounded bg-qz-surface px-1 text-[9px] text-amber-400">↻{s.restarts}</span>{/if}
          </span>
          <span class="w-12 {color}">{label}</span>
          <span class="w-14 text-right tabular-nums text-qz-muted">{s.status === 'running' && s.startedAt ? fmtUptime(now - s.startedAt) : '—'}</span>
          <span class="flex w-28 justify-end gap-1">
            {#if s.status === 'disabled'}
              <button class="rounded px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-qz-surface" title="启用并启动" onclick={() => { enableService(s.id); startService(s.id); }}>启用</button>
            {:else}
              {#if s.status === 'running'}
                <button class="rounded px-1.5 py-0.5 text-[10px] hover:bg-qz-surface" onclick={() => restartService(s.id)}>重启</button>
              {:else}
                <button class="rounded px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-qz-surface" onclick={() => startService(s.id)}>启动</button>
              {/if}
              <button class="rounded px-1.5 py-0.5 text-[10px] text-amber-400 hover:bg-qz-surface" title="禁用并停止" onclick={() => disableService(s.id)}>禁用</button>
            {/if}
          </span>
        </div>
      {/each}
      {#if svcList.length === 0}
        <div class="px-3 py-3 text-center text-[11px] text-qz-muted">无服务</div>
      {/if}
    </div>
  {:else if tab === 'log'}
    <div bind:this={logScroller} class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
      {#each klog.entries as e (e.seq)}
        <div class="qz-cv-row flex gap-2">
          <span class="shrink-0 text-qz-muted/70 tabular-nums">{fmtTime(e.ts)}</span>
          <span class="shrink-0 text-qz-muted">[{e.source}]</span>
          <span class={levelCls[e.level]}>{e.msg}</span>
        </div>
      {/each}
      {#if klog.entries.length === 0}
        <div class="grid place-items-center py-12 text-sm text-qz-muted">暂无日志</div>
      {/if}
    </div>
  {:else if tab === 'evt'}
    <div bind:this={evtScroller} class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
      {#each eventLog.items as e (e.seq)}
        <div class="qz-cv-row flex gap-2">
          <span class="shrink-0 text-qz-muted/70 tabular-nums">{fmtTime(e.ts)}</span>
          <span class="shrink-0 text-qz-accent">{e.event}</span>
          <span class="truncate text-qz-muted">{payloadStr(e.payload)}</span>
        </div>
      {/each}
      {#if eventLog.items.length === 0}
        <div class="grid place-items-center py-12 text-sm text-qz-muted">暂无事件</div>
      {/if}
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-auto p-3">
      <!-- 存储用量仪表盘：浏览器配额估算（含 IDB/blob/localStorage 全部源）+ 本应用 qz.* 占用 -->
      <div class="mb-3 rounded-qz bg-qz-surface px-3 py-2.5">
        <div class="flex items-baseline justify-between text-[11px] text-qz-muted">
          <span>存储用量{estQuota > 0 ? '' : '（浏览器未提供配额估算）'}</span>
          <span class="tabular-nums">
            {#if estQuota > 0}{fmtBytes(estUsage)} / {fmtBytes(estQuota)}（{usedPct.toFixed(1)}%）{:else}{fmtBytes(estUsage)}{/if}
          </span>
        </div>
        <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-qz-elevated">
          <div
            class="h-full rounded-full transition-[width] duration-500"
            style="width: {usedPct}%; background: {usedPct > 90 ? '#ef4444' : usedPct > 70 ? '#f59e0b' : 'var(--color-qz-accent)'};"
          ></div>
        </div>
        <div class="mt-1.5 text-[11px] text-qz-muted">
          QieZiOS 数据（qz.*，含 VFS 已迁 IndexedDB）：<span class="tabular-nums text-qz-text">{fmtBytes(qzBytes)}</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 text-sm">
        {#each [['进程', `${stats.proc}（${stats.running} 运行 / ${stats.suspended} 挂起）`], ['后台服务', `${services.running.length}`], ['文件', `${stats.files}`], ['文件夹', `${stats.dirs}`], ['回收站', `${stats.trashed}`], ['已装 App', `${stats.apps}`], ['日志条数', `${stats.logs}`], ['QieZiOS 数据', fmtBytes(qzBytes)]] as [k, v] (k)}
          <div class="rounded-qz bg-qz-surface px-3 py-2">
            <div class="text-[11px] text-qz-muted">{k}</div>
            <div class="mt-0.5 tabular-nums">{v}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
