# QieZiOS 完善与查漏计划 · 第 3 轮（自治完善循环真相源）

> 第 1/2 轮（POLISH/POLISH-2）+ 性能阶段（PERF：P1/P2/P4/P6/P7）已完成。本文件是**第 3 轮**待办，来源：2026-06-27 两路子 Agent 对扩大后的代码库重新审计（正确性 + 功能/体验），均实读源码、排除已修项。
> 执行协议同前几轮：挑价值最高未完成项 → builder 实现 → supervisor 子 Agent check+build+审 diff → 浏览器/DOM 验证 → 中文 commit（带 Co-Authored-By）→ push → 勾 [x]+验证结论 → 同步 CLAUDE.md。一次一项。数据丢失/崩溃 P0 优先。

---

## 一、正确性 / 健壮性

- [x] **F1（P0 数据丢失）云同步「拉取」窗口陈旧覆盖**：`pullSync` 把云数据写进 IDB/localStorage 后、reload 前（Settings 等 800ms）有窗口，内存里 $state 还是旧值且 hydrated=true，任何对 store 的响应式写（DesktopIcons GC、schedd 跑命令写文件、用户操作）会经防抖把**旧内存**序列化盖回刚拉的云数据 → 静默丢失正要恢复的数据。
  - ✅ 实现：persist 加 `frozen` 开关 + `freezePersistence()`/`unfreezePersistence()`；同步版 + 异步版的写盘 effect 与防抖回调与 flusher 全加 `frozen` 守卫（冻结时不安排/不执行写盘）。`pullSync` 写回云数据前 `freezePersistence()`，try/catch 写回失败则 `unfreezePersistence()`（不会 reload 故须解冻避免本会话永久冻结）；成功后调用方 reload、模块重载 frozen 自然复位。
  - ✅ 浏览器实测（__qzSync 钩子）：种 CLOUD 进 IDB→freeze→createFile 旧内存→等过防抖 600ms→**IDB 仍是 CLOUD（未被旧内存覆盖）、不含 stale 文件**；unfreeze 后新建文件**正常写盘**（写恢复、无永久冻结）；0 console error。supervisor 子 Agent PASS（待评）。npm check+build 0 错 0 警。
- [x] **F2（P1 上传漏最新改动）flushPersisted 漏未排程的写**：`flushPersisted` 只刷 `pending` 已被赋值的 store，而 `pending` 在 `$effect` 里赋值、effect 异步排程。若改完状态**同一 tick 内**立即 `pushSync()`，effect 未跑→pending=null→flusher no-op→gatherState 读旧值。D2 的初衷对「比一次 effect-flush 更新」的改动失效。修：flushPersisted 先 `await tick()` 再刷。文件：`kernel/persist.svelte.ts`。
  - ✅ 实现：`flushPersisted` 开头 `await tick()`（import from 'svelte'）——把挂起的 `$effect.root` 写盘 effect 先跑完、pending 赋上，再 `Promise.all(flushers)`。tick 只多等一个微任务刷新、不改写盘语义；freeze 守卫仍在 effect 体与 flusher 内、tick 不绕过；只被非冻结的 pushSync 用。
  - ✅ 浏览器实测：reload 后同 tick `createFile('f2-probe.txt')`+`await flushPersisted()`→**IDB qz.vfs 含该文件**（sameTickFlushCaptured=true）、`gatherState()` 也见到（pushSync 全路径）；0 console error。supervisor 子 Agent PASS（tick 刷模块级 effect 令 pending 赋值/与 F1 freeze 协同 tick 不绕过/无组件上下文 tick 安全必 resolve/D2·A2·F1·P1 正常路径零回归/多 store 同 tick 全刷+不双写/分层 import svelte 合规无环 六点全过）。npm check+build 0 错 0 警。
- [ ] **F4（P2）Calculator/ImageViewer onKey 吞掉带修饰键的组合**：`Calculator.onKey` 无 `ctrlKey/metaKey/altKey` 守卫 → 焦点在计算器时 Cmd/Ctrl+C 触发 clearAll+preventDefault（没法复制结果）、Ctrl/Cmd+0/-/+ 等被吃。修：onKey 开头 `if (e.ctrlKey||e.metaKey||e.altKey) return`。ImageViewer 同理（Cmd+0/-）。文件：`apps/Calculator.svelte`、`apps/ImageViewer.svelte`。
- [ ] **F5（P2）resetDock 不重置 autohide**：「重置 Dock 布局」只清 order/hidden，不复位 autohide → 开了自动隐藏后重置，Dock 仍隐藏、找回入口（右键菜单）在 Dock 上、不直观。修：`resetDock` 也 `autohide=false`。文件：`system/dockPrefs.svelte.ts`。
- [ ] **F3（P2 潜伏，低优先）restore 二进制节点 blob 已被独立删除**：当前无「删 blob 不删 node」的触发路径，属健壮性记录，暂不处理。

## 二、功能 / 体验（价值/成本比排序）

- [ ] **G1 时钟 App 加 计时器/秒表/世界时钟**（审计推荐第一）：`Clock.svelte` 现仅模拟表盘。加分段切换 秒表(`performance.now`+圈速)/倒计时(到点 `sys.notify`+`playSound`)/世界时钟(`Intl.DateTimeFormat` 多时区)。单文件、复用 windowVisible 暂停定时器、DOM 可验。
- [ ] **G2 文件管理器详情/信息面板**：选中项看不到完整路径/精确字节/创建·修改时间/mime/属主权限明细（VNode 数据已齐，只差展示）。右侧可折叠详情侧栏或右键「显示简介」+ 图片缩略。文件：`apps/Files.svelte`。
- [ ] **G5 字体族自定义（主题新维度）**：`Settings` 无 fontFamily、`theme` 无 `--qz-font`。加 fontFamily 字段（系统/无衬线/衬线/等宽/圆体）+ token + Settings select。⭐ 对齐作者第一优先级（美观/自由度），机制已就绪成本低。文件：`settings.svelte.ts`/`theme.svelte.ts`/`app.css`/`Settings.svelte`。
- [ ] **G7 记事本导出/另存下载**：TextEdit 只能存进 VFS、无法导出到本机。工具栏加「⬇ 导出」（Blob+`<a download>`，.md 可选导出 HTML 复用 renderMarkdown）。单文件。打通「VFS→本机」出口。
- [ ] **G3 计算器科学模式**：加 标准/科学 切换（√/x²/1/x/π/括号/sin·cos·log/内存键），受控 parser 非 eval。单文件。
- [ ] **G4 媒体（音视频）查看器**：上传二进制已支持但只能看图。新 `apps/MediaViewer.svelte`（`<audio>`/`<video>` + readBlob objectURL）+ Files 双击按 mime 分流 + appList 登记。
- [ ] **G6 截图工具**：`getDisplayMedia`→canvas→存 VFS+下载。中成本、画面无头难验。

---

> 当前循环：第 3 轮审计建立本 backlog；**F1、F2 已完成**（sync/persist 健壮性：拉取陈旧覆盖 freeze + 上传同 tick 漏写 tick）。剩 F4/F5（P2）+ G1-G7（功能）。下一项按协议交替到功能：G1（时钟计时器/秒表，审计推荐第一、高价值可视）或 G5（字体族，作者第一优先级、低成本）。
