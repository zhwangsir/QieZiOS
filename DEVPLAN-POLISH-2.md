# QieZiOS 完善与查漏计划 · 第 2 轮（自治完善循环的真相源）

> 第 1 轮（`DEVPLAN-POLISH.md`，P0 A1-A9 + P1 B1-B16 + P2 C1）已全部完成。本文件是**第 2 轮**待办，来源：2026-06-27 两路子 Agent 对扩大后的代码库重新审计（正确性/健壮性 + 功能/体验），均实读源码确认、排除第 1 轮已修项。
> 执行协议同第 1 轮（见 `DEVPLAN-POLISH.md` 第一节）：每次循环挑价值最高的未完成 `[ ]`，builder 实现 → supervisor 子 Agent 跑 check+build 审 diff（≤3 轮否则撤销）→ 浏览器/DOM 验证（验不了标 ⏳ 待真机验证）→ 中文 commit（带 Co-Authored-By）→ push → 勾 `[x]` + 写验证结论 → 同步 CLAUDE.md。一次一项。安全暂缓、功能优先。

---

## 一、P0 / P1 · 正确性 / 健壮性

- [x] **D1 清空对话 mid-stream 崩溃（stale index → undefined deref）**：`apps/Assistant.svelte` 流式回调写 `chat.msgs[i]`（i 在 ask 时捕获），而「清空」按钮无 `disabled={busy}`。AI 流式中点清空 → splice 清空数组 → `chat.msgs[i]` undefined → `TypeError` 崩溃 + busy 卡死要刷新。修：回调取 `const m=chat.msgs[i]; if(!m) return;` 防御 + 清空按钮 busy 时禁用。**P1，一键可复现，浏览器可验。**
  - ✅ 实现：双层防护——(1) 流式回调改 `const m = chat.msgs[i]; if (!m) return;`，四种事件（text/reasoning/tool/error）全改用 `m`（仍是响应式数组元素代理，mutate 照常触发响应式），对话被截断时迟到事件安全丢弃；(2) 「清空」按钮加 `disabled={busy}` + disabled 样式 + 动态 title，从 UI 关闭竞态窗口。
  - ✅ 浏览器实测（真 dev 服务 + 本地 GLM 流式）：流式中 `busy` 时「清空」disabled=true、流完恢复（停止→发送）；**直接 splice 清空 mid-stream（绕过禁用模拟迟到事件竞态）→ 无 console error/无 unhandledrejection（d1err=none）、msgCount 停在 0（迟到事件被守卫丢弃）、busy 恢复不卡死**；正常流式完成无回归。supervisor 子 Agent PASS（undefined 解引用彻底消除/四事件全改 m 无裸下标遗漏/响应式不变/Anthropic stream.on 与 OpenAI fetch 两条抛错路径都被 runAgent try/catch 兜住故 busy 必达 false/按钮禁用与 if gate 正交/stop 后迟到事件追加属良性/清空后再发 i 基于新数组正确/正常路径字节级等价）。npm check+build 0 错 0 警。
- [x] **D2 云同步上传被防抖的陈旧状态（静默漏数据）**：`system/sync.ts` 的 `gatherState()` 同步读 localStorage + idbEntries 读 IDB，但 `persisted/persistedAsync` 写盘有 150–300ms 防抖。改完笔记/移窗口后立刻点「☁️上传」→ 改动还在 pending 计时器里、没落盘 → 上传悄悄漏掉。P1/P2 把 VFS/chat 迁 IDB 后更明显。修：加 `flushPersisted()`（立即落地所有挂起防抖写）在 gatherState 前 await。
  - ✅ 实现：persist 加模块级 `flushers` 注册表；`persisted`/`persistedAsync` 把 `timer` 提到函数作用域 + 新增 `pending`（最新 snapshot 的写盘动作），effect 里设 pending+timer、timer 到点跑 pending 并清空；各注册一个 flusher（取消 timer + 立即跑 pending）；同步版 flusher 返 void、IDB 版返 idbSet 的 Promise。`flushPersisted()` = `await Promise.all(flushers)`。`pushSync` 鉴权后、gatherState 前 `await flushPersisted()`。persistedAsync 的 `if(!hydrated) return` 在设 pending 之前 → flush 不破坏「hydrate 前不写」。
  - ✅ 浏览器实测：createFile 后**不 flush** 直接 gatherState → qz.vfs 不含新文件（复现陈旧 bug）；**flushPersisted 后** gatherState → 含新文件（修复）；flush 跑遍所有 flusher（含 localStorage 同步 store）无报错；0 console error。supervisor 子 Agent PASS（pending 持最新 snap/防抖语义不变/无双写无 stale-timer/hydrate 守卫 intact/Promise.all 混合 await 后 idbEntries 读到已 commit 数据/pushSync 时序+不 reject 卡死/无泄漏/A2·P1·P2 零回归 八点全过）。npm check+build 0 错 0 警。
