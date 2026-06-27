<script lang="ts">
  import { stickyNotes, removeNote, cycleColor, type StickyNote } from './notes.svelte';

  // 拖动状态：仅顶栏手柄可拖（与文本编辑互不干扰）
  let drag: { id: string; sx: number; sy: number; ox: number; oy: number } | null = null;

  function start(e: PointerEvent, n: StickyNote) {
    if (e.button !== 0) return;
    drag = { id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const n = stickyNotes.list.find((x) => x.id === drag!.id);
    if (!n) return;
    // 夹在视口内：右边至少留 40px 手柄可抓回（防拖出屏幕外丢失）、上不压顶栏、下留点边
    n.x = Math.min(Math.max(0, drag.ox + (e.clientX - drag.sx)), Math.max(0, window.innerWidth - 40));
    n.y = Math.min(Math.max(36, drag.oy + (e.clientY - drag.sy)), Math.max(36, window.innerHeight - 40));
  }
  function end(e: PointerEvent) {
    drag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
</script>

<!-- 便签层：容器穿透点击（空白处右键落到桌面），单张便签可交互。在窗口层之下。 -->
<div class="pointer-events-none absolute inset-0">
  {#each stickyNotes.list as n (n.id)}
    <div
      class="pointer-events-auto absolute flex w-44 flex-col overflow-hidden rounded-lg shadow-xl shadow-black/30 ring-1 ring-black/10"
      style="left: {n.x}px; top: {n.y}px; background: {n.color}"
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex cursor-move items-center justify-between px-1.5 py-0.5"
        style="background: rgb(0 0 0 / 0.06)"
        onpointerdown={(e) => start(e, n)}
        onpointermove={move}
        onpointerup={end}
      >
        <button class="rounded px-1 text-[11px] hover:bg-black/10" title="换颜色" onclick={() => cycleColor(n.id)}>🎨</button>
        <button class="rounded px-1 text-[11px] text-black/60 hover:bg-black/10" title="删除便签" onclick={() => removeNote(n.id)}>✕</button>
      </div>
      <textarea
        class="h-28 w-full resize-none bg-transparent px-2 py-1.5 text-[13px] leading-snug text-[#3a3320] outline-none placeholder:text-black/30"
        placeholder="便签…"
        bind:value={n.text}
      ></textarea>
    </div>
  {/each}
</div>
