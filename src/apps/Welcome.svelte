<script lang="ts">
  import { sys } from '../system/sys';

  let count = $state(0);

  function openSettings() {
    sys.openApp('settings');
  }
</script>

<div class="flex h-full flex-col gap-4 p-6">
  <div>
    <h1 class="text-xl font-semibold">你好，QieZiOS 🍆</h1>
    <p class="mt-1 text-sm leading-relaxed text-qz-muted">
      一个跑在浏览器里的桌面系统。这个窗口本身就是一个 App —— 被内核当成「进程」装进可拖拽的窗口里。
    </p>
  </div>

  <div class="flex flex-wrap items-center gap-3">
    <button
      class="rounded-qz bg-qz-accent px-4 py-2 text-sm font-medium text-qz-accent-contrast transition-transform active:scale-95"
      onclick={() => count++}
    >点了 {count} 次</button>
    <button
      class="rounded-qz bg-qz-elevated px-4 py-2 text-sm font-medium transition-[filter] hover:brightness-110"
      onclick={openSettings}
    >打开设置，自定义外观 →</button>
  </div>

  <p class="mt-auto text-xs leading-relaxed text-qz-muted">
    试试：拖标题栏移动 · 拖右下角缩放 · 双击标题栏最大化 · 点黄灯最小化后，再点 Dock 图标找回。
  </p>
</div>
