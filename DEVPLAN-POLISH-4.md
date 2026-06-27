# QieZiOS 完善与查漏计划 · 第 4 轮（自治完善循环真相源）

> 第 1/2/3 轮（POLISH/POLISH-2/POLISH-3）+ 性能阶段（PERF：P1/P2/P4/P6/P7）已完成。本文件是**第 4 轮**待办，来源：2026-06-28 两路子 Agent 对扩大后代码库（含第 3 轮新增 G1-G7）重新审计（正确性 + 功能/体验），均实读源码、排除前三轮已修项。
> 执行协议同前：挑价值最高未完成项 → builder 实现 → supervisor 子 Agent check+build+审 diff → 浏览器/DOM 验证 → 中文 commit（带 Co-Authored-By）→ push → 勾 [x]+验证结论 → 同步 CLAUDE.md。一次一项。数据丢失/崩溃 P0 优先，与高价值可见功能交替。

---

## 一、正确性 / 健壮性

- [x] **R4-C1（P1 数据损坏）shell `>`/`>>` 重定向到二进制文件损坏节点 + 泄漏 blob**：`writeToPath`（shell.ts:119）对已存在文件调 `writeFile`，但 `writeFile` 只改 content/updatedAt，不清二进制元数据 → 对上传的图片等二进制节点重定向后，节点仍 `kind:'binary'` 却装着文本 → `cat` 显「[二进制文件…]」忽略文本（静默丢写）、旧 blob 永不删除（泄漏）、size/mime 陈旧。触发：上传 photo.png → 终端 `echo hi > photo.png`。
  - ✅ 实现：`writeFile`（kernel/vfs）写入文本时，若节点原 `kind==='binary'` → 删旧 blob（`void deleteBlob`，同 purge 范式，带 `if(n.blobId)` 守卫防二次删）+ 清 kind/blobId/mime/size=undefined 再写 content（节点正确转为文本文件）。内核级修复，覆盖 shell 重定向及任何写文本到二进制节点的路径；文本节点路径（kind 已 undefined）跳过该块、字节级零回归。
  - ✅ 浏览器实测（__qzVfs+__qzBlobs+__qzExec）：建 image/png 二进制节点（kind=binary/mime/size=8/blob 在库）→ `echo hi > r4c1.png` → 节点 kind=undefined、content='hi'、blobId 去除、库中 blob 已删；`cat r4c1.png`→stdout 'hi'（非 [二进制文件]）。0 console error。supervisor 子 Agent PASS（转换正确[扩展名 .png 仍路由 imageviewer 但其 blobId 守卫→error 态不崩、非回归]、blob 删除无双删竞态、文本写零回归、Svelte5 undefined 序列化丢键 rehydrate 正确、分层/build 0/0 五点全过）。npm check+build 0 错 0 警。
- [x] **R4-C2（P1 资源泄漏）OpenAI 流式 `[DONE]` 提前 return 不释放 reader**：`streamOpenAI`（ai.ts ~347-366）在收到 `data: [DONE]` 时直接 return，未 `reader.cancel()`/`releaseLock()` → 底层 ReadableStream 锁与连接挂到 GC；agent loop 每问至多 8 轮，长会话累积悬挂 reader/连接。修：读循环包 try/finally，finally 里 `try{ await reader.cancel() }catch{}`。文件：`system/ai.ts`。
  - ✅ 实现：`streamOpenAI` 把「for 读循环 + 循环后 return」整体包进 `try{}finally{ try{ await reader.cancel() }catch{} }`（getReader/decoder/累加器声明在 try 外，reader 在 finally 可见）→ `[DONE]` 提前 return、流自然结束、signal 中断三条路径都释放 reader（取消底层流关连接+释放锁）。finally 无 return/throw → AbortError 仍正常上抛给 runOpenAIAgent/complete；解析/输出逻辑零改动。Anthropic 路径用 SDK `client.messages.stream()` 自管 reader、无手动 getReader，无同类泄漏。
  - ✅ 浏览器实测（stub fetch 返回合成 SSE 流：两段 delta + `data: [DONE]` 且**不关闭流**模拟 keep-alive 尾字节）：`__qzAi.complete('hi')` → 返回 "hello world"（delta 累加正确）+ 底层流 cancel() 触发（cancelled=true，修前 [DONE] 路径不会取消→泄漏）；无 error；reload 后 app 正常挂载、Studio(渲染 Sandbox)/AppGallery 等深层 import ai.ts 的模块运行正常（编辑期 Vite「Failed to reload」HMR 回退噪声，check+build 0/0 证无真错）。supervisor 子 Agent PASS（两 return 路径全覆盖+reader 作用域、中断 AbortError 仍上抛 finally 不吞、cancel 语义[DONE/已结束/中断]内 try-catch 不掩盖返回值、解析零回归、缩进/scope/build 五点全过）。npm check+build 0 错 0 警。顺手清掉测试污染的 qz.ai.apiKey('g4spot'→'')。
