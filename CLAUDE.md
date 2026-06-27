# QieZiOS 🍆 — 项目承接文档

> 这份文档同时是**给新 Claude Code 会话的承接说明**（放在项目根目录会被自动加载）和**给作者本人的项目备忘**。新会话请先读完本文件再动手。

---

## 一、这是什么

**QieZiOS** 是一个 **Web OS / 网页桌面**——一整套跑在浏览器里的个人计算环境（桌面壁纸、可拖拽窗口、多 App、文件系统…），**整体本身就是一个 Web 应用**。目标：一个**高度可自定义、可自托管（Docker 镜像）+ 网页直接打开**的个人系统。

参照物：Puter、daedalOS、ChromeOS 这一类。

> ⚠️ 它**不是**真·操作系统：不碰硬件、没有内核态、没有驱动。这里的"系统/内核"是**软件层的隐喻**（微内核思想搬到 Web）。作者曾考虑"从零写 Rust 内核"，但因为真正目标是"**一款能用的、我自己的系统**"，最终选了 Web OS 这条路。Rust 写内核保留为以后纯学习的副本支线，不是本项目。

---

## 二、位置与 Git

- **本地**：`D:\file\New Develop\QieZiOS`
- **远程**：`https://github.com/zhwangsir/QieZiOS.git`（已设为 `origin`）
- **状态**：已 **push 到 `origin/main`（同步）**。包含 Phase A `3aba79d`、Phase B、Phase C VFS `06847ec`、打磨①②③④、回收站 `8cd017e`、Spotlight、文件拖拽移动、主题编辑器、**Phase D AI 助手 MVP → 双协议(Anthropic + OpenAI 兼容/minimax) + AI 织进各 App**。**作者已给全部授权 → 可自由 commit + push，不再每次问**。
- **AI 当前默认走本地 LM Studio**（局域网，OpenAI 兼容，`.env.local` 的 `VITE_AI_PROXY_TARGET` 指向它），模型 `zai-org/glm-4.6v-flash`（推理+视觉 flash 模型；本地服务**无需 key**）。设置→AI 有「本地 · GLM-4.6V」一键预设。**备用**：作者自建 minimax 网关 `https://dgmt.top/lm/v1`(`minimax/minimax-m2.7`，Bearer 在 `.env.local` 注释里，切回即取消注释+重启 dev)。两者都经 `/aiproxy` 同源代理转发(绕过 CORS)：**dev** 走 Vite 代理、**生产**走 `server/index.mjs`。换端点只改 `.env.local`(dev) 或 `AI_PROXY_TARGET`(prod)。⚠️ flash 模型在 Assistant 的工具 agent loop 里偏爱反复调同一工具、易撞 8 轮上限——普通对话/各 App 内嵌 AI 流畅，复杂"驱动系统"任务换大模型更稳。**key 守卫已改 provider 感知**：仅 Anthropic 强制要 key，OpenAI 兼容端点可留空(本地/无鉴权)。
- **与博客的关系**：完全独立于 `D:\file\New Develop\QieZiBlog`（一个已完成的 React 博客 WineryBlog）。**不要**把博客仓库改造成 OS。博客**以后作为系统里的一个 App 嵌入**——先用 `iframe`（零重写，React 博客跑在 Svelte 系统里完全没问题，这正是"平台兼容异构 App"的体现）。

---

## 三、技术栈（已拍板，经 2026 前沿调研，勿轻易推翻）

| 层 | 选型 | 备注 |
|---|---|---|
| **UI 核心** | **Svelte 5（runes/信号）** | 为性能+丝滑而选，**不用 React**。作者是 React/Java 背景，Svelte 是新学的 |
| 样式 | **Tailwind v4**（`@tailwindcss/vite`） | 后续加无头基元(Bits/Melt UI)+"拥有式"组件(shadcn 思路)+设计 tokens |
| 动画/丝滑 | 只动 transform/opacity/filter（合成器/GPU）+ Motion + View Transitions | 重活丢 Web Worker，目标 60/120fps |
| 模块化(P2+) | Module Federation 2.0 (Rspack) + 契约式 App SDK | 消息 RPC + 能力(capability)申请 |
| 性能 | 信号 + 窗口虚拟化 + CSS containment + OPFS+SQLite-WASM | |
| 后端(P3) | 作者的 **Java/Node**（存储/账号/同步） | 可选 本地优先 + CRDT(Yjs) |
| 工具 | Vite v8 · Node 22 · npm 10 · Windows 11 | |

**优化优先级（作者明确）**：最美观 + 高自由度/模块可自定义 + 性能最强 + 体验最丝滑。（安全隔离、最快落地 优先级靠后。）
**"更优秀"的标尺** = 更清晰/更可控/更现代/更是作者的，**不是**"全面打赢 Linux/Puter/daedalOS"（那是几十年+团队堆出来的，结构性追不上）。

---

## 四、架构（核心心智模型，务必理解）

**小内核 + 万物皆 App（微内核思想）**，按职责分四层：

| 层 | 目录 | 职责 |
|---|---|---|
| 内核 kernel | `src/kernel/` | 唯一真相源（信号驱动）：进程表 + 窗口生命周期 + 持久化 helper |
| 系统服务 system | `src/system/` | 数据驱动、运行时可切：主题 token / 用户设置 / 壁纸 |
| 外壳 shell | `src/shell/` | 可见的 OS chrome（全部吃 token）：Desktop / Dock / Window |
| App 平台 apps | `src/apps/` | 万物皆 App：注册表 + App 组件 |

渲染 / 换肤链路：

```
processes(内核 $state) ──遍历──► Desktop ──按 appId 查──► registry ──塞进──► Window ──► App(组件)
                                   Dock  ──遍历 registry──► 启动/还原按钮 + 在跑指示点
settings(system) ──$effect──► 写 CSS token 到 :root ──► 整屏换肤（0 组件重渲染）
```

一句话：**进程 = state 里的一个对象；窗口 = 把进程渲染成可拖容器；App = 一个组件；加新 App = 注册表登记一条；换肤 = 改 CSS 变量。**

---

## 五、当前进度：✅ Phase A + B 完成 · C 起步 =「会自定义、记得住布局、有文件系统的丝滑桌面」

