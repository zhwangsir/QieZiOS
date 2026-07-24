// M36：PS2 续行累积器测试 —— 单行即完整、控制结构/heredoc/引号/反斜杠/尾部算符逐行累积、
// 完整即清空可复用、cancel 丢弃、active 状态判定。完整性语义本身由 shell.needsContinuation 测试覆盖（M35）。
import { describe, it, expect, vi } from 'vitest';

// mock blobStore（import 链经 shell → vfs → blobStore，测试环境没有 IndexedDB）
vi.mock('../kernel/blobStore', () => ({
  putBlob: vi.fn(),
  getBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

import { ps2New, ps2Push, ps2Cancel, ps2Active } from './ps2';

describe('ps2 · 续行累积（M36）', () => {
  it('单行完整命令：立即 done，不进入续行态', () => {
    const acc = ps2New();
    const r = ps2Push(acc, 'echo hi');
    expect(r.done).toBe(true);
    expect(r.text).toBe('echo hi');
    expect(ps2Active(acc)).toBe(false);
  });

  it('if 控制结构逐行累积：缺 fi 前 done=false，fi 后拼接完成', () => {
    const acc = ps2New();
    expect(ps2Push(acc, 'if true').done).toBe(false);
    expect(ps2Active(acc)).toBe(true);
    expect(ps2Push(acc, 'then echo hi').done).toBe(false);
    const r = ps2Push(acc, 'fi');
    expect(r.done).toBe(true);
    expect(r.text).toBe('if true\nthen echo hi\nfi');
    expect(ps2Active(acc)).toBe(false); // 完整即清空
  });

  it('heredoc 逐行：未遇分隔行一直续行，EOF 行后完成', () => {
    const acc = ps2New();
    expect(ps2Push(acc, 'cat <<EOF').done).toBe(false);
    expect(ps2Push(acc, 'hello').done).toBe(false);
    expect(ps2Push(acc, 'world').done).toBe(false);
    const r = ps2Push(acc, 'EOF');
    expect(r.done).toBe(true);
    expect(r.text).toBe('cat <<EOF\nhello\nworld\nEOF');
  });

  it('引号未闭合续行，补闭合后完成', () => {
    const acc = ps2New();
    expect(ps2Push(acc, "echo 'abc").done).toBe(false);
    const r = ps2Push(acc, "def'");
    expect(r.done).toBe(true);
    expect(r.text).toBe("echo 'abc\ndef'");
  });

  it('行尾孤立反斜杠续行，下一行拼接完成', () => {
    const acc = ps2New();
    expect(ps2Push(acc, 'echo a \\').done).toBe(false);
    const r = ps2Push(acc, 'b');
    expect(r.done).toBe(true);
    expect(r.text).toBe('echo a \\\nb');
  });

  it('尾部管道算符续行：echo a | 后补 grep a 完成', () => {
    const acc = ps2New();
    expect(ps2Push(acc, 'echo a |').done).toBe(false);
    const r = ps2Push(acc, 'grep a');
    expect(r.done).toBe(true);
    expect(r.text).toBe('echo a |\ngrep a');
  });

  it('完整即清空：累积器立刻可复用于下一条命令', () => {
    const acc = ps2New();
    ps2Push(acc, 'if true');
    ps2Push(acc, 'then echo x');
    expect(ps2Push(acc, 'fi').done).toBe(true);
    const r = ps2Push(acc, 'echo next');
    expect(r.done).toBe(true);
    expect(r.text).toBe('echo next'); // 不沾染上一轮的 if/fi
  });

  it('ps2Cancel 丢弃已累积内容，后续 push 从零开始', () => {
    const acc = ps2New();
    ps2Push(acc, 'if true');
    ps2Push(acc, 'then echo hi');
    ps2Cancel(acc);
    expect(ps2Active(acc)).toBe(false);
    const r = ps2Push(acc, 'echo fresh');
    expect(r.done).toBe(true);
    expect(r.text).toBe('echo fresh');
  });

  it('完整语法错（孤立 then）不续行：done 立即返回交给 run 报错', () => {
    const acc = ps2New();
    const r = ps2Push(acc, 'then');
    expect(r.done).toBe(true); // needsContinuation=false → 交 run 报「意外的 then」
  });
});
