<script lang="ts">
  import { spotlight, closeSpotlight } from './spotlightState.svelte';
  import { appRegistry } from '../apps/registry';
  import { userApps, type UserApp } from '../apps/userApps.svelte';
  import { launchUserApp } from '../apps/desktopApps.svelte';
  import { vfs, emptyTrash, getNode, isImage, isMedia, type VNode } from '../kernel/vfs.svelte';
  import { processes, minimize, close } from '../kernel/processes.svelte';
  import { settings } from '../system/settings.svelte';
  import { recents } from '../system/recents.svelte';
  import { evalExpr } from '../lib/calc';
  import { sys } from '../system/sys';

  // 系统动作命令（命令面板）：label/keywords 参与匹配，run 真执行
  interface ActionDef {
    id: string;
    label: string;
    icon: string;
    keywords: string;
    run: () => void;
  }
  const ACTIONS: ActionDef[] = [
    { id: 'theme', label: '切换明暗主题', icon: '🌓', keywords: '主题 明暗 暗色 明色 dark light theme',
      run: () => (settings.mode = settings.mode === 'dark' ? 'light' : 'dark') },
    { id: 'emptytrash', label: '清空回收站', icon: '🗑️', keywords: '回收站 清空 trash empty 删除',
      run: () => { emptyTrash(); sys.notify('已清空回收站', { level: 'success', timeout: 1500 }); } },
    { id: 'terminal', label: '打开终端', icon: '🖥️', keywords: '终端 terminal shell 命令行',
      run: () => sys.openApp('terminal') },
    { id: 'settings', label: '打开设置', icon: '⚙️', keywords: '设置 settings 偏好 主题 ai 壁纸',
      run: () => sys.openApp('settings') },
    { id: 'minall', label: '显示桌面 · 最小化所有窗口', icon: '🪟', keywords: '桌面 最小化 显示 desktop minimize',
      run: () => { for (const p of processes) if (!p.minimized) minimize(p.id); } },
    { id: 'closeall', label: '关闭所有窗口', icon: '🚪', keywords: '关闭 全部 close all 退出',
      run: () => { for (const p of [...processes]) close(p.id); } },
  ];

  type Result =
    | { kind: 'app'; id: string; title: string; icon: string }
    | { kind: 'userapp'; app: UserApp }
    | { kind: 'action'; action: ActionDef }
    | { kind: 'file'; node: VNode; icon: string; sub?: string }
    | { kind: 'calc'; expr: string; value: string }
    | { kind: 'ai'; query: string };

  // 内联计算器：query 像个算式（含运算符/括号/函数）且能被安全求值 → 给个结果，Enter 复制
  function calcResult(raw: string): { expr: string; value: string } | null {
    const q = raw.trim();
    // 预过滤：必须含运算符/括号/函数名，排除纯数字、纯词、App 名
    if (!/[+\-*/^()×÷√]|sqrt|sin|cos|tan|asin|acos|atan|log|ln|exp|abs|pi/i.test(q)) return null;
    try {
      const v = evalExpr(q);
      if (!Number.isFinite(v)) return null;
      return { expr: q, value: String(+v.toFixed(10)) };
    } catch {
      return null;
    }
  }

  let query = $state('');
  let selected = $state(0);

  // 打开时重置查询与选中项
  $effect(() => {
    if (spotlight.open) {
      query = '';
      selected = 0;
    }
  });

  // 文件内容命中时，截一段含关键词的片段做预览（名字命中而非内容命中则不显示）
  function snippetFor(n: VNode, q: string): string | undefined {
    if (n.type !== 'file' || n.kind === 'binary') return undefined;
    const content = n.content ?? '';
    const idx = content.toLowerCase().indexOf(q);
    if (idx < 0) return undefined;
    const start = Math.max(0, idx - 20);
    return (start > 0 ? '…' : '') + content.slice(start, idx + q.length + 25).replace(/\s+/g, ' ').trim() + '…';
  }

  const results = $derived.by<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const apps: Result[] = Object.entries(appRegistry)
      .filter(([, a]) => !a.hidden)
      .filter(([, a]) => !q || a.title.toLowerCase().includes(q))
      .map(([id, a]) => ({ kind: 'app', id, title: a.title, icon: a.icon }));
    // 空查询：最近用过的 App 浮到前面（最近度排序，未用过的保持原序在后）
    if (!q) {
      const rank = (id: string) => { const i = recents.apps.indexOf(id); return i < 0 ? 9999 : i; };
      apps.sort((a, b) => rank((a as { id: string }).id) - rank((b as { id: string }).id));
    }
    // 空查询：最近打开的文件置顶成「最近」区（解析 id、跳过已删/回收站项）
    const recentFiles: Result[] = !q
      ? recents.files
          .map((id) => getNode(id))
          .filter((n): n is VNode => !!n && n.parentId !== 'trash' && n.id !== 'root')
          .slice(0, 5)
          .map((n) => ({ kind: 'file', node: n, icon: n.type === 'dir' ? '📁' : '📄' }))
      : [];
    const installed: Result[] = userApps.list
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .map((a) => ({ kind: 'userapp', app: a }));
    // 动作命令：仅有输入时按 label/keywords 匹配
    const actions: Result[] = q
      ? ACTIONS.filter((a) => a.label.toLowerCase().includes(q) || a.keywords.toLowerCase().includes(q))
          .map((a) => ({ kind: 'action', action: a }))
      : [];
    // 文件：名字 或 文本正文 命中
    const files: Result[] = q
      ? Object.values(vfs.nodes)
          .filter((n) => n.id !== 'root' && n.parentId !== 'trash')
          .filter(
            (n) =>
              n.name.toLowerCase().includes(q) ||
              (n.type === 'file' && n.kind !== 'binary' && (n.content ?? '').toLowerCase().includes(q)),
          )
          .slice(0, 6)
          .map((n) => ({ kind: 'file', node: n, icon: n.type === 'dir' ? '📁' : '📄', sub: snippetFor(n, q) }))
      : [];
    // 内联计算器：算式置顶（Enter 复制结果），不抢 App——纯数字/词不会触发（calcResult 预过滤）
    const c = calcResult(query.trim());
    const calc: Result[] = c ? [{ kind: 'calc', expr: c.expr, value: c.value }] : [];
    // 有输入就在末尾挂一个「问 AI」入口（放最后，不抢 App 的默认 Enter）
    const ai: Result[] = query.trim() ? [{ kind: 'ai', query: query.trim() }] : [];
    return [...calc, ...recentFiles, ...apps, ...installed, ...actions, ...files].slice(0, 12).concat(ai);
  });

  function activate(r: Result) {
    if (r.kind === 'ai') {
      sys.openApp('assistant', { data: { ask: r.query } });
    } else if (r.kind === 'userapp') {
      launchUserApp(r.app);
    } else if (r.kind === 'app') {
      sys.openApp(r.id);
    } else if (r.kind === 'action') {
      r.action.run();
    } else if (r.kind === 'calc') {
      sys.clipboard.copy(r.value); // Enter 复制结果到剪贴板
      sys.notify('已复制结果', { body: `${r.expr} = ${r.value}`, level: 'success', timeout: 1500 });
    } else if (r.node.type === 'dir') {
      sys.openApp('files', { title: r.node.name, data: r.node.id });
    } else {
      // 按类型分流（与 Files/桌面/shell open 一致）：图片→图片查看器，音视频→媒体查看器，其余→记事本
      const viewer = isImage(r.node) ? 'imageviewer' : isMedia(r.node) ? 'mediaviewer' : 'textedit';
      sys.openApp(viewer, { title: r.node.name, data: r.node.id });
    }
    closeSpotlight();
  }

  function onKey(e: KeyboardEvent) {
    const n = results.length;
    if (e.key === 'ArrowDown') {
      selected = n ? (selected + 1) % n : 0;
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selected = n ? (selected - 1 + n) % n : 0;
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (results[selected]) activate(results[selected]);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeSpotlight();
    }
  }
