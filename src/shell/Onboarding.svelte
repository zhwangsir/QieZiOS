<script lang="ts">
  // 首秀引导（U10）：首次进桌面的全屏沉浸式三页引导 ——
  //   1 这是什么（Web OS 定位）→ 2 AI 能做什么（附「去设置 AI」）→ 3 快捷键速查。
  // 完成/跳过都走 finishOnboarding（写 qz.onboarded，之后进桌面不再自动弹）。
  // z-10002：低于锁屏（10003）——移动端首启 Desktop 在 locked 阶段挂载，
  // 引导先开在锁屏底下，解锁后自然露出；桌面端 login 之后才挂 Desktop，无此问题。
  import { onboarding, finishOnboarding } from '../system/onboarding.svelte';
  import { sys } from '../system/sys';
  import Icon from '../lib/Icon.svelte';

  let page = $state(0);
  const PAGE_COUNT = 3;

  function next() {
    if (page < PAGE_COUNT - 1) page += 1;
    else finishOnboarding();
  }
  function back() {
    if (page > 0) page -= 1;
  }
  // 「去设置 AI」：也算完成引导（写标记），并打开设置 App
  function goAiSettings() {
    finishOnboarding();
    sys.openApp('settings');
  }

  // 第 2 页：AI 能力三要点
  const aiPoints: { icon: string; title: string; desc: string }[] = [
    { icon: 'MessageSquare', title: '自然语言驱动系统', desc: '「主色换成紫色」「新建一个笔记」—— 助手真执行，不是聊天玩具' },
    { icon: 'Sparkles', title: '各 App 内嵌 AI', desc: '记事本润色续写、文件摘要、截图识别、终端命令行问 AI' },
    { icon: 'Brain', title: '视觉模型 + 桌宠', desc: '助手可附图问答；桌面 Live2D 伙伴是 AI 的脸，会动口型会做表情' },
  ];

  // 第 3 页：快捷键摘要（Shortcuts 面板的精选子集；完整版进桌面按 ?）
  const keyRows: [string, string][] = [
    ['Ctrl/⌘ + K', '命令面板：搜索启动一切'],
    ['F3', '任务视图：一览所有窗口'],
    ['Ctrl/⌘ + Q', '锁定屏幕'],
    ['Esc', '关闭活动窗口'],
    ['Ctrl/⌘ + M', '最小化活动窗口'],
    ['?', '完整快捷键速查表'],
  ];
</script>