src 已全部重写。能力：开/拖/缩放/关窗口、最小化（Dock 或顶栏找回）、最大化/还原（双击标题栏也行）、多窗叠放、点击置顶；**边缘吸附**（拖到左/右/上边缘 → 半屏/最大化，带预览框）；**开关窗 + 最小化动画**（缩放淡入淡出）；**键盘快捷键**（Esc 关窗 / Ctrl·Cmd+M 最小化 / Alt+\` 轮换窗口）+ **活动窗焦点高亮**（主色边框）；**顶栏任务栏**（每窗一个切换 chip + 实时时钟）；**设置 App 实时改 主色/明暗/圆角/模糊/透明度/界面缩放/壁纸，并能保存命名主题预设(应用/删除) + JSON 导入导出**；**虚拟文件系统 + 文件管理器 + 记事本**（新建/重命名/删除/**拖拽移动**/进文件夹/双击文本文件编辑，内容自动存）；**右键菜单**（桌面/窗口标题栏/文件项/Dock 各有菜单）；**桌面图标**（VFS 根目录的项，双击打开、拖动排列、位置持久化）；**计算器 + 模拟时钟 App**；**回收站**（删除=软删除，可还原/彻底删除/清空）；**Spotlight 命令面板**（Ctrl·Cmd+K 搜索启动 App + 打开文件）；Dock 悬停放大、细滚动条、文件类型图标、景深 vignette 等视觉打磨；**AI 助手**（设置里填 Anthropic key 后，用自然语言驱动系统：启动 App / 增删改文件 / 换肤——工具调用真执行）；**整套设置 + 窗口布局 + 文件 + 图标位置都持久化，刷新后原样还原**。换肤只改 CSS 变量 → 0 组件重渲染。

### 文件（`src/`）
| 文件 | 作用 |
|---|---|
| `kernel/processes.svelte.ts` | 内核进程表（`persisted` → 会话还原）+ `launch/close/focus/minimize/restore/toggleMaximize/setBounds/activeId/cycleWindows`；进程含 **`pid`**(每次开机重排)+**`ppid`**(父进程,0=init,重启重置;`launch` 接 opts.ppid)+**`startedAt`**+`data` 启动参数；生命周期 `emit` 到事件总线（`proc.launch/exit/minimize/restore`）|
| `kernel/bus.svelte.ts` | **内核事件总线 · IPC 地基**（叶子模块,不 import 内部 → 不成环）：`emit(event,payload)` / `on(event\|'*',handler)→取消函数` + `eventLog` 环形缓冲(给事件检查器)。内核在真实点 emit，日志/检查器都是订阅者 → 系统事件驱动、可旁观 |
| `kernel/log.svelte.ts` | **内核日志**(dmesg)：`klog`(响应式、不持久化、封顶 500) + `logSys`。**是事件总线的订阅者**：`on('*')` 把已知事件 `fmt()` 成日志行 → 日志=事件流的一个视图（未知/`app:*` 事件也兜底落日志）|
| `kernel/services.svelte.ts` | **服务层 + 监督 + 可配置 init**：常驻后台守护进程。`registerService`/`startServices`/`startService`/`stopService`/`restartService`/`crashService`/`listServices` + `services` 运行表(含 `restarts`/`status`)。监督：`start()` 抛错自动退避重试(≤5)、运行时崩溃 `crashService` 自愈(延迟重启带 `isEnabled` 守卫防复活禁用服务)。**init**：ServiceDef 可声明 `after`(排序)/`requires`(硬依赖)，`startServices` 拓扑序启动；`enableService`/`disableService` + 持久化禁用清单 `qz.svccfg`(systemctl enable/disable)。dev 挂 `window.__qzSvc` |
| `system/sys.ts` | **系统调用门面**(syscall 表)：`sys.proc/fs/ui/clipboard/schedule/bus/log` + `sys.notify` + **`sys.openApp(appId,{title?,data?})`**(查 appMeta 开 App,收口 launch 样板)。**`aiTools.executeTool` + 所有内置 App/外壳的 App 启动**都已走 sys（Welcome/Assistant/AppGallery/Files/Spotlight/Desktop/DesktopIcons）。import 它即拉起「总线→日志」桥。dev 挂 `window.__qzSys` |
| `system/notifications.svelte.ts` / `system/services.ts` | 通知队列(`pushNote`/`dismissNote`,自动消失;Note 可带 `action:{label,run}` 如「撤销」按钮,只对活动 toast、进历史剥掉) + **持久化通知历史 `noteHistory`**(封顶 40 + `lastSeen` 未读基线;`unreadCount`/`markNotesSeen`/`clearHistory`;`nid` 从历史最大 id 之上起步防刷新后 id 撞历史→keyed each 重复 key 崩)，供顶栏通知中心回看 / 系统服务注册处：**通知中心 `notifyd`**(订阅 `notify`+`app.denied`→toast)、**剪贴板 `clipd`**(订阅 `clip.copy`→历史)、**音效 `soundd`**(E6：订阅 proc.launch/exit·fs.trash·app.denied·notify → `playSound`，默认静音)、**定时器 `schedd`**(给每个日程武装计时器,到点发 `notify`;开机重新武装[`arm(s,boot)`]:**A3 过期一次性命令型只移除+「跳过已过期命令」通知、绝不重跑 shell**——避免刷新/隔天打开误跑 rm 等;提醒型仍补发;迭代副本防同步 removeSchedule 漏项;订阅 `sched.add`[boot=false]/`sched.cancel`) |
| `system/schedules.svelte.ts` / `apps/Reminders.svelte` | 定时任务表(`persisted`,一次性 `fireAt`/循环 `every`,可选 `command`) / 提醒 App(Dock ⏰,加/列/取消,实时倒计时;**三种模式:多久后/指定时间(datetime-local→fireAt)/循环,单位 秒分时天**)。`sys.schedule.add/cancel/list`。**终端定时(at/crontab)**：Schedule 带 `command` 时 schedd 到点经注入式 `runScheduled`(setScheduleRunner,App 接 `cronShellCtx`)跑 shell 命令、用通知回报；无 command 则只发通知(提醒)。注入避免 system 反向 import lib/shell |
| `system/sound.ts` | **系统音效 · WebAudio 合成**（E6，无音频文件）：`soundPrefs` 持久(`qz.sound`:{enabled,volume}，默认关)；惰性 AudioContext；`SOUNDS`(open/close/notify/error/trash 音符串) + `playSound(kind)`(首行 enabled 门控零开销、振荡器+增益包络、整体 try/catch)。由 `soundd` 服务订阅总线事件触发 → 事件驱动、不碰内核。Settings「🔊 声音」开关+音量 |
| `system/clipboard.svelte.ts` / `apps/Clipboard.svelte` | 系统剪贴板(带历史 `pushClip`/`currentClip`,best-effort 写浏览器真剪贴板) / 剪贴板管理器 App(Dock 📋,历史列表,点击重新复制,清空)。`sys.clipboard.copy/read/history`；Files 右键「复制名称」喂它 |
| `shell/Notifications.svelte` | 系统 toast 层(右上角,fly 进 fade 出,点击关闭,左侧竖线标等级)；挂在 Desktop |
| `shell/DesktopPet.svelte` / `system/pet.svelte.ts` | **Live2D 桌面浮层桌宠**：浮窗口之上(z-9500)、可拖、可关；复用 `createPet`。`pet`(persisted: enabled/x/y)。开关：桌面右键或「伙伴」App 📌钉到桌面。**接 AI 成助手的脸**：💬 气泡聊天 → `complete()` 流式回复 → **流式时口型动**(`setMouth` 改 ParamMouthOpenY,best-effort) + **回复完 `react()` 动作 + `expression()` 表情**（`createPet` 暴露 react/expression/setMouth,均防御式 try/catch）。实测挂载/💬/发送/错误回落/口型计时器起停全通(视觉+动作+表情真浏览器看) |
| `kernel/persist.svelte.ts` | `persisted()` 自动存盘 helper（`$state`+`$effect.root`+`$state.snapshot`+**防抖**+数组支持 + 可选 `serialize(snapshot)` 存盘前变换：剥掉不该持久化的大字段，如 chat 的图片字节）+ storage 抽象接口。**性能**：snapshot 留在 effect 体内维持订阅，但 serialize+JSON.stringify 推迟进防抖回调 → 高频变更（逐字输入）每键只轻量 snapshot、停手才序列化一次，免大文件每键全量序列化卡顿。**`persistedAsync()`**（IndexedDB 后端，破 localStorage 配额）：异步 hydrate（先以默认值启动、登记 hydrator）+ `hydrated` 守卫（hydrate 前绝不写盘，防默认值覆盖真数据）+ `replaceInPlace`（就地替换 $state 保引用→既有订阅继续有效）+ localStorage→IDB 一次性迁移；导出 `ASYNC_KEYS`（哪些键在 IDB，给 sync/统计路由）+ `hydrateAll()`（`main.ts` 挂载 UI 前 await，首屏不闪默认值）。VFS/chat 用它。**`flushPersisted()`**（D2）：每个 store 注册 flusher（取消防抖、立即落地挂起写），云同步 `pushSync` 前 await 它 → 改完立刻上传不漏最新改动 |
| `kernel/vfs.svelte.ts` | 虚拟文件系统：inode 风格扁平节点表（parentId 串树）+ `persisted` 持久化 + CRUD（children/createDir/createFile/`rename`(返 boolean;同目录重名→拒绝不改,显式改名故拒绝而非像 move 那样自动 +2)/`move`(防环 + 目标同名自动 uniqueName 去重,免同名并存路径不可达)/**`copyNode`(递归深拷贝,二进制复制独立 blob)**/pathSegments…）+ 回收站（`trash`/`restoreFromTrash`/`purge`/`emptyTrash`，`parentId='trash'` 哨兵）+ **二进制文件**（`createBinaryFile`/`readBlob`/`isImage`：节点存元数据 kind/blobId/mime/size，字节存 blobStore；purge 顺手删 blob）+ **路径串解析**（`resolvePath(cwd,path)` 绝对/相对/`.`/`..`、`pathOf(id)`→`/a/b`；给 Shell/终端用）+ **防环守卫**（D4：`isInside`/`pathSegments` 跟 parentId 的 while + `purge` 的 children 递归各加 visited 集 → 损坏/外部 sync 数据造成父环 A↔B 时不挂死/不栈溢出，正常无环字节级等价）+ **权限/所有权**（VNode `mode?`/`owner?`，缺省 目录755/文件644+属主 qiezi；`setMode`/`setOwner`/`defaultMode`；仅 shell 的 cat/重定向 best-effort 校验，内核 writeFile 不设门禁） |
| `kernel/blobStore.ts` | **二进制大对象存储 · IndexedDB**（localStorage 装不下图片/模型）：`putBlob`/`getBlob`/`deleteBlob`，按 blobId 索引（库 `qz-blobs`）。⚠️ IDB 事务要在拿到 store 的同一任务里发请求（`await db()` 后同步建事务） |
| `kernel/idbStore.ts` | **字符串键值存储 · IndexedDB**（库 `qz-kv`，与二进制库分开）：`idbGet/idbSet/idbRemove/idbKeys/idbEntries`，全 try/catch best-effort 降级。给 `persistedAsync` 当后端 → 大块状态（VFS 树+所有文本）破掉 localStorage ~5–10MB 配额天花板。同 blobStore 的「同任务建事务」纪律 |
| `system/theme.svelte.ts` | 把设置算成 CSS token，`applyTokens()` 写进 `:root` |
| `system/settings.svelte.ts` | 用户设置（持久化）+ 主色预设 |
| `system/wallpaper.ts` / `system/wallpaperBlob.svelte.ts` | 壁纸内置预设（CSS 渐变） / **自定义壁纸解析层**：`settings.customWallpaper`（纯色/图片/null）；image 时把 blobId 异步解析成 objectURL($state)、换图/清除 revoke 旧的；`theme` 的 `--qz-wallpaper` 经 `wallpaperCss()` 优先用自定义（图片 `center/cover` 铺满，未加载好回退预设）。Settings 壁纸区可上传图片(blobStore)/选纯色/恢复预设 |
| `system/ai.ts` | AI 引擎 **双协议**：`provider` 分 anthropic(SDK 懒加载,浏览器直连) / openai(纯 fetch + SSE,兼容 minimax/本地 LM Studio 等)。`runAgent`(带工具 agent loop,驱动系统) + `complete`(单轮补全,给各 App 内嵌 AI 用)。处理推理模型的 `reasoning_content`、可中断(AbortSignal)。**多模态**：`ChatTurn.images`(data URL)→ OpenAI 拼 `image_url` 分块 / Anthropic 拼 base64 image 块,喂视觉模型。**防打转护栏**(`runOpenAIAgent`)：同名同参工具调用计数,>2 次不再执行+回灌提示,整轮全重复→下轮摘掉 tools 逼收尾,最后一轮也不给 tools。**流式安全剥离控制标记**(`<\|...\|>`,如 GLM 的 box token,含跨分片)。dev 挂 `window.__qzAi` |
| `system/assistantChat.svelte.ts` | 助手对话(`persistedAsync` → 存 IndexedDB，关窗/刷新不丢)，含 `reasoning`(思考过程)。**附图随对话持久化**（P2：P1 把存储迁 IDB 破 localStorage 配额后，不再需要 A1 的剥图——附图缩放后 ~4KB/张随 msgs 存 IDB、刷新原样还原）；`imageCount` 保留兼容旧 localStorage 剥图数据（迁移后仍显「N 张附图」占位） |
| `lib/markdown.ts` | 极简安全 Markdown→HTML(先转义再套标签，AI 回复渲染用) |
| `lib/image.ts` | 图片工具：`fileToDataURL` / `downscaleImage`(canvas 缩到最长边 ≤1024、压 JPEG、白底) / `imageFileToThumb`。给视觉模型省 token、存 localStorage 省空间(一张图常 ~4KB) |
| `system/users.svelte.ts` | **用户/账户模型**(对标 /etc/passwd)：持久用户表(默认 root:0 + qiezi:1000) + `getUser`/`userExists`/`addUser`(uid≥1001) + `passwdContent()`(渲染 /etc/passwd)。shell 的 `su`/`sudo`/`useradd`/`id`/`users` + `permits` 用它；终端 `ensureEtcPasswd` 把它同步成真实 `/etc/passwd` |
| `system/vfsVirtual.ts` | **只读虚拟文件系统**(对标 Linux /proc /dev · 不持久化、按需现算)：`/proc`(version/uptime + 每进程 `<pid>/status`·`cmdline`,读 `sys.proc.list()`)、`/dev`(null/clipboard/random)。`isVirtualPath`/`virtualList`/`virtualRead`/`virtualStat`/`normAbs`。shell 的 `ls`/`cat` 解析到这些前缀时改走这里 |
| `lib/shell.ts` | **Shell 引擎**(对标 Linux · 终端用 · **异步**：CmdFn 可返回 Promise、`run`/`source`/`sudo` async+await，支撑 curl)：分词(尊重引号) + `$VAR` 替换 + **脚本控制流**(`if`/`for`/`while`/`test`/`[ ]`/`sh`/`./file`,迷你 AST 解释器) + **命令序列 `;`/`&&`/`||`(短路)** + **管道 `\|` + 重定向 `< > >> 2>`**(三层：`run`=脚本解释器、`runLine`=连接符编排、`runPipeline`=管道执行)(命令模型 `(args,ctx,stdin)→{out,err,code,cd,clear}`，`run` 按 `\|` 切段串流、每段抽重定向)。coreutils：pwd ls(-l 显权限/属主) cd cat(无参透传 stdin) echo mkdir touch rm(软删) mv cp chmod/chown/stat open(启动 App/开文件,子进程挂终端名下) apps ps(PID/PPID) pstree kill(-9/-STOP/-CONT/-TERM) 后台作业(末尾 `&`→jobs/fg/bg/wait) 终端定时(at/atq/crontab→sys.schedule 跑命令) systemctl(list/status/start/stop/enable/disable) pkg(list/search/install/repo 远程仓库) curl(-i/-I)/fetch/hostname(网络,CORS 受限) ai(命令行问 AI,可管道) theme env export unset which source clear help man(手册页)。路径走 `vfs.resolvePath/pathOf`、进程/启动走 `sys.*`。文本处理 grep(-inr)/find(-name glob/-type)/wc/head/tail/sort/uniq/cut（读 stdin 或文件、配合管道）。环境/配置 env/export/unset/which/source(`.`别名,带递归守卫)+`$PATH`；`ensureEtcProfile()` 出厂自带 `/etc/profile`，终端 onMount 自动 source 它(改它=持久化 export/启动命令)。下一步 G3.2 见 [[DEVPLAN-LINUX]] |
| `system/permissions.ts` | **权限判定纯函数**（终端 + GUI 共用，避免两边走偏）：`nodeMode`/`modeStr`(rwxr-xr-x)/`permits`(node,user,bit：root 旁路、属主段 vs other 段)/`accessStr`(当前用户的 rwx)。shell 的 cat/重定向/ls -l/stat 与 Files/TextEdit 都用它 |
| `system/shellPrefs.svelte.ts` | **Shell 偏好**(持久)：`aliases`(别名 map) + `cmdHistory`(命令历史,封顶 200,去连续重复) + `setAlias`/`removeAlias`/`addHistory`。终端与 AI 的 shell 会话共用 → 别名/历史跨终端·跨刷新；shell 首词展开别名、Terminal ↑/↓ 读它。**+ E5 终端外观** `TERM_SCHEMES`/`termPrefs`(持久 `qz.term`:{scheme,fontSize})/`termScheme()` —— 6 套配色(含跟随系统 var)+字号，多终端共享 |
| `system/jobs.svelte.ts` | **Shell 后台作业表**(运行时态,不持久化)：`jobs=$state({list})` + `addJob`(封顶 30)/`finishJob`。shell 末尾单 `&` → `backgroundRun` 用 ctx 副本不 await 地跑 `run`、登记进 `bgPromises`、完成发 `sys.notify`；命令 `jobs`/`fg [n]`(await 对应 promise)/`bg`/`wait`(await 所有 running) |
| `lib/man.ts` | **手册页注册表**(对标 Linux man)：`MAN` 命令名→{title,syn,desc}(45 条)。shell 的 `man <命令>` 读它；`help <命令>` 也委托过来 |
| `apps/Terminal.svelte` | **终端 App**(🖥️)：滚动输出 + 命令行 + 历史(↑/↓) + Tab 补全(命令/路径) + Ctrl+L 清屏。接 `lib/shell`，prompt 显示 `user@host:/path$`。**E5 外观自定义**：齿轮弹层选配色(default/nord/dracula/solarized/light/跟随系统)+字号(10–20)，走 `shellPrefs.termPrefs`(持久 `qz.term`、多终端共享)；`sc=$derived(termScheme())` 驱动 inline style，system 方案用 CSS var 跟随换肤 |
| `system/aiTools.ts` | 能力工具：`TOOL_DEFS` + `executeTool`（launch_app/list_apps/VFS CRUD/set_theme/**run_shell**）。`run_shell` 经 `setShellRunner` 注入的运行器跑 shell 命令（注入避免 aiTools→shell 成环；AI 用常驻 ctx）→ AI 继承全部 coreutils。**已迁到走 `sys.*` 门面**（不再直连内核）→ AI/沙箱驱动系统全经 syscall 表，门面真正承重。dev 期挂 `window.__qzExec` |
| `system/aiConfig.svelte.ts` | AI 配置（持久化）：provider + key + baseURL + 模型 + 人设 + maxTokens；`AI_PRESETS`(一键预设) + 从 `.env.local` 的 `VITE_AI_*` 播种默认 |
| `vite.config.ts` | Vite 同源代理 `/aiproxy → 上游网关`(绕过浏览器 CORS,SSE 透传)；上游由 `VITE_AI_PROXY_TARGET` 配 |
| `system/appSdk.ts` | **App SDK 契约运行时**(D2 地基)：`buildSrcdoc`(用户代码 + 注入访客 SDK `window.qz`) + `handleGuestCall`(宿主端 RPC 闸：查 App 声明的能力 → 不在集合里一律拒 → 路由到 executeTool / `complete` AI / `guestFetch` 网络 → postMessage 回灌)。**`window.qz` 还含 IPC**：`qz.emit(事件,数据)`/`qz.on(事件,(数据,来自)=>…)` 跨沙箱收发事件（走宿主总线 `app:` 命名空间）。**能力声明**：`CAPABILITIES`(apps/files/theme/ai/**net** 五组,各映射到具体工具;net→`qz.fetch` 宿主代发 HTTP) + `capsToTools()`(声明 key→工具名集合,旧 App 无字段=全给)。用户 App 跑沙箱 iframe(`sandbox=allow-scripts`,无 same-origin),只能经 postMessage 调系统 |
| `system/studioDraft.svelte.ts` | 开发者 App 的代码草稿(`persisted`) + `STARTER_CODE` 示例(演示 qz.launchApp/setTheme/listApps/ask) |
| `shell/Window.svelte` | 窗口 chrome：拖/缩放(rAF 批处理)/最大化(CSS 铺满)/最小化/边缘吸附(左/右半屏 + 上=最大化 + **四角=四分之一屏** tl/tr/bl/br)/开关动画/活动窗焦点边框；transform 定位 + `contain`。**拖拽中被卸载**(AI/快捷键关窗)→ `onDestroy` 兜底 cancelAnimationFrame + 清残留 snap 预览(仅本窗在拖时)。**移动模式**(`viewport.isMobile`)：窗口铺满 + 禁拖拽缩放，靠顶栏/Dock 切换。**经 `provideWindow`(`lib/winctx.ts`)把最小化状态传给窗口内 App** → 时钟/任务管理器/提醒最小化时暂停每秒定时器(`windowVisible()` 守卫 effect)，还原自动恢复 |
| `system/viewport.svelte.ts` | 响应式视口：`matchMedia` → `viewport.isMobile`（窄屏移动模式）+ `viewport.reducedMotion`（系统「减少动态」偏好）。前者 Window 铺满/Dock 横滚；后者 app.css 全局媒体规则关 CSS 过渡 + `pop`/通知 fly 置 0 |
| `lib/motion.ts` | 窗口开/关的 Svelte 自定义过渡 `pop`（只动 opacity + 独立 scale 属性，不碰 transform） |
| `shell/WindowControls.svelte` | 红绿灯：关 / 最小化 / 最大化 |
| `shell/TopBar.svelte` | 顶栏任务栏：**🍆 按钮(开 Launchpad)** + 每窗一个切换 chip（活动高亮/最小化淡显 + **右键菜单**:最小化·还原/最大化·还原大小/关闭,与 Dock/Window 一致）+ **系统托盘**（明暗切换 🌙/☀️ + 通知中心铃铛 🔔 未读角标 + 历史下拉面板,点外部关闭）+ 实时时钟 |
| `shell/snapState.svelte.ts` | 边缘吸附预览框的共享信号（Window 写、Desktop 画） |
| `shell/Dock.svelte` / `system/dockPrefs.svelte.ts` | 启动 + 在跑指示点 + 点击还原聚焦；列 `sortDockApps(visibleAppDefs(),running)`(内置 + 用户 App,用户 App 一等公民有自己的图标/运行点)。**Dock 偏好**(`dockPrefs` 持久 `qz.dock`：`order` 自定义排序 + `hidden` 取消固定，单独成模块不进 settings 主题白名单但随账号同步)：右键 左移/右移·固定/取消固定·重置·**自动隐藏(E8)** + HTML5 native drag 重排；取消固定的 App 运行中仍保留圆点、退出后才隐藏。**D5**：`forgetDockApp(id)`，`removeUserApp` 卸载用户 App 时清掉 order/hidden 里它的死引用。**E8 自动隐藏**：`dockPrefs.autohide`，开启后 Dock 平时 translateY 滑出屏底、鼠标进底边 8px 热区或 Dock 才滑回（`hidden=autohide && !revealed && !dragId`，移动端守卫不启用、拖拽中不收起；inline transform 含 translateX(-50%) 保居中） |
| `shell/Desktop.svelte` | 壁纸 + 景深 + 顶栏 + 桌面图标 + 窗口层 + Dock + 右键菜单 + 全局快捷键(Esc 关窗/Ctrl·Cmd+M 最小化/Alt+\` 轮换/Ctrl·Cmd+K Spotlight/**Ctrl+Alt+方向键平铺活动窗**:←左半→右半↑最大化↓还原/**Ctrl+Alt+G 网格平铺所有窗**)；桌面右键含「平铺窗口」(网格)/「层叠窗口」(cascade)；给 App 传 `data` 启动参数 |
| `shell/ContextMenu.svelte` / `shell/menu.svelte.ts` | 右键菜单组件 + 全局菜单状态(`openMenu`/`closeMenu`)。⚠️文件名小写 menu 避免和组件大写撞名(Windows) |
| `shell/StickyNotes.svelte` / `shell/notes.svelte.ts` | **桌面便签小组件**(E8b)：贴桌面的便利贴，持久 `qz.notes`(StickyNote{id,text,x,y,color})。便签层穿透(单张 auto)、在图标之上窗口之下；顶栏手柄拖动(setPointerCapture+夹视口内)、textarea 编辑、🎨 换色/✕ 删除；桌面右键「新建便签」。`addNote/removeNote/cycleColor` |
| `shell/DesktopIcons.svelte` / `shell/iconLayout.svelte.ts` | 桌面图标（拖动/双击/右键）+ 图标位置持久化（`qz.desktopIcons`）。**D5 孤儿 GC**：组件内 `$effect`（必在 main.ts `hydrateAll()` 后挂载 → vfs 已水合不误删）+ `untrack` 把 `iconPos.pos` 里节点已不存在的位置清掉，防只增不减 |
| `shell/Launchpad.svelte` / `shell/launchpadState.svelte.ts` | **Launchpad 全 App 网格启动器**（点顶栏 🍆 唤起）：全屏 backdrop-blur 浮层 + 搜索过滤 `visibleAppDefs()` + 图标网格，点击 `launchAppDef` 启动并关闭，Esc/点遮罩关。仿 spotlight 模式 |
| `shell/Shortcuts.svelte` / `shell/shortcutsState.svelte.ts` | **键盘快捷键速查面板**（`?` 唤起，桌面右键也可开）：分组列出 窗口/系统/编辑·终端 快捷键（含拖拽吸附、Ctrl+Alt 平铺、Ctrl+K、Ctrl+F 等），Esc/点外部关。仿 spotlight 模式 |
| `shell/Spotlight.svelte` / `shell/spotlightState.svelte.ts` | 命令面板（Ctrl/Cmd+K）：搜内置 App + **已装用户 App** + VFS 文件（**名字+正文，正文命中显片段**）+ **动作命令**(切换明暗/清空回收站/打开终端·设置/显示桌面/关闭所有窗口) + **「问 AI」入口**(选中→开助手并以 `data.ask` 自动提问)，方向键/Enter 启动 |
| `apps/appList.ts` | App 元数据(id/title/icon/尺寸/hidden)纯数据，不 import 组件 → 谁都能安全 import 不成环（aiTools 用它） |
| `apps/registry.ts` | 内置注册表 = `appList` 元数据 + 组件，组装成 `appId → AppDef{ ...meta, component, data? }` |
| `apps/desktopApps.svelte.ts` | **内置 + 用户 App 的合并视图**：`visibleAppDefs()`(Dock/Spotlight 列表) / `resolveAppDef(appId)`(窗口/任务栏按 id 解析,含用户 App) / `launchAppDef`·`launchUserApp`。用户 App 都映射成 `AppDef{ component: UserApp, data:{appId} }` → 有独立 appId、进 Dock、有运行点。⚠️ 函数式而非 `$derived`(读 `userApps.list` 在组件里自动追踪)；⚠️ **registry 别 import 它**(registry→AppGallery→desktopApps→registry 会成环;AppGallery 改为内联 launch) |
| `apps/Assistant.svelte` | AI 助手 App：流式聊天(Markdown 渲染) + 工具 chip + 停止/清空 + 对话持久化 + **`data.ask` 自动提问**(供 Spotlight 调) + **视觉**(📎 附图 + Ctrl+V 粘贴图片 → 缩略图预览 → 喂视觉模型看图回答,消息内显示附图)。无 key 提示改 provider 感知(OpenAI 兼容端点可无 key) |
| `apps/Welcome.svelte` / `apps/Settings.svelte` | 欢迎 App / 设置 App（自定义闭环）。设置含 **AI 全配置**(provider 切换 + 一键预设 + key/地址/模型/人设) + **AI 配色**(一句话换肤,复用 set_theme 工具) |
| `apps/Files.svelte` / `apps/TextEdit.svelte` | 文件管理器（面包屑/网格/CRUD/右键 + **即时名字过滤** + **AI 语义搜索** + **⬆上传二进制**(createBinaryFile→IndexedDB) + 双击图片开图片查看器 + **复制/剪切/粘贴**(右键 + 工具栏粘贴 + Ctrl+C/X/V,copy 走 copyNode 递归深拷贝、cut 走 move) + **多选**(点击/Ctrl/Shift,选中态 ring,批量 删除/复制/剪切,Delete 键,操作条) + **排序/视图**(E4：排序 名称/类型/大小/修改时间 + 升降序，网格/列表视图切换；list 显大小·mtime·属主权限列，窄窗渐次藏列；文件夹恒在前；同一 item 包裹单一交互来源，重命名输入用 snippet 复用)）/ 记事本（绑定文件 content 自动存 + **Ctrl+F 查找/替换**：计数/上下导航环绕/区分大小写/替换·全部，gated on writable + 底部行·字符状态栏 + **Markdown 预览**：`.md`/`.markdown` 文件显「编辑/预览」切换,预览态 `{@html renderMarkdown}`(复用 AI 回复同款安全渲染器),Ctrl+F 自动切回编辑）。**记事本内嵌 AI**：润色/总结/续写/译英 → 流式进预览面板,可替换/追加/丢弃(不毁原文) |
| `apps/ImageViewer.svelte` | 图片查看器(隐藏 app `imageviewer`,Files 双击图片打开)：`readBlob`→`URL.createObjectURL`→`<img>`，`$effect` 清理函数里 `revokeObjectURL` 防泄漏。**E2 缩放/旋转/平移**：`scale/rot/tx/ty` $state 驱动单条 `transform`(translate+scale+rotate,GPU 合成)+工具条(缩放/旋转/适应)+滚轮缩放+指针拖拽平移(setPointerCapture)+键盘(+/-/0/r)；换图 reset |
| `apps/SysMonitor.svelte` | **任务管理器**(Phase E,Dock 📊)：进程页(PID/PPID/状态/运行时长 + **进程树**(procTree 按 ppid 排序缩进) + 聚焦/挂起/结束,真控真进程) + 日志页(klog 实时) + **事件页**(eventLog 原始事件流:名+payload) + 概况页(进程/服务/文件/回收站/已装App/日志/localStorage 计数)。进程页含**后台服务**小节(无窗口进程,显示状态/重启次数↻N,可重启/停止)。⚠️ 不 import registry(会成环)→ 图标用 appMeta+userApps |
| `apps/Companion.svelte` / `lib/live2d.ts` / `system/companion.svelte.ts` | **Live2D 伙伴**(D3,Dock 里 🧚)：canvas + 模型 URL 输入 + 加载/错误态。`lib/live2d` 装配(注入 Cubism Core CDN 脚本 → 动态 import PixiJS + pixi-live2d-display → `Application`+`Live2DModel.from`)，model 配置持久化。**装配失败兜底**：`new Application` 之后整段包 try，model 加载抛错时先 `app.destroy()` 回收 WebGL 上下文再抛 → 反复填错 URL 不耗尽浏览器 ~16 上下文上限。⚠️ 必须用 `pixi-live2d-display/cubism4` 入口(主入口会要 Cubism2 的 live2d.min.js)；⚠️ WebGL 渲染无头预览验不了视觉，得真浏览器看(管线已实测无报错:core/pixi/WebGL/模型加载全过) |
| `apps/Calculator.svelte` / `apps/Clock.svelte` | 计算器（四则+链式+除零保护 + **键盘输入**(根 div tabindex+onkeydown,数字/运算符/Enter/Backspace/c·Delete,Esc 不拦仍关窗;按钮点击后 focus 收回根) + **计算历史面板**(🕘 切换,最新在前,点 recall 填结果,封顶 30)）/ 模拟时钟（SVG 指针 + `$effect` 定时器） |
| `apps/Sandbox.svelte` | 通用沙箱组件：把一段 code 跑进隔离 iframe + 宿主 RPC 闸(`e.source===contentWindow` 才收)。收 `caps`(能力白名单)+`appId`(IPC 的 from) prop。处理三类消息：`call`→`handleGuestCall`、`emit`→发总线 `app:` 事件、`sub`→架桥把 `app:` 事件转发进 iframe(只转发 app 命名空间,不泄漏内核事件;卸载清桥)。Studio 预览 + 已装 UserApp 都复用。⚠️ `setTimeout` 重建 iframe(rAF 隐藏页冻结) |
| `apps/Studio.svelte` | **开发者 App**（D2）：左 `<CodeMirror>`(语法高亮) + 右 `<Sandbox>` 实时预览 + ▶运行/**💾保存为 App**/**🔐能力声明栏**(勾选 apps/files/theme/ai,预览即按此放行)/SDK 说明。可被「我的 App」以 `data.editAppId` 唤起编辑现有 App |
| `apps/CodeMirror.svelte` / `lib/codemirror.ts` | CodeMirror 6 编辑器：组件做 `$bindable` 双向绑定 + 生命周期，`lib` 做装配(html 语言含内嵌 CSS/JS 高亮 + oneDark 主题)。**动态 import → 单独 chunk(gzip ~164KB)**，首次开「开发者」才下载，不进首屏 |
| `apps/userApps.svelte.ts` | 已安装用户 App 的持久库(`persisted`)：`UserApp{id,name,icon,code,w,h}` + `saveUserApp`(增/改) / `getUserApp` / `removeUserApp` |
| `apps/UserApp.svelte` | 通用宿主：`data.appId` → 查 `getUserApp` → `<Sandbox code>`。挂在隐藏 app id `userapp` 上，所有已装 App 共用它渲染 |
| `system/appRepo.svelte.ts` | **远程 App 仓库**(对标 apt)：持久化源 URL(`qz.repo`,默认同源 `/apps.json`) + `fetchCatalog`(拉 catalog JSON+校验过滤) + `installCatalogApp`(经 appShare 装进「我的 App」,同名幂等去重) + `isInstalled`。shell `pkg` 与「应用商店」用它。示例仓库 `public/apps.json` |
| `apps/AppStore.svelte` | **应用商店**(app id `appstore`,Dock 📦)：拉远程仓库 catalog → 列出可装 App(图标/说明/能力) → 一键安装进「我的 App」+ 源 URL 输入/刷新。配合 shell `pkg` |
| `apps/AppGallery.svelte` | **「我的 App」启动器**(app id `myapps`,在 Dock)：列已装 App → 启动/编辑/删除/新建/**导出(下载 .qzapp.json)/导入(文件→安装)** |
| `apps/appShare.ts` | App 分享：`serializeUserApp`(→`.qzapp.json`) / `importUserAppFromText`(解析+校验→`saveUserApp`,纯函数易验) / `exportUserApp`(Blob 下载) / `importUserAppFile`。轻量第三方分发 |
| `apps/webApps.svelte.ts` / `apps/WebAppGallery.svelte` / `apps/WebView.svelte` | **网页 App**(Phase F·异构 App 嵌入)：把任意网址固定成 App。持久库(`addWebApp` 自动补 https://) / 「网页 App」管理器(app id `webapps`,Dock 🌐,添加/启动/删除) / 通用 iframe 宿主(隐藏 app `webview`,`data.url`,带「新标签打开」兜底 X-Frame-Options 拦截)。⚠️ 组件叫 `WebAppGallery` 避免和小写 `webApps.svelte.ts` 在 Windows 撞名 |
| `apps/Trash.svelte` | 回收站：列出软删除项 + 还原 / 彻底删除 / 清空（**不可逆操作两次点击确认**：首点变「确认?/确认清空？」3s、再点才执行，防误删） |
| `app.css` | Tailwind v4 `@theme` token + `qz-glass` 玻璃工具类 |
| `App.svelte` | `$effect` 应用主题 + **注入 `settings.customCss` 到 `<style id=qz-custom-css>`**(全局自定义 CSS) + 首启动开 Welcome + 挂 `<Desktop/>` |

### 设计 token 机制（地基，务必懂）
- `app.css` 的 `@theme` 定义 `--color-qz-*`/`--radius-qz` → Tailwind 同时生成工具类(`bg-qz-surface`…)和 `:root` 变量；非颜色 token(`--qz-blur`/`--qz-surface-opacity`/`--qz-wallpaper`)放普通 `:root`。
- 运行时 `theme.svelte.ts` 把值写进 `<html>` 的 inline style 覆盖默认（inline 优先级最高 → 永远赢）。
- 玻璃面板用 `qz-glass`：`color-mix` 算半透明表面色 + `backdrop-filter` 模糊，全吃运行时 token。

### 验证状态
- `npm run check` ✅ 0 错 0 警；`npm run build` ✅ 干净（CSS 17KB、JS 56KB / gzip 22KB）。
- 浏览器实测（DOM 级）：主题实时切换 / 持久化(刷新还在) / 窗口开关-最小化-还原-最大化-边缘吸附，逻辑全通过。
- ⚠️ 预览工具的坑（均为环境限制，非代码问题）：无头预览的页面 `visibilityState` 恒为 `hidden`，会**冻结 rAF + CSS 动画时间线**（动画卡在起始帧、`out:` 过渡的元素清理不触发），且 `preview_screenshot` 超时。→ **动画的视觉平滑度只能在真实浏览器看**：直接开 `localhost:5173`。

---

## 六、怎么跑

```bash
# 在 D:\file\New Develop\QieZiOS 下
npm install     # 已装过；换机器才需要
npm run dev     # → http://localhost:5173
npm run build   # 生产构建
npm run check   # svelte-check 类型检查
npm run serve   # 生产：node server/index.mjs 托管 dist + 反代 /aiproxy（需先 build）

