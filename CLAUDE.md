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
- **状态**：已提交到 `main`：Phase A `3aba79d`、Phase B-1 `0506c58`（会话还原+任务栏）、边缘吸附 `c41de81`；**开关窗/最小化动画 已完成（随本次一并提交）**。均**未 push**（作者未授权推送；推送前先问）。
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

## 五、当前进度：✅ Phase A + B-1 =「会自定义、记得住布局的丝滑桌面」

src 已全部重写。能力：开/拖/缩放/关窗口、最小化（Dock 或顶栏找回）、最大化/还原（双击标题栏也行）、多窗叠放、点击置顶；**边缘吸附**（拖到左/右/上边缘 → 半屏/最大化，带预览框）；**开关窗 + 最小化动画**（缩放淡入淡出）；**顶栏任务栏**（每窗一个切换 chip + 实时时钟）；**设置 App 实时改 主色/明暗/圆角/模糊/面板透明度/壁纸**；**整套设置 + 打开的窗口布局都持久化，刷新后原样还原（会话还原）**。换肤只改 CSS 变量 → 0 组件重渲染。

### 文件（`src/`）
| 文件 | 作用 |
|---|---|
| `kernel/processes.svelte.ts` | 内核进程表（`persisted` → 会话还原）+ `launch/close/focus/minimize/restore/toggleMaximize` |
| `kernel/persist.svelte.ts` | `persisted()` 自动存盘 helper（`$state`+`$effect.root`+`$state.snapshot`+**防抖**+数组支持）+ storage 抽象接口 |
| `system/theme.svelte.ts` | 把设置算成 CSS token，`applyTokens()` 写进 `:root` |
| `system/settings.svelte.ts` | 用户设置（持久化）+ 主色预设 |
| `system/wallpaper.ts` | 壁纸预设（CSS 渐变） |
| `shell/Window.svelte` | 窗口 chrome：拖/缩放(rAF 批处理)/最大化(CSS 铺满)/最小化/边缘吸附/开关动画；transform 定位 + `contain` |
| `lib/motion.ts` | 窗口开/关的 Svelte 自定义过渡 `pop`（只动 opacity + 独立 scale 属性，不碰 transform） |
| `shell/WindowControls.svelte` | 红绿灯：关 / 最小化 / 最大化 |
| `shell/TopBar.svelte` | 顶栏任务栏：每窗一个切换 chip（活动高亮/最小化淡显）+ 实时时钟 |
| `shell/snapState.svelte.ts` | 边缘吸附预览框的共享信号（Window 写、Desktop 画） |
| `shell/Dock.svelte` | 启动 + 在跑指示点 + 点击还原聚焦 |
| `shell/Desktop.svelte` | 壁纸 + 顶栏 + 窗口层(下移避顶栏、`isolate` 隔离层叠、画吸附预览) + Dock |
| `apps/registry.ts` | 注册表 `appId → { title, icon, component, width?, height? }` |
| `apps/Welcome.svelte` / `apps/Settings.svelte` | 欢迎 App / 设置 App（自定义闭环） |
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
- 🚧 **Phase B 丝滑外壳**（进行中）：✅ 顶栏任务栏 + ✅ 会话还原 + ✅ 边缘吸附 + ✅ 开关窗/最小化动画；**待办**：键盘焦点/Esc、性能 pass。
- **Phase C App 平台 + VFS**：契约式 App SDK(能力声明) + 虚拟文件系统(IndexedDB→OPFS/SQLite-WASM) + 文件管理器 + iframe 沙箱(把胡桃博客嵌成 App)。
- **Phase D 深度自定义 + 平台化**：主题编辑器/自定义 CSS/每 App 主题、Module Federation 第三方 App、Java/Node 后端(持久化/账号/同步)、WASM 终端、Docker 自托管 + 在线版。

---

## 八、与作者协作的方式（重要）

- 作者背景：**Web 前端 + Java**，**Svelte 是新学的、不懂底层**。
- **边做边教**：每引入一个 Svelte 5 新概念都要讲清楚、关键处让作者动手，不要只甩代码。
- 已教过的 Svelte 5 概念：`$state`（组件内 + `.svelte.ts` 全局共享状态）、`$props()`、**小写事件属性**(`onclick`/`onpointerdown`)、`{#each}+{@const}+<Comp/>`(动态组件)、`{@render children()}`(snippet 插槽)、`$derived`(派生状态)、`$effect`(副作用，如写 CSS token)、**`$effect` 清理函数**(`return () => clearInterval`，如顶栏时钟)、`$effect.root`(模块级 effect 作用域)、`$state.snapshot`(序列化前把代理拍平)、自定义 rune helper(`persisted()`，含防抖写盘)、**Svelte 自定义过渡**(`in:`/`out:` + `css` 函数；用独立 `scale` 属性避开 `transform` 冲突)。
- ⚠️ 注意：Phase A 这批代码是「我写、边写边注释讲解」产出的，**还没有真正让作者动手写过**。下个阶段要落实"关键处让作者动手"。
- 每个阶段都要产出**能跑、能用、好看**的东西（作者很看重美观与手感）。

## 九、待决策
1. 是否 `git push -u origin main`（push 未授权，先问）。
2. Phase B 下一项先做哪个：开关窗动画(View Transitions) / 键盘焦点 + Esc / 性能 pass。
