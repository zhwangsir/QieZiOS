# QieZiOS 性能 / 存储硬化阶段（DEVPLAN-PERF · 自治循环真相源）

> 作者拍板「进入下一阶段 → 性能/存储硬化」（2026-06-27）。对齐四大优先级里的**性能最强 + 最丝滑**，并解一个迫近的结构性风险：**VFS 整棵树 + 所有文本仍在 localStorage（~5–10MB 硬上限），叠加同步/对话/历史后配额已逼近天花板**（A1 剥图就是被它逼出来的）。
> 执行协议同前几轮（builder 实现 → supervisor 子 Agent check+build+审 diff → 浏览器/DOM 验证 → 中文 commit 带 Co-Authored-By → push → 勾 [x] + 验证结论 → 同步 CLAUDE.md）。一次一项。

---

## 一、存储：破 localStorage 天花板

- [x] **P1 VFS 迁 IndexedDB**（本轮）：新 `kernel/idbStore.ts`（async 字符串 KV，镜像 blobStore）+ persist 加 `persistedAsync`（异步 hydrate + `hydrated` 守卫防默认值覆盖真数据 + 启动门 `hydrateAll()` + localStorage→IDB 一次性迁移并清旧键释放配额）；`vfs` 改用 `persistedAsync`；`main.ts` 挂载前 `await hydrateAll()`（避免默认值闪烁）；**sync.ts 与 SysMonitor 改后端感知**（IDB 里的 qz.vfs 仍纳入云同步与存储用量统计）。
  - ✅ 实现：`kernel/idbStore.ts`（库 `qz-kv`/store `kv`，idbGet/Set/Remove/Keys/Entries，全 try/catch best-effort 降级）；`persistedAsync<T>` = 先以 initial 启动 + 登记 hydrator + `$state.snapshot` 后 `if(!hydrated) return` 守卫（hydrate 前绝不写盘）+ `replaceInPlace`（就地替换 $state 内容保持代理引用 → 既有订阅继续有效）+ 一次性迁移（IDB 空但 localStorage 有→搬进 IDB+删旧键释放配额）；导出 `ASYNC_KEYS`/`hydrateAll`；旧同步 `persisted`（19 处）原样不动。`vfs` 改 `persistedAsync('qz.vfs',…)`；`main.ts` 顶层 `await hydrateAll()` 后才 mount；`sync.gatherState` 改 async 合并 localStorage+IDB 两后端、`pullSync` 按 ASYNC_KEYS 路由；SysMonitor 存储统计加 IDB 字节（节流 5s）标签「存储(LS+IDB)」。
  - ✅ 浏览器实测（真 dev 服务）：启动正常无 console error；新建文件→debounce 后 IDB qz.vfs 含该文件、**localStorage 不再有 qz.vfs**、reload 从 IDB 恢复；一次性迁移（种 localStorage qz.vfs+清 IDB→reload→节点可见+localStorage 旧键被删+IDB 有了）；**破天花板：写 6MB 文件→IDB qz.vfs ~6.3MB、localStorage 仅 2.7KB、reload 后 6MB 完整**（旧 localStorage 必抛 QuotaExceeded）；sync.gatherState 含 qz.vfs（来自 IDB）+ 全部 localStorage qz.* 键。supervisor 子 Agent PASS（异步 hydrate/写盘守卫无 clobber 窗口/replaceInPlace 保引用响应式/迁移幂等/IDB 事务同任务/sync 双后端无重无漏/分层无环/TLA 构建通过不会 reject 卡死/19 处同步 persisted 零回归/两 IDB 库独立 九点全过；仅 DEV 钩子 nodes 陈旧引用已改 getter 修掉）。npm check+build 0 错 0 警。
