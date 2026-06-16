<script lang="ts">
  // 一个最简单的 App —— 就是一个普通 Svelte 组件。
  // $state 声明响应式变量（相当于 React 的 useState，但更直接：直接 count++ 即可）
  let count = $state(0);
</script>

<div class="p-5 text-slate-100">
  <h2 class="text-lg font-semibold mb-2">你好，QieZiOS 🍆</h2>
  <p class="text-sm text-slate-300 mb-4 leading-relaxed">
    这是系统里的第一个 App。它只是一个普通组件——被内核当作"进程"装进窗口里。
  </p>
  <button
    class="px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 transition-colors text-white text-sm"
    onclick={() => count++}
  >
    点了 {count} 次
  </button>
</div>
