// ───────────────────────────────────────────────────────────
// 行编辑纯函数 · Terminal 的 readline 风格 Ctrl 键族内功
// ───────────────────────────────────────────────────────────
// 全部操作「文本 + 光标位置」二元组（与 input 元素的 value/selectionStart 语义对齐），
// 返回新状态，不碰 DOM —— Terminal 拿到结果后一次性写回 input 并 setSelectionRange。
// 词边界采用 bash C-w 语义：空白（空格/Tab）分隔的「词」。比 readline 的 alnum 词更直觉，
// 且 C-w / M-b / M-f 三处共用同一套边界，行为可预测、好测试。

export interface EditState {
  text: string;
  pos: number; // 光标位置（0..text.length，selectionStart 语义）
  killed?: string; // kill 类操作删下的文本（Ctrl+U/K/W → 进 kill ring 供 Ctrl+Y 粘贴；无删除/移动类编辑不设）
}

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t';

// Ctrl+U（unix-line-discard）：删「光标→行首」，光标归 0。killed = 删下的一段（无删除不设）。
export function killToStart(s: EditState): EditState {
  return { text: s.text.slice(s.pos), pos: 0, killed: s.text.slice(0, s.pos) || undefined };
}

// Ctrl+K（kill-line）：删「光标→行尾」，光标不动。killed = 删下的一段（无删除不设）。
export function killToEnd(s: EditState): EditState {
  return { text: s.text.slice(0, s.pos), pos: s.pos, killed: s.text.slice(s.pos) || undefined };
}

// 回退到上一个词头：先回跳词前空白，再回跳词体。
// 已在行首/词头空白全无时原地不动（幂等，连按不炸）。
export function wordBack(text: string, pos: number): number {
  let i = Math.max(0, Math.min(pos, text.length));
  while (i > 0 && isSpace(text[i - 1])) i--;
  while (i > 0 && !isSpace(text[i - 1])) i--;
  return i;
}

// 前进到当前/下一个词尾：先跳过词前空白，再跳过词体。
// 已在行尾时原地不动。与 wordBack 不对称是刻意的（b→词头，f→词尾，emacs/bash 惯例）。
export function wordForward(text: string, pos: number): number {
  let i = Math.max(0, Math.min(pos, text.length));
  while (i < text.length && isSpace(text[i])) i++;
  while (i < text.length && !isSpace(text[i])) i++;
  return i;
}

// Ctrl+W（unix-word-rubout）：删「光标前一个词 + 词前空白」，光标落到删除处。
// bash 手感：`sudo rm -rf /tmp/foo▮` → C-w → `sudo rm -rf /tmp/▮`。killed = 删下的一段。
export function killWordBack(s: EditState): EditState {
  const start = wordBack(s.text, s.pos);
  if (start === s.pos) return { text: s.text, pos: s.pos }; // 行首/无词可删：不动
  return { text: s.text.slice(0, start) + s.text.slice(s.pos), pos: start, killed: s.text.slice(start, s.pos) };
}

// Ctrl+T（transpose-chars）：交换光标前一字符与光标处字符，光标前进一位。
// 光标在行尾时交换最后两字符、光标不动；不足两字符（行首/单字符/空）不动。
export function transposeChars(s: EditState): EditState {
  const n = s.text.length;
  // 行尾：交换 n-2 与 n-1
  if (s.pos >= n) {
    if (n < 2) return { text: s.text, pos: s.pos };
    const arr = [...s.text];
    [arr[n - 2], arr[n - 1]] = [arr[n - 1], arr[n - 2]];
    return { text: arr.join(''), pos: s.pos };
  }
  // 行中（pos>=1）：交换 pos-1 与 pos，光标 +1
  if (s.pos < 1) return { text: s.text, pos: s.pos };
  const arr = [...s.text];
  [arr[s.pos - 1], arr[s.pos]] = [arr[s.pos], arr[s.pos - 1]];
  return { text: arr.join(''), pos: s.pos + 1 };
}

// Alt+D（kill-word）：删「光标→当前/下一词尾」，光标不动。killed = 删下的一段（无删除不设）。
// 与 wordForward 共用边界（先吞空白再吞词体），与 killWordBack 对称。
export function killWordForward(s: EditState): EditState {
  const end = wordForward(s.text, s.pos);
  if (end === s.pos) return { text: s.text, pos: s.pos }; // 行尾/无词可删：不动
  return { text: s.text.slice(0, s.pos) + s.text.slice(end), pos: s.pos, killed: s.text.slice(s.pos, end) };
}

// Ctrl+D（delete-char）：删光标处一字符，光标不动。不进 kill ring（与 kill 类区别）。
// 光标在行尾时无字符可删、不动（bash：行尾 Ctrl+D 触发 EOF，由调用方另行处理）。
export function deleteCharForward(s: EditState): EditState {
  if (s.pos >= s.text.length) return { text: s.text, pos: s.pos };
  return { text: s.text.slice(0, s.pos) + s.text.slice(s.pos + 1), pos: s.pos };
}

// ── kill ring 粘贴（Ctrl+Y / Alt+Y）────────────────────────────────────────
// Ctrl+Y（yank）：把 kill ring 顶部文本插入光标处，光标落到插入文本之后。
export function yank(s: EditState, text: string): EditState {
  return { text: s.text.slice(0, s.pos) + text + s.text.slice(s.pos), pos: s.pos + text.length };
}

// Alt+Y（yank-pop）：只能紧跟 yank/上一次 Alt+Y——用 ring 中下一项「替换」上次粘贴的文本段。
// lastYank = 上次粘贴段在文本中的区间（由调用方记忆）；替换后光标仍落段尾。
export function yankPop(s: EditState, newText: string, lastYank: { start: number; end: number }): EditState {
  const start = Math.max(0, Math.min(lastYank.start, s.text.length));
  const end = Math.max(start, Math.min(lastYank.end, s.text.length));
  return { text: s.text.slice(0, start) + newText + s.text.slice(end), pos: start + newText.length };
}
