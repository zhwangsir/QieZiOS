# QieZiOS 完善与查漏计划 · 第 5 轮（自治完善循环真相源）

> 第 1–4 轮（POLISH/-2/-3/-4）+ 性能阶段（PERF：P1/P2/P4/P6/P7）已完成。本文件是**第 5 轮**待办，来源：2026-06-28 两路子 Agent 对扩大后代码库（重点审第 4 轮新增：recents/appPrefs/widgets/Files marquee/snap flyout/accent-tint）重新审计。
> 执行协议同前：挑价值最高未完成项 → builder 实现 → supervisor 子 Agent check+build+审 diff → 浏览器/DOM 验证 → 中文 commit（带 Co-Authored-By）→ push → 勾 [x]+验证结论 → 同步 CLAUDE.md。一次一项。数据丢失/崩溃 P0 优先，与高价值可见功能交替。

---

## 一、正确性 / 健壮性

- [x] **R5-C1（P1）桌面小组件可生成/停留在屏外，取不回**：`widgetState.addWidget`（widgets.svelte.ts:20-25）初始位置 `120+(n%6)*28` 无视口夹取；且 `Widgets.svelte` 无 onMount/resize 回夹（不像 R4-C4 的桌宠 clampPet）→ 窄屏/缩窗后小组件可落屏外、手柄抓不到。修：addWidget 初始夹 + Widgets onMount+resize clampAll（镜像 DesktopPet R4-C4，用 innerWidth-40/innerHeight-40 保证手柄可抓回）。
  - ✅ 实现：`addWidget` 初始 x/y 夹 `min(120+…, max(0,innerW-40))` / `min(…, max(36,innerH-40))`。`Widgets.svelte` 抽 `clampW(w)`（x∈[0,innerW-40]、y∈[36,innerH-40]），`move()` 改设原始后 clampW（拖不出屏、零行为变化），`onMount` clampAll + addEventListener('resize',clampAll) + cleanup（镜像 R4-C4）。1s tick effect 不动、与 onMount 独立。
  - ✅ 浏览器实测：innerWidth=0 退化 → addWidget/resize 夹到 (0,36) 无 NaN；视口 1280×800 → 屏外 widget(99999,99999) resize 夹到 (1240,760)=(iw-40,ih-40)。0 console error。supervisor 子 Agent PASS（夹算各 case 含退化无 NaN+保 40px 手柄、move 等价、onMount 生命周期无泄漏+无反应式环、window 仅浏览器调用、build 与 1s tick 独立 五点）。npm check+build 0 错 0 警。
- [ ] **R5-C2（P2）forgetRecent 死代码，recents 不随删除清理**：`recents.svelte.ts:31-34` 的 `forgetRecent` 无调用方 → 文件/App 删除后 id 永留 recents（≤20，Spotlight 优雅跳过不崩，但累积死引用且上云同步）。修：vfs.purge（注入式）+ removeUserApp 调 forgetRecent（仿 forgetDockApp 接法）。
- [ ] **R5-C3（P2）calc 词法接受多小数点数字**：`lib/calc.ts:56-62` 数字扫描吞连续 digit+dot，`1.2.3`→parseFloat=1.2 静默丢 `.3`。修：数字片段含 >1 个 `.` 抛错。
- [ ] **R5-C4（P2）标准计算器 ±/% 对「错误」/NaN 显示出字面 NaN**：`Calculator.press('±'/'%')`（80-81 + 键盘 233）`parseFloat('错误')=NaN`→display='NaN'。科学路径已用 isFinite 守卫、标准没有。修：`±`/`%` 前 `Number.isFinite` 守卫，否则 no-op。
- [ ] **R5-C5（P2）窗口左/上边缩放 x/y 无下夹，可缩到屏外左/上**：`Window.svelte` west 分支 `nx=min(ox+dx,right-MINW)` 缺 `Math.max(0,…)`（north 已夹）。修：west 的 nx 加 `Math.max(0,…)`。

## 二、功能 / 体验（价值/成本比排序）

