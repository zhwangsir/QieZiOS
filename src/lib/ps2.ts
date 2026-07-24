// ───────────────────────────────────────────────────────────
// M36：PS2 续行累积器 —— Terminal 多行输入的纯逻辑层。
// bash 手感：输入不完整（if 缺 fi、引号未闭合、heredoc 缺分隔行、行尾 \、尾部 | && ||）时
// 回车不执行，提示符变 PS2（>）继续读；完整那一刻拼接文本一次性交给 run 执行。
// 完整性判定复用 shell.needsContinuation（M35），本模块只管「逐行累积 + 完整即清空」。
// ───────────────────────────────────────────────────────────
import { needsContinuation } from './shell';

export interface Ps2Acc {
  buf: string[]; // 已累积的续行（不含当前正在输入的行）
}

export const ps2New = (): Ps2Acc => ({ buf: [] });

// 推入一行：拼接受完整性判定。完整 → 返回拼接文本并清空缓冲（累积器可立即复用）；
// 不完整 → done=false，text 是当前累积内容（供调用方预览/调试，通常不用）。
export function ps2Push(acc: Ps2Acc, line: string): { done: boolean; text: string } {
  acc.buf.push(line);
  const text = acc.buf.join('\n');
  if (needsContinuation(text)) return { done: false, text };
  acc.buf.length = 0;
  return { done: true, text };
}

// 取消续行（Ctrl+C / Ctrl+D）：丢弃已累积内容，回到 PS1。
export function ps2Cancel(acc: Ps2Acc): void {
  acc.buf.length = 0;
}

// 是否处于续行中（决定提示符显示 PS1 还是 PS2）。
export const ps2Active = (acc: Ps2Acc): boolean => acc.buf.length > 0;
