<script lang="ts">
  import { untrack } from 'svelte';
  import { vfs, children, rename, trash, move, isImage, type VNode } from '../kernel/vfs.svelte';
  import { sys } from '../system/sys';
  import { openMenu } from './menu.svelte';
  import { iconPos } from './iconLayout.svelte';

  // 桌面上显示 VFS 根目录的项
  const items = $derived(children('root'));

  // GC：节点被彻底删除后清掉它残留的图标位置，否则 qz.desktopIcons 只增不减（还随账号同步上云）。
  // 放组件里（而非 iconLayout 模块）→ 本组件在 main.ts `await hydrateAll()` 之后才挂载，vfs 已水合，
  // 不会在 IDB 异步水合前把「节点还没读回来」的有效图标误判为孤儿删掉。untrack 读 iconPos.pos →
  // 本 effect 只在节点增删时跑、不被自己的写回重新触发。
  $effect(() => {
    const valid = new Set(Object.keys(vfs.nodes)); // 订阅节点键增删
    untrack(() => {
      const stale = Object.keys(iconPos.pos).filter((id) => !valid.has(id));
      if (stale.length) {
        const next = { ...iconPos.pos };
        for (const id of stale) delete next[id];
        iconPos.pos = next;
      }
    });
  });

  let renamingId = $state<string | null>(null);
  let renameText = $state('');

  // 提交重命名：同目录重名会被 vfs.rename 拒绝（返回 false）→ 提示，避免同名并存路径不可达。
  // `renamingId !== id` 守卫：Escape 取消(清 renamingId)后输入框卸载触发的 blur、或 Enter 提交后的
  // 二次 blur，都会被挡掉 → 不误提交、不重复提示。
  function commitIconRename(id: string) {
    if (renamingId !== id) return;
    if (!rename(id, renameText) && renameText.trim()) {
      sys.notify('重命名失败', { body: '桌面已有同名项', level: 'warn' });
    }
    renamingId = null;
  }

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
    if (n.type === 'dir') sys.openApp('files', { title: n.name, data: n.id });
    else if (isImage(n)) sys.openApp('imageviewer', { title: n.name, data: n.id });
    else sys.openApp('textedit', { title: n.name, data: n.id });
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
              commitIconRename(n.id);
            } else if (e.key === 'Escape') {
              renamingId = null;
            }
          }}
          onblur={() => commitIconRename(n.id)}
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
