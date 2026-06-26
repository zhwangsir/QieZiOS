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
- [x] **G5.1 进程模型加深**：进程加 `ppid`/进程树、信号（TERM/KILL/STOP/CONT 映射到 close/suspend/restore）、退出码；`ps`/`pstree`/`kill -SIG`/`jobs` 命令 + 任务管理器展示进程树。
  - ✅ 实现：Process 加 `ppid`（0=init，`launch` 接 opts.ppid，重启重置为 0）；`sys.openApp` 透传 ppid；Desktop 给 App 传 `pid` prop → 终端记下自身 pid，`open` 启动的子进程 ppid=终端 pid；shell `ps`(PID/PPID)、`pstree`(init 树+孤儿兜底)、`jobs`、`kill -9/-STOP/-CONT/-TERM`(STOP→挂起/CONT→恢复/其余→关闭)；SysMonitor 进程页 procTree($derived.by 按 ppid 排序+缩进)+PPID 列。
  - ✅ 浏览器实测：终端 `open calculator`→calc 的 ppid=终端 pid、`pstree` 显示 `terminal(3)└─calculator(9)`、`kill -STOP`→挂起/`-CONT`→恢复/`-9`→关闭、`jobs`、SysMonitor 显示 PPID+进程树列。supervisor 子 Agent 审查 PASS（确认全 App 透传 pid prop 无害、procTree 无环死循环风险、boot 重置正确），并据建议给 pstree 补了孤儿兜底（与 SysMonitor 一致）。npm check+build 0 错 0 警、控制台 0 报错。
  - 说明：「退出码」对 GUI 窗口进程无实际语义（关窗即 proc.exit 事件），shell 命令退出码（$?）已具备；本项聚焦 ppid/信号/树。
- [x] **G5.2 可配置 init + 服务依赖**：服务 `after`/`requires` 排序、开机启用/禁用持久化、用户自定义服务；`systemctl` 风格命令 + 任务管理器 UI。
  - ✅ 实现：ServiceDef 加 `after`/`requires`；`startServices` 按拓扑序启动（遇环忽略该边）、跳过被禁用/硬依赖未满足的；持久化禁用清单 `qz.svccfg` + `isEnabled`/`enableService`/`disableService`/`startService`/`listServices`；`schedd after:notifyd`（演示排序）；shell `systemctl list/status/start/stop/restart/enable/disable`；SysMonitor 服务区列全部服务（含禁用）+ 启用/禁用/启动/重启按钮 + 状态色。
  - ✅ 浏览器实测：`systemctl` 列出服务（schedd 显示 after:notifyd）、`systemctl disable clipd`→停+持久化、**reload 后 clipd 仍 disabled 不自启**、`enable`+`start` 恢复、SysMonitor 显示 init/systemctl 区+禁用按钮。supervisor 子 Agent 审查发现并修复真 bug：崩溃自愈计时器会「复活」被禁用的服务（在 300/800ms 自愈窗口内 disable）→ 给延迟重启加 `isEnabled` 守卫；并让 `systemctl start` 拒绝已禁用服务（保持单状态模型一致）。已专门验证竞态修复（crash+disable→不复活）。npm check+build 0 错 0 警、控制台 0 报错。
  - 说明：「用户自定义服务」（跑用户代码当守护进程）较重且有安全面，本项未做，留待后续（可走沙箱）。

### Phase G6 — 网络、文档、生态
- [x] **G6.1 网络工具（终端）**：`curl`/`fetch` 命令 + `hostname`；**把 shell 改成异步**（CmdFn 可返回 Promise、`run`/`source`/`sudo` async + await）以支撑 fetch。
  - ✅ 实现：`lib/shell.ts` 异步化（`run`→`Promise<CmdResult>`、按段 await）；`curl`(浏览器 fetch，-i 含状态行/-I 只看头/超长截断/CORS 失败优雅报错 code 7)、`fetch` 别名、`hostname`；Terminal `submit` 改 async + `busy` 锁（try/finally 保证解锁）+ ⏳ 指示 + 输入禁用。
  - ✅ 浏览器实测：同步命令/管道无回归（pwd、echo|cat）；`curl -I 同源`→HTTP 200+头、`curl 同源|grep doctype`、**`curl 经 /aiproxy|grep glm`→真模型列表**、`curl example.com`→CORS 优雅报错、curl 后终端不卡死。supervisor 子 Agent 审查发现并修复真回归：`run` 若 reject 会让 `busy` 永久 true 锁死终端 → submit 包 try/catch/finally。npm check+build 0 错 0 警、控制台 0 报错。
  - 说明：浏览器 curl 受同源/CORS 限制——对 CORS 友好端点 + 同源（含 /aiproxy）可用；任意外站需服务端代理（留作后续）。
