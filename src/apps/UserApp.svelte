<script lang="ts">
  import { getUserApp } from './userApps.svelte';
  import Sandbox from './Sandbox.svelte';

  // 通用宿主：data.appId 指向某个已安装的用户 App，渲染它的代码。
  let { data }: { data?: unknown } = $props();
  const appId = $derived(
    data && typeof data === 'object' && 'appId' in data ? String((data as { appId: unknown }).appId) : '',
  );
  const app = $derived(getUserApp(appId));
</script>

{#if app}
  <Sandbox code={app.code} />
{:else}
  <div class="grid h-full place-items-center text-sm text-qz-muted">这个 App 不存在或已删除</div>
{/if}
