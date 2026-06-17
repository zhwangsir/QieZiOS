<script lang="ts">
  import { onMount } from 'svelte';
  import { settings } from './system/settings.svelte';
  import { activeTokens, applyTokens } from './system/theme.svelte';
  import { processes, launch } from './kernel/processes.svelte';
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

  // 首次进入：自动开「欢迎」App，桌面不空着
  onMount(() => {
    if (processes.length === 0) {
      const w = appRegistry.welcome;
      launch('welcome', w.title, { width: w.width, height: w.height });
    }
  });
</script>

<Desktop />