- [x] **P2 chat 迁 IDB + 不再剥附图**：chat 从 `persisted`(localStorage+剥图) 改 `persistedAsync`(IDB，去掉 serialize)。P1 把存储迁 IDB（GB 级）后 A1「localStorage 配额满→静默丢整段对话」的根因消失 → 附图（已缩放 ~4KB/张）随对话持久化、刷新原样还原（A1 当年被迫剥成占位的能力补回来了）。imageCount 字段保留兼容旧数据。settings/dock/windows 等小 store 留 localStorage（首屏同步、无配额压力）。
  - ✅ 浏览器实测：推带图消息→IDB qz.chat 含图字节+文本、localStorage 无 qz.chat；**reload 后 images 还原（imagesSurvived=1、字节完整）**（A1 旧行为此处会是占位）；旧 localStorage chat（imageCount=3 无 images）迁移→可见+占位+旧键删+IDB 有；清空→msgs=0；0 console error。supervisor 子 Agent PASS（hydrateAll await chat/渲染分支新旧都对/A1 失效模式消除/迁移幂等/A2 推迟序列化在 async 版成立流式不每 token stringify/sync·统计自动一致/分层无环/D1 守卫等零回归 八点全过）。npm check+build 0 错 0 警。
  - 📌 后续观察项（非阻塞，supervisor 建议）：图随对话存 IDB 容量无压力（百张才 ~0.5MB vs ~37GB 配额），边际成本是序列化/解析性能；若日后超长多图对话卡顿，可选 (a) `addFiles`/`send` 加单条软上限（≤6 张/条，兼顾视觉模型 token 预算）(b) 附图改存 blobStore 按 blobId 引用（与 VFS 二进制同构）。现做属过度设计。
- [ ] **P3（远期）OPFS + SQLite-WASM**：真·大容量 + SQL 查询/索引/事务。重型，延后到需要复杂查询时。

## 二、渲染 / 丝滑

- [x] **P4 长列表渲染优化**（content-visibility 版，非手写虚拟化）：终端输出、SysMonitor 日志/事件——量大时只渲染可视区。
  - ✅ 实现：因终端行可变高度（whitespace-pre-wrap+多行文本）+ 无头预览验不了滚动几何，**不做手写虚拟化**，改用 CSS `content-visibility:auto`（浏览器自动跳过离屏行的布局/绘制，纯 CSS、不碰滚动逻辑、可访问性不受影响）。新增 `.qz-cv-row { content-visibility:auto; contain-intrinsic-size:auto 1.25rem }`（`auto` 关键字记住真实高度→滚动条估准）；终端输出行 + SysMonitor 日志/事件行各加该类。终端另加回卷上限 `MAX_LINES=5000` + `trimScrollback()`（防长会话 DOM 无限增长；输入行不带该类、始终真实渲染→滚到底正确）。
  - ✅ 浏览器实测：终端输出行 computed `content-visibility:auto`+`contain-intrinsic-size:auto 20px`、echo 命令输出正常；SysMonitor 日志行/事件行 computed `content-visibility:auto`；0 console error。supervisor 子 Agent PASS（行级裁剪安全/输入行不带类+intrinsic 占位故 scrollToEnd 仍到底/可访问性非 display:none/回卷 slice(-5000) 逻辑+调用位置对/index-key+trim 收敛不错位不崩/清屏·Ctrl+L·Tab·profile push 零回归/intrinsic auto 标准用法/纯 CSS 无环 六点全过）。npm check+build 0 错 0 警。
  - ⏳ 回卷上限（5000）需 ~2500 条命令才触发、无头难造 → 逻辑+supervisor 确认。Files 网格因 grid 轨道与 content-visibility intrinsic-size 交互更微妙，留待专门一轮。