- [x] **G6.1b 用户 App 网络能力**：appSdk 加 `net` 能力 + `qz.fetch(url)`（沙箱 iframe 经宿主 RPC 受能力门控发请求）。
  - ✅ 实现：GUEST_SDK 加 `qz.fetch(url,opts)`→`call('__fetch')`；CAPABILITIES 加 `net`（tools:['__fetch']）；handleGuestCall 分支 `guestFetch`（宿主端 fetch，只允许 http(s)、透传 method/headers/body、响应封顶 100KB）。能力门控复用既有 `allow.has` 闸——声明 net 才放行。
  - ✅ 浏览器实测（真沙箱 iframe + RPC）：caps:['net'] 的 App `qz.fetch(/aiproxy/v1/models)`→`{status:200,len:408}`；caps:[] 的 App→被拒「能力未授权：__fetch」。supervisor 子 Agent 审查 PASS（门控顺序正确、scheme 白名单挡 file:/data:、Headers API 无注入、SSRF 受 CORS+显式授权可接受、无回归）。npm check+build 0 错 0 警、控制台 0 报错。
- [x] **G6.2 man/help 文档系统**：`man <cmd>` + 帮助注册表 + 简单文档查看。
  - ✅ 实现：`lib/man.ts` 手册页注册表（45 条，覆盖 45/47 命令）；shell `man`（无参列表 / 未知页报错 / 正常页 NAME·SYNOPSIS·DESCRIPTION）；`help <命令>` 委托 man；help 文本加 man 提示。
  - ✅ 浏览器实测：`man grep`/`man ls` 显示手册页、`help kill` 委托 man、`man nope` 报错、`man` 列出全部。supervisor 子 Agent 审查 PASS（help 函数体重构闭合正确、`COMMANDS.man` 调用期安全、synopsis 与实现一致抽查通过、无回归；Terminal HMR 报错确认为 Vite 新增 import 边导致的全量重载回退，非代码 bug，整页重载后正常）。npm check+build 0 错 0 警。
- [x] **G6.3 远程 App 仓库（apt-like）**：从远程 catalog URL 安装 App；`pkg`/`app install` 命令 + 仓库浏览 UI。
  - ✅ 实现：`system/appRepo.svelte.ts`（持久化源 URL、`fetchCatalog` 校验+过滤坏条目、`installCatalogApp` 幂等去重、`isInstalled`）；shell `pkg list/search/install/repo`（async）；GUI「应用商店」`apps/AppStore.svelte`（📦，拉 catalog/列表/安装/源 URL，登记 appList+registry）；示例仓库 `public/apps.json`（同源 /apps.json，3 个内联 App）；man pkg。安装走 appShare.importUserAppFromText → 进「我的 App」，caps 一并带上、用户可见。
  - ✅ 浏览器实测：`/apps.json` 同源可取；`pkg repo/list/search/install` 均通、install hello 进 userApps；应用商店 GUI 列出 3 App、安装按钮点击即装且响应式变「重新安装」；连装 3 次 dice 去重后仅 1 个。supervisor 子 Agent 审查 PASS（去重不漏删、能力门无绕过路径——缺 caps 归一为 []=拒一切而非全给、无循环 import、三态 UI 正确），并据建议给 fetchCatalog 加坏条目过滤。npm check+build 0 错 0 警、控制台 0 报错（Terminal 的 HMR 报错为环境性全量重载回退，非代码 bug）。

### Phase G7 — 后端（大工程，最后）
> 作者指示「安全先不考虑、功能优先」（见记忆 prioritize-features-over-security）：本阶段做**功能闭环**，真鉴权硬化（盐+慢哈希、限流、token 过期、HTTPS）留作后续。
- [x] **G7.1 后端账号 + 账号制同步**：真登录/会话/多用户数据隔离，把现有 token 制 `/sync` 升级为有账号的同步。
  - ✅ 实现：`server/index.mjs` 加账号体系——`/auth/register`·`/auth/login`（sha256 无盐、随机 token 当会话、存 accounts-store.json）+ 账号制 `/sync`（Bearer 鉴权、按用户隔离存取），旧 `/sync/<token>` 保留兼容。`system/account.svelte.ts`（持久会话 + register/login/logout）；`system/sync.ts` 改账号制（Bearer + EXCLUDE 加 qz.account）；`vite.config` dev 代理 `/auth`·`/sync`→本地后端；Settings 账号 UI（登录/注册/已登录态/上传/恢复/退出）。
  - ✅ 服务端 curl 实测：register/login/dup 409/wrong-pw 401/账号 sync PUT+GET/无 token 401/坏 token 401/bob 取不到 alice 数据（隔离）。✅ 浏览器全链路实测（dev 经 vite 代理→本地 node）：注册→账号制 push 15 项→改本地→pull 恢复（accent 复原）；Settings 显示已登录态 + 上传/退出。supervisor 子 Agent 审查 PASS（功能/逻辑/回归无问题；安全硬化按作者指示不计）。npm check+build 0 错 0 警。
  - ⚠️ **安全待硬化**：密码无盐 sha256、明文存文件、token 不过期、无限流/HTTPS——对外发布/多租户前需回补。

