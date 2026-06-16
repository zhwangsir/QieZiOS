<script lang="ts">
  import { processes } from '../kernel/processes.svelte';
  import { appRegistry } from '../apps/registry';
  import Window from './Window.svelte';
  import Dock from './Dock.svelte';
</script>

<!-- 桌面外壳：壁纸（吃 token）+ 窗口层 + Dock -->
<div class="relative h-full w-full overflow-hidden" style="background: var(--qz-wallpaper)">
  <!-- 中央 logo（不挡交互） -->
  <div class="pointer-events-none absolute inset-0 grid place-items-center">
    <div class="select-none text-center text-qz-text/15">
      <div class="mb-2 text-7xl">🍆</div>
      <div class="text-lg tracking-[0.4em]">QieZiOS</div>
    </div>
  </div>

  <!-- 窗口层：遍历进程 → 按 appId 查注册表拿组件 → 塞进窗口渲染 -->
  <div class="absolute inset-0">
    {#each processes as proc (proc.id)}
      {@const App = appRegistry[proc.appId].component}
      <Window {proc}>
        <App />
      </Window>
    {/each}
  </div>

  <Dock />
</div>