- [x] **D3 `restoreFromTrash` 撤销还原不查重名（同 A7/A9 类）**：`kernel/vfs.svelte.ts` restore 把节点放回 prevParent 时不查同名。删 a.txt → 新建同名 a.txt → 点撤销 → 同目录两个 a.txt 并存、路径只命中第一个。修：restore 落地前 `n.name = uniqueName(target, n.name)`（镜像 move）。P1，浏览器可验。
  - ✅ 实现：`restoreFromTrash` 先算 `target`（prevParent 在则用、否则 root），再 `n.name = uniqueName(target, n.name)` 然后才 `n.parentId = target`——此刻 n 仍在 'trash'，children(target) 不含 n，故只对目标已有名去重、不误改自己（与 move 的 A7 时机一致）。补齐 A7(move)/A9(rename)/D3(restore) 数据完整性三件套。顺带扩展 DEV 钩子 `__qzVfs`（仅 DEV）加 createFile/createDir/trash/restoreFromTrash/purge/resolvePath/pathOf/nodes 供测试。
  - ✅ 浏览器实测（真 dev 服务 + `__qzVfs`）：删 d3.txt → 新建同名 d3.txt → 还原 → 还原项变「d3 2.txt」、新建项仍「d3.txt」、两者 parentId=root、名字唯一、**两条路径各自 resolvePath 回到自己 id（都可达，修复前另一个永久不可达）**；无冲突还原 d3-solo.txt 名不变（不误改）；文件夹 d3dir 碰撞还原→「d3dir 2」且子项仍 linked（按 id 关联不受改名影响）；trash→restore→trash 循环 prevParent 清理自洽。supervisor 子 Agent PASS（去重时机/无冲突不改/文件夹子项可达/顺序去重/prevParent 清理/B16·Trash 调用方良性改进/DEV 钩子全 DEV-only 且函数声明无 TDZ/纯内核无环 八点全过）。npm check+build 0 错 0 警。
- [ ] **D4 VFS 父链遍历遇环死循环（无 visited/深度上限）**：`isInside`/`pathSegments`/`resolvePath` 的 `..` 走 `while(cur)` 跟 parentId，若持久化树/外部 sync blob 含父环（A↦B↦A）→ 无限循环挂死标签页、无恢复。修：三处遍历加深度上限或 visited 集。P2，需损坏态触发但 sync 使其可达，逻辑可验。
- [ ] **D5 `iconPos`/`dockPrefs` 持久化映射只增不删（陈旧+泄漏）**：`purge` 删 VFS 节点不删 `qz.desktopIcons` 里它的 {x,y}；`removeUserApp` 不删 `dockPrefs.order/hidden` 里该 App id。长期堆积孤儿项（且随账号同步上云）。修：purge 内裁 iconPos、removeUserApp 内裁 dockPrefs。P2，浏览器可验。
- [ ] **A3（承接第 1 轮唯一未做项）过期一次性 `at` 命令开机补发执行**：schedd 重新武装时过期任务 `delay=0` 立即 fire，命令型经 shell 跑（可能 rm/mkdir 等副作用），与真 `at`（过期不补）相反。修：重新武装时过期的**命令型**一次性任务只移除不执行；提醒型可保留补发通知或也丢弃。文件：`system/services.ts`。P1，浏览器可验。

## 二、P1 · 功能 / 体验完善（价值/成本比排序）

