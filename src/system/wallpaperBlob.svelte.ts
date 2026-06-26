import { settings } from './settings.svelte';
import { getBlob } from '../kernel/blobStore';

// ───────────────────────────────────────────────────────────
// 自定义图片壁纸的「解析层」：把 settings.customWallpaper（image 时存 blobId）
// 从 IndexedDB 取出 → createObjectURL → 暴露成一个响应式 URL，theme 读它拼进 --qz-wallpaper。
// 因为取 blob 是异步的、而 theme 的 token 计算是同步的，所以单独开一个 effect 解析 + 管 objectURL 生命周期（换图/清除时 revoke 旧的，防泄漏）。
// ───────────────────────────────────────────────────────────
let objUrl = $state('');
export function customWallpaperUrl(): string {
  return objUrl;
}

$effect.root(() => {
  $effect(() => {
    const cw = settings.customWallpaper;
    if (cw && cw.type === 'image' && cw.blobId) {
      let cancelled = false;
      void getBlob(cw.blobId).then((blob) => {
        if (cancelled || !blob) return;
        const prev = objUrl;
        objUrl = URL.createObjectURL(blob);
        if (prev) URL.revokeObjectURL(prev); // 换图后回收旧 objectURL
      });
      return () => {
        cancelled = true; // blobId 又变了：丢弃这次还没回来的解析
      };
    }
    // 非图片壁纸（纯色/预设）→ 回收并清空
    if (objUrl) {
      URL.revokeObjectURL(objUrl);
      objUrl = '';
    }
  });
});
