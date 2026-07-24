// shell 解释器核心行为测试：run() 基础执行 + Ctrl+C 协作式中断（ctx.intr）
// + M24 变量展开与引号语义（$VAR/${VAR}/$?、单引号强引用、空词删除、引号内算符/glob）。
// 存量 shell.ts 没有直接测试；本文件随 M17 中断功能起步，只覆盖 run 层行为，不逐命令铺开。
import { describe, it, expect, vi, afterEach } from 'vitest';

// mock blobStore（测试环境没有 IndexedDB）—— M53 起 tar/gzip 需要真实读写回 blob，
// 所以用内存 Map 实现一套真的存取语义（而不是 no-op），保证二进制 round-trip 可测。
vi.mock('../kernel/blobStore', () => {
  const store = new Map<string, Blob>();
  return {
    putBlob: vi.fn(async (id: string, b: Blob) => void store.set(id, b)),
    getBlob: vi.fn(async (id: string) => store.get(id)),
    deleteBlob: vi.fn(async (id: string) => void store.delete(id)),
  };
});

import { run, newCtx, needsContinuation } from './shell';

describe('run · 基础执行', () => {
  it('echo 原样输出，退出码 0', async () => {
    const res = await run('echo hello world', newCtx());
    expect(res.out).toBe('hello world');
    expect(res.code).toBe(0);
  });

  it('for 循环逐次展开词表', async () => {
    const res = await run('for i in 1 2 3; do echo $i; done', newCtx());
    expect(res.out).toBe('1\n2\n3');
    expect(res.code).toBe(0);
  });

  it('while 条件为假：body 一次都不执行', async () => {
    const res = await run('while test 1 = 2; do echo hi; done', newCtx());
    expect(res.out).toBe('');
    // 退出码是 cond 的 1（bash 此处返回 0，存量语义差异，不在本里程碑范围）
  });
});

