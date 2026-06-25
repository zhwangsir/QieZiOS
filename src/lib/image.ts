// 图片工具：读文件 → data URL、按最长边缩放压成 JPEG。
// 为什么缩放：视觉模型按像素吃 token，原图又大又贵又慢；而且对话要持久化进
// localStorage（容量有限），缩到 ~1024px / JPEG 后体积小一两个量级，足够看清内容。

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('读取文件失败'));
    fr.readAsDataURL(file);
  });
}

// 把任意图片 data URL 缩放到最长边 ≤ maxDim，输出 JPEG data URL（透明背景会被填白底）。
export function downscaleImage(src: string, maxDim = 1024, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('无法创建画布上下文'));
      ctx.fillStyle = '#fff'; // JPEG 不支持透明 → 先铺白底
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

// File → 缩放后的 JPEG data URL（非图片返回 null）
export async function imageFileToThumb(file: File, maxDim = 1024): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  const raw = await fileToDataURL(file);
  return downscaleImage(raw, maxDim);
}