# Docker 自托管（一行起）
docker compose up -d   # 构建镜像 + 跑在 :8787；AI 网关/key 在 docker-compose.yml 的 env 配
```

---

## 七、路线图（围绕四大方向：性能 / 丝滑 / 自由度 / 美观）

- ✅ **Phase A 地基**：内核重写 + 主题 token + 持久化 + 窗口管理(最小/最大化) + 设置 App。
- ✅ **Phase B 丝滑外壳**：顶栏任务栏 + 会话还原 + 边缘吸附 + 开关窗/最小化动画 + 键盘快捷键/焦点高亮。（性能 pass 推后到需要时再做。）
- 🚧 **Phase C App 平台 + VFS**（进行中）：✅ 虚拟文件系统(localStorage，可换 IndexedDB→OPFS/SQLite-WASM) + ✅ 文件管理器 + ✅ 记事本 + ✅ App 启动参数(`data`) + ✅ 拖拽移动文件 + ✅ 回收站；**待办**：契约式 App SDK(能力声明)。
- ✅ **打磨轮**（作者要求"专注完善当前系统"，⚠️**胡桃博客不在本项目内做**）：右键菜单系统 + 桌面图标 + 计算器/时钟 App + 主题编辑器(界面缩放/命名主题预设/JSON导入导出) + Spotlight + 文件拖拽移动 + 视觉手感 pass。
- 🚧 **Phase D 从 Demo 到平台**（作者反馈"现在像 PPT、自由度低"，点了三件底层大事）。**已拍板：先做 AI、AI 先浏览器直连**。
  - 🚧 **D1 AI 底层驱动**：✅ 统一 AI 客户端(`system/ai.ts`) **双协议**——anthropic(SDK 直连) + openai 兼容(纯 fetch+SSE,支持 minimax 等推理模型) + ✅ 工具调用驱动系统(`aiTools.ts`) + ✅ 助手 App 流式聊天(含思考过程折叠)。✅ **AI 织进各 App**：记事本(润色/总结/续写/译英)、设置(自然语言 AI 配色)、**Spotlight(问 AI)**、**文件语义搜索**。✅ 浏览器 CORS 用 Vite 同源代理 `/aiproxy` 解决(D0「AI 密钥代理」雏形)。**待办**：生产环境的真后端代理(目前 `/aiproxy` 仅 dev server 生效)。
  - ✅ **D0 地基**：✅ **VFS 二进制**(`blobStore.ts` IndexedDB) ✅ **生产 Node 后端**(`server/index.mjs` 零依赖：托管 dist 静态 + 反代 `/aiproxy`→网关 + `/sync/<token>` 存取;SSE 透传;可 `AI_KEY` 服务端注入。`npm run build && npm run serve`) ✅ **跨设备同步雏形**(`system/sync.ts`：把 `qz.*`(排除 AI key)推到 `/sync/<token>`/拉回;设置「☁️云同步」上传/恢复。服务端实测 PUT/GET/404/落盘通,客户端 gather 通;全链路需部署后测)。
  - 🚧 **D2 App 开发平台**：✅ 契约式 App SDK(`appSdk.ts`：沙箱 iframe + postMessage RPC + 能力白名单 → 复用 executeTool/AI) + ✅ 开发者 App(`Studio.svelte`) + ✅ **写好的 App 存成命名 App 装进系统**(`userApps`/`Sandbox`/`UserApp`/`AppGallery`)——保存→进「我的 App」启动器+Spotlight→反复启动→刷新还在。**实测全闭环通过**：写代码→保存为 App→画廊启动→沙箱内 `qz.launchApp` 真驱动系统→持久化。✅ 编辑器升级 **CodeMirror 6**(语法高亮 + 行号 + 折叠，懒加载单独 chunk)。✅ **能力声明 + 强制**(`CAPABILITIES` 四组；Studio 勾选→存进 `UserApp.caps`→宿主按声明放行/拒绝，实测同代码不同声明结果不同；画廊显示每 App 能力)。✅ **用户 App 升格一等公民**(`desktopApps.svelte.ts` 合并注册表：用户 App 有独立 appId、钉进 Dock、有运行点/任务栏图标；实测 Dock 点击启动→窗口 appId=自身 id)。**待办**：胡桃博客以后也走 iframe 嵌。**D2 基本完成**。
  - ✅ **D3 Live2D 伙伴（方向③，基本完成）**：✅ 渲染管线(`lib/live2d.ts`：Cubism Core + PixiJS6 + pixi-live2d-display@0.4 懒加载) + ✅ 伙伴窗口 App + ✅ **桌面浮层桌宠**(`DesktopPet.svelte`：可拖/可关) + ✅ **接 AI 成「脸」**(💬 气泡聊天→`complete` 流式→流式时 `setMouth` 口型、回复完 `react()` 动作 + `expression()` 表情)。**待办（可选）**：真口型同步(需 TTS 音频)、按情绪精确映射表情、自定义模型走二进制 VFS。（曾因「底层太薄」暂停转 Phase E,见 [[foundation-over-features]]。）
  - **D4 真·平台化**：后端账号/同步、Module Federation 第三方分发、Docker 自托管 + 在线版、每 App 主题/自定义 CSS。
- 🚧 **Phase G 对标 Linux 的系统化补强**（当前自动推进阶段 · 详见 [[DEVPLAN-LINUX]]）：在浏览器沙箱内补齐"像真系统"的能力。**自治开发心跳（定时任务）**按 `DEVPLAN-LINUX.md` 逐项推进：每触发一次 = builder 子 Agent 实现 + supervisor 子 Agent 跑 check/build+审查 + 通过则提交推送+勾选，直到 backlog 清空自删。
  - ✅ **G1 终端与 Shell（旗舰）**：`vfs.resolvePath/pathOf` + `lib/shell.ts`(分词/重定向/coreutils) + `apps/Terminal.svelte`(🖥️ 滚动/历史/Tab 补全)。实测：cd/ls -l/echo>文件/cat/open 启动 App/退出码均通。
  - ✅ **G2 流、管道与文本处理**：G2.1 管道 `\|` + 重定向 `< > >> 2>`(命令模型带 stdin)；G2.2 grep/find/wc/head/tail/sort/uniq/cut。实测 4 级管道、递归 grep/find 均通。
  - ✅ **G3 配置与虚拟文件系统**：G3.1 env/export/unset/which/source + `/etc/profile` 启动 rc + `$PATH`；G3.2 `system/vfsVirtual.ts` 挂 `/proc`·`/dev` 只读虚拟节点（ls/cat 虚拟感知）。实测 `which ls`、`/etc/profile` 出厂、`ls /proc`、`cat /proc/<pid>/status` 等均通。
  - ✅ **G4 权限与用户**：G4.1 VNode mode/owner + `chmod`/`chown`/`stat` + `ls -l` 权限属主 + cat/重定向 best-effort 校验；G4.2 `system/users.svelte.ts` 用户表 + `id`/`users`/`su`/`sudo`/`useradd` + 真实 `/etc/passwd`(随用户表同步) + root prompt `#`。实测 sudo 提权/stdin 透传、su root 旁路读 000 文件均通。
  - ✅ **G5 进程与服务加深**：G5.1 Process ppid/进程树 + 信号 `kill -9/-STOP/-CONT` + `ps`/`pstree`/`jobs` + 任务管理器进程树；G5.2 服务 `after`/`requires` 拓扑排序 + 开机启用/禁用持久化(`qz.svccfg`) + `systemctl` 命令 + 任务管理器服务 UI（崩溃自愈带 `isEnabled` 守卫防复活禁用服务）。实测 pstree 树、kill 信号、systemctl disable→reload 仍禁用均通。
  - 🚧 **G6.1 ✅ 网络工具（终端）**：shell 异步化（run/source/sudo async）+ `curl`(-i/-I,CORS 受限)/`fetch`/`hostname`；Terminal busy 锁。实测 curl 同源/经 aiproxy/管道/CORS 报错均通。
  - 🚧 **G6.1b ✅ 用户 App 网络能力**：appSdk `net` 能力 + `qz.fetch`（沙箱经宿主 RPC 受能力门控）。实测 net-cap App 取数成功、no-cap 被拒。
  - 🚧 **G6.2 ✅ man/help 文档**：`lib/man.ts` 手册页注册表(45 条) + shell `man <命令>` + `help <命令>` 委托 man。实测 man grep/ls、help kill、未知页报错均通。
  - 🚧 **G6.3 ✅ 远程 App 仓库（apt-like）**：`system/appRepo.svelte.ts`(catalog URL→装 App,幂等去重) + shell `pkg list/search/install/repo` + GUI「应用商店」(📦) + 示例 `public/apps.json`。实测 pkg 全子命令 + 商店 GUI 安装 + 去重均通。
  - ✅ **G7 后端账号 + 账号制同步**：`server/index.mjs` 加 `/auth/register`·`/auth/login` + 账号制 `/sync`(Bearer 鉴权、按用户隔离)；`system/account.svelte.ts`(持久会话) + `system/sync.ts`(账号制) + Settings 账号 UI + vite dev 代理 `/auth`·`/sync`→本地后端。实测服务端 curl 全过 + 浏览器全链路 push/pull 恢复。⚠️ 安全待硬化（功能优先，见记忆 [[prioritize-features-over-security]]）。
  - 🎉 **Phase G「对标 Linux」backlog 全部完成**（G1–G7 全 ✅）。自治心跳已撤销。
