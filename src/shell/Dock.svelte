<script lang="ts">
  import { processes, launch, restore } from '../kernel/processes.svelte';
  import { appRegistry, type AppDef } from '../apps/registry';

  // $derived：当前有进程在跑的 appId 集合（用来显示小圆点指示器）
  const running = $derived(new Set(processes.map((p) => p.appId)));

  function onClick(appId: string, app: AppDef) {
    const mine = processes.filter((p) => p.appId === appId);
    if (mine.length === 0) {
      launch(appId, app.title, { width: app.width, height: app.height });
      return;
    }
    // 已在跑：把最上层那个还原 + 聚焦（含从最小化恢复）
    const top = mine.reduce((a, b) => (a.z >= b.z ? a : b));
    restore(top.id);
  }
</script>

<div
  class="absolute bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-end gap-2 rounded-2xl border border-qz-border qz-glass px-3 py-2 shadow-2xl shadow-black/40"
>
  {#each Object.entries(appRegistry) as [appId, app] (appId)}
    <button
      class="group relative grid h-12 w-12 place-items-center rounded-xl text-2xl transition-transform duration-150 hover:-translate-y-1.5 active:translate-y-0"
      title={app.title}
      onclick={() => onClick(appId, app)}
    >
      <span class="transition-transform group-hover:scale-110">{app.icon}</span>
      {#if running.has(appId)}
        <span class="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-qz-text/70"></span>
      {/if}
    </button>
  {/each}
</div>
