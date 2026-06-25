<script lang="ts">
  import { onMount } from 'svelte';
  import { settings } from './system/settings.svelte';
  import { activeTokens, applyTokens } from './system/theme.svelte';
  import { processes, launch } from './kernel/processes.svelte';
  import { vfs } from './kernel/vfs.svelte';
  import { logSys } from './kernel/log.svelte';
  import { appRegistry } from './apps/registry';
  import Desktop from './shell/Desktop.svelte';

  // 把主题 token 写进 :root；settings 任意字段一变就重写。
  // $effect 会自动订阅 activeTokens() 里读到的每个 settings 字段。
  // 注意：这里只改 CSS 变量 → 整屏换肤，0 个组件重新渲染。
  $effect(() => {
    applyTokens(activeTokens());
    document.documentElement.style.colorScheme = settings.mode;
    // 界面缩放：改根字号 → 所有 rem 尺寸（字号/间距）整体缩放
    document.documentElement.style.fontSize = `${(16 * settings.fontScale).toFixed(2)}px`;
  });

  // 开机 init 序列（记进系统日志，任务管理器里能看到这段引导）
  onMount(() => {
    logSys('kernel', 'QieZiOS 内核启动');
    logSys('vfs', `挂载文件系统（${Object.keys(vfs.nodes).length} 个节点）`);
    if (processes.length === 0) {
      const w = appRegistry.welcome;
      launch('welcome', w.title, { width: w.width, height: w.height });
    } else {
      logSys('kernel', `会话还原：${processes.length} 个进程`);
    }
    logSys('shell', '外壳就绪');
  });
</script>

<Desktop />