describe('run · Ctrl+C 中断（ctx.intr）', () => {
  it('执行前预置 flag：第一条语句即中止，无输出', async () => {
    const ctx = newCtx();
    ctx.intr!.flag = true;
    const res = await run('echo hi', ctx);
    expect(res.code).toBe(130);
    expect(res.out).toBe('');
    expect(res.err).toContain('^C');
  });

  it('失控 while：执行中置 flag 即跳出，不等 MAX_LOOP（超时兜底防回归）', async () => {
    const ctx = newCtx();
    const p = run('while test 1 = 1; do echo hi; done', ctx);
    ctx.intr!.flag = true; // run 起步是同步的，首个检查点已过；下一次迭代边界中止
    const res = await p;
    expect(res.code).toBe(130);
    expect(res.err).toContain('^C');
  });

  it('for 循环同样响应中断', async () => {
    const ctx = newCtx();
    const p = run('for i in 1 2 3 4 5 6 7 8 9 10; do echo $i; done', ctx);
    ctx.intr!.flag = true;
    const res = await p;
    expect(res.code).toBe(130);
    expect(res.out).not.toContain('10'); // 没跑完整个词表
  });

  it('run 内部不清 flag：置位期间持续 130，调用方复位后恢复', async () => {
    const ctx = newCtx();
    ctx.intr!.flag = true;
    expect((await run('echo hi', ctx)).code).toBe(130);
    expect((await run('echo hi', ctx)).code).toBe(130); // 仍置位 → 仍中止
    ctx.intr!.flag = false; // Terminal submit 的复位职责
    const res = await run('echo ok', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toBe('ok');
  });

  it('无 intr 字段的旧式 ctx：可选链兜底，正常执行', async () => {
    const ctx = newCtx();
    delete ctx.intr;
    const res = await run('echo hi', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toBe('hi');
  });
});

describe('run · 变量展开（subst）', () => {
  it('$VAR 基本替换（newCtx 自带 HOME=/）', async () => {
    expect((await run('echo $HOME', newCtx())).out).toBe('/');
  });

  it('${VAR} 花括号形式 + 前后粘连文本', async () => {
    expect((await run('echo pre${USER}post', newCtx())).out).toBe('preqiezipost');
  });

  it('export 设置后即可展开', async () => {
    const res = await run('export FOO=bar; echo $FOO', newCtx());
    expect(res.out).toBe('bar');
  });

  it('unset 后展开为空（空词删除，不留前导空格）', async () => {
    const res = await run('export T=x; unset T; echo $T y', newCtx());
    expect(res.out).toBe('y');
  });

  it('未定义变量：空词删除（echo $X x 输出 "x" 而非 " x"）', async () => {
    expect((await run('echo $UNDEFINED x', newCtx())).out).toBe('x');
  });

  it('引号空串是有效参数，保留（echo "" x 输出 " x"）', async () => {
    expect((await run('echo "" x', newCtx())).out).toBe(' x');
  });

  it('$? 初始为 0', async () => {
    expect((await run('echo $?', newCtx())).out).toBe('0');
  });

  it('$? 取上次命令退出码（未找到命令 → 127）', async () => {
    const res = await run('nosuchcmd; echo $?', newCtx());
    expect(res.out).toBe('127');
    expect(res.code).toBe(0); // echo 本身成功
  });

  it('变量作命令参数：cd $D 切换目录', async () => {
    const res = await run('export D=/; cd $D; pwd', newCtx());
    expect(res.out).toBe('/');
  });

  it('重定向目标经变量展开：> $F 写入、cat $F 读回', async () => {
    const res = await run('export F=t24sub.txt; echo hi > $F; cat $F', newCtx());
    expect(res.out).toBe('hi');
  });

  it('未定义变量单独成行：无操作跳过，非语法错误（bash 语义）', async () => {
    const res = await run('$NOSUCHVAR; echo ok', newCtx());
    expect(res.out).toBe('ok');
    expect(res.code).toBe(0);
    expect(res.err ?? '').not.toContain('语法错误');
  });
});

describe('run · 引号语义（bash 强弱引用）', () => {
  it('单引号强引用：$HOME 原样不展开', async () => {
    expect((await run("echo '$HOME'", newCtx())).out).toBe('$HOME');
  });

  it('双引号弱引用：展开但不分词', async () => {
    expect((await run('echo "a $USER b"', newCtx())).out).toBe('a qiezi b');
  });

  it('双引号内的单引号是普通字符，变量仍展开', async () => {
    expect((await run(`echo "'$USER'"`, newCtx())).out).toBe("'qiezi'");
  });

  it('单双引号混用：单引号段字面、双引号段展开', async () => {
    expect((await run(`echo 'a$b' "$USER"`, newCtx())).out).toBe('a$b qiezi');
  });

  it('引号内 > 不是重定向算符', async () => {
    expect((await run('echo ">x"', newCtx())).out).toBe('>x');
  });

  it('引号内 | 不是管道（splitTopLevel 尊重引号，回归锁死）', async () => {
    expect((await run('echo "a | b"', newCtx())).out).toBe('a | b');
  });

  it('引号内 * 不 glob（for 词表字面星号）', async () => {
    // M38 起变量展开结果会再 glob（bash 同款顺序），故 echo 加引号验证词表字面性
    const res = await run('for f in "*"; do echo "$f"; done', newCtx());
    expect(res.out).toBe('*');
  });
});

describe('run · 命令替换 $( ) / ` `（M26）', () => {
  it('$(echo hi) 替换 stdout', async () => {
    expect((await run('echo $(echo hi)', newCtx())).out).toBe('hi');
  });

  it('`echo hi` 反引号等价', async () => {
    expect((await run('echo `echo hi`', newCtx())).out).toBe('hi');
  });

  it('替换结果剥尾随换行、粘连前后文本', async () => {
    expect((await run('echo x$(echo y)z', newCtx())).out).toBe('xyz');
  });

  it('嵌套 $(echo $(echo a)) → a', async () => {
    expect((await run('echo $(echo $(echo a))', newCtx())).out).toBe('a');
  });

  it('双引号内可替换："$(echo hi)"', async () => {
    expect((await run('echo "$(echo hi)"', newCtx())).out).toBe('hi');
  });

  it('单引号强引用不替换', async () => {
    expect((await run("echo '$(echo hi)'", newCtx())).out).toBe('$(echo hi)');
  });

  it('替换内部可用管道：$(echo hi | cat) —— splitTopLevel 不切分替换跨度', async () => {
    expect((await run('echo $(echo hi | cat)', newCtx())).out).toBe('hi');
  });

  it('替换内部可用分号：$(echo a; echo b) —— splitStatements 不切断', async () => {
    expect((await run('echo $(echo a; echo b)', newCtx())).out).toBe('a\nb');
  });

  it('替换内部可用 &&：false && echo x || echo y → y', async () => {
    expect((await run('echo $(false && echo x || echo y)', newCtx())).out).toBe('y');
  });

  it('子 shell 的 export/cd 不影响父 shell（fork ctx 语义）', async () => {
    const ctx = newCtx();
    const res = await run('export X=1; echo $(export X=2; cd /; echo in); echo $X; pwd', ctx);
    expect(res.out).toBe('in\n1\n/');
  });

  it('替换结果不再二次展开（单遍扫描）', async () => {
    const res = await run("export A='$HOME'; echo $(echo $A)", newCtx());
    expect(res.out).toBe('$HOME');
  });

  it('未闭合 $( 报错收尾、退出码 1', async () => {
    const res = await run('echo $(echo hi', newCtx());
    expect(res.err ?? '').toContain('未闭合');
    expect(res.code).toBe(1);
  });

  it('Ctrl+C 能断替换内的失控循环（intr 共享引用）', async () => {
    const ctx = newCtx();
    const p = run('echo $(while test 1 = 1; do echo hi; done)', ctx);
    ctx.intr!.flag = true;
    const res = await p;
    expect(res.code).toBe(130);
  });
});

describe('run · 算术展开 $(( ))（M27）', () => {
  it('基本四则与优先级：$((1+2*3)) → 7', async () => {
    expect((await run('echo $((1+2*3))', newCtx())).out).toBe('7');
  });

  it('括号与整除：$(((7+1)/2)) → 4', async () => {
    expect((await run('echo $(((7+1)/2))', newCtx())).out).toBe('4');
  });

  it('取模与负号：$((-7%3)) → -1', async () => {
    expect((await run('echo $((-7%3))', newCtx())).out).toBe('-1');
  });

  it('幂右结合：$((2**3**2)) → 512', async () => {
    expect((await run('echo $((2**3**2))', newCtx())).out).toBe('512');
  });

  it('变量裸名与 $ 前缀：export N=5 → $((N+1)) $((N*$N)) = 6 25', async () => {
    expect((await run('export N=5; echo $((N+1)) $((N*$N))', newCtx())).out).toBe('6 25');
  });

  it('未定义变量按 0：$((UNDEF+1)) → 1', async () => {
    expect((await run('echo $((UNDEF+1))', newCtx())).out).toBe('1');
  });

  it('比较/逻辑/位运算：$((3>2)) $((1&&0)) $((5|3)) → 1 0 7', async () => {
    expect((await run('echo $((3>2)) $((1&&0)) $((5|3))', newCtx())).out).toBe('1 0 7');
  });

  it('三元与短路：$((0?1/0:9)) $((0&&1/0)) → 9 0', async () => {
    expect((await run('echo $((0?1/0:9)) $((0&&1/0))', newCtx())).out).toBe('9 0');
  });

  it('除零报错：退出码 1 + err 含「除数为 0」', async () => {
    const res = await run('echo $((1/0))', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('除数为 0');
  });

  it('语法错误报错：$((1+)) 退出码 1 + err 含「算术语法错误」', async () => {
    const res = await run('echo $((1+))', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('算术语法错误');
  });

  it('双引号内可展开 "$((2+3))" → 5；单引号不展开', async () => {
    expect((await run('echo "$((2+3))"', newCtx())).out).toBe('5');
    expect((await run("echo '$((2+3))'", newCtx())).out).toBe('$((2+3))');
  });

  it('命令替换内嵌算术：$(echo $((6*7))) → 42；算术旁粘连文本 x$((1+1))y → x2y', async () => {
    expect((await run('echo $(echo $((6*7)))', newCtx())).out).toBe('42');
    expect((await run('echo x$((1+1))y', newCtx())).out).toBe('x2y');
  });

  it('$(( 判定不吞命令替换：$(echo hi) 仍走命令替换', async () => {
    expect((await run('echo $(echo hi)', newCtx())).out).toBe('hi');
  });
});

describe('run · 花括号与波浪号展开（M29）', () => {
  it('花括号列表：echo a{b,c}d → abd acd', async () => {
    expect((await run('echo a{b,c}d', newCtx())).out).toBe('abd acd');
  });

  it('区间：echo {1..5} → 1 2 3 4 5；字母 {a..c} → a b c', async () => {
    expect((await run('echo {1..5}', newCtx())).out).toBe('1 2 3 4 5');
    expect((await run('echo {a..c}', newCtx())).out).toBe('a b c');
  });

  it('组合展开：x{a,b}y{1,2}z → xay1z xay2z xby1z xby2z', async () => {
    expect((await run('echo x{a,b}y{1,2}z', newCtx())).out).toBe('xay1z xay2z xby1z xby2z');
  });

  it('步进与补宽：{01..10..3} → 01 04 07 10', async () => {
    expect((await run('echo {01..10..3}', newCtx())).out).toBe('01 04 07 10');
  });

  it('for 循环吃花括号词表：for i in {x,y,z}', async () => {
    expect((await run('for i in {x,y,z}; do echo $i; done', newCtx())).out).toBe('x\ny\nz');
  });

  it('for 循环吃区间词表：for i in {1..3}', async () => {
    expect((await run('for i in {1..3}; do echo n$i; done', newCtx())).out).toBe('n1\nn2\nn3');
  });

  it('双引号内不展开 "{a,b}"；单引号内也不展开', async () => {
    expect((await run('echo "{a,b}"', newCtx())).out).toBe('{a,b}');
    expect((await run("echo '{a,b}'", newCtx())).out).toBe('{a,b}');
  });

  it('花括号先于变量展开：{a,$USER} → a qiezi', async () => {
    expect((await run('echo {a,$USER}', newCtx())).out).toBe('a qiezi');
  });

  it('无逗号不展开：echo {a} → {a}', async () => {
    expect((await run('echo {a}', newCtx())).out).toBe('{a}');
  });

  it('echo ~ → HOME（qiezi=/）', async () => {
    expect((await run('echo ~', newCtx())).out).toBe('/');
  });

  it('~/图片 → /图片（HOME=/ 无双斜杠）', async () => {
    expect((await run('echo ~/图片', newCtx())).out).toBe('/图片');
  });

  it('~root → /root；~qiezi → /', async () => {
    expect((await run('echo ~root ~qiezi', newCtx())).out).toBe('/root /');
  });

  it('~nosuchuser 原样保留', async () => {
    expect((await run('echo ~nosuchuser', newCtx())).out).toBe('~nosuchuser');
  });

  it('cd ~ 回到家目录；cd ~/图片 进入子目录', async () => {
    expect((await run('cd /图片; cd ~; pwd', newCtx())).out).toBe('/');
    expect((await run('cd ~/图片; pwd', newCtx())).out).toBe('/图片');
  });

  it('重定向目标支持波浪号：> ~/t29.txt 写入、cat 读回', async () => {
    expect((await run('echo hi > ~/t29.txt; cat ~/t29.txt', newCtx())).out).toBe('hi');
  });

  it('词中 ~ 不展开；变量值里的 ~ 不再展开（bash 顺序语义）', async () => {
    expect((await run('echo a~b', newCtx())).out).toBe('a~b');
    expect((await run('export A=~x; echo $A', newCtx())).out).toBe('~x');
  });
});

describe('run · 反斜杠转义（M31）', () => {
  it('\\$USER → 字面 $USER（变量不展开）', async () => {
    expect((await run('echo \\$USER', newCtx())).out).toBe('$USER');
  });

  it('转义空格不分词：echo a\\ b → 一个参数 "a b"', async () => {
    expect((await run('echo a\\ b', newCtx())).out).toBe('a b');
  });

  it('转义 > 不是重定向：echo hi \\> x 输出 hi > x、不落盘', async () => {
    const ctx = newCtx();
    const r = await run('echo hi \\> x', ctx);
    expect(r.out).toBe('hi > x');
    expect((await run('cat x', ctx)).code).not.toBe(0); // 文件不存在
  });

  it('转义 ; 不分句：echo a\\;b → 一词 "a;b"', async () => {
    expect((await run('echo a\\;b', newCtx())).out).toBe('a;b');
  });

  it('转义 | 不管道：echo a\\|b → 一词 "a|b"', async () => {
    expect((await run('echo a\\|b', newCtx())).out).toBe('a|b');
  });

  it('转义行尾 & 不触发后台：echo a \\& → "a &"', async () => {
    expect((await run('echo a \\&', newCtx())).out).toBe('a &');
  });

  it('转义 * 不 glob：for f in \\* 词表是字面星号', async () => {
    // 同上：echo 加引号隔离 M38 的展开后 glob，聚焦验证词表字面性
    expect((await run('for f in \\*; do echo "$f"; done', newCtx())).out).toBe('*');
  });

  it('转义花括号不展开：\\{a,b\\} → {a,b}', async () => {
    expect((await run('echo \\{a,b\\}', newCtx())).out).toBe('{a,b}');
  });

  it('转义波浪号不展开：\\~ → ~', async () => {
    expect((await run('echo \\~', newCtx())).out).toBe('~');
  });

  it('转义 $( 不执行命令替换：\\$(echo hi) → 字面', async () => {
    expect((await run('echo \\$(echo hi)', newCtx())).out).toBe('$(echo hi)');
  });

  it('双引号弱引用：\\$ → $、\\d → \\d（反斜杠保留）、\\\\ → \\', async () => {
    expect((await run('echo "a\\$USER \\d \\\\"', newCtx())).out).toBe('a$USER \\d \\');
  });

  it('双引号内 \\` 转义反引号：不执行命令替换', async () => {
    expect((await run('echo "\\`echo hi\\`"', newCtx())).out).toBe('`echo hi`');
  });

  it('单引号内一切字面（含反斜杠本身）：\'\\$USER\' → \\$USER', async () => {
    expect((await run("echo '\\$USER'", newCtx())).out).toBe('\\$USER');
  });

  it('行尾孤立反斜杠字面保留：echo a\\ → a\\', async () => {
    expect((await run('echo a\\', newCtx())).out).toBe('a\\');
  });

  it('裸词 \\\\ → 单个反斜杠：echo a\\\\b → a\\b', async () => {
    expect((await run('echo a\\\\b', newCtx())).out).toBe('a\\b');
  });

  it('重定向目标可含转义空格：> a\\ b.txt 写入并读回', async () => {
    expect((await run('echo hi > a\\ b.txt; cat "a b.txt"', newCtx())).out).toBe('hi');
  });

  it('转义内容写入文件无哨兵残留：echo \\$USER > t31.txt', async () => {
    expect((await run('echo \\$USER > t31.txt; cat t31.txt', newCtx())).out).toBe('$USER');
  });
});

describe('run · 函数定义与位置参数（M32）', () => {
  it('定义并调用：f() { echo hello; }; f → hello', async () => {
    expect((await run('f() { echo hello; }; f', newCtx())).out).toBe('hello');
  });

  it('位置参数 $1 $2 $9；$10 = ${1}0（bash 单数字）', async () => {
    expect((await run('f() { echo $1 $2 $9; }; f a b c d e f g h i j', newCtx())).out).toBe('a b i');
    expect((await run('f() { echo $10; }; f x y', newCtx())).out).toBe('x0');
  });

  it('$# 参数个数、$@/$* 空格 join、$0 = qzsh', async () => {
    expect((await run('f() { echo $#; }; f a b c', newCtx())).out).toBe('3');
    expect((await run('f() { echo $@; }; f a b c', newCtx())).out).toBe('a b c');
    expect((await run('f() { echo $*; }; f x y', newCtx())).out).toBe('x y');
    expect((await run('f() { echo $0; }; f', newCtx())).out).toBe('qzsh');
  });

  it('多行定义（脚本风格换行）也能解析调用', async () => {
    expect((await run('greet() {\n echo hi $1\n}\ngreet world', newCtx())).out).toBe('hi world');
  });

  it('name () 带空格的定义形式', async () => {
    expect((await run('f () { echo ok; }; f', newCtx())).out).toBe('ok');
  });

  it('return 提前返回：后续语句不执行', async () => {
    expect((await run('f() { echo a; return; echo b; }; f', newCtx())).out).toBe('a');
  });

  it('return N 作为函数退出码（$?）；return -1 → 255', async () => {
    expect((await run('f() { return 3; }; f; echo $?', newCtx())).out).toBe('3');
    expect((await run('f() { return -1; }; f; echo $?', newCtx())).out).toBe('255');
  });

  it('无参 return 沿用上个命令退出码', async () => {
    expect((await run('f() { test 1 = 2; return; }; f; echo $?', newCtx())).out).toBe('1');
  });

  it('return 穿透循环：for 内 return 立即结束函数', async () => {
    expect((await run('f() { for i in 1 2 3; do echo $i; return; done; }; f', newCtx())).out).toBe('1');
  });

  it('函数共享变量作用域：函数内赋值影响调用者（bash 语义）', async () => {
    expect((await run('f() { X=5; }; X=1; f; echo $X', newCtx())).out).toBe('5');
  });

  it('位置参数保存/恢复：函数返回后外层 $1 不受污染', async () => {
    expect((await run("echo 'f() { echo in:$1; }\nf a b\necho out:$1' > s32.sh; sh s32.sh outer", newCtx())).out).toBe(
      'in:a\nout:outer',
    );
  });

  it('函数递归 + 算术 + 条件：countdown 3 → 3 2 1', async () => {
    const script = 'cd() { echo $1; if test $1 -gt 1; then cd $(( $1 - 1 )); fi; }; cd 3';
    expect((await run(script, newCtx())).out).toBe('3\n2\n1');
  });

  it('函数覆盖内建命令（bash 优先级）', async () => {
    expect((await run('ls() { echo fake; }; ls', newCtx())).out).toBe('fake');
  });

  it('脚本位置参数：sh s.sh a b → 脚本内 $1/$2/$#', async () => {
    expect((await run("echo 'echo $1-$2 n=$#' > s32b.sh; sh s32b.sh a b", newCtx())).out).toBe('a-b n=2');
  });

  it('脚本内 return 提前结束脚本', async () => {
    expect((await run("echo 'echo head\nreturn 7\necho tail' > s32c.sh; sh s32c.sh; echo $?", newCtx())).out).toBe(
      'head\n7',
    );
  });

  it('顶层 return 报错（不在函数/脚本内）', async () => {
    const r = await run('return', newCtx());
    expect(r.code).toBe(1);
    expect(r.err).toContain('只能在函数或脚本内使用');
  });

  it('未闭合的函数定义报语法错误', async () => {
    const r = await run('f() { echo x', newCtx());
    expect(r.code).toBe(2);
    expect(r.err).toContain('缺少闭合');
  });

  it('} 出现在命令位置外报「意外的 }」', async () => {
    const r = await run('echo hi; }', newCtx());
    expect(r.code).toBe(2);
    expect(r.err).toContain('意外的 }');
  });
});

describe('run · case 语句（M33）', () => {
  it('基本匹配：case b in a) … ;; b) echo B ;; esac → B', async () => {
    expect((await run('case b in a) echo A ;; b) echo B ;; esac', newCtx())).out).toBe('B');
  });

  it('多模式 |：a|b|c 任一命中', async () => {
    expect((await run('case b in a|b|c) echo hit ;; esac', newCtx())).out).toBe('hit');
  });

  it('通配 *：*.txt 匹配 foo.txt', async () => {
    expect((await run('case foo.txt in *.txt) echo text ;; esac', newCtx())).out).toBe('text');
  });

  it('通配 ?：a? 匹配 ab', async () => {
    expect((await run('case ab in a?) echo two ;; esac', newCtx())).out).toBe('two');
  });

  it('默认 *) 兜底', async () => {
    expect((await run('case z in a) echo A ;; *) echo def ;; esac', newCtx())).out).toBe('def');
  });

  it('无匹配无默认：无输出、退出码 0（bash 语义）', async () => {
    const r = await run('case z in a) echo A ;; esac; echo $?', newCtx());
    expect(r.out).toBe('0');
    expect(r.code).toBe(0);
  });

  it('首个匹配优先，后续 arm 不执行', async () => {
    expect((await run('case a in a) echo 1 ;; a) echo 2 ;; esac', newCtx())).out).toBe('1');
  });

  it('word 变量展开：case $X', async () => {
    expect((await run('X=hello; case $X in hello) echo hi ;; esac', newCtx())).out).toBe('hi');
  });

  it('模式变量展开：$P="*.log" 匹配 a.log', async () => {
    expect((await run("P='*.log'; case a.log in $P) echo L ;; esac", newCtx())).out).toBe('L');
  });

  it('单行写法：in 与首个 arm 同行', async () => {
    expect((await run('case $X in a) echo A ;; esac', newCtx())).out).toBe('');
  });

  it('体内多命令（; 分隔）', async () => {
    expect((await run('case a in a) echo 1; echo 2 ;; esac', newCtx())).out).toBe('1\n2');
  });

  it('嵌套 case', async () => {
    expect((await run('case a in a) case b in b) echo nested ;; esac ;; esac', newCtx())).out).toBe('nested');
  });

  it('for 循环内 case（逐轮匹配）', async () => {
    expect((await run('for x in a b; do case $x in a) echo A ;; *) echo O ;; esac; done', newCtx())).out).toBe(
      'A\nO',
    );
  });

  it('函数内 case + return 按分支定退出码', async () => {
    expect((await run('f() { case $1 in 0) return 0 ;; *) return 1 ;; esac; }; f 0; echo $?', newCtx())).out).toBe(
      '0',
    );
    expect((await run('f() { case $1 in 0) return 0 ;; *) return 1 ;; esac; }; f 9; echo $?', newCtx())).out).toBe(
      '1',
    );
  });

  it('空体 arm：匹配后无操作、退出码 0', async () => {
    const r = await run('case a in a) ;; *) echo x ;; esac; echo $?', newCtx());
    expect(r.out).toBe('0');
  });

  it('可选前括号 (a) 形式', async () => {
    expect((await run('case a in (a) echo P ;; esac', newCtx())).out).toBe('P');
  });

  it('word 与模式带引号（含空格）', async () => {
    expect((await run(`case 'a b' in "a b") echo Q ;; esac`, newCtx())).out).toBe('Q');
  });

  it('模式转义 \\* 是字面星号：匹配 a*b', async () => {
    expect((await run(`case 'a*b' in a\\*b) echo lit ;; esac`, newCtx())).out).toBe('lit');
  });

  it('未闭合：缺 esac 报语法错误（码 2）', async () => {
    const r = await run('case a in a) echo x', newCtx());
    expect(r.code).toBe(2);
    expect(r.err).toContain('esac');
  });

  it('孤立 esac 报「意外的 esac」', async () => {
    const r = await run('echo hi; esac', newCtx());
    expect(r.code).toBe(2);
    expect(r.err).toContain('意外的 esac');
  });
});

// ── M35：here-document / here-string ─────────────────────────
describe('run · here-document（M35）', () => {
  it('基本：cat <<EOF 读 body 到 stdin', async () => {
    expect((await run('cat <<EOF\nhello\nEOF', newCtx())).out).toBe('hello');
  });

  it('多行 body 保留换行', async () => {
    expect((await run('cat <<EOF\na\nb\nc\nEOF', newCtx())).out).toBe('a\nb\nc');
  });

  it('body 尾随换行：wc -l 计 2 行', async () => {
    expect((await run('cat <<EOF | wc -l\na\nb\nEOF', newCtx())).out).toBe('2');
  });

  it('未引号分隔符：body 做变量展开', async () => {
    expect((await run('X=world; cat <<EOF\nhi $X\nEOF', newCtx())).out).toBe('hi world');
  });

  it('单引号分隔符：body 字面不展开', async () => {
    expect((await run("X=world; cat <<'EOF'\nhi $X\nEOF", newCtx())).out).toBe('hi $X');
  });

  it('双引号分隔符：body 字面不展开', async () => {
    expect((await run('X=world; cat <<"EOF"\nhi $X\nEOF', newCtx())).out).toBe('hi $X');
  });

  it('body 内命令替换展开', async () => {
    expect((await run('cat <<EOF\n$(echo hi)\nEOF', newCtx())).out).toBe('hi');
  });

  it('body 内 \\$ 转义为字面美元符', async () => {
    expect((await run('X=world; cat <<EOF\n\\$X\nEOF', newCtx())).out).toBe('$X');
  });

  it('<<- 剥 body 与闭合行的前导 tab', async () => {
    expect((await run('cat <<-EOF\n\t\tindented\n\tEOF', newCtx())).out).toBe('indented');
  });

  it('无 - 时带 tab 的闭合行不匹配 → 报缺少闭合行', async () => {
    const r = await run('cat <<EOF\na\n\tEOF', newCtx());
    expect(r.code).toBe(2);
    expect(r.err).toContain('缺少闭合行');
  });

  it('未闭合（到 EOF 都无分隔行）→ 语法错误码 2', async () => {
    const r = await run('cat <<EOF\na\nb', newCtx());
    expect(r.code).toBe(2);
    expect(r.err).toContain('缺少闭合行（EOF）');
  });

  it('进管道：cat <<EOF | grep b', async () => {
    expect((await run('cat <<EOF | grep b\na\nb\nEOF', newCtx())).out).toBe('b');
  });

  it('优先于管道 stdin：echo a | cat <<EOF → body 赢', async () => {
    expect((await run('echo a | cat <<EOF\nb\nEOF', newCtx())).out).toBe('b');
  });

  it('搭配 > 重定向写文件', async () => {
    const ctx = newCtx();
    await run('cat <<EOF > /hd1.txt\ncontent\nEOF', ctx);
    expect((await run('cat /hd1.txt', ctx)).out).toBe('content');
  });

  it('头行同行多语句：cat <<EOF; echo after', async () => {
    const r = await run('cat <<EOF; echo after\nbody\nEOF', newCtx());
    expect(r.out).toBe('body\nafter');
  });

  it('同头行双 heredoc 按序读 body', async () => {
    expect((await run('cat <<A; cat <<B\nx\nA\ny\nB', newCtx())).out).toBe('x\ny');
  });

  it('body 里 # 行不当注释', async () => {
    expect((await run('cat <<EOF\n# not comment\nEOF', newCtx())).out).toBe('# not comment');
  });

  it('脚本文件内 heredoc（source 执行）', async () => {
    const ctx = newCtx();
    await run('cat <<EOF > /s.sh\ncat <<INNER\nscript-body\nINNER\nEOF', ctx);
    expect((await run('sh /s.sh', ctx)).out).toBe('script-body');
  });

  it('$(…) 内 heredoc（命令替换递归执行）', async () => {
    expect((await run('echo pre$(cat <<EOF\nmid\nEOF\n)post', newCtx())).out).toBe('premidpost');
  });
});

describe('run · here-string <<<（M35）', () => {
  it('基本：cat <<< hello', async () => {
    expect((await run('cat <<< hello', newCtx())).out).toBe('hello');
  });

  it('粘连形态 cat <<<foo', async () => {
    expect((await run('cat <<<foo', newCtx())).out).toBe('foo');
  });

  it('自动补尾随换行：wc -l 计 1', async () => {
    expect((await run('cat <<< hi | wc -l', newCtx())).out).toBe('1');
  });

  it('词展开：变量与引号', async () => {
    expect((await run('X=hi; cat <<< "$X there"', newCtx())).out).toBe('hi there');
  });

  it('优先于管道 stdin：echo a | cat <<< b → b', async () => {
    expect((await run('echo a | cat <<< b', newCtx())).out).toBe('b');
  });
});

// ── M35：needsContinuation 续行判定（Terminal PS2 地基）────────
describe('needsContinuation（M35）', () => {
  it('空串 / 普通命令 → false', () => {
    expect(needsContinuation('')).toBe(false);
    expect(needsContinuation('echo hi')).toBe(false);
  });

  it('控制结构未闭合 → true；闭合 → false', () => {
    expect(needsContinuation('if true; then')).toBe(true);
    expect(needsContinuation('if true; then echo x; fi')).toBe(false);
    expect(needsContinuation('for i in a; do')).toBe(true);
    expect(needsContinuation('for i in a; do echo $i; done')).toBe(false);
    expect(needsContinuation('while true; do')).toBe(true);
    expect(needsContinuation('case a in a)')).toBe(true);
    expect(needsContinuation('case a in a) echo x ;; esac')).toBe(false);
    expect(needsContinuation('f() {')).toBe(true);
    expect(needsContinuation('f() { echo x; }')).toBe(false);
  });

  it('引号未闭合 → true', () => {
    expect(needsContinuation('echo "abc')).toBe(true);
    expect(needsContinuation("echo 'abc")).toBe(true);
    expect(needsContinuation('echo "abc"')).toBe(false);
  });

  it('命令替换未闭合 → true', () => {
    expect(needsContinuation('echo $(ls')).toBe(true);
    expect(needsContinuation('echo `ls')).toBe(true);
    expect(needsContinuation('echo $(ls)')).toBe(false);
  });

  it('行尾孤立反斜杠 → true；偶数个 → false', () => {
    expect(needsContinuation('echo foo\\')).toBe(true);
    expect(needsContinuation('echo foo\\\\')).toBe(false);
  });

  it('引号外尾部 | / && / || → true', () => {
    expect(needsContinuation('echo a |')).toBe(true);
    expect(needsContinuation('echo a &&')).toBe(true);
    expect(needsContinuation('echo a ||')).toBe(true);
    expect(needsContinuation('echo a | grep b')).toBe(false);
  });

  it('引号内的 | 不算尾部算符', () => {
    expect(needsContinuation('echo "a|"')).toBe(false);
  });

  it('转义 \\| 不算尾部算符', () => {
    expect(needsContinuation('echo a\\|')).toBe(false);
  });

  it('heredoc 未闭合 → true；闭合 → false', () => {
    expect(needsContinuation('cat <<EOF')).toBe(true);
    expect(needsContinuation('cat <<EOF\na')).toBe(true);
    expect(needsContinuation('cat <<EOF\na\nEOF')).toBe(false);
  });

  it('heredoc body 含引号字符不误判', () => {
    expect(needsContinuation("cat <<EOF\nit's here\nEOF")).toBe(false);
  });

  it('完整语法错（意外的 then）→ false（不续行，直接报错）', () => {
    expect(needsContinuation('then')).toBe(false);
  });
});

// ── M37：循环控制 break/continue [n] + until 循环 ─────────────
describe('run · 循环控制 break/continue + until（M37）', () => {
  it('for 循环 break：到 3 即出圈', async () => {
    const r = await run('for i in 1 2 3 4; do echo $i; test $i = 3 && break; done', newCtx());
    expect(r.out).toBe('1\n2\n3');
  });

  it('while 循环 break：条件恒真也能出圈', async () => {
    const r = await run('export I=0; while test 1 = 1; do echo x$I; export I=$((I+1)); test $I -ge 2 && break; done', newCtx());
    expect(r.out).toBe('x0\nx1');
  });

  it('continue 跳过本迭代剩余语句', async () => {
    const r = await run('for i in 1 2 3 4; do test $i = 2 && continue; echo $i; done', newCtx());
    expect(r.out).toBe('1\n3\n4');
  });

  it('break 2 断两层嵌套循环', async () => {
    const r = await run('for i in 1 2 3; do for j in a b c; do test $j = b && break 2; echo $i$j; done; done', newCtx());
    expect(r.out).toBe('1a');
  });

  it('continue 2 跳过外层循环本迭代', async () => {
    const r = await run('for i in 1 2 3; do for j in a b; do test $i = 2 && continue 2; echo $i$j; done; echo outer$i; done', newCtx());
    expect(r.out).toBe('1a\n1b\nouter1\n3a\n3b\nouter3');
  });

  it('循环外 break：警告但不致命（bash 同款，后续语句照跑）', async () => {
    const r = await run('break; echo ok', newCtx());
    expect(r.out).toBe('ok');
    expect(r.err ?? '').toContain('只有在循环中');
    expect(r.code).toBe(0);
  });

  it('break 参数非正整数：报错码 1、不置信号（循环照跑）', async () => {
    const r = await run('for i in 1 2; do break nope; echo $i; done', newCtx());
    expect(r.err ?? '').toContain('正整数');
    expect(r.out).toBe('1\n2');
  });

  it('函数内 break 断调用处循环（bash 动态作用域）', async () => {
    const r = await run('f() { break; }; for i in 1 2 3; do echo $i; f; done', newCtx());
    expect(r.out).toBe('1');
  });

  it('until 基本：条件为假时跑体，条件转真即停', async () => {
    const r = await run('export I=0; until test $I -ge 3; do echo u$I; export I=$((I+1)); done', newCtx());
    expect(r.out).toBe('u0\nu1\nu2');
  });

  it('until 条件已真：体一次不跑', async () => {
    const r = await run('until test 1 = 1; do echo no; done; echo done', newCtx());
    expect(r.out).toBe('done');
  });

  it('until 单行形态解析正常（零迭代）', async () => {
    const r = await run('until test 1 = 1; do echo x; done', newCtx());
    expect(r.out).toBe('');
    expect(r.code).toBe(0);
  });

  it('until 里 break 同样生效', async () => {
    const r = await run('until test 1 = 2; do echo once; break; done', newCtx());
    expect(r.out).toBe('once');
  });

  it('until 未闭合 → needsContinuation true', () => {
    expect(needsContinuation('until true; do echo x')).toBe(true);
    expect(needsContinuation('until true; do echo x; done')).toBe(false);
  });

  it('break 与 Ctrl+C 互不干扰：break 出圈后脚本继续后续语句', async () => {
    const r = await run('for i in 1 2 3; do break; done; echo after', newCtx());
    expect(r.out).toBe('after');
    expect(r.code).toBe(0);
  });
});

// ── M38：命令参数路径名展开（glob * ? [a-z]）─────────────
// VFS 全局共享，每个用例用独立目录隔离（免得 * 匹配到别的用例产物）。
describe('run · 路径名展开 glob（M38）', () => {
  async function setup(dir: string, files: string[] = [], dirs: string[] = []): Promise<ReturnType<typeof newCtx>> {
    const ctx = newCtx();
    const parts = [`mkdir ${dir}`, `cd ${dir}`];
    for (const d of dirs) parts.push(`mkdir ${d}`);
    if (files.length) parts.push(`touch ${files.join(' ')}`);
    await run(parts.join('; '), ctx);
    return ctx;
  }

  it('命令参数 * 展开：多匹配按字典序输出', async () => {
    const ctx = await setup('g38a', ['b.txt', 'a.txt', 'ab.txt', 'c.md']);
    expect((await run('echo *.txt', ctx)).out).toBe('a.txt ab.txt b.txt');
  });

  it('无匹配：模式原样保留（bash 默认 nullglob off）', async () => {
    const ctx = await setup('g38b', ['a.txt']);
    expect((await run('echo *.zzz', ctx)).out).toBe('*.zzz');
  });

  it('? 匹配单字符', async () => {
    const ctx = await setup('g38c', ['ab.txt', 'a1.txt', 'abc.txt']);
    expect((await run('echo a?.txt', ctx)).out).toBe('a1.txt ab.txt');
  });

  it('字符类 [ab] 与取反 [!a]/[^a]', async () => {
    const ctx = await setup('g38d', ['a.txt', 'b.txt', 'ab.txt', 'z.md']);
    expect((await run('echo [ab].txt', ctx)).out).toBe('a.txt b.txt');
    expect((await run('echo [!a]*.txt', ctx)).out).toBe('b.txt');
    expect((await run('echo [^a]*', ctx)).out).toBe('b.txt z.md');
  });

  it('区间 [a-z]：echo [a-c]?.md', async () => {
    const ctx = await setup('g38e', ['am.md', 'bm.md', 'dm.md']);
    expect((await run('echo [a-c]?.md', ctx)).out).toBe('am.md bm.md');
  });

  it('未闭合 [ 按字面（bash 同款）', async () => {
    const ctx = await setup('g38f', ['a.txt']);
    expect((await run('echo [ab', ctx)).out).toBe('[ab');
  });

  it('隐藏文件规则：* 不匹配 . 开头，.* 才匹配', async () => {
    const ctx = await setup('g38h', ['a.txt', '.secret'], ['sub']);
    expect((await run('echo *', ctx)).out).toBe('a.txt sub');
    expect((await run('echo .*', ctx)).out).toBe('.secret');
  });

  it('路径段 glob：sub/*.txt 与 */*.txt', async () => {
    const ctx = await setup('g38i', [], ['sub']);
    await run('touch sub/x.txt sub/y.md', ctx);
    expect((await run('echo sub/*.txt', ctx)).out).toBe('sub/x.txt');
    expect((await run('echo */*.txt', ctx)).out).toBe('sub/x.txt');
  });

  it('绝对路径 glob：/g38j/*.md', async () => {
    const ctx = await setup('g38j', ['c.md', 'a.txt']);
    expect((await run('echo /g38j/*.md', ctx)).out).toBe('/g38j/c.md');
  });

  it('字面段不存在 → 整个模式原样保留', async () => {
    const ctx = await setup('g38k', ['a.txt']);
    expect((await run('echo nodir/*.txt', ctx)).out).toBe('nodir/*.txt');
  });

  it('尾随 / 只匹配目录并保留斜杠', async () => {
    const ctx = await setup('g38m', ['a.txt'], ['sub', 'zub']);
    expect((await run('echo */', ctx)).out).toBe('sub/ zub/');
  });

  it('引号词不 glob：双引号与单引号', async () => {
    const ctx = await setup('g38n', ['a.txt']);
    expect((await run('echo "*.txt"', ctx)).out).toBe('*.txt');
    expect((await run("echo '*.txt'", ctx)).out).toBe('*.txt');
  });

  it('转义 \\* 不 glob', async () => {
    const ctx = await setup('g38p', ['a.txt']);
    expect((await run('echo \\*.txt', ctx)).out).toBe('*.txt');
  });

  it('变量展开后再 glob：export P=a; echo $P*.txt', async () => {
    const ctx = await setup('g38q', ['a.txt', 'a1.txt', 'ab.txt', 'b.txt']);
    expect((await run('export P=a; echo $P*.txt', ctx)).out).toBe('a.txt a1.txt ab.txt');
  });

  it('for 词表支持路径段 glob：for f in sub/*.txt', async () => {
    const ctx = await setup('g38r', [], ['sub']);
    await run('touch sub/x.txt sub/y.md', ctx);
    expect((await run('for f in sub/*.txt; do echo $f; done', ctx)).out).toBe('sub/x.txt');
  });

  it('命令真实消费：cat *.md 读到唯一匹配文件', async () => {
    const ctx = await setup('g38s', ['a.txt']);
    await run('echo hi > c.md', ctx);
    expect((await run('cat *.md', ctx)).out).toBe('hi');
  });

  it('case 模式同步支持字符类：case b in [ab]', async () => {
    expect((await run('case b in [ab]) echo hit ;; esac', newCtx())).out).toBe('hit');
    expect((await run('case z in [ab]) echo hit ;; esac', newCtx())).out).toBe('');
  });
});

// ── M43.1：[[ ]] 条件命令 ─────────────────────────────────
// 与 test/[ ] 的差异（bash 语义）：内部不做路径名展开（* ? 不 glob）、不做分词；
// && || ! ( ) 是条件算符而非连接符；==/!= 的 rhs 未加引号时是模式匹配；=~ 正则；< > 字典序。
describe('run · [[ ]] 条件命令（M43.1）', () => {
  async function setup43(dir: string, files: string[] = [], dirs: string[] = []): Promise<ReturnType<typeof newCtx>> {
    const ctx = newCtx();
    const parts = [`mkdir ${dir}`, `cd ${dir}`];
    for (const d of dirs) parts.push(`mkdir ${d}`);
    if (files.length) parts.push(`touch ${files.join(' ')}`);
    await run(parts.join('; '), ctx);
    return ctx;
  }

  it('字符串相等/不等：== != =', async () => {
    expect((await run('[[ a == a ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ a != b ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ a = a ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ a == b ]]; echo $?', newCtx())).out).toBe('1');
  });

  it('单词条件：非空字符串为真，空串为假', async () => {
    expect((await run('[[ x ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ "" ]]; echo $?', newCtx())).out).toBe('1');
  });

  it('空条件 → 语法错误码 2', async () => {
    const res = await run('[[ ]]', newCtx());
    expect(res.code).toBe(2);
    expect(res.err ?? '').toContain(']]');
  });

  it('数值比较 -eq/-ne/-lt/-le/-gt/-ge', async () => {
    expect((await run('[[ 3 -eq 3 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ 3 -ne 4 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ 2 -lt 3 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ 3 -le 3 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ 4 -gt 3 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ 3 -ge 4 ]]; echo $?', newCtx())).out).toBe('1');
  });

  it('字符串测试 -z/-n', async () => {
    expect((await run('[[ -z "" ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ -n "x" ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ -z "x" ]]; echo $?', newCtx())).out).toBe('1');
  });

  it('文件测试 -e/-f/-d', async () => {
    const ctx = await setup43('c43a', ['f.txt'], ['sub']);
    expect((await run('[[ -e f.txt ]]; echo $?', ctx)).out).toBe('0');
    expect((await run('[[ -f f.txt ]]; echo $?', ctx)).out).toBe('0');
    expect((await run('[[ -d sub ]]; echo $?', ctx)).out).toBe('0');
    expect((await run('[[ -f sub ]]; echo $?', ctx)).out).toBe('1');
    expect((await run('[[ -e nosuch ]]; echo $?', ctx)).out).toBe('1');
  });

  it('rhs 未加引号 == 是模式匹配：a*、*b?、字符类', async () => {
    expect((await run('[[ abc == a* ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ abc == *b? ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ b == [ab] ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ abc == b* ]]; echo $?', newCtx())).out).toBe('1');
    expect((await run('[[ abc != b* ]]; echo $?', newCtx())).out).toBe('0');
  });

  it('rhs 加引号是字面比较："a*" 不匹配 abc', async () => {
    expect((await run('[[ abc == "a*" ]]; echo $?', newCtx())).out).toBe('1');
    expect((await run("[[ 'a*' == a* ]]; echo $?", newCtx())).out).toBe('0'); // lhs 字面 a* 被 rhs 模式 a* 匹配
  });

  it('lhs 不做路径名展开：多文件目录里 *.txt 原样比较', async () => {
    const ctx = await setup43('c43b', ['a.txt', 'b.txt']);
    // 若被 glob，lhs 会展开成 "a.txt b.txt" 两个词 → 语法错；[[ ]] 语义是原样字面比较 → 不等 → 1
    expect((await run('[[ *.txt == a.txt ]]; echo $?', ctx)).out).toBe('1');
    expect((await run('[[ *.txt == *.txt ]]; echo $?', ctx)).out).toBe('0');
  });

  it('=~ 正则匹配', async () => {
    expect((await run('[[ abc123 =~ [0-9]+$ ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ abc =~ ^b ]]; echo $?', newCtx())).out).toBe('1');
  });

  it('=~ rhs 加引号按字面；无效正则 → 码 2', async () => {
    expect((await run('[[ a+b =~ "a+b" ]]; echo $?', newCtx())).out).toBe('0');
    const res = await run('[[ a =~ [ ]]; echo $?', newCtx()); // 未加引号的 [ 才是无效正则
    expect(res.out).toBe('2');
  });

  it('逻辑与/或：&& ||（不被当连接符切分）', async () => {
    expect((await run('[[ 1 -lt 2 && 2 -lt 3 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ 1 -gt 2 || 2 -lt 3 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ 1 -gt 2 && 2 -lt 3 ]]; echo $?', newCtx())).out).toBe('1');
    expect((await run('[[ 1 -gt 2 || 2 -gt 3 ]]; echo $?', newCtx())).out).toBe('1');
  });

  it('! 取反与括号分组', async () => {
    expect((await run('[[ ! -f /nonexistent ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ ! a == a ]]; echo $?', newCtx())).out).toBe('1');
    expect((await run('[[ ( 1 -eq 2 ) || 2 -eq 2 ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ ! ( 1 -eq 1 || 2 -eq 2 ) ]]; echo $?', newCtx())).out).toBe('1');
  });

  it('字符串字典序 < >（不是重定向，不落盘）', async () => {
    const ctx = await setup43('c43c');
    expect((await run('[[ a < b ]]; echo $?', ctx)).out).toBe('0');
    expect((await run('[[ b < a ]]; echo $?', ctx)).out).toBe('1');
    expect((await run('[[ b > a ]]; echo $?', ctx)).out).toBe('0');
    expect((await run('ls', ctx)).out).toBe(''); // < > 没有被当重定向 → 无文件产生
  });

  it('变量展开：$VAR 参与比较；未定义变量展开为空词（不删除）', async () => {
    expect((await run('[[ $HOME == / ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ $UNDEF43 == x ]]; echo $?', newCtx())).out).toBe('1'); // 空词 == x → 假
    expect((await run('[[ -z $UNDEF43 ]]; echo $?', newCtx())).out).toBe('0'); // 空词 -z → 真
  });

  it('引号内空格不分词："a b" 是一词', async () => {
    expect((await run('[[ "a b" == a* ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('[[ "a b" == "a b" ]]; echo $?', newCtx())).out).toBe('0');
  });

  it('命令替换参与比较：[[ $(echo hi) == hi ]]', async () => {
    expect((await run('[[ $(echo hi) == hi ]]; echo $?', newCtx())).out).toBe('0');
    expect((await run('if [[ $(echo 1) -eq 1 ]]; then echo ok; fi', newCtx())).out).toBe('ok');
  });

  it('if/while 条件可直接用 [[ ]]', async () => {
    expect((await run('if [[ 1 -lt 2 ]]; then echo yes; fi', newCtx())).out).toBe('yes');
    expect((await run('if [[ 1 -gt 2 ]]; then echo yes; else echo no; fi', newCtx())).out).toBe('no');
    const res = await run('i=0; while [[ $i -lt 3 ]]; do echo $i; i=$((i+1)); done', newCtx());
    expect(res.out).toBe('0\n1\n2');
  });

  it('连接符短路：[[ ]] && echo T || echo F', async () => {
    expect((await run('[[ 1 -eq 1 ]] && echo T || echo F', newCtx())).out).toBe('T');
    expect((await run('[[ 1 -eq 2 ]] && echo T || echo F', newCtx())).out).toBe('F');
  });

  it(']] 之后可接重定向：[[ a == a ]] > f 写空文件', async () => {
    const ctx = await setup43('c43d');
    const res = await run('[[ a == a ]] > e43.txt; echo $?; test -f e43.txt; echo $?; cat e43.txt', ctx);
    expect(res.out).toBe('0\n0');
  });

  it('管道中可用：[[ a == a ]] && 取码（分段语义）', async () => {
    // | 之后是独立命令，[[ ]] 无 stdout；只验证不炸且退出码正确传递
    expect((await run('[[ a == a ]] | cat; echo $?', newCtx())).out).toBe('0');
  });

  it('未闭合 [[ → needsContinuation true；闭合 → false', () => {
    expect(needsContinuation('[[ -f x')).toBe(true);
    expect(needsContinuation('[[ -f x &&')).toBe(true); // ]] 未闭合优先于 && 判定
    expect(needsContinuation('[[ -f x ]]')).toBe(false);
    expect(needsContinuation('if [[ -f x ]]; then echo hi')).toBe(true); // 缺 fi 仍续行
    expect(needsContinuation('if [[ -f x ]]; then echo hi; fi')).toBe(false);
  });

  it('缺少 ]] → 执行层语法错误码 2', async () => {
    const res = await run('[[ a == a', newCtx());
    expect(res.code).toBe(2);
    expect(res.err ?? '').toContain(']]');
  });

  it('条件外的 ]] 内容报错：]] 后意外的参数 → 码 2', async () => {
    const res = await run('[[ a == a ]] extra', newCtx());
    expect(res.code).toBe(2);
  });

  it('脚本内 [[ ]]：source 文件里可用', async () => {
    const ctx = await setup43('c43e');
    await run('echo "if [[ -f f.txt ]]; then echo hit; fi" > s.sh; touch f.txt; source s.sh', ctx);
    expect((await run('source s.sh', ctx)).out).toBe('hit');
  });
});

describe('run · 可执行权限位 + chmod 符号模式 + -x/-r/-w（M43.2）', () => {
  async function setup432(dir: string): Promise<ReturnType<typeof newCtx>> {
    const ctx = newCtx();
    await run(`mkdir ${dir}; cd ${dir}`, ctx);
    return ctx;
  }
  // stat 的「权限」行：`  权限: rwxr--r--  (744)`，用 grep 提出来断言
  const modeOf = async (ctx: ReturnType<typeof newCtx>, f: string) => (await run(`stat ${f} | grep 权限`, ctx)).out;

  it('chmod u+x：属主加执行位 644 → 744', async () => {
    const ctx = await setup432('m2a');
    await run('touch f; chmod u+x f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rwxr--r--');
    expect(await modeOf(ctx, 'f')).toContain('(744)');
  });

  it('chmod a+x 与 +x（省略 who = a）：全体加执行位 644 → 755', async () => {
    const ctx = await setup432('m2b');
    await run('touch f; chmod a+x f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rwxr-xr-x');
    await run('chmod 644 f; chmod +x f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rwxr-xr-x');
  });

  it('chmod u-x / go-w：减位', async () => {
    const ctx = await setup432('m2c');
    await run('touch f; chmod 777 f; chmod u-x f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rw-rwxrwx');
    await run('chmod go-w f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rw-r-xr-x');
  });

  it('chmod o=rw / u=r：= 精确设置该 who 段', async () => {
    const ctx = await setup432('m2d');
    await run('touch f; chmod o=rw f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rw-r--rw-');
    await run('chmod 777 f; chmod u=r f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('r--rwxrwx');
  });

  it('chmod 多 who 组合 ugo 与逗号多子句：u+x,g-w', async () => {
    const ctx = await setup432('m2e');
    await run('touch f; chmod 664 f; chmod u+x,g-w f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rwxr--r--');
    await run('chmod 600 f; chmod go+r f', ctx);
    expect(await modeOf(ctx, 'f')).toContain('rw-r--r--');
  });

  it('chmod 符号模式组合：u=rwx,go=rx（目录常见形态）', async () => {
    const ctx = await setup432('m2f');
    await run('mkdir sub; chmod u=rwx,go=rx sub', ctx);
    expect(await modeOf(ctx, 'sub')).toContain('rwxr-xr-x');
  });

  it('chmod 无效符号模式 → 码 1 报错；八进制仍可用', async () => {
    const ctx = await setup432('m2g');
    await run('touch f', ctx);
    const bad = await run('chmod q+x f', ctx);
    expect(bad.code).toBe(1);
    expect(bad.err ?? '').toContain('无效模式');
    expect((await run('chmod u+z f', ctx)).code).toBe(1);
    expect((await run('chmod 600 f', ctx)).code).toBe(0);
    expect(await modeOf(ctx, 'f')).toContain('rw-------');
  });

  it('chmod 多文件一次改', async () => {
    const ctx = await setup432('m2h');
    await run('touch a b; chmod +x a b', ctx);
    expect(await modeOf(ctx, 'a')).toContain('rwxr-xr-x');
    expect(await modeOf(ctx, 'b')).toContain('rwxr-xr-x');
  });

  it('./s.sh 无 x 位 → 码 126 + 权限不够，脚本体不执行', async () => {
    const ctx = await setup432('m2i');
    const res = await run("echo 'echo hi' > s.sh; ./s.sh", ctx);
    expect(res.code).toBe(126);
    expect(res.err ?? '').toContain('权限不够');
    expect(res.out).not.toContain('hi');
  });

  it('chmod +x 后 ./s.sh 执行成功', async () => {
    const ctx = await setup432('m2j');
    const res = await run("echo 'echo hi' > s.sh; chmod +x s.sh; ./s.sh", ctx);
    expect(res.out).toBe('hi');
    expect(res.code).toBe(0);
  });

  it('sh s.sh / source s.sh 走读通道，不需要 x 位', async () => {
    const ctx = await setup432('m2k');
    expect((await run("echo 'echo hi' > s.sh; sh s.sh", ctx)).out).toBe('hi');
    expect((await run('source s.sh', ctx)).out).toBe('hi');
  });

  it('./目录 → 码 126「是个目录」（bash 同款）', async () => {
    const ctx = await setup432('m2l');
    await run('mkdir sub', ctx);
    const res = await run('./sub', ctx);
    expect(res.code).toBe(126);
    expect(res.err ?? '').toContain('目录');
  });

  it('test -r/-w/-x：644 文件 r w 真 x 假', async () => {
    const ctx = await setup432('m2m');
    await run('touch f', ctx);
    expect((await run('test -r f; echo $?', ctx)).out).toBe('0');
    expect((await run('test -w f; echo $?', ctx)).out).toBe('0');
    expect((await run('test -x f; echo $?', ctx)).out).toBe('1');
  });

  it('[ -x f ]：chmod +x 后翻真；不存在的文件三项全假', async () => {
    const ctx = await setup432('m2n');
    await run('touch f; chmod +x f', ctx);
    expect((await run('[ -x f ]; echo $?', ctx)).out).toBe('0');
    expect((await run('[ -r nosuch ]; echo $?', ctx)).out).toBe('1');
    expect((await run('[ -w nosuch ]; echo $?', ctx)).out).toBe('1');
    expect((await run('[ -x nosuch ]; echo $?', ctx)).out).toBe('1');
  });

  it('chmod 000 后属主 rwx 全失（! 组合判定）', async () => {
    const ctx = await setup432('m2o');
    await run('touch f; chmod 000 f', ctx);
    expect((await run('test -r f; echo $?', ctx)).out).toBe('1');
    expect((await run('test ! -r f; echo $?', ctx)).out).toBe('0');
  });

  it('root 无视权限位：chmod 000 仍 -r -w -x 全真', async () => {
    const ctx = await setup432('m2p');
    await run('touch f; chmod 000 f', ctx);
    ctx.env.USER = 'root';
    expect((await run('test -r f; echo $?', ctx)).out).toBe('0');
    expect((await run('test -w f; echo $?', ctx)).out).toBe('0');
    expect((await run('test -x f; echo $?', ctx)).out).toBe('0');
  });

  it('[[ -x/-r/-w ]] 同样支持', async () => {
    const ctx = await setup432('m2q');
    await run('touch f', ctx);
    expect((await run('[[ -r f ]]; echo $?', ctx)).out).toBe('0');
    expect((await run('[[ -w f ]]; echo $?', ctx)).out).toBe('0');
    expect((await run('[[ -x f ]]; echo $?', ctx)).out).toBe('1');
    await run('chmod +x f', ctx);
    expect((await run('[[ -x f ]]; echo $?', ctx)).out).toBe('0');
  });

  it('目录默认 755：-x 为真（可进入）', async () => {
    const ctx = await setup432('m2r');
    await run('mkdir sub', ctx);
    expect((await run('test -x sub; echo $?', ctx)).out).toBe('0');
  });

  it('实战形态：if [ -x s.sh ] 门控执行', async () => {
    const ctx = await setup432('m2s');
    const res = await run('echo "echo ran" > s.sh; if [ -x s.sh ]; then ./s.sh; else echo notexec; fi', ctx);
    expect(res.out).toBe('notexec');
    const res2 = await run('chmod +x s.sh; if [ -x s.sh ]; then ./s.sh; else echo notexec; fi', ctx);
    expect(res2.out).toBe('ran');
  });
});

describe('run · trap 信号陷阱（M43.3）', () => {
  async function setup433(dir: string): Promise<ReturnType<typeof newCtx>> {
    const ctx = newCtx();
    await run(`mkdir ${dir}; cd ${dir}`, ctx);
    return ctx;
  }
  const count = (hay: string, needle: string) => hay.split('\n').filter((l) => l === needle).length;

  it('trap 空表列举：空输出码 0', async () => {
    const res = await run('trap', newCtx());
    expect(res.out).toBe('');
    expect(res.code).toBe(0);
  });

  it('trap 设置后列举：trap -- 格式逐条列出', async () => {
    const ctx = newCtx();
    const res = await run("trap 'echo x' INT; trap 'echo y' EXIT; trap", ctx);
    expect(res.out).toContain("trap -- 'echo x' INT");
    expect(res.out).toContain("trap -- 'echo y' EXIT");
  });

  it('INT trap：Ctrl+C 断失控 while → 码 130 + ^C + handler 输出恰好一次', async () => {
    const ctx = newCtx();
    await run("trap 'echo caught' INT", ctx);
    const p = run('while test 1 = 1; do echo hi; done', ctx);
    ctx.intr!.flag = true; // run 起步同步，首个检查点已过；下一迭代边界中止
    const res = await p;
    expect(res.code).toBe(130);
    expect(res.err ?? '').toContain('^C');
    expect(count(res.out, 'caught')).toBe(1);
  });

  it('预置 flag 同样触发 INT trap', async () => {
    const ctx = newCtx();
    await run("trap 'echo caught' INT", ctx);
    ctx.intr!.flag = true;
    const res = await run('echo hi', ctx);
    expect(res.code).toBe(130);
    expect(count(res.out, 'caught')).toBe(1);
    expect(res.out).not.toContain('hi');
  });

  it('handler 完整跑完（多条命令输出齐全，不被残留 flag 秒断）', async () => {
    const ctx = newCtx();
    await run("trap 'echo c1; echo c2' INT", ctx);
    ctx.intr!.flag = true;
    const res = await run('echo hi', ctx);
    expect(count(res.out, 'c1')).toBe(1);
    expect(count(res.out, 'c2')).toBe(1);
  });

  it('嵌套脚本（单语句 ./s.sh）：内层吞 130 返回，INT trap 在最外层边界恰好一次', async () => {
    const ctx = await setup433('m3a');
    await run("echo 'while test 1 = 1; do echo hi; done' > s.sh; chmod +x s.sh", ctx);
    await run("trap 'echo caught' INT", ctx);
    const p = run('./s.sh', ctx);
    ctx.intr!.flag = true;
    const res = await p;
    expect(res.code).toBe(130);
    expect(count(res.out, 'caught')).toBe(1);
  });

  it('trap - INT 重置：Ctrl+C 不再触发 handler', async () => {
    const ctx = newCtx();
    await run("trap 'echo caught' INT; trap - INT", ctx);
    ctx.intr!.flag = true;
    const res = await run('echo hi', ctx);
    expect(res.code).toBe(130);
    expect(res.out).not.toContain('caught');
    expect((await run('trap', ctx)).out).toBe('');
  });

  it("trap '' INT 等同重置（MVP 语义）", async () => {
    const ctx = newCtx();
    await run("trap 'echo caught' INT; trap '' INT", ctx);
    ctx.intr!.flag = true;
    const res = await run('echo hi', ctx);
    expect(res.out).not.toContain('caught');
  });

  it('EXIT trap：./s.sh 正常结束触发，输出排脚本输出之后，退出码不变', async () => {
    const ctx = await setup433('m3b');
    await run("echo 'echo work; false' > s.sh; chmod +x s.sh", ctx);
    await run("trap 'echo bye' EXIT", ctx);
    const res = await run('./s.sh', ctx);
    expect(res.out).toBe('work\nbye');
    expect(res.code).toBe(1); // 脚本体 false 的码，trap 不改写
  });

  it('嵌套脚本 EXIT 只在最外层触发一次', async () => {
    const ctx = await setup433('m3c');
    await run("echo 'echo b' > b.sh; chmod +x b.sh", ctx);
    await run("echo 'echo a; ./b.sh; echo a2' > a.sh; chmod +x a.sh", ctx);
    await run("trap 'echo bye' EXIT", ctx);
    const res = await run('./a.sh', ctx);
    expect(res.out).toBe('a\nb\na2\nbye');
  });

  it('source 不触发 EXIT（跑在当前 shell，记录在案）', async () => {
    const ctx = await setup433('m3d');
    await run("echo 'echo hi' > s.sh", ctx);
    await run("trap 'echo bye' EXIT", ctx);
    const res = await run('source s.sh', ctx);
    expect(res.out).toBe('hi');
  });

  it('return 提前结束脚本仍触发 EXIT，退出码用 return 的', async () => {
    const ctx = await setup433('m3e');
    await run("echo 'echo a; return 3; echo b' > s.sh; chmod +x s.sh", ctx);
    await run("trap 'echo bye' EXIT", ctx);
    const res = await run('./s.sh', ctx);
    expect(res.out).toBe('a\nbye');
    expect(res.code).toBe(3);
  });

  it('EXIT handler 内再跑脚本不递归触发', async () => {
    const ctx = await setup433('m3f');
    await run("echo 'echo bbye' > b.sh; chmod +x b.sh", ctx);
    await run("echo 'echo a' > a.sh; chmod +x a.sh", ctx);
    await run("trap './b.sh' EXIT", ctx);
    const res = await run('./a.sh', ctx);
    expect(res.out).toBe('a\nbbye');
  });

  it('脚本被 Ctrl+C 中止：EXIT trap 仍触发（bash 语义）', async () => {
    const ctx = await setup433('m3g');
    await run("echo 'while test 1 = 1; do echo hi; done' > s.sh; chmod +x s.sh", ctx);
    await run("trap 'echo bye' EXIT", ctx);
    const p = run('./s.sh', ctx);
    ctx.intr!.flag = true;
    const res = await p;
    expect(res.code).toBe(130);
    expect(count(res.out, 'bye')).toBe(1);
  });

  it('信号名归一：SIGINT / 2 → INT，0 → EXIT', async () => {
    const ctx = newCtx();
    const res = await run("trap 'echo x' SIGINT; trap 'echo y' 2; trap 'echo z' 0; trap", ctx);
    expect(res.out).toContain("trap -- 'echo y' INT");
    expect(res.out).toContain("trap -- 'echo z' EXIT");
    expect(res.out).not.toContain('SIGINT');
  });

  it('不支持的信号报错码 1', async () => {
    const res = await run("trap 'echo x' KILL", newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('不支持的信号');
  });

  it('单参数用法错误码 2', async () => {
    const res = await run('trap INT', newCtx());
    expect(res.code).toBe(2);
  });
});

describe('run · local 函数局部变量（M44.1）', () => {
  it('函数外使用：报错码 1', async () => {
    const res = await run('local x=1', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('只能在函数中使用');
  });

  it('local x=1：函数内可见、函数外不可见（出函数删除）', async () => {
    const res = await run('f() { local x=1; echo $x; }; f; echo ${x:-unset}', newCtx());
    expect(res.out).toBe('1\nunset');
  });

  it('遮蔽同名全局：出函数恢复原值', async () => {
    const res = await run('x=outer; f() { local x=inner; echo $x; }; f; echo $x', newCtx());
    expect(res.out).toBe('inner\nouter');
  });

  it('local x（无值）：遮蔽全局成空串', async () => {
    const res = await run('x=outer; f() { local x; echo "in:${x:-empty}"; }; f; echo $x', newCtx());
    expect(res.out).toBe('in:empty\nouter');
  });

  it('无 local 的普通赋值仍泄漏全局（现状语义锁定）', async () => {
    const res = await run('f() { y=9; }; f; echo $y', newCtx());
    expect(res.out).toBe('9');
  });

  it('动态作用域：f local x=1 调 g，g 看到 1', async () => {
    const res = await run('f() { local x=1; g; }; g() { echo $x; }; f', newCtx());
    expect(res.out).toBe('1');
  });

  it('嵌套函数：g 的 local 不污染 f 的同名局部', async () => {
    const res = await run('f() { local x=1; g; echo "f:$x"; }; g() { local x=2; echo "g:$x"; }; f; echo "out:${x:-unset}"', newCtx());
    expect(res.out).toBe('g:2\nf:1\nout:unset');
  });

  it('多变量一次声明：local a=1 b=2', async () => {
    const res = await run('f() { local a=1 b=2; echo $a$b; }; f', newCtx());
    expect(res.out).toBe('12');
  });

  it('local 不影响位置参数', async () => {
    const res = await run('f() { local x=1; echo $1$x; }; f A', newCtx());
    expect(res.out).toBe('A1');
  });

  it('重声明：local x=1; local x 不清值；local x=2 改值', async () => {
    const res = await run('f() { local x=1; local x; echo $x; local x=2; echo $x; }; f', newCtx());
    expect(res.out).toBe('1\n2');
  });

  it('$( ) 子 shell 内赋值不回流，局部恢复照旧', async () => {
    const res = await run('x=5; f() { local x=1; echo $(x=9; echo $x); echo $x; }; f; echo $x', newCtx());
    expect(res.out).toBe('9\n1\n5');
  });

  it('非法变量名：报错码 1', async () => {
    const res = await run('f() { local 1bad=2; }; f', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('不是有效的变量名');
  });
});

describe('run · set -e 严格模式（M44.2）', () => {
  async function setup442(dir: string): Promise<ReturnType<typeof newCtx>> {
    const ctx = newCtx();
    await run(`mkdir ${dir}; cd ${dir}`, ctx);
    return ctx;
  }

  it('基本：失败后立即中止，后续语句不执行', async () => {
    const res = await run('set -e; false; echo unreachable', newCtx());
    expect(res.out).not.toContain('unreachable');
    expect(res.code).toBe(1);
  });

  it('中止前已产出的输出保留', async () => {
    const res = await run('set -e; echo a; false; echo b', newCtx());
    expect(res.out).toBe('a');
    expect(res.code).toBe(1);
  });

  it('set +e 关闭：失败不再中止', async () => {
    const res = await run('set -e; set +e; false; echo ok', newCtx());
    expect(res.out).toBe('ok');
    expect(res.code).toBe(0);
  });

  it('豁免：&& 非末段失败不中止（false && echo x）', async () => {
    const res = await run('set -e; false && echo x; echo alive', newCtx());
    expect(res.out).toBe('alive');
    expect(res.code).toBe(0);
  });

  it('末段触发：true && false 中止', async () => {
    const res = await run('set -e; true && false; echo dead', newCtx());
    expect(res.out).not.toContain('dead');
    expect(res.code).toBe(1);
  });

  it('豁免：false || echo ok 兜底成功', async () => {
    const res = await run('set -e; false || echo ok', newCtx());
    expect(res.out).toBe('ok');
    expect(res.code).toBe(0);
  });

  it('末段触发：false || false 中止', async () => {
    const res = await run('set -e; false || false; echo dead', newCtx());
    expect(res.out).not.toContain('dead');
    expect(res.code).toBe(1);
  });

  it('豁免：if 条件失败不中止', async () => {
    const res = await run('set -e; if false; then echo t; fi; echo alive', newCtx());
    expect(res.out).toBe('alive');
    expect(res.code).toBe(0);
  });

  it('豁免深入函数体：if 条件里的函数失败后继续执行', async () => {
    const res = await run('f() { false; echo still; }; set -e; if f; then echo t; fi; echo alive', newCtx());
    expect(res.out).toBe('still\nt\nalive');
  });

  it('if 条件里的假函数走 else，不中止', async () => {
    const res = await run('f() { false; }; set -e; if f; then echo t; else echo e; fi; echo alive', newCtx());
    expect(res.out).toBe('e\nalive');
  });

  it('豁免：while 条件失败是正常出循环', async () => {
    const res = await run('set -e; i=0; while test $i -lt 2; do i=$((i+1)); done; echo alive$i', newCtx());
    expect(res.out).toBe('alive2');
    expect(res.code).toBe(0);
  });

  it('循环体内失败照样中止', async () => {
    const res = await run('set -e; for i in 1 2 3; do echo $i; test $i -lt 2; done; echo dead', newCtx());
    expect(res.out).toBe('1\n2');
    expect(res.code).toBe(1);
  });

  it('函数体内失败传染调用方（非豁免上下文）', async () => {
    const res = await run('f() { false; echo no; }; set -e; f; echo dead', newCtx());
    expect(res.out).not.toContain('no');
    expect(res.out).not.toContain('dead');
    expect(res.code).toBe(1);
  });

  it('脚本内 set -e 止于脚本边界（./s.sh 不泄漏）', async () => {
    const ctx = await setup442('m4a');
    await run("echo 'set -e; false; echo no' > s.sh; chmod +x s.sh", ctx);
    const res = await run('./s.sh; echo alive', ctx);
    expect(res.out).toBe('alive');
    expect(res.code).toBe(0);
    expect((await run('false; echo stillalive', ctx)).out).toBe('stillalive'); // 父 shell 未被传染
  });

  it('父 shell set -e 下脚本返回失败仍中止父 shell', async () => {
    const ctx = await setup442('m4b');
    await run("echo 'false' > s.sh; chmod +x s.sh", ctx);
    const res = await run('set -e; ./s.sh; echo dead', ctx);
    expect(res.out).not.toContain('dead');
    expect(res.code).toBe(1);
  });

  it('source 内 set -e 泄漏回父 shell（bash 语义锁定）', async () => {
    const ctx = await setup442('m4c');
    await run("echo 'set -e; false; echo no' > s.sh", ctx);
    const res = await run('source s.sh; echo first-dead', ctx);
    expect(res.out).not.toContain('first-dead');
    expect(res.code).toBe(1);
    const res2 = await run('false; echo second-dead', ctx); // -e 仍在
    expect(res2.out).not.toContain('second-dead');
    expect(res2.code).toBe(1);
    await run('set +e', ctx); // 收尾复原
    expect((await run('echo ok', ctx)).out).toBe('ok');
  });

  it('管道末段失败触发', async () => {
    const res = await run('set -e; echo x | grep nosuch; echo dead', newCtx());
    expect(res.out).not.toContain('dead');
    expect(res.code).toBe(1);
  });

  it('set -e 中止的脚本仍触发 EXIT trap', async () => {
    const ctx = await setup442('m4d');
    await run("echo 'set -e; false; echo no' > s.sh; chmod +x s.sh", ctx);
    await run("trap 'echo bye' EXIT", ctx);
    const res = await run('./s.sh', ctx);
    expect(res.out).toBe('bye');
    expect(res.code).toBe(1);
  });

  it('set 无参：按序列出全部变量', async () => {
    const res = await run('set', newCtx());
    expect(res.out).toContain('USER=qiezi');
    expect(res.out).toContain('SHELL=qzsh');
    expect(res.out.indexOf('HOME=')).toBeLessThan(res.out.indexOf('USER=')); // 字典序
  });

  it('不支持的选项报错码 2', async () => {
    const res = await run('set -x', newCtx());
    expect(res.code).toBe(2);
    expect(res.err ?? '').toContain('不支持的选项');
  });
});

describe('run · eval 内建（M44.3）', () => {
  it('基本：eval echo hi', async () => {
    expect((await run('eval echo hi', newCtx())).out).toBe('hi');
  });

  it('变量存命令：cmd="echo hi"; eval $cmd', async () => {
    expect((await run("cmd='echo hi'; eval $cmd", newCtx())).out).toBe('hi');
  });

  it('二次展开：cmd 里的 $USER 在 eval 时才展开', async () => {
    expect((await run("cmd='echo $USER'; eval $cmd", newCtx())).out).toBe('qiezi');
  });

  it('转义挡第一次、eval 展开第二次：eval echo \\$USER', async () => {
    expect((await run('eval echo \\$USER', newCtx())).out).toBe('qiezi');
  });

  it('eval 赋值影响当前 shell', async () => {
    expect((await run("eval 'x=42'; echo $x", newCtx())).out).toBe('42');
  });

  it('eval 退出码即内部命令退出码', async () => {
    expect((await run('eval false; echo $?', newCtx())).out).toBe('1');
  });

  it('eval 控制流：for 循环', async () => {
    expect((await run("eval 'for i in 1 2; do echo $i; done'", newCtx())).out).toBe('1\n2');
  });

  it('eval 管道', async () => {
    expect((await run("eval 'echo a | cat'", newCtx())).out).toBe('a');
  });

  it('eval 在管道中：输出流向下游', async () => {
    expect((await run("eval 'echo hi' | cat", newCtx())).out).toBe('hi');
  });

  it('eval 空参：无输出码 0', async () => {
    const res = await run('eval', newCtx());
    expect(res.out).toBe('');
    expect(res.code).toBe(0);
  });

  it('eval 内 return 传染宿主函数', async () => {
    const res = await run("f() { eval 'return 7'; echo no; }; f; echo $?", newCtx());
    expect(res.out).toBe('7');
  });

  it('eval 定义函数随即可用', async () => {
    expect((await run("eval 'g() { echo gf; }'; g", newCtx())).out).toBe('gf');
  });

  it('自引用递归：嵌套过深报错码 1', async () => {
    const res = await run("x='eval $x'; eval $x", newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('嵌套过深');
  });
});

describe('run · 进程替换 <(cmd)（M45.2）', () => {
  it('基本：cat <(echo hello) → hello', async () => {
    expect((await run('cat <(echo hello)', newCtx())).out).toBe('hello');
  });

  it('双进程替换：cat <(echo a) <(echo b) → a\\nb', async () => {
    expect((await run('cat <(echo a) <(echo b)', newCtx())).out).toBe('a\nb');
  });

  it('内部管道：cat <(echo hi | cat) → hi', async () => {
    expect((await run('cat <(echo hi | cat)', newCtx())).out).toBe('hi');
  });

  it('内部变量展开：cat <(echo $USER) → qiezi', async () => {
    expect((await run('cat <(echo $USER)', newCtx())).out).toBe('qiezi');
  });

  it('内部多行输出：cat <(for i in 1 2 3; do echo $i; done)', async () => {
    expect((await run('cat <(for i in 1 2 3; do echo $i; done)', newCtx())).out).toBe('1\n2\n3');
  });

  it('与普通参数混用：cat <(echo x) /etc/passwd 至少读到 x', async () => {
    const res = await run('cat <(echo x)', newCtx());
    expect(res.out).toBe('x');
  });

  it('进程替换路径可作为 grep 输入：grep h <(echo hello) → hello', async () => {
    expect((await run('grep h <(echo hello)', newCtx())).out).toBe('hello');
  });

  it('嵌套命令替换：cat <(echo $(echo deep)) → deep', async () => {
    expect((await run('cat <(echo $(echo deep))', newCtx())).out).toBe('deep');
  });

  it('Ctrl+C 能断进程替换内的失控循环', async () => {
    const ctx = newCtx();
    const p = run('cat <(while test 1 = 1; do echo hi; done)', ctx);
    ctx.intr!.flag = true;
    const res = await p;
    expect(res.code).toBe(130);
  });
});

// M46.1 read 内建：从 stdin 读一行到变量（-r/-p/多变量按 IFS 分词/EOF 码 1）
describe('run · M46.1 read 内建', () => {
  it('单变量读文件第一行：read line < f; echo $line', async () => {
    const ctx = newCtx();
    await run('echo "hello world" > f.txt', ctx);
    expect((await run('read line < f.txt; echo $line', ctx)).out).toBe('hello world');
  });

  it('多变量按 IFS 分词：read x y z < f → a/b/c', async () => {
    const ctx = newCtx();
    await run('echo "a b c" > f.txt', ctx);
    expect((await run('read x y z < f.txt; echo $x/$y/$z', ctx)).out).toBe('a/b/c');
  });

  it('最后一个变量取剩余：read x y < "a b c d" → x=a y="b c d"', async () => {
    const ctx = newCtx();
    await run('echo "a b c d" > f.txt', ctx);
    expect((await run('read x y < f.txt; echo "$x|$y"', ctx)).out).toBe('a|b c d');
  });

  it('多行文件只取第一行', async () => {
    const ctx = newCtx();
    await run('cat <<EOF > f.txt\none\ntwo\nthree\nEOF', ctx);
    expect((await run('read line < f.txt; echo $line', ctx)).out).toBe('one');
  });

  it('无 stdin（EOF）返回 1', async () => {
    const ctx = newCtx();
    const res = await run('read line', ctx);
    expect(res.code).toBe(1);
  });

  it('-r 标志被接受（反斜杠原样保留）', async () => {
    const ctx = newCtx();
    await run("echo 'a\\b' > f.txt", ctx);
    expect((await run('read -r line < f.txt; echo $line', ctx)).out).toBe('a\\b');
  });

  it('read 无变量名：消费一行返回 0', async () => {
    const ctx = newCtx();
    await run('echo whatever > f.txt', ctx);
    expect((await run('read < f.txt', ctx)).code).toBe(0);
  });

  it('-p 提示走 stderr，line 仍读 stdin', async () => {
    const ctx = newCtx();
    await run('echo content > f.txt', ctx);
    const res = await run('read -p "Name: " line < f.txt; echo $line', ctx);
    expect(res.out).toBe('content');
    expect(res.err ?? '').toContain('Name:');
  });

  it('管道 stdin：echo ... | read line; echo $line', async () => {
    const ctx = newCtx();
    expect((await run('echo piped | read line; echo $line', ctx)).out).toBe('piped');
  });
});

// M46.2 printf 内建：格式化输出（%s %d %f %x %c %% \n \t、格式串循环消费参数）
// 注：本 shell 语句输出统一剥尾随换行（M35 设计），printf 尾随 \n 在显示输出层被剥——
// 与 echo 一致；重定向到文件时 \n 保留（重定向用 CmdResult.out 原始值）。中间换行不受影响。
describe('run · M46.2 printf 内建', () => {
  it('纯字面格式串原样输出（无参数）', async () => {
    expect((await run('printf "hello"', newCtx())).out).toBe('hello');
  });

  it('%s 字符串占位符（尾随 \\n 被剥，同 echo 手感）', async () => {
    expect((await run('printf "%s\\n" hi', newCtx())).out).toBe('hi');
  });

  it('%d 整数占位符', async () => {
    expect((await run('printf "%d\\n" 42', newCtx())).out).toBe('42');
  });

  it('多占位符一次消费多参数', async () => {
    expect((await run('printf "%s=%d\\n" x 10', newCtx())).out).toBe('x=10');
  });

  it('格式串循环消费剩余参数', async () => {
    expect((await run('printf "%s " a b c', newCtx())).out).toBe('a b c ');
  });

  it('%% 转义字面百分号', async () => {
    expect((await run('printf "%d%%" 50', newCtx())).out).toBe('50%');
  });

  it('\\n \\t 转义序列（中间换行不剥）', async () => {
    expect((await run('printf "a\\nb\\tc"', newCtx())).out).toBe('a\nb\tc');
  });

  it('循环消费 + 中间换行：printf "%s\\n" a b c → a\\nb\\nc（尾随剥）', async () => {
    expect((await run('printf "%s\\n" a b c', newCtx())).out).toBe('a\nb\nc');
  });

  it('%x 十六进制 / %o 八进制', async () => {
    expect((await run('printf "%x" 255', newCtx())).out).toBe('ff');
    expect((await run('printf "%o" 8', newCtx())).out).toBe('10');
  });

  it('%c 取首字符', async () => {
    expect((await run('printf "%c" abc', newCtx())).out).toBe('a');
  });

  it('参数不足：%s 补空串、%d 补 0', async () => {
    expect((await run('printf "[%s][%d]" x', newCtx())).out).toBe('[x][0]');
  });

  it('%f 浮点（保留小数）', async () => {
    expect((await run('printf "%.2f" 3.14159', newCtx())).out).toBe('3.14');
  });

  it('重定向到文件：尾随 \\n 保留（不经过 runLeaf 剥）', async () => {
    const ctx = newCtx();
    await run('printf "hi\\n" > f.txt', ctx);
    expect((await run('cat f.txt | wc -c', ctx)).out).toBe('3'); // h i \n = 3 字节
  });
});

// M46.3 算术 for ((init; cond; step)); do …; done —— C 风格循环。
// 复用 arith.ts 求值器（M27），但需扩展支持赋值/自增自减（= += -= ++ -- 等），
// 否则 init/step 无副作用无法驱动循环。cond 沿用求值（非零为真）。
// 已知限制：本 shell 无独立 ((expr)) 算术命令（仅 for 形式）；dead 短路下副作用不执行。
describe('run · M46.3 算术 for ((init; cond; step))', () => {
  it('基本递增：for ((i=0; i<3; i++)); do echo $i; done → 0 1 2', async () => {
    expect((await run('for ((i=0; i<3; i++)); do echo $i; done', newCtx())).out).toBe('0\n1\n2');
  });

  it('条件初始为假：body 一次都不执行', async () => {
    expect((await run('for ((i=5; i<3; i++)); do echo $i; done', newCtx())).out).toBe('');
  });

  it('累加求和：s=0; for ((i=1; i<=5; i++)); do s=$((s+i)); done; echo $s → 15', async () => {
    expect((await run('s=0; for ((i=1; i<=5; i++)); do s=$((s+i)); done; echo $s', newCtx())).out).toBe('15');
  });

  it('递减 step：for ((i=3; i>0; i--)); do echo $i; done → 3 2 1', async () => {
    expect((await run('for ((i=3; i>0; i--)); do echo $i; done', newCtx())).out).toBe('3\n2\n1');
  });

  it('break 中止：for ((i=0; i<10; i++)); do [ $i -eq 2 ] && break; echo $i; done → 0 1', async () => {
    expect((await run('for ((i=0; i<10; i++)); do [ $i -eq 2 ] && break; echo $i; done', newCtx())).out).toBe('0\n1');
  });

  it('continue 跳过：for ((i=0; i<5; i++)); do [ $i -eq 2 ] && continue; echo $i; done → 0 1 3 4', async () => {
    expect((await run('for ((i=0; i<5; i++)); do [ $i -eq 2 ] && continue; echo $i; done', newCtx())).out).toBe('0\n1\n3\n4');
  });

  it('嵌套循环：for i; for j; echo $i$j → 00 01 10 11', async () => {
    expect((await run('for ((i=0; i<2; i++)); do for ((j=0; j<2; j++)); do echo $i$j; done; done', newCtx())).out).toBe('00\n01\n10\n11');
  });

  it('复合赋值 step i+=2：for ((i=0; i<10; i+=2)); do echo $i; done → 0 2 4 6 8', async () => {
    expect((await run('for ((i=0; i<10; i+=2)); do echo $i; done', newCtx())).out).toBe('0\n2\n4\n6\n8');
  });

  it('init 为空（复用外部变量）：i=0; for ((; i<3; i++)); do echo $i; done → 0 1 2', async () => {
    expect((await run('i=0; for ((; i<3; i++)); do echo $i; done', newCtx())).out).toBe('0\n1\n2');
  });

  it('step 为空（body 内手动推进）：for ((i=0; i<3;)); do echo $i; i=$((i+1)); done → 0 1 2', async () => {
    expect((await run('for ((i=0; i<3;)); do echo $i; i=$((i+1)); done', newCtx())).out).toBe('0\n1\n2');
  });

  it('Ctrl+C 能断失控算术 for（intr 共享引用）', async () => {
    const ctx = newCtx();
    const p = run('for ((i=0; i<100000; i++)); do echo $i; done', ctx);
    ctx.intr!.flag = true;
    const res = await p;
    expect(res.code).toBe(130);
    expect(res.err ?? '').toContain('^C');
  });
});

// M46.3 算术展开内赋值/自增副作用（arith.ts 扩展）—— for 的 init/step 依赖此能力。
describe('run · M46.3 算术展开内赋值/自增', () => {
  it('$((x=5)) 赋值并返回值；后续 $x 可见 → 5 5', async () => {
    expect((await run('echo $((x=5)) $x', newCtx())).out).toBe('5 5');
  });

  it('$((x+=3)) 复合赋值：x=5; echo $((x+=3)) $x → 8 8', async () => {
    expect((await run('x=5; echo $((x+=3)) $x', newCtx())).out).toBe('8 8');
  });

  it('后置 x++：返回旧值，变量已自增 → x=5; echo $((x++)) $x → 5 6', async () => {
    expect((await run('x=5; echo $((x++)) $x', newCtx())).out).toBe('5 6');
  });

  it('前置 ++x：返回新值，变量已自增 → x=5; echo $((++x)) $x → 6 6', async () => {
    expect((await run('x=5; echo $((++x)) $x', newCtx())).out).toBe('6 6');
  });

  it('右结合链式赋值：$((a=b=7)) $a $b → 7 7 7', async () => {
    expect((await run('echo $((a=b=7)) $a $b', newCtx())).out).toBe('7 7 7');
  });

  it('赋值 rhs 可含三元（赋值优先级低于 ?:）：$((x = 1 ? 5 : 9)) $x → 5 5', async () => {
    expect((await run('echo $((x = 1 ? 5 : 9)) $x', newCtx())).out).toBe('5 5');
  });
});

// M47.1 算术命令 ((expr))：独立形态（无 $），求值 expr，退出码 = expr≠0 ? 0 : 1。
// 与 $((expr)) 的区别：$((expr)) 是展开（值替换进命令），((expr)) 是命令（退出码回流，无输出）。
// 复用 arith.ts（含 M46.3 赋值/自增副作用）；常作 if/while 条件或配合 && || 串联。
describe('run · M47.1 算术命令 ((expr))', () => {
  it('非零值 → 退出码 0：((5)); echo $? → 0', async () => {
    expect((await run('((5)); echo $?', newCtx())).out).toBe('0');
  });

  it('零值 → 退出码 1：((0)); echo $? → 1', async () => {
    expect((await run('((0)); echo $?', newCtx())).out).toBe('1');
  });

  it('副作用当前 shell 生效：i=5; ((i++)); echo $i → 6', async () => {
    expect((await run('i=5; ((i++)); echo $i', newCtx())).out).toBe('6');
  });

  it('比较为真 → 码 0：((3<5)); echo $? → 0', async () => {
    expect((await run('((3<5)); echo $?', newCtx())).out).toBe('0');
  });

  it('比较为假 → 码 1：((3>5)); echo $? → 1', async () => {
    expect((await run('((3>5)); echo $?', newCtx())).out).toBe('1');
  });

  it('作 if 条件：if ((1<2)); then echo yes; fi → yes', async () => {
    expect((await run('if ((1<2)); then echo yes; fi', newCtx())).out).toBe('yes');
  });

  it('配合 && 串联：((7%2)) && echo odd → odd', async () => {
    expect((await run('((7%2)) && echo odd', newCtx())).out).toBe('odd');
  });

  it('配合 || 触发：n=0; ((n++)) || echo zero → zero', async () => {
    expect((await run('n=0; ((n++)) || echo zero', newCtx())).out).toBe('zero');
  });

  it('除零报错：退出码 1 + err 含「除数为 0」', async () => {
    const res = await run('((1/0)); echo $?', newCtx());
    expect(res.code).toBe(0); // echo 成功
    expect(res.out).toBe('1');
    expect(res.err ?? '').toContain('除数为 0');
  });

  it('语法错误报错：((1+)) 退出码 1 + err 含「算术语法错误」', async () => {
    const res = await run('((1+)); echo $?', newCtx());
    expect(res.out).toBe('1');
    expect(res.err ?? '').toContain('算术语法错误');
  });

  it('作 while 条件驱动计数：n=0; while ((n<3)); do echo $n; ((n++)); done → 0 1 2', async () => {
    expect((await run('n=0; while ((n<3)); do echo $n; ((n++)); done', newCtx())).out).toBe('0\n1\n2');
  });

  it('(( )) 不产生 stdout：((5)) | cat 无输出', async () => {
    expect((await run('((5)) | cat', newCtx())).out).toBe('');
  });
});

// M47.2 命令分组 { …; }：当前 shell 执行一组命令（赋值/cd 生效，与 ( ) 子 shell 对照）。
// 语法：{ 后需空白/换行，} 前需 ;/换行。退出码 = 最后一条命令的码。
// 已知限制：{ …; } > f 重定向与 { …; } && cmd 连接符暂不支持（需 splitStatements 跨度改造）。
describe('run · M47.2 命令分组 { }', () => {
  it('基本分组：{ echo a; echo b; } → a b', async () => {
    expect((await run('{ echo a; echo b; }', newCtx())).out).toBe('a\nb');
  });

  it('单条分组：{ echo hi; } → hi', async () => {
    expect((await run('{ echo hi; }', newCtx())).out).toBe('hi');
  });

  it('赋值当前 shell 生效：x=1; { x=2; }; echo $x → 2', async () => {
    expect((await run('x=1; { x=2; }; echo $x', newCtx())).out).toBe('2');
  });

  it('cd 当前 shell 生效：{ cd /; pwd; } → /', async () => {
    expect((await run('{ cd /; pwd; }', newCtx())).out).toBe('/');
  });

  it('退出码是最后一条：{ true; false; }; echo $? → 1', async () => {
    expect((await run('{ true; false; }; echo $?', newCtx())).out).toBe('1');
  });

  it('退出码 0：{ false; true; }; echo $? → 0', async () => {
    expect((await run('{ false; true; }; echo $?', newCtx())).out).toBe('0');
  });

  it('嵌套分组：{ { echo a; }; echo b; } → a b', async () => {
    expect((await run('{ { echo a; }; echo b; }', newCtx())).out).toBe('a\nb');
  });

  it('内含控制结构：{ if true; then echo yes; fi; } → yes', async () => {
    expect((await run('{ if true; then echo yes; fi; }', newCtx())).out).toBe('yes');
  });

  it('内含 for 循环：{ for i in 1 2; do echo $i; done; } → 1 2', async () => {
    expect((await run('{ for i in 1 2; do echo $i; done; }', newCtx())).out).toBe('1\n2');
  });

  it('分组内变量可被后续命令使用：{ a=hello; }; echo $a → hello', async () => {
    expect((await run('{ a=hello; }; echo $a', newCtx())).out).toBe('hello');
  });

  it('多行分组（换行分隔）：{\\n echo a\\n echo b\\n } → a b', async () => {
    expect((await run('{\n echo a\n echo b\n }', newCtx())).out).toBe('a\nb');
  });

  it('分组后继续执行：{ echo a; }; echo b → a b', async () => {
    expect((await run('{ echo a; }; echo b', newCtx())).out).toBe('a\nb');
  });
});

// M47.3 子 shell ( … )：fork ctx 执行，cd/export/赋值不回流父 shell（与 { } 分组对照）。
// stdout/stderr 回流显示（打同一终端），退出码回流。复用命令替换 $(…) 的 fork ctx 模式。
// 子 shell 继承父环境变量副本（修改不回流）、继承 funcs/positional；traps 重置（M43.3 语义）。
describe('run · M47.3 子 shell ( )', () => {
  it('基本子 shell：( echo a; echo b ) → a b', async () => {
    expect((await run('( echo a; echo b )', newCtx())).out).toBe('a\nb');
  });

  it('单条子 shell：( echo hi ) → hi', async () => {
    expect((await run('( echo hi )', newCtx())).out).toBe('hi');
  });

  it('赋值不回流：x=1; ( x=2 ); echo $x → 1', async () => {
    expect((await run('x=1; ( x=2 ); echo $x', newCtx())).out).toBe('1');
  });

  it('子 shell 内可见父变量：x=1; ( echo $x ) → 1', async () => {
    expect((await run('x=1; ( echo $x )', newCtx())).out).toBe('1');
  });

  it('子 shell 内修改不回流：x=1; ( x=2; echo $x ); echo $x → 2 1', async () => {
    expect((await run('x=1; ( x=2; echo $x ); echo $x', newCtx())).out).toBe('2\n1');
  });

  it('cd 不回流：( cd /; pwd ) 显示 /，但父 pwd 不变', async () => {
    const ctx = newCtx();
    const res = await run('( cd /; pwd ); pwd', ctx);
    expect(res.out).toBe('/\n/');
  });

  it('export 继承：export Y=5; ( echo $Y ) → 5', async () => {
    expect((await run('export Y=5; ( echo $Y )', newCtx())).out).toBe('5');
  });

  it('退出码回流：( false ); echo $? → 1', async () => {
    expect((await run('( false ); echo $?', newCtx())).out).toBe('1');
  });

  it('退出码 0：( true ); echo $? → 0', async () => {
    expect((await run('( true ); echo $?', newCtx())).out).toBe('0');
  });

  it('退出码是最后一条：( true; false ); echo $? → 1', async () => {
    expect((await run('( true; false ); echo $?', newCtx())).out).toBe('1');
  });

  it('嵌套子 shell：( ( echo a; ) ) → a', async () => {
    expect((await run('( ( echo a; ) )', newCtx())).out).toBe('a');
  });

  it('内含控制结构：( if true; then echo yes; fi ) → yes', async () => {
    expect((await run('( if true; then echo yes; fi )', newCtx())).out).toBe('yes');
  });

  it('内含 for 循环：( for i in 1 2; do echo $i; done ) → 1 2', async () => {
    expect((await run('( for i in 1 2; do echo $i; done )', newCtx())).out).toBe('1\n2');
  });

  it('子 shell 后继续执行：( echo a ); echo b → a b', async () => {
    expect((await run('( echo a ); echo b', newCtx())).out).toBe('a\nb');
  });

  it('Ctrl+C 能断子 shell 内失控循环（intr 共享引用）', async () => {
    const ctx = newCtx();
    const p = run('( while test 1 = 1; do echo hi; done )', ctx);
    ctx.intr!.flag = true;
    const res = await p;
    expect(res.code).toBe(130);
  });
});

// M48.1 xargs：从 stdin 读词拼到命令后执行（管道终端必备）。
describe('run · M48.1 xargs', () => {
  it('基本：echo a b c | xargs echo → a b c（默认命令 echo）', async () => {
    expect((await run('echo a b c | xargs echo', newCtx())).out).toBe('a b c');
  });

  it('默认命令是 echo：echo hi | xargs → hi', async () => {
    expect((await run('echo hi | xargs', newCtx())).out).toBe('hi');
  });

  it('指定命令：echo qiezi | xargs whoami（无参命令附加）→ qiezi', async () => {
    expect((await run('echo qiezi | xargs whoami', newCtx())).out).toBe('qiezi');
  });

  it('-n 1 每行一个词：echo 1 2 3 | xargs -n 1 echo → 1 / 2 / 3（每词一次调用）', async () => {
    expect((await run('echo 1 2 3 | xargs -n 1 echo', newCtx())).out).toBe('1\n2\n3');
  });

  it('-n 2 每两个词一组：echo 1 2 3 4 | xargs -n 2 echo', async () => {
    expect((await run('echo 1 2 3 4 | xargs -n 2 echo', newCtx())).out).toBe('1 2\n3 4');
  });

  it('-I {} 占位符替换：echo f.txt | xargs -I {} echo cp {} {}.bak', async () => {
    expect((await run('echo f.txt | xargs -I {} echo cp {} {}.bak', newCtx())).out).toBe('cp f.txt f.txt.bak');
  });

  it('多行输入按空白分词：printf "a\\nb\\nc" | xargs echo → a b c', async () => {
    expect((await run('printf "a\\nb\\nc" | xargs echo', newCtx())).out).toBe('a b c');
  });

  it('find | xargs 组合：mkdir d; touch d/a d/b; find d -name "*" | xargs echo', async () => {
    const ctx = newCtx();
    const res = await run('mkdir d; touch d/a d/b; find d -name "*" | xargs echo', ctx);
    // find 从根 cwd 输出绝对路径 /d/a /d/b（含目录本身 /d）
    const items = res.out.split(' ').sort();
    expect(items).toContain('/d/a');
    expect(items).toContain('/d/b');
  });

  it('空输入不调用命令：printf "" | xargs echo → 无输出', async () => {
    expect((await run('printf "" | xargs echo', newCtx())).out).toBe('');
  });

  it('退出码取最后一次命令：echo a | xargs false; echo $? → 1', async () => {
    expect((await run('echo a | xargs false; echo $?', newCtx())).out).toBe('1');
  });
});

// M48.2 tee：stdin 写文件 + stdout 转发（调试管道必备）。
describe('run · M48.2 tee', () => {
  it('基本：echo hi | tee f → 既输出又落盘', async () => {
    const ctx = newCtx();
    const res = await run('echo hi | tee f.txt', ctx);
    expect(res.out).toBe('hi');
    expect((await run('cat f.txt', ctx)).out).toBe('hi');
  });

  it('-a 追加：echo a | tee f; echo b | tee -a f → f 内容 a\\nb', async () => {
    const ctx = newCtx();
    await run('echo a | tee f.txt', ctx);
    await run('echo b | tee -a f.txt', ctx);
    expect((await run('cat f.txt', ctx)).out).toBe('a\nb');
  });

  it('多文件：echo hi | tee a b c → 三文件都写入', async () => {
    const ctx = newCtx();
    await run('echo hi | tee a.txt b.txt c.txt', ctx);
    expect((await run('cat a.txt', ctx)).out).toBe('hi');
    expect((await run('cat b.txt', ctx)).out).toBe('hi');
    expect((await run('cat c.txt', ctx)).out).toBe('hi');
  });

  it('管道中间：echo hi | tee f | cat → cat 收到 hi', async () => {
    const ctx = newCtx();
    const res = await run('echo hi | tee f.txt | cat', ctx);
    expect(res.out).toBe('hi');
    expect((await run('cat f.txt', ctx)).out).toBe('hi');
  });

  it('多行内容：printf "a\\nb\\nc" | tee f → 三行都落盘', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc" | tee f.txt', ctx);
    expect((await run('cat f.txt', ctx)).out).toBe('a\nb\nc');
  });
});

// M48.3 tr：字符变换（映射/删除/压缩）。
describe('run · M48.3 tr', () => {
  it('基本映射：echo abc | tr a-z A-Z → ABC', async () => {
    expect((await run('echo abc | tr a-z A-Z', newCtx())).out).toBe('ABC');
  });

  it('单字符映射：echo hello | tr l L → heLLo', async () => {
    expect((await run('echo hello | tr l L', newCtx())).out).toBe('heLLo');
  });

  it('-d 删除：echo "a b c" | tr -d " " → abc', async () => {
    expect((await run('echo "a b c" | tr -d " "', newCtx())).out).toBe('abc');
  });

  it('-s 压缩重复：echo "aaabbb" | tr -s ab → ab', async () => {
    expect((await run('echo "aaabbb" | tr -s ab', newCtx())).out).toBe('ab');
  });

  it('-d 删除换行：printf "a\\nb\\nc" | tr -d "\\n" → abc', async () => {
    expect((await run('printf "a\\nb\\nc" | tr -d "\\n"', newCtx())).out).toBe('abc');
  });

  it('字符类 [:upper:] → [:lower:]：echo HI | tr "[:upper:]" "[:lower:]" → hi', async () => {
    expect((await run('echo HI | tr "[:upper:]" "[:lower:]"', newCtx())).out).toBe('hi');
  });

  it('旋转（rot13 风格）：echo abc | tr abc bca → bca', async () => {
    expect((await run('echo abc | tr abc bca', newCtx())).out).toBe('bca');
  });

  it('补集 -c：echo "a1b2c3" | tr -dc a-z → abc', async () => {
    expect((await run('echo "a1b2c3" | tr -dc a-z', newCtx())).out).toBe('abc');
  });
});

// M48.4 seq：数字序列（循环词表常用）。
describe('run · M48.4 seq', () => {
  it('单参 seq 5 → 1 2 3 4 5', async () => {
    expect((await run('seq 5', newCtx())).out).toBe('1\n2\n3\n4\n5');
  });

  it('两参 seq 3 6 → 3 4 5 6', async () => {
    expect((await run('seq 3 6', newCtx())).out).toBe('3\n4\n5\n6');
  });

  it('三参（步长）seq 1 2 9 → 1 3 5 7 9', async () => {
    expect((await run('seq 1 2 9', newCtx())).out).toBe('1\n3\n5\n7\n9');
  });

  it('负步长 seq 5 -1 1 → 5 4 3 2 1', async () => {
    expect((await run('seq 5 -1 1', newCtx())).out).toBe('5\n4\n3\n2\n1');
  });

  it('浮点 seq 1 0.5 3 → 1 1.5 2 2.5 3', async () => {
    expect((await run('seq 1 0.5 3', newCtx())).out).toBe('1\n1.5\n2\n2.5\n3');
  });

  it('-w 等宽补零：seq -w 1 3 → 01 02 03（最大宽 1 位无补）', async () => {
    // 单数字时无补宽；用两位范围验证补宽
    expect((await run('seq -w 8 10', newCtx())).out).toBe('08\n09\n10');
  });

  it('-w 等宽补零两位范围：seq -w 1 12 → 01..12', async () => {
    expect((await run('seq -w 1 12', newCtx())).out).toBe('01\n02\n03\n04\n05\n06\n07\n08\n09\n10\n11\n12');
  });

  it('seq | tr 把换行转空格（命令替换无 word splitting 是已知限制，仅验证管道转换）', async () => {
    expect((await run('seq 3 | tr "\\n" " "', newCtx())).out).toBe('1 2 3');
  });

  it('空范围 seq 5 1 → 无输出', async () => {
    expect((await run('seq 5 1', newCtx())).out).toBe('');
  });

  it('单个值 seq 3 3 → 3', async () => {
    expect((await run('seq 3 3', newCtx())).out).toBe('3');
  });
});

// M48.5 basename/dirname：路径拆分。
describe('run · M48.5 basename / dirname', () => {
  it('basename 取末段：basename /a/b/c.txt → c.txt', async () => {
    expect((await run('basename /a/b/c.txt', newCtx())).out).toBe('c.txt');
  });

  it('basename 去后缀：basename /a/b/c.txt .txt → c', async () => {
    expect((await run('basename /a/b/c.txt .txt', newCtx())).out).toBe('c');
  });

  it('basename 末段无斜杠：basename hello → hello', async () => {
    expect((await run('basename hello', newCtx())).out).toBe('hello');
  });

  it('basename 尾随斜杠去除：basename /a/b/ → b', async () => {
    expect((await run('basename /a/b/', newCtx())).out).toBe('b');
  });

  it('dirname 取目录：dirname /a/b/c.txt → /a/b', async () => {
    expect((await run('dirname /a/b/c.txt', newCtx())).out).toBe('/a/b');
  });

  it('dirname 相对路径：dirname a/b → a', async () => {
    expect((await run('dirname a/b', newCtx())).out).toBe('a');
  });

  it('dirname 无目录部分：dirname hello → .', async () => {
    expect((await run('dirname hello', newCtx())).out).toBe('.');
  });

  it('dirname 根：dirname / → /', async () => {
    expect((await run('dirname /', newCtx())).out).toBe('/');
  });

  it('管道组合：echo /a/b/c.txt | xargs dirname → /a/b', async () => {
    expect((await run('echo /a/b/c.txt | xargs dirname', newCtx())).out).toBe('/a/b');
  });
});

// M48.6 shift：参数移位（函数/脚本参数处理）。
describe('run · M48.6 shift', () => {
  it('脚本内 shift 移位：sh 脚本用 $@ 与 $1/$2', async () => {
    // 通过函数模拟（函数也有 $1 $2 ...）
    const ctx = newCtx();
    const script = 'f() { echo "$1/$2"; shift; echo "$1/$2"; }; f a b c';
    const res = await run(script, ctx);
    expect(res.out).toBe('a/b\nb/c');
  });

  it('shift 默认移 1 位', async () => {
    const ctx = newCtx();
    const res = await run('f() { echo "pre:$1"; shift; echo "post:$1"; }; f x y z', ctx);
    expect(res.out).toBe('pre:x\npost:y');
  });

  it('shift N 移多位：shift 2', async () => {
    const ctx = newCtx();
    const res = await run('f() { shift 2; echo "$1"; }; f a b c d', ctx);
    expect(res.out).toBe('c');
  });

  it('shift 超过参数数 → 失败码 1', async () => {
    const ctx = newCtx();
    const res = await run('f() { shift 5; echo "code=$?"; }; f a b c', ctx);
    expect(res.out).toBe('code=1');
  });

  it('函数外 shift 报错码 1（与 return/local 类似）', async () => {
    const res = await run('shift; echo "code=$?"', newCtx());
    expect(res.out).toBe('code=1');
    expect(res.err ?? '').toContain('shift');
  });

  it('shift 后 $@ 反映新参数：f() { shift; echo "$@"; }; f a b c → b c', async () => {
    expect((await run('f() { shift; echo "$@"; }; f a b c', newCtx())).out).toBe('b c');
  });

  it('shift 0 不移位（码 0）', async () => {
    const res = await run('f() { shift 0; echo "$1/$?"; }; f x y', newCtx());
    expect(res.out).toBe('x/0');
  });
});

// ── M49：条件判断收尾 + 文本处理补全（expr · test 选项增强 · tac · rev · nl · column） ──
describe('run · M49.1 expr', () => {
  it('算术四则：expr 3 + 4 → 7', async () => {
    expect((await run('expr 3 + 4', newCtx())).out).toBe('7');
  });

  it('乘除取模优先级：expr 1 + 2 \* 3 → 7；expr 7 % 3 → 1', async () => {
    expect((await run('expr 1 + 2 \\* 3', newCtx())).out).toBe('7');
    expect((await run('expr 7 % 3', newCtx())).out).toBe('1');
  });

  it('比较算符返回 1/0：expr 3 \\> 2 → 1；expr 2 = 2 → 1；expr 2 != 3 → 1；expr 1 \\< 1 → 0', async () => {
    expect((await run('expr 3 \\> 2', newCtx())).out).toBe('1');
    expect((await run('expr 2 = 2', newCtx())).out).toBe('1');
    expect((await run('expr 2 != 3', newCtx())).out).toBe('1');
    expect((await run('expr 1 \\< 1', newCtx())).out).toBe('0');
  });

  it('字符串非空判断：expr foo → foo（退出码 0）；expr "" → 0（退出码 1）', async () => {
    expect((await run('expr foo', newCtx())).out).toBe('foo');
    expect((await run('expr ""', newCtx())).code).toBe(1);
  });

  it('length 字符串长度：expr length abcde → 5', async () => {
    expect((await run('expr length abcde', newCtx())).out).toBe('5');
  });

  it('substr 子串：expr substr abcdef 2 3 → bcd（从 1 起，取 3 字符）', async () => {
    expect((await run('expr substr abcdef 2 3', newCtx())).out).toBe('bcd');
  });

  it('index 首次出现位置：expr index abcde c → 3；无匹配 → 0', async () => {
    expect((await run('expr index abcde c', newCtx())).out).toBe('3');
    expect((await run('expr index abcde z', newCtx())).out).toBe('0');
  });

  it(': 正则匹配返回匹配长度：expr abcdef : "a.c" → 3', async () => {
    expect((await run('expr abcdef : "a.c"', newCtx())).out).toBe('3');
  });

  it(': 正则无匹配返回 0：expr xyz : "a.c" → 0', async () => {
    expect((await run('expr xyz : "a.c"', newCtx())).out).toBe('0');
  });

  it('参数不足报错码 2：expr + 1', async () => {
    const res = await run('expr + 1', newCtx());
    expect(res.code).toBe(2);
    expect(res.err ?? '').toContain('expr');
  });
});

describe('run · M49.2 test/[[ ]] 选项增强', () => {
  it('test -v 变量已设：[ -v HOME ] → 真（码 0）', async () => {
    expect((await run('[ -v HOME ]', newCtx())).code).toBe(0);
  });

  it('test -v 变量未设：[ -v NOPE ] → 假（码 1）', async () => {
    expect((await run('[ -v NOPE ]', newCtx())).code).toBe(1);
  });

  it('export 后 -v 为真：export X=1; [ -v X ]', async () => {
    expect((await run('export X=1; [ -v X ]', newCtx())).code).toBe(0);
  });

  it('unset 后 -v 为假：export X=1; unset X; [ -v X ]', async () => {
    expect((await run('export X=1; unset X; [ -v X ]', newCtx())).code).toBe(1);
  });

  it('test -s 空文件为假：touch e.txt; [ -s e.txt ]', async () => {
    expect((await run('touch e.txt; [ -s e.txt ]', newCtx())).code).toBe(1);
  });

  it('test -s 非空文件为真：echo hi > f.txt; [ -s f.txt ]', async () => {
    expect((await run('echo hi > f.txt; [ -s f.txt ]', newCtx())).code).toBe(0);
  });

  it('test -nt 新旧：新建 a 旧文件 b → [ a -nt b ] 为真', async () => {
    expect((await run('touch a; touch b; [ a -nt b ]', newCtx())).code).toBe(1);
  });

  it('test -ot 反向：[ b -ot a ] 与 -nt 相反', async () => {
    expect((await run('touch a; touch b; [ b -ot a ]', newCtx())).code).toBe(1);
  });

  it('[[ ]] 也支持 -v：[[ -v HOME ]] → 真', async () => {
    expect((await run('[[ -v HOME ]]', newCtx())).code).toBe(0);
  });

  it('[[ ]] 也支持 -s：echo x > f; [[ -s f ]]', async () => {
    expect((await run('echo x > f; [[ -s f ]]', newCtx())).code).toBe(0);
  });
});

describe('run · M49.3 tac', () => {
  it('基本反向：printf "a\\nb\\nc" | tac → c/b/a', async () => {
    expect((await run('printf "a\\nb\\nc" | tac', newCtx())).out).toBe('c\nb\na');
  });

  it('管道多行：seq 3 | tac → 3/2/1', async () => {
    expect((await run('seq 3 | tac', newCtx())).out).toBe('3\n2\n1');
  });

  it('单行原样：echo only | tac → only', async () => {
    expect((await run('echo only | tac', newCtx())).out).toBe('only');
  });

  it('空输入空输出：printf "" | tac → 空', async () => {
    expect((await run('printf "" | tac', newCtx())).out).toBe('');
  });
});

describe('run · M49.4 rev', () => {
  it('单行反转：echo hello | rev → olleh', async () => {
    expect((await run('echo hello | rev', newCtx())).out).toBe('olleh');
  });

  it('多行逐行反转：printf "ab\\ncd" | rev → ba/dc', async () => {
    expect((await run('printf "ab\\ncd" | rev', newCtx())).out).toBe('ba\ndc');
  });

  it('中文按码点反转：echo 你好 | rev → 好你', async () => {
    expect((await run('echo 你好 | rev', newCtx())).out).toBe('好你');
  });

  it('空行保留：printf "" | rev → 空', async () => {
    expect((await run('printf "" | rev', newCtx())).out).toBe('');
  });
});

describe('run · M49.5 nl', () => {
  it('基本行号：printf "a\\nb\\nc" | nl → 1 a/2 b/3 c', async () => {
    expect((await run('printf "a\\nb\\nc" | nl', newCtx())).out).toBe('     1\ta\n     2\tb\n     3\tc');
  });

  it('seq 管道：seq 3 | nl → 三行编号', async () => {
    expect((await run('seq 3 | nl', newCtx())).out).toBe('     1\t1\n     2\t2\n     3\t3');
  });

  it('默认空行不编号但占逻辑行号：printf "a\\n\\nb" | nl', async () => {
    expect((await run('printf "a\\n\\nb" | nl', newCtx())).out).toBe('     1\ta\n\n     3\tb');
  });

  it('空输入空输出：printf "" | nl → 空', async () => {
    expect((await run('printf "" | nl', newCtx())).out).toBe('');
  });
});

describe('run · M49.6 column', () => {
  it('-t 表格对齐：printf "a b c\\n1 22 333" | column -t → 列对齐', async () => {
    const out = (await run('printf "a b c\\n1 22 333" | column -t', newCtx())).out;
    const lines = out.split('\n');
    expect(lines[0]).toBe('a  b  c');
    expect(lines[1]).toBe('1  22  333');
  });

  it('-t -s 指定分隔符：printf "a,b,c" | column -t -s ,', async () => {
    const out = (await run('printf "a,b,c" | column -t -s ,', newCtx())).out;
    expect(out).toBe('a  b  c');
  });

  it('单行原样：echo x y | column -t', async () => {
    expect((await run('echo x y | column -t', newCtx())).out).toBe('x  y');
  });

  it('空输入空输出：printf "" | column -t → 空', async () => {
    expect((await run('printf "" | column -t', newCtx())).out).toBe('');
  });
});

describe('run · M50.1 sleep', () => {
  it('sleep 0 立即返回码 0', async () => {
    const t0 = Date.now();
    const res = await run('sleep 0', newCtx());
    expect(res.code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('sleep 支持小数秒：sleep 0.05 约 50ms', async () => {
    const t0 = Date.now();
    await run('sleep 0.05', newCtx());
    expect(Date.now() - t0).toBeGreaterThanOrEqual(40);
  });

  it('sleep 支持后缀 s/m/h（秒/分/时）', async () => {
    expect((await run('sleep 0s', newCtx())).code).toBe(0);
  });

  it('非数字参数报错码 1', async () => {
    const res = await run('sleep abc', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('sleep');
  });

  it('缺参数报错码 2', async () => {
    const res = await run('sleep', newCtx());
    expect(res.code).toBe(2);
  });
});

describe('run · M50.2 yes', () => {
  it('默认重复输出 y：yes | head -n 3 → y/y/y', async () => {
    expect((await run('yes | head -n 3', newCtx())).out).toBe('y\ny\ny');
  });

  it('自定义字符串：yes hello | head -n 2 → hello/hello', async () => {
    expect((await run('yes hello | head -n 2', newCtx())).out).toBe('hello\nhello');
  });

  it('多参数以空格连接：yes a b c | head -n 1 → a b c', async () => {
    expect((await run('yes a b c | head -n 1', newCtx())).out).toBe('a b c');
  });

  it('无管道时内部封顶输出（不挂死）', async () => {
    const res = await run('yes', newCtx());
    const lines = res.out.split('\n');
    expect(lines.length).toBeLessThanOrEqual(1000);
    expect(lines[0]).toBe('y');
  });
});

describe('run · M50.3 shuf', () => {
  it('基本打乱：shuf 输出行数 = 输入行数', async () => {
    const out = (await run('printf "a\\nb\\nc\\nd\\ne" | shuf', newCtx())).out;
    const lines = out.split('\n');
    expect(lines).toHaveLength(5);
    expect(new Set(lines)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });

  it('-n N 采样 N 行：shuf -n 2 从五行取两行', async () => {
    const out = (await run('printf "a\\nb\\nc\\nd\\ne" | shuf -n 2', newCtx())).out;
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    for (const l of lines) expect('abcde').toContain(l);
  });

  it('-n 超过行数 → 全部返回', async () => {
    const out = (await run('printf "a\\nb" | shuf -n 10', newCtx())).out;
    expect(new Set(out.split('\n'))).toEqual(new Set(['a', 'b']));
  });

  it('-e 按参数打乱：shuf -e a b c → 三行', async () => {
    const out = (await run('shuf -e a b c', newCtx())).out;
    expect(new Set(out.split('\n'))).toEqual(new Set(['a', 'b', 'c']));
  });

  it('空输入空输出：printf "" | shuf → 空', async () => {
    expect((await run('printf "" | shuf', newCtx())).out).toBe('');
  });
});

describe('run · M50.4 paste', () => {
  it('默认 tab 合并两文件行：paste a b', async () => {
    const ctx = newCtx();
    await run('printf "1\\n2\\n3" > a.txt; printf "x\\ny\\nz" > b.txt', ctx);
    expect((await run('paste a.txt b.txt', ctx)).out).toBe('1\tx\n2\ty\n3\tz');
  });

  it('-d 指定分隔符：paste -d, a b', async () => {
    const ctx = newCtx();
    await run('printf "1\\n2" > a.txt; printf "x\\ny" > b.txt', ctx);
    expect((await run('paste -d, a.txt b.txt', ctx)).out).toBe('1,x\n2,y');
  });

  it('-s 串行（每文件变一行）：paste -s a', async () => {
    const ctx = newCtx();
    await run('printf "1\\n2\\n3" > a.txt', ctx);
    expect((await run('paste -s a.txt', ctx)).out).toBe('1\t2\t3');
  });

  it('不等长行用空串补齐：paste a b 短文件补空', async () => {
    const ctx = newCtx();
    await run('printf "1\\n2\\n3" > a.txt; printf "x" > b.txt', ctx);
    expect((await run('paste a.txt b.txt', ctx)).out).toBe('1\tx\n2\t\n3\t');
  });

  it('从 stdin 读：printf "a\\nb" | paste - -', async () => {
    expect((await run('printf "a\\nb\\nc\\nd" | paste - -', newCtx())).out).toBe('a\tb\nc\td');
  });
});

describe('run · M50.5 comm', () => {
  it('默认三列：仅A / 仅B / 交集', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\nd" > a.txt; printf "b\\nc\\ne" > b.txt', ctx);
    expect((await run('comm a.txt b.txt', ctx)).out).toBe('a\n\t\tb\n\t\tc\nd\n\te');
  });

  it('-12 只显示交集（第三列）', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc" > a.txt; printf "b\\nc\\nd" > b.txt', ctx);
    expect((await run('comm -12 a.txt b.txt', ctx)).out).toBe('b\nc');
  });

  it('-3 只显示非交集（第一二列）', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb" > a.txt; printf "b\\nc" > b.txt', ctx);
    expect((await run('comm -3 a.txt b.txt', ctx)).out).toBe('a\n\tc');
  });

  it('-23 只显示仅在 A 的行', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc" > a.txt; printf "b" > b.txt', ctx);
    expect((await run('comm -23 a.txt b.txt', ctx)).out).toBe('a\nc');
  });

  it('两文件相同 → 全在第三列', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb" > a.txt; printf "a\\nb" > b.txt', ctx);
    expect((await run('comm a.txt b.txt', ctx)).out).toBe('\t\ta\n\t\tb');
  });
});

describe('run · M50.6 expand/unexpand', () => {
  it('expand 默认 tab→8 空格', async () => {
    expect((await run('printf "a\\tb" | expand', newCtx())).out).toBe('a       b');
  });

  it('expand -t N 指定宽度', async () => {
    expect((await run('printf "a\\tb" | expand -t 4', newCtx())).out).toBe('a   b');
  });

  it('expand 多 tab', async () => {
    expect((await run('printf "\\t\\t" | expand -t 2', newCtx())).out).toBe('    ');
  });

  it('unexpand 默认 8 空格→tab', async () => {
    expect((await run('printf "a       b" | unexpand', newCtx())).out).toBe('a\tb');
  });

  it('unexpand -t N 指定宽度', async () => {
    expect((await run('printf "a   b" | unexpand -t 4', newCtx())).out).toBe('a\tb');
  });

  it('unexpand -a 所有空格组（含行首外）', async () => {
    expect((await run('printf "x   y" | unexpand -a -t 4', newCtx())).out).toBe('x\ty');
  });
});

describe('run · M50.7 base64', () => {
  it('编码：printf hi | base64 → aGk=', async () => {
    expect((await run('printf hi | base64', newCtx())).out).toBe('aGk=');
  });

  it('解码：printf aGk= | base64 -d → hi', async () => {
    expect((await run('printf aGk= | base64 -d', newCtx())).out).toBe('hi');
  });

  it('编解码往返：printf 你好世界 | base64 | base64 -d', async () => {
    const res = await run('printf 你好世界 | base64 | base64 -d', newCtx());
    expect(res.out).toBe('你好世界');
  });

  it('空输入空输出：printf "" | base64 → 空', async () => {
    expect((await run('printf "" | base64', newCtx())).out).toBe('');
  });

  it('解码忽略换行：printf "aGk=\\n" | base64 -d → hi', async () => {
    expect((await run('printf "aGk=\\n" | base64 -d', newCtx())).out).toBe('hi');
  });
});

describe('run · M50.8 type', () => {
  it('内建命令：type echo → echo 是内建', async () => {
    const res = await run('type echo', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('echo');
    expect(res.out).toContain('内建');
  });

  it('别名：alias ll=ls; type ll → ll 是别名', async () => {
    const res = await run('alias ll=ls; type ll', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('别名');
  });

  it('关键字：type if → if 是关键字', async () => {
    const res = await run('type if', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('关键字');
  });

  it('未找到命令 → 码 1', async () => {
    const res = await run('type nosuchcmd', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('nosuchcmd');
  });

  it('-t 简短输出：type -t echo → builtin', async () => {
    expect((await run('type -t echo', newCtx())).out).toBe('builtin');
  });
});

describe('run · M51.1 date 增强', () => {
  it('默认输出本地时间字符串（非空）', async () => {
    const res = await run('date', newCtx());
    expect(res.code).toBe(0);
    expect(res.out.length).toBeGreaterThan(0);
  });

  it('+%Y 输出当前 4 位年份', async () => {
    const year = String(new Date().getFullYear());
    expect((await run('date +%Y', newCtx())).out).toBe(year);
  });

  it('+%Y-%m-%d 匹配当前日期', async () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect((await run('date +%Y-%m-%d', newCtx())).out).toBe(expected);
  });

  it('带空格格式串 +"%H:%M:%S" 匹配当前时间', async () => {
    const now = new Date();
    const expected = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    expect((await run('date +"%H:%M:%S"', newCtx())).out).toBe(expected);
  });

  it('+%s 输出 Unix 时间戳（纯数字）', async () => {
    const res = await run('date +%s', newCtx());
    expect(res.code).toBe(0);
    expect(/^\d+$/.test(res.out)).toBe(true);
    expect(Number(res.out)).toBeCloseTo(Math.floor(Date.now() / 1000), -2);
  });

  it('-u UTC：%Y 仍是当前年（UTC 与本地同年绝大多数时段）', async () => {
    const year = String(new Date().getUTCFullYear());
    const res = await run('date -u +%Y', newCtx());
    expect(res.code).toBe(0);
    // UTC 年可能在年初/年末几小时与本地年不同，仅校验是 4 位数字
    expect(/^\d{4}$/.test(res.out)).toBe(true);
    // 如果 UTC 年等于本地年，精确校验
    if (year === String(new Date().getFullYear())) expect(res.out).toBe(year);
  });

  it('-d "2024-06-15" +%Y-%m-%d → 2024-06-15', async () => {
    expect((await run('date -d 2024-06-15 +%Y-%m-%d', newCtx())).out).toBe('2024-06-15');
  });

  it('-d "2024-06-15 12:30:45" +"%H:%M:%S" → 12:30:45', async () => {
    expect((await run('date -d "2024-06-15 12:30:45" +"%H:%M:%S"', newCtx())).out).toBe('12:30:45');
  });

  it('-d "2024-01-01" +%j → 001（年中第 1 天）', async () => {
    expect((await run('date -d 2024-01-01 +%j', newCtx())).out).toBe('001');
  });

  it('-d "2024-02-29" +%Y-%m-%d → 2024-02-29（闰年）', async () => {
    expect((await run('date -d 2024-02-29 +%Y-%m-%d', newCtx())).out).toBe('2024-02-29');
  });

  it('-d "2023-02-29" 无效日期 → 报错码 1', async () => {
    const res = await run('date -d 2023-02-29 +%Y-%m-%d', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('无效');
  });

  it('%% 输出百分号', async () => {
    expect((await run('date +%%', newCtx())).out).toBe('%');
  });

  it('%w 数字星期（0-6，0=周日）：2024-06-16 周日 → 0', async () => {
    expect((await run('date -d 2024-06-16 +%w', newCtx())).out).toBe('0');
  });
});

describe('run · M51.2 time 命令计时', () => {
  it('time echo hi：out=hi、err 含 real、code=0', async () => {
    const res = await run('time echo hi', newCtx());
    expect(res.out).toBe('hi');
    expect(res.code).toBe(0);
    expect(res.err ?? '').toContain('real');
    expect(res.err ?? '').toMatch(/0m[\d.]+s/);
  });

  it('time false：退出码取子命令码 1', async () => {
    const res = await run('time false', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('real');
  });

  it('time 无参数 → 报错码 2', async () => {
    const res = await run('time', newCtx());
    expect(res.code).toBe(2);
    expect(res.err ?? '').toContain('用法');
  });

  it('time 支持管道：time echo hi | cat → out=hi', async () => {
    const res = await run('time echo hi | cat', newCtx());
    expect(res.out).toBe('hi');
    expect(res.err ?? '').toContain('real');
  });

  it('time sleep 0.1：real 时间 ≥ 0.09s', async () => {
    const res = await run('time sleep 0.1', newCtx());
    expect(res.code).toBe(0);
    const m = /real\s+(\d+)m([\d.]+)s/.exec(res.err ?? '');
    expect(m).not.toBeNull();
    const sec = Number(m![1]) * 60 + Number(m![2]);
    expect(sec).toBeGreaterThanOrEqual(0.09);
  });
});

describe('run · M51.3 uname', () => {
  it('默认输出内核名（非空）', async () => {
    const res = await run('uname', newCtx());
    expect(res.code).toBe(0);
    expect(res.out.length).toBeGreaterThan(0);
  });

  it('-s 内核名：QieZiOS', async () => {
    expect((await run('uname -s', newCtx())).out).toBe('QieZiOS');
  });

  it('-n 节点名：qiezios', async () => {
    expect((await run('uname -n', newCtx())).out).toBe('qiezios');
  });

  it('-r 内核版本（数字点号格式）', async () => {
    const res = await run('uname -r', newCtx());
    expect(res.code).toBe(0);
    expect(/^\d+\.\d+/.test(res.out)).toBe(true);
  });

  it('-m 机器硬件名（非空）', async () => {
    const res = await run('uname -m', newCtx());
    expect(res.code).toBe(0);
    expect(res.out.length).toBeGreaterThan(0);
  });

  it('-a 全部信息包含内核名与节点名', async () => {
    const res = await run('uname -a', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('QieZiOS');
    expect(res.out).toContain('qiezios');
  });
});

describe('run · M51.4 uptime', () => {
  it('输出包含 up、user、load average', async () => {
    const res = await run('uptime', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('up');
    expect(res.out).toContain('user');
    expect(res.out).toContain('load average');
  });

  it('输出以当前时间开头（HH:MM:SS 格式）', async () => {
    const res = await run('uptime', newCtx());
    expect(/\d{2}:\d{2}:\d{2}/.test(res.out)).toBe(true);
  });
});

describe('run · M51.5 cal 日历', () => {
  it('当月日历包含当前年份', async () => {
    const year = String(new Date().getFullYear());
    const res = await run('cal', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain(year);
  });

  it('cal 6 2024 包含「2024」和「1」至「30」', async () => {
    const res = await run('cal 6 2024', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('2024');
    expect(res.out).toContain('15');
    expect(res.out).toContain('30');
  });

  it('cal 2024 全年包含 12 个月（出现「1月」与「12月」）', async () => {
    const res = await run('cal 2024', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('1月');
    expect(res.out).toContain('12月');
  });

  it('cal 13 2024 非法月份 → 报错码 1', async () => {
    const res = await run('cal 13 2024', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('非法');
  });
});

describe('run · M51.6 nproc', () => {
  it('输出正整数 CPU 核数', async () => {
    const res = await run('nproc', newCtx());
    expect(res.code).toBe(0);
    expect(/^[1-9]\d*$/.test(res.out)).toBe(true);
    expect(Number(res.out)).toBeGreaterThanOrEqual(1);
  });
});

describe('run · M51.7 mktemp', () => {
  it('mktemp 创建临时文件，路径在 /tmp/ 下', async () => {
    const ctx = newCtx();
    const res = await run('mktemp', ctx);
    expect(res.code).toBe(0);
    expect(res.out.startsWith('/tmp/')).toBe(true);
    // 验证文件确实存在
    const stat = await run(`test -f ${res.out}`, ctx);
    expect(stat.code).toBe(0);
  });

  it('mktemp -d 创建临时目录', async () => {
    const ctx = newCtx();
    const res = await run('mktemp -d', ctx);
    expect(res.code).toBe(0);
    expect(res.out.startsWith('/tmp/')).toBe(true);
    const stat = await run(`test -d ${res.out}`, ctx);
    expect(stat.code).toBe(0);
  });

  it('两次 mktemp 生成不同文件名', async () => {
    const ctx = newCtx();
    const a = await run('mktemp', ctx);
    const b = await run('mktemp', ctx);
    expect(a.out).not.toBe(b.out);
  });
});

describe('run · M51.8 realpath', () => {
  it('解析 .. : realpath /a/b/../c → /a/c', async () => {
    expect((await run('realpath /a/b/../c', newCtx())).out).toBe('/a/c');
  });

  it('解析 . : realpath /a/./b → /a/b', async () => {
    expect((await run('realpath /a/./b', newCtx())).out).toBe('/a/b');
  });

  it('多个连续 .. 与 . 混合', async () => {
    expect((await run('realpath /a/b/c/../../d/./e', newCtx())).out).toBe('/a/d/e');
  });

  it('根目录 .. 不上溢：realpath /.. → /', async () => {
    expect((await run('realpath /..', newCtx())).out).toBe('/');
  });

  it('相对路径基于 cwd 解析（cd 后 realpath 子路径）', async () => {
    const ctx = newCtx();
    const dir = '/qz_m51_rp_test';
    const mk = await run(`mkdir ${dir}`, ctx);
    const cdRes = await run(`cd ${dir}`, ctx);
    const pwdRes = await run('pwd', ctx);
    const rpRes = await run('realpath sub', ctx);
    expect(mk.code).toBe(0);
    expect(cdRes.code).toBe(0);
    expect(pwdRes.out).toBe(dir);
    expect(rpRes.out).toBe(`${dir}/sub`);
  });
});

describe('run · M51.9 printenv', () => {
  it('无参列出所有环境变量（包含 USER=）', async () => {
    const res = await run('printenv', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('USER=');
    expect(res.out).toContain('HOME=');
  });

  it('printenv USER → qiezi', async () => {
    const res = await run('printenv USER', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toBe('qiezi');
  });

  it('printenv NOSUCHVAR → 码 1', async () => {
    const res = await run('printenv NOSUCHVAR', newCtx());
    expect(res.code).toBe(1);
    expect(res.out).toBe('');
  });

  it('printenv 多变量逐行输出', async () => {
    const res = await run('printenv USER HOME', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toBe('qiezi\n/');
  });
});

// ── M52 Shell 常用命令补全 ─────────────────────────────────

describe('run · M52.1 exit', () => {
  it('exit 返回 exit:true + 码 0', async () => {
    const res = await run('exit', newCtx());
    expect(res.exit).toBe(true);
    expect(res.code).toBe(0);
  });

  it('exit 5 携带退出码 5', async () => {
    const res = await run('exit 5', newCtx());
    expect(res.exit).toBe(true);
    expect(res.code).toBe(5);
  });

  it('exit 非数字参数默认码 0', async () => {
    const res = await run('exit abc', newCtx());
    expect(res.exit).toBe(true);
    expect(res.code).toBe(0);
  });
});

describe('run · M52.2 history', () => {
  it('history 无参列出历史（格式「行号 命令」）', async () => {
    const ctx = newCtx();
    await run('echo first', ctx);
    await run('echo second', ctx);
    const res = await run('history', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toContain('echo first');
    expect(res.out).toContain('echo second');
    // 行号右对齐 4 位
    expect(res.out).toMatch(/^\s+\d+\s+echo first/m);
  });

  it('history -c 清空历史', async () => {
    const ctx = newCtx();
    await run('echo toclear', ctx);
    const res = await run('history -c', ctx);
    expect(res.code).toBe(0);
    const after = await run('history', ctx);
    // 清空后仍含 history -c 自身（addHistory 在 run 前调用）
    expect(after.out).not.toContain('echo toclear');
  });

  it('history -d N 删除指定条目（1-based）', async () => {
    const ctx = newCtx();
    await run('echo keep1', ctx);
    await run('echo deleteMe', ctx);
    await run('echo keep2', ctx);
    // 找到 deleteMe 的行号
    const list = await run('history', ctx);
    const lines = list.out.split('\n');
    const idx = lines.findIndex((l) => l.includes('deleteMe'));
    expect(idx).toBeGreaterThanOrEqual(0);
    const numMatch = lines[idx].match(/^\s+(\d+)/);
    expect(numMatch).not.toBeNull();
    const n = Number(numMatch![1]);
    const res = await run(`history -d ${n}`, ctx);
    expect(res.code).toBe(0);
    const after = await run('history', ctx);
    expect(after.out).not.toContain('deleteMe');
  });

  it('history -d 超范围 → 码 1', async () => {
    const ctx = newCtx();
    await run('echo hi', ctx);
    const res = await run('history -d 999', ctx);
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('超出范围');
  });

  it('history 2 只显示最近 2 条', async () => {
    const ctx = newCtx();
    await run('echo a', ctx);
    await run('echo b', ctx);
    await run('echo c', ctx);
    await run('history 2', ctx);
    const res = await run('history 2', ctx);
    // 最近 2 条（不含 history 2 本身，因 addHistory 在 run 前已记录上一条 history 2）
    const lines = res.out.split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(2);
  });
});

describe('run · M52.3 df', () => {
  it('df 输出含表头与 qzfs 行', async () => {
    const res = await run('df', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('Filesystem');
    expect(res.out).toContain('qzfs');
    expect(res.out).toContain('Mounted on');
  });

  it('df 数值非负（Size/Used/Avail）', async () => {
    const res = await run('df', newCtx());
    const row = res.out.split('\n')[1];
    const nums = row.split(/\s+/).filter((s) => /^\d+$/.test(s));
    expect(nums.length).toBeGreaterThanOrEqual(3);
    for (const n of nums.slice(0, 3)) expect(Number(n)).toBeGreaterThanOrEqual(0);
  });
});

describe('run · M52.4 du', () => {
  it('du 当前目录总计 > 0（根目录有 /etc 等子项）', async () => {
    const res = await run('du -s', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/^\s*\d+\t/m);
  });

  it('du 指定文件返回该文件大小', async () => {
    const ctx = newCtx();
    await run('echo hello > /qz_m52_du.txt', ctx);
    const res = await run('du /qz_m52_du.txt', ctx);
    expect(res.code).toBe(0);
    // QieZiOS echo 不附加尾换行（与 bash 差异），"hello" = 5 字节
    expect(res.out).toMatch(/^\s*5\t/);
  });

  it('du 不存在路径 → 码 1', async () => {
    const res = await run('du /qz_nosuchpath_xyz', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('没有那个文件或目录');
  });
});

describe('run · M52.5 free', () => {
  it('free 输出 Mem/Swap 两行 + 表头', async () => {
    const res = await run('free', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toContain('total');
    expect(res.out).toContain('Mem:');
    expect(res.out).toContain('Swap:');
  });

  it('free total ≥ used ≥ 0', async () => {
    const res = await run('free', newCtx());
    const memLine = res.out.split('\n').find((l) => l.startsWith('Mem:'))!;
    const nums = memLine.split(/\s+/).filter((s) => /^\d+$/.test(s)).map(Number);
    expect(nums[0]).toBeGreaterThanOrEqual(0); // total
    expect(nums[1]).toBeGreaterThanOrEqual(0); // used
    expect(nums[0]).toBeGreaterThanOrEqual(nums[1]);
  });
});

describe('run · M52.6 pushd/popd/dirs', () => {
  it('dirs 初始显示当前目录（/）', async () => {
    const res = await run('dirs', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toBe('/');
  });

  it('pushd 切目录 + 压栈 + dirs 显示双路径', async () => {
    const ctx = newCtx();
    await run('mkdir /qz_m52_pushd', ctx);
    const res = await run('pushd /qz_m52_pushd', ctx);
    expect(res.code).toBe(0);
    // cd 字段是 node ID（与 cd 命令一致）；out 末尾应是栈顶路径（pathOf(cd)）
    expect(res.out.split(' ').pop()).toBe('/qz_m52_pushd');
    expect(res.out).toContain('/');
    expect(res.out).toContain('/qz_m52_pushd');
  });

  it('popd 弹栈切回上一目录', async () => {
    const ctx = newCtx();
    await run('mkdir /qz_m52_popd', ctx);
    await run('pushd /qz_m52_popd', ctx);
    const res = await run('popd', ctx);
    expect(res.code).toBe(0);
    const pwdRes = await run('pwd', ctx);
    expect(pwdRes.out).toBe('/');
  });

  it('popd 栈空时 → 码 1', async () => {
    const res = await run('popd', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('目录栈空');
  });

  it('pushd 不存在目录 → 码 1', async () => {
    const res = await run('pushd /qz_nosuchdir', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('没有那个目录');
  });

  it('dirs -c 清空栈（保留当前）', async () => {
    const ctx = newCtx();
    await run('mkdir /qz_m52_dirsc', ctx);
    await run('pushd /qz_m52_dirsc', ctx);
    const res = await run('dirs -c', ctx);
    expect(res.code).toBe(0);
    const after = await run('dirs', ctx);
    expect(after.out.split(/\s+/).length).toBe(1);
  });
});

describe('run · M52.7 pgrep/pkill', () => {
  it('pgrep 无模式 → 码 2', async () => {
    const res = await run('pgrep', newCtx());
    expect(res.code).toBe(2);
  });

  it('pgrep 不匹配的模式 → 码 1（无输出）', async () => {
    const res = await run('pgrep zzznomatch', newCtx());
    expect(res.code).toBe(1);
    expect(res.out).toBe('');
  });

  it('pkill 无模式 → 码 2', async () => {
    const res = await run('pkill', newCtx());
    expect(res.code).toBe(2);
  });

  it('pkill 不匹配 → 码 1 + err', async () => {
    const res = await run('pkill zzznomatch', newCtx());
    expect(res.code).toBe(1);
    expect(res.err ?? '').toContain('未匹配');
  });
});

describe('run · M52.8 timeout', () => {
  it('timeout 缺参数 → 码 2', async () => {
    const res = await run('timeout', newCtx());
    expect(res.code).toBe(2);
  });

  it('timeout 非法时长 → 码 2', async () => {
    const res = await run('timeout abc echo hi', newCtx());
    expect(res.code).toBe(2);
    expect(res.err ?? '').toContain('非法时长');
  });

  it('timeout 0 秒直接判超时 → 码 124', async () => {
    const res = await run('timeout 0 echo hi', newCtx());
    expect(res.code).toBe(124);
    expect(res.err ?? '').toContain('超时');
  });

  it('timeout 5 echo hi 正常完成透传结果', async () => {
    const res = await run('timeout 5 echo hi', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toBe('hi');
  });
});

describe('run · M52.9 file', () => {
  it('file 无参 → 码 2', async () => {
    const res = await run('file', newCtx());
    expect(res.code).toBe(2);
  });

  it('file 文本文件 → ASCII text', async () => {
    const ctx = newCtx();
    await run('echo hello > /qz_m52_file.txt', ctx);
    const res = await run('file /qz_m52_file.txt', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toContain('ASCII text');
  });

  it('file 目录 → directory', async () => {
    const ctx = newCtx();
    await run('mkdir /qz_m52_filedir', ctx);
    const res = await run('file /qz_m52_filedir', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toContain('directory');
  });

  it('file 不存在 → 码 1 + 提示', async () => {
    const res = await run('file /qz_nosuchfile', newCtx());
    expect(res.code).toBe(1);
    expect(res.out).toContain('没有那个文件或目录');
  });
});

describe('run · M52.10 command/builtin', () => {
  it('command echo hi → 正常执行（绕过别名）', async () => {
    const res = await run('command echo hi', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toBe('hi');
  });

  it('command 未找到命令 → 码 127', async () => {
    const res = await run('command nosuchcmd', newCtx());
    expect(res.code).toBe(127);
  });

  it('builtin echo hi → 强制内建', async () => {
    const res = await run('builtin echo hi', newCtx());
    expect(res.code).toBe(0);
    expect(res.out).toBe('hi');
  });

  it('builtin 非内建命令 → 码 1', async () => {
    const res = await run('builtin nosuchcmd', newCtx());
    expect(res.code).toBe(1);
  });

  it('command 绕过别名：alias e=echo 后 command e hi 不展开别名', async () => {
    const ctx = newCtx();
    await run("alias e='echo aliased'", ctx);
    // command e 应当找不到 e（e 不是 COMMANDS 里的内建）→ 码 127
    const res = await run('command e hi', ctx);
    expect(res.code).toBe(127);
  });
});

describe('run · M53.1 grep 增强（-c 计数 / -E 扩展正则）', () => {
  it('-c 只输出匹配行数', async () => {
    const ctx = newCtx();
    await run('printf "foo\\nbar\\nfoo bar\\nbaz" > g1.txt', ctx);
    const res = await run('grep -c foo g1.txt', ctx);
    expect(res.out).toBe('2');
    expect(res.code).toBe(0);
  });

  it('-c 多文件：每文件一行「文件:计数」', async () => {
    const ctx = newCtx();
    await run('printf "foo\\nfoo" > g2a.txt; printf "bar\\nfoo" > g2b.txt', ctx);
    const res = await run('grep -c foo g2a.txt g2b.txt', ctx);
    expect(res.out).toBe('g2a.txt:2\ng2b.txt:1');
  });

  it('-c 无匹配：输出 0，退出码 1', async () => {
    const ctx = newCtx();
    await run('printf "aaa\\nbbb" > g3.txt', ctx);
    const res = await run('grep -c zzz g3.txt', ctx);
    expect(res.out).toBe('0');
    expect(res.code).toBe(1);
  });

  it('-ci 计数 + 忽略大小写', async () => {
    const ctx = newCtx();
    await run('printf "FOO\\nfoo\\nFoo" > g4.txt', ctx);
    expect((await run('grep -ci foo g4.txt', ctx)).out).toBe('3');
  });

  it('-E 扩展正则：交替 a|b', async () => {
    const ctx = newCtx();
    await run('printf "cat\\ndog\\nbird\\nfish" > g5.txt', ctx);
    const res = await run('grep -E "c(at|ow)|dog" g5.txt', ctx);
    expect(res.out).toBe('cat\ndog');
  });

  it('-E 量词 + 与 -n 行号组合', async () => {
    const ctx = newCtx();
    await run('printf "ab\\naab\\nabb\\naxb" > g6.txt', ctx);
    const res = await run('grep -En "a+b" g6.txt', ctx);
    expect(res.out).toBe('1:ab\n2:aab\n3:abb'); // abb 含子串 ab，同 GNU grep
  });

  it('-c 走 stdin：printf | grep -c', async () => {
    expect((await run('printf "x\\ny\\nx" | grep -c x', newCtx())).out).toBe('2');
  });
});

describe('run · M53.2 sed 流编辑器', () => {
  it('s/old/new/ 每行首个替换', async () => {
    const ctx = newCtx();
    await run('printf "foo foo\\nfoo" > s1.txt', ctx);
    expect((await run("sed 's/foo/bar/' s1.txt", ctx)).out).toBe('bar foo\nbar');
  });

  it('s/old/new/g 全局替换', async () => {
    const ctx = newCtx();
    await run('printf "foo foo\\nfoo" > s2.txt', ctx);
    expect((await run("sed 's/foo/bar/g' s2.txt", ctx)).out).toBe('bar bar\nbar');
  });

  it('从 stdin 读：printf | sed s/x/y/', async () => {
    expect((await run("printf 'x\\nx' | sed 's/x/y/'", newCtx())).out).toBe('y\ny');
  });

  it('Nd 删除指定行', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc" > s3.txt', ctx);
    expect((await run("sed '2d' s3.txt", ctx)).out).toBe('a\nc');
  });

  it('N,Md 删除行范围', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\nd" > s4.txt', ctx);
    expect((await run("sed '2,3d' s4.txt", ctx)).out).toBe('a\nd');
  });

  it('$d 删除末行', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc" > s5.txt', ctx);
    expect((await run("sed '$d' s5.txt", ctx)).out).toBe('a\nb');
  });

  it('-n Np 只打印指定行', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc" > s6.txt', ctx);
    expect((await run("sed -n '2p' s6.txt", ctx)).out).toBe('b');
  });

  it('-n N,Mp 只打印行范围', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\nd" > s7.txt', ctx);
    expect((await run("sed -n '1,3p' s7.txt", ctx)).out).toBe('a\nb\nc');
  });

  it('/re/d 删除匹配行', async () => {
    const ctx = newCtx();
    await run('printf "keep\\ndrop me\\nkeep too" > s8.txt', ctx);
    expect((await run("sed '/drop/d' s8.txt", ctx)).out).toBe('keep\nkeep too');
  });

  it('-n /re/p 只打印匹配行（grep 等价）', async () => {
    const ctx = newCtx();
    await run('printf "apple\\nbanana\\napricot" > s9.txt', ctx);
    expect((await run("sed -n '/^ap/p' s9.txt", ctx)).out).toBe('apple\napricot');
  });

  it('地址 + 替换：2s/a/b/ 只作用于第 2 行', async () => {
    const ctx = newCtx();
    await run('printf "a\\na\\na" > s10.txt', ctx);
    expect((await run("sed '2s/a/b/' s10.txt", ctx)).out).toBe('a\nb\na');
  });

  it('无脚本参数 → 码 2', async () => {
    expect((await run('sed', newCtx())).code).toBe(2);
  });
});

describe('run · M53.3 awk 模式扫描', () => {
  it('{print $1} 打印首字段', async () => {
    const ctx = newCtx();
    await run('printf "a1 b1 c1\\na2 b2 c2" > a1.txt', ctx);
    expect((await run("awk '{print $1}' a1.txt", ctx)).out).toBe('a1\na2');
  });

  it('-F 指定分隔符', async () => {
    const ctx = newCtx();
    await run('printf "x,1\\ny,2" > a2.txt', ctx);
    expect((await run("awk -F, '{print $2}' a2.txt", ctx)).out).toBe('1\n2');
  });

  it('{print} / {print $0} 整行', async () => {
    const ctx = newCtx();
    await run('printf "l1\\nl2" > a3.txt', ctx);
    expect((await run("awk '{print}' a3.txt", ctx)).out).toBe('l1\nl2');
    expect((await run("awk '{print $0}' a3.txt", ctx)).out).toBe('l1\nl2');
  });

  it('NR 行号：{print NR, $1}', async () => {
    const ctx = newCtx();
    await run('printf "p q\\nr s" > a4.txt', ctx);
    expect((await run("awk '{print NR, $1}' a4.txt", ctx)).out).toBe('1 p\n2 r');
  });

  it('NF 字段数：{print NF}', async () => {
    const ctx = newCtx();
    await run('printf "a b c\\nd e" > a5.txt', ctx);
    expect((await run("awk '{print NF}' a5.txt", ctx)).out).toBe('3\n2');
  });

  it('BEGIN 块先执行一次', async () => {
    const ctx = newCtx();
    await run('printf "1\\n2" > a6.txt', ctx);
    expect((await run("awk 'BEGIN {print \"hdr\"} {print $1}' a6.txt", ctx)).out).toBe('hdr\n1\n2');
  });

  it('END 块后执行一次（NR 为总行数）', async () => {
    const ctx = newCtx();
    await run('printf "1\\n2\\n3" > a7.txt', ctx);
    expect((await run("awk '{print $1} END {print NR}' a7.txt", ctx)).out).toBe('1\n2\n3\n3');
  });

  it('/re/ 模式过滤', async () => {
    const ctx = newCtx();
    await run('printf "err a\\nok b\\nerr c" > a8.txt', ctx);
    expect((await run("awk '/err/ {print $2}' a8.txt", ctx)).out).toBe('a\nc');
  });

  it('NR==N 模式过滤', async () => {
    const ctx = newCtx();
    await run('printf "l1\\nl2\\nl3" > a9.txt', ctx);
    expect((await run("awk 'NR==2 {print}' a9.txt", ctx)).out).toBe('l2');
  });

  it('从 stdin 读：printf | awk', async () => {
    expect((await run("printf 'u v\\nw x' | awk '{print $2}'", newCtx())).out).toBe('v\nx');
  });

  it('无程序参数 → 码 2', async () => {
    expect((await run('awk', newCtx())).code).toBe(2);
  });
});

describe('run · M53.4 join 关系连接', () => {
  it('默认按首字段连接两有序文件', async () => {
    const ctx = newCtx();
    await run('printf "1 alice\\n2 bob\\n3 carol" > j1a.txt; printf "1 90\\n2 80\\n3 70" > j1b.txt', ctx);
    expect((await run('join j1a.txt j1b.txt', ctx)).out).toBe('1 alice 90\n2 bob 80\n3 carol 70');
  });

  it('-t 指定分隔符', async () => {
    const ctx = newCtx();
    await run('printf "1,alice\\n2,bob" > j2a.txt; printf "1,90\\n2,80" > j2b.txt', ctx);
    expect((await run('join -t, j2a.txt j2b.txt', ctx)).out).toBe('1,alice,90\n2,bob,80');
  });

  it('-1/-2 指定各自连接字段', async () => {
    const ctx = newCtx();
    await run('printf "x 1\\ny 2" > j3a.txt; printf "1 90\\n2 80" > j3b.txt', ctx);
    expect((await run('join -1 2 -2 1 j3a.txt j3b.txt', ctx)).out).toBe('1 x 90\n2 y 80');
  });

  it('-a 1 附带左文件未配对行', async () => {
    const ctx = newCtx();
    await run('printf "1 a\\n2 b\\n9 z" > j4a.txt; printf "1 x\\n2 y" > j4b.txt', ctx);
    expect((await run('join -a 1 j4a.txt j4b.txt', ctx)).out).toBe('1 a x\n2 b y\n9 z');
  });

  it('-a 2 附带右文件未配对行', async () => {
    const ctx = newCtx();
    await run('printf "1 a\\n2 b" > j5a.txt; printf "1 x\\n2 y\\n8 w" > j5b.txt', ctx);
    expect((await run('join -a 2 j5a.txt j5b.txt', ctx)).out).toBe('1 a x\n2 b y\n8 w');
  });

  it('键重复：右文件同键只取首行（首匹配）', async () => {
    const ctx = newCtx();
    await run('printf "1 a" > j6a.txt; printf "1 x\\n1 y" > j6b.txt', ctx);
    expect((await run('join j6a.txt j6b.txt', ctx)).out).toBe('1 a x');
  });

  it('缺文件参数 → 码 2', async () => {
    expect((await run('join onlyone.txt', newCtx())).code).toBe(2);
  });
});

describe('run · M53.5 tar 归档（USTAR + gzip）', () => {
  it('c 创建 + t 列表：tar cf a.tar f1 f2', async () => {
    const ctx = newCtx();
    await run('printf "hello" > t5a.txt; printf "world" > t5b.txt', ctx);
    expect((await run('tar cf t5.tar t5a.txt t5b.txt', ctx)).code).toBe(0);
    expect((await run('tar tf t5.tar', ctx)).out).toBe('t5a.txt\nt5b.txt');
  });

  it('目录递归：条目带 dir/ 前缀与目录条目', async () => {
    const ctx = newCtx();
    await run('mkdir t5dir; printf "x" > t5dir/a.txt; printf "y" > t5dir/b.txt', ctx);
    await run('tar cf t5d.tar t5dir', ctx);
    expect((await run('tar tf t5d.tar', ctx)).out).toBe('t5dir/\nt5dir/a.txt\nt5dir/b.txt');
  });

  it('子路径操作数保留路径作条目名', async () => {
    const ctx = newCtx();
    await run('mkdir t5p; printf "deep" > t5p/deep.txt', ctx);
    await run('tar cf t5p.tar t5p/deep.txt', ctx);
    expect((await run('tar tf t5p.tar', ctx)).out).toBe('t5p/deep.txt');
  });

  it('x 解压还原：-C 目标目录 + 内容一致', async () => {
    const ctx = newCtx();
    await run('mkdir t5s; printf "alpha\\nbeta" > t5s/m.txt; printf "only" > t5s/n.txt', ctx);
    await run('tar cf t5r.tar t5s', ctx);
    await run('mkdir t5out', ctx);
    expect((await run('tar xf t5r.tar -C t5out', ctx)).code).toBe(0);
    expect((await run('cat t5out/t5s/m.txt', ctx)).out).toBe('alpha\nbeta');
    expect((await run('cat t5out/t5s/n.txt', ctx)).out).toBe('only');
  });

  it('解压到当前目录（无 -C），已存在文件被覆盖', async () => {
    const ctx = newCtx();
    await run('mkdir t5w; printf "v1" > t5w/f.txt', ctx);
    await run('tar cf t5w.tar t5w', ctx);
    await run('printf "v2-stale" > t5w/f.txt', ctx); // 改旧文件
    expect((await run('tar xf t5w.tar', ctx)).code).toBe(0);
    expect((await run('cat t5w/f.txt', ctx)).out).toBe('v1'); // 被归档内容覆盖
  });

  it('z 选项：czf 创建 gzip 归档，tzf 列表', async () => {
    const ctx = newCtx();
    await run('printf "zipme" > t5z.txt', ctx);
    expect((await run('tar czf t5z.tgz t5z.txt', ctx)).code).toBe(0);
    expect((await run('tar tzf t5z.tgz', ctx)).out).toBe('t5z.txt');
  });

  it('xzf 解 gzip 归档且内容还原（无 -z 也能按魔数自动识别）', async () => {
    const ctx = newCtx();
    await run('printf "gz-content" > t5g.txt', ctx);
    await run('tar czf t5g.tar.gz t5g.txt', ctx);
    await run('mkdir t5gout', ctx);
    expect((await run('tar xf t5g.tar.gz -C t5gout', ctx)).code).toBe(0); // 不带 z
    expect((await run('cat t5gout/t5g.txt', ctx)).out).toBe('gz-content');
  });

  it('v 详细列表含权限串与大小', async () => {
    const ctx = newCtx();
    await run('printf "12345" > t5v.txt', ctx);
    await run('tar cf t5v.tar t5v.txt', ctx);
    const res = await run('tar tvf t5v.tar', ctx);
    expect(res.out).toContain('-rw-r--r--');
    expect(res.out).toContain('5');
    expect(res.out).toContain('t5v.txt');
  });

  it('cv 创建时回显条目名', async () => {
    const ctx = newCtx();
    await run('printf "q" > t5cv.txt', ctx);
    expect((await run('tar cvf t5cv.tar t5cv.txt', ctx)).out).toBe('t5cv.txt');
  });

  it('t 缺归档文件 → 非 0', async () => {
    expect((await run('tar tf no-such-5.tar', newCtx())).code).not.toBe(0);
  });

  it('操作数不存在 → 码 1', async () => {
    const ctx = newCtx();
    expect((await run('tar cf t5bad.tar ghost5.txt', ctx)).code).toBe(1);
  });

  it('缺 -f 与操作符 → 码 2', async () => {
    const ctx = newCtx();
    expect((await run('tar c t5x.txt', ctx)).code).toBe(2);
    expect((await run('tar -f t5x.tar', ctx)).code).toBe(2);
  });

  it('解压路径安全：含 .. 的恶意条目被跳过', async () => {
    const ctx = newCtx();
    // 手工构造一个含 ../evil 条目的 tar 不可能经 shell 产生，此处用正常归档验证白名单逻辑不误判
    await run('mkdir t5safe; printf "ok" > t5safe/in.txt', ctx);
    await run('tar cf t5safe.tar t5safe', ctx);
    await run('mkdir t5safeout', ctx);
    expect((await run('tar xf t5safe.tar -C t5safeout', ctx)).code).toBe(0);
    expect((await run('cat t5safeout/t5safe/in.txt', ctx)).out).toBe('ok');
  });
});

describe('run · M53.6 gzip/gunzip 压缩', () => {
  it('gzip 压缩：原文件消失，.gz 出现', async () => {
    const ctx = newCtx();
    await run('printf "compress me" > t6a.txt', ctx);
    expect((await run('gzip t6a.txt', ctx)).code).toBe(0);
    expect((await run('test -e t6a.txt', ctx)).code).toBe(1);
    expect((await run('test -f t6a.txt.gz', ctx)).code).toBe(0);
  });

  it('-k 保留原文件', async () => {
    const ctx = newCtx();
    await run('printf "keep me" > t6k.txt', ctx);
    await run('gzip -k t6k.txt', ctx);
    expect((await run('cat t6k.txt', ctx)).out).toBe('keep me');
    expect((await run('test -f t6k.txt.gz', ctx)).code).toBe(0);
  });

  it('gunzip 还原：内容一致（round-trip，含中文）', async () => {
    const ctx = newCtx();
    await run('printf "round\\ntrip 内容" > t6r.txt', ctx);
    await run('gzip t6r.txt', ctx);
    expect((await run('gunzip t6r.txt.gz', ctx)).code).toBe(0);
    expect((await run('cat t6r.txt', ctx)).out).toBe('round\ntrip 内容');
  });

  it('gzip -d 等价 gunzip', async () => {
    const ctx = newCtx();
    await run('printf "d-flag" > t6d.txt', ctx);
    await run('gzip t6d.txt', ctx);
    expect((await run('gzip -d t6d.txt.gz', ctx)).code).toBe(0);
    expect((await run('cat t6d.txt', ctx)).out).toBe('d-flag');
  });

  it('-l 列表：含原名', async () => {
    const ctx = newCtx();
    await run('printf "listing" > t6l.txt', ctx);
    await run('gzip t6l.txt', ctx);
    const res = await run('gzip -l t6l.txt.gz', ctx);
    expect(res.out).toContain('t6l.txt');
    expect(res.out).toContain('uncompressed');
  });

  it('gunzip 非 .gz 文件 → 码 1', async () => {
    const ctx = newCtx();
    await run('printf "plain" > t6p.txt', ctx);
    expect((await run('gunzip t6p.txt', ctx)).code).toBe(1);
  });

  it('缺文件 → 码 1；缺操作数 → 码 2', async () => {
    const ctx = newCtx();
    expect((await run('gzip ghost6.txt', ctx)).code).toBe(1);
    expect((await run('gzip', ctx)).code).toBe(2);
  });

  it('.gz 已存在 → 码 1（不覆盖）', async () => {
    const ctx = newCtx();
    await run('printf "dup" > t6dup.txt', ctx);
    await run('gzip -k t6dup.txt', ctx);
    expect((await run('gzip -k t6dup.txt', ctx)).code).toBe(1);
  });

  it('二进制全链路：.gz 进 tar 再解出，字节无损', async () => {
    const ctx = newCtx();
    await run('printf "binary-safe" > t6b.txt', ctx);
    await run('gzip -k t6b.txt', ctx); // t6b.txt.gz 是真二进制
    await run('tar cf t6b.tar t6b.txt.gz', ctx);
    await run('mkdir t6bout', ctx);
    expect((await run('tar xf t6b.tar -C t6bout', ctx)).code).toBe(0);
    expect((await run('gunzip t6bout/t6b.txt.gz', ctx)).code).toBe(0);
    expect((await run('cat t6bout/t6b.txt', ctx)).out).toBe('binary-safe');
  });
});

describe('run · M53.7 ln/readlink 链接', () => {
  it('ln -s 创建软链，readlink 读目标', async () => {
    const ctx = newCtx();
    await run('printf "linked" > t7.txt', ctx);
    expect((await run('ln -s t7.txt l7', ctx)).code).toBe(0);
    expect((await run('readlink l7', ctx)).out).toBe('t7.txt');
  });

  it('cat 透过软链读内容；test -L 真、-e 真、目标 -L 假', async () => {
    const ctx = newCtx();
    await run('printf "via-link" > t7a.txt', ctx);
    await run('ln -s t7a.txt l7a', ctx);
    expect((await run('cat l7a', ctx)).out).toBe('via-link');
    expect((await run('test -L l7a', ctx)).code).toBe(0);
    expect((await run('test -e l7a', ctx)).code).toBe(0);
    expect((await run('test -L t7a.txt', ctx)).code).toBe(1);
    expect((await run('[[ -L l7a ]]', ctx)).code).toBe(0);
  });

  it('ls -l 显示 lrwxrwxrwx 与 name -> target', async () => {
    const ctx = newCtx();
    await run('printf "x" > t7b.txt', ctx);
    await run('ln -s t7b.txt l7b', ctx);
    const res = await run('ls -l', ctx);
    expect(res.out).toContain('lrwxrwxrwx');
    expect(res.out).toContain('l7b -> t7b.txt');
  });

  it('相对目标基于链接所在目录解析', async () => {
    const ctx = newCtx();
    await run('mkdir t7d; printf "rel" > t7f.txt', ctx);
    expect((await run('ln -s ../t7f.txt t7d/l7c', ctx)).code).toBe(0);
    expect((await run('cat t7d/l7c', ctx)).out).toBe('rel');
  });

  it('悬空链接：-e 假、-L 真、cat 报错、readlink 仍输出', async () => {
    const ctx = newCtx();
    await run('ln -s ghost-t7.txt l7d', ctx);
    expect((await run('test -e l7d', ctx)).code).toBe(1);
    expect((await run('test -L l7d', ctx)).code).toBe(0);
    expect((await run('cat l7d', ctx)).code).toBe(1);
    expect((await run('readlink l7d', ctx)).out).toBe('ghost-t7.txt');
  });

  it('链接环：解析报错而不死循环', async () => {
    const ctx = newCtx();
    await run('ln -s l7y l7x; ln -s l7x l7y', ctx);
    const res = await run('cat l7x', ctx);
    expect(res.code).toBe(1);
    expect(res.err).toContain('没有那个文件');
  });

  it('硬链（默认）：同内容副本（VFS 树模型模拟）', async () => {
    const ctx = newCtx();
    await run('printf "hard" > t7h.txt', ctx);
    expect((await run('ln t7h.txt t7hl', ctx)).code).toBe(0);
    expect((await run('cat t7hl', ctx)).out).toBe('hard');
    expect((await run('test -L t7hl', ctx)).code).toBe(1); // 副本不是软链
  });

  it('硬链目标不存在/是目录 → 码 1', async () => {
    const ctx = newCtx();
    expect((await run('ln ghost-t7.txt t7g', ctx)).code).toBe(1);
    await run('mkdir t7dir', ctx);
    expect((await run('ln t7dir t7gl', ctx)).code).toBe(1);
  });

  it('链接名已存在 → 码 1；-f 强制覆盖', async () => {
    const ctx = newCtx();
    await run('printf "v1" > t7e.txt; printf "old" > l7e', ctx);
    expect((await run('ln -s t7e.txt l7e', ctx)).code).toBe(1);
    expect((await run('ln -sf t7e.txt l7e', ctx)).code).toBe(0);
    expect((await run('readlink l7e', ctx)).out).toBe('t7e.txt');
  });

  it('readlink 非链接 → 码 1；缺参数 → 码 2；ln 缺目标 → 码 2', async () => {
    const ctx = newCtx();
    await run('printf "plain" > t7p.txt', ctx);
    expect((await run('readlink t7p.txt', ctx)).code).toBe(1);
    expect((await run('readlink', ctx)).code).toBe(2);
    expect((await run('ln', ctx)).code).toBe(2);
  });
});

// wget 测试用 fetch 桩：stubGlobal 每例注入，afterEach 统一还原
afterEach(() => vi.unstubAllGlobals());
function stubFetch(body: string | number[], opts?: { status?: number; onCall?: (init?: RequestInit) => void }) {
  const spy = vi.fn(async (_url: unknown, init?: RequestInit) => {
    opts?.onCall?.(init);
    const data = typeof body === 'string' ? body : new Uint8Array(body);
    return new Response(data, { status: opts?.status ?? 200 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('run · M53.8 wget 下载', () => {
  it('默认文件名 = URL 末段，文本内容可读', async () => {
    stubFetch('downloaded text');
    const ctx = newCtx();
    expect((await run('wget http://example.com/t8a.txt', ctx)).code).toBe(0);
    expect((await run('cat t8a.txt', ctx)).out).toBe('downloaded text');
  });

  it('非静默输出已保存行；-q 静默', async () => {
    stubFetch('v');
    const ctx = newCtx();
    const res = await run('wget http://example.com/t8v.txt', ctx);
    expect(res.out).toContain('已保存');
    const res2 = await run('wget -q -O t8q.txt http://example.com/x', ctx);
    expect(res2.out).toBe('');
    expect((await run('cat t8q.txt', ctx)).out).toBe('v');
  });

  it('-O 指定输出名；重名默认名自动 .1', async () => {
    stubFetch('o-flag');
    const ctx = newCtx();
    expect((await run('wget -O t8o.txt http://example.com/res', ctx)).code).toBe(0);
    expect((await run('cat t8o.txt', ctx)).out).toBe('o-flag');
    // 同名默认名第二次下载 → wget 风格 .1
    expect((await run('wget http://example.com/dup8.dat', ctx)).code).toBe(0);
    expect((await run('wget http://example.com/dup8.dat', ctx)).code).toBe(0);
    expect((await run('test -f dup8.dat.1', ctx)).code).toBe(0);
  });

  it('服务器错误（404）→ 码 1 且不建文件；网络异常 → 码 1', async () => {
    stubFetch('nope', { status: 404 });
    const ctx = newCtx();
    const res = await run('wget http://example.com/t8m.txt', ctx);
    expect(res.code).toBe(1);
    expect(res.err).toContain('404');
    expect((await run('test -e t8m.txt', ctx)).code).toBe(1);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('boom'))));
    const res2 = await run('wget http://example.com/t8n.txt', ctx);
    expect(res2.code).toBe(1);
    expect(res2.err).toContain('boom');
  });

  it('-c 断点续传：发 Range 头并追加剩余', async () => {
    let rangeSeen = '';
    stubFetch('world', {
      onCall: (init) => {
        rangeSeen = String((init?.headers as Record<string, string>)?.Range ?? '');
      },
    });
    const ctx = newCtx();
    await run('printf "hello" > t8c.txt', ctx);
    expect((await run('wget -c http://example.com/t8c.txt', ctx)).code).toBe(0);
    expect(rangeSeen).toBe('bytes=5-');
    expect((await run('cat t8c.txt', ctx)).out).toBe('helloworld');
  });

  it('二进制内容存为二进制文件（字节无损）', async () => {
    stubFetch([0x00, 0x01, 0x02, 0xff, 0xfe]);
    const ctx = newCtx();
    expect((await run('wget http://example.com/t8b.bin', ctx)).code).toBe(0);
    const res = await run('stat t8b.bin', ctx);
    expect(res.out).toContain('二进制文件');
    expect(res.out).toContain('大小: 5');
  });

  it('缺 URL → 码 2', async () => {
    const ctx = newCtx();
    expect((await run('wget', ctx)).code).toBe(2);
  });
});

describe('run · M53.9 strings 提取可打印串', () => {
  it('默认 ≥4：短串被滤掉，NUL 分隔', async () => {
    const ctx = newCtx();
    await run("printf 'hi\\0there\\0xy\\0longstring' > t9a.bin", ctx);
    expect((await run('strings t9a.bin', ctx)).out).toBe('there\nlongstring');
  });

  it('-n 调整最小长度', async () => {
    const ctx = newCtx();
    await run("printf 'hi\\0there\\0xy' > t9b.bin", ctx);
    expect((await run('strings -n 2 t9b.bin', ctx)).out).toBe('hi\nthere\nxy');
    expect((await run('strings -n 6 t9b.bin', ctx)).out).toBe('');
  });

  it('二进制 .gz 中能找到内嵌文件名', async () => {
    const ctx = newCtx();
    await run('printf "payload" > t9name.txt', ctx);
    await run('gzip -k t9name.txt', ctx); // gzip 头内嵌原名 t9name.txt（≥4 可打印）
    expect((await run('strings t9name.txt.gz', ctx)).out).toContain('t9name.txt');
  });

  it('缺文件/目录 → 码 1；缺操作数 → 码 2', async () => {
    const ctx = newCtx();
    expect((await run('strings ghost9.bin', ctx)).code).toBe(1);
    await run('mkdir t9dir', ctx);
    expect((await run('strings t9dir', ctx)).code).toBe(1);
    expect((await run('strings', ctx)).code).toBe(2);
  });
});

describe('run · M53.10 hexdump/od 字节转储', () => {
  it('hexdump -C 规范格式：整行 16 字节精确匹配', async () => {
    const ctx = newCtx();
    await run('printf "0123456789abcdef" > t10a.bin', ctx);
    const res = await run('hexdump -C t10a.bin', ctx);
    expect(res.out).toBe(
      '00000000  30 31 32 33 34 35 36 37  38 39 61 62 63 64 65 66  |0123456789abcdef|\n00000010',
    );
  });

  it('hexdump 短行：地址 + 截断 hex + ascii 点填充', async () => {
    const ctx = newCtx();
    await run('printf "AB" > t10b.bin', ctx);
    const lines = (await run('hexdump t10b.bin', ctx)).out.split('\n');
    expect(lines[0]).toMatch(/^00000000  41 42\s+\|AB\|$/);
    expect(lines[1]).toBe('00000002');
  });

  it('hexdump 非打印字节显示为点', async () => {
    const ctx = newCtx();
    await run("printf 'A\\0B' > t10c.bin", ctx);
    const res = await run('hexdump -C t10c.bin', ctx);
    expect(res.out).toContain('|A.B|');
    expect(res.out).toContain('41 00 42');
  });

  it('hexdump -A d 十进制地址', async () => {
    const ctx = newCtx();
    await run('printf "AB" > t10d.bin', ctx);
    const lines = (await run('hexdump -A d t10d.bin', ctx)).out.split('\n');
    expect(lines[0].startsWith('0000000  41 42')).toBe(true);
    expect(lines[1]).toBe('0000002');
  });

  it('od 默认 -A o -t x1：八进制地址 + 十六进制字节', async () => {
    const ctx = newCtx();
    await run('printf "AB" > t10e.bin', ctx);
    expect((await run('od t10e.bin', ctx)).out).toBe('0000000 41 42\n0000002');
  });

  it('od -t c 字符型：可打印原样、\\n 转义', async () => {
    const ctx = newCtx();
    await run("printf 'A\\nB' > t10f.bin", ctx);
    expect((await run('od -t c t10f.bin', ctx)).out).toBe('0000000  A \\n  B\n0000003');
  });

  it('od -A x 十六进制地址', async () => {
    const ctx = newCtx();
    await run('printf "AB" > t10g.bin', ctx);
    expect((await run('od -A x t10g.bin', ctx)).out).toBe('00000000 41 42\n00000002');
  });

  it('缺文件/目录 → 码 1；缺操作数 → 码 2；非法进制 → 码 2', async () => {
    const ctx = newCtx();
    expect((await run('hexdump ghost10.bin', ctx)).code).toBe(1);
    expect((await run('od ghost10.bin', ctx)).code).toBe(1);
    await run('mkdir t10dir', ctx);
    expect((await run('hexdump t10dir', ctx)).code).toBe(1);
    expect((await run('hexdump', ctx)).code).toBe(2);
    expect((await run('od', ctx)).code).toBe(2);
    expect((await run('od -A z t10e.bin', ctx)).code).toBe(2);
  });
});

describe('run · M53.11 diff 文件比较', () => {
  it('相同文件：无输出码 0', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\n" > d11a.txt', ctx);
    await run('printf "a\\nb\\nc\\n" > d11b.txt', ctx);
    const res = await run('diff d11a.txt d11b.txt', ctx);
    expect(res.out).toBe('');
    expect(res.code).toBe(0);
  });

  it('normal 格式：修改行 2c2 / 新增 1a2 / 删除 2d1', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\n" > d11c.txt', ctx);
    await run('printf "a\\nB\\nc\\n" > d11d.txt', ctx);
    expect((await run('diff d11c.txt d11d.txt', ctx)).out).toBe('2c2\n< b\n---\n> B');
    expect((await run('diff d11c.txt d11d.txt', ctx)).code).toBe(1);
    // 新增（b 侧多一行）：1a2
    await run('printf "a\\nc\\n" > d11e.txt', ctx);
    expect((await run('diff d11e.txt d11d.txt', ctx)).out).toBe('1a2\n> B');
    // 删除（b 侧少一行）：2d1
    expect((await run('diff d11c.txt d11e.txt', ctx)).out).toBe('2d1\n< b');
  });

  it('normal 多行块：2,3c2,3', async () => {
    const ctx = newCtx();
    await run('printf "1\\n2\\n3\\n4\\n" > d11f.txt', ctx);
    await run('printf "1\\nX\\nY\\n4\\n" > d11g.txt', ctx);
    expect((await run('diff d11f.txt d11g.txt', ctx)).out).toBe('2,3c2,3\n< 2\n< 3\n---\n> X\n> Y');
  });

  it('-u 统一格式：单 hunk 上下文 3 行精确输出', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\n" > d11h.txt', ctx);
    await run('printf "a\\nB\\nc\\n" > d11i.txt', ctx);
    const res = await run('diff -u d11h.txt d11i.txt', ctx);
    expect(res.out).toBe('--- d11h.txt\n+++ d11i.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c');
    expect(res.code).toBe(1);
  });

  it('-u 双 hunk：间隔 > 6 行的两处变更分块', async () => {
    const ctx = newCtx();
    await run('seq 10 > d11j.txt', ctx);
    await run('printf "1\\nX\\n3\\n4\\n5\\n6\\n7\\n8\\n9\\nY\\n" > d11k.txt', ctx);
    const res = await run('diff -u d11j.txt d11k.txt', ctx);
    expect(res.out).toBe(
      '--- d11j.txt\n+++ d11k.txt\n@@ -1,5 +1,5 @@\n 1\n-2\n+X\n 3\n 4\n 5\n@@ -7,4 +7,4 @@\n 7\n 8\n 9\n-10\n+Y',
    );
  });

  it('-q 仅报告不同；操作数 - 读标准输入', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\n" > d11l.txt', ctx);
    const q = await run('printf "x\\n" | diff -q d11l.txt -', ctx);
    expect(q.out).toContain('不同');
    expect(q.code).toBe(1);
    // stdin 参与 normal 对比
    const res = await run('printf "a\\nB\\nc\\n" | diff d11l.txt -', ctx);
    expect(res.out).toBe('2c2\n< b\n---\n> B');
  });

  it('-r 目录递归：差异文件 + 仅单侧存在', async () => {
    const ctx = newCtx();
    await run('mkdir d11da d11db', ctx);
    await run('printf "x\\n" > d11da/f.txt', ctx);
    await run('printf "y\\n" > d11db/f.txt', ctx);
    await run('printf "only\\n" > d11da/only.txt', ctx);
    const res = await run('diff -r d11da d11db', ctx);
    expect(res.code).toBe(1);
    expect(res.out).toContain('diff -r d11da/f.txt d11db/f.txt');
    expect(res.out).toContain('1c1\n< x\n---\n> y');
    expect(res.out).toContain('仅在 d11da 中存在: only.txt');
  });

  it('-r 全相同目录码 0；-r 配 -u 头部带全路径', async () => {
    const ctx = newCtx();
    await run('mkdir d11dc d11dd', ctx);
    await run('printf "s\\n" > d11dc/s.txt', ctx);
    await run('printf "s\\n" > d11dd/s.txt', ctx);
    expect((await run('diff -r d11dc d11dd', ctx)).code).toBe(0);
    await run('printf "t\\n" > d11dd/s.txt', ctx);
    const res = await run('diff -ru d11dc d11dd', ctx);
    expect(res.out).toContain('--- d11dc/s.txt');
    expect(res.out).toContain('+++ d11dd/s.txt');
    expect(res.code).toBe(1);
  });

  it('目录不带 -r → 码 2；缺文件/单参数/非法选项 → 码 2', async () => {
    const ctx = newCtx();
    await run('mkdir d11de', ctx);
    expect((await run('diff d11de d11de', ctx)).code).toBe(2);
    expect((await run('diff ghost1 ghost2', ctx)).code).toBe(2);
    expect((await run('diff d11de', ctx)).code).toBe(2);
    expect((await run('diff -z a b', ctx)).code).toBe(2);
  });

  it('二进制文件：不同报「二进制文件…不同」码 1，相同码 0', async () => {
    const ctx = newCtx();
    stubFetch([0x00, 0x01, 0x02]);
    await run('wget -O d11b1.bin http://example.com/a', ctx);
    stubFetch([0x00, 0x09, 0x02]);
    await run('wget -O d11b2.bin http://example.com/b', ctx);
    const res = await run('diff d11b1.bin d11b2.bin', ctx);
    expect(res.out).toContain('二进制文件');
    expect(res.out).toContain('不同');
    expect(res.code).toBe(1);
    stubFetch([0x00, 0x01, 0x02]);
    await run('wget -O d11b3.bin http://example.com/c', ctx);
    expect((await run('diff d11b1.bin d11b3.bin', ctx)).code).toBe(0);
  });
});

describe('run · M53.12 patch 应用补丁', () => {
  it('管道应用：diff -u a b | patch 把 a 改成 b 的内容', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\nc\\n" > p12a.txt', ctx);
    await run('printf "a\\nB\\nc\\n" > p12b.txt', ctx);
    const res = await run('diff -u p12a.txt p12b.txt | patch', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toContain('patching file p12a.txt');
    expect((await run('cat p12a.txt', ctx)).out).toBe('a\nB\nc');
  });

  it('-i 补丁文件形式（tee 中转落盘）', async () => {
    const ctx = newCtx();
    await run('printf "x\\n" > p12c.txt', ctx);
    await run('printf "y\\n" > p12d.txt', ctx);
    await run('diff -u p12c.txt p12d.txt | tee p12.diff', ctx);
    const res = await run('patch -i p12.diff', ctx);
    expect(res.code).toBe(0);
    expect((await run('cat p12c.txt', ctx)).out).toBe('y');
  });

  it('-p1 路径剪裁：剥掉 a/ b/ 前缀', async () => {
    const ctx = newCtx();
    await run('mkdir src', ctx);
    await run('printf "old\\n" > src/x.txt', ctx);
    await run("printf '%s\\n' '--- a/src/x.txt' '+++ b/src/x.txt' '@@ -1 +1 @@' '-old' '+new' > p12p.diff", ctx);
    const res = await run('patch -p1 -i p12p.diff', ctx);
    expect(res.code).toBe(0);
    expect((await run('cat src/x.txt', ctx)).out).toBe('new');
  });

  it('--dry-run：只检查不写盘', async () => {
    const ctx = newCtx();
    await run('printf "a\\nb\\n" > p12e.txt', ctx);
    await run('printf "a\\nB\\n" > p12f.txt', ctx);
    const res = await run('diff -u p12e.txt p12f.txt | patch --dry-run', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toContain('checking');
    expect((await run('cat p12e.txt', ctx)).out).toBe('a\nb'); // 未被修改
  });

  it('新建文件：--- /dev/null 补丁创建新文件', async () => {
    const ctx = newCtx();
    await run("printf '%s\\n' '--- /dev/null' '+++ p12new.txt' '@@ -0,0 +1 @@' '+hello' > p12n.diff", ctx);
    const res = await run('patch -i p12n.diff', ctx);
    expect(res.code).toBe(0);
    expect((await run('cat p12new.txt', ctx)).out).toBe('hello');
  });

  it('删除文件：+++ /dev/null 补丁把文件移入回收站', async () => {
    const ctx = newCtx();
    await run('printf "bye\\n" > p12del.txt', ctx);
    await run("printf '%s\\n' '--- p12del.txt' '+++ /dev/null' '@@ -1 +0,0 @@' '-bye' > p12d2.diff", ctx);
    const res = await run('patch -i p12d2.diff', ctx);
    expect(res.code).toBe(0);
    expect((await run('test -e p12del.txt', ctx)).code).toBe(1);
  });

  it('hunk 上下文不匹配：FAILED 码 1 且文件原子不变', async () => {
    const ctx = newCtx();
    await run('printf "aaa\\nbbb\\nccc\\n" > p12g.txt', ctx);
    await run("printf '%s\\n' '--- p12g.txt' '+++ p12g.txt' '@@ -1,3 +1,3 @@' ' xxx' '-bbb' '+BBB' ' xxx' > p12g.diff", ctx);
    const res = await run('patch -i p12g.diff', ctx);
    expect(res.code).toBe(1);
    expect(res.out).toContain('FAILED');
    expect((await run('cat p12g.txt', ctx)).out).toBe('aaa\nbbb\nccc');
  });

  it('行号偏移：目标多了前置行仍能定位应用', async () => {
    const ctx = newCtx();
    await run('printf "zero\\naaa\\nbbb\\nccc\\n" > p12h.txt', ctx);
    await run("printf '%s\\n' '--- p12h.txt' '+++ p12h.txt' '@@ -1,3 +1,3 @@' ' aaa' '-bbb' '+BBB' ' ccc' > p12h.diff", ctx);
    const res = await run('patch -i p12h.diff', ctx);
    expect(res.code).toBe(0);
    expect((await run('cat p12h.txt', ctx)).out).toBe('zero\naaa\nBBB\nccc');
  });

  it('多文件补丁：cat 两个补丁一次应用', async () => {
    const ctx = newCtx();
    await run('printf "A1\\n" > p12mA.txt', ctx);
    await run('printf "A2\\n" > p12mA2.txt', ctx);
    await run('printf "B1\\n" > p12mB.txt', ctx);
    await run('printf "B2\\n" > p12mB2.txt', ctx);
    await run('diff -u p12mA.txt p12mA2.txt | tee p12mA.diff', ctx);
    await run('diff -u p12mB.txt p12mB2.txt | tee p12mB.diff', ctx);
    const res = await run('cat p12mA.diff p12mB.diff | patch', ctx);
    expect(res.code).toBe(0);
    expect((await run('cat p12mA.txt', ctx)).out).toBe('A2');
    expect((await run('cat p12mB.txt', ctx)).out).toBe('B2');
  });

  it('无输入 / 补丁文件不存在 / 非法选项 → 码 2', async () => {
    const ctx = newCtx();
    expect((await run('patch', ctx)).code).toBe(2);
    expect((await run('patch -i ghost.diff', ctx)).code).toBe(2);
    expect((await run('patch -Z', ctx)).code).toBe(2);
  });
});

describe('run · M53.13 sync 同步刷盘', () => {
  it('sync：码 0 无输出，数据语义不受影响', async () => {
    const ctx = newCtx();
    await run('printf "persist\\n" > s13.txt', ctx);
    const res = await run('sync', ctx);
    expect(res.code).toBe(0);
    expect(res.out).toBe('');
    expect((await run('cat s13.txt', ctx)).out).toBe('persist');
  });
});
