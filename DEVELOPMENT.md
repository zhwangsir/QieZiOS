# DEVELOPMENT.md — QieZiOS

> 合并自旧 PROJECT_INIT / docs / 根目录散文档。原文在 `ALLProject/.archive/docs-legacy-20260827/`。
> 最后更新：2026-08-27

# 原 PROJECT_INIT

# QieZiOS · 项目初始化文档

> 由项目管理中枢自动生成 | 更新日期: 2026-07-12 | 负责人: zhwangsir

## 一、项目基本信息

| 字段 | 值 |
|------|----|
| 项目名称 | QieZiOS（Web OS / 网页桌面系统） |
| 当前版本 | 0.0.0（package.json 占位；实际 Phase A-H + 5 轮 Polish 全部完成） |
| 创建日期 | 2026（Svelte 5 + Vite 8 工程基线） |
| 负责人 | zhwangsir |
| 项目路径 | /Users/wangzhenyu/Desktop/ALLProject/QieZiOS |
| 远程仓库 | https://github.com/zhwangsir/QieZiOS.git |
| 仓库可见性 | 公开（public） |
| 线上地址 | （Docker 自托管，默认端口 8787；无固定线上域名） |

## 二、项目概述与核心功能

### 2.1 项目定位
QieZiOS 是一个运行于浏览器的 **Web OS / 网页桌面系统**，参照 Puter / daedalOS 的形态，采用**微内核思想**的四层架构（kernel / system / shell / apps）。所有数据本地化（IndexedDB VFS + Blob Store），AI 能力通过同源代理接入 Anthropic + OpenAI 兼容双协议。定位为可在浏览器中体验完整桌面操作系统的「网页桌面」。

### 2.2 核心功能列表
- **微内核四层架构**：
  - `kernel/`：blobStore / bus / idbStore / log / persist / processes / services / vfs（VFS 基于 IndexedDB）
  - `system/`：30+ 系统服务（account / ai / aiConfig / aiTools / appPrefs / appRepo / appSdk / assistantChat / clipboard / companion / dnd / dockPrefs / jobs / notifications / permissions / pet / recents / schedules / services / settings / shellPrefs / sound / studioDraft / sync / sys / theme / themePresets / users / vfsVirtual / viewport / wallpaper）
  - `shell/`：Desktop / Dock / TopBar / Spotlight / Launchpad / Expose / Notifications / ContextMenu / QuickSettings / Shortcuts / Window / WindowControls / StickyNotes / Widgets / DesktopIcons / DesktopPet
  - `apps/`：20+ 内置应用（Calculator / Clipboard / Clock / CodeMirror / Companion / Files / ImageViewer / MediaViewer / Reminders / Sandbox / Screenshot / Settings / Studio / SysMonitor / Terminal / TextEdit / Trash / UserApp / WebAppGallery / WebView / Welcome / AppGallery / AppStore / Assistant）
- **AI 双协议**：Anthropic（@anthropic-ai/sdk）+ OpenAI 兼容（走 `/aiproxy` 同源代理），含 aiTools 工具调用、assistantChat 助手、companion 陪伴、studioDraft 创作
- **VFS**：IndexedDB 虚拟文件系统 + blobStore 二进制存储 + vfsVirtual 虚拟挂载
- **Shell 引擎**：Terminal + coreutils（lib/shell.ts + lib/man.ts）+ CodeMirror 6 编辑器
- **Live2D 桌宠**：pixi-live2d-display 0.4 + DesktopPet + lib/motion.ts + lib/live2d.ts
- **窗口管理**：Window / WindowControls / snapState / Expose 缩略图
- **跨设备同步**：按 token 存 sync-store.json 文件快照（8MB 上限），通过 `/sync/<token>` 端点
- **账号体系**：注册/登录（sha256 无盐密码 + 随机 token 会话，功能优先，安全待硬化）
- **多主题**：theme / themePresets 切换
- **桌面小组件**：Widgets / StickyNotes / Notifications
- **应用商店**：AppGallery / AppStore / WebAppGallery（用户应用 + Web 应用 + 内置应用注册表）

### 2.3 目标用户
- 想在浏览器中体验完整桌面 OS 形态的极客用户
- 需要一个可自托管的「网页桌面」作为个人工作台 / AI 助手入口的用户
- 对 Web OS 架构（微内核 + VFS + Shell + Apps）感兴趣的开发者

