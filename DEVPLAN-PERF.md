# QieZiOS 性能 / 存储硬化阶段（DEVPLAN-PERF · 自治循环真相源）

> 作者拍板「进入下一阶段 → 性能/存储硬化」（2026-06-27）。对齐四大优先级里的**性能最强 + 最丝滑**，并解一个迫近的结构性风险：**VFS 整棵树 + 所有文本仍在 localStorage（~5–10MB 硬上限），叠加同步/对话/历史后配额已逼近天花板**（A1 剥图就是被它逼出来的）。
> 执行协议同前几轮（builder 实现 → supervisor 子 Agent check+build+审 diff → 浏览器/DOM 验证 → 中文 commit 带 Co-Authored-By → push → 勾 [x] + 验证结论 → 同步 CLAUDE.md）。一次一项。

---

## 一、存储：破 localStorage 天花板

- [x] **P1 VFS 迁 IndexedDB**（本轮）：新 `kernel/idbStore.ts`（async 字符串 KV，镜像 blobStore）+ persist 加 `persistedAsync`（异步 hydrate + `hydrated` 守卫防默认值覆盖真数据 + 启动门 `hydrateAll()` + localStorage→IDB 一次性迁移并清旧键释放配额）；`vfs` 改用 `persistedAsync`；`main.ts` 挂载前 `await hydrateAll()`（避免默认值闪烁）；**sync.ts 与 SysMonitor 改后端感知**（IDB 里的 qz.vfs 仍纳入云同步与存储用量统计）。
  - ✅ 实现：`kernel/idbStore.ts`（库 `qz-kv`/store `kv`，idbGet/Set/Remove/Keys/Entries，全 try/catch best-effort 降级）；`persistedAsync<T>` = 先以 initial 启动 + 登记 hydrator + `$state.snapshot` 后 `if(!hydrated) return` 守卫（hydrate 前绝不写盘）+ `replaceInPlace`（就地替换 $state 内容保持代理引用 → 既有订阅继续有效）+ 一次性迁移（IDB 空但 localStorage 有→搬进 IDB+删旧键释放配额）；导出 `ASYNC_KEYS`/`hydrateAll`；旧同步 `persisted`（19 处）原样不动。`vfs` 改 `persistedAsync('qz.vfs',…)`；`main.ts` 顶层 `await hydrateAll()` 后才 mount；`sync.gatherState` 改 async 合并 localStorage+IDB 两后端、`pullSync` 按 ASYNC_KEYS 路由；SysMonitor 存储统计加 IDB 字节（节流 5s）标签「存储(LS+IDB)」。
  - ✅ 浏览器实测（真 dev 服务）：启动正常无 console error；新建文件→debounce 后 IDB qz.vfs 含该文件、**localStorage 不再有 qz.vfs**、reload 从 IDB 恢复；一次性迁移（种 localStorage qz.vfs+清 IDB→reload→节点可见+localStorage 旧键被删+IDB 有了）；**破天花板：写 6MB 文件→IDB qz.vfs ~6.3MB、localStorage 仅 2.7KB、reload 后 6MB 完整**（旧 localStorage 必抛 QuotaExceeded）；sync.gatherState 含 qz.vfs（来自 IDB）+ 全部 localStorage qz.* 键。supervisor 子 Agent PASS（异步 hydrate/写盘守卫无 clobber 窗口/replaceInPlace 保引用响应式/迁移幂等/IDB 事务同任务/sync 双后端无重无漏/分层无环/TLA 构建通过不会 reject 卡死/19 处同步 persisted 零回归/两 IDB 库独立 九点全过；仅 DEV 钩子 nodes 陈旧引用已改 getter 修掉）。npm check+build 0 错 0 警。
- [ ] **P2 其余大 store 评估/迁移**：chat（即便剥图，文本也会涨）等迁 IDB；settings/dock/windows 等小而需首屏同步的可留 localStorage。按收益定。
- [ ] **P3（远期）OPFS + SQLite-WASM**：真·大容量 + SQL 查询/索引/事务。重型，延后到需要复杂查询时。

## 二、渲染 / 丝滑

- [ ] **P4 大列表虚拟化**：Files 网格、终端输出、SysMonitor 日志/事件——量大时只渲染可视区（窗口虚拟化思路落到列表）。
- [ ] **P5 信号/重渲染热点审计**：`vfs.children()` 每次 `Object.values+filter+sort`（O(n log n) 每调用、面包屑/resolvePath 高频调）等；高频 $derived 缓存；大对象 snapshot 成本。
- [ ] **P6 不可见窗口 content-visibility**：最小化已暂停定时器，进一步对被遮挡/最小化窗口跳过布局/绘制（content-visibility:auto / 条件渲染）。

## 三、可观测

- [x] **P7 存储/性能面板**：SysMonitor 显 IDB+localStorage 真实用量（`navigator.storage.estimate()`）、帧率/长任务提示，给后续优化一把尺。
  - ✅ 实现（存储用量仪表盘）：SysMonitor 概况页加用量行 `fmtBytes(usage)/fmtBytes(quota)（pct%）`（`navigator.storage.estimate()` 真实配额，含 IDB/blob/localStorage 全部源；可选链 + .catch 优雅降级，不支持则显「未提供配额估算」）+ 进度条（width=usedPct%，>90% 红 / >70% 橙 / 否则主色，Math.min 夹 0–100、estQuota=0 不 NaN）+ qz.* 数据行 `fmtBytes(qzBytes)`（localStorage qz.* + 节流 5s 的 IDB qz.* 字节）。复用既有 `now` 每秒心跳触发节流刷新。删掉旧 `storageKB()`。
  - ✅ 浏览器实测：概况页渲染真值 `592.8 KB / 37.26 GB（0.0%）`（**配额 ~37GB 直观印证 P1 破 localStorage ~5–10MB 天花板**）+ qz.* 3.8 KB + 进度条按比例；数据源正确（写 2MB 文件后 `idbEntries()` 直接读到 2.00 MB）。0 console error。supervisor 子 Agent PASS（estimate 可选链/catch 安全降级/节流心跳/qzBytes·usedPct 响应式/颜色阈值互斥/除零守卫/storageKB 0 残留引用/fmtBytes 边界/分层无环 八点全过）。npm check+build 0 错 0 警。
  - ⏳ 自动刷新（5s）实时性因无头预览 `visibilityState=hidden` 冻结每秒心跳（实测 uptime 2.5s 不变）验不了 → **待真机验证**（复用 clock/uptime 同一套已上线心跳，真机会刷）。帧率/长任务提示延后到需要时。

---

> 当前循环：**P1、P7 已完成**（VFS 迁 IndexedDB 破天花板 + 存储用量仪表盘做尺子）。下一项候选：P4（大列表虚拟化，性能正餐）/ P5（vfs.children() 信号热点）/ P2（chat 迁 IDB）。
