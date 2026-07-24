<script lang="ts">
  import { menu, closeMenu } from './menu.svelte';
  import { pop } from '../lib/motion';
  import Icon from '../lib/Icon.svelte';
</script>

{#if menu.open}
  <!-- 透明遮罩：点任意处 / 右键 / 滚轮 都关闭菜单 -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10000]"
    onpointerdown={closeMenu}
    oncontextmenu={(e) => {
      e.preventDefault();
      closeMenu();
    }}
    onwheel={closeMenu}
  ></div>

  <div
    class="fixed z-[10001] min-w-44 rounded-lg border border-qz-border qz-glass qz-glass-float p-1 text-sm"
    style="left: {menu.x}px; top: {menu.y}px;"
    in:pop={{ duration: 120, offsetY: -4 }}
  >
    {#each menu.items as item, i (i)}
      {#if item.separator}<div class="mx-2.5 my-1 h-px bg-qz-border"></div>{/if}
      <button
        class="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left {item.disabled
          ? 'cursor-default opacity-40'
          : 'hover:bg-qz-elevated'} {item.danger && !item.disabled ? 'hover:bg-red-500 hover:text-white' : ''}"
        class:text-red-400={item.danger && !item.disabled}
        aria-disabled={item.disabled || undefined}
        onclick={() => {
          if (item.disabled) return; // 禁用项：不触发、不关菜单
          item.onClick();
          closeMenu();
        }}
      >
        <!-- 图标列：勾选态 ✓ 与 icon 同列，同时存在时 ✓ 优先（macOS 心智） -->
        <span class="grid w-4 place-items-center">
          {#if item.checked}<Icon name="Check" size={13} />{:else if item.icon}<Icon name={item.icon} size={13} />{/if}
        </span>
        <span class="flex-1 whitespace-nowrap">{item.label}</span>
        {#if item.shortcut}<kbd class="ml-auto rounded border border-qz-border bg-qz-surface px-1.5 py-0.5 font-mono text-[10px] text-qz-muted">{item.shortcut}</kbd>{/if}
      </button>
    {/each}
  </div>
{/if}
