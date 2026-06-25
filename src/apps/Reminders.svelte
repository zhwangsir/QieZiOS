<script lang="ts">
  import { schedules } from '../system/schedules.svelte';
  import { sys } from '../system/sys';

  let title = $state('');
  let secs = $state(10);
  let recurring = $state(false);

  // 秒级心跳，让倒计时实时刷新
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  function add() {
    const t = title.trim() || '提醒';
    const ms = Math.max(1, Math.round(secs)) * 1000;
    sys.schedule.add(recurring ? { title: t, every: ms } : { title: t, in: ms });
    sys.notify('已设定提醒', { body: `${t} · ${recurring ? '每隔 ' : ''}${secs}s`, level: 'success', timeout: 1500 });
    title = '';
  }

  function fmtWhen(s: { every?: number; fireAt?: number }): string {
    if (s.every) return `每 ${Math.round(s.every / 1000)}s`;
    if (s.fireAt) {
      const r = Math.round((s.fireAt - now) / 1000);
      return r > 0 ? `${r}s 后` : '即将…';
    }
    return '';
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <div class="flex shrink-0 flex-col gap-2 border-b border-qz-border p-3">
    <input
      class="w-full rounded-qz bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="提醒内容"
      bind:value={title}
      onkeydown={(e) => {
        if (e.key === 'Enter') add();
      }}
    />
    <div class="flex items-center gap-2 text-xs">
      <input
        type="number"
        min="1"
        max="86400"
        class="w-20 rounded-qz bg-qz-surface px-2 py-1 text-right outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        bind:value={secs}
      />
      <span class="text-qz-muted">秒</span>
      <label class="flex items-center gap-1 text-qz-muted">
        <input type="checkbox" bind:checked={recurring} class="accent-qz-accent" /> 循环
      </label>
      <button
        class="ml-auto rounded-qz bg-qz-accent px-3 py-1 font-medium text-qz-accent-contrast active:scale-95"
        onclick={add}>添加</button>
    </div>
  </div>

  {#if schedules.items.length === 0}
    <div class="grid flex-1 place-items-center px-6 text-center text-sm text-qz-muted">
      <div><div class="mb-2 text-4xl">⏰</div>还没有提醒。到点会弹系统通知（由定时器服务 schedd 触发）。</div>
    </div>
  {:else}
    <div class="flex-1 overflow-auto p-2">
      {#each schedules.items as s (s.id)}
        <div class="mb-1.5 flex items-center gap-2 rounded-qz bg-qz-surface px-3 py-2 text-sm">
          <span class="min-w-0 flex-1 truncate">{s.title}</span>
          <span class="shrink-0 text-[11px] tabular-nums text-qz-muted">{fmtWhen(s)}</span>
          <button
            class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-qz-elevated"
            onclick={() => sys.schedule.cancel(s.id)}>取消</button>
        </div>
      {/each}
    </div>
  {/if}
</div>
