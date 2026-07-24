// histexpand 历史展开测试：!!/!n/!-n/!str/!?str? + 引号/转义/字面规则 + 失败路径
// + 词指示符（M28）+ 独立简写 !$ !^ !* + 替换/打印修饰符。
// 纯函数裸跑（history 数组注入，旧→新顺序与 cmdHistory.list 一致）。
import { describe, it, expect } from 'vitest';
import { histExpand } from './histexpand';

const HIST = ['ls -la', 'echo hello', 'sudo rm -rf /tmp/x', 'git status', 'echo done'];
// 多词命令专用历史：词 = [sudo, rm, -rf, /tmp/x]（0-based 含命令名）
const HISTW = ['sudo rm -rf /tmp/x'];

describe('histExpand · 基本形态', () => {
  it('!! 展开为上一条命令', () => {
    expect(histExpand('!!', HIST)).toEqual({ ok: true, line: 'echo done', changed: true });
  });

  it('sudo !!：词内展开（bash 高频用法）', () => {
    expect(histExpand('sudo !!', HIST)).toEqual({ ok: true, line: 'sudo echo done', changed: true });
  });

  it('!n 取第 n 条（1-based 从旧数）', () => {
    expect(histExpand('!2', HIST)).toEqual({ ok: true, line: 'echo hello', changed: true });
    expect(histExpand('!1', HIST)).toEqual({ ok: true, line: 'ls -la', changed: true });
  });

  it('!-n 取倒数第 n 条（!-1 == !!）', () => {
    expect(histExpand('!-1', HIST)).toEqual({ ok: true, line: 'echo done', changed: true });
    expect(histExpand('!-3', HIST)).toEqual({ ok: true, line: 'sudo rm -rf /tmp/x', changed: true });
  });

  it('!str 展开为最近以 str 开头的命令', () => {
    expect(histExpand('!git', HIST)).toEqual({ ok: true, line: 'git status', changed: true });
    expect(histExpand('!echo', HIST)).toEqual({ ok: true, line: 'echo done', changed: true }); // 取最近一条
  });

  it('!?str? 展开为最近包含 str 的命令', () => {
    expect(histExpand('!?rm?', HIST)).toEqual({ ok: true, line: 'sudo rm -rf /tmp/x', changed: true });
  });

  it('!?str 闭合 ? 可省（取到行尾）', () => {
    expect(histExpand('!?stat', HIST)).toEqual({ ok: true, line: 'git status', changed: true });
  });

  it('一行多处展开', () => {
    expect(histExpand('!echo && !!', HIST)).toEqual({ ok: true, line: 'echo done && echo done', changed: true });
  });

  it('无可展开项：原样返回 changed=false', () => {
    expect(histExpand('echo hi', HIST)).toEqual({ ok: true, line: 'echo hi', changed: false });
  });
});

describe('histExpand · 引号与转义规则', () => {
  it('单引号内不展开（bash 强引用）', () => {
    expect(histExpand("echo '!!'", HIST)).toEqual({ ok: true, line: "echo '!!'", changed: false });
  });

  it('双引号内展开', () => {
    expect(histExpand('echo "!!"', HIST)).toEqual({ ok: true, line: 'echo "echo done"', changed: true });
  });

  it('\\! 转义为字面 !（反斜杠丢弃）', () => {
    expect(histExpand('echo \\!!', HIST)).toEqual({ ok: true, line: 'echo !!', changed: false });
  });

  it('! 后空白/词尾是字面 !', () => {
    expect(histExpand('echo wow! ', HIST)).toEqual({ ok: true, line: 'echo wow! ', changed: false });
    expect(histExpand('echo wow!', HIST)).toEqual({ ok: true, line: 'echo wow!', changed: false });
  });

  it('!= 是字面（test 取反场景）', () => {
    expect(histExpand('test a != b', HIST)).toEqual({ ok: true, line: 'test a != b', changed: false });
  });
});

