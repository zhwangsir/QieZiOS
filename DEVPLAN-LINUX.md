# QieZiOS 对标 Linux · 开发计划（自治循环的真相源）

> 这是「类 Linux 系统化」的待办清单。**自治开发心跳（定时任务）每次触发会读这个文件，挑第一个未完成项推进**。
> 勾选规则：完成且通过验证才把 `[ ]` 改成 `[x]`，并在该项下补一句**验证结论**。

---

## 一、对标 Linux 的差距分析（为什么做这些）

QieZiOS 是**浏览器里的 Web OS**（软件层的"系统"隐喻，不碰硬件/内核态）。所以"对标 Linux"= 在浏览器沙箱内，补齐让它**用起来像真系统**的能力，而不是去写真内核。

已有（相当扎实）：进程表+PID+生命周期、事件总线 IPC、跨沙箱 postMessage+能力白名单、服务层+监督（崩溃自愈）、3 个守护进程、VFS（CRUD/move/回收站/二进制）、syscall 门面 `sys.*`、可观测性（dmesg/事件流/任务管理器）、调度（提醒）、AI（驱动系统+视觉）、用户 App 包管理（.qzapp.json）、网页 App、持久化。

**相对 Linux 的主要缺口**（→ 转成下面的开发项）：

| Linux 能力 | QieZiOS 现状 | 缺口 |
|---|---|---|
| Shell + coreutils + 终端 | **完全没有** | 🔴 最大缺口 |
| 标准流 + 管道/重定向 `\| > <` | 无 | 🔴 |
| 文本处理 grep/find/wc/sed/sort | 无（仅 Files 过滤） | 🟠 |
| 路径字符串解析 `/a/b` `..` | VFS 是 id 制，无 | 🔴 shell 前置 |
| 环境变量 / `/etc` 配置 / rc | 无 | 🟠 |
| `/proc` `/dev` `/etc` 虚拟文件系统 | 无 | 🟠 很"Linux" |
| 权限与所有权 rwx/owner/chmod | VNode 无权限字段 | 🟠 |
| 用户/账户 uid/su/sudo | 单一隐式用户 | 🟠 |
| 进程模型加深 ppid/信号/退出码/job | 仅 kill/suspend | 🟠 |
| init 依赖/可配置开机服务 | 服务硬编码 | 🟢 |
| 网络工具 curl/wget | 仅 AI 代理 | 🟢 |
| man/help 文档 | 无 | 🟢 |
| 远程 App 仓库（apt-like 安装） | 仅本地导入 | 🟢 |
| 后端账号 + 同步鉴权 | /sync 无鉴权 | 🟢 大工程 |

---

## 二、开发清单（按依赖与影响排序）

### Phase G1 — 终端与 Shell（旗舰，解锁最多"Linux 感"）✅ 完成
- [x] **G1.1 路径解析层**：`vfs` 加 `resolvePath(cwd, pathStr)`（绝对/相对/`.`/`..`/root）+ `pathOf(id)`（节点→绝对路径串）。shell 与一切路径命令的地基。
  - ✅ 浏览器实测：`cd demo`→prompt 变 `/demo`、`cd ..`回 `/`、`/nope` 正确报错。
- [x] **G1.2 Shell 引擎** `lib/shell.ts`：分词器 + 命令表 + 执行上下文（cwd/env/上次退出码）+ coreutils（pwd ls cd cat echo mkdir touch rm mv cp clear help whoami date open apps ps kill theme env export）+ 基础重定向 `>` `>>` + `$VAR` 替换。纯逻辑，可单测。
  - ✅ 实测：`echo hello > note.txt`→`cat`回读、`ls -l`显示大小/mtime、`echo $USER`替换、`open calculator`真启动计算器、`boguscmd` 退出码 127。
- [x] **G1.3 终端 App** `Terminal.svelte`（🖥️）：滚动输出区 + 命令行 + 历史(↑/↓) + Tab 补全(命令/路径) + 等宽终端样式；登记 appList/registry/Dock。
  - ✅ 实测：完整命令序列 DOM 级通过、控制台 0 报错、Dock 出现 🖥️。

### Phase G2 — 流、管道与文本处理（真·shell 体验）
- [x] **G2.1 标准流 + 管道**：shell 支持 `\|` 串联、`<` 输入重定向、`2>` 错误重定向；命令模型改成 (stdin)→{stdout,stderr,code}。
  - ✅ 浏览器实测：`echo x|cat`、`cat<f`、`echo a>f;echo b>>f`(追加成 `line1line2`)、`cat<f|cat`、`cat miss 2>e`(错误写文件) 全通过；supervisor 子 Agent 审查 PASS。修了一个真 bug：裸 `>>` 被正则回溯拆成 `>` `>` 而误建名为 `>` 的文件（`splitRedirToks` 加 `REDIR_OPS.includes` 守卫）。
  - 已知小限制（非回归，留待后续）：粘在 token 末尾的算符 `echo hi>a.txt` 不识别（需空格或前缀式 `>a.txt`）；`;` 命令分隔未支持；echo 不带尾随换行（追加是裸拼接）。
