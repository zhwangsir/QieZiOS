<script lang="ts">
  import { spotlight, closeSpotlight } from './spotlightState.svelte';
  import { appRegistry } from '../apps/registry';
  import { vfs, type VNode } from '../kernel/vfs.svelte';
  import { launch } from '../kernel/processes.svelte';

  type Result =
    | { kind: 'app'; id: string; title: string; icon: string }
    | { kind: 'file'; node: VNode; icon: string };

  let query = $state('');
  let selected = $state(0);

  // 打开时重置查询与选中项
  $effect(() => {
    if (spotlight.open) {
      query = '';
      selected = 0;
    }
  });

  const results = $derived.by<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const apps: Result[] = Object.entries(appRegistry)
      .filter(([, a]) => !a.hidden)
      .filter(([, a]) => !q || a.title.toLowerCase().includes(q))
      .map(([id, a]) => ({ kind: 'app', id, title: a.title, icon: a.icon }));
    const files: Result[] = q
      ? Object.values(vfs.nodes)
          .filter((n) => n.id !== 'root' && n.parentId !== 'trash' && n.name.toLowerCase().includes(q))
          .slice(0, 6)
          .map((n) => ({ kind: 'file', node: n, icon: n.type === 'dir' ? '📁' : '📄' }))
      : [];
    return [...apps, ...files].slice(0, 10);
  });

  function activate(r: Result) {
    if (r.kind === 'app') {
      const a = appRegistry[r.id];
      launch(r.id, a.title, { width: a.width, height: a.height });
    } else if (r.node.type === 'dir') {
      launch('files', r.node.name, { width: 600, height: 420, data: r.node.id });
    } else {
      launch('textedit', r.node.name, { width: 480, height: 380, data: r.node.id });
    }
    closeSpotlight();
  }

  function onKey(e: KeyboardEvent) {
    const n = results.length;
    if (e.key === 'ArrowDown') {
      selected = n ? (selected + 1) % n : 0;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selected = n ? (selected - 1 + n) % n : 0;
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (results[selected]) activate(results[selected]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeSpotlight();
    }
  }
</script>

{#if spotlight.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10002] flex justify-center bg-black/20 pt-[12vh]"
    onpointerdown={closeSpotlight}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="h-min w-[min(520px,90vw)] overflow-hidden rounded-2xl border border-qz-border qz-glass shadow-2xl shadow-black/50"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="w-full bg-transparent px-4 py-3 text-base text-qz-text outline-none placeholder:text-qz-muted"
        placeholder="搜索 App 和文件…"
        bind:value={query}
        autofocus
        onkeydown={onKey}
      />
      {#if results.length}
        <div class="max-h-80 overflow-auto border-t border-qz-border p-1">
          {#each results as r, i (r.kind === 'app' ? 'a' + r.id : 'f' + r.node.id)}
            <button
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
              class:bg-qz-elevated={i === selected}
              onpointerenter={() => (selected = i)}
              onclick={() => activate(r)}
            >
              <span class="text-lg">{r.icon}</span>
              <span class="flex-1 truncate">{r.kind === 'app' ? r.title : r.node.name}</span>
              <span class="text-xs text-qz-muted">{r.kind === 'app' ? 'App' : '文件'}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