- [ ] **R4-C3（P2）Terminal 历史 ↑/↓ 读共享 cmdHistory 陈旧索引**：`recallHistory`（Terminal.svelte ~95）`hist[histIdx]` 的 histIdx 按调用时长度夹取，但 cmdHistory.list 是多终端共享 persisted、另一终端 addHistory 去重裁到 200 会缩短 → `input` 可能为 `undefined`（输入框显字面 undefined）。修：访问处再夹 `histIdx>=hist.length?'':(hist[histIdx]??'')`。文件：`apps/Terminal.svelte`。
- [ ] **R4-C4（P2）桌宠拖动只夹左上、不夹右下、resize 不回收**：`DesktopPet.move`（~102）只 `>=0/>=36` 夹，窗口缩小后桌宠可停到屏外取不回。修：按 `innerWidth/innerHeight`（减桌宠尺寸）夹 move + resize 时回夹 pet.x/y。文件：`shell/DesktopPet.svelte`/`system/pet.svelte.ts`。

## 二、功能 / 体验（价值/成本比排序）

- [x] **R4-F1 窗口四边/四角缩放（仅右下角→全向）** [S, 价值极高]：`Window.svelte` 现仅右下一个缩放手柄。加 N/E/S/W 四边 + NW/NE/SW 三角共 7 个细手柄，参数化 `startResize(e,dir)`，左/上边同时调 x/y（min 夹同现 280×180）；复用现有 rAF flush + setBounds。
  - ✅ 实现：`RESIZE_HANDLES`（8 项：n/s/e/w 边 + 四角，各带定位/光标 Tailwind 类 + aria-label，边缘细条在前、四角在后→重叠处四角胜出）`{#each}` 渲染。`startResize(e,dir)` 加方向参数 + 快照 ox/oy（左/上边要调位置）。`onMove` resize 分支方向化：每帧先 `nx=ox;ny=oy;nw=ow;nh=oh`（防上次拖拽的陈旧值漏入）再按 dir：e→宽+dx、s→高+dy、w→右边固定 `nx=min(ox+dx,right-MINW);nw=right-nx`、n→底固定 `ny=max(0,min(oy+dy,bottom-MINH));nh=bottom-ny`。`flush` resize 改写 `{x,y,width,height}`。stopPropagation 不触发标题拖拽/吸附；resize 全程不碰 snapState。
  - ✅ 浏览器实测（视口拉到 1280 破 isMobile=true 隐藏手柄的无头限制，stub 同步 rAF + no-op setPointerCapture[合成事件无活动指针]）：8 手柄齐全（matchMobile=false）；east dW+50、south dH+40、west dW+30/dX-30、north dH+20/dY-20、nw dW+15/dX-15/dH+15/dY-15（各方向只动该动的边）；west 缩到最小 → width 夹 280、右边固定 880、x→600。0 console error。supervisor 子 Agent PASS（几何含 min 夹对边不漂、flush 重置防陈旧、不误触吸附、onDestroy 不漏、移动/最大化不渲染无残留旧手柄、Tailwind 动态类已生成+a11y+build 六点全过；仅记非阻塞：边缘手柄盖住内容滚动条 6px 槽，属常见取舍）。npm check+build 0 错 0 警。
