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
- [x] **F4（P2）Calculator/ImageViewer onKey 吞掉带修饰键的组合**：`Calculator.onKey` 无 `ctrlKey/metaKey/altKey` 守卫 → 焦点在计算器时 Cmd/Ctrl+C 触发 clearAll+preventDefault（没法复制结果）、Ctrl/Cmd+0/-/+ 等被吃。修：onKey 开头 `if (e.ctrlKey||e.metaKey||e.altKey) return`。ImageViewer 同理（Cmd+0/-）。文件：`apps/Calculator.svelte`、`apps/ImageViewer.svelte`。
  - ✅ 实现：两个 `onKey` 开头各加 `if (e.ctrlKey || e.metaKey || e.altKey) return;`（在任何 `preventDefault` 之前）→ 带修饰键组合直接 return、不 preventDefault、冒泡给浏览器/系统；不含 `shiftKey` 故 ImageViewer 的 Shift+R 反向旋转保留。无新 import、无分层/环/可达性影响。
  - ✅ 浏览器实测（计算器，控制流分支真验）：打开计算器→键入 `1·2·3`=「123」→ 派发 **Ctrl+C** keydown→显示仍「123」且 dispatchEvent 返回 true（未 preventDefault，确认提前 return）→ 再派发普通 `c`→清零「0」（普通键零回归）。ImageViewer 为同一行守卫、同位置、同控制流（+/-/0/r/Shift+R 普通键不变）。0 console error。supervisor 子 Agent PASS（计算器无任何想带修饰键的键/ImageViewer Shift+R 保留+普通键不变/守卫在 preventDefault 之前 五点）。npm check+build 0 错 0 警。
- [x] **F5（P2）resetDock 不重置 autohide**：「重置 Dock 布局」只清 order/hidden，不复位 autohide → 开了自动隐藏后重置，Dock 仍隐藏、找回入口（右键菜单）在 Dock 上、不直观。修：`resetDock` 也 `autohide=false`。文件：`system/dockPrefs.svelte.ts`。
  - ✅ 实现：`resetDock()` 末尾加 `dockPrefs.autohide = false;`，现复位 DockPrefs 全部三个持久字段（order/hidden/autohide）。`autohide` 是 DockPrefs 已声明字段（默认 false）；reveal/drag 是 Dock.svelte 局部 `$state` 不在 dockPrefs，`$derived` 链 reactively 重算为 false、reveal 热区 `{#if}` 卸载、右键菜单勾选标签同步更新。
  - ✅ 浏览器实测（Vite dev 动态 import 活模块）：置 `autohide=true`+order/hidden 自定义 → `resetDock()` → autohide=false、order=[]、hidden=[] → 防抖落地后 localStorage `qz.dock` 持久为 `{autohide:false,order:[],hidden:[]}`。0 console error。supervisor 子 Agent PASS（字段合法/三字段全清无遗漏/无 transient 坏交互 三点）。npm check+build 0 错 0 警。
- [ ] **F3（P2 潜伏，低优先）restore 二进制节点 blob 已被独立删除**：当前无「删 blob 不删 node」的触发路径，属健壮性记录，暂不处理。

## 二、功能 / 体验（价值/成本比排序）

- [x] **G1 时钟 App 加 计时器/秒表/世界时钟**（审计推荐第一）：`Clock.svelte` 现仅模拟表盘。加分段切换 秒表(`performance.now`+圈速)/倒计时(到点 `sys.notify`+`playSound`)/世界时钟(`Intl.DateTimeFormat` 多时区)。单文件、复用 windowVisible 暂停定时器、DOM 可验。
  - ✅ 实现：tab 分段（时钟[原表盘]/秒表/计时器/世界时钟）；保留原每秒 `now` effect（表盘+世界时钟）；新增 50ms `nowPerf` tick effect（仅 visible && (swRunning||timerRunning) 时跑）。秒表：swBase 累计+swStart perf 基准、swElapsed 派生、开始/暂停/计圈/复位、fmtSW(mm:ss.cs)。计时器：min/sec 输入→timerEnd perf 绝对目标、remaining 派生、开始/暂停/继续/复位、到点在 tick 回调收口(timerRunning 守卫防重)→`sys.notify`+`playSound`。世界时钟：7 区 `Intl.DateTimeFormat(timeZone)`、void now 每秒刷、try/catch。
  - ✅ 浏览器实测：4 tab；秒表 开始→~1.6s 后 00:02.00、计圈记录、暂停冻结 00:03.01；计时器 0:30→1.6s 后 00:27 递减、0:01 到点→noteHistory 出现「⏲ 计时结束」+回 idle；世界时钟 7 区时间各不同(distinct=7)；0 console error。supervisor 子 Agent PASS（计时器 tick 回调收口非自引用 effect 只触发一次/秒表落定累计+派生/tick 生命周期不空转/状态机 idle·暂停·续/世界时钟 Intl+try-catch/响应式性能/原表盘零回归分层无环/边界 八点全过）。npm check+build 0 错 0 警。
  - 📌 后续观察（supervisor，非阻塞）：计时器用绝对 perf 目标 + tick 最小化暂停 → 若 deadline 在窗口最小化期间越过，通知/音效延到还原后第一个 tick 才补发（剩余值正确、通知仍到只是延迟）。要「最小化也准点响铃」需改走 sys.schedule(schedd 后台、不受窗口可见性约束)。当前与全系统 windowVisible 暂停一致、可接受。
