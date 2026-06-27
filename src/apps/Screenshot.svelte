<script lang="ts">
  import { createBinaryFile } from '../kernel/vfs.svelte';
  import { pushNote } from '../system/notifications.svelte';

  // 截图工具（G6）：navigator.mediaDevices.getDisplayMedia 抓一帧屏幕/窗口/标签页 →
  // 画进 canvas → PNG Blob → 可保存进 VFS（根目录）或下载到本机 + 预览。
  // ⚠️ getDisplayMedia 需用户手势 + 真实屏幕 + 浏览器选择器授权，无头环境验不了 → 真机验证。
  let status = $state<'idle' | 'capturing' | 'preview' | 'error'>('idle');
  let errMsg = $state('');
  let previewUrl = $state('');
  let blob = $state<Blob | null>(null);
  let dims = $state('');
  let saving = $state(false);
  // 当前活动的捕获流（非渲染态，仅作引用）：万一捕获途中窗口被关，卸载时也能停掉它，不漏流。
  let activeStream: MediaStream | null = null;

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  function tsName(): string {
    const d = new Date();
    const p = (x: number) => String(x).padStart(2, '0');
    return `截图-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
  }

  async function capture() {
    if (!supported) {
      errMsg = '当前浏览器不支持屏幕捕获（getDisplayMedia）';
      status = 'error';
      return;
    }
    status = 'capturing';
    errMsg = '';
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      activeStream = stream;
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play().catch(() => {}); // 静音播放一般允许；失败也继续，靠 metadata 拿尺寸
      // 等到拿到真实尺寸（loadedmetadata），带 1s 兜底超时（不用 rAF，避免后台标签页冻结）
      if (!video.videoWidth) {
        await new Promise<void>((res) => {
          video.onloadedmetadata = () => res();
          setTimeout(res, 1000);
        });
      }
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const cx = canvas.getContext('2d');
      if (!cx) throw new Error('无法创建画布上下文');
      cx.drawImage(video, 0, 0, w, h);
      // 只要一帧 → 立刻停掉流（否则浏览器顶部一直显示「正在共享」）
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      activeStream = null;
      const b = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (!b) throw new Error('截图编码失败');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      blob = b;
      previewUrl = URL.createObjectURL(b);
      dims = `${w}×${h}`;
      status = 'preview';
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      activeStream = null;
      // 用户在选择器里点了取消 → 静默回 idle，不算错误
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        status = 'idle';
        return;
      }
      errMsg = e instanceof Error ? e.message : String(e);
      status = 'error';
    }
  }

  async function saveToVfs() {
    if (!blob || saving) return;
    saving = true;
    try {
      const name = tsName();
      await createBinaryFile('root', name, blob);
      pushNote({ title: '已保存截图', body: `${name} → 根目录`, level: 'info' });
    } catch (e) {
      pushNote({ title: '保存失败', body: e instanceof Error ? e.message : String(e), level: 'warn' });
    } finally {
      saving = false;
    }
  }

  function download() {
    if (!blob) return;
    const name = tsName();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // 卸载时回收预览 URL + 停掉可能仍在跑的捕获流（窗口在捕获途中被关也不漏）
  $effect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    activeStream?.getTracks().forEach((t) => t.stop());
  });
</script>

<div class="flex h-full flex-col text-qz-text">
  <!-- 工具条 -->
  <div class="flex shrink-0 items-center gap-2 border-b border-qz-border px-3 py-2 text-xs">
    <button
      class="rounded-md bg-qz-accent px-3 py-1.5 font-medium text-qz-accent-contrast transition hover:brightness-110 disabled:opacity-50"
      disabled={status === 'capturing' || !supported}
      onclick={capture}>{status === 'capturing' ? '捕获中…' : status === 'preview' ? '🔄 重新截图' : '📸 截图'}</button>
    {#if status === 'preview'}
      <span class="text-qz-muted">{dims}</span>
      <div class="ml-auto flex gap-1.5">
        <button
          class="rounded-md bg-qz-elevated px-2.5 py-1.5 transition hover:brightness-110 disabled:opacity-50"
          disabled={saving}
          onclick={saveToVfs}>{saving ? '保存中…' : '💾 存到文件'}</button>
        <button
          class="rounded-md bg-qz-elevated px-2.5 py-1.5 transition hover:brightness-110"
          onclick={download}>⬇ 下载</button>
      </div>
    {/if}
  </div>

  <!-- 预览区 -->
  <div class="grid min-h-0 flex-1 place-items-center overflow-auto bg-black/25 p-3">
    {#if status === 'preview' && previewUrl}
      <img src={previewUrl} alt="屏幕截图预览" class="max-h-full max-w-full rounded object-contain shadow-lg" />
    {:else if status === 'error'}
      <div class="max-w-xs text-center text-sm text-red-400">⚠️ {errMsg}</div>
    {:else if status === 'capturing'}
      <span class="text-sm text-qz-muted">等待屏幕共享授权…</span>
    {:else}
      <div class="max-w-xs space-y-2 text-center text-sm text-qz-muted">
        <div class="text-5xl">📸</div>
        <p>点「截图」选择要捕获的屏幕、窗口或标签页。</p>
        <p class="text-[11px]">截图可存进文件系统或下载到本机。</p>
        {#if !supported}<p class="text-red-400">当前环境不支持屏幕捕获。</p>{/if}
      </div>
    {/if}
  </div>
</div>
