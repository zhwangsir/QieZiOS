<script lang="ts">
  import { shortcuts, closeShortcuts } from './shortcutsState.svelte';

  // 快捷键速查表（与 Desktop.onKey / Window 拖拽吸附 / 各 App 内快捷键一致）
  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: '窗口',
      items: [
        ['拖到边缘 / 角落', '半屏 / 四分之一屏吸附'],
        ['Ctrl+Alt+← / →', '左半 / 右半屏'],
        ['Ctrl+Alt+↑ / ↓', '最大化 / 还原'],
        ['双击标题栏', '最大化 / 还原'],
        ['Esc', '关闭活动窗口'],
        ['Ctrl/⌘ + M', '最小化活动窗口'],
        ['Alt + `', '轮换窗口'],
      ],
    },
    {
      title: '系统',
      items: [
        ['Ctrl/⌘ + K', '命令面板 (Spotlight)'],
        ['点顶栏 🍆', '所有 App (Launchpad)'],
        ['?', '本快捷键速查'],
      ],
    },
    {
      title: '编辑 / 终端',
      items: [
        ['Ctrl + F', '记事本查找 / 替换'],
        ['Ctrl + L', '终端清屏'],
        ['↑ / ↓', '终端命令历史'],
        ['Tab', '终端命令 / 路径补全'],
      ],
    },
  ];
</script>

{#if shortcuts.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10003] flex items-center justify-center bg-black/30 p-4"
    onpointerdown={closeShortcuts}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-qz-border qz-glass shadow-2xl shadow-black/50"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between border-b border-qz-border px-4 py-3">
        <span class="text-sm font-semibold">⌨️ 键盘快捷键</span>
        <button class="rounded px-2 py-0.5 text-xs text-qz-muted hover:bg-qz-elevated" onclick={closeShortcuts}>关闭 (Esc)</button>
      </div>
      <div class="grid max-h-[70vh] gap-4 overflow-auto p-4 sm:grid-cols-2">
        {#each groups as g (g.title)}
          <section class="flex flex-col gap-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-qz-muted">{g.title}</h3>
            {#each g.items as [keys, desc] (keys)}
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="text-qz-text/90">{desc}</span>
                <kbd class="shrink-0 rounded bg-qz-elevated px-1.5 py-0.5 font-mono text-[11px] text-qz-muted">{keys}</kbd>
              </div>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}
