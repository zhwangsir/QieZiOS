<script lang="ts">
  import { sys } from '../system/sys';
  import { openSpotlight } from '../shell/spotlightState.svelte';

  // 快速导览：点卡片直接开对应 App（替代原「点击计数」演示）
  const tour: { icon: string; title: string; desc: string; app: string }[] = [
    { icon: '📁', title: '文件', desc: '管理文件 · 上传图片 · 看详情', app: 'files' },
    { icon: '🖥️', title: '终端', desc: '真 Shell：管道 / 脚本 / 后台任务', app: 'terminal' },
    { icon: '🎨', title: '设置', desc: '主色 / 壁纸 / 字体 / 主色渗透…全可调', app: 'settings' },
    { icon: '📦', title: '应用商店', desc: '装更多 App，或自己写一个', app: 'appstore' },
  ];
</script>

<div class="flex h-full flex-col gap-4 overflow-auto p-6">
  <div>
    <h1 class="text-xl font-semibold">你好，QieZiOS 🍆</h1>
    <p class="mt-1 text-sm leading-relaxed text-qz-muted">
      一个跑在浏览器里的桌面系统。这个窗口本身就是一个 App —— 被内核当成「进程」装进可拖拽的窗口里。挑一个开始：
    </p>
  </div>

  <div class="grid grid-cols-2 gap-2">
    {#each tour as t (t.app)}
      <button
        class="flex items-start gap-3 rounded-qz bg-qz-elevated/60 p-3 text-left transition hover:brightness-110 active:scale-[0.98]"
        onclick={() => sys.openApp(t.app)}
      >
        <span class="shrink-0 text-2xl">{t.icon}</span>
        <span class="flex min-w-0 flex-col">
          <span class="text-sm font-medium">{t.title}</span>
          <span class="text-xs text-qz-muted">{t.desc}</span>
        </span>
      </button>
    {/each}
  </div>

  <button
    class="flex items-center gap-2 rounded-qz border border-qz-border px-3 py-2 text-left text-sm transition hover:bg-qz-elevated"
    onclick={openSpotlight}
  >
    <span class="text-lg">🔍</span>
    <span class="text-qz-muted"
      >按 <kbd class="rounded bg-qz-elevated px-1 text-[11px]">Ctrl/⌘ K</kbd> 随时搜索启动一切 —— 点这里试试</span>
  </button>

  <p class="mt-auto text-xs leading-relaxed text-qz-muted">
    窗口手感：拖标题栏移动 · 拖任意边/角缩放 · 拖到屏幕边缘吸附半屏 · 双击标题栏最大化 · 黄灯最小化后点 Dock 找回。
  </p>
</div>
