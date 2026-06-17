<script lang="ts">
  import {
    children,
    createDir,
    createFile,
    rename,
    trash,
    move,
    getNode,
    pathSegments,
    type VNode,
  } from '../kernel/vfs.svelte';
  import { launch } from '../kernel/processes.svelte';
  import { openMenu } from '../shell/menu.svelte';

  // data = 可选的起始文件夹 id（桌面文件夹图标双击时传入）
  let { data }: { data?: unknown } = $props();

  // 只取一次初始值（窗口的 data 在 launch 时就定了、之后不变），故意非响应式
  // svelte-ignore state_referenced_locally
  let cwd = $state(typeof data === 'string' && getNode(data) ? data : 'root'); // 当前所在文件夹 id
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  let dragOverId = $state<string | null>(null); // 拖放时高亮的目标文件夹

  function onDrop(e: DragEvent, destId: string) {
    e.preventDefault();
    const src = e.dataTransfer?.getData('text/plain');
    if (src) move(src, destId);
    dragOverId = null;
  }

  const items = $derived(children(cwd));
  const crumbs = $derived(pathSegments(cwd));

  function open(n: VNode) {
    if (renamingId) return;
    if (n.type === 'dir') {
      cwd = n.id;
    } else {
      // 记事本固定尺寸（避免 Files 依赖 registry 造成循环 import）
      launch('textedit', n.name, { width: 480, height: 380, data: n.id });
    }
  }

  function newDir() {
    startEditNew(createDir(cwd));
  }
  function newFile() {
    startEditNew(createFile(cwd));
  }
  function startEditNew(id: string) {
    renamingId = id;
    renameText = getNode(id)?.name ?? '';
  }
  function startRename(n: VNode, e: Event) {
    e.stopPropagation();
    renamingId = n.id;
    renameText = n.name;
  }
  function commitRename() {
    if (renamingId) rename(renamingId, renameText);
    renamingId = null;
  }
  function del(n: VNode, e: Event) {
    e.stopPropagation();
    trash(n.id);
  }

  function onItemMenu(e: MouseEvent, n: VNode) {
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
      { label: '删除', icon: '🗑️', danger: true, separator: true, onClick: () => trash(n.id) },
    ]);
  }

  // 按扩展名挑图标，文件夹一律 📁
  function iconFor(n: VNode): string {
    if (n.type === 'dir') return '📁';
    const ext = n.name.slice(n.name.lastIndexOf('.') + 1).toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
    if (['md', 'markdown'].includes(ext)) return '📝';
    if (['json', 'js', 'ts', 'css', 'html', 'xml', 'yml'].includes(ext)) return '🧩';
    if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵';
    if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return '🎬';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
    return '📄';
  }
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 面包屑 + 工具栏 -->
  <div class="flex items-center gap-2 border-b border-qz-border px-3 py-2">
    <div class="flex flex-1 items-center gap-0.5 overflow-hidden text-xs text-qz-muted">
      {#each crumbs as c, i (c.id)}
        {#if i > 0}<span class="opacity-40">›</span>{/if}
        <button
          class="truncate rounded px-1 py-0.5 hover:bg-qz-elevated hover:text-qz-text"
          ondragover={(e) => e.preventDefault()}
          ondrop={(e) => onDrop(e, c.id)}
          onclick={() => (cwd = c.id)}>{c.name}</button>
      {/each}
    </div>
    <button
      class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110"
      onclick={newDir}>＋文件夹</button>
    <button
      class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110"
      onclick={newFile}>＋文件</button>
  </div>

  <!-- 内容网格 -->
  <div
    class="grid flex-1 content-start gap-1 overflow-auto p-3"
    style="grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));"
  >
    {#each items as n (n.id)}
      <div
        class="group/item relative flex flex-col items-center gap-1 rounded-lg p-2 hover:bg-qz-elevated"
        style={dragOverId === n.id ? 'box-shadow: inset 0 0 0 2px var(--color-qz-accent)' : ''}
        role="button"
        tabindex="0"
        draggable={renamingId !== n.id}
        ondragstart={(e) => e.dataTransfer?.setData('text/plain', n.id)}
        ondragover={n.type === 'dir' ? (e) => { e.preventDefault(); dragOverId = n.id; } : undefined}
        ondragleave={n.type === 'dir' ? () => { if (dragOverId === n.id) dragOverId = null; } : undefined}
        ondrop={n.type === 'dir' ? (e) => onDrop(e, n.id) : undefined}
        ondblclick={() => open(n)}
        oncontextmenu={(e) => onItemMenu(e, n)}
        onkeydown={(e) => {
          if (e.key === 'Enter') open(n);
        }}
      >
        <div class="text-3xl">{iconFor(n)}</div>

        {#if renamingId === n.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="w-full rounded bg-qz-surface px-1 text-center text-xs text-qz-text outline-none ring-1 ring-qz-accent"
            bind:value={renameText}
            autofocus
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
              e.stopPropagation(); // 别让 Enter/Esc 冒泡到外层 item（会误触发打开/导航）
              if (e.key === 'Enter') commitRename();
              else if (e.key === 'Escape') renamingId = null;
            }}
            onblur={commitRename}
          />
        {:else}
          <span class="line-clamp-2 w-full text-center text-xs leading-tight">{n.name}</span>
        {/if}

        <!-- 悬停操作 -->
        <div class="absolute right-1 top-1 hidden gap-0.5 group-hover/item:flex">
          <button
            class="grid h-5 w-5 place-items-center rounded bg-qz-surface/90 text-[10px] hover:bg-qz-surface"
            title="重命名"
            onclick={(e) => startRename(n, e)}>✏️</button>
          <button
            class="grid h-5 w-5 place-items-center rounded bg-qz-surface/90 text-[10px] hover:bg-qz-surface"
            title="删除"
            onclick={(e) => del(n, e)}>🗑️</button>
        </div>
      </div>
    {/each}

    {#if items.length === 0}
      <div class="col-span-full grid place-items-center py-12 text-sm text-qz-muted">空文件夹</div>
    {/if}
  </div>
</div>
