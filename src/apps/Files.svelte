<script lang="ts">
  import {
    vfs,
    children,
    createDir,
    createFile,
    createBinaryFile,
    isImage,
    rename,
    trash,
    move,
    getNode,
    pathSegments,
    type VNode,
  } from '../kernel/vfs.svelte';
  import { launch } from '../kernel/processes.svelte';
  import { openMenu } from '../shell/menu.svelte';
  import { complete } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';
  import { sys } from '../system/sys';

  // data = 可选的起始文件夹 id（桌面文件夹图标双击时传入）
  let { data }: { data?: unknown } = $props();

  // 只取一次初始值（窗口的 data 在 launch 时就定了、之后不变），故意非响应式
  // svelte-ignore state_referenced_locally
  let cwd = $state(typeof data === 'string' && getNode(data) ? data : 'root'); // 当前所在文件夹 id
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  let dragOverId = $state<string | null>(null); // 拖放时高亮的目标文件夹

  // 搜索：q 即时按名字过滤当前文件夹；aiHits 非空时改为展示 AI 语义搜索命中的文件（全盘）
  let q = $state('');
  let aiHits = $state<string[] | null>(null);
  let aiBusy = $state(false);
  let aiErr = $state('');
  const hasKey = $derived(!!aiConfig.apiKey);

  function onDrop(e: DragEvent, destId: string) {
    e.preventDefault();
    const src = e.dataTransfer?.getData('text/plain');
    if (src) move(src, destId);
    dragOverId = null;
  }

  const items = $derived.by(() => {
    if (aiHits) return aiHits.map((id) => getNode(id)).filter((n): n is VNode => !!n && n.parentId !== 'trash');
    const base = children(cwd);
    const needle = q.trim().toLowerCase();
    return needle ? base.filter((n) => n.name.toLowerCase().includes(needle)) : base;
  });
  const crumbs = $derived(pathSegments(cwd));

  // 导航即退出 AI 搜索结果（保留 q 作为新文件夹的名字过滤）
  function goTo(id: string) {
    aiHits = null;
    aiErr = '';
    cwd = id;
  }
  function clearSearch() {
    q = '';
    aiHits = null;
    aiErr = '';
  }

  // AI 语义搜索：把全盘文本文件的名字+内容片段交给模型，按相关性挑 id
  async function aiSearch() {
    const query = q.trim();
    if (!query || aiBusy || !hasKey) return;
    aiBusy = true;
    aiErr = '';
    aiHits = null;
    const files = Object.values(vfs.nodes)
      .filter((n) => n.type === 'file' && n.parentId !== 'trash')
      .slice(0, 40)
      .map((n) => ({ id: n.id, name: n.name, snippet: (n.content ?? '').slice(0, 400) }));
    if (!files.length) {
      aiErr = '没有可搜索的文本文件';
      aiBusy = false;
      return;
    }
    const prompt = `用户查询：「${query}」

下面是文件列表（JSON，含 id/name/snippet）。按与查询的相关性挑出最相关的文件，只返回它们的 id、按相关度从高到低排列。
严格只输出一个 JSON 数组（如 ["id1","id2"]），不要解释、不要代码块。都不相关就返回 []。

${JSON.stringify(files)}`;
    try {
      const out = await complete(prompt, { system: '你是文件搜索助手，只输出 JSON 数组。' });
      const valid = new Set(files.map((f) => f.id));
      const m = out.match(/\[[\s\S]*\]/);
      const ids: string[] = m
        ? (JSON.parse(m[0]) as unknown[]).filter((x): x is string => typeof x === 'string' && valid.has(x))
        : [];
      aiHits = ids;
      if (!ids.length) aiErr = '没找到相关文件';
    } catch (e) {
      aiHits = null;
      aiErr = e instanceof Error ? e.message : String(e);
    }
    aiBusy = false;
  }

  function open(n: VNode) {
    if (renamingId) return;
    if (n.type === 'dir') {
      goTo(n.id);
    } else if (isImage(n)) {
      launch('imageviewer', n.name, { width: 540, height: 440, data: n.id });
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

  // 上传二进制文件（图片等）→ 字节进 IndexedDB、节点进当前文件夹
  let fileInput = $state<HTMLInputElement>();
  let uploading = $state(false);
  async function onUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) return;
    uploading = true;
    for (const f of files) await createBinaryFile(cwd, f.name, f);
    uploading = false;
    input.value = ''; // 清空 → 允许重复选同一文件
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
      { label: '复制名称', icon: '📋', onClick: () => sys.clipboard.copy(n.name) },
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
          onclick={() => goTo(c.id)}>{c.name}</button>
      {/each}
    </div>
    <button
      class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110"
      onclick={newDir}>＋文件夹</button>
    <button
      class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110"
      onclick={newFile}>＋文件</button>
    <button
      class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110 disabled:opacity-50"
      disabled={uploading}
      onclick={() => fileInput?.click()}>{uploading ? '上传中…' : '⬆上传'}</button>
    <input bind:this={fileInput} type="file" accept="image/*" multiple class="hidden" onchange={onUpload} />
  </div>

  <!-- 搜索：输入即过滤当前文件夹；🤖 跨全盘语义搜索 -->
  <div class="flex items-center gap-2 border-b border-qz-border px-3 py-1.5">
    <input
      class="min-w-0 flex-1 rounded-md bg-qz-surface px-2 py-1 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
      placeholder="搜索文件名…"
      bind:value={q}
      onkeydown={(e) => {
        if (e.key === 'Enter' && hasKey) aiSearch();
        else if (e.key === 'Escape') clearSearch();
      }}
    />
    {#if hasKey}
      <button
        class="shrink-0 rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110 disabled:opacity-40"
        title="AI 语义搜索（按内容找）"
        disabled={aiBusy || !q.trim()}
        onclick={aiSearch}>{aiBusy ? '搜索中…' : '🤖 AI 搜'}</button>
    {/if}
    {#if q || aiHits}
      <button class="shrink-0 rounded-md px-2 py-1 text-xs text-qz-muted hover:bg-qz-elevated" onclick={clearSearch}
        >✕</button>
    {/if}
  </div>

  {#if aiHits}
    <div class="flex items-center gap-2 border-b border-qz-border bg-qz-accent/10 px-3 py-1 text-[11px] text-qz-muted">
      🤖 AI 搜索结果 · {items.length} 个 · 点 ✕ 返回
    </div>
  {:else if aiErr}
    <div class="border-b border-qz-border px-3 py-1 text-[11px] text-red-400">⚠️ {aiErr}</div>
  {/if}

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
      <div class="col-span-full grid place-items-center py-12 text-sm text-qz-muted">
        {aiHits ? '没有命中' : q.trim() ? '没有匹配的文件' : '空文件夹'}
      </div>
    {/if}
  </div>
</div>