- [x] **G2 文件管理器详情/信息面板**：选中项看不到完整路径/精确字节/创建·修改时间/mime/属主权限明细（VNode 数据已齐，只差展示）。右侧可折叠详情侧栏或右键「显示简介」+ 图片缩略。文件：`apps/Files.svelte`。
  - ✅ 实现：右侧可折叠 `<aside>` 详情面板（工具栏 ℹ 切换 + 右键「显示简介」开，✕ 关）。选中**单个**项时 `infoNode=$derived(selected.length===1?getNode:null)` 解析；展示 预览（图片缩略图 / 否则大图标）+ 类型(mime 或扩展名)/完整路径(`pathOf`)/大小(文件人类可读+精确字节、文件夹「N 项」)/创建·修改全时间戳/属主/权限(rwx+八进制)/你的权限(`accessStr`)。图片缩略图 `$effect` 读 `readBlob`→`URL.createObjectURL`、cleanup `alive=false`+revoke 防泄漏与竞态。内容区+面板包进 `flex flex-1 overflow-hidden` 行、内容区加 `min-w-0` 防溢出。`field(label,value)` snippet 复用行。
  - ✅ 浏览器实测（__qzVfs 种 33 字节文件 + DOM 驱动）：文件面板 路径`/g2-info-test.txt`、大小「33 字节」、类型「TXT 文件」、权限「-rw-r--r-- (644)」、属主 qiezi、你的权限 rw-、创建/修改全时间戳——全对；文件夹(/etc)面板 类型「文件夹」、大小「2 项」(按真实 uuid id 计 children=passwd+profile 一致)、📁 图标非缩略图；ℹ 开 / ✕ 关。0 console error。supervisor 子 Agent PASS（objectURL 无泄漏/竞态[alive 守卫+revoke]、删/改选中项响应式不崩、布局 min-w-0 不破网格滚动/多选条/拖放、folder count 排除回收站、snippet/a11y[img alt]/无环、check+build 0/0 六点全过）；按其建议去掉 `accessStr||'无'` 死分支。npm check+build 0 错 0 警。
- [x] **G5 字体族自定义（主题新维度）**：`Settings` 无 fontFamily、`theme` 无 `--qz-font`。加 fontFamily 字段（系统/无衬线/衬线/等宽/圆体）+ token + Settings select。⭐ 对齐作者第一优先级（美观/自由度），机制已就绪成本低。
  - ✅ 实现：`settings` 加 `fontFamily`（默认 'system'，自动进 SETTINGS_KEYS 随主题导出/同步）+ `FONT_FAMILIES`（5 个，栈锚定通用族 sans/serif/monospace + 中文回退 PingFang/雅黑/宋体）+ `fontStack(id)`（回退[0]）；`theme.activeTokens()` 加 `--qz-font`；`app.css` body `font-family: var(--qz-font, 原栈兜底)`；Settings 界面缩放下加字体 select。换字体走 token 0 组件重渲染。
  - ✅ 浏览器实测：默认 --qz-font 含 system-ui、body 解析自 token；select 选 serif→Georgia/serif、mono→monospace；持久化 qz.settings.fontFamily='mono'；5 项渲染；0 console error。supervisor 子 Agent PASS（select→token→body 链/font-mono 终端等显式字体不受影响/token 机制一致 0 重渲染+var 兜底/白名单随预设·同步+旧数据合并默认/字体栈通用族结尾有可见差异/radius·blur 等零回归/分层无环/未知值回退+fontScale 正交 八点全过）。npm check+build 0 错 0 警。