## 三、技术架构

### 3.1 技术栈
- 框架：Svelte 5.55（**runes 信号模式**）+ SvelteKit 的 Vite 插件（非完整 SvelteKit，仅 SPA）
- 构建：Vite 8.0
- 语言：TypeScript 6.0 + svelte-check 4.4
- 样式：Tailwind CSS v4.3（@tailwindcss/vite 插件）
- 编辑器：CodeMirror 6（commands / language / state / view / lang-html / theme-one-dark）
- Live2D：pixi-live2d-display 0.4 + pixi.js 6.5
- AI：@anthropic-ai/sdk 0.104（Anthropic 官方 SDK，OpenAI 兼容走自实现 fetch）
- 生产后端：Node.js 22（`server/index.mjs`，**零依赖**，仅用 node:http / node:https / node:fs / node:crypto / node:url 内置模块）
- 容器化：Docker（多阶段构建 node:22-alpine）+ docker-compose
- 包管理：npm（package-lock.json）

### 3.2 架构说明
**前端 SPA**（`src/`）：
- 入口 `index.html` → `src/main.ts` → `src/App.svelte`
- 微内核四层：`kernel/`（持久化 + 进程 + 总线 + VFS）→ `system/`（系统服务）→ `shell/`（桌面环境）→ `apps/`（应用）
- 所有 `.svelte.ts` 文件使用 Svelte 5 runes 信号模式（非传统 store）
- VFS 数据全部存 IndexedDB（idbStore）+ Blob Store（二进制大文件）
- AI 请求走 `/aiproxy/*` 同源路径（避免浏览器直连第三方网关的 CORS 限制）

**生产后端**（`server/index.mjs`）：
- 零运行时依赖，仅用 Node 内置模块
- 托管 `dist/` 静态资源（SPA 回退到 index.html）
- 反代 `/aiproxy/*` → 上游 AI 网关（`AI_PROXY_TARGET`，默认 https://dgmt.top），支持 SSE 流式透传
- 可选服务端注入 Bearer（设 `AI_KEY` 后客户端可不再持有 key）
- `/sync/<token>` 跨设备同步（GET 取 / PUT POST 存，8MB 上限，文件持久化）
- `/auth/*` 账号体系（注册/登录，sha256 无盐密码 + token 会话，明文存文件，功能优先）

**dev vs prod**：
- dev：Vite dev server 代理 `/aiproxy` → `VITE_AI_PROXY_TARGET`（默认 dgmt.top），`/auth` + `/sync` → `VITE_BACKEND_TARGET`（默认 http://localhost:8787，需另跑 `node server/index.mjs`）
- prod：`node server/index.mjs` 同时提供静态资源 + 反代 + 同步 + 账号

### 3.3 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| svelte | ^5.55.5 | UI 框架（runes 信号模式） |
| vite | ^8.0.12 | 构建工具 |
| @sveltejs/vite-plugin-svelte | ^7.1.2 | Svelte Vite 插件 |
| tailwindcss | ^4.3.1 | 原子化 CSS（v4） |
| @tailwindcss/vite | ^4.3.1 | Tailwind v4 Vite 插件 |
| typescript | ~6.0.2 | 类型系统 |
| svelte-check | ^4.4.8 | Svelte 类型检查 |
| @anthropic-ai/sdk | ^0.104.2 | Anthropic Claude SDK |
| pixi-live2d-display | ^0.4.0 | Live2D 桌宠渲染 |
| pixi.js | ^6.5.10 | WebGL 渲染 |
| @codemirror/view | ^6.43.3 | CodeMirror 6 编辑器视图 |
| @codemirror/state | ^6.7.0 | CodeMirror 状态管理 |
| @codemirror/commands | ^6.10.4 | CodeMirror 命令 |
| @codemirror/language | ^6.12.4 | CodeMirror 语言支持 |
| @codemirror/lang-html | ^6.4.11 | CodeMirror HTML 语法 |
| @codemirror/theme-one-dark | ^6.1.3 | CodeMirror 暗色主题 |
| @types/node | ^24.12.3 | Node 类型（server 端） |

