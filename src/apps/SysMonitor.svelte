<script lang="ts">
  import { processes, restore, minimize, close, activeId } from '../kernel/processes.svelte';
  import { klog, type LogLevel } from '../kernel/log.svelte';
  import { vfs, TRASH } from '../kernel/vfs.svelte';
  import { appMeta } from './appList';
  import { userApps, getUserApp } from './userApps.svelte';

  // ⚠️ 不能 import registry/desktopApps（registry 会 import 本组件 → 成环）。
  // 图标改用纯数据的 appMeta + userApps，二者都不 import registry。
  let tab = $state<'proc' | 'log' | 'info'>('proc');

  // 秒级心跳：驱动「运行时长」与存储统计刷新
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const active = $derived(activeId());

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
  function storageKB(): string {
    void now; // 每秒重算
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('qz.')) bytes += k.length + (localStorage.getItem(k)?.length ?? 0);
    }
    return (bytes / 1024).toFixed(1);
  }

  // 日志自动滚到底
  let logScroller = $state<HTMLElement>();
  $effect(() => {
    klog.entries.length;
    if (logScroller && tab === 'log') logScroller.scrollTop = logScroller.scrollHeight;
  });
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 标签页 -->
  <div class="flex shrink-0 gap-1 border-b border-qz-border px-2 py-1.5 text-xs">
    {#each [['proc', '进程'], ['log', '日志'], ['info', '概况']] as [key, label] (key)}
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
        <span class="flex-1">进程</span>
        <span class="w-12">状态</span>
        <span class="w-14 text-right">运行</span>
        <span class="w-24"></span>
      </div>
      {#each processes as p (p.id)}
        {@const st = stateOf(p)}
        <div class="flex items-center gap-2 border-b border-qz-border/50 px-3 py-1.5 text-xs hover:bg-qz-elevated/50">
          <span class="w-10 tabular-nums text-qz-muted">{p.pid}</span>
          <span class="flex min-w-0 flex-1 items-center gap-1.5">
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
        <div class="grid place-items-center py-12 text-sm text-qz-muted">没有运行中的进程</div>
      {/if}
    </div>
  {:else if tab === 'log'}
    <div bind:this={logScroller} class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
      {#each klog.entries as e (e.seq)}
        <div class="flex gap-2">
          <span class="shrink-0 text-qz-muted/70 tabular-nums">{fmtTime(e.ts)}</span>
          <span class="shrink-0 text-qz-muted">[{e.source}]</span>
          <span class={levelCls[e.level]}>{e.msg}</span>
        </div>
      {/each}
      {#if klog.entries.length === 0}
        <div class="grid place-items-center py-12 text-sm text-qz-muted">暂无日志</div>
      {/if}
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-auto p-3">
      <div class="grid grid-cols-2 gap-2 text-sm">
        {#each [['进程', `${stats.proc}（${stats.running} 运行 / ${stats.suspended} 挂起）`], ['文件', `${stats.files}`], ['文件夹', `${stats.dirs}`], ['回收站', `${stats.trashed}`], ['已装 App', `${stats.apps}`], ['日志条数', `${stats.logs}`], ['localStorage', `${storageKB()} KB`]] as [k, v] (k)}
          <div class="rounded-qz bg-qz-surface px-3 py-2">
            <div class="text-[11px] text-qz-muted">{k}</div>
            <div class="mt-0.5 tabular-nums">{v}</div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
