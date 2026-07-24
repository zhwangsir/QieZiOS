<script lang="ts">
  // ───────────────────────────────────────────────────────────
  // 全系统唯一图标出口：所有图标一律经 <Icon name="…" /> 渲染。
  // name 既接受存量 emoji 存储键（'🗑️'/'⚙'，内部先映射）也接受 Lucide 名（'Trash2'），
  // 未识别键回退 FALLBACK_ICON → 任何数据都不会把 emoji 直接带上屏。
  // 用法：<Icon name={app.icon} size={18} class="text-qz-muted" />
  // ───────────────────────────────────────────────────────────
  import { iconName } from './icons';
  import { iconComponent } from './iconRegistry';

  let {
    name,
    size = 16,
    strokeWidth = 2,
    class: klass = '',
  }: {
    name: string;
    size?: number | string;
    strokeWidth?: number | string;
    class?: string;
  } = $props();

  const C = $derived(iconComponent(iconName(name)));
</script>

<C {size} {strokeWidth} class={klass} aria-hidden="true" />