### Phase H — Shell 自动化（功能深度加强 · 作者选）
> 把终端从「一次一条命令」升级成真·自动化环境。安全暂不重要（见记忆 prioritize-features-over-security）。
- [x] **H1 命令序列 + 逻辑连接**：`;`（顺序）、`&&`（前者成功才跑）、`||`（前者失败才跑）；与既有管道 `|` 正确分层。脚本与一行多命令的地基。
  - ✅ 实现：原 `run`(管道+重定向执行器)→改名内部 `runPipeline`；新增 `splitConnectors`(按顶层 `;`/`&&`/`||` 切、尊重引号、单 `|` 留段内)；新 `run` 顺序执行+短路(lastCode 只在执行段更新→左结合同 bash)；每段后 `cd` 立即落 ctx.cwd（`cd d && pwd` 生效）。
  - ✅ 浏览器实测：`echo a;echo b`、`echo ok&&echo second`、`cat nope&&echo SKIP`(跳)、`cat nope||echo recovered`(跑)、`mkdir d&&cd d&&pwd`→/d+prompt 更新、`ls|grep txt;echo DONE`(管道与;共存)、`cat nope&&echo A;echo B`(A跳B跑) 全对。supervisor 子 Agent 审查 PASS（runPipeline 体字节级一致无漂移、短路左结合正确、无悬挂调用、无回归）。npm check+build 0 错 0 警。
- [x] **H2 别名 + 持久历史**：`alias ll='ls -l'`/`alias`/`unalias`（持久化、启动展开）；命令历史持久化（↑/↓ 跨终端/刷新）。
  - ✅ 实现：新模块 `system/shellPrefs.svelte.ts`（持久 `aliases`{map} + `cmdHistory`{list,封顶200,去连续重复}）；shell runPipeline 首词别名单次非递归展开（tokenize+subst）+ `alias`/`unalias` 命令；Terminal 历史改用持久共享 cmdHistory（↑/↓ 读它）。
  - ✅ 浏览器实测：`alias ll='ls -l'`→`ll permok.txt` 展开、`alias` 列出、`ls | g txt`(别名在管道里展开)、`unalias ll`→未找到；刷新后新终端 ↑/↓ 回放上轮历史、别名 `g→grep` 跨刷新仍生效。supervisor 子 Agent 审查 PASS（单次展开不死循环、解析/历史边界正确、无循环 import、无回归）。npm check+build 0 错 0 警。
