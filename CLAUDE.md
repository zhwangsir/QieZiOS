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
- **AI 默认走作者自建网关**：OpenAI 兼容 `https://dgmt.top/lm/v1`，模型 `minimax/minimax-m2.7`。Bearer 存在**仓库外**的 `.env.local`(被 `*.local` gitignore)；浏览器经 Vite `/aiproxy` 同源代理转发(网关无 CORS 头,直连会被拦)。换网关只改 `.env.local`。
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
| `kernel/processes.svelte.ts` | 内核进程表（`persisted` → 会话还原）+ `launch/close/focus/minimize/restore/toggleMaximize/setBounds/activeId/cycleWindows`；进程含 `data` 启动参数 |
| `kernel/persist.svelte.ts` | `persisted()` 自动存盘 helper（`$state`+`$effect.root`+`$state.snapshot`+**防抖**+数组支持）+ storage 抽象接口 |
| `kernel/vfs.svelte.ts` | 虚拟文件系统：inode 风格扁平节点表（parentId 串树）+ `persisted` 持久化 + CRUD（children/createDir/createFile/rename/`move`(防环)/pathSegments…）+ 回收站（`trash`/`restoreFromTrash`/`purge`/`emptyTrash`，`parentId='trash'` 哨兵） |
| `system/theme.svelte.ts` | 把设置算成 CSS token，`applyTokens()` 写进 `:root` |
| `system/settings.svelte.ts` | 用户设置（持久化）+ 主色预设 |
| `system/wallpaper.ts` | 壁纸预设（CSS 渐变） |
| `system/ai.ts` | AI 引擎 **双协议**：`provider` 分 anthropic(SDK 懒加载,浏览器直连) / openai(纯 fetch + SSE,兼容 minimax 等)。`runAgent`(带工具 agent loop,驱动系统) + `complete`(单轮补全,给各 App 内嵌 AI 用)。处理推理模型的 `reasoning_content`、可中断(AbortSignal)。dev 挂 `window.__qzAi` |
| `system/assistantChat.svelte.ts` | 助手对话(`persisted` → 关窗/刷新不丢)，含 `reasoning`(思考过程) |
| `lib/markdown.ts` | 极简安全 Markdown→HTML(先转义再套标签，AI 回复渲染用) |
| `system/aiTools.ts` | 能力工具：`TOOL_DEFS` + `executeTool`（launch_app/list_apps/VFS CRUD/set_theme → 真驱动系统）。dev 期挂 `window.__qzExec` 便于测 |
| `system/aiConfig.svelte.ts` | AI 配置（持久化）：provider + key + baseURL + 模型 + 人设 + maxTokens；`AI_PRESETS`(一键预设) + 从 `.env.local` 的 `VITE_AI_*` 播种默认 |
| `vite.config.ts` | Vite 同源代理 `/aiproxy → 上游网关`(绕过浏览器 CORS,SSE 透传)；上游由 `VITE_AI_PROXY_TARGET` 配 |
| `system/appSdk.ts` | **App SDK 契约运行时**(D2 地基)：`buildSrcdoc`(用户代码 + 注入访客 SDK `window.qz`) + `handleGuestCall`(宿主端 RPC 闸：查 App 声明的能力 → 不在集合里一律拒 → 路由到 executeTool / `complete` AI → postMessage 回灌)。**能力声明**：`CAPABILITIES`(apps/files/theme/ai 四组,各映射到具体工具) + `capsToTools()`(声明 key→工具名集合,旧 App 无字段=全给)。用户 App 跑沙箱 iframe(`sandbox=allow-scripts`,无 same-origin),只能经 postMessage 调系统 |
| `system/studioDraft.svelte.ts` | 开发者 App 的代码草稿(`persisted`) + `STARTER_CODE` 示例(演示 qz.launchApp/setTheme/listApps/ask) |
| `shell/Window.svelte` | 窗口 chrome：拖/缩放(rAF 批处理)/最大化(CSS 铺满)/最小化/边缘吸附/开关动画/活动窗焦点边框；transform 定位 + `contain` |
| `lib/motion.ts` | 窗口开/关的 Svelte 自定义过渡 `pop`（只动 opacity + 独立 scale 属性，不碰 transform） |
| `shell/WindowControls.svelte` | 红绿灯：关 / 最小化 / 最大化 |
| `shell/TopBar.svelte` | 顶栏任务栏：每窗一个切换 chip（活动高亮/最小化淡显）+ 实时时钟 |
| `shell/snapState.svelte.ts` | 边缘吸附预览框的共享信号（Window 写、Desktop 画） |
| `shell/Dock.svelte` | 启动 + 在跑指示点 + 点击还原聚焦 |
| `shell/Desktop.svelte` | 壁纸 + 景深 + 顶栏 + 桌面图标 + 窗口层 + Dock + 右键菜单 + 全局快捷键；给 App 传 `data` 启动参数 |
| `shell/ContextMenu.svelte` / `shell/menu.svelte.ts` | 右键菜单组件 + 全局菜单状态(`openMenu`/`closeMenu`)。⚠️文件名小写 menu 避免和组件大写撞名(Windows) |
| `shell/DesktopIcons.svelte` / `shell/iconLayout.svelte.ts` | 桌面图标（拖动/双击/右键）+ 图标位置持久化 |
| `shell/Spotlight.svelte` / `shell/spotlightState.svelte.ts` | 命令面板（Ctrl/Cmd+K）：搜内置 App + **已装用户 App** + VFS 文件 + **「问 AI」入口**(选中→开助手并以 `data.ask` 自动提问)，方向键/Enter 启动 |
| `apps/appList.ts` | App 元数据(id/title/icon/尺寸/hidden)纯数据，不 import 组件 → 谁都能安全 import 不成环（aiTools 用它） |
| `apps/registry.ts` | 注册表 = `appList` 元数据 + 组件，组装成 `appId → AppDef{ ...meta, component }` |
| `apps/Assistant.svelte` | AI 助手 App：流式聊天(Markdown 渲染) + 工具 chip + 停止/清空 + 对话持久化 + 无 key 提示 + **`data.ask` 自动提问**(供 Spotlight 调) |
| `apps/Welcome.svelte` / `apps/Settings.svelte` | 欢迎 App / 设置 App（自定义闭环）。设置含 **AI 全配置**(provider 切换 + 一键预设 + key/地址/模型/人设) + **AI 配色**(一句话换肤,复用 set_theme 工具) |
| `apps/Files.svelte` / `apps/TextEdit.svelte` | 文件管理器（面包屑/网格/CRUD/右键 + **即时名字过滤** + **AI 语义搜索**(全盘文本内容,`complete` 返回 id 数组,过滤幻觉 id)）/ 记事本（绑定文件 content 自动存）。**记事本内嵌 AI**：润色/总结/续写/译英 → 流式进预览面板,可替换/追加/丢弃(不毁原文) |
| `apps/Calculator.svelte` / `apps/Clock.svelte` | 计算器（四则+链式+除零保护）/ 模拟时钟（SVG 指针 + `$effect` 定时器） |
| `apps/Sandbox.svelte` | 通用沙箱组件：把一段 code 跑进隔离 iframe + 架好宿主 RPC 闸(`e.source===contentWindow` 才收 → `handleGuestCall(win,e.data,caps)`)。收 `caps` prop 当能力白名单。Studio 预览 + 已装 UserApp 都复用。⚠️ 用 `setTimeout` 重建 iframe(rAF 在隐藏标签页会冻结) |
| `apps/Studio.svelte` | **开发者 App**（D2）：左 `<CodeMirror>`(语法高亮) + 右 `<Sandbox>` 实时预览 + ▶运行/**💾保存为 App**/**🔐能力声明栏**(勾选 apps/files/theme/ai,预览即按此放行)/SDK 说明。可被「我的 App」以 `data.editAppId` 唤起编辑现有 App |
| `apps/CodeMirror.svelte` / `lib/codemirror.ts` | CodeMirror 6 编辑器：组件做 `$bindable` 双向绑定 + 生命周期，`lib` 做装配(html 语言含内嵌 CSS/JS 高亮 + oneDark 主题)。**动态 import → 单独 chunk(gzip ~164KB)**，首次开「开发者」才下载，不进首屏 |
| `apps/userApps.svelte.ts` | 已安装用户 App 的持久库(`persisted`)：`UserApp{id,name,icon,code,w,h}` + `saveUserApp`(增/改) / `getUserApp` / `removeUserApp` |
| `apps/UserApp.svelte` | 通用宿主：`data.appId` → 查 `getUserApp` → `<Sandbox code>`。挂在隐藏 app id `userapp` 上，所有已装 App 共用它渲染 |
| `apps/AppGallery.svelte` | **「我的 App」启动器**(app id `myapps`,在 Dock)：列已装 App → 启动(launch `userapp` + `data.appId`)/编辑(开 Studio + `data.editAppId`)/删除/新建 |
| `apps/Trash.svelte` | 回收站：列出软删除项 + 还原 / 彻底删除 / 清空 |
| `app.css` | Tailwind v4 `@theme` token + `qz-glass` 玻璃工具类 |
| `App.svelte` | `$effect` 应用主题 + 首启动开 Welcome + 挂 `<Desktop/>` |

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
```

---

## 七、路线图（围绕四大方向：性能 / 丝滑 / 自由度 / 美观）

- ✅ **Phase A 地基**：内核重写 + 主题 token + 持久化 + 窗口管理(最小/最大化) + 设置 App。
- ✅ **Phase B 丝滑外壳**：顶栏任务栏 + 会话还原 + 边缘吸附 + 开关窗/最小化动画 + 键盘快捷键/焦点高亮。（性能 pass 推后到需要时再做。）
- 🚧 **Phase C App 平台 + VFS**（进行中）：✅ 虚拟文件系统(localStorage，可换 IndexedDB→OPFS/SQLite-WASM) + ✅ 文件管理器 + ✅ 记事本 + ✅ App 启动参数(`data`) + ✅ 拖拽移动文件 + ✅ 回收站；**待办**：契约式 App SDK(能力声明)。
- ✅ **打磨轮**（作者要求"专注完善当前系统"，⚠️**胡桃博客不在本项目内做**）：右键菜单系统 + 桌面图标 + 计算器/时钟 App + 主题编辑器(界面缩放/命名主题预设/JSON导入导出) + Spotlight + 文件拖拽移动 + 视觉手感 pass。
- 🚧 **Phase D 从 Demo 到平台**（作者反馈"现在像 PPT、自由度低"，点了三件底层大事）。**已拍板：先做 AI、AI 先浏览器直连**。
  - 🚧 **D1 AI 底层驱动**：✅ 统一 AI 客户端(`system/ai.ts`) **双协议**——anthropic(SDK 直连) + openai 兼容(纯 fetch+SSE,支持 minimax 等推理模型) + ✅ 工具调用驱动系统(`aiTools.ts`) + ✅ 助手 App 流式聊天(含思考过程折叠)。✅ **AI 织进各 App**：记事本(润色/总结/续写/译英)、设置(自然语言 AI 配色)、**Spotlight(问 AI)**、**文件语义搜索**。✅ 浏览器 CORS 用 Vite 同源代理 `/aiproxy` 解决(D0「AI 密钥代理」雏形)。**待办**：生产环境的真后端代理(目前 `/aiproxy` 仅 dev server 生效)。
  - **D0 地基**：VFS 二进制(localStorage→IndexedDB，给 Live2D 模型/图片/App 资源) + 最小 Node 后端(AI 密钥代理 + 同步)。
  - 🚧 **D2 App 开发平台**：✅ 契约式 App SDK(`appSdk.ts`：沙箱 iframe + postMessage RPC + 能力白名单 → 复用 executeTool/AI) + ✅ 开发者 App(`Studio.svelte`) + ✅ **写好的 App 存成命名 App 装进系统**(`userApps`/`Sandbox`/`UserApp`/`AppGallery`)——保存→进「我的 App」启动器+Spotlight→反复启动→刷新还在。**实测全闭环通过**：写代码→保存为 App→画廊启动→沙箱内 `qz.launchApp` 真驱动系统→持久化。✅ 编辑器升级 **CodeMirror 6**(语法高亮 + 行号 + 折叠，懒加载单独 chunk)。✅ **能力声明 + 强制**(`CAPABILITIES` 四组；Studio 勾选→存进 `UserApp.caps`→宿主按声明放行/拒绝，实测同代码不同声明结果不同；画廊显示每 App 能力)。**待办**：把用户 App 单独钉进 Dock(每 App 独立 appId)；胡桃博客以后也走 iframe 嵌。
  - **D3 Live2D 伙伴**：pixi-live2d-display + PixiJS 桌宠(需 D0 二进制 VFS)，绑定 D1 的 AI 成为助手的"脸"。
  - **D4 真·平台化**：后端账号/同步、Module Federation 第三方分发、Docker 自托管 + 在线版、每 App 主题/自定义 CSS。

---

## 八、与作者协作的方式（重要）

- 作者背景：**Web 前端 + Java**，**Svelte 是新学的、不懂底层**。
- **边做边教**：每引入一个 Svelte 5 新概念都要讲清楚、关键处让作者动手，不要只甩代码。
- 已教过的 Svelte 5 概念：`$state`（组件内 + `.svelte.ts` 全局共享状态）、`$props()`、**小写事件属性**(`onclick`/`onpointerdown`)、`{#each}+{@const}+<Comp/>`(动态组件)、`{@render children()}`(snippet 插槽)、`$derived`(派生状态)、`$effect`(副作用，如写 CSS token)、**`$effect` 清理函数**(`return () => clearInterval`，如顶栏时钟)、`$effect.root`(模块级 effect 作用域)、`$state.snapshot`(序列化前把代理拍平)、自定义 rune helper(`persisted()`，含防抖写盘)、**Svelte 自定义过渡**(`in:`/`out:` + `css` 函数；用独立 `scale` 属性避开 `transform` 冲突)、**`<svelte:window>`**(全局键盘监听)、跨模块复用的 `$derived`/纯函数(`activeId()`)、`$state` 对象的属性级 reactivity（`Object.values()` 也追踪键增删）、**把进程改动收归内核 setter**(`setBounds`——子组件别直接改 prop，否则 Svelte 报 `ownership_invalid_mutation`)、注意**循环 import**（Files 别 import registry）。
- ⚠️ 注意：Phase A 这批代码是「我写、边写边注释讲解」产出的，**还没有真正让作者动手写过**。下个阶段要落实"关键处让作者动手"。
- 每个阶段都要产出**能跑、能用、好看**的东西（作者很看重美观与手感）。

## 九、待决策
1. 是否 `git push -u origin main`（push 未授权，先问；已攒 11 个 commit）。
2. 下一步方向：继续打磨/小 App（图片查看器需 VFS 存二进制、Markdown 预览、文件拖拽移动+回收站）/ 契约式 App SDK / 深度自定义(主题编辑器)。**胡桃博客 iframe 不在本项目做**。
