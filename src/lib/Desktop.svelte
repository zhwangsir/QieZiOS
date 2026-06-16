<script lang="ts">
  import { processes, launch } from '../kernel/processes.svelte';
  import { appRegistry } from '../apps/registry';
  import Window from './Window.svelte';
</script>

<!-- 桌面：壁纸 + 所有窗口 + 底部 Dock -->
<div class="relative w-full h-full overflow-hidden
            bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950">

  <!-- 桌面中央 logo -->
  <div class="absolute inset-0 grid place-items-center pointer-events-none">
    <div class="text-center text-white/25 select-none">
      <div class="text-7xl mb-2">🍆</div>
      <div class="text-lg tracking-[0.3em]">QieZiOS</div>
    </div>
  </div>

  <!-- 遍历进程 → 查注册表拿组件 → 塞进窗口渲染 -->
  {#each processes as proc (proc.id)}
    {@const App = appRegistry[proc.appId].component}
    <Window {proc}>
      <App />
    </Window>
  {/each}

  <!-- Dock：遍历注册表，每个 App 一个启动按钮 -->
  <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2
              px-3 py-2 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/15 shadow-xl">
    {#each Object.entries(appRegistry) as [appId, app] (appId)}
      <button
        class="w-12 h-12 rounded-xl grid place-items-center text-2xl
               bg-white/5 hover:bg-white/15 hover:-translate-y-1 transition-all duration-150"
        title={app.title}
        onclick={() => launch(appId, app.title)}
      >{app.icon}</button>
    {/each}
  </div>
</div>