- [ ] **R4-F2 最近文件 / 最近 App（+ Spotlight 最近区）** [S/M, 价值极高]：全系统无 recents。新 `system/recents.svelte.ts`（`persisted('qz.recents')` 环形封顶 ~20 + pushRecentFile/App），挂 `sys.openApp` 与 Files `open()` 两个 chokepoint；Spotlight 空查询时置顶「最近」区。无头可验。
- [ ] **R4-F3 主题：主色微调表面色（accent tint）** [S, 价值高]：`theme.svelte.ts` 表面色是固定中性、不吸主色。加 `settings.accentTint`(0~0.15)，`activeTokens` 用 `color-mix(accent X%, surface)` 算 `--color-qz-surface`/`--color-qz-elevated` → 全 UI 更统一。对齐作者#1 美观/#2 自定义。无头可验（断言 :root token）。
- [ ] **R4-F4 Spotlight 内联计算器** [S, 价值高]：Spotlight 不算数学。query 能被 `lib/calc.ts`（已存在）解析时置顶 `{kind:'calc'}` 结果、Enter 复制结果到剪贴板。近零成本复用 calc.ts。无头可验。
- [ ] **R4-F5 每 App 默认窗口尺寸 / 偏好** [M, 价值高]：App 尺寸硬编码在 appList。新 `system/appPrefs.svelte.ts`（`persisted('qz.appPrefs')` 按 appId 存 w/h），launch/openApp 回退 `appPrefs[id].w ?? meta.width`；窗口标题栏右键加「保存当前大小为默认」。无头可验。
- [ ] **R4-F6 桌面小组件层（时钟/日历/系统状态）** [M, 价值高]：桌面有图标+便签但无活动小组件。新 `shell/Widgets.svelte`+`shell/widgets.svelte.ts`（镜像 notes 的拖动/持久化），组件：clock（复用 Clock 的 SVG 表盘）/calendar（月历）/sysstat（进程数）。桌面右键「新建小组件」。摆放/持久无头可验、表盘视觉真机。
- [ ] **R4-F7 Files 框选（marquee 拖拽多选）** [M, 价值中高]：B15 已延后。grid 空白处 pointerdown 起选框 → 命中测试 item rect → set selected；与现有 item HTML5 拖拽共存（仅当 down 目标是容器才起框选）。无头可验。
- [ ] **R4-F8 窗口贴靠布局弹窗（悬停最大化键）** [M, 价值中]：平铺只有键盘/网格，无鼠标可发现入口。WindowControls 最大化键 hover 出布局区选择器（半/四分/三分），点击调现有 setBounds 几何（把 Desktop 的 tile/quarter 几何抽到 `shell/tiling.ts` 共享）。无头可验。
- [ ] **R4-F9 空状态 + 首启引导打磨** [S, 价值中]：Files/Trash/Clipboard 空状态是裸文字；Welcome 是点击计数 demo。给空状态加图标+提示+主操作按钮；Welcome 改 3-4 卡片快速导览（Spotlight/终端/设置/文件）。纯展示。无头可验。
- [ ] **R4-F10 最小化/启动「神灯」朝 Dock 飞的动画** [S/M, 价值高(美观/丝滑)]：现窗口开关是居中 pop、最小化是原地淡出，无朝 Dock 图标的空间连接。算目标图标 rect → transform-origin+translate/scale 朝它过渡（仅 transform/opacity，尊重 reducedMotion）。动画平滑需真机验。

---

> 当前循环：第 4 轮；**R4-C1（shell 二进制重定向损坏）+ R4-F1（窗口全向缩放）+ R4-C2（OpenAI 流 reader 泄漏）已完成 ✅**。剩 C3/C4（正确性）+ F2-F10（功能）。下一项建议：R4-F2（recents，价值极高）/ R4-F4（Spotlight 计算器，单文件复用 calc.ts）/ R4-F3（accent tint）/ R4-C3（终端历史陈旧索引，小修）。
