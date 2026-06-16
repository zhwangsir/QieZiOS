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
- **状态**：P0 已**本地提交**（commit `c174f71` + 本文件提交），**尚未 push**（作者未授权推送；新会话要推送前先问）。
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

**小内核 + 万物皆 App（微内核思想）**：

```
进程表(内核状态)  ──遍历──►  Desktop  ──按 appId 查──►  registry(appId→组件)  ──塞进──►  Window  ──渲染──►  App(组件)
                                  Dock  ──遍历 registry──►  每个 App 一个启动按钮
```

一句话：**进程 = state 里的一个对象；窗口 = 把进程渲染成可拖拽的容器；App = 一个组件；加新 App = 往注册表登记一条。**

---

## 五、当前进度：✅ P0 完成 =「会动的最小桌面」

可开/拖/缩放/关窗口、多窗口叠放、Dock 启动 App、点击置顶。

### 文件（`src/`）
| 文件 | 作用 |
|---|---|
| `kernel/processes.svelte.ts` | **内核状态**：`processes = $state([])` + `launch/close/focus` |
| `apps/Hello.svelte` | 示例 App（就是个普通组件） |
| `apps/registry.ts` | App 注册表 `appId → { title, icon, component }` |
| `lib/Window.svelte` | 窗口：标题栏拖拽、右下角缩放、transform 定位、z-index 叠放 |
| `lib/Desktop.svelte` | 桌面外壳：壁纸 + 遍历进程渲染窗口 + 底部 Dock |
| `App.svelte` | 只渲染 `<Desktop/>` |
| `lib/Counter.svelte`、`assets/*` | 脚手架残留 demo，未使用，**可删** |

### 验证状态
- `npm run build` ✅ 干净通过（JS ~43KB / gzip 17KB）。`npm run dev` 在 **5173** 验证过 HTTP 200、标题正确。
- ⚠️ 之前后台的 dev server 进程已退出（疑似受预览工具干扰）——直接 `npm run dev` 重启即可。

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

## 七、路线图

- ✅ **P0 地基**：内核(进程) + 可拖窗口 + Hello App + Dock。
- **P1 外壳**（下一步）：任务栏(显示/切换已开窗口)、窗口最小化/最大化、再加 1–2 个 App(如"设置"换壁纸)、键盘焦点/Esc 关闭。
- **P2 App 平台 + VFS**：契约式 App SDK + iframe/Module Federation 沙箱 + 虚拟文件系统(IndexedDB→OPFS/SQLite-WASM) + 文件管理器 App。
- **P3 权限 + 后端**：能力权限体系 + Java/Node 后端(持久化/账号/多端同步)。
- **P4 深度 + 风格**：主题系统、把胡桃博客做成 App(iframe)、嵌 WASM 跑真终端/Python、打包 Docker(自托管)+在线版。

---

## 八、与作者协作的方式（重要）

- 作者背景：**Web 前端 + Java**，**Svelte 是新学的、不懂底层**。
- **边做边教**：每引入一个 Svelte 5 新概念都要讲清楚、关键处让作者动手，不要只甩代码。
- 已教过的 Svelte 5 概念：`$state`（组件内 + `.svelte.ts` 全局共享状态）、`$props()`、**小写事件属性**(`onclick`/`onpointerdown`)、`{#each}+{@const}+<Comp/>`(动态组件)、`{@render children()}`(snippet 插槽)。
- 每个阶段都要产出**能跑、能用、好看**的东西（作者很看重美观与手感）。

## 九、待决策
1. 是否 `git push -u origin main`（作者未授权，先问）。
2. P1 的具体范围与先后。
