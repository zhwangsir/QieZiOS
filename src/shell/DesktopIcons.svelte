<script lang="ts">
  import { children, rename, trash, move, type VNode } from '../kernel/vfs.svelte';
  import { launch } from '../kernel/processes.svelte';
  import { openMenu } from './menu.svelte';
  import { iconPos } from './iconLayout.svelte';

  // 桌面上显示 VFS 根目录的项
  const items = $derived(children('root'));

  let renamingId = $state<string | null>(null);
  let renameText = $state('');

  // 拖动状态（普通变量）
  let dragId: string | null = null;
  let moved = false;
  let sx = 0, sy = 0, ox = 0, oy = 0;
  let raf = 0, nx = 0, ny = 0;

  // 取图标位置：拖过的用存档，没拖过的自动排布（左侧纵向，溢出转下一列）
  function posOf(n: VNode, i: number): { x: number; y: number } {
    const stored = iconPos.pos[n.id];
    if (stored) return stored;
    const perCol = Math.max(1, Math.floor((window.innerHeight - 160) / 92));
    return { x: 16 + Math.floor(i / perCol) * 92, y: 52 + (i % perCol) * 92 };
  }

  function open(n: VNode) {
    if (n.type === 'dir') launch('files', n.name, { width: 600, height: 420, data: n.id });
    else launch('textedit', n.name, { width: 480, height: 380, data: n.id });
  }

  function startDrag(e: PointerEvent, n: VNode, i: number) {
    if (e.button !== 0 || renamingId === n.id) return; // 仅左键；重命名时不拖
    dragId = n.id;
    moved = false;
    const p = posOf(n, i);
    sx = e.clientX; sy = e.clientY; ox = p.x; oy = p.y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMove(e: PointerEvent) {
    if (!dragId) return;
    moved = true;
    nx = Math.max(0, ox + (e.clientX - sx));
    ny = Math.max(44, oy + (e.clientY - sy)); // 不压到顶栏底下
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (dragId) iconPos.pos[dragId] = { x: nx, y: ny };
      });
  }
  // 用图标位置做命中判定（图标层铺满桌面、坐标即视口坐标，不依赖 DOM 命中测试）
  const ICON_W = 80;
  const ICON_H = 74;
  function folderAt(x: number, y: number): string | null {
    for (let i = 0; i < items.length; i++) {
      const n = items[i];
      if (n.type !== 'dir' || n.id === dragId) continue;
      const p = posOf(n, i);
      if (x >= p.x && x <= p.x + ICON_W && y >= p.y && y <= p.y + ICON_H) return n.id;
    }
    return null;
  }

  function onUp(e: PointerEvent) {
    if (dragId) {
      const targetId = folderAt(e.clientX, e.clientY);
      if (targetId) move(dragId, targetId); // 松手在某文件夹图标上 → 移入它
      else if (moved) iconPos.pos[dragId] = { x: nx, y: ny }; // 否则只是重新摆放
    }
    dragId = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function onMenu(e: MouseEvent, n: VNode) {
    openMenu(e, [
      { label: '打开', icon: n.type === 'dir' ? '📂' : '↗', onClick: () => open(n) },
      {
        label: '重命名',
        icon: '✏️',
        onClick: () => {
          renamingId = n.id;
          renameText = n.name;
        },
      },
      {
        label: '删除',
        icon: '🗑️',
        danger: true,
        separator: true,
        onClick: () => trash(n.id),
      },
    ]);
  }

  function emojiFor(n: VNode): string {
    if (n.type === 'dir') return '📁';
    const ext = n.name.slice(n.name.lastIndexOf('.') + 1).toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['md', 'markdown'].includes(ext)) return '📝';
    if (['json', 'js', 'ts', 'css', 'html'].includes(ext)) return '🧩';
    return '📄';
  }
</script>

<!-- 图标层：容器穿透点击（让空白处右键落到桌面），单个图标可交互 -->
<div class="pointer-events-none absolute inset-0">
  {#each items as n, i (n.id)}
    {@const p = posOf(n, i)}
    <div
      class="pointer-events-auto absolute flex w-20 cursor-default select-none flex-col items-center gap-1 rounded-lg p-1.5 hover:bg-white/10"
      style="left: {p.x}px; top: {p.y}px;"
      role="button"
      tabindex="0"
      ondblclick={() => open(n)}
      oncontextmenu={(e) => onMenu(e, n)}
      onpointerdown={(e) => startDrag(e, n, i)}
      onpointermove={onMove}
      onpointerup={onUp}
      onkeydown={(e) => {
        if (e.key === 'Enter') open(n);
      }}
    >
      <div class="text-4xl drop-shadow-lg">{emojiFor(n)}</div>
      {#if renamingId === n.id}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="w-full rounded bg-qz-surface px-1 text-center text-[11px] text-qz-text outline-none ring-1 ring-qz-accent"
          bind:value={renameText}
          autofocus
          onpointerdown={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              rename(n.id, renameText);
              renamingId = null;
            } else if (e.key === 'Escape') {
              renamingId = null;
            }
          }}
          onblur={() => {
            rename(n.id, renameText);
            renamingId = null;
          }}
        />
      {:else}
        <span
          class="max-w-full truncate rounded bg-black/25 px-1.5 text-center text-[11px] text-white shadow-sm"
          >{n.name}</span
        >
      {/if}
    </div>
  {/each}
</div>