## 四、目录结构

```
QieZiOS/
├── src/                             # 前端源码（Svelte 5 SPA）
│   ├── kernel/                      # 微内核层
│   │   ├── blobStore.ts             # 二进制 Blob 存储
│   │   ├── bus.svelte.ts            # 事件总线（runes 信号）
│   │   ├── idbStore.ts              # IndexedDB 封装
│   │   ├── log.svelte.ts            # 日志
│   │   ├── persist.svelte.ts        # 持久化
│   │   ├── processes.svelte.ts      # 进程管理
│   │   ├── services.svelte.ts       # 服务注册
│   │   └── vfs.svelte.ts            # 虚拟文件系统（IndexedDB）
│   ├── system/                      # 系统服务层（30+ 模块）
│   │   ├── account.svelte.ts        # 账号
│   │   ├── ai.ts / aiConfig.svelte.ts / aiTools.ts  # AI 能力
│   │   ├── assistantChat.svelte.ts  # AI 助手对话
│   │   ├── companion.svelte.ts      # 陪伴
│   │   ├── appPrefs / appRepo / appSdk  # 应用管理
│   │   ├── clipboard / dnd / dockPrefs / shellPrefs  # 偏好
│   │   ├── jobs / schedules / notifications / recents  # 任务/通知
│   │   ├── permissions / users / sys  # 权限/用户/系统
│   │   ├── theme / themePresets / wallpaper / viewport  # 主题/壁纸/视口
│   │   ├── pet.svelte.ts            # 桌宠
│   │   ├── sound.ts                 # 音效
│   │   ├── studioDraft.svelte.ts    # Studio 草稿
│   │   ├── sync.ts                  # 跨设备同步
│   │   ├── vfsVirtual.ts            # 虚拟挂载
│   │   └── services.ts / settings.svelte.ts
│   ├── shell/                       # 桌面环境层
│   │   ├── Desktop.svelte / DesktopIcons.svelte / DesktopPet.svelte
│   │   ├── Dock.svelte / TopBar.svelte
│   │   ├── Spotlight.svelte / Launchpad.svelte / Expose.svelte
│   │   ├── Notifications.svelte / QuickSettings.svelte / Shortcuts.svelte
│   │   ├── ContextMenu.svelte / Widgets.svelte / StickyNotes.svelte
│   │   ├── Window.svelte / WindowControls.svelte
│   │   └── *State.svelte.ts（expose / iconLayout / launchpad / menu / notes /
│   │                         shortcuts / snap / spotlight / widget 状态）
│   ├── apps/                        # 应用层（20+ 内置应用）
│   │   ├── AppGallery.svelte / AppStore.svelte / WebAppGallery.svelte
│   │   ├── Assistant.svelte / Companion.svelte
│   │   ├── Calculator.svelte / Clipboard.svelte / Clock.svelte
│   │   ├── CodeMirror.svelte / TextEdit.svelte / Terminal.svelte
│   │   ├── Files.svelte / ImageViewer.svelte / MediaViewer.svelte
│   │   ├── Reminders.svelte / Screenshot.svelte / SysMonitor.svelte
│   │   ├── Settings.svelte / Studio.svelte / Sandbox.svelte
│   │   ├── Trash.svelte / UserApp.svelte / WebView.svelte / Welcome.svelte
│   │   └── appList.ts / appShare.ts / registry.ts
│   │       + desktopApps / userApps / webApps.svelte.ts
│   ├── lib/                         # 工具库
│   │   ├── calc.ts / codemirror.ts / image.ts
│   │   ├── live2d.ts / motion.ts    # Live2D + motion
│   │   ├── man.ts / shell.ts        # coreutils man + shell 引擎
│   │   ├── markdown.ts              # Markdown 渲染
│   │   └── winctx.ts                # 窗口上下文
│   ├── App.svelte                   # 根组件
│   ├── app.css                      # 全局样式（Tailwind v4 入口）
│   └── main.ts                      # 入口
├── server/                          # 生产后端（零依赖）
│   └── index.mjs                    # Node 内置模块实现的 HTTP 服务
├── public/                          # 静态资源
│   ├── apps.json                    # 应用清单
│   ├── favicon.svg / icons.svg
├── .claude/launch.json              # Claude Code 配置
├── .vscode/extensions.json          # VS Code 推荐扩展
├── Dockerfile                       # 多阶段构建 node:22-alpine
├── docker-compose.yml               # qz-sync volume 持久化同步
├── .dockerignore / .gitignore
├── CLAUDE.md                        # Claude Code 工程上下文（超长文档）
├── DEVPLAN-POLISH.md                # 完善轮 1
├── DEVPLAN-POLISH-2.md ~ -5.md      # 完善轮 2-5
├── DEVPLAN-PERF.md                  # 性能阶段
├── DEVPLAN-LINUX.md                 # Linux 适配
├── index.html                       # SPA 入口
├── svelte.config.js                 # 空配置 export default {}
├── vite.config.ts                   # /aiproxy + /auth + /sync 代理
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── package.json                     # qiezios v0.0.0
├── package-lock.json
└── README.md
```

