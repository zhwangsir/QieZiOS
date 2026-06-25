<script lang="ts">
  import { untrack } from 'svelte';
  import type { EditorView } from '@codemirror/view';

  // 受控编辑器：value 双向绑定（打字写回，外部改也同步进编辑器）。
  let { value = $bindable() }: { value: string } = $props();

  let host = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let replaceDocFn: ((v: EditorView, text: string) => void) | null = null;
  let loading = $state(true);

  // 挂载：动态 import CodeMirror（首次进开发者才下载这个 chunk）→ 建编辑器
  $effect(() => {
    if (!host) return;
    let destroyed = false;
    import('../lib/codemirror').then((mod) => {
      if (destroyed || !host) return;
      replaceDocFn = mod.replaceDoc;
      view = mod.createEditor(host, untrack(() => value), (v) => (value = v));
      loading = false;
    });
    return () => {
      destroyed = true;
      view?.destroy();
      view = null;
      replaceDocFn = null;
    };
  });

  // 外部改 value → 同步进编辑器（打字触发的因值相等会被 replaceDoc 自身跳过，无循环）
  $effect(() => {
    const v = value;
    if (view && replaceDocFn) replaceDocFn(view, v);
  });
</script>

<div class="relative h-full">
  <div bind:this={host} class="h-full overflow-hidden"></div>
  {#if loading}
    <div class="pointer-events-none absolute inset-0 grid place-items-center text-xs text-qz-muted">
      加载编辑器…
    </div>
  {/if}
</div>
