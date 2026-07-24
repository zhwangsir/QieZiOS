<script lang="ts">
  import { spotlight, closeSpotlight } from './spotlightState.svelte';
  import { appRegistry } from '../apps/registry';
  import { appMeta, C } from '../apps/appList';
  import { userApps, type UserApp } from '../apps/userApps.svelte';
  import { launchUserApp } from '../apps/desktopApps.svelte';
  import { vfs, getNode, isImage, isMedia, type VNode } from '../kernel/vfs.svelte';
  import { processes, minimize, close } from '../kernel/processes.svelte';
  import { settings } from '../system/settings.svelte';
  import { recents } from '../system/recents.svelte';
  import { evalExpr } from '../lib/calc';
  import { sys } from '../system/sys';
  import { runAgent, type AiEvent, type ChatTurn } from '../system/ai';
  import { aiConfig, aiReady, AI_PRESETS, applyAiPreset, matchPreset } from '../system/aiConfig.svelte';
  import { chat } from '../system/assistantChat.svelte';
  import { toggleTheme } from '../system/theme.svelte';
  import { groupResults } from './spotlightGroups';
  import Icon from '../lib/Icon.svelte';

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
      run: toggleTheme },
    { id: 'emptytrash', label: '清空回收站', icon: '🗑️', keywords: '回收站 清空 trash empty 删除',
      run: () => sys.fs.emptyTrashWithNotify() },
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

  // ───────────────────────────────────────────────────────────
  // M7 · AI 命令面板：选中「问 AI」不再开助手窗口，面板内直接跑 agent loop。
  // 自然语言 → function calling → 真系统操作（executeTool），流式回显 + 工具标签。
  // 模型来源 = aiConfig（设备清单 AI_PRESETS 三预设，头部 chips 一键切换）。
  // ───────────────────────────────────────────────────────────
  interface AiTurn {
    role: 'user' | 'assistant';
    text: string;
    tools: string[];
  }
  let aiMode = $state(false);
  let aiTurns = $state<AiTurn[]>([]);
  let aiBusy = $state(false);
  let aiInput = $state('');
  let aiCtrl: AbortController | null = null;
  let aiScroller = $state<HTMLElement>();
  const aiOn = $derived(aiReady(aiConfig));
  const activePreset = $derived(matchPreset(aiConfig));

  // 打开时重置查询与选中项（含 AI 模式清场）
  $effect(() => {
    if (spotlight.open) {
      query = '';
      selected = 0;
      resetAi();
    }
  });

  // 新内容时对话区滚到底
  $effect(() => {
    aiTurns.length;
    aiTurns.at(-1)?.text;
    aiTurns.at(-1)?.tools.length;
    if (aiScroller) aiScroller.scrollTop = aiScroller.scrollHeight;
  });

  // AI 模式的 Esc：窗口级接（焦点可能在按钮上）→ 退出 AI 回搜索态，不关面板。
  // Desktop 全局快捷键在 spotlight.open 时整体让路，不冲突。
  $effect(() => {
    if (!spotlight.open || !aiMode) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitAiMode();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  function resetAi() {
    aiCtrl?.abort();
    aiMode = false;
    aiBusy = false;
    aiTurns = [];
    aiInput = '';
  }

  function enterAiMode(q: string) {
    resetAi(); // 掐掉上一轮流式 + 清场
    aiMode = true;
    if (q.trim()) ask(q.trim());
  }

  function exitAiMode() {
    resetAi();
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || aiBusy) return;
    aiInput = '';
    aiBusy = true;
    aiTurns.push({ role: 'user', text: q, tools: [] });
    aiTurns.push({ role: 'assistant', text: '', tools: [] });
    const i = aiTurns.length - 1; // 助手占位下标
    // 历史：占位之前的对话转成引擎消息（纯文本；面板不支持附图）
    const history: ChatTurn[] = aiTurns
      .slice(0, i)
      .filter((t) => t.text)
      .map((t) => ({ role: t.role, content: t.text }));
    aiCtrl = new AbortController();
    await runAgent(
      history,
      (e: AiEvent) => {
        const m = aiTurns[i];
        if (!m) return; // 防御：流式途中被清场
        if (e.type === 'text') m.text += e.text;
        else if (e.type === 'tool') m.tools.push(e.name);
        else if (e.type === 'error') m.text += (m.text ? '\n\n' : '') + e.message;
      },
      aiCtrl.signal,
    );
    aiBusy = false;
  }

  // 把面板里的对话接力给助手 App（chat 持久化全局共享），去那边继续聊/贴图
  function continueInAssistant() {
    aiCtrl?.abort();
    for (const t of aiTurns) chat.msgs.push({ role: t.role, text: t.text, tools: [...t.tools] });
    sys.openApp('assistant');
    closeSpotlight();
  }

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

  // M13.1：分组标题渲染（macOS Spotlight 式）。空查询时 file 组是「最近打开」，有查询时是「文件」（两者不同时出现）。
  const groups = $derived(groupResults(results, query.trim() ? '文件' : '最近打开'));

  function activate(r: Result) {
    if (r.kind === 'ai') {
      enterAiMode(r.query); // M7：面板内执行，不关 Spotlight
      return;
    }
    if (r.kind === 'userapp') {
      launchUserApp(r.app);
    } else if (r.kind === 'app') {
      sys.openApp(r.id);
    } else if (r.kind === 'action') {
      r.action.run();
    } else if (r.kind === 'calc') {
      sys.clipboard.copy(r.value); // Enter 复制结果到剪贴板
      sys.notify('已复制结果', { body: `${r.expr} = ${r.value}`, level: 'success', timeout: 1500, source: '聚焦' });
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
      class="h-min w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-qz-border qz-glass qz-glass-float"
      onpointerdown={(e) => e.stopPropagation()}
    >
      {#if aiMode}
        <!-- ── M7 AI 命令面板 ── -->
        <!-- 头部：返回 + 模型来源 chips（设备清单预设）+ 在助手中继续 -->
        <div class="flex items-center gap-1.5 border-b border-qz-border px-2 py-1.5">
          <button
            class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-qz-muted hover:bg-qz-elevated hover:text-qz-text"
            title="返回搜索（Esc）"
            onclick={exitAiMode}><Icon name="ChevronLeft" size={15} /></button>
          <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {#each AI_PRESETS as p (p.label)}
              <button
                class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] transition"
                class:bg-qz-accent={activePreset === p}
                class:text-qz-accent-contrast={activePreset === p}
                class:bg-qz-elevated={activePreset !== p}
                class:text-qz-muted={activePreset !== p}
                title={'模型来源：' + p.label}
                onclick={() => applyAiPreset(aiConfig, p)}>{p.short}</button>
            {/each}
          </div>
          {#if aiTurns.length}
            <button
              class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-qz-muted hover:bg-qz-elevated hover:text-qz-text"
              title="在助手中继续（对话接力到助手窗口）"
              onclick={continueInAssistant}><Icon name="ExternalLink" size={13} /></button>
          {/if}
        </div>
        {#if !aiOn}
          <button
            class="w-full shrink-0 border-b border-qz-border bg-qz-accent/15 px-3 py-1.5 text-left text-[11px] hover:bg-qz-accent/25"
            onclick={() => { sys.openApp('settings'); closeSpotlight(); }}
            ><span class="flex items-center gap-1"><Icon name="KeyRound" size={11} />还没配置 AI——点这里去「设置
              → AI」选模型 / 填 Key</span></button>
        {/if}

        <!-- 对话区 -->
        <div bind:this={aiScroller} class="max-h-96 space-y-2 overflow-auto p-3">
          {#if !aiTurns.length}
            <div class="px-4 py-6 text-center text-xs text-qz-muted">
              <div class="mb-2 flex justify-center"><Icon name="Bot" size={26} strokeWidth={1.5} /></div>
              直接下命令，系统真执行。试试「打开终端」「新建一个叫 笔记 的文件夹」「把主题调成暗色」。
            </div>
          {/if}
          {#each aiTurns as t, ti (ti)}
            <div class="flex" class:justify-end={t.role === 'user'}>
              <div
                class="max-w-[85%] rounded-xl px-2.5 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap"
                class:bg-qz-accent={t.role === 'user'}
                class:text-qz-accent-contrast={t.role === 'user'}
                class:bg-qz-elevated={t.role === 'assistant'}
              >
                {#if t.tools.length}
                  <div class="mb-1 flex flex-wrap gap-1">
                    {#each t.tools as tool, i (i)}
                      <span class="flex items-center gap-0.5 rounded bg-qz-surface/70 px-1 py-0.5 text-[10px] text-qz-muted"
                        ><Icon name="⚙" size={9} />{tool}</span>
                    {/each}
                  </div>
                {/if}
                {t.text || (aiBusy && ti === aiTurns.length - 1 && t.role === 'assistant' ? '…' : '')}
              </div>
            </div>
          {/each}
        </div>

        <!-- 输入区 -->
        <div class="flex items-center gap-2 border-t border-qz-border p-2">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="min-w-0 flex-1 rounded-md bg-qz-surface px-2.5 py-1.5 text-[13px] outline-none ring-1 ring-qz-border focus:ring-qz-accent disabled:opacity-50"
            placeholder="继续追问…（Esc 返回搜索）"
            bind:value={aiInput}
            disabled={aiBusy}
            autofocus
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                ask(aiInput);
                e.preventDefault();
              }
            }}
          />
          {#if aiBusy}
            <button
              class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-qz-elevated text-qz-text transition-transform active:scale-95"
              title="停止"
              onclick={() => { aiCtrl?.abort(); aiBusy = false; }}><Icon name="Square" size={12} /></button>
          {:else}
            <button
              class="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-qz-accent text-qz-accent-contrast transition-transform active:scale-95 disabled:opacity-40"
              title="发送"
              disabled={!aiInput.trim()}
              onclick={() => ask(aiInput)}><Icon name="SendHorizontal" size={13} /></button>
          {/if}
        </div>
      {:else}
        <!-- ── 搜索模式（原样） ── -->
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="w-full bg-transparent px-4 py-3 text-base text-qz-text outline-none placeholder:text-qz-muted"
          placeholder="搜索 App、文件（含正文）、动作，或问 AI…"
          bind:value={query}
          autofocus
          onkeydown={onKey}
        />
        {#if results.length}
          <div class="max-h-80 overflow-auto border-t border-qz-border pt-1 pb-2">
            <!-- M13.1：两层 each——外层分组（macOS Spotlight 式分组标题），内层结果项。
                 selected 仍走扁平索引（item.i 恒等于原数组下标），键盘循环/Enter 激活零改动。
                 M14.2：标题与结果行左对齐（同 px-3），组间间距 pt-2 pb-1 拉开层级。 -->
            {#each groups as g (g.title)}
              <h3 class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-qz-muted">{g.title}</h3>
              {#each g.items as { r, i } (r.kind === 'app' ? 'app:' + r.id : r.kind === 'userapp' ? 'user:' + r.app.id : r.kind === 'action' ? 'act:' + r.action.id : r.kind === 'file' ? 'file:' + r.node.id : r.kind === 'calc' ? 'calc' : 'ai')}
              <button
                class="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
                class:bg-qz-elevated={i === selected}
                onpointerenter={() => (selected = i)}
                onclick={() => activate(r)}
              >
                {#if r.kind === 'app' || r.kind === 'userapp'}
                  <!-- M9.1 收尾：仅 App 类结果带 28×28 迷你 squircle 底板（app 取 appMeta color，userapp 缺省石墨）；
                       action/file/calc/ai 保持裸图标（macOS Spotlight 同理：文档/动作无彩底） -->
                  <span
                    class="grid h-7 w-7 shrink-0 place-items-center text-white"
                    style="border-radius: 22.37%; background: {r.kind === 'app' ? (appMeta[r.id]?.color ?? C.graphite) : C.graphite};
                           box-shadow: inset 0 1px 1px rgb(255 255 255 / 0.28), 0 2px 5px rgb(0 0 0 / 0.3);"
                  ><Icon name={r.kind === 'app' ? r.icon : r.app.icon} size={14} /></span>
                {:else}
                  <span class="shrink-0 text-qz-text"
                    ><Icon
                      name={r.kind === 'ai' ? '🤖' : r.kind === 'calc' ? '🧮' : r.kind === 'action' ? r.action.icon : r.icon}
                      size={18}
                    /></span>
                {/if}
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">
                    {#if r.kind === 'app'}{r.title}{:else if r.kind === 'userapp'}{r.app.name}{:else if r.kind === 'action'}{r.action.label}{:else if r.kind === 'file'}{r.node.name}{:else if r.kind === 'calc'}{r.expr} <span class="text-qz-muted">=</span> <span class="font-medium text-qz-text">{r.value}</span>{:else}问
                      AI：{r.query}{/if}
                  </span>
                  {#if r.kind === 'file' && r.sub}
                    <span class="truncate text-xs text-qz-muted">{r.sub}</span>
                  {:else if r.kind === 'calc'}
                    <!-- M13.1：行尾 kind 标签随分组标题下线，calc 的 Enter 提示挪到副标题 -->
                    <span class="text-xs text-qz-muted">Enter 复制结果</span>
                  {/if}
                </span>
              </button>
              {/each}
            {/each}
          </div>
        {:else}
          <!-- M14.2：空态文案（原 results.length===0 时整段不渲染，下方空白） -->
          <div class="px-4 py-8 text-center text-xs text-qz-muted">没有匹配的结果</div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