### 关键文件功能说明

| 文件 | 功能 |
|------|------|
| `src/main.ts` | 前端入口，挂载 App.svelte |
| `src/App.svelte` | 根组件，组合 shell + apps |
| `src/kernel/vfs.svelte.ts` | 虚拟文件系统（IndexedDB） |
| `src/kernel/idbStore.ts` | IndexedDB 封装 |
| `src/kernel/blobStore.ts` | 二进制 Blob 存储 |
| `src/kernel/processes.svelte.ts` | 进程管理（应用生命周期） |
| `src/kernel/services.svelte.ts` | 服务注册表 |
| `src/system/ai.ts` | AI 能力核心（Anthropic + OpenAI 兼容） |
| `src/system/aiTools.ts` | AI 工具调用 |
| `src/system/account.svelte.ts` | 账号体系 |
| `src/system/sync.ts` | 跨设备同步 |
| `src/system/theme.svelte.ts` | 主题 |
| `src/shell/Desktop.svelte` | 桌面根 |
| `src/shell/Window.svelte` | 窗口组件 |
| `src/shell/Spotlight.svelte` | Spotlight 搜索 |
| `src/shell/Dock.svelte` | Dock 栏 |
| `src/apps/registry.ts` | 应用注册表 |
| `src/apps/Terminal.svelte` | 终端应用 |
| `src/apps/Files.svelte` | 文件管理器 |
| `src/apps/CodeMirror.svelte` | 代码编辑器 |
| `src/lib/shell.ts` | Shell 引擎 |
| `src/lib/man.ts` | coreutils man 手册 |
| `src/lib/live2d.ts` | Live2D 加载 |
| `server/index.mjs` | 生产后端（静态托管 + /aiproxy 反代 + /sync + /auth） |
| `vite.config.ts` | dev 代理配置 |
| `Dockerfile` | 多阶段构建（build → 运行只复制 dist + server） |
| `docker-compose.yml` | qz-sync volume 持久化 |
| `CLAUDE.md` | Claude Code 工程上下文（架构 / 红线 / 模式） |
| `DEVPLAN-POLISH.md` ~ `-5.md` | 5 轮完善计划 |
| `DEVPLAN-PERF.md` | 性能优化计划 |
| `public/apps.json` | 内置应用清单 |

## 五、环境搭建

### 5.1 前置环境要求
- Node.js ≥ 22（Dockerfile 用 node:22-alpine）
- npm（package-lock.json）
- 浏览器：现代浏览器（支持 IndexedDB + Svelte 5 runes + Tailwind v4）
- 可选：Docker + Docker Compose（生产部署）
- 可选：上游 AI 网关（默认指向 https://dgmt.top，可通过 `AI_PROXY_TARGET` 覆盖）

### 5.2 依赖安装步骤
```bash
cd /Users/wangzhenyu/Desktop/ALLProject/QieZiOS
npm ci                # 安装依赖（package-lock.json）
# 或
npm install
```

### 5.3 环境变量配置
QieZiOS **无 `.env.example`**，环境变量分两层：

**dev 模式**（Vite，前缀 `VITE_`）：
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_AI_PROXY_TARGET` | `https://dgmt.top` | dev 下 `/aiproxy` 代理目标 |
| `VITE_BACKEND_TARGET` | `http://localhost:8787` | dev 下 `/auth` + `/sync` 代理目标 |

