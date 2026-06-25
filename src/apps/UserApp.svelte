<script lang="ts">
  import { getUserApp } from './userApps.svelte';
  import { capsToTools } from '../system/appSdk';
  import Sandbox from './Sandbox.svelte';

  // 通用宿主：data.appId 指向某个已安装的用户 App，渲染它的代码。
  let { data }: { data?: unknown } = $props();
  const appId = $derived(
    data && typeof data === 'object' && 'appId' in data ? String((data as { appId: unknown }).appId) : '',
  );
  const app = $derived(getUserApp(appId));
  // 按 App 声明的能力算出允许的工具集（未声明字段的旧 App → 全给）
  const caps = $derived(capsToTools(app?.caps));
</script>

{#if app}
  <Sandbox code={app.code} {caps} {appId} />
{:else}
  <div class="grid h-full place-items-center text-sm text-qz-muted">这个 App 不存在或已删除</div>
{/if}