- [x] **R5-F1 自动明暗（跟随系统 + 定时）** [S, 价值极高]：`settings.mode` 仅 dark/light，`viewport` 不监听 `prefers-color-scheme`。扩 mode→dark/light/auto/schedule + lightStart/darkStart；viewport 加 matchMedia(prefers-color-scheme) → `resolvedMode` derived，theme 读它；schedule 复用 schedd。Settings 四段控件。对齐作者#1 美观。无头可验（faked matchMedia 断言 token）。
  - ✅ 实现：settings.mode 扩 `dark/light/auto/schedule` + `lightStart/darkStart`（默认 07:00/19:00，自动进 SETTINGS_KEYS）。viewport 加 `systemDark` $state + matchMedia('(prefers-color-scheme: dark)') 监听。theme 加 `resolvedMode()`（auto→systemDark、schedule→inLightWindow[支持跨午夜]、dark/light 直通）+ 模块级 `$effect.root` 的 `scheduleTick`（60s tick 仅 schedule 时武装）；`activeTokens` 用 `palettes[resolvedMode()]`。TopBar 切换/图标用 resolvedMode（从 auto/schedule 切到显式反面）。Settings 四段控件(2×2)+schedule 时显两个 time 输入。**App.svelte `colorScheme` 改用 resolvedMode（supervisor 抓到这处漏改——原 `settings.mode` 会把 'auto'/'schedule' 灌进 CSS color-scheme 致原生控件配色失效/陈旧）**。
  - ✅ 浏览器实测：暗→#0b0b12 / 明→#eceef4（零回归）；auto 跟随 systemDark（reload colorScheme=light→auto 解析 light）；schedule 全天明窗→明、1 分钟明窗→暗；colorScheme 修复后 auto→'dark'/schedule→'light'（非字面 auto/schedule）；4 段按钮+time 输入；Settings 复位干净。0 console error。supervisor 子 Agent PASS（类型安全 palettes 只收 resolvedMode/resolvedMode 边界/scheduleTick 仅 schedule 武装无泄漏无环/反应式/TopBar 转义/sync 白名单 undefined 安全 + **抓到 App.svelte colorScheme 漏改**[已修验]）。npm check+build 0 错 0 警。live 系统主题切换是标准浏览器行为（CDP 模拟不派发 change 事件、真机即时跟随）。
- [ ] **R5-F2 顶栏快捷设置面板（Quick Settings）** [M, 价值高]：顶栏只有 🍆/🌙/🔔/钟。新 `shell/QuickSettings.svelte`（仿 TopBar 托盘下拉）：明暗/auto、声音开关+音量、勿扰、下一张壁纸、主色swatch。承载 F1/F3。
- [ ] **R5-F3 勿扰 / 专注模式** [S/M, 价值高]：无 dnd。加 `dnd` + 在 `notifications.pushNote` 门控（勿扰时不弹 toast 但仍进 noteHistory）、`soundd` 查 dnd。顶栏/QuickSettings 开关。无头可验（断言 noteHistory 增长但无 toast）。
- [ ] **R5-F4 Files 键盘导航 + F2 改名 + Ctrl+D 复制** [M, 价值高]：Files 仅 Enter/Delete/Ctrl+CXV，无方向键/F2/Ctrl+D/首字母跳。复用现有选择模型+copyNode+startRename，纯接线。无头可验。
- [ ] **R5-F5 壁纸轮播（+可选取色配主色）** [S/M, 价值中高]：单壁纸无轮播。新 `wallpaperSlideshow` persisted + `wallpaperd` 服务（仿 schedd）定时换 wallpaperId；Settings 启用+间隔+多选。可选 canvas 取主色。
- [ ] **R5-F6 拖文件进 App（图片→查看器 / 文本→记事本）+ 拖到桌面** [M, 价值中高]：Window 无 ondrop。Files 内部拖（node id）→查看器加载；外部 OS 文件→createBinaryFile。
- [ ] **R5-F7 更多小组件：待办 + 世界时钟** [M, 价值中]：WidgetKind 仅 3 种。扩 KINDS + Widgets 渲染分支；待办接现有 reminders、世界时钟复用 Clock 的 Intl 时区。
- [ ] **R5-F8 窗口置顶 / pin** [S, 价值中]：processes 无 alwaysOnTop。加标志 + 内核 setter + z 序保持置顶；标题/chip 右键「钉在最前」。无头可验（断言 z 序）。

---

> 当前循环：第 5 轮；**R5-C1 + R5-F1（自动明暗）已完成 ✅**。剩 C2-C5（正确性）+ F2-F8（功能）。下一项建议：R5-C2-C5（正确性小修，4 项可一轮批量清，轮换正确性）/ R5-F3（勿扰）/ R5-F4（Files 键盘导航）/ R5-F2（QuickSettings）。
