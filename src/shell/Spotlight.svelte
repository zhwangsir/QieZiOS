<script lang="ts">
  import { spotlight, closeSpotlight } from './spotlightState.svelte';
  import { appRegistry } from '../apps/registry';
  import { userApps, type UserApp } from '../apps/userApps.svelte';
  import { vfs, type VNode } from '../kernel/vfs.svelte';
  import { launch } from '../kernel/processes.svelte';

  type Result =
    | { kind: 'app'; id: string; title: string; icon: string }
    | { kind: 'userapp'; app: UserApp }
    | { kind: 'file'; node: VNode; icon: string }
    | { kind: 'ai'; query: string };

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
    const installed: Result[] = userApps.list
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .map((a) => ({ kind: 'userapp', app: a }));
    const files: Result[] = q
      ? Object.values(vfs.nodes)
          .filter((n) => n.id !== 'root' && n.parentId !== 'trash' && n.name.toLowerCase().includes(q))
          .slice(0, 6)
          .map((n) => ({ kind: 'file', node: n, icon: n.type === 'dir' ? '📁' : '📄' }))
      : [];
    // 有输入就在末尾挂一个「问 AI」入口（放最后，不抢 App 的默认 Enter）
    const ai: Result[] = query.trim() ? [{ kind: 'ai', query: query.trim() }] : [];
    return [...apps, ...installed, ...files].slice(0, 9).concat(ai);
  });

  function activate(r: Result) {
    if (r.kind === 'ai') {
      const a = appRegistry['assistant'];
      launch('assistant', a.title, { width: a.width, height: a.height, data: { ask: r.query } });
    } else if (r.kind === 'userapp') {
      launch('userapp', r.app.name, { width: r.app.width, height: r.app.height, data: { appId: r.app.id } });
    } else if (r.kind === 'app') {
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
        placeholder="搜索 App、文件，或问 AI…"
        bind:value={query}
        autofocus
        onkeydown={onKey}
      />
      {#if results.length}
        <div class="max-h-80 overflow-auto border-t border-qz-border p-1">
          {#each results as r, i (r.kind === 'app' ? 'a' + r.id : r.kind === 'userapp' ? 'u' + r.app.id : r.kind === 'file' ? 'f' + r.node.id : 'ai')}
            <button
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
              class:bg-qz-elevated={i === selected}
              onpointerenter={() => (selected = i)}
              onclick={() => activate(r)}
            >
              <span class="text-lg"
                >{r.kind === 'ai' ? '🤖' : r.kind === 'userapp' ? r.app.icon : r.icon}</span>
              <span class="flex-1 truncate">
                {#if r.kind === 'app'}{r.title}{:else if r.kind === 'userapp'}{r.app.name}{:else if r.kind === 'file'}{r.node.name}{:else}问
                  AI：{r.query}{/if}
              </span>
              <span class="text-xs text-qz-muted"
                >{r.kind === 'app' ? 'App' : r.kind === 'userapp' ? '我的' : r.kind === 'file' ? '文件' : 'AI'}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