- [x] **G2.2 文本处理 coreutils**：`grep`(含 -i/-n/-r) `find`(按名/递归) `wc` `head` `tail` `sort` `uniq` `cut`，配合管道。
  - ✅ 浏览器实测：`env|grep USER`、`env|wc -l`→4、`env|sort`、`grep -n`行号、`find / -name "*.txt"`递归+glob、`cut -d: -f2`、4 级管道 `env|sort|head -2|cut -d= -f1`、`grep -i` 全通过。supervisor 子 Agent 审查发现并修复 2 个真 bug：`head/tail -n 0` 被 `||def` 吞成 10 行（改 `Number.isNaN` 守卫）、`grep -r` 单匹配漏文件名前缀（递归恒带前缀）。npm check+build 0 错。

### Phase G3 — 配置与虚拟文件系统
- [x] **G3.1 环境变量 + 配置**：完善 `env/export/$VAR`；`/etc` 风格配置存储 + shell rc（开机/启动终端时执行）；命令解析的 `$PATH` 雏形。
  - ✅ 实现：默认 env 加 `PATH=/bin`；新命令 `unset`/`which`(按 PATH 解析,内置命令算命中)/`source`(`.` 别名,逐行执行+共享 ctx+递归深度守卫)；`ensureEtcProfile()` 出厂自带 `/etc/profile`(缺失则建,带模板)；终端 onMount 自动 `source /etc/profile`(try/catch 防护) → 用户改它即可持久化 export/启动命令。
  - ✅ 验证：`npm check`+`build` 0 错；supervisor 子 Agent 审查 **PASS**（确认 `.` 别名/`source→run` 无 TDZ、重复开终端不会建 `etc 2`、纯注释 rc 不输出、`which`/`unset`/PATH 边界 OK），并据其建议补了 source 递归守卫。**浏览器已补验**（下一轮 G3.2 时 preview 恢复）：`which ls cat bogus`→`/bin/ls`·`/bin/cat`、`/etc/profile` 出厂自动创建、`export FOO`+`$FOO`、`unset` 全通过。
- [x] **G3.2 `/proc` `/dev` `/etc` 虚拟挂载**：VFS 路径解析支持只读虚拟节点——`/proc/<pid>` 暴露进程信息为文件、`/dev` 暴露浏览器能力（clipboard/notify 等）、`/etc` 放配置。一个 overlay/mount 机制。
  - ✅ 实现：新模块 `system/vfsVirtual.ts`（只读、不持久化、按需现算）挂 `/proc`（version/uptime + 每进程 `<pid>/status`+`cmdline`）、`/dev`（null/clipboard/random）；shell 的 `toAbsPath` + `ls`/`cat` 虚拟感知（`ls /` 附带显示 proc//dev/）；grep 顺带补 `-v` 反选。`/etc` 已是 G3.1 的真实目录。
  - ✅ 浏览器实测：`ls /`见 proc//dev/、`ls /proc`列进程、`cat /proc/<pid>/status`实时进程信息、`cat /proc/version`、`cat /dev/clipboard`、`cat /proc/<pid>/status|grep State|wc -l`管道、`grep -v`、`cd /proc`优雅报错；supervisor 子 Agent 审查 PASS（确认 `..`/前缀误伤/三函数一致性/无循环 import 均 OK）。npm check+build 0 错、控制台 0 报错。
  - 已知限制（非回归）：不支持 `cd` 进虚拟目录（cwd 仍须真实节点）；虚拟文件作为直接参数喂 grep/wc 不支持（但 `cat 虚拟 | grep` 管道可用）。

### Phase G4 — 权限与用户
- [x] **G4.1 权限与所有权模型**：VNode 加 `mode`(rwx) + `owner`；`chmod`/`chown`/`stat` 命令；`ls -l` 显示权限/属主/mtime/大小；操作处 best-effort 校验。
  - ✅ 实现：VNode `mode?`/`owner?`（缺省 目录755/文件644、属主 `qiezi`，create* 设默认、`setMode`/`setOwner`）；shell `modeStr`/`permits`（owner 段 vs other 段，root 旁路，无 group）；`ls -l` 显示 `rwxr-xr-x 属主 大小 时间 名`；`chmod`(八进制)/`chown`/`stat`；best-effort 校验只加在 shell 的 `cat`(读)+重定向写(`writeToPath`)——**GUI/内核 writeFile 不受影响**。
  - ✅ 浏览器实测：`ls -l`→`-rw-r--r-- qiezi`、`chmod 000`→`cat` 权限不够、`stat`、`chmod 644`→`cat` 恢复、`chown bob`→属主变、chown 后 qiezi 作为 other 对 644 写被拒；supervisor 子 Agent 审查 PASS（确认默认属主与 USER 一致不锁死、GUI 路径无门禁、rm/mv 不受限符合 Unix 语义）。npm check+build 0 错、控制台 0 报错。
  - 已知简化（非回归）：无 group 段；rm/mv 不校验（删/移由父目录写位决定，留待后续）；chmod/chown 不限「仅属主/root」。
