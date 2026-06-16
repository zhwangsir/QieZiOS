<script lang="ts">
  import { menu, closeMenu } from './menu.svelte';
  import { pop } from '../lib/motion';
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
    class="fixed z-[10001] min-w-44 rounded-lg border border-qz-border qz-glass p-1 text-sm shadow-2xl shadow-black/50"
    style="left: {menu.x}px; top: {menu.y}px;"
    in:pop={{ duration: 110 }}
  >
    {#each menu.items as item, i (i)}
      {#if item.separator}<div class="mx-1 my-1 h-px bg-qz-border"></div>{/if}
      <button
        class="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left hover:bg-qz-elevated"
        class:text-red-400={item.danger}
        onclick={() => {
          item.onClick();
          closeMenu();
        }}
      >
        <span class="w-4 text-center text-xs">{item.icon ?? ''}</span>
        <span class="flex-1 whitespace-nowrap">{item.label}</span>
      </button>
    {/each}
  </div>
{/if}