- 🚧 **Phase H 功能深度·Shell 自动化**（作者选 · 详见 [[DEVPLAN-LINUX]]）：把终端升级成真自动化环境。
  - ✅ **H1 命令序列 `;`/`&&`/`||`**：`run` 拆成「连接符短路编排（splitConnectors+左结合）+ runPipeline（管道/重定向）」两层；`cd` 链内即时生效。实测顺序/短路/混合全通。
  - ✅ **H2 别名 + 持久历史**：`system/shellPrefs.svelte.ts`（持久 aliases + cmdHistory）；shell 首词别名展开 + `alias`/`unalias`；终端历史持久化跨终端/刷新（↑/↓）。实测 alias 展开（含管道内）+ 历史回放均通。
  - ✅ **H3 脚本控制流 + 执行脚本**：迷你解释器（splitStatements+parseStatements 递归下降 AST+expandWords）；`if/elif/else/fi`、`for…in…do…done`、`while`、`test`/`[ ]`(evalTest)、`sh`/`source`/`./file`（整文件多行执行）；while/for 防失控（上限+输出封顶+让出主线程）。原 H1 `run`→`runLine`，新 `run`=解释器。实测 if/for/while/嵌套/sh/.​/file 均通。
  - ✅ **H4 后台作业（job control）**：`system/jobs.svelte.ts`(运行时作业表 `jobs=$state`)；shell `backgroundRun`(末尾单 `&` → 用 ctx 副本不 await 地跑 `run`、登记 bgPromises、完成发通知) + `jobs`/`fg [n]`/`bg`/`wait` 命令（原列窗口进程的 jobs 被真后台作业替代）。实测 `curl 慢接口 &` 时 jobs 显示 Running 且前台命令仍立刻执行（真并发不阻塞）、fg 显示输出、wait 返回。
  - ✅ **H5 终端定时（at/crontab）**：`Schedule` 加 `command?`；`schedules.svelte.ts` 注入式 `setScheduleRunner`/`runScheduled`（避免 system→lib/shell 成环），schedd `fire` 有 command 就经 `runScheduled` 跑 shell、用通知回报；App 接独立 `cronShellCtx`。shell `at +<N>[s/m/h] <命令>`(一次性/-l/-r) + `atq` + `crontab <间隔> <命令>`(循环/-l/-r)。实测 `at +2s mkdir atdir`→2s 后真建出、一次性自删；`crontab 1s touch cronfile`→真循环建文件、`-r` 后停。
  - 🎉 **Phase H 全部完成（H1–H5 全 ✅）**——至此 G1–G7 + 融合三件套 + Phase H 整个「对标 Linux / Shell 自动化」backlog 清空，自治心跳已撤销。
