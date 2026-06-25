<script lang="ts">
  import { buildSrcdoc, handleGuestCall } from '../system/appSdk';
  import { emit, on } from '../kernel/bus.svelte';

  // 通用沙箱：把一段用户代码跑进隔离 iframe，并架好宿主 RPC 闸。
  // Studio 预览 和 已安装的 UserApp 都复用它。
  // caps：允许的工具名集合（按 App 声明的能力算出）；没在集合里的调用一律被拒。
  // appId：本 App 的 id（IPC 时作为事件的 from）。runKey：自增强制重建 iframe。
  let {
    code,
    caps,
    appId = 'app',
    runKey = 0,
  }: { code: string; caps: Set<string>; appId?: string; runKey?: number } = $props();

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

  // 宿主 RPC 闸 + IPC 桥：只收自己这个 iframe 的消息。
  // call → 能力校验后执行；emit → 发到总线（app: 命名空间）；sub → 把 app: 事件转发进 iframe。
  $effect(() => {
    let busBridge: (() => void) | null = null;
    function ensureBridge(win: Window) {
      if (busBridge) return;
      busBridge = on('*', (payload, ev) => {
        if (!ev.startsWith('app:')) return; // 只转发 app 命名空间，绝不泄漏内核事件给沙箱
        const pp = (payload ?? {}) as { from?: string; data?: unknown };
        win.postMessage({ __qz: 'evt', event: ev.slice(4), data: pp.data, from: pp.from }, '*');
      });
    }
    function onMsg(e: MessageEvent) {
      const win = iframeEl?.contentWindow;
      if (!win || e.source !== win) return;
      const m = e.data as { __qz?: string; event?: unknown; data?: unknown } | null;
      if (!m || typeof m !== 'object') return;
      if (m.__qz === 'call') handleGuestCall(win, m, caps);
      else if (m.__qz === 'emit') emit('app:' + String(m.event), { from: appId, data: m.data });
      else if (m.__qz === 'sub') ensureBridge(win);
    }
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      busBridge?.();
    };
  });
</script>

<iframe
  bind:this={iframeEl}
  title="App 预览"
  class="h-full w-full border-0 bg-white"
  sandbox="allow-scripts"
  {srcdoc}
></iframe>