- [x] **H3 脚本控制流 + 执行脚本**：`if/then/elif/else/fi`、`for x in … do … done`、`while`、`test`/`[ ]`；`sh <file>` / `./file.sh` 执行脚本文件（带 `#!` 忽略）。
  - ✅ 实现：迷你脚本解释器——`splitStatements`(按 ;/换行切句、尊重引号、跳 # 注释) + `parseStatements`(递归下降→AST，`reinjectInline` 让 `do if`/`then for` 内联嵌套也能递归解析) + `expandWords`(for 词表 subst+glob) + 新 `run`(执行 AST，叶子走 `runLine`，原 H1 run 改名)；`evalTest`(-f/-d/-e、-z/-n、=/!=、-eq…-ge、! 取反) + `test`/`[`；`source` 改整文件执行、新增 `sh`、`./file`(路径指向文本文件即执行)；while/for 加 MAX_LOOP=5000 + 输出封顶 100000 字符 + 每 256 次让出主线程（防失控冻 UI）。man + help 同步。
  - ✅ 浏览器实测：if/else、for(含 $i + glob)、while(条件变假停)、`[ 3 -gt 2 ]`、**嵌套 for+if→first/other**、`sh loop.sh` 跑文件里的 for→tick×3、`./r.sh`、`./r.sh | wc -l`(脚本进管道)、语法错误→code 2。supervisor 子 Agent 用独立复刻验了 30+ 解析边界 + 运行时，PASS（唯一发现：失控 while 原会跑满 10w 次卡 UI → 已按建议降上限+封顶输出+让出主线程）。npm check+build 0 错 0 警。
- [x] **H4 后台作业（job control）**：`cmd &` 后台、`jobs`、`fg`/`bg`、`wait`（在异步 shell 模型里尽力而为）。
  - ✅ 实现：新 `system/jobs.svelte.ts`(运行时作业表 `jobs=$state` + addJob/finishJob，封顶 30)；`lib/shell.ts` 加 `backgroundRun`(用 ctx 副本 bgCtx 不 await 地跑 `run`、登记 bgPromises、完成发 sys.notify) + `run` 入口检测末尾单 `&`(非 `&&`)→后台；命令 `jobs`(列作业+Running/Done/Failed)/`fg [n]`(await 对应 promise 显示输出)/`bg`(提示)/`wait`(await 所有 running)。原 `jobs`(列窗口进程)被真后台作业替代。help/man 同步。
  - ✅ 浏览器实测：`echo x > f &`→`[1]` 立刻返回、`cat f` 证明后台真跑、`jobs`→Done、`fg`→显示输出、`wait` 返回；`curl 慢接口 &` 时 `jobs`→**Running** 且前台 `echo` 仍立刻执行（真并发不阻塞）。supervisor 子 Agent PASS（`&` 检测各边界/无限递归/ctx 隔离/分层无环全过；仅两条 cosmetic 非阻塞观察）。npm check+build 0 错 0 警。
- [x] **H5 从终端定时**：`at <延迟> <命令>` / `crontab`（走 `sys.schedule`，到点经总线跑命令/发通知）。
  - ✅ 实现：复用已有 schedd 服务——`Schedule` 加 `command?`；`schedules.svelte.ts` 加注入式 `setScheduleRunner`/`runScheduled`（避免 system 反向 import lib/shell 成环）；schedd `fire` 有 command 时跑 `runScheduled` 并用通知回报结果尾行（否则原 notify）；`sys.schedule.add` 透传 command；App 接一个独立常驻 `cronShellCtx` 跑命令（与 AI 的 ctx 分离）。shell 命令 `at +<N>[s|m|h] <命令>`(一次性/-l 列出/-r 取消) + `atq`(=at -l) + `crontab <间隔> <命令>`(循环/-l/-r)；at/crontab 各只列删自己那类（!every vs every），不误删提醒。man+help 同步。
  - ✅ 浏览器实测：`at +2s mkdir atdir`→排程→`at -l` 列出→2s 后 atdir 真被建出（命令经 shell 跑了）→触发后一次性自删；`crontab 1s touch cronfile`→cronfile 真被建→`crontab -r <id>` 后任务表清空、interval 解除。supervisor 子 Agent PASS（分层无环、一次性删除/循环不堆叠/注入未就绪不崩/-r 跨类型不误删/重新武装不泄漏/Reminders 无回归全过；仅两条 cosmetic 非阻塞观察，无需改）。npm check+build 0 错 0 警。

> 🎉 **Phase H（Shell 自动化）全部完成**（H1–H5 全 ✅）。至此 G1–G7 + 融合三件套 + Phase H 整个 DEVPLAN backlog 清空。

---

## 三、自治开发心跳的执行协议（每次触发照此做）

仓库根：`D:\file\New Develop\QieZiOS`。每次心跳**只完成一项**，然后停。

1. 读本文件，按阶段顺序找**第一个** `[ ]`（当前在 Phase H）。若全部 `[x]` → 发系统通知「🎉 当前开发计划全部完成」、用 `CronList` 找到本心跳任务并 `CronDelete` 删除、停止。
2. **开发**：派一个子 Agent（开发者）实现该项。务必遵循现有架构：kernel/system/shell/apps 四层；Svelte 5 runes；新代码走 `sys.*` 门面；加 App 要在 `appList.ts`+`registry.ts`+Dock 登记；注意 Windows 文件名大小写撞名、循环 import（registry 别 import desktopApps）。
3. **监督**：派另一个子 Agent（审查）跑 `npm run check` + `npm run build`，审查 diff 找 bug/回归/架构违背。不过关 → 打回开发 Agent 修（≤3 轮）。**若 3 轮仍不过关：撤销本项全部改动（`git checkout -- . && git clean -fd src`，勿动已提交内容），在该项下注明「⚠️ 受阻：<原因>」，跳到下一项——绝不提交跑不过 check/build 的代码。**
4. **验证**：本会话若 preview 工具可用就做 DOM/浏览器级验证；不行就在该项下注明「⏳ 待真机验证」。
5. **收尾**：`git add -A` → 中文规范 commit（末尾带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）→ `git push origin main`；把该项勾成 `[x]` + 写一句验证结论；同步更新 `CLAUDE.md` 文件表/路线图。

> 进度记录见各项后的「✅ …」注脚。