- 🚧 **性能 / 存储硬化阶段**（作者拍板「进入下一阶段」选定 · 详见 [[DEVPLAN-PERF]]）：对齐「性能最强 + 最丝滑」+ 解 localStorage 配额迫近天花板的结构性风险。
  - ✅ **P1 VFS 迁 IndexedDB**：新 `kernel/idbStore.ts`（async KV 库 `qz-kv`）+ persist 加 `persistedAsync`（异步 hydrate + `hydrated` 守卫防默认值覆盖 + `hydrateAll()` 启动门 + localStorage→IDB 一次性迁移）；`vfs` 改用它、`main.ts` 挂载前 `await hydrateAll()`；sync/SysMonitor 改后端感知。**破 localStorage ~5–10MB 天花板**——实测 6MB 文件持久化+reload 完整、localStorage 不再存 VFS。19 处同步 `persisted` 零回归。
  - ✅ **P7 存储用量仪表盘**：SysMonitor 概况页显 `navigator.storage.estimate()` 真实用量/配额/百分比（含 IDB/blob/localStorage）+ 进度条（>90%红/>70%橙）+ qz.* 数据字节。配额实测 ~37GB，直观印证 P1 破天花板。
  - ✅ **P4 长列表渲染优化**：CSS `.qz-cv-row`（`content-visibility:auto`+`contain-intrinsic-size:auto 1.25rem`，浏览器跳过离屏行布局/绘制）用于终端输出 + SysMonitor 日志/事件行；终端加回卷上限 5000 行（`trimScrollback`）。纯 CSS 不碰滚动逻辑、可访问性不变；非手写虚拟化（终端行可变高+无头验不了滚动几何）。
  - ✅ **P2 chat 迁 IDB + 附图持久化**：`assistantChat` 从 `persisted`(localStorage+剥图) 改 `persistedAsync`(IDB)。P1 破配额后 A1 被迫剥成占位的附图能力补回——附图（缩放 ~4KB/张）随对话存 IDB、刷新原样还原；imageCount 兼容旧数据。settings/dock/windows 等小 store 仍留 localStorage。
  - **待办**：P5 vfs.children() 信号热点（高 blast radius、需专注）/ P6 不可见窗 content-visibility / P3 OPFS+SQLite-WASM（远期）。