**prod 模式**（`server/index.mjs`，无前缀）：
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8787` | 服务监听端口 |
| `AI_PROXY_TARGET` | `https://dgmt.top` | 上游 AI 网关 |
| `AI_KEY` | （空） | 设了则服务端注入 Bearer，客户端不再持有 key |
| `SYNC_FILE` | `server/sync-store.json` | 跨设备同步快照文件路径（Docker 指到挂载卷） |
| `ACCT_FILE` | `server/accounts-store.json` | 账号存储文件路径 |

可在项目根创建 `.env.local`（dev）或通过 docker-compose environment / docker run -e 注入（prod）。

## 六、启动与运行

### 6.1 开发模式启动
```bash
# 前端 dev server（Vite，默认端口 5173）
npm run dev

# 【可选】本地后端（端口 8787，提供 /auth + /sync，dev 代理会指向它）
node server/index.mjs
# 或
npm run serve

# 类型检查
npm run check      # svelte-check + tsc

# 预览生产构建
npm run preview
```

dev 模式下，`/aiproxy/*` 由 Vite 代理转发到 `VITE_AI_PROXY_TARGET`；`/auth/*` 与 `/sync/*` 由 Vite 代理转发到 `VITE_BACKEND_TARGET`（默认 http://localhost:8787）。本地后端没跑时这两路会连接失败（功能降级，不影响其它）。

### 6.2 生产构建
```bash
npm run build       # Vite 构建，产物在 dist/

# 启动生产后端（同时托管 dist + 反代 + 同步 + 账号）
node server/index.mjs
# 或
npm run serve
```

### 6.3 部署方式

**Docker 部署（推荐）**：
```bash
docker compose up -d --build
# 或
docker build -t qiezios .
docker run -d -p 8787:8787 \
  -e AI_PROXY_TARGET=https://dgmt.top \
  -e AI_KEY=your_key \
  -v qz-sync:/data \
  qiezios
```

Dockerfile 多阶段构建：
- **build 阶段**：node:22-alpine，`npm ci` + `npm run build`
- **运行阶段**：node:22-alpine，只复制 `dist/` + `server/`，`ENV PORT=8787`，`ENV SYNC_FILE=/data/sync-store.json`，`VOLUME ["/data"]`，`CMD ["node", "server/index.mjs"]`

docker-compose.yml：
- 端口 8787:8787
- 环境变量：PORT / AI_PROXY_TARGET（可选 AI_KEY）
- `qz-sync` volume 挂载到 `/data` 持久化同步快照
- `restart: unless-stopped`

**裸机部署**：
```bash
npm ci && npm run build
PORT=8787 AI_PROXY_TARGET=https://dgmt.top node server/index.mjs
```
建议前置 nginx 做 HTTPS 终止 + gzip。

## 七、主要接口说明

