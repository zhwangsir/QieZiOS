# QieZiOS

运行在浏览器里的 Web OS / 网页桌面（Svelte 5）。登记册：桌面 OS 模拟，Docker :8787。

> **路径**：`ALLProject/QieZiOS`  
> **状态**：维护（Qie 系列）  
> **最后更新**：2026-08-27

## 身份与远程

| 项 | 值 |
|----|----|
| origin（Gitee 主远程） | https://gitee.com/Winery_z/QieZiOS.git |
| github（备份） | https://github.com/zhwangsir/QieZiOS.git |
| 分支 | main 跟踪 origin/main |
| package.json | name `qiezios`，version `0.0.0`（占位；功能见 STATE.json 里程碑） |

集群真相源：**[`../ToIV/AGENTS.md`](../ToIV/AGENTS.md)**。

## 文档五件套

README.md / AGENTS.md / DEVELOPMENT.md / STATE.json / TEST_LOG.md。

旧 DEVPLAN-*.md、CLAUDE.md、设备说明已归档到 `ALLProject/.archive/docs-legacy-20260827/QieZiOS/`。STATE.json 很大（仍保留 M57 等历史里程碑，updatedAt 2026-08-08）。TEST_LOG 记录过 vitest 约 1225 例、svelte-check 0 error。

## 这是什么

浏览器 Web OS。四层：kernel / system / shell / apps。VFS 在 IndexedDB。

生产后端是 server/index.mjs（仅 Node 内置模块）。

内置应用见 src/apps/：Files、Terminal、CodeMirror、Assistant、Settings、Studio、Calculator、Clipboard 等二十余个。AI 经同源 /aiproxy 转发。账号 /sync 在 server/index.mjs。

## 技术栈

Svelte 5 + Vite 8 + TypeScript ~6 + Tailwind 4 + CodeMirror 6 + pixi-live2d-display。脚本：npm run dev / build / preview / serve / test / check。

## 端口

docker-compose.yml 映射 8787:8787。Vite 开发端口未在 vite.config.ts 写死（常为 5173）。规划建议 3801 尚未写入配置。

## 启动

npm ci 后 npm run dev。可选另开 npm run serve 提供本地 8787。生产：docker compose up -d --build，访问 http://localhost:8787。

## 注意

旧 README 是 Vite+Svelte 英文模板，已替换。Live2D 模型需自备。同步靠 token，勿裸奔公网。账号实现待硬化。push 时 origin 与 github 都要推。

## 内置应用与壳（实测 src/）

apps：AppGallery、AppStore、WebAppGallery、Assistant、Companion、Calculator、Clipboard、Clock、CodeMirror、Files、ImageViewer、MediaViewer、QuickLook、Reminders、Sandbox、Screenshot、Settings、Studio、SysMonitor、Terminal、TextEdit、Trash、UserApp、WebView、Welcome 等。

shell：Desktop、Dock、TopBar、Spotlight、Launchpad、Expose、Notifications、Window、DesktopPet、Widgets、StickyNotes 等。

system：ai / aiConfig / account / sync / theme / pet / wallpaper 等。kernel：vfs、idbStore、blobStore、processes、bus。

## 开发代理

vite.config.ts：/aiproxy → VITE_AI_PROXY_TARGET（默认 dgmt.top）；/auth 与 /sync → VITE_BACKEND_TARGET（默认 localhost:8787）。

生产环境变量：PORT、AI_PROXY_TARGET、可选 AI_KEY、SYNC_FILE。见 docker-compose.yml，勿把 key 写进文档。
