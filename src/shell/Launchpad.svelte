<script lang="ts">
  import { launchpad, closeLaunchpad } from './launchpadState.svelte';
  import { visibleAppDefs, launchAppDef } from '../apps/desktopApps.svelte';
  import { type AppDef } from '../apps/registry';

  let q = $state('');
  // 全部可见 App（内置非 hidden + 已装用户 App，与 Dock 同源），按名字即时过滤
  const apps = $derived(
    visibleAppDefs().filter((a) => !q.trim() || a.title.toLowerCase().includes(q.trim().toLowerCase())),
  );

  // 每次打开重置搜索
  $effect(() => {
    if (launchpad.open) q = '';
  });

  function launch(a: AppDef) {
    launchAppDef(a);
    closeLaunchpad();
  }
</script>

{#if launchpad.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10001] flex flex-col items-center gap-6 bg-black/40 px-6 pt-[12vh] backdrop-blur-xl"
    onpointerdown={closeLaunchpad}
  >
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="w-[min(420px,80vw)] rounded-full border border-white/15 bg-white/10 px-4 py-2 text-center text-sm text-white outline-none placeholder:text-white/50"
      placeholder="搜索 App…"
      bind:value={q}
      autofocus
      onpointerdown={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') closeLaunchpad();
        else if (e.key === 'Enter' && apps.length) launch(apps[0]);
      }}
    />
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="grid w-[min(840px,94vw)] grid-cols-[repeat(auto-fill,minmax(96px,1fr))] content-start gap-3 overflow-auto pb-8"
      onpointerdown={(e) => e.stopPropagation()}
    >
      {#each apps as a (a.id)}
        <button
          class="flex flex-col items-center gap-2 rounded-2xl p-3 transition-colors hover:bg-white/10"
          onclick={() => launch(a)}
        >
          <span class="text-5xl drop-shadow">{a.icon}</span>
          <span class="line-clamp-2 text-center text-xs text-white/90">{a.title}</span>
        </button>
      {/each}
      {#if apps.length === 0}
        <div class="col-span-full grid place-items-center py-10 text-sm text-white/60">没有匹配的 App</div>
      {/if}
    </div>
  </div>
{/if}