- [ ] **P5 信号/重渲染热点审计**：`vfs.children()` 每次 `Object.values+filter+sort`（O(n log n) 每调用、面包屑/resolvePath 高频调）等；高频 $derived 缓存；大对象 snapshot 成本。
- [x] **P6 最小化窗口 content-visibility**：最小化已暂停定时器（windowVisible），进一步对最小化窗口**跳过内容布局/绘制**。
  - ✅ 实现：发现最小化窗口**保持挂载**（opacity:0+scale 做平滑动画、非 display:none）→ 内容仍被布局/绘制白耗渲染。给内容区 div 加 `style:content-visibility={proc.minimized ? 'hidden' : 'visible'}`——浏览器跳过最小化窗内容的布局/绘制；仅作用内容区、不碰窗口根的 opacity/scale 最小化动画；内容区是 fixed-height flex 列里的 `flex-1` → 盒子由 flex 撑开不受 `contain:size` 塌陷。用 `hidden` 而非 `auto`（auto 对仍在视口内的最小化窗不跳过、且丢渲染状态；hidden 无条件跳过 + 保留滚动/渲染状态、还原便宜）。与 windowVisible() 暂停定时器正交叠加。
  - ✅ 浏览器实测（清干净 ghost 窗口后单窗）：计算器内容区 content-visibility 开=visible、最小化=hidden、还原=visible、procMinimized 还原后 false；0 console error。supervisor 子 Agent PASS（响应式 proc.minimized/不破坏最小化动画/**flex-1 防盒子塌陷**/最小化不可 tab 还原恢复（a11y 微改善）/与 windowVisible 正交/非最小化字节级零回归/hidden vs auto 取舍正确保滚动状态/纯 CSS 无环 八点全过）。npm check+build 0 错 0 警。⚠️ 无头预览 out:pop 过渡冻结致关窗 DOM 不卸载是环境限制、与本改动无关。

## 三、可观测

- [x] **P7 存储/性能面板**：SysMonitor 显 IDB+localStorage 真实用量（`navigator.storage.estimate()`）、帧率/长任务提示，给后续优化一把尺。
  - ✅ 实现（存储用量仪表盘）：SysMonitor 概况页加用量行 `fmtBytes(usage)/fmtBytes(quota)（pct%）`（`navigator.storage.estimate()` 真实配额，含 IDB/blob/localStorage 全部源；可选链 + .catch 优雅降级，不支持则显「未提供配额估算」）+ 进度条（width=usedPct%，>90% 红 / >70% 橙 / 否则主色，Math.min 夹 0–100、estQuota=0 不 NaN）+ qz.* 数据行 `fmtBytes(qzBytes)`（localStorage qz.* + 节流 5s 的 IDB qz.* 字节）。复用既有 `now` 每秒心跳触发节流刷新。删掉旧 `storageKB()`。
  - ✅ 浏览器实测：概况页渲染真值 `592.8 KB / 37.26 GB（0.0%）`（**配额 ~37GB 直观印证 P1 破 localStorage ~5–10MB 天花板**）+ qz.* 3.8 KB + 进度条按比例；数据源正确（写 2MB 文件后 `idbEntries()` 直接读到 2.00 MB）。0 console error。supervisor 子 Agent PASS（estimate 可选链/catch 安全降级/节流心跳/qzBytes·usedPct 响应式/颜色阈值互斥/除零守卫/storageKB 0 残留引用/fmtBytes 边界/分层无环 八点全过）。npm check+build 0 错 0 警。
  - ⏳ 自动刷新（5s）实时性因无头预览 `visibilityState=hidden` 冻结每秒心跳（实测 uptime 2.5s 不变）验不了 → **待真机验证**（复用 clock/uptime 同一套已上线心跳，真机会刷）。帧率/长任务提示延后到需要时。

---

> 当前循环：**P1、P2、P4、P6、P7 已完成**（VFS+chat 迁 IDB + 存储仪表盘 + 长列表 + 最小化窗 content-visibility）。剩 **P5（vfs.children() 信号热点，高 blast radius、需专注全验）** + P3（OPFS+SQLite-WASM，远期）。下一项：P5（最后一个有价值的性能项）。
