<script lang="ts">
  import { studioDraft, STARTER_CODE } from '../system/studioDraft.svelte';
  import { buildSrcdoc, handleGuestCall, DEFAULT_CAPS } from '../system/appSdk';

  let iframeEl = $state<HTMLIFrameElement>();
  // svelte-ignore state_referenced_locally
  let srcdoc = $state(buildSrcdoc(studioDraft.code)); // 初次进来就先跑一遍
  let showHelp = $state(false);

  // 宿主 RPC 闸：只收自己这个 iframe 的消息，路由给 handleGuestCall
  $effect(() => {
    function onMsg(e: MessageEvent) {
      const win = iframeEl?.contentWindow;
      if (!win || e.source !== win) return;
      handleGuestCall(win, e.data, DEFAULT_CAPS);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  function run() {
    // 先清空再设，强制 iframe 重建（同样的 srcdoc 不会触发重载）。
    // 用 setTimeout 而非 rAF：后台/隐藏标签页里 rAF 会被冻结，setTimeout 仍会触发。
    srcdoc = '';
    setTimeout(() => (srcdoc = buildSrcdoc(studioDraft.code)), 0);
  }
  function resetCode() {
    studioDraft.code = STARTER_CODE;
    run();
  }

  // Tab 键插两个空格（别让焦点跳走）
  function onTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.target as HTMLTextAreaElement;
    const s = ta.selectionStart;
    studioDraft.code = studioDraft.code.slice(0, s) + '  ' + studioDraft.code.slice(ta.selectionEnd);
    setTimeout(() => (ta.selectionStart = ta.selectionEnd = s + 2), 0);
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 工具栏 -->
  <div class="flex shrink-0 items-center gap-2 border-b border-qz-border px-3 py-1.5">
    <span class="text-xs text-qz-muted">🛠️ 开发者</span>
    <button
      class="rounded-md bg-qz-accent px-2.5 py-1 text-xs font-medium text-qz-accent-contrast transition-transform active:scale-95"
      onclick={run}>▶ 运行</button>
    <button class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110" onclick={resetCode}
      >重置示例</button>
    <button
      class="ml-auto rounded-md px-2 py-1 text-xs text-qz-muted hover:bg-qz-elevated"
      onclick={() => (showHelp = !showHelp)}>{showHelp ? '收起' : '？SDK'}</button>
  </div>

  {#if showHelp}
    <div class="shrink-0 border-b border-qz-border bg-qz-surface/60 px-3 py-2 text-[11px] leading-relaxed text-qz-muted">
      代码跑在沙箱 iframe，用全局 <code class="text-qz-text">qz</code> 调系统：
      <code class="text-qz-text">qz.launchApp(id)</code> · <code class="text-qz-text">qz.listApps()</code> ·
      <code class="text-qz-text">qz.createFile(name,内容)</code> · <code class="text-qz-text">qz.writeFile(id,内容)</code> ·
      <code class="text-qz-text">qz.setTheme(&#123;accent,mode&#125;)</code> · <code class="text-qz-text">await qz.ask('问题')</code>（AI）。都返回 Promise。
    </div>
  {/if}

  <!-- 编辑器 | 预览 -->
  <div class="flex min-h-0 flex-1">
    <textarea
      class="h-full w-1/2 resize-none border-r border-qz-border bg-qz-surface/40 p-3 font-mono text-xs leading-relaxed text-qz-text outline-none"
      bind:value={studioDraft.code}
      onkeydown={onTab}
      spellcheck="false"
      placeholder="在这里写你的 App（HTML + CSS + JS）…"
    ></textarea>
    <iframe
      bind:this={iframeEl}
      title="预览"
      class="h-full w-1/2 bg-white"
      sandbox="allow-scripts"
      {srcdoc}
    ></iframe>
  </div>
</div>
