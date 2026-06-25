<script lang="ts">
  import { buildSrcdoc, handleGuestCall } from '../system/appSdk';

  // 通用沙箱：把一段用户代码跑进隔离 iframe，并架好宿主 RPC 闸。
  // Studio 预览 和 已安装的 UserApp 都复用它。
  // caps：允许的工具名集合（按 App 声明的能力算出）；没在集合里的调用一律被拒。
  // runKey：每次自增可强制重建 iframe（同样 code 也重跑）。
  let { code, caps, runKey = 0 }: { code: string; caps: Set<string>; runKey?: number } = $props();

  let iframeEl = $state<HTMLIFrameElement>();
  let srcdoc = $state('');

  // code / runKey 变 → 重建 iframe。
  // 用 setTimeout 而非 rAF：后台/隐藏标签页里 rAF 会被冻结。
  $effect(() => {
    void runKey;
    const c = code;
    srcdoc = '';
    const t = setTimeout(() => (srcdoc = buildSrcdoc(c)), 0);
    return () => clearTimeout(t);
  });

  // 宿主 RPC 闸：只收自己这个 iframe 的消息，路由给 handleGuestCall。
  $effect(() => {
    function onMsg(e: MessageEvent) {
      const win = iframeEl?.contentWindow;
      if (!win || e.source !== win) return;
      handleGuestCall(win, e.data, caps);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });
</script>

<iframe
  bind:this={iframeEl}
  title="App 预览"
  class="h-full w-full border-0 bg-white"
  sandbox="allow-scripts"
  {srcdoc}
></iframe>
