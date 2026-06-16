<script lang="ts">
  import {
    processes,
    activeId,
    close,
    minimize,
    cycleWindows,
  } from '../kernel/processes.svelte';
  import { appRegistry } from '../apps/registry';
  import Window from './Window.svelte';
  import Dock from './Dock.svelte';
  import TopBar from './TopBar.svelte';
  import { snapState } from './snapState.svelte';

  // 当前活动窗 id（派生）：传给每个 Window 决定是否高亮
  const active = $derived(activeId());

  // 全局快捷键。注意：在输入框/可编辑区里打字时不拦截。
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    if (e.key === 'Escape') {
      const id = activeId();
      if (id) close(id);
    } else if ((e.key === 'm' || e.key === 'M') && (e.ctrlKey || e.metaKey)) {
      const id = activeId();
      if (id) { minimize(id); e.preventDefault(); }
    } else if (e.key === '`' && (e.altKey || e.ctrlKey)) {
      cycleWindows();
      e.preventDefault();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- 桌面外壳：壁纸（吃 token）+ 顶栏 + 窗口层 + Dock -->
<div class="relative h-full w-full overflow-hidden" style="background: var(--qz-wallpaper)">
  <!-- 中央 logo（不挡交互） -->
  <div class="pointer-events-none absolute inset-0 grid place-items-center">
    <div class="select-none text-center text-qz-text/15">
      <div class="mb-2 text-7xl">🍆</div>
      <div class="text-lg tracking-[0.4em]">QieZiOS</div>
    </div>
  </div>

  <TopBar />

  <!-- 窗口层：top-9 让出顶栏高度；isolate 把窗口的 z-index 关进自己的层叠上下文，
       不会盖过顶栏/Dock。遍历进程 → 按 appId 查注册表拿组件 → 塞进窗口渲染。 -->
  <div class="absolute inset-x-0 bottom-0 top-9 isolate">
    {#each processes as proc (proc.id)}
      {@const App = appRegistry[proc.appId].component}
      <Window {proc} active={active === proc.id}>
        <App data={proc.data} />
      </Window>
    {/each}

    <!-- 边缘吸附预览框：拖窗到边缘时出现，提示松手后窗口会落到哪里 -->
    {#if snapState.preview}
      <div
        class="pointer-events-none absolute left-0 top-0 z-[9000] rounded-qz border-2 transition-[transform,width,height] duration-100"
        style="transform: translate({snapState.preview.x}px, {snapState.preview.y}px);
               width: {snapState.preview.w}px; height: {snapState.preview.h}px;
               border-color: var(--color-qz-accent);
               background: color-mix(in srgb, var(--color-qz-accent) 16%, transparent);"
      ></div>
    {/if}
  </div>

  <Dock />
</div>