- [x] **G4.2 用户/账户模型**：当前用户 + 用户表 + `su`/`sudo` 隐喻 + `/etc/passwd` + `whoami`/`id`；与权限联动（默认单用户，可加用户）。
  - ✅ 实现：`system/users.svelte.ts`（持久用户表 root(0)+qiezi(1000)、getUser/addUser/passwdContent）；shell `id`/`users`/`su`(切身份,root 显 `#`)/`sudo`(提权跑单命令)/`useradd`(仅 root,uid≥1001)；`ensureEtcPasswd()` 把用户表渲染成真实 `/etc/passwd`（开终端/新增用户时同步）；prompt root 显 `#`。与 G4.1 permits 联动（su/sudo 改 USER → root 旁路、owner 段）。
  - ✅ 浏览器实测：`id`、`useradd carol` 非 root 拒、`sudo useradd bob/dave` 成功且 `/etc/passwd` 同步、`su root`→prompt `root@…#`、root 旁路读 `chmod 000` 文件、`echo x|sudo cat` stdin 透传、`sudo whoami`→root 跑完恢复 qiezi。supervisor 子 Agent 审查发现并修复真 bug：sudo 原用 `args.join(' ')` 重拼会二次分词/丢引号/丢 stdin → 改为直接派发已解析 argv；并把 uid floor 提到 1000 防复用。npm check+build 0 错、控制台 0 报错。

### Phase G5 — 进程与服务加深
- [ ] **G5.1 进程模型加深**：进程加 `ppid`/进程树、信号（TERM/KILL/STOP/CONT 映射到 close/suspend/restore）、退出码；`ps`/`pstree`/`kill -SIG`/`jobs` 命令 + 任务管理器展示进程树。
- [ ] **G5.2 可配置 init + 服务依赖**：服务 `after`/`requires` 排序、开机启用/禁用持久化、用户自定义服务；`systemctl` 风格命令 + 任务管理器 UI。

### Phase G6 — 网络、文档、生态
- [ ] **G6.1 网络工具**：`curl`/`fetch` 命令 + 网络能力（经 /aiproxy 或直连）+ `hostname`；用户 App 也能申请 net 能力。
- [ ] **G6.2 man/help 文档系统**：`man <cmd>` + 帮助注册表 + 简单文档查看。
- [ ] **G6.3 远程 App 仓库（apt-like）**：从远程 catalog URL 安装 App；`pkg`/`app install` 命令 + 仓库浏览 UI。

### Phase G7 — 后端（大工程，最后）
- [ ] **G7.1 后端账号 + 同步鉴权**：真登录/会话/多用户数据隔离，把现有 token 制 `/sync` 升级为有鉴权的账号同步。

---

## 三、自治开发心跳的执行协议（每次触发照此做）

仓库根：`D:\file\New Develop\QieZiOS`。每次心跳**只完成一项**，然后停。

1. 读本文件，按阶段顺序找**第一个** `[ ]`。若全部 `[x]` → 发系统通知「🎉 对标 Linux 开发全部完成」、用 `CronList` 找到本心跳任务并 `CronDelete` 删除、停止。
2. **开发**：派一个子 Agent（开发者）实现该项。务必遵循现有架构：kernel/system/shell/apps 四层；Svelte 5 runes；新代码走 `sys.*` 门面；加 App 要在 `appList.ts`+`registry.ts`+Dock 登记；注意 Windows 文件名大小写撞名、循环 import（registry 别 import desktopApps）。
3. **监督**：派另一个子 Agent（审查）跑 `npm run check` + `npm run build`，审查 diff 找 bug/回归/架构违背。不过关 → 打回开发 Agent 修（≤3 轮）。**若 3 轮仍不过关：撤销本项全部改动（`git checkout -- . && git clean -fd src`，勿动已提交内容），在该项下注明「⚠️ 受阻：<原因>」，跳到下一项——绝不提交跑不过 check/build 的代码。**
4. **验证**：本会话若 preview 工具可用就做 DOM/浏览器级验证；不行就在该项下注明「⏳ 待真机验证」。
5. **收尾**：`git add -A` → 中文规范 commit（末尾带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）→ `git push origin main`；把该项勾成 `[x]` + 写一句验证结论；同步更新 `CLAUDE.md` 文件表/路线图。

> 进度记录见各项后的「✅ …」注脚。
