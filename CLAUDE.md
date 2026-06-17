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
- **状态**：已 **push 到 `origin/main`（同步）**。包含 Phase A `3aba79d`、Phase B、Phase C VFS `06847ec`、打磨①②③④、回收站 `8cd017e`、Spotlight 命令面板。**作者已给全部授权 → 可自由 commit + push，不再每次问**。
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

src 已全部重写。能力：开/拖/缩放/关窗口、最小化（Dock 或顶栏找回）、最大化/还原（双击标题栏也行）、多窗叠放、点击置顶；**边缘吸附**（拖到左/右/上边缘 → 半屏/最大化，带预览框）；**开关窗 + 最小化动画**（缩放淡入淡出）；**键盘快捷键**（Esc 关窗 / Ctrl·Cmd+M 最小化 / Alt+\` 轮换窗口）+ **活动窗焦点高亮**（主色边框）；**顶栏任务栏**（每窗一个切换 chip + 实时时钟）；**设置 App 实时改 主色/明暗/圆角/模糊/透明度/界面缩放/壁纸，并能保存命名主题预设(应用/删除) + JSON 导入导出**；**虚拟文件系统 + 文件管理器 + 记事本**（新建/重命名/删除/**拖拽移动**/进文件夹/双击文本文件编辑，内容自动存）；**右键菜单**（桌面/窗口标题栏/文件项/Dock 各有菜单）；**桌面图标**（VFS 根目录的项，双击打开、拖动排列、位置持久化）；**计算器 + 模拟时钟 App**；**回收站**（删除=软删除，可还原/彻底删除/清空）；**Spotlight 命令面板**（Ctrl·Cmd+K 搜索启动 App + 打开文件）；Dock 悬停放大、细滚动条、文件类型图标、景深 vignette 等视觉打磨；**整套设置 + 窗口布局 + 文件 + 图标位置都持久化，刷新后原样还原**。换肤只改 CSS 变量 → 0 组件重渲染。

### 文件（`src/`）
| 文件 | 作用 |
|---|---|
| `kernel/processes.svelte.ts` | 内核进程表（`persisted` → 会话还原）+ `launch/close/focus/minimize/restore/toggleMaximize/setBounds/activeId/cycleWindows`；进程含 `data` 启动参数 |
| `kernel/persist.svelte.ts` | `persisted()` 自动存盘 helper（`$state`+`$effect.root`+`$state.snapshot`+**防抖**+数组支持）+ storage 抽象接口 |
| `kernel/vfs.svelte.ts` | 虚拟文件系统：inode 风格扁平节点表（parentId 串树）+ `persisted` 持久化 + CRUD（children/createDir/createFile/rename/`move`(防环)/pathSegments…）+ 回收站（`trash`/`restoreFromTrash`/`purge`/`emptyTrash`，`parentId='trash'` 哨兵） |
| `system/theme.svelte.ts` | 把设置算成 CSS token，`applyTokens()` 写进 `:root` |
| `system/settings.svelte.ts` | 用户设置（持久化）+ 主色预设 |
| `system/wallpaper.ts` | 壁纸预设（CSS 渐变） |
| `shell/Window.svelte` | 窗口 chrome：拖/缩放(rAF 批处理)/最大化(CSS 铺满)/最小化/边缘吸附/开关动画/活动窗焦点边框；transform 定位 + `contain` |
| `lib/motion.ts` | 窗口开/关的 Svelte 自定义过渡 `pop`（只动 opacity + 独立 scale 属性，不碰 transform） |
| `shell/WindowControls.svelte` | 红绿灯：关 / 最小化 / 最大化 |
| `shell/TopBar.svelte` | 顶栏任务栏：每窗一个切换 chip（活动高亮/最小化淡显）+ 实时时钟 |
| `shell/snapState.svelte.ts` | 边缘吸附预览框的共享信号（Window 写、Desktop 画） |
| `shell/Dock.svelte` | 启动 + 在跑指示点 + 点击还原聚焦 |
| `shell/Desktop.svelte` | 壁纸 + 景深 + 顶栏 + 桌面图标 + 窗口层 + Dock + 右键菜单 + 全局快捷键；给 App 传 `data` 启动参数 |
| `shell/ContextMenu.svelte` / `shell/menu.svelte.ts` | 右键菜单组件 + 全局菜单状态(`openMenu`/`closeMenu`)。⚠️文件名小写 menu 避免和组件大写撞名(Windows) |
| `shell/DesktopIcons.svelte` / `shell/iconLayout.svelte.ts` | 桌面图标（拖动/双击/右键）+ 图标位置持久化 |
| `shell/Spotlight.svelte` / `shell/spotlightState.svelte.ts` | 命令面板（Ctrl/Cmd+K）：搜 App 与 VFS 文件，方向键/Enter 启动 |
| `apps/registry.ts` | 注册表 `appId → { title, icon, component, width?, height?, hidden? }`（hidden 不进 Dock） |
| `apps/Welcome.svelte` / `apps/Settings.svelte` | 欢迎 App / 设置 App（自定义闭环） |
| `apps/Files.svelte` / `apps/TextEdit.svelte` | 文件管理器（面包屑/网格/CRUD/右键）/ 记事本（绑定文件 content 自动存，由 Files 用 `data` 启动） |
| `apps/Calculator.svelte` / `apps/Clock.svelte` | 计算器（四则+链式+除零保护）/ 模拟时钟（SVG 指针 + `$effect` 定时器） |
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
- ✅ **打磨轮**（作者要求"专注完善当前系统"，⚠️**胡桃博客不在本项目内做**）：右键菜单系统 + 桌面图标 + 计算器/时钟 App + 视觉手感 pass(Dock 放大/滚动条/文件图标/景深)。
- **Phase D 深度自定义 + 平台化**：主题编辑器/自定义 CSS/每 App 主题、Module Federation 第三方 App、Java/Node 后端(持久化/账号/同步)、WASM 终端、Docker 自托管 + 在线版。

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