- [x] **G7 记事本导出/另存下载**：TextEdit 只能存进 VFS、无法导出到本机。工具栏加「⬇ 导出」（Blob+`<a download>`，.md 可选导出 HTML 复用 renderMarkdown）。单文件。打通「VFS→本机」出口。
  - ✅ 实现：常驻顶部工具条（把原 Markdown 编辑/预览切换并入，非 md 显文件名）右侧加「⬇ 导出」(始终) + 「HTML」(仅 md)。`exportFile(asHtml)`：原始导出 = Blob(node.content，.md→text/markdown 其余→text/plain)、文件名=节点名；HTML 导出 = `renderMarkdown` 渲染包进 `<!doctype html>` 完整文档（内联 `<style>` 映射 renderMarkdown 用的 Tailwind 类 .font-semibold/.pl-3/.underline + pre/code 标签样式 → 脱离 app 独立打开也排版正常）、文件名=去 md 后缀+`.html`、`<title>` 经 `esc()` 转义。`downloadBlob` 标准 `<a download>` 点击 + 1000ms 后 revoke 防泄漏。导出不门控 writable（只读文件也能导出）。
  - ✅ 浏览器实测（patch `URL.createObjectURL`+anchor.click 捕获、不真下载）：md 文件导出 → 原始 blob 名 `g7-export-test.md`、mime text/markdown、内容**逐字相等**；HTML blob 名 `.html`、mime text/html、`<!doctype html>` 开头、`<title>` 转义、正文含渲染的 `<strong>bold</strong>`、`&` 转义成 `&amp;`、链接带 target/rel。0 console error。supervisor 子 Agent PASS（工具条重构 md 切换零回归+非 md 显名+导出两态都在、XSS 安全[renderMarkdown 先转义+title esc+download 属性赋值非解析]、download 无泄漏/双free、空文件/无扩展名/二进制/只读边界、内联 style 类映射正确、a11y/无环、check+build 0/0 六点全过）。npm check+build 0 错 0 警。
- [x] **G3 计算器科学模式**：加 标准/科学 切换（√/x²/1/x/π/括号/sin·cos·log/内存键），受控 parser 非 eval。单文件。
  - ✅ 实现：新 `lib/calc.ts` —— 安全递归下降求值 `evalExpr`（**非 eval**）：+ - * / ^(右结合) / 一元正负 / 括号 / 阶乘 ! / 函数 sin·cos·tan·asin·acos·atan·ln·log·sqrt·exp·abs / 常量 π·e；显示符号 ×÷−π√ 归一化；优先级 加减→乘除→一元→幂→阶乘→基元（一元在幂之上 → -2^2=-4）；阶乘 n>170→Infinity 防 DoS、负/非整→NaN；解析器每步消费 token 或抛错→无死循环。`Calculator.svelte` 加 标准/科学 分段切换：标准沿用原状态机（零回归，仅抽出 pushHistory），科学是表达式录入（按钮 append 进 expr、`=` 调 evalExpr、sciResetNext 续算/起新、sciErr→「错误」、内存 MC/MR/M+/M-）；5 列科学键盘；onKey 按模式分发；appList 计算器尺寸 260×380→300×470 容纳科学键盘。
  - ✅ 浏览器实测：parser 22 例全过（含 -2^2=-4、2^-3、5!、sqrt/√/sin/cos/ln/log、π/e、(1+2)*3、错误/缺括号/多余符号）；科学 UI 经按钮：√(16)=4、(2+3)×4=20、2^10=1024、5!=120、不完整 sin(→错误、错误后输入恢复、内存 7 M+→C→MR=7；标准 7+8=15、9×9=81、双向切换状态独立。0 console error。supervisor 子 Agent **抓到 1 真 bug**：续算正则 `/^[+\-×÷*/^!]/` 含 ascii `-` 但漏 U+2212「−」（按钮/键盘实际插入的减号）→ `5 = − 3 =` 丢结果得 -3 而非 2；**已修**（正则补 `−`），复测 `5=−3==2`、`+→8`、`×→12`、结果后数字起新=9。其余 5 点（parser 正确安全无死循环无 eval、标准零回归、科学状态机其余正确、display/render/keyed each、键盘 modifier 守卫/Esc 冒泡）全 PASS。npm check+build 0 错 0 警。
- [ ] **G4 媒体（音视频）查看器**：上传二进制已支持但只能看图。新 `apps/MediaViewer.svelte`（`<audio>`/`<video>` + readBlob objectURL）+ Files 双击按 mime 分流 + appList 登记。
- [ ] **G6 截图工具**：`getDisplayMedia`→canvas→存 VFS+下载。中成本、画面无头难验。

---

> 当前循环：第 3 轮审计；**F1、F2、F4、F5、G1、G2、G3、G5、G7 已完成**（正确性 F 全清）。剩 G4/G6（功能）。下一项：G4（媒体音视频查看器，新 MediaViewer + Files 按 mime 分流）/ G6（截图工具，getDisplayMedia，画面无头难验）。
