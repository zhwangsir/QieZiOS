// 极简、安全的 Markdown -> HTML（先转义、再套有限标签 -> 不会被 AI 输出 XSS）。
// 支持：代码块、行内 code、粗体、标题、列表、链接、换行。
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(src: string): string {
  const blocks: string[] = [];
  // 先抽出代码块占位（哨兵 @@CB0@@ 正文几乎不会出现、过转义不变）
  let s = src.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, code: string) => {
    blocks.push(
      '<pre class="my-1 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-relaxed"><code>' +
        escapeHtml(code.replace(/\n$/, '')) +
        '</code></pre>',
    );
    return '@@CB' + (blocks.length - 1) + '@@';
  });

  s = escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code class="rounded bg-black/25 px-1">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,6}\s+(.*)$/gm, '<div class="mt-1 font-semibold">$1</div>')
    .replace(/^\s*[-*]\s+(.*)$/gm, '<div class="pl-3">- $1</div>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer" class="text-qz-accent underline">$1</a>',
    )
    .replace(/\n/g, '<br>');

  // 还原代码块
  s = s.replace(/@@CB(\d+)@@/g, (_m, i: string) => blocks[+i]);
  return s;
}

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzMd: typeof renderMarkdown }).__qzMd = renderMarkdown;
}
