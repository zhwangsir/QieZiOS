<script lang="ts">
  import { onMount } from 'svelte';
  import { settings } from './system/settings.svelte';
  import { activeTokens, applyTokens } from './system/theme.svelte';
  import { processes } from './kernel/processes.svelte';
  import { vfs, setOwnerProvider } from './kernel/vfs.svelte';
  import { startServices } from './kernel/services.svelte';
  import { account } from './system/account.svelte';
  import { setShellRunner } from './system/aiTools';
  import { run as shellRun, newCtx } from './lib/shell';
  import { sys } from './system/sys';
  import './system/services'; // 登记系统自带服务（通知中心等）
  import Desktop from './shell/Desktop.svelte';

  // 统一身份：新建文件的属主 = 当前登录账号（未登录 = 访客 qiezi）。
  setOwnerProvider(() => account.username || 'qiezi');

  // AI↔shell 互通：给 AI 的 run_shell 工具接上 shell 运行器（一个常驻 ctx，cd/env 跨调用保留）。
  const aiShellCtx = newCtx();
  setShellRunner(async (command) => {
    const res = await shellRun(command, aiShellCtx);
    if (res.cd) aiShellCtx.cwd = res.cd; // 让 AI 的 cd 在后续命令里生效
    return { out: res.out, err: res.err, code: res.code };
  });

  // 把主题 token 写进 :root；settings 任意字段一变就重写。
  // $effect 会自动订阅 activeTokens() 里读到的每个 settings 字段。
  // 注意：这里只改 CSS 变量 → 整屏换肤，0 个组件重新渲染。
  $effect(() => {
    applyTokens(activeTokens());
    document.documentElement.style.colorScheme = settings.mode;
    // 界面缩放：改根字号 → 所有 rem 尺寸（字号/间距）整体缩放
    document.documentElement.style.fontSize = `${(16 * settings.fontScale).toFixed(2)}px`;
  });

  // 全局自定义 CSS：把用户写的 CSS 注入一个 <style>（深度换肤；用户改即时生效、持久化）
  $effect(() => {
    let el = document.getElementById('qz-custom-css');
    if (!el) {
      el = document.createElement('style');
      el.id = 'qz-custom-css';
      document.head.appendChild(el);
    }
    el.textContent = settings.customCss ?? '';
  });

  // 开机 init 序列：走总线发事件 → 日志/事件检查器都会收到（事件驱动）
  onMount(() => {
    sys.bus.emit('sys.boot');
    sys.bus.emit('sys.mount', { nodes: Object.keys(vfs.nodes).length });
    startServices(); // 启动后台服务（通知中心等）
    if (processes.length === 0) {
      sys.openApp('welcome');
    } else {
      sys.bus.emit('sys.restore', { count: processes.length });
    }
    sys.bus.emit('sys.ready');
    sys.notify('QieZiOS 已就绪 🍆', { body: '系统服务已启动', level: 'success' });
  });
</script>

<Desktop />
