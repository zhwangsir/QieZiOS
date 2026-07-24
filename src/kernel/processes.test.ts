// F3 z-index 规整化测试：验证层级相对顺序在压缩后保持不变，且 z 值不会无界增长。
import { describe, it, expect, beforeEach } from 'vitest';
import { processes, launch, focus, closeAll } from './processes.svelte';

describe('processes z-index 管理', () => {
  beforeEach(() => {
    closeAll();
  });

  it('新窗口置顶，focus 提升层级', () => {
    launch('a', 'A');
    launch('b', 'B');
    const [a, b] = processes;
    expect(b.z).toBeGreaterThan(a.z);
    focus(a.id);
    expect(a.z).toBeGreaterThan(b.z);
  });

  it('z 值超过阈值时规整化，相对顺序保持', () => {
    launch('a', 'A');
    launch('b', 'B');
    launch('c', 'C');
    const [a, b, c] = processes;
    // 600 次 focus 模拟长时间使用：一旦 nextZ 越过 500 阈值，
    // allocZ 内的 normalizeZ 会立即压缩，z 值应始终保持有界。
    for (let i = 0; i < 600; i++) focus(c.id);
    const zs = processes.map((p) => p.z);
    expect(Math.max(...zs)).toBeLessThan(600);
    // 相对顺序保持：c 被反复聚焦应在最上，且 c > b
    const sorted = [...processes].sort((x, y) => x.z - y.z);
    expect(sorted[sorted.length - 1].id).toBe(c.id);
    expect(c.z).toBeGreaterThan(b.z);
  });
});