- [x] **E1 Markdown 预览（`.md` 文件可切「编辑/预览」）**：`lib/markdown.ts` 已有 `renderMarkdown()`（AI 回复在用），TextEdit 打开 .md 只显原文。加「编辑/预览」切换 + `{@html renderMarkdown(content)}`。单文件、复用现成、DOM 可验。**成本低、价值高、推荐优先。**
  - ✅ 实现：TextEdit 加 `isMarkdown = $derived(/\.(md|markdown)$/i.test(node.name))` + `preview = $state(false)`；仅 markdown 文件显顶部「📝 Markdown · 编辑/预览」分段切换条；正文区 `{#if isMarkdown && preview}` 渲染只读 `<div>{@html renderMarkdown(content)}</div>`（空内容显占位）`{:else}` 原 textarea；Ctrl+F 分支加 `preview=false`（查找/替换作用于 textarea，先切回编辑）。复用 AI 回复同款安全渲染器（先转义再套白名单标签 → 无 XSS）。
  - ✅ 浏览器实测（真 dev 服务，隔离掉 session 还原的旧窗口后）：`.md` 显工具条、`.txt` 不显（toolbar=0）；预览态 textarea 消失、渲染出 `<strong>`/`<code>`/`<pre>`/`<a href>`/标题 `div.font-semibold`/列表项全部正确；切「编辑」textarea 带内容回来；预览态 Ctrl+F → 切回编辑 + 查找条打开 + focus。0 console error。supervisor 子 Agent PASS（renderMarkdown 先 escapeHtml 再白名单标签、链接 URL 被 https?:// 约束死无 javascript:/突破面 → 无 XSS；isMarkdown/preview 切换响应式正确、AI 写回实时重渲染；预览态 textarea ref=undefined 但 gotoMatch/replaceCurrent/onKey 全有 null 守卫且查找只能经先 preview=false 的 Ctrl+F 唤起；非 md 字节级零回归；只读文件协同；空 md 占位/大小写扩展名/叶子 import 无环 八点全过）。npm check+build 0 错 0 警。
- [ ] **E2 图片查看器缩放/旋转/适应窗口**：`ImageViewer.svelte` 只有 object-contain，无缩放旋转。加 scale/rotate $state + 工具栏 + 滚轮缩放 + 拖拽平移（纯 CSS transform 走 GPU）。单文件、DOM 可验、契合丝滑。
- [ ] **E3 计算器键盘输入 + 历史**：`Calculator.svelte` 只有 onclick，无键盘。加 `<svelte:window>` keydown（数字/运算符/Enter=`=`/Esc=C/Backspace）+ 计算历史侧栏。单文件、DOM 可验。
- [ ] **E4 文件管理器排序 + 列表/网格视图**：`Files.svelte` items 用原序、只有网格。加 sortBy(name/type/size/mtime)+sortDir + grid/list 切换（list 显大小/属主权限）。可能需给 VNode 加 mtime。中成本、DOM 可验。
- [ ] **E5 终端外观自定义（字号/配色主题）**：`Terminal.svelte` 颜色字号全硬编码。加终端偏好（持久）：字号 + 几套配色（Nord/Dracula/跟随系统）。中成本，与作者「高自由度」对齐。
- [ ] **E6 系统音效反馈**：全仓库零 Audio。新 `system/sound.ts` 用 WebAudio 合成开关窗/通知/错误短音 + Settings 开关音量（默认可关）。中成本，提升质感，音频本身 DOM 验不了（验 state+触发）。
- [ ] **E7 任务视图 Exposé（窗口缩略图总览）**：第 1 轮 B13 注明延后。快捷键触发全屏 Exposé：未最小化窗 CSS scale 缩略平铺、点击聚焦。中/高成本，部分可验。
- [ ] **E8 Dock 自动隐藏 + 桌面便签小组件**：Dock 常驻、桌面无小组件。加 Dock 自动隐藏开关（移到底部滑出）+ 可选桌面便签 widget。低/中成本，DOM 可验。

---

> 当前循环：**D1、D3、E1、D2 已完成**（+ 另起的性能/存储阶段 DEVPLAN-PERF 的 P1/P7/P4/P2）。本 backlog 剩 D4/D5/A3（correctness）+ E2–E8（功能）。下一项按协议（数据丢失/崩溃优先 + 与高价值可见 P1 交替）：候选 E2 图片缩放旋转（可视特性，宜交替）/ D4 父链遍历守卫（correctness）/ D5 持久化映射裁剪。
