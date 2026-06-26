// ───────────────────────────────────────────────────────────
// 手册页注册表（对标 Linux 的 man）。每条 = 名称 + 用法 + 说明。
// shell 的 `man <命令>` 读它；新增命令时顺手补一条即可。
// ───────────────────────────────────────────────────────────
export interface ManPage {
  title: string; // 一句话标题
  syn: string; // SYNOPSIS（用法）
  desc: string; // DESCRIPTION（可多句）
}

export const MAN: Record<string, ManPage> = {
  help: { title: '命令总览', syn: 'help [命令]', desc: '列出全部命令；带参数时等价于 man <命令>，显示该命令的手册页。' },
  man: { title: '查看手册页', syn: 'man [命令]', desc: '显示某命令的用法与说明。无参数时列出所有有手册页的命令。' },

  // 浏览 / 文件
  pwd: { title: '显示当前目录', syn: 'pwd', desc: '打印当前工作目录的绝对路径。' },
  ls: { title: '列目录内容', syn: 'ls [-l] [路径]', desc: '列出目录内容（目录在前）。-l 显示权限/属主/大小/修改时间。列根目录时附带虚拟挂载 proc/ dev/。' },
  cd: { title: '切换目录', syn: 'cd [路径]', desc: '改变当前工作目录。支持绝对/相对路径、. 与 ..。无参数回到根 /。不支持进入 /proc /dev 等虚拟目录。' },
  cat: { title: '查看/拼接内容', syn: 'cat [文件...]', desc: '打印文件内容。无文件参数时透传标准输入（配合管道）。读文件受权限位约束。' },
  echo: { title: '输出文本', syn: 'echo [文本...]', desc: '把参数原样输出（以空格连接）。支持 $VAR 变量替换。常配合 > 写文件。' },
  mkdir: { title: '新建目录', syn: 'mkdir <目录...>', desc: '创建一个或多个目录。父目录须已存在。' },
  touch: { title: '新建空文件', syn: 'touch <文件...>', desc: '创建不存在的空文件（已存在则不动）。' },
  rm: { title: '删除', syn: 'rm <路径...>', desc: '把文件/目录移入回收站（软删除，可在回收站还原）。不能删根目录。' },
  mv: { title: '移动/重命名', syn: 'mv <源> <目标>', desc: '目标是已存在目录则移入；否则按目标名重命名（可跨目录）。' },
  cp: { title: '复制', syn: 'cp <源文件> <目标>', desc: '复制文本文件。目标是目录则复制进去；否则按目标名新建。暂不支持二进制/目录。' },
  open: { title: '打开 App 或文件', syn: 'open <appId|路径>', desc: '是 App id 就启动该 App；是文件就用记事本/图片查看器打开；是目录就用文件管理器打开。由终端 open 启动的进程父进程为本终端。' },

  // 文本处理
  grep: { title: '按模式过滤行', syn: 'grep [-vinr] 模式 [文件...]', desc: '输出匹配（正则，非法则按字面量）的行。-i 忽略大小写、-n 显示行号、-r 递归目录、-v 反选。无文件读标准输入。有匹配退出码 0、无匹配 1。' },
  find: { title: '查找文件', syn: 'find [路径] [-name 通配] [-type f|d]', desc: '递归列出路径下的条目。-name 按文件名通配（* ?）筛选、-type 限定文件/目录。默认从当前目录。' },
  wc: { title: '统计行/词/字符', syn: 'wc [-lwc] [文件]', desc: '统计行数/词数/字符数。无标志全显示。无文件读标准输入。' },
  head: { title: '取开头若干行', syn: 'head [-n N] [文件]', desc: '输出前 N 行（默认 10）。无文件读标准输入。' },
  tail: { title: '取结尾若干行', syn: 'tail [-n N] [文件]', desc: '输出后 N 行（默认 10）。无文件读标准输入。' },
  sort: { title: '排序行', syn: 'sort [-rn] [文件]', desc: '按行排序。-r 逆序、-n 数值排序。无文件读标准输入。' },
  uniq: { title: '去相邻重复行', syn: 'uniq [-c] [文件]', desc: '折叠相邻重复行。-c 在每行前加出现次数。常配合 sort 使用。' },
  cut: { title: '按列切取', syn: 'cut -d<分隔> -f<字段> [文件]', desc: '按分隔符切列取指定字段（-f1 或 -f1,3）。默认分隔符为制表符。无文件读标准输入。' },

  // 权限 / 用户
  chmod: { title: '改权限', syn: 'chmod <八进制> <路径...>', desc: '设置权限位（如 644 / 755 / 600）。' },
  chown: { title: '改属主', syn: 'chown <用户> <路径...>', desc: '设置文件/目录的属主。' },
  stat: { title: '查看元数据', syn: 'stat <路径>', desc: '显示名称/类型/大小/权限/属主/创建与修改时间。' },
  whoami: { title: '当前用户', syn: 'whoami', desc: '打印当前用户名。' },
  id: { title: '用户 uid/gid', syn: 'id [用户]', desc: '显示用户的 uid 与 gid（默认当前用户）。' },
  users: { title: '列出用户', syn: 'users', desc: '列出系统已知用户。' },
  su: { title: '切换用户', syn: 'su [用户]', desc: '切换当前 shell 的身份（无密码，单机隐喻）。无参数切到 root（提示符变 #）。' },
  sudo: { title: '以 root 运行', syn: 'sudo <命令>', desc: '以 root 身份执行一条命令，执行完恢复原身份。用于需要 root 的操作（如 useradd）。' },
  useradd: { title: '新建用户', syn: 'useradd <用户名>', desc: '新增一个用户（仅 root 可用，uid 从 1001 起）。会同步写入 /etc/passwd。' },

  // 进程 / 服务
  ps: { title: '进程快照', syn: 'ps', desc: '列出窗口进程（PID/PPID/状态/标题）。' },
  pstree: { title: '进程树', syn: 'pstree', desc: '以 init(0) 为根按父子关系画进程树。' },
  jobs: { title: '作业列表', syn: 'jobs', desc: '把窗口进程当作业列出（运行/停止）。本 shell 无 & 后台作业，为简化视图。' },
  kill: { title: '发信号给进程', syn: 'kill [-9|-STOP|-CONT|-TERM] <pid>', desc: '默认 TERM 终止；-9/KILL 强制关闭；-STOP 挂起(最小化)；-CONT 恢复。' },
  systemctl: { title: '管理后台服务', syn: 'systemctl [list|status|start|stop|restart|enable|disable] [服务]', desc: '查看/控制后台服务（init）。enable/disable 持久化开机启动；start/stop 为运行时操作。' },
  pkg: { title: '远程 App 仓库', syn: 'pkg [list|search 词|install id|repo URL]', desc: '从远程仓库（catalog URL）浏览并安装 App（对标 apt）。list 列出、search 搜索、install 安装到「我的 App」、repo 查看/设置仓库源。也有图形界面「应用商店」。' },

  // 网络 / 环境 / 主题
  curl: { title: '抓取 URL', syn: 'curl [-i|-I] <url>', desc: '用浏览器 fetch 抓取一个 URL 并输出正文。-i 含状态行、-I 只看响应头。受同源/CORS 限制。' },
  fetch: { title: 'curl 的别名', syn: 'fetch [-i|-I] <url>', desc: '同 curl。' },
  hostname: { title: '主机名', syn: 'hostname', desc: '打印主机名（环境变量 HOSTNAME）。' },
  ai: { title: '问 AI', syn: 'ai <问题>（或 … | ai <指令>）', desc: '在命令行向 AI 提问，输出回答。可用管道把内容喂给它，如 cat 笔记.txt | ai 总结要点。和助手 App 共用同一个 AI 引擎。反过来，助手也能用 run_shell 跑这些命令。' },
  env: { title: '列环境变量', syn: 'env', desc: '打印所有环境变量（KEY=VALUE）。' },
  export: { title: '设环境变量', syn: 'export KEY=VALUE', desc: '设置环境变量（当前 shell 会话内）。要持久化可写进 /etc/profile。' },
  unset: { title: '删环境变量', syn: 'unset KEY...', desc: '删除一个或多个环境变量。' },
  which: { title: '命令位置', syn: 'which <命令>', desc: '若命令是内置命令，按 PATH 显示其路径（如 /bin/ls）。' },
  source: { title: '执行脚本', syn: 'source <文件>（或 . <文件>）', desc: '逐行执行一个文件里的命令（共享当前 shell 环境）。开终端时会自动 source /etc/profile。' },
  theme: { title: '改主题', syn: 'theme dark|light|#hex', desc: '切换明暗或设置主色。无参数显示当前主题。' },
  clear: { title: '清屏', syn: 'clear', desc: '清空终端输出（也可按 Ctrl+L）。' },
};