describe('histExpand · 失败路径（event not found）', () => {
  it('空历史 !! 报错', () => {
    expect(histExpand('!!', [])).toEqual({ ok: false, error: '!!: 事件未找到' });
  });

  it('!n 序号越界报错', () => {
    expect(histExpand('!99', HIST)).toEqual({ ok: false, error: '!99: 事件未找到' });
  });

  it('!-n 倒数越界报错', () => {
    expect(histExpand('!-99', HIST)).toEqual({ ok: false, error: '!-99: 事件未找到' });
  });

  it('!str 无前缀匹配报错', () => {
    expect(histExpand('!xyz', HIST)).toEqual({ ok: false, error: '!xyz: 事件未找到' });
  });

  it('!?str? 无包含匹配报错', () => {
    expect(histExpand('!?xyz?', HIST)).toEqual({ ok: false, error: '!?xyz?: 事件未找到' });
  });

  it('行内前段已展开、后段失败：整体失败不执行', () => {
    const r = histExpand('!echo && !xyz', HIST);
    expect(r).toEqual({ ok: false, error: '!xyz: 事件未找到' });
  });
});

describe('histExpand · 词指示符（:^ :$ :* :n 范围）', () => {
  it('!!:^ 取词 1（首个参数）', () => {
    expect(histExpand('!!:^', HISTW)).toEqual({ ok: true, line: 'rm', changed: true });
  });

  it('!!:$ 取末词', () => {
    expect(histExpand('!!:$', HISTW)).toEqual({ ok: true, line: '/tmp/x', changed: true });
  });

  it('!!:* 取词 1..末', () => {
    expect(histExpand('!!:*', HISTW)).toEqual({ ok: true, line: 'rm -rf /tmp/x', changed: true });
  });

  it('!!:n 数字取词（0-based 含命令名）', () => {
    expect(histExpand('!!:0', HISTW)).toEqual({ ok: true, line: 'sudo', changed: true });
    expect(histExpand('!!:2', HISTW)).toEqual({ ok: true, line: '-rf', changed: true });
  });

  it('!!:n-m / :n- / :n* 范围选取', () => {
    expect(histExpand('!!:1-2', HISTW)).toEqual({ ok: true, line: 'rm -rf', changed: true });
    expect(histExpand('!!:1-', HISTW)).toEqual({ ok: true, line: 'rm -rf', changed: true }); // 省略末词
    expect(histExpand('!!:1*', HISTW)).toEqual({ ok: true, line: 'rm -rf /tmp/x', changed: true });
  });

  it(':* 无参数时为空串不报错（bash 同款）', () => {
    expect(histExpand('echo !!:*', ['ls'])).toEqual({ ok: true, line: 'echo ', changed: true });
  });

  it('词指示符后行内其余文本原样拼接', () => {
    expect(histExpand('echo !!:2 tail', HISTW)).toEqual({ ok: true, line: 'echo -rf tail', changed: true });
  });

  it('!n / !-n / !?str? 事件同样可跟词指示符', () => {
    expect(histExpand('!3:^', HIST)).toEqual({ ok: true, line: 'rm', changed: true });
    expect(histExpand('!-2:$', HIST)).toEqual({ ok: true, line: 'status', changed: true });
    expect(histExpand('!?status?:^', HIST)).toEqual({ ok: true, line: 'status', changed: true });
  });

  it('词下标越界报错', () => {
    expect(histExpand('!!:4', HISTW)).toEqual({ ok: false, error: '4: 词下标越界' });
    expect(histExpand('!!:1-9', HISTW)).toEqual({ ok: false, error: '1-9: 词下标越界' });
  });

  it('!!:^ 单词命令无参数 → 越界', () => {
    expect(histExpand('!!:^', ['ls'])).toEqual({ ok: false, error: '^: 词下标越界' });
  });
});