- 🚧 **完善与查漏阶段**（作者 `/loop` 自驱：完善功能 + 查漏 + 继续 · 详见 [[DEVPLAN-POLISH]]，第 2 轮见 [[DEVPLAN-POLISH-2]]）：两路子 Agent 审计出的正确性 bug(P0) + 功能/体验缺口(P1) + 一致性打磨(P2) backlog，每轮挑价值最高项推进。**第 1 轮（DEVPLAN-POLISH）全 ✅；第 2 轮（DEVPLAN-POLISH-2）进行中**：重新审计扩大后代码库得 D1-D5+A3 正确性 + E1-E8 功能缺口。**正确性已全清（D1-D5 + A3，含承接自第 1 轮的 A3）+ 功能 E1-E4 已完成**；剩 E5-E8（终端配色/音效/Exposé/Dock 自动隐藏）。
  - ✅ **D1 清空对话 mid-stream 崩溃修复**：Assistant 流式回调写 `chat.msgs[i]`（i 在 ask 时捕获），「清空」按钮原无 `disabled={busy}` → 流式中点清空 splice 数组 → undefined 解引用 `TypeError` + busy 卡死。修：回调改 `const m=chat.msgs[i]; if(!m) return;`（四事件全改 m，响应式不变）+ 清空按钮 busy 时禁用。实测：splice mid-stream 无 error、迟到事件被丢弃、busy 恢复不卡死。
  - ✅ **D3 回收站还原重名去重**：`vfs.restoreFromTrash` 还原时不查目标目录重名 → 删 a.txt→新建同名→还原 = 同名并存、resolvePath 只命中第一个、另一个永久不可达（静默数据丢失）。修：还原落地前 `n.name = uniqueName(target, n.name)`（n 仍在 'trash' 故不误改自己，镜像 move 的 A7）。**补齐 A7(move)/A9(rename)/D3(restore) 数据完整性三件套**。实测：还原项→「d3 2.txt」、两者路径各自可达；无冲突不误改；文件夹还原子项按 id 仍 linked。
  - ✅ **E1 记事本 Markdown 预览**：TextEdit 打开 `.md`/`.markdown` 文件显「编辑/预览」分段切换；预览态渲染只读 `{@html renderMarkdown(content)}`（复用 AI 回复同款安全渲染器，先转义再套白名单标签→无 XSS），编辑态原 textarea，Ctrl+F 自动切回编辑。实测：.md 显工具条/.txt 不显、预览渲染粗体/代码/链接/标题/列表正确、切回编辑带内容、Ctrl+F 切回；非 md 零回归。
  - ✅ **B1 自定义壁纸**：上传图片(blobStore)/纯色，优先于内置预设；`wallpaperBlob.svelte.ts` 管 objectURL 生命周期。兑现「美观第一优先级」、破除「只有内置渐变」。
  - ✅ **A1 对话附图持久化修复**：`persisted()` 加 `serialize` 变换参，chat 存盘前剥图片字节(留 imageCount)→ 防多图撑爆配额致整段对话静默丢失。
  - ✅ **B4 记事本查找/替换**：TextEdit 加 Ctrl+F 查找条（计数/导航/区分大小写/替换·全部）+ 行字符状态栏，补齐裸 textarea 的基础编辑能力。
  - ✅ **A7 vfs.move 重名去重**：移动到已有同名条目的目录时自动改唯一名（uniqueName），消除「同名并存、被移动文件按路径不可达」的数据完整性 bug（GUI 拖拽 + shell mv 进目录都覆盖）。
  - ✅ **B3 提醒选具体时间**：Reminders 加「多久后/指定时间(datetime)/循环」三模式 + 秒分时天单位，兑现底层早已支持的 fireAt 绝对时间。
  - ✅ **A2 persisted 序列化推迟**：snapshot 留 effect 体内维持订阅、serialize+stringify 推迟进防抖回调 → 大文件逐字输入不再每键全量序列化整棵 VFS（订阅字节级不变、零数据丢失风险）。
  - ✅ **B5 Files 复制/剪切/粘贴**：vfs `copyNode` 递归深拷贝（二进制复制独立 blob）+ Files 右键/工具栏/Ctrl+C·X·V，补齐 GUI 文件管理器核心缺口（终端有 cp、GUI 此前没有）。多选拆为 B15。
  - ✅ **A5 Window 拖拽中关窗泄漏修复**：`onDestroy` 兜底取消 pending rAF + 清残留 snap 预览框（仅本窗在拖时），堵住拖拽中被卸载的资源泄漏。
  - ✅ **B6 通知中心 / 系统托盘**：顶栏右侧加明暗切换 + 通知铃铛（未读角标 + 持久化历史面板），通知不再弹完即焚。supervisor 抓到「刷新后 nid 撞历史 id → keyed each 崩」并已修。
  - ✅ **A9 rename 重名拒绝**：`vfs.rename` 返 boolean、同目录重名拒绝+提示（Files/DesktopIcons/shell mv 全覆盖），补齐 A7 之外「显式改名造成同名并存不可达」的缺口；顺带修 DesktopIcons Escape/二次 blur 误提交既存 bug。
  - ✅ **B8 Spotlight 增强**：命令面板加文件正文搜索（命中显片段）+ 动作命令（切换明暗/清空回收站/打开终端·设置/显示桌面/关闭所有），从「搜 App/文件名」升级为真命令面板。
  - ✅ **A6 Live2D WebGL 泄漏修复**：`createPet` 装配失败时先 `app.destroy()` 回收 WebGL 上下文再抛，反复填错模型 URL 不再耗尽浏览器上下文上限（⏳ 待真机验证）。
  - ✅ **A4+A8 shell 小修**：A4 `backgroundRun` 裁剪 bgPromises（⊆ jobs.list ≤30，免长会话 Map 泄漏）；A8 `head/tail` 负数 count 夹到 0（修 `slice(0,-N)` 错误语义）。**至此 P0 正确性/健壮性全部完成**。
  - ✅ **B2 删除确认**：回收站「彻底删除/清空」改两次点击确认（非模态，首点「确认?」3s 再点才执行），防不可逆误删；软删除靠回收站还原不强制确认。
  - ✅ **B7 窗口四角四分屏 + 键盘平铺**：拖到上/下边缘靠两侧 20%→四分之一屏(tl/tr/bl/br)，Ctrl+Alt+方向键平铺活动窗（左半/右半/最大化/还原）。拖拽四角 ⏳ 待真机验证。
  - ✅ **B11 快捷键速查面板**：`?` 唤起浮层列出所有快捷键（`Shortcuts.svelte`+`shortcutsState`），解决「快捷键无处可查」（尤其新加的 Ctrl+Alt 平铺）。
  - ✅ **B10 桌宠引导 + AI 就绪 provider 感知**：DesktopPet/TextEdit/Files 的 `hasKey` 统一改 provider 感知（`provider==='openai'||!!apiKey`，与 Assistant 一致）→ 本地/网关无 key 不再被误判「没配 AI」隐藏 AI 功能；桌宠无-key 提示加「去设置 AI」跳转。
  - ✅ **B12 Launchpad**：点顶栏 🍆 开全 App 网格启动器（搜索过滤 + 图标网格，点击启动），统一分散的 App 入口。「关于本机」由 SysMonitor 概况页覆盖。
  - ✅ **B15 Files 多选**：网格项 点击/Ctrl/Shift 多选 + 选中态 + 批量删除/复制/剪切（操作条 + Delete 键 + 右键「N 项」）；`clip` 升级为多 id。框选拖拽延后。
  - ✅ **C1 一致性**：顶栏 chip 加右键菜单（最小化/最大化/关闭），与 Dock/Window 拉齐；右键覆盖已齐。删除反馈 toast/撤销拆为 B16。
  - ✅ **B16 删除撤销 toast**：通知支持 `action` 按钮；Files 删除（单/批）后弹「已删除 N 项 · 撤销」，6s 内一键 restoreFromTrash 还原。
  - ✅ **B13 多窗网格平铺**：桌面右键「平铺窗口」/ Ctrl+Alt+G → 未最小化窗铺成网格（2 窗并排/4 窗田字），复用 B7 几何。
  - ✅ **B9 Dock 排序 + pin/unpin**：新 `system/dockPrefs.svelte.ts`（持久 `qz.dock`：`order` 自定义排序 + `hidden` 取消固定；**单独成模块不塞 settings**——避免随主题导入/导出，但随账号同步）。`sortDockApps`(stable sort + 过滤 hidden，运行中 App 取消固定仍保留)；Dock `apps=$derived(sortDockApps(visibleAppDefs(),running))`，右键菜单加 左移/右移·固定/取消固定·重置 Dock 布局 + HTML5 native drag 重排。实测：右移交换+持久化、取消固定→消失(20→19)+reload 存活、重置回默认；拖拽重排 ⏳ 待真机验证（纯函数 + 菜单左右移提供等价可验证路径）。**至此 DEVPLAN-POLISH 全部 `[x]`、完善循环清空 backlog 并停止（见下「🎉」）。**
  - 🎉 **完善与查漏计划全部完成（2026-06-27）**：P0 正确性(A1–A9) + P1 功能(B1–B16) + P2 一致性(C1) 全 ✅，无剩余项；每项 builder 实现 → supervisor 审 diff → 浏览器/DOM 验证 → 提交，全程 check+build 0 错 0 警。自驱完善循环停止。
  - ✅ **融合打磨③·AI↔shell 互通**：AI 加 `run_shell` 工具（注入式，避免 ai→aiTools→shell 成环；常驻 aiShellCtx、cd 跨调用保留）→ 助手直接跑 ls/grep/ps/systemctl/pkg… 全部 coreutils；shell 加 `ai <问题>` 命令（可管道喂入）→ 命令行问 AI。两条驱动线合流。实测：AI agent loop 真调 run_shell 跑 `ls /` 答「15 个条目」、`ai 收到`→本地 GLM 回「收到」。
  - ✅ **融合打磨②·Files 权限感知**：权限判定抽到 `system/permissions.ts`（终端+GUI 共用）；Files 网格显示「属主·你的rwx」+ 无读权限显 🔒、双击受读权限约束（与终端 cat 一致）、右键设只读/可读写/私密/归我所有；TextEdit 无写权限则只读 banner。权限从「终端专属」变成全系统可见可控。实测 perm000 双击被拦、perm444 只读 banner、右键 644→444。
  - ✅ **融合打磨①·统一身份**：后端账号 = shell 当前用户 = 新建文件属主 串成一条线。`account.currentUser()`(账号名/访客 qiezi)；`vfs.setOwnerProvider`(注入,App 启动接上账号→新文件归当前账号,GUI/AI/shell 一致)；`shell.newCtx` USER 取 currentUser；登录时 `ensureUser` 把账号接进 shell 用户表(su/id//etc/passwd 都认)。实测：登录 carol→新终端 carol@、touch 文件 owner=carol、/etc/passwd 含 carol；登出回 qiezi。kernel 仍不反向依赖 system（靠注入）。
- 🚧 **Phase F 平台化 & 生态**：让系统托管真外部应用、可分发、可深度自定义。
  - ✅ **网页 App 嵌入**(`webApps`/`WebAppGallery`/`WebView`)：任意网址 → iframe 窗口 App（兑现「异构 App 平台」愿景，胡桃博客即可这么进系统）。实测：example.com 自动补 https→开 webview 窗口 iframe src 正确、持久化。
  - ✅ **App 导出/导入**(`appShare.ts`)：用户 App 序列化成 `.qzapp.json` 下载分享、导入安装（caps 一并带上）。实测：序列化→导入往返保真、无效文本拒绝。
  - ✅ **Docker 自托管**：多阶段 `Dockerfile`(node 构建 dist → 零依赖 server 托管+/aiproxy) + `.dockerignore` + `docker-compose.yml`(env: PORT/AI_PROXY_TARGET/AI_KEY，卷持久化 /sync)。`docker compose up` 即起。server `SYNC_FILE` 可配（Docker 指到 /data 卷避免遮挡代码）。实测：server 语法+SYNC_FILE 落盘通；⚠️ Docker build 本沙箱无 docker 没跑，文件按规范、内层 npm build/serve 已验。
  - ✅ **全局自定义 CSS**：`settings.customCss` 注入 `<style>`，设置里粘 CSS 即时全局生效（持久化、随导出/同步）。实测：注入 body outline 实时应用。**Phase F 四项完成**。
- 🚧 **Phase E 内核硬化**（作者要"真正的系统"该有的底层，**当前重心**）。五块按依赖：①syscall 边界 ②IPC/事件总线 ③真进程模型 ④服务层 ⑤可观测性。**作者选了从⑤可观测性切入**。
  - ✅ **可观测性**：`kernel/log.svelte.ts`(dmesg) + 进程模型补 `pid`/`startedAt` + **任务管理器 App**(`SysMonitor.svelte`：进程/日志/事件/概况四页,真控真进程)。
  - ✅ **IPC 事件总线 + syscall 门面**：`kernel/bus.svelte.ts`(pub/sub + 环形缓冲) → 内核在真实点 emit(`proc.*`/`fs.*`/`app.*`/`sys.*`)，**日志变成总线订阅者**(事件→fmt→dmesg)，任务管理器「事件」页看原始流。`system/sys.ts` 收成 syscall 表(`sys.proc/fs/ui/bus/log`)。实测：`sys.bus.on/emit` pub/sub 正确(取消订阅后不再收)、`sys.proc.launch` 真启动、开机/建文件/启动都进事件流+日志。
  - ✅ **服务层 + 通知中心**：`kernel/services.svelte.ts`(服务注册/启动/停止 + 运行表) + **通知中心服务 `notifyd`**(无窗口常驻,订阅总线 `notify`/`app.denied` → 系统 toast)。「进程≠窗口」落地：任务管理器进程页列出后台服务。实测：开机弹欢迎 toast、`sys.notify` 弹通知、模拟 `app.denied` → 服务接住弹警告(总线驱动真实 UI)、4.5s 自动消失、服务在任务管理器可见可停。
  - ✅ **用户 App 跨沙箱 IPC**：`qz.emit`/`qz.on` 把事件总线接进沙箱 iframe（`app:` 命名空间 + `from` 标记发送方）。实测双向：app `qz.emit('hello')` → 总线 `app:hello{from:ipc-app}`；外部 `emit('app:trigger')` → 沙箱内 `qz.on` 触发 → 真调 `launchApp`。app↔app / app↔系统消息互通，事件检查器全可见。
  - ✅ **剪贴板服务 + 边界收紧**：第二个守护进程 `clipd`(订阅 `clip.copy` 维护历史) + 剪贴板管理器 App + `sys.clipboard`。**`executeTool` 迁到走 `sys.*`** → AI/沙箱驱动系统全经 syscall 门面（门面真正承重，不再摆设）。实测：executeTool 经 sys 启 App/建文件/换肤均通、剪贴板复制→历史→App 显示、两个服务在任务管理器可见。
  - ✅ **定时器/提醒服务**：第三个守护进程 `schedd`(`sys.schedule.add/cancel/list`：一次性/循环,持久化+开机重新武装,到点经总线发 notify) + 提醒 App。实测：1.5s 一次性→到点弹 toast→自动移除、cancel 通、三个服务都在任务管理器跑。
  - ✅ **服务监督（崩溃自愈）**：`start()` 抛错自动退避重试、运行时崩溃 `crashService` 自愈、`restartService` 手动重启、任务管理器显示状态+重启次数。实测：crashService('clipd')→崩溃→自动重启(restarts=1,running)→重启后仍工作(订阅重建)。
  - ✅ **统一边界（App 启动收口）**：新增 `sys.openApp`，把所有内置 App/外壳的 App 启动从直连 `launch` 迁到 `sys.openApp`（一个 chokepoint，去掉各处 appMeta 查找 + 尺寸样板）。实测：开机经 sys.openApp 开 welcome、title 覆盖/data/尺寸均正确。（VFS-重的 App 仍直连 vfs 模块——可信内置代码不必镜像整个 VFS 进 sys.fs。）
  - ✅ **②性能**：最小化窗口暂停每秒定时器（`provideWindow`/`windowVisible` 上下文，时钟/任务管理器/提醒）。实测时钟最小化冻结、还原恢复。
  - **待办（边际）**：IPC 可选 `ipc` 能力门、③桌宠口型/表情。**Phase E 已扎实**。

---

## 八、与作者协作的方式（重要）

- 作者背景：**Web 前端 + Java**，**Svelte 是新学的、不懂底层**。
- **边做边教**：每引入一个 Svelte 5 新概念都要讲清楚、关键处让作者动手，不要只甩代码。
- 已教过的 Svelte 5 概念：`$state`（组件内 + `.svelte.ts` 全局共享状态）、`$props()`、**小写事件属性**(`onclick`/`onpointerdown`)、`{#each}+{@const}+<Comp/>`(动态组件)、`{@render children()}`(snippet 插槽)、`$derived`(派生状态)、`$effect`(副作用，如写 CSS token)、**`$effect` 清理函数**(`return () => clearInterval`，如顶栏时钟)、`$effect.root`(模块级 effect 作用域)、`$state.snapshot`(序列化前把代理拍平)、自定义 rune helper(`persisted()`，含防抖写盘)、**Svelte 自定义过渡**(`in:`/`out:` + `css` 函数；用独立 `scale` 属性避开 `transform` 冲突)、**`<svelte:window>`**(全局键盘监听)、跨模块复用的 `$derived`/纯函数(`activeId()`)、`$state` 对象的属性级 reactivity（`Object.values()` 也追踪键增删）、**把进程改动收归内核 setter**(`setBounds`——子组件别直接改 prop，否则 Svelte 报 `ownership_invalid_mutation`)、注意**循环 import**（Files 别 import registry；被 registry import 的组件如 AppGallery 别 import `desktopApps`，否则 registry→AppGallery→desktopApps→registry 成环，运行时 TDZ 报「Cannot access X before initialization」——这类错只在 fresh load/HMR 暴露，build/check 不一定拦得住）。
- ⚠️ 注意：Phase A 这批代码是「我写、边写边注释讲解」产出的，**还没有真正让作者动手写过**。下个阶段要落实"关键处让作者动手"。
- 每个阶段都要产出**能跑、能用、好看**的东西（作者很看重美观与手感）。

## 九、待决策
1. 是否 `git push -u origin main`（push 未授权，先问；已攒 11 个 commit）。
2. 下一步方向：继续打磨/小 App（图片查看器需 VFS 存二进制、Markdown 预览、文件拖拽移动+回收站）/ 契约式 App SDK / 深度自定义(主题编辑器)。**胡桃博客 iframe 不在本项目做**。