{#if onboarding.open}
  <div
    class="fixed inset-0 z-[10002] flex select-none flex-col items-center justify-center px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+2rem)]"
    style="background: var(--qz-wallpaper)"
    role="dialog"
    aria-modal="true"
    aria-label="欢迎使用 QieZiOS"
  >
    <!-- 压暗 + 景深，聚焦内容（与桌面 vignette 同配方） -->
    <div
      class="pointer-events-none absolute inset-0"
      style="background: radial-gradient(125% 85% at 50% 0%, rgb(0 0 0 / 0.18) 0%, rgb(0 0 0 / 0.55) 100%);"
    ></div>

    <!-- 跳过（右上角） -->
    <button
      class="absolute right-5 top-[calc(env(safe-area-inset-top)+1rem)] rounded-full px-3.5 py-1.5 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
      onclick={finishOnboarding}>跳过</button
    >

    <!-- 内容区（三页） -->
    <div class="relative flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
      {#if page === 0}
        <!-- 1 · 这是什么 -->
        <img src="/favicon.svg" alt="QieZiOS" class="h-20 w-20 drop-shadow-2xl" draggable="false" />
        <h1 class="mt-5 text-2xl font-semibold tracking-wide text-white">你好，QieZiOS</h1>
        <p class="mt-3 max-w-sm text-sm leading-relaxed text-white/75">
          一套跑在浏览器里的个人计算环境 —— 桌面、窗口、文件系统、终端、应用商店，整个系统就是这个网页。数据存在你自己的浏览器里，刷新原样还原。
        </p>
        <div class="mt-7 grid w-full grid-cols-3 gap-2.5">
          {#each [
            { icon: 'AppWindow', label: '真窗口', desc: '拖拽 / 缩放 / 吸附' },
            { icon: 'Folder', label: '真文件', desc: '虚拟文件系统' },
            { icon: 'Terminal', label: '真 Shell', desc: '管道 / 脚本 / 任务' },
          ] as f (f.icon)}
            <div class="flex flex-col items-center gap-1 rounded-2xl bg-white/10 px-2 py-3.5 backdrop-blur-sm">
              <Icon name={f.icon} size={22} strokeWidth={1.6} class="text-white" />
              <span class="text-xs font-medium text-white">{f.label}</span>
              <span class="text-[10px] text-white/60">{f.desc}</span>
            </div>
          {/each}
        </div>
      {:else if page === 1}
        <!-- 2 · AI 能做什么 -->
        <span class="grid h-16 w-16 place-items-center rounded-3xl bg-qz-accent text-qz-accent-contrast shadow-xl shadow-black/30">
          <Icon name="Bot" size={30} strokeWidth={1.7} />
        </span>
        <h1 class="mt-5 text-2xl font-semibold tracking-wide text-white">AI 织进每个角落</h1>
        <div class="mt-6 flex w-full flex-col gap-2.5 text-left">
          {#each aiPoints as p (p.icon)}
            <div class="flex items-start gap-3 rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm">
              <span class="mt-0.5 shrink-0 text-white"><Icon name={p.icon} size={19} strokeWidth={1.7} /></span>
              <span class="flex min-w-0 flex-col">
                <span class="text-sm font-medium text-white">{p.title}</span>
                <span class="mt-0.5 text-xs leading-relaxed text-white/65">{p.desc}</span>
              </span>
            </div>
          {/each}
        </div>
        <button
          class="mt-4 flex items-center gap-1.5 rounded-full border border-white/25 px-4 py-1.5 text-xs text-white/85 transition hover:bg-white/10"
          onclick={goAiSettings}>
          <Icon name="Settings" size={13} />去设置 AI（也可稍后再配）
        </button>
      {:else}
        <!-- 3 · 快捷键速查 -->
        <span class="grid h-16 w-16 place-items-center rounded-3xl bg-white/10 text-white backdrop-blur-sm">
          <Icon name="Keyboard" size={30} strokeWidth={1.7} />
        </span>
        <h1 class="mt-5 text-2xl font-semibold tracking-wide text-white">快捷键速查</h1>
        <div class="mt-6 flex w-full flex-col gap-1.5 rounded-2xl bg-white/10 p-4 backdrop-blur-sm">
          {#each keyRows as [keys, desc] (keys)}
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="text-left text-white/85">{desc}</span>
              <kbd class="shrink-0 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-white/70">{keys}</kbd>
            </div>
          {/each}
        </div>
        <p class="mt-4 text-xs text-white/55">进桌面后随时按 <kbd class="rounded bg-black/30 px-1 font-mono text-[10px]">?</kbd> 再看一遍</p>
      {/if}
    </div>

    <!-- 底部导航：页点 + 上一步/下一步 -->
    <div class="relative flex w-full max-w-md items-center justify-between">
      <div class="flex w-20 justify-start">
        {#if page > 0}
          <button class="rounded-full px-3.5 py-2 text-xs text-white/70 transition hover:bg-white/10 hover:text-white" onclick={back}>上一步</button>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#each Array(PAGE_COUNT) as _, i (i)}
          <span
            class="h-1.5 rounded-full transition-all duration-200 {i === page ? 'w-5 bg-white' : 'w-1.5 bg-white/35'}"
          ></span>
        {/each}
      </div>
      <div class="flex w-20 justify-end">
        <button
          class="rounded-full bg-qz-accent px-4 py-2 text-xs font-medium text-qz-accent-contrast shadow-lg shadow-black/30 transition active:scale-95"
          onclick={next}>{page < PAGE_COUNT - 1 ? '下一步' : '开始使用'}</button>
      </div>
    </div>
  </div>
{/if}
