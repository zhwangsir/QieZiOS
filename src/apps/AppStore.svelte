<script lang="ts">
  // 应用商店 —— 远程 App 仓库的图形界面（对标 apt 的 GUI）。
  // 拉取 catalog URL → 列出可装 App → 一键安装进「我的 App」。
  import { repoConfig, fetchCatalog, installCatalogApp, isInstalled, type CatalogApp } from '../system/appRepo.svelte';
  import { sys } from '../system/sys';
  import { onMount } from 'svelte';

  let apps = $state<CatalogApp[]>([]);
  let catalogName = $state('');
  let loading = $state(false);
  let error = $state('');
  let url = $state(repoConfig.url);

  async function load() {
    loading = true;
    error = '';
    try {
      const cat = await fetchCatalog(url);
      repoConfig.url = url; // 记住这次成功的源
      catalogName = cat.name ?? '';
      apps = cat.apps;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      apps = [];
    } finally {
      loading = false;
    }
  }

  function install(entry: CatalogApp) {
    try {
      installCatalogApp(entry);
      sys.notify(`已安装 ${entry.name}`, { body: '到「我的 App」里启动', level: 'success' });
    } catch (e) {
      sys.notify('安装失败', { body: e instanceof Error ? e.message : String(e), level: 'error' });
    }
  }

  function caps(entry: CatalogApp): string[] {
    const c = (entry.app as { caps?: unknown })?.caps;
    return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
  }

  onMount(load);
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 仓库源 -->
  <div class="flex shrink-0 items-center gap-2 border-b border-qz-border p-2">
    <span class="shrink-0 text-xs text-qz-muted">📦 仓库</span>
    <input
      class="min-w-0 flex-1 rounded-qz bg-qz-surface px-2 py-1 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      bind:value={url}
      placeholder="catalog URL，如 /apps.json"
      onkeydown={(e) => e.key === 'Enter' && load()}
    />
    <button
      class="shrink-0 rounded-qz bg-qz-accent px-3 py-1 text-xs font-medium text-qz-accent-contrast disabled:opacity-50"
      onclick={load}
      disabled={loading}>{loading ? '…' : '刷新'}</button>
  </div>

  <div class="min-h-0 flex-1 overflow-auto p-2">
    {#if error}
      <div class="m-2 rounded-qz bg-red-500/15 px-3 py-2 text-xs text-red-300">⚠️ 拉取失败：{error}</div>
    {:else if loading && apps.length === 0}
      <div class="grid h-full place-items-center text-sm text-qz-muted">加载中…</div>
    {:else if apps.length === 0}
      <div class="grid h-full place-items-center text-sm text-qz-muted">仓库里暂无 App</div>
    {:else}
      {#if catalogName}<div class="mb-2 px-1 text-[11px] text-qz-muted">{catalogName} · {apps.length} 个 App</div>{/if}
      <div class="space-y-2">
        {#each apps as a (a.id)}
          {@const installed = isInstalled(a)}
          <div class="flex items-center gap-3 rounded-qz bg-qz-elevated/60 p-2">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-qz bg-qz-surface text-2xl">{a.icon}</span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">{a.name}</div>
              {#if a.description}<div class="truncate text-xs text-qz-muted">{a.description}</div>{/if}
              {#if caps(a).length}
                <div class="mt-0.5 flex flex-wrap gap-1">
                  {#each caps(a) as c (c)}<span class="rounded bg-qz-surface px-1 text-[9px] text-qz-muted">{c}</span>{/each}
                </div>
              {/if}
            </div>
            <button
              class="shrink-0 rounded-qz px-3 py-1 text-xs font-medium {installed
                ? 'bg-qz-surface text-qz-muted'
                : 'bg-qz-accent text-qz-accent-contrast'}"
              onclick={() => install(a)}>{installed ? '重新安装' : '安装'}</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