QieZiOS 生产后端（`server/index.mjs`，端口 8787）提供以下 HTTP 端点：

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` 与静态资源 | GET | 托管 `dist/`，SPA 回退到 index.html |
| `/aiproxy/*` | GET / POST / ... | 反代到 `AI_PROXY_TARGET`，透传 SSE 流式响应；设了 `AI_KEY` 则注入 Bearer |
| `/sync/<token>` | GET | 取该 token 的同步快照（JSON） |
| `/sync/<token>` | PUT / POST | 存该 token 的同步快照（8MB 上限，覆盖式） |
| `/auth/register` | POST | 注册账号（sha256 无盐密码） |
| `/auth/login` | POST | 登录，返回随机 token 会话 |
| `/auth/*` | 其他 | 账号数据读写 |

**前端模块接口**（Svelte 5 runes 信号，非 HTTP）：
- `src/system/ai.ts`：AI 调用入口（Anthropic + OpenAI 兼容）
- `src/system/aiTools.ts`：AI 工具调用
- `src/kernel/vfs.svelte.ts`：VFS 文件读写 API
- `src/apps/registry.ts`：应用注册表（供 Dock / Launchpad / Spotlight 查询）
- `src/lib/shell.ts`：Shell 命令解析引擎

**AI 协议**：
- Anthropic：通过 `@anthropic-ai/sdk`，走 `/aiproxy` 同源代理
- OpenAI 兼容：自实现 fetch，走 `/aiproxy` 同源代理
- 双协议统一抽象在 `src/system/ai.ts`

## 八、已知问题与注意事项

- **账号体系安全待硬化**：sha256 无盐密码 + 明文存文件 + token 不过期，仅适合单机自托管，**生产前必须硬化**（加盐慢哈希 + 限流 + HTTPS + token 过期）
- **跨设备同步无鉴权**：靠 token 当密钥，知道 token 即可读写，**不可暴露在公网无 HTTPS**
- **`AI_KEY` 注入**：设了 `AI_KEY` 后服务端会注入 Bearer，但客户端仍可能通过浏览器 devtools 看到 `/aiproxy` 请求；真正隔离需在后端做完整代理 + 用户级 key 管理
- **package.json version=0.0.0**：Vite 默认占位，实际完成度见 `CLAUDE.md`（Phase A-H + 5 轮 Polish + 性能阶段全部完成）
- **svelte.config.js 为空**：`export default {}`，所有配置在 `vite.config.ts`
- **Live2D 模型需自备**：pixi-live2d-display 不带模型，用户需自行准备 .model3.json
- **VFS 数据在浏览器**：IndexedDB 数据不跨浏览器 / 不跨设备，跨设备需走 `/sync` 端点
- **dev 后端可选**：dev 模式下若不跑 `node server/index.mjs`，`/auth` + `/sync` 会失败，但其它功能（桌面 + 应用 + AI）正常
- **Phase 状态**：Phase A-H + DEVPLAN-POLISH 1-5 + DEVPLAN-PERF + DEVPLAN-LINUX 均已规划/完成，详见各 DEVPLAN-*.md
- **零运行时依赖后端**：`server/index.mjs` 不引任何 npm 包，仅用 Node 内置模块，升级 Node 版本几乎无破坏风险

## 九、与其他项目的关系

- **与 DRT-BOT 独立**：DRT-BOT 是 Electron 桌面硅基生命容器，QieZiOS 是浏览器 Web OS，两者无代码依赖，架构思路不同（Electron 三进程 vs 浏览器微内核四层）
- **与 LUVU 独立**：LUVU 是 Electron 桌面 AI 伴侣，与 QieZiOS 无代码依赖
- **与 QieYu 独立**：QieYu 是 AI 学习日志社交平台（React 19 + Express + MySQL），与 QieZiOS 无代码依赖；两者均为 Web 应用但定位完全不同（Web OS vs 学习日志社交）
- **AI 网关共享**：QieZiOS 默认 `AI_PROXY_TARGET=https://dgmt.top`，与 dgmt-next 项目（DGMT 官网）同属 dgmt.top 域名生态，但代码独立
- **项目隔离原则**：四个项目（DRT-BOT / LUVU / QieZiOS / QieYu）必须保持独立，禁止交叉引用代码或共享依赖


## 已归档文档索引

- `CLAUDE.md` — QieZiOS 🍆 — 项目承接文档
- `DEVPLAN-LINUX.md` — QieZiOS 对标 Linux · 开发计划（自治循环的真相源）
- `DEVPLAN-PERF.md` — QieZiOS 性能 / 存储硬化阶段（DEVPLAN-PERF · 自治循环真相源）
- `DEVPLAN-POLISH-2.md` — QieZiOS 完善与查漏计划 · 第 2 轮（自治完善循环的真相源）
- `DEVPLAN-POLISH-3.md` — QieZiOS 完善与查漏计划 · 第 3 轮（自治完善循环真相源）
- `DEVPLAN-POLISH-4.md` — QieZiOS 完善与查漏计划 · 第 4 轮（自治完善循环真相源）
- `DEVPLAN-POLISH-5.md` — QieZiOS 完善与查漏计划 · 第 5 轮（自治完善循环真相源）
- `DEVPLAN-POLISH.md` — QieZiOS 完善与查漏计划（自治完善循环的真相源）
- `DEVPLAN-UIUX.md` — UI/UX 调研报告：参考站 macos27.kimi.page vs QieZiOS
- `Gitee上传方法.md` — Gitee 上传方法（全项目统一）
- `PROJECT_INIT.md` — QieZiOS · 项目初始化文档
- `设备说明.md` — 集群设备说明（单一真相源）
