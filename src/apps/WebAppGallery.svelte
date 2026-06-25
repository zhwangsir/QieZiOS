<script lang="ts">
  import { webApps, addWebApp, removeWebApp, type WebApp } from './webApps.svelte';
  import { sys } from '../system/sys';

  let name = $state('');
  let url = $state('');
  let icon = $state('🌐');

  function open(a: WebApp) {
    sys.openApp('webview', { title: a.name, data: { url: a.url } });
  }
  function add() {
    if (!url.trim()) return;
    const wa = addWebApp({ name, url, icon });
    if (wa) {
      name = '';
      url = '';
      icon = '🌐';
      open(wa);
    }
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <div class="flex shrink-0 flex-col gap-2 border-b border-qz-border p-3">
    <div class="text-xs text-qz-muted">🌐 网页 App —— 把任意网站固定成系统里的 App（iframe 嵌入）</div>
    <div class="flex gap-2">
      <input
        class="w-12 rounded-md bg-qz-surface px-2 py-1.5 text-center text-base outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        bind:value={icon}
        maxlength="2"
        aria-label="图标"
      />
      <input
        class="w-28 rounded-md bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        placeholder="名称"
        bind:value={name}
      />
      <input
        class="min-w-0 flex-1 rounded-md bg-qz-surface px-2 py-1.5 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        placeholder="网址（如 example.com）"
        bind:value={url}
        onkeydown={(e) => {
          if (e.key === 'Enter') add();
        }}
      />
      <button
        class="shrink-0 rounded-md bg-qz-accent px-3 py-1.5 text-xs font-medium text-qz-accent-contrast active:scale-95"
        onclick={add}>添加</button>
    </div>
  </div>

  {#if webApps.list.length === 0}
    <div class="grid flex-1 place-items-center px-6 text-center text-sm text-qz-muted">
      <div><div class="mb-2 text-4xl">🌐</div>还没有网页 App。上面填个网址添加——它会像普通 App 一样开在窗口里。</div>
    </div>
  {:else}
    <div
      class="grid flex-1 content-start gap-2 overflow-auto p-3"
      style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));"
    >
      {#each webApps.list as a (a.id)}
        <div class="group/w flex flex-col items-center gap-1 rounded-xl p-3 hover:bg-qz-elevated">
          <button class="grid h-14 w-14 place-items-center text-4xl" title={a.url} onclick={() => open(a)}>{a.icon}</button>
          <span class="line-clamp-1 w-full text-center text-xs" title={a.name}>{a.name}</span>
          <button
            class="rounded px-1.5 py-0.5 text-[10px] text-red-400 opacity-0 transition group-hover/w:opacity-100 hover:bg-qz-surface"
            onclick={() => removeWebApp(a.id)}>删除</button>
        </div>
      {/each}
    </div>
  {/if}
</div>
