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
    restoreFromTrash,
    move,
    copyNode,
    getNode,
    pathSegments,
    setMode,
    setOwner,
    DEFAULT_OWNER,
    type VNode,
  } from '../kernel/vfs.svelte';
  import { openMenu } from '../shell/menu.svelte';
  import { permits, modeStr, accessStr } from '../system/permissions';
  import { currentUser } from '../system/account.svelte';
  import { complete } from '../system/ai';
  import { aiConfig } from '../system/aiConfig.svelte';
  import { sys } from '../system/sys';
  import { pushNote } from '../system/notifications.svelte';

  // 删除后弹一条带「撤销」的 toast（撤销 = 从回收站还原）。trash 是软删除，6s 内可一键撤销。
  function trashWithUndo(ids: string[], label: string) {
    const undoIds = [...ids];
    pushNote({
      title: ids.length > 1 ? `已删除 ${ids.length} 项` : '已删除',
      body: label,
      level: 'info',
      timeout: 6000,
      action: { label: '撤销', run: () => undoIds.forEach((id) => restoreFromTrash(id)) },
    });
  }

  // data = 可选的起始文件夹 id（桌面文件夹图标双击时传入）
  let { data }: { data?: unknown } = $props();

  // 只取一次初始值（窗口的 data 在 launch 时就定了、之后不变），故意非响应式
  // svelte-ignore state_referenced_locally
  let cwd = $state(typeof data === 'string' && getNode(data) ? data : 'root'); // 当前所在文件夹 id
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  let dragOverId = $state<string | null>(null); // 拖放时高亮的目标文件夹
  // 文件剪贴板：复制(cut=false)或剪切(cut=true)的一组源节点
  let clip = $state<{ ids: string[]; cut: boolean } | null>(null);
  let pasting = $state(false);
  // 多选：选中的节点 id 列表 + 上次点击的锚点（给 Shift 范围选）
  let selected = $state<string[]>([]);
  let lastClicked = $state<string | null>(null);

  // 排序 + 视图（每窗口内存态）
  let sortBy = $state<'name' | 'type' | 'size' | 'mtime'>('name');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let view = $state<'grid' | 'list'>('grid');

  function sizeOf(n: VNode): number {
    if (n.type === 'dir') return 0;
    return n.kind === 'binary' ? (n.size ?? 0) : (n.content?.length ?? 0);
  }
  // 排序：文件夹永远在前，组内按所选键 × 方向。默认 name/asc 与 children() 原序一致（零视觉变化）。
  function sortItems(arr: VNode[]): VNode[] {
    const dir = sortDir === 'asc' ? 1 : -1;
    const ext = (n: VNode) => n.name.slice(n.name.lastIndexOf('.') + 1).toLowerCase();
    return [...arr].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      let c = 0;
      if (sortBy === 'name') c = a.name.localeCompare(b.name, 'zh');
      else if (sortBy === 'type') c = ext(a).localeCompare(ext(b)) || a.name.localeCompare(b.name, 'zh');
      else if (sortBy === 'size') c = sizeOf(a) - sizeOf(b);
      else c = (a.updatedAt ?? 0) - (b.updatedAt ?? 0); // mtime
      return c * dir;
    });
  }
  function fmtSize(n: VNode): string {
    if (n.type === 'dir') return '—';
    const b = sizeOf(n);
    if (b >= 1048576) return (b / 1048576).toFixed(1) + 'M';
    if (b >= 1024) return (b / 1024).toFixed(1) + 'K';
    return b + 'B';
  }
  function fmtMtime(n: VNode): string {
    const d = new Date(n.updatedAt);
    const p = (x: number) => String(x).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 搜索：q 即时按名字过滤当前文件夹；aiHits 非空时改为展示 AI 语义搜索命中的文件（全盘）
  let q = $state('');
  let aiHits = $state<string[] | null>(null);
  let aiBusy = $state(false);
  let aiErr = $state('');
  // provider 感知：OpenAI 兼容端点（本地等）无需 key，仅 Anthropic 强制要 key（与 Assistant 一致）
  const hasKey = $derived(aiConfig.provider === 'openai' || !!aiConfig.apiKey);

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
    const filtered = needle ? base.filter((n) => n.name.toLowerCase().includes(needle)) : base;
    return sortItems(filtered);
  });
  const crumbs = $derived(pathSegments(cwd));

  // 导航即退出 AI 搜索结果（保留 q 作为新文件夹的名字过滤）
  function goTo(id: string) {
    aiHits = null;
    aiErr = '';
    cwd = id;
    clearSelection(); // 进新文件夹清掉选择
  }
  function clearSearch() {
    q = '';
    aiHits = null;
    aiErr = '';
    clearSelection();
  }

  // AI 语义搜索：把全盘文本文件的名字+内容片段交给模型，按相关性挑 id
  async function aiSearch() {
    clearSelection(); // 切到全盘搜索结果 → 清掉当前目录的选择，免计数跨视图
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
      return;
    }
    // 文件：受读权限约束（与终端 cat 一致）
    if (!permits(n, currentUser(), 4)) {
      sys.notify('权限不够', { body: `${n.name}：当前用户无读权限`, level: 'warn' });
      return;
    }
    sys.openApp(isImage(n) ? 'imageviewer' : 'textedit', { title: n.name, data: n.id });
  }

  // 改权限/属主（右键菜单用）。modeFile/modeDir 按类型取
  function chmod(n: VNode, fileMode: number, dirMode: number) {
    setMode(n.id, n.type === 'dir' ? dirMode : fileMode);
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
    if (renamingId && !rename(renamingId, renameText) && renameText.trim()) {
      sys.notify('重命名失败', { body: '该目录下已有同名项', level: 'warn' });
    }
    renamingId = null;
  }
  function del(n: VNode, e: Event) {
    e.stopPropagation();
    trash(n.id);
    selected = selected.filter((x) => x !== n.id);
    trashWithUndo([n.id], n.name);
  }

  // ── 多选 ──────────────────────────────────────────────
  // 点击选择：普通=单选；Ctrl/⌘=切换；Shift=从锚点到此的范围。
  function onItemClick(n: VNode, e: MouseEvent) {
    if (renamingId) return;
    if (e.ctrlKey || e.metaKey) {
      selected = selected.includes(n.id) ? selected.filter((x) => x !== n.id) : [...selected, n.id];
      lastClicked = n.id;
    } else if (e.shiftKey && lastClicked) {
      const ids = items.map((it) => it.id);
      const a = ids.indexOf(lastClicked);
      const b = ids.indexOf(n.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        selected = ids.slice(lo, hi + 1);
      }
    } else {
      selected = [n.id];
      lastClicked = n.id;
    }
  }
  function clearSelection() {
    selected = [];
    lastClicked = null;
  }
  // 对某节点操作时的「有效目标」：它在多选里就用整个多选，否则就这一个
  function effectiveTargets(n: VNode): string[] {
    return selected.length > 1 && selected.includes(n.id) ? [...selected] : [n.id];
  }
  function delTargets(ids: string[]) {
    const names = ids.map((id) => getNode(id)?.name).filter(Boolean);
    for (const id of ids) trash(id);
    selected = selected.filter((x) => !ids.includes(x));
    lastClicked = null;
    trashWithUndo(ids, names.slice(0, 3).join('、') + (names.length > 3 ? '…' : ''));
  }

  // 复制/剪切/粘贴（支持多选）。粘贴目标 = 当前文件夹（或指定文件夹）。剪切=move，复制=copyNode（递归、二进制复制字节）。
  function copyItem(n: VNode) {
    clip = { ids: effectiveTargets(n), cut: false };
  }
  function cutItem(n: VNode) {
    clip = { ids: effectiveTargets(n), cut: true };
  }
  async function paste(destId: string = cwd) {
    if (!clip || pasting) return;
    pasting = true;
    try {
      const wasCut = clip.cut;
      for (const id of clip.ids) {
        if (!getNode(id)) continue;
        if (wasCut) move(id, destId);
        else await copyNode(id, destId); // 复制可多次粘贴，clip 保留
      }
      if (wasCut) {
        clip = null; // 剪切一次性
        clearSelection(); // 被剪走的项已离开当前目录
      }
    } finally {
      pasting = false;
    }
  }

  function onItemMenu(e: MouseEvent, n: VNode) {
    const me = currentUser();
    const writable = permits(n, me, 2);
    const isOwner = (n.owner ?? DEFAULT_OWNER) === me;
    // 右键一个未选中的项 → 先把它设为唯一选择，避免「右键 A 却对之前选中的 B 操作」的困惑
    if (!selected.includes(n.id)) selected = [n.id];
    const tgts = effectiveTargets(n);
    const suffix = tgts.length > 1 ? ` ${tgts.length} 项` : '';
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
      { label: '复制' + suffix, icon: '📄', onClick: () => copyItem(n) },
      { label: '剪切' + suffix, icon: '✂️', onClick: () => cutItem(n) },
      ...(clip && n.type === 'dir' ? [{ label: `粘贴到此（${clip.ids.length}）`, icon: '📥', onClick: () => paste(n.id) }] : []),
      { label: '复制名称', icon: '📋', onClick: () => sys.clipboard.copy(n.name) },
      // 权限：在可读写 / 只读之间切（属主段），目录用 7xx、文件用 6xx
      writable
        ? { label: '设为只读', icon: '🔒', separator: true, onClick: () => chmod(n, 0o444, 0o555) }
        : { label: '设为可读写', icon: '🔓', separator: true, onClick: () => chmod(n, 0o644, 0o755) },
      { label: '设为私密 (600)', icon: '🙈', onClick: () => chmod(n, 0o600, 0o700) },
      ...(isOwner ? [] : [{ label: `归我所有 (${me})`, icon: '👤', onClick: () => setOwner(n.id, me) }]),
      { label: '删除' + suffix, icon: '🗑️', danger: true, separator: true, onClick: () => delTargets(tgts) },
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
    {#if clip}
      <button
        class="rounded-md bg-qz-accent/80 px-2 py-1 text-xs text-qz-accent-contrast hover:brightness-110 disabled:opacity-50"
        title={`粘贴${clip.cut ? '（剪切）' : ''}到当前文件夹`}
        disabled={pasting}
        onclick={() => paste()}>{pasting ? '粘贴中…' : clip.cut ? '📥 粘贴(剪)' : '📥 粘贴'}</button>
    {/if}
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

  <!-- 排序 + 视图切换 -->
  <div class="flex items-center gap-2 border-b border-qz-border px-3 py-1 text-[11px]">
    <span class="text-qz-muted">排序</span>
    <select
      bind:value={sortBy}
      class="rounded bg-qz-surface px-1.5 py-0.5 text-qz-text outline-none ring-1 ring-qz-border focus:ring-qz-accent"
    >
      <option value="name">名称</option>
      <option value="type">类型</option>
      <option value="size">大小</option>
      <option value="mtime">修改时间</option>
    </select>
    <button
      class="rounded px-1.5 py-0.5 text-qz-muted hover:bg-qz-elevated"
      title={sortDir === 'asc' ? '升序' : '降序'}
      onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')}>{sortDir === 'asc' ? '↑' : '↓'}</button>
    <div class="ml-auto flex gap-0.5">
      <button
        class="rounded px-1.5 py-0.5 hover:bg-qz-elevated"
        class:bg-qz-elevated={view === 'grid'}
        title="网格视图"
        onclick={() => (view = 'grid')}>▦</button>
      <button
        class="rounded px-1.5 py-0.5 hover:bg-qz-elevated"
        class:bg-qz-elevated={view === 'list'}
        title="列表视图"
        onclick={() => (view = 'list')}>☰</button>
    </div>
  </div>

  {#if aiHits}
    <div class="flex items-center gap-2 border-b border-qz-border bg-qz-accent/10 px-3 py-1 text-[11px] text-qz-muted">
      🤖 AI 搜索结果 · {items.length} 个 · 点 ✕ 返回
    </div>
  {:else if aiErr}
    <div class="border-b border-qz-border px-3 py-1 text-[11px] text-red-400">⚠️ {aiErr}</div>
  {/if}

  <!-- 多选操作条 -->
  {#if selected.length}
    <div class="flex items-center gap-2 border-b border-qz-border bg-qz-accent/10 px-3 py-1 text-[11px]">
      <span class="text-qz-text">已选 {selected.length} 项</span>
      <button class="rounded px-1.5 py-0.5 text-red-400 hover:bg-qz-elevated" onclick={() => delTargets([...selected])}>删除选中</button>
      <button class="ml-auto rounded px-1.5 py-0.5 text-qz-muted hover:bg-qz-elevated" onclick={clearSelection}>取消选择</button>
    </div>
  {/if}

  <!-- 重命名输入框（grid/list 复用，只差样式类） -->
  {#snippet renameBox(cls: string)}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="{cls} rounded bg-qz-surface px-1 text-xs text-qz-text outline-none ring-1 ring-qz-accent"
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
  {/snippet}

  <!-- 内容区：网格 / 列表两种视图，共享同一套交互（点击/双击/右键/拖拽/键盘） -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class={view === 'grid' ? 'grid flex-1 content-start gap-1 overflow-auto p-3' : 'flex flex-1 flex-col gap-0.5 overflow-auto p-2'}
    style={view === 'grid' ? 'grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));' : ''}
    onclick={clearSelection}
    onkeydown={(e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && clip) {
        e.preventDefault();
        paste();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault();
        delTargets([...selected]);
      }
    }}
  >
    {#each items as n (n.id)}
      {@const readable = permits(n, currentUser(), 4)}
      <div
        class="group/item relative hover:bg-qz-elevated {view === 'grid'
          ? 'flex flex-col items-center gap-1 rounded-lg p-2'
          : 'flex items-center gap-2 rounded-md px-2 py-1'}"
        class:ring-2={selected.includes(n.id)}
        class:ring-inset={selected.includes(n.id)}
        class:ring-qz-accent={selected.includes(n.id)}
        class:bg-qz-elevated={selected.includes(n.id)}
        style={dragOverId === n.id ? 'box-shadow: inset 0 0 0 2px var(--color-qz-accent)' : ''}
        title={`${modeStr(n)}  属主 ${n.owner ?? DEFAULT_OWNER}`}
        role="button"
        tabindex="0"
        draggable={renamingId !== n.id}
        ondragstart={(e) => e.dataTransfer?.setData('text/plain', n.id)}
        ondragover={n.type === 'dir' ? (e) => { e.preventDefault(); dragOverId = n.id; } : undefined}
        ondragleave={n.type === 'dir' ? () => { if (dragOverId === n.id) dragOverId = null; } : undefined}
        ondrop={n.type === 'dir' ? (e) => onDrop(e, n.id) : undefined}
        onclick={(e) => { e.stopPropagation(); onItemClick(n, e); }}
        ondblclick={() => open(n)}
        oncontextmenu={(e) => onItemMenu(e, n)}
        onkeydown={(e) => {
          if (e.key === 'Enter') open(n);
          else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault();
            copyItem(n);
          } else if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
            e.preventDefault();
            cutItem(n);
          }
        }}
      >
        {#if view === 'grid'}
          <div class="relative text-3xl">
            {iconFor(n)}
            {#if !readable}<span class="absolute bottom-0 right-0 text-[11px]" title="无读权限">🔒</span>{/if}
          </div>
          {#if renamingId === n.id}
            {@render renameBox('w-full text-center')}
          {:else}
            <span class="line-clamp-2 w-full text-center text-xs leading-tight">{n.name}</span>
            <span class="w-full truncate text-center text-[9px] text-qz-muted">{n.owner ?? DEFAULT_OWNER} · {accessStr(n, currentUser())}</span>
          {/if}
          <!-- 悬停操作 -->
          <div class="absolute right-1 top-1 hidden gap-0.5 group-hover/item:flex">
            <button class="grid h-5 w-5 place-items-center rounded bg-qz-surface/90 text-[10px] hover:bg-qz-surface" title="重命名" onclick={(e) => startRename(n, e)}>✏️</button>
            <button class="grid h-5 w-5 place-items-center rounded bg-qz-surface/90 text-[10px] hover:bg-qz-surface" title="删除" onclick={(e) => del(n, e)}>🗑️</button>
          </div>
        {:else}
          <!-- 列表行：图标 + 名字 + 大小 + 修改时间 + 属主·权限 -->
          <span class="relative shrink-0 text-xl">
            {iconFor(n)}
            {#if !readable}<span class="absolute -bottom-1 -right-1 text-[10px]" title="无读权限">🔒</span>{/if}
          </span>
          {#if renamingId === n.id}
            {@render renameBox('min-w-0 flex-1')}
          {:else}
            <span class="min-w-0 flex-1 truncate text-sm">{n.name}</span>
            <span class="hidden shrink-0 tabular-nums text-[11px] text-qz-muted sm:block" style="width:3.5rem;text-align:right">{fmtSize(n)}</span>
            <span class="hidden shrink-0 tabular-nums text-[11px] text-qz-muted sm:block" style="width:6rem;text-align:right">{fmtMtime(n)}</span>
            <span class="hidden shrink-0 truncate text-[11px] text-qz-muted md:block" style="width:6rem;text-align:right">{n.owner ?? DEFAULT_OWNER} {accessStr(n, currentUser())}</span>
          {/if}
          <!-- 悬停操作（行尾内联） -->
          <span class="hidden shrink-0 gap-0.5 group-hover/item:flex">
            <button class="grid h-5 w-5 place-items-center rounded bg-qz-surface/90 text-[10px] hover:bg-qz-surface" title="重命名" onclick={(e) => startRename(n, e)}>✏️</button>
            <button class="grid h-5 w-5 place-items-center rounded bg-qz-surface/90 text-[10px] hover:bg-qz-surface" title="删除" onclick={(e) => del(n, e)}>🗑️</button>
          </span>
        {/if}
      </div>
    {/each}

    {#if items.length === 0}
      <div class="grid place-items-center py-12 text-center text-sm text-qz-muted {view === 'grid' ? 'col-span-full' : ''}">
        {aiHits ? '没有命中' : q.trim() ? '没有匹配的文件' : '空文件夹'}
      </div>
    {/if}
  </div>
</div>
