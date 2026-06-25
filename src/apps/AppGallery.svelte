<script lang="ts">
  import { userApps, removeUserApp, type UserApp } from './userApps.svelte';
  import { launch } from '../kernel/processes.svelte';
  import { sys } from '../system/sys';
  import { CAPABILITIES } from '../system/appSdk';

  // App 声明的能力 → 图标列表（未声明字段的旧 App 视作全部）
  function capIcons(a: UserApp): string {
    const keys = a.caps ?? CAPABILITIES.map((c) => c.key);
    return CAPABILITIES.filter((c) => keys.includes(c.key))
      .map((c) => c.icon)
      .join(' ');
  }

  // 用 App 自己的 id 当 appId 启动（first-class）；data.appId 让通用宿主知道渲染哪个
  function openApp(a: UserApp) {
    launch(a.id, a.name, { width: a.width, height: a.height, data: { appId: a.id } });
  }
  function editApp(a: UserApp) {
    sys.openApp('studio', { data: { editAppId: a.id } });
  }
  function newApp() {
    sys.openApp('studio');
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <div class="flex shrink-0 items-center justify-between border-b border-qz-border px-3 py-2">
    <span class="text-xs text-qz-muted">🧩 我的 App · {userApps.list.length}</span>
    <button
      class="rounded-md bg-qz-accent px-2.5 py-1 text-xs font-medium text-qz-accent-contrast active:scale-95"
      onclick={newApp}>＋ 新建</button>
  </div>

  {#if userApps.list.length === 0}
    <div class="grid flex-1 place-items-center px-6 text-center text-sm text-qz-muted">
      <div>
        <div class="mb-2 text-4xl">🛠️</div>
        还没有装上的 App。去「开发者」里写一个，点「保存为 App」就会出现在这里。
      </div>
    </div>
  {:else}
    <div
      class="grid flex-1 content-start gap-2 overflow-auto p-3"
      style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));"
    >
      {#each userApps.list as a (a.id)}
        <div class="group/app flex flex-col items-center gap-1 rounded-xl p-3 hover:bg-qz-elevated">
          <button class="grid h-14 w-14 place-items-center text-4xl" title="启动" onclick={() => openApp(a)}
            >{a.icon}</button>
          <span class="line-clamp-1 w-full text-center text-xs" title={a.name}>{a.name}</span>
          <span class="text-[10px] leading-none opacity-60" title="此 App 拥有的能力">{capIcons(a)}</span>
          <div class="flex gap-1 opacity-0 transition group-hover/app:opacity-100">
            <button
              class="rounded px-1.5 py-0.5 text-[10px] text-qz-accent hover:bg-qz-surface"
              onclick={() => editApp(a)}>编辑</button>
            <button
              class="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-qz-surface"
              onclick={() => removeUserApp(a.id)}>删除</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
