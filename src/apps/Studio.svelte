<script lang="ts">
  import { studioDraft, STARTER_CODE } from '../system/studioDraft.svelte';
  import { saveUserApp, getUserApp } from './userApps.svelte';
  import { CAPABILITIES, ALL_CAP_KEYS, capsToTools } from '../system/appSdk';
  import Sandbox from './Sandbox.svelte';
  import CodeMirror from './CodeMirror.svelte';

  // data.editAppId = 从「我的 App」点编辑进来 → 载入那个 App 的代码、之后保存即更新它
  let { data }: { data?: unknown } = $props();

  // svelte-ignore state_referenced_locally
  let previewCode = $state(studioDraft.code); // 喂给 Sandbox 的代码（只在「运行」时更新，不随打字变）
  let runKey = $state(0);
  let showHelp = $state(false);
  let showCaps = $state(false);

  // 当前选中的能力（新草稿默认全开，方便试；编辑时载入该 App 声明的）
  let capKeys = $state<string[]>([...ALL_CAP_KEYS]);
  // 预览用的允许工具集——capKeys 一变就重算，正在跑的预览下次调用即按新权限放行
  const previewCaps = $derived(capsToTools(capKeys));

  // 保存为 App 的表单
  let showSave = $state(false);
  let saveName = $state('');
  let saveIcon = $state('🧩');
  let editId = $state<string | null>(null);
  let editName = $state('');

  // 以「编辑」打开时，把目标 App 的代码 + 声明的能力载入（只做一次）
  let loaded = false;
  $effect(() => {
    if (loaded) return;
    const id =
      data && typeof data === 'object' && 'editAppId' in data
        ? String((data as { editAppId: unknown }).editAppId)
        : '';
    if (!id) return;
    const a = getUserApp(id);
    if (a) {
      loaded = true;
      editId = a.id;
      editName = a.name;
      saveIcon = a.icon;
      capKeys = a.caps ? [...a.caps] : [...ALL_CAP_KEYS];
      studioDraft.code = a.code;
      run();
    }
  });

  function toggleCap(k: string) {
    capKeys = capKeys.includes(k) ? capKeys.filter((x) => x !== k) : [...capKeys, k];
  }

  function run() {
    previewCode = studioDraft.code;
    runKey++;
  }
  function resetCode() {
    studioDraft.code = STARTER_CODE;
    editId = null;
    editName = '';
    run();
  }

  function openSave() {
    saveName = editName || '';
    showSave = true;
  }
  function doSave() {
    const name = saveName.trim() || '未命名 App';
    editId = saveUserApp({
      id: editId ?? undefined,
      name,
      icon: saveIcon.trim() || '🧩',
      code: studioDraft.code,
      caps: capKeys,
    });
    editName = name;
    showSave = false;
  }

</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 工具栏 -->
  <div class="flex shrink-0 items-center gap-2 border-b border-qz-border px-3 py-1.5">
    <span class="text-xs text-qz-muted">🛠️ 开发者{editName ? ` · 编辑「${editName}」` : ''}</span>
    <button
      class="rounded-md bg-qz-accent px-2.5 py-1 text-xs font-medium text-qz-accent-contrast transition-transform active:scale-95"
      onclick={run}>▶ 运行</button>
    <button class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110" onclick={openSave}
      >💾 {editId ? '更新 App' : '保存为 App'}</button>
    <button class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110" onclick={resetCode}
      >重置示例</button>
    <button
      class="rounded-md bg-qz-elevated px-2 py-1 text-xs hover:brightness-110"
      class:ring-1={showCaps}
      class:ring-qz-accent={showCaps}
      onclick={() => (showCaps = !showCaps)}>🔐 能力 {capKeys.length}/{ALL_CAP_KEYS.length}</button>
    <button
      class="ml-auto rounded-md px-2 py-1 text-xs text-qz-muted hover:bg-qz-elevated"
      onclick={() => (showHelp = !showHelp)}>{showHelp ? '收起' : '？SDK'}</button>
  </div>

  <!-- 能力声明：勾哪个，预览/装上后才放行哪个；没勾的 qz 调用会被宿主拒掉 -->
  {#if showCaps}
    <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-qz-border bg-qz-surface/60 px-3 py-2">
      <span class="text-[11px] text-qz-muted">这个 App 可以：</span>
      {#each CAPABILITIES as c (c.key)}
        <button
          class="rounded-md px-2 py-1 text-[11px] transition"
          class:bg-qz-accent={capKeys.includes(c.key)}
          class:text-qz-accent-contrast={capKeys.includes(c.key)}
          class:bg-qz-elevated={!capKeys.includes(c.key)}
          class:opacity-50={!capKeys.includes(c.key)}
          title={c.desc}
          onclick={() => toggleCap(c.key)}>{c.icon} {c.label}</button>
      {/each}
    </div>
  {/if}

  <!-- 保存表单 -->
  {#if showSave}
    <div class="flex shrink-0 items-center gap-2 border-b border-qz-border bg-qz-surface/60 px-3 py-2">
      <input
        class="w-12 rounded-md bg-qz-surface px-2 py-1 text-center text-base outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        bind:value={saveIcon}
        maxlength="2"
        aria-label="图标"
      />
      <input
        class="min-w-0 flex-1 rounded-md bg-qz-surface px-2 py-1 text-xs outline-none ring-1 ring-qz-border focus:ring-qz-accent"
        placeholder="App 名称"
        bind:value={saveName}
        onkeydown={(e) => {
          if (e.key === 'Enter') doSave();
          else if (e.key === 'Escape') (showSave = false);
        }}
      />
      <button
        class="rounded-md bg-qz-accent px-3 py-1 text-xs font-medium text-qz-accent-contrast active:scale-95"
        onclick={doSave}>{editId ? '更新' : '保存'}</button>
      <button class="rounded-md px-2 py-1 text-xs text-qz-muted hover:bg-qz-elevated" onclick={() => (showSave = false)}
        >取消</button>
    </div>
  {/if}

  {#if showHelp}
    <div class="shrink-0 border-b border-qz-border bg-qz-surface/60 px-3 py-2 text-[11px] leading-relaxed text-qz-muted">
      代码跑在沙箱 iframe，用全局 <code class="text-qz-text">qz</code> 调系统：
      <code class="text-qz-text">qz.launchApp(id)</code> · <code class="text-qz-text">qz.listApps()</code> ·
      <code class="text-qz-text">qz.createFile(name,内容)</code> · <code class="text-qz-text">qz.writeFile(id,内容)</code> ·
      <code class="text-qz-text">qz.setTheme(&#123;accent,mode&#125;)</code> · <code class="text-qz-text">await qz.ask('问题')</code>（AI）。都返回 Promise。<br />
      <span class="text-qz-text">IPC：</span><code class="text-qz-text">qz.emit('事件', 数据)</code> ·
      <code class="text-qz-text">qz.on('事件', (数据,来自)=&gt;…)</code>（App 间 / 和系统消息互通）。
    </div>
  {/if}

  <!-- 编辑器 | 预览 -->
  <div class="flex min-h-0 flex-1">
    <div class="h-full w-1/2 border-r border-qz-border">
      <CodeMirror bind:value={studioDraft.code} />
    </div>
    <div class="h-full w-1/2">
      <Sandbox code={previewCode} {runKey} caps={previewCaps} appId="studio-preview" />
    </div>
  </div>
</div>
