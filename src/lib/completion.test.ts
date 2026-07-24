// Tab 补全引擎测试：lastWord 引号切分 / LCP / 命令位 / 路径（绝对·相对·..·隐藏·虚拟）/ 命令感知。
// 动态数据（命令/App/用户/服务/pid/作业号）走 CompletionSource 注入 → 不 import shell.ts 大依赖图。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// mock blobStore（测试环境没有 IndexedDB，与 vfs.test.ts 同手法）
vi.mock('../kernel/blobStore', () => ({
  putBlob: vi.fn(),
  getBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

import { vfs, createDir, createFile } from '../kernel/vfs.svelte';
import { completeLine, lastWord, longestCommonPrefix, tokenize, type CompletionSource } from './completion';

const SRC: CompletionSource = {
  commands: ['ls', 'cd', 'cat', 'pwd', 'source', 'kill', 'man', 'open', 'su', 'systemctl', 'pkg', 'fg', 'sudo'],
  apps: ['terminal', 'files'],
  users: ['root', 'qiezi'],
  services: ['schedd', 'syncd'],
  pids: [101, 102],
  jobNums: [1, 2],
  env: ['HOME', 'PATH', 'USER', 'HOSTNAME', 'PWD'],
};

let dir1 = '';

// 每个用例前重建最小测试树（与 vfs.test.ts 同手法）：
// root/ ├ dir1/inner.txt ├ file-a.txt ├ file-b.txt ├ readme.md └ .hidden
beforeEach(() => {
  for (const id of Object.keys(vfs.nodes)) if (id !== 'root') delete vfs.nodes[id];
  vfs.nodes.root = {
    id: 'root',
    name: '根目录',
    type: 'dir',
    parentId: null,
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  dir1 = createDir('root', 'dir1');
  createFile(dir1, 'inner.txt', 'x');
  createFile('root', 'file-a.txt', 'a');
  createFile('root', 'file-b.txt', 'b');
  createFile('root', 'readme.md', 'r');
  createFile('root', '.hidden', 'h');
});

describe('lastWord · 引号感知切分', () => {
  it('空行', () => {
    expect(lastWord('')).toEqual({ head: '', word: '', quote: null });
  });
  it('单词', () => {
    expect(lastWord('ls')).toEqual({ head: '', word: 'ls', quote: null });
  });
  it('多词取最后一词', () => {
    expect(lastWord('cat foo bar')).toEqual({ head: 'cat foo ', word: 'bar', quote: null });
  });
  it('尾部空格 → 正在输入新的空词', () => {
    expect(lastWord('ls ')).toEqual({ head: 'ls ', word: '', quote: null });
  });
  it('未闭合双引号 → 词内容含空格', () => {
    expect(lastWord('cat "hello wo')).toEqual({ head: 'cat ', word: 'hello wo', quote: '"' });
  });
  it('未闭合单引号', () => {
    expect(lastWord("cat 'ab")).toEqual({ head: 'cat ', word: 'ab', quote: "'" });
  });
  it('已闭合引号不影响后续词', () => {
    expect(lastWord('cat "a" b')).toEqual({ head: 'cat "a" ', word: 'b', quote: null });
  });
});

describe('longestCommonPrefix', () => {
  it('空数组', () => expect(longestCommonPrefix([])).toBe(''));
  it('单串返回自身', () => expect(longestCommonPrefix(['abc'])).toBe('abc'));
  it('公共前缀', () => expect(longestCommonPrefix(['file-a', 'file-b'])).toBe('file-'));
  it('无公共前缀', () => expect(longestCommonPrefix(['ab', 'cd'])).toBe(''));
});

describe('completeLine · 命令位', () => {
  it('空行 Tab 不响（不刷全部命令）', () => {
    expect(completeLine('', 'root', SRC)).toEqual({});
  });
  it('唯一命令补全 + 空格', () => {
    expect(completeLine('pw', 'root', SRC)).toEqual({ input: 'pwd ' });
  });
  it('多候选无公共前缀进展 → 列候选', () => {
    expect(completeLine('c', 'root', SRC)).toEqual({ candidates: ['cd', 'cat'] });
  });
  it('多候选有公共前缀 → 只补到 LCP', () => {
    // 's' → source/su/systemctl LCP='s' 无进展；'so' → source 唯一
    expect(completeLine('so', 'root', SRC)).toEqual({ input: 'source ' });
  });
});

describe('completeLine · 路径补全', () => {
  it('唯一文件补全 + 空格', () => {
    expect(completeLine('cat read', 'root', SRC)).toEqual({ input: 'cat readme.md ' });
  });
  it('空词列出当前目录非隐藏项（目录带 /；cwd 即根时含虚拟挂载点）', () => {
    expect(completeLine('ls ', 'root', SRC)).toEqual({
      candidates: ['dir1/', 'file-a.txt', 'file-b.txt', 'readme.md', 'proc/', 'dev/'],
    });
  });
  it('隐藏文件规则：不带 . 不出现，带 . 才补', () => {
    // 上面 'ls ' 已验证 .hidden 不出现；这里显式输 .
    expect(completeLine('cat .', 'root', SRC)).toEqual({ input: 'cat .hidden ' });
  });
  it('多候选 LCP 有进展 → 补到公共前缀（bash 第一次 Tab 手感）', () => {
    expect(completeLine('cat f', 'root', SRC)).toEqual({ input: 'cat file-' });
  });
  it('多候选 LCP 无进展 → 列候选', () => {
    expect(completeLine('cat file-', 'root', SRC)).toEqual({ candidates: ['file-a.txt', 'file-b.txt'] });
  });
  it('目录唯一 → 加 / 不加空格（可继续往深补）', () => {
    expect(completeLine('cat di', 'root', SRC)).toEqual({ input: 'cat dir1/' });
  });
  it('子路径续补', () => {
    expect(completeLine('cat dir1/i', 'root', SRC)).toEqual({ input: 'cat dir1/inner.txt ' });
  });
  it('绝对路径', () => {
    expect(completeLine('cat /dir1/i', 'root', SRC)).toEqual({ input: 'cat /dir1/inner.txt ' });
  });
  it('.. 上级目录', () => {
    expect(completeLine('cat ../rea', dir1, SRC)).toEqual({ input: 'cat ../readme.md ' });
  });
  it('根目录补全带虚拟挂载点（与 ls 一致）', () => {
    expect(completeLine('ls /', 'root', SRC)).toEqual({
      candidates: ['dir1/', 'file-a.txt', 'file-b.txt', 'readme.md', 'proc/', 'dev/'],
    });
  });
  it('目录部分不存在 → 不响', () => {
    expect(completeLine('cat nope/x', 'root', SRC)).toEqual({});
  });
  it('目录部分是文件 → 不响', () => {
    expect(completeLine('cat readme.md/x', 'root', SRC)).toEqual({});
  });
});

describe('completeLine · 虚拟路径（/proc /dev）', () => {
  it('/pro → /proc/', () => {
    expect(completeLine('ls /pro', 'root', SRC)).toEqual({ input: 'ls /proc/' });
  });
  it('/proc/ 列出版本/运行时间（测试环境无进程）', () => {
    expect(completeLine('ls /proc/', 'root', SRC)).toEqual({ candidates: ['version', 'uptime'] });
  });
  it('/dev/cl → /dev/clipboard', () => {
    expect(completeLine('cat /dev/cl', 'root', SRC)).toEqual({ input: 'cat /dev/clipboard ' });
  });
});

describe('completeLine · 命令感知', () => {
  it('cd 只补目录（文件/虚拟挂载点不出现）', () => {
    expect(completeLine('cd ', 'root', SRC)).toEqual({ input: 'cd dir1/' }); // 唯一目录候选直接补全
    expect(completeLine('cd fi', 'root', SRC)).toEqual({});
    expect(completeLine('cd pr', 'root', SRC)).toEqual({}); // proc 是虚拟挂载点，cd 进不去
  });
  it('man 补命令名', () => {
    expect(completeLine('man c', 'root', SRC)).toEqual({ candidates: ['cd', 'cat'] });
    expect(completeLine('man pw', 'root', SRC)).toEqual({ input: 'man pwd ' });
  });
  it('kill 补 pid：先 LCP 再列候选', () => {
    expect(completeLine('kill 1', 'root', SRC)).toEqual({ input: 'kill 10' });
    expect(completeLine('kill 10', 'root', SRC)).toEqual({ candidates: ['101', '102'] });
  });
  it('su 补用户名', () => {
    expect(completeLine('su q', 'root', SRC)).toEqual({ input: 'su qiezi ' });
  });
  it('systemctl 第一参数补子命令', () => {
    expect(completeLine('systemctl st', 'root', SRC)).toEqual({ candidates: ['status', 'start', 'stop'] });
    expect(completeLine('systemctl statu', 'root', SRC)).toEqual({ input: 'systemctl status ' });
  });
  it('systemctl 第二参数（动作后）补服务名', () => {
    expect(completeLine('systemctl start s', 'root', SRC)).toEqual({ candidates: ['schedd', 'syncd'] });
    expect(completeLine('systemctl start sc', 'root', SRC)).toEqual({ input: 'systemctl start schedd ' });
  });
  it('pkg 补子命令', () => {
    expect(completeLine('pkg i', 'root', SRC)).toEqual({ input: 'pkg install ' });
  });
  it('fg 补作业号', () => {
    expect(completeLine('fg ', 'root', SRC)).toEqual({ candidates: ['1', '2'] });
  });
  it('flag 参数（-开头）不补', () => {
    expect(completeLine('ls -', 'root', SRC)).toEqual({});
  });
  it('sudo 第一参数补命令名', () => {
    expect(completeLine('sudo k', 'root', SRC)).toEqual({ input: 'sudo kill ' });
  });
  it('sudo 透传：sudo kill 后补 pid', () => {
    expect(completeLine('sudo kill 10', 'root', SRC)).toEqual({ candidates: ['101', '102'] });
  });
  it('open 混合候选：App id 与路径一起算 LCP', () => {
    // files(App) + file-a.txt/file-b.txt(路径) → LCP 'file'
    expect(completeLine('open f', 'root', SRC)).toEqual({ input: 'open file' });
  });
  it('open 唯一 App 补全', () => {
    expect(completeLine('open te', 'root', SRC)).toEqual({ input: 'open terminal ' });
  });
  it('open 带 / 明确走路径（不掺 App）', () => {
    expect(completeLine('open dir1/i', 'root', SRC)).toEqual({ input: 'open dir1/inner.txt ' });
  });
});

describe('completeLine · 引号感知', () => {
  it('文件补全自动闭合引号 + 空格', () => {
    expect(completeLine('cat "read', 'root', SRC)).toEqual({ input: 'cat "readme.md" ' });
  });
  it('目录补全不闭合引号（可继续往深补）', () => {
    expect(completeLine('cat "di', 'root', SRC)).toEqual({ input: 'cat "dir1/' });
  });
});

describe('tokenize · 引号感知操作符分词', () => {
  it('普通分词', () => {
    expect(tokenize('ls -la foo')).toEqual(['ls', '-la', 'foo']);
  });
  it('管道操作符单独成词（无空格也行）', () => {
    expect(tokenize('ls | grep x')).toEqual(['ls', '|', 'grep', 'x']);
    expect(tokenize('ls|grep')).toEqual(['ls', '|', 'grep']);
  });
  it('引号内的 | 不是操作符', () => {
    expect(tokenize('echo "a|b" | cat')).toEqual(['echo', 'a|b', '|', 'cat']);
  });
  it('&& || ; & 各自成词', () => {
    expect(tokenize('a && b || c ; d & e')).toEqual(['a', '&&', 'b', '||', 'c', ';', 'd', '&', 'e']);
  });
  it('重定向 > >> <；2> 拆成 2 与 >', () => {
    expect(tokenize('echo hi > a >> b < c')).toEqual(['echo', 'hi', '>', 'a', '>>', 'b', '<', 'c']);
    expect(tokenize('ls 2> err.txt')).toEqual(['ls', '2', '>', 'err.txt']);
  });
  it('空行/纯空白', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('completeLine · 管道感知（bash：| 后是新命令位）', () => {
  it('ls | <Tab> → 列全部命令候选', () => {
    expect(completeLine('ls | ', 'root', SRC)).toEqual({ candidates: [...SRC.commands] });
  });
  it('ls | sy<Tab> → 唯一命令补全 + 空格', () => {
    expect(completeLine('ls | sy', 'root', SRC)).toEqual({ input: 'ls | systemctl ' });
  });
  it('&& 后同样是命令位', () => {
    expect(completeLine('make && pw', 'root', SRC)).toEqual({ input: 'make && pwd ' });
  });
  it('ls | grep f<Tab> → 按 grep 的参数位补路径（不是命令）', () => {
    expect(completeLine('ls | grep f', 'root', SRC)).toEqual({ input: 'ls | grep file-' });
  });
  it('ls | kill 10<Tab> → 按段内真实命令补 pid', () => {
    expect(completeLine('ls | kill 10', 'root', SRC)).toEqual({ candidates: ['101', '102'] });
  });
  it('ls | sudo kill 10<Tab> → sudo 透传跨段仍生效', () => {
    expect(completeLine('ls | sudo kill 10', 'root', SRC)).toEqual({ candidates: ['101', '102'] });
  });
});

describe('completeLine · 重定向感知（> 后补路径）', () => {
  it('echo hi > <Tab> → 列当前目录非隐藏项（含虚拟挂载点，与 ls 一致）', () => {
    expect(completeLine('echo hi > ', 'root', SRC)).toEqual({
      candidates: ['dir1/', 'file-a.txt', 'file-b.txt', 'readme.md', 'proc/', 'dev/'],
    });
  });
  it('cat > f<Tab> → 补到公共前缀', () => {
    expect(completeLine('cat > f', 'root', SRC)).toEqual({ input: 'cat > file-' });
  });
  it('cat >> file-a<Tab> → 唯一文件补全 + 空格', () => {
    expect(completeLine('cat >> file-a', 'root', SRC)).toEqual({ input: 'cat >> file-a.txt ' });
  });
  it('cat > di<Tab> → 目录加 /（可续钻）', () => {
    expect(completeLine('cat > di', 'root', SRC)).toEqual({ input: 'cat > dir1/' });
  });
  it('ls 2> r<Tab> → 2 已消费，> 后仍补路径', () => {
    expect(completeLine('ls 2> r', 'root', SRC)).toEqual({ input: 'ls 2> readme.md ' });
  });
  it('重定向目标已写完 → 回到当前命令参数位补路径', () => {
    expect(completeLine('cat > out.txt read', 'root', SRC)).toEqual({ input: 'cat > out.txt readme.md ' });
  });
});

describe('completeLine · 环境变量补全（$ 前缀）', () => {
  it('$HOM<Tab> → 唯一候选补全 + 空格', () => {
    expect(completeLine('echo $HOM', 'root', SRC)).toEqual({ input: 'echo $HOME ' });
  });
  it('$HO<Tab> → 多候选列出来（保留 $ 前缀）', () => {
    expect(completeLine('echo $HO', 'root', SRC)).toEqual({ candidates: ['$HOME', '$HOSTNAME'] });
  });
  it('$US<Tab> → 唯一候选补全', () => {
    expect(completeLine('echo $US', 'root', SRC)).toEqual({ input: 'echo $USER ' });
  });
  it('$HOME 已写完（空格分隔）→ 进入新词位走路径补全', () => {
    expect(completeLine('echo $HOME ', 'root', SRC)).toEqual({
      candidates: ['dir1/', 'file-a.txt', 'file-b.txt', 'readme.md', 'proc/', 'dev/'],
    });
  });
  it('引号内 $HOM<Tab> → 保留引号 + 补全', () => {
    expect(completeLine('echo "$HOM', 'root', SRC)).toEqual({ input: 'echo "$HOME ' });
  });
  it('cd $HOM<Tab> → 命令感知下仍补环境变量', () => {
    expect(completeLine('cd $HOM', 'root', SRC)).toEqual({ input: 'cd $HOME ' });
  });
  it('管道段内 $HO<Tab> → 正常补全', () => {
    expect(completeLine('ls | grep $HO', 'root', SRC)).toEqual({ candidates: ['$HOME', '$HOSTNAME'] });
  });
});