</script>

{#if spotlight.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[10002] flex justify-center bg-black/20 pt-[12vh]"
    onpointerdown={closeSpotlight}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="h-min w-[min(520px,90vw)] overflow-hidden rounded-2xl border border-qz-border qz-glass shadow-2xl shadow-black/50"
      onpointerdown={(e) => e.stopPropagation()}
    >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="w-full bg-transparent px-4 py-3 text-base text-qz-text outline-none placeholder:text-qz-muted"
        placeholder="搜索 App、文件（含正文）、动作，或问 AI…"
        bind:value={query}
        autofocus
        onkeydown={onKey}
      />
      {#if results.length}
        <div class="max-h-80 overflow-auto border-t border-qz-border p-1">
          {#each results as r, i (r.kind === 'app' ? 'app:' + r.id : r.kind === 'userapp' ? 'user:' + r.app.id : r.kind === 'action' ? 'act:' + r.action.id : r.kind === 'file' ? 'file:' + r.node.id : r.kind === 'calc' ? 'calc' : 'ai')}
            <button
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
              class:bg-qz-elevated={i === selected}
              onpointerenter={() => (selected = i)}
              onclick={() => activate(r)}
            >
              <span class="shrink-0 text-lg"
                >{r.kind === 'ai' ? '🤖' : r.kind === 'calc' ? '🧮' : r.kind === 'userapp' ? r.app.icon : r.kind === 'action' ? r.action.icon : r.icon}</span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate">
                  {#if r.kind === 'app'}{r.title}{:else if r.kind === 'userapp'}{r.app.name}{:else if r.kind === 'action'}{r.action.label}{:else if r.kind === 'file'}{r.node.name}{:else if r.kind === 'calc'}{r.expr} = <span class="font-medium text-qz-text">{r.value}</span>{:else}问
                    AI：{r.query}{/if}
                </span>
                {#if r.kind === 'file' && r.sub}
                  <span class="truncate text-xs text-qz-muted">{r.sub}</span>
                {/if}
              </span>
              <span class="shrink-0 text-xs text-qz-muted"
                >{r.kind === 'app' ? 'App' : r.kind === 'userapp' ? '我的' : r.kind === 'action' ? '动作' : r.kind === 'file' ? '文件' : r.kind === 'calc' ? '计算 · Enter 复制' : 'AI'}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