describe('histExpand · 独立简写 !$ !^ !*', () => {
  it('!$ == !!:$（上一条的末词）', () => {
    expect(histExpand('cp !$', HISTW)).toEqual({ ok: true, line: 'cp /tmp/x', changed: true });
  });

  it('!^ == !!:^（上一条的首个参数）', () => {
    expect(histExpand('!^', HISTW)).toEqual({ ok: true, line: 'rm', changed: true });
  });

  it('!* == !!:*（上一条的全部参数）', () => {
    expect(histExpand('!*', HISTW)).toEqual({ ok: true, line: 'rm -rf /tmp/x', changed: true });
  });

  it('简写后可继续跟修饰符', () => {
    expect(histExpand('!$:s/x/yy/', HISTW)).toEqual({ ok: true, line: '/tmp/yy', changed: true });
  });
});

describe('histExpand · 替换修饰符 :s :gs', () => {
  it(':s/old/new/ 只换首个匹配', () => {
    expect(histExpand('!!:s/foo/baz/', ['echo foo foo bar'])).toEqual({ ok: true, line: 'echo baz foo bar', changed: true });
  });

  it(':gs/old/new/ 全局替换', () => {
    expect(histExpand('!!:gs/a/b/', ['echo aaa'])).toEqual({ ok: true, line: 'echo bbb', changed: true });
  });

  it('分隔符任意字符（:s|a|b|）', () => {
    expect(histExpand('!!:s|/tmp|/home|', ['cat /tmp/x'])).toEqual({ ok: true, line: 'cat /home/x', changed: true });
  });

  it('结尾分隔符可省（:s/a/b）', () => {
    expect(histExpand('!!:s/foo/bar', ['echo foo'])).toEqual({ ok: true, line: 'echo bar', changed: true });
  });

  it('\\/ 转义字面分隔符', () => {
    expect(histExpand('!!:s/\\//~/', ['echo /tmp'])).toEqual({ ok: true, line: 'echo ~tmp', changed: true });
  });

  it('old 为空 → 失败报错', () => {
    expect(histExpand('!!:s//x/', ['echo hi'])).toEqual({ ok: false, error: 's//x/: 替换目标为空' });
  });

  it('old 无匹配：原样返回不报错（bash 同款）', () => {
    expect(histExpand('!!:s/zzz/q/', ['echo hi'])).toEqual({ ok: true, line: 'echo hi', changed: true });
  });

  it('缺中间分隔符 → 无法识别的修饰符', () => {
    expect(histExpand('!!:s/a', ['echo aaa'])).toEqual({ ok: false, error: '无法识别的修饰符 :s/a' });
  });

  it('多个替换可叠加', () => {
    expect(histExpand('!!:s/a/b/:s/c/d/', ['foo abc'])).toEqual({ ok: true, line: 'foo bbd', changed: true });
  });

  it('!str 后可直接跟修饰符（str 终止于冒号）', () => {
    expect(histExpand('!git:s/status/diff/', HIST)).toEqual({ ok: true, line: 'git diff', changed: true });
  });
});

describe('histExpand · 打印修饰符 :p', () => {
  it('!!:p → printOnly（只打印不执行）', () => {
    expect(histExpand('!!:p', HIST)).toEqual({ ok: true, line: 'echo done', changed: true, printOnly: true });
  });

  it('修饰符叠加 !!:s/a/b/:p', () => {
    expect(histExpand('!!:s/a/b/:p', ['echo aaa'])).toEqual({ ok: true, line: 'echo baa', changed: true, printOnly: true });
  });

  it('词指示符 + :p（!!:$:p）', () => {
    expect(histExpand('!!:$:p', HISTW)).toEqual({ ok: true, line: '/tmp/x', changed: true, printOnly: true });
  });
});

describe('histExpand · 修饰符失败与引号', () => {
  it('无法识别的修饰符报错', () => {
    expect(histExpand('!!:xyz', HIST)).toEqual({ ok: false, error: '无法识别的修饰符 :xyz' });
  });

  it('单引号内 !…:s 整体不展开（其后的修饰符也不解析）', () => {
    expect(histExpand("echo '!!:s/a/b/'", HIST)).toEqual({ ok: true, line: "echo '!!:s/a/b/'", changed: false });
  });
});
