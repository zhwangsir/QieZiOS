# UI/UX 调研报告：参考站 macos27.kimi.page vs QieZiOS

> 调研日期：2026-07-18 · 调研方式：线上站点抓取（HTML/JS bundle 2.4MB/CSS 83KB 静态分析）
> 结论一句话：**参考站赢在"视觉仿真度与仪式感"，QieZiOS 赢在"功能深度与平台能力"。差距集中在最外层 10% 的观感打磨——这恰是第一印象的决定项。**

---

## 一、参考站「macOS 27」是什么

- **定位**：`macOS 27 — a pixel-faithful Liquid Glass macOS simulation running entirely in your browser.`（HTML meta 原文）——目标是**像素级复刻 macOS Tahoe "Liquid Glass" 视觉**的纯前端仿真，不追求真实功能。
- **技术栈**：React（`#root` 挂载）+ zustand 状态管理 + framer-motion（弹簧物理 `spring/stiffness/damping`）+ Tailwind。字体用 Google Fonts **Inter**（opsz 可变字重 100–900）。

## 二、参考站优势亮点（证据来自 bundle 字符串）

### 1. Liquid Glass 液态玻璃（核心卖点）
- **SVG 折射滤镜**：入口 HTML 内联 `lg-refraction` 滤镜——`feTurbulence`（fractalNoise, baseFrequency 0.012/0.02）→ `feGaussianBlur`（σ2.2）→ `feDisplacementMap`（scale 12）做**光线折射扭曲**，Chromium 下 `backdrop-filter: url(#lg-refraction)`。
- **高光描边**：bundle 中出现 `"Can we push the specular rim to 60% on the dock?"`——玻璃边缘有 **specular rim（镜面高光边）**，Dock 上高光强度 60%。
- 效果：玻璃不只是"模糊+半透明"，而是有**折射、色散、高光**三层物理质感。

### 2. 仪式感流程（QieZiOS 完全没有的一层）
- **boot 开机画面 → login 登录 → lockscreen 锁屏**全流程模拟。
- 系统菜单含 `About This Mac` / `Restart` / `Sleep` / `Lock Screen` / 关机——完整的"这是一台真电脑"心智闭环。

### 3. 动效精细度
- **Genie 神灯最小化**：`"genie: clip-path trapezoids in 500ms"` + PR 记录 `"PR #142: Add genie minimize animation"`——用 clip-path 梯形形变 500ms 吸入 Dock（QieZiOS 的 F10 神灯动画至今仍挂起）。
- **弹簧物理**：framer-motion spring（stiffness/damping 参数化），窗口拖拽/开合带物理回弹，而非线性过渡。
- Dock **magnification 悬停放大**波形更陡更弹。

### 4. 系统功能仿真清单
- 应用：Finder / Safari / Notes / Calculator / Terminal / Calendar / Photos / Music / Mail / Messages / Contacts / App Store / System Settings / **Siri**。
- 系统层：**Mission Control**（PR 记录）+ **Stage Manager** + **Control Center**（Wi-Fi/Bluetooth 开关）+ Notification Center + Launchpad + Spotlight + 桌面 widgets。
- 壁纸：Sequoia / Tahoe 风格内置壁纸 + 明暗双模式。

### 5. 图标与字体
- 专业图标绘制（非 emoji），Inter 可变字体排版 → 视觉统一性远超 emoji 图标。

## 三、与 QieZiOS 差异对比

| 维度 | 参考站 macOS 27 | QieZiOS 现状 | 差距判定 |
|---|---|---|---|
| 玻璃质感 | 折射滤镜 + specular 高光 + saturate | `qz-glass`（blur + color-mix 半透明） | **明显落后** |
| 图标 | 绘制图标 | emoji（🍆📦🖥️…） | **明显落后**（且违反图标统一约束） |
| 动效 | 弹簧物理 + genie 500ms | `pop` 190ms 线性缩放淡出 | **落后**（F10 神灯仍待办） |
| 仪式感 | boot/login/lock 全流程 | 无，直接进桌面 | **空白** |
| 菜单栏 | 左侧应用菜单 + 右侧状态菜单 | 任务 chip + 托盘图标 | 部分落后（无应用菜单） |
| 多桌面 | Mission Control + Stage Manager | Exposé（单桌面任务视图） | 部分落后 |
| AI | 仅 Siri 外壳 | **真 AI**：双协议 agent loop、工具驱动系统、织进各 App、Live2D 口型 | **大幅领先** |
| 文件系统 | 仿真 | 真 VFS（IndexedDB/blob/权限/回收站） | **大幅领先** |
| 终端 | 仿真 | 真 shell（脚本 AST/管道/作业/cron/man） | **大幅领先** |
| 平台生态 | 无 | 沙箱 App SDK + 应用商店 + 网页 App + 导入导出 + Docker 自托管 | **大幅领先** |
| 自定义 | 明暗+壁纸 | 主题 token 全维度 + 命名预设 + 自定义 CSS + 主色渗透 + 字体族 | **大幅领先** |
| 账号/同步 | 无 | 后端账号 + 云同步 | **大幅领先** |

**结论**：参考站是"好看的壳"，QieZiOS 是"有灵魂的系统套了件朴素外衣"。两者不在同一战场，但用户第一眼的竞争力判断由外壳决定 → **UI/UX 是当前最高性价比的投入方向**。

## 四、UI/UX 改进建议（按 ROI 排序，全部映射现有架构）

### P0 · 视觉地基升级（投入小、观感跃升最大）

1. **U1 图标体系去 emoji 化 → Lucide 图标**（呼应全局图标统一约束；Svelte 用 `lucide-svelte`，与 Lucide React 同源同风格）
   - 改动面：`apps/appList.ts` 的 icon 字段从 emoji 字符改为图标名，Dock/顶栏/Launchpad/Spotlight/Files 统一经封装组件 `<Icon name>` 渲染。
   - 风险：低（纯渲染层替换，注册表结构不变）。

2. **U2 玻璃质感三级跳（向 Liquid Glass 看齐但保持自主风格）**
   - L1（半天）：`qz-glass` 加 `saturate(140%–180%)` + 1px 内高光描边（`box-shadow: inset 0 1px 0 rgba(255,255,255,.15)`）+ 边缘 60% specular rim（伪元素渐变边框）。
   - L2：引入 SVG 折射滤镜（直接借鉴参考站 `lg-refraction` 的 turbulence+displacement 配方）作为**可选设置项**「玻璃折射」，默认关（`backdrop-filter: url()` 仅 Chromium，需降级路径）。
   - 改动面：`app.css` 的 `qz-glass` 工具类 + `system/theme.svelte.ts` 加 token。符合"换肤只改 CSS 变量"地基。

3. **U3 字体升级**：锚定 Inter（或系统栈 + Inter 可变字重），`FONT_FAMILIES` 加「Inter」预设，`--qz-font` token 机制现成。

### P1 · 动效与手感

4. **U4 弹簧动物理化**：窗口拖拽释放/开合改弹簧曲线。Svelte 无 framer-motion，可用 `svelte/motion` 的 `Spring`（官方内置，零新依赖）驱动窗口 transform；`lib/motion.ts` 的 `pop` 加 overshoot 回弹参数。尊重 `viewport.reducedMotion` 现有守卫。
5. **U5 Genie 神灯动画落地**（清掉挂起的 F10）：clip-path 梯形插值 500ms，最小化目标取 Dock 图标屏幕坐标（`dockPrefs` + getBoundingClientRect），`out:` 自定义过渡实现。无头验不了视觉 → 标 ⏳ 真机验证。
6. **U6 Dock magnification 波形调优**：由线性 scale 改高斯/余弦波形（距离衰减更陡），与弹簧联动。

### P2 · 仪式感与系统闭环

7. **U7 开机/锁屏/登录流程**（全新模块 `shell/BootScreen.svelte` + `system/session.svelte.ts`）：
   - 开机：logo + 进度条（可跳过）→ 登录（复用 `system/users.svelte.ts` 用户表选用户）→ 桌面淡入。
   - 锁屏：`Ctrl+Cmd+Q` + 顶栏菜单「锁定」→ 壁纸全屏 + 时钟 + 点击解锁。
   - 系统菜单：顶栏 🍆 左侧加 Apple 菜单位（关于本机→SysMonitor 概况 / 锁定 / 睡眠[锁屏+暂停 tick] / 重启[reload]）。
   - 设置加「跳过开机动画」开关。全部走现有 persisted/事件总线模式。

8. **U8 顶栏应用菜单**：活动窗口的 App 名 + File/Edit/Window 下拉（各 App 经 registry 可选声明 `menus`），向真 macOS 心智靠拢；无声明的 App 回退只显窗口操作（最小化/关闭）。

### P3 · 差异化补强（不做仿真，做自己）

9. **U9 控制中心化 QuickSettings**：现有 `QuickSettings.svelte` 已是雏形，升级为毛玻璃大面板（参考站 Control Center 布局）：大色块 toggle（Wi-Fi 隐喻→AI 在线/勿扰/声音）+ 亮度位→界面缩放 + 主色 swatch。
10. **U10 欢迎首秀**：首次启动的 Welcome 改为全屏引导（三页：这是什么/AI 能做什么/快捷键），像素级对标参考站第一印象——这是新用户 30 秒留存的关键。

## 五、功能完善方案（backlog，映射项目里程碑工作流）

| # | 项 | 优先级 | 验证方式 |
|---|---|---|---|
| U1 | Lucide 图标替换 emoji | P0 | DOM 断言无 emoji、check/build |
| U2 | 玻璃高光+saturate+可选折射 | P0 | CSS token 快照、真机目检 |
| U3 | Inter 字体预设 | P0 | token 快照 |
| U4 | 弹簧化窗口动效 | P1 | 单测 spring 参数 + 真机 |
| U5 | Genie 最小化（F10 清账） | P1 | ⏳ 真机 |
| U6 | Dock 放大波形 | P1 | 纯函数波形单测 |
| U7 | boot/lock/login + Apple 菜单 | P2 | ✅ 完成（M3，vitest 状态机+菜单构建 16 例） |
| U8 | 应用菜单栏 | P2 | ✅ 完成（M3，关机确认三段流程） |
| U9 | QuickSettings 控制中心化 | P3 | ✅ 完成（M4，macOS 风格控制中心面板，四区卡片复用既有 store） |
| U10 | 首秀引导 | P3 | ✅ 完成（M4，全屏三页引导 + `qz.onboarded` 持久化门控） |

**建议节奏**：U1–U3 作为 M1「视觉地基」一个里程碑打包（同改渲染层，回归一次）；U4–U6 为 M2「动效」；U7–U8 为 M3「仪式感」；U9–U10 为 M4「收尾」。每项含 TDD 测试 + 全量回归（check + build）+ STATE 记录，遵守既有里程碑约定。

## 六、不借鉴什么（明确排除）

- ❌ **像素级复刻 macOS**：项目标尺是"更是作者的"，不是打赢仿真器；Liquid Glass 取其质感配方、不抄其像素。
- ❌ **React/framer-motion 迁移**：Svelte 5 技术栈已拍板，`svelte/motion` Spring 等价可达。
- ❌ **仿真功能填充**（假 Safari/假 Mail）：QieZiOS 的真功能深度已是护城河，不回头做假。

---

## 七、M5 移动端适配方案（参考 ios27.kimi.page 调研，2026-07-18）

### 7.1 参考站「iOS 27 模拟器」调研结论（证据来自 bundle）

- **技术栈**：React + zustand（`showIsland/toggleCC/openApp/pushNotification` 单一 store）+ framer-motion 弹簧（stiffness 500/damping 25）。
- **骨架**：LockScreen（「向上轻扫以解锁」上滑解锁）→ HomeScreen（图标网格 + 底部 Dock 托盘 + Home Indicator 横条）→ App 全屏。状态栏右侧点击 → 控制中心；侧边电源键 → 锁屏。
- **Dynamic Island（许愿岛）**：`showIsland({appId,title,subtitle,ttl})` —— 计时器运行/结束、手电筒开启等系统活动实时上岛，自动消隐。
- **控制中心**：52px 圆角按钮网格，彩色 iconBg（飞行模式 #ff9500 橙等）+ 手电筒/相机快捷入口。
- **设置 App**：iOS 经典列表——左侧彩色圆角图标（iconBg）+ 标签 + 右侧开关/ Chevron，子页「墙纸/关于本机」带返回（backLabel）。
- **跨 App 联动**：相机拍照直接进相册；信息 App 有未读消息；计时器到点 → 灵动岛 + 系统通知双通道。
- **真·深色模式**：设置开关全系统即时生效（QieZiOS 已有等价能力 ✅）。
- **HTML 层**：`viewport-fit=cover` + `user-scalable=no` + `apple-mobile-web-app-capable` + `theme-color`。

### 7.2 移动端差距对照（QieZiOS 现状）

现状：移动模式 = 窗口铺满 + 禁拖拽缩放 + Dock 横滚（`viewport.isMobile` ≤640px）。**缺**：安全区适配、iOS 状态栏、Home 屏幕网格、Home Indicator、控制中心手势、锁屏、触控目标放大、长按菜单。

### 7.3 M5 backlog（iOS 化移动外壳，isMobile 时启用，桌面零回归）

| # | 项 | 内容 | 映射 |
|---|---|---|---|
| M5.1 | HTML 移动基座 | `index.html`：viewport-fit=cover / user-scalable=no / apple-mobile-web-app-capable / theme-color 跟随主题；`app.css` 加 safe-area-inset 工具类 | 新 ✅ |
| M5.2 | 移动状态栏 | `shell/mobile/MobileStatusBar.svelte`：左时间右 信号/Wi-Fi/电池 图标（Lucide），替代 TopBar（isMobile 时） | 新 ✅ |
| M5.3 | Home 屏幕 + Dock 托盘 | `shell/mobile/MobileHome.svelte`：4 列图标网格（大圆角 Lucide 图标）+ 底部 4 图标托盘；点击启动 App | 新 ✅ |
| M5.4 | Home Indicator | 底部横条：tap → 全部最小化回主屏；有窗时显示 | 新 ✅ |
| M5.5 | 控制中心 | 状态栏右侧点击 → 全屏毛玻璃面板：大色块 toggle（明暗/勿扰/声音/AI 在线）+ 音量/界面缩放滑块（复用 QuickSettings 状态接线） | 新 ✅ |
| M5.6 | 锁屏 | `shell/mobile/MobileLockScreen.svelte`：壁纸 + 大时钟 + 「向上轻扫以解锁」手势（pointer drag 跟手 + 弹簧回弹/解锁）；桌面端复用为 U7 锁屏 | 新（与 U7 合并）✅ |
| M5.7 | 灵动岛等价物 | 顶部胶囊：计时器到点/提醒/AI 回复完成时 `showIsland(title,subtitle,ttl)` 复现；数据走现有 `sys.notify` 事件流 | 新 ✅ |
| M5.8 | 触控打磨 | 长按桌面图标 → 现有 ContextMenu；按钮最小 44px；窗口顶栏加大关闭热区 | 改 ✅（窗口热区 M5 已做；长按菜单 M4 完成） |
| M5.9 | Exposé 即 App Switcher | 移动端上滑悬停/双击 Indicator → Exposé 卡片视图（复用现有） | 改 ✅ |

> 已完成 M5.1–M5.7 + M5.9（2026-07-18）：M5.1 的 safe-area 以内联 `env(safe-area-inset-*)` 任意值落在各移动组件里（不改 `app.css`，避免与 M1 并行改同一文件）；M5.8 的「窗口顶栏加大关闭热区」已随本轮落地（标题栏 h-11 + 红绿灯 ×1.5），桌面图标长按菜单已由 M4 完成（见「十、M4 实施记录」）；M5.9 经核对 Exposé 现有 `auto-fill minmax(190px,1fr)` 网格在窄屏自动退化为单列，无需改动即满足。

### 7.4 里程碑排期（更新）

- **M1 视觉地基**：U1 Lucide 图标 + U2 玻璃升级 + U3 Inter 字体（+ vitest 测试基座）
- **M2 动效**：U4 弹簧化 + U5 Genie + U6 Dock 波形
- **M3 仪式感**：U7 boot/login/lock + U8 应用菜单（M5.6 锁屏提前并入 M5，与 U7 共用组件）
- **M4 收尾**：U9 控制中心化 + U10 首秀引导
- **M5 移动端**（本轮与 M1 并行启动）：M5.1–M5.9 iOS 化移动外壳

---

## 八、M5 实施记录（2026-07-18）

### 改动文件清单

| 文件 | 改动 |
|---|---|
| `index.html` | viewport 加 `viewport-fit=cover / user-scalable=no`；新增 `apple-mobile-web-app-capable`、`apple-mobile-web-app-status-bar-style`、`theme-color` meta |
| `src/shell/mobile/mobileUi.svelte.ts` | 新。移动外壳共享态：`ccOpen`（控制中心）、`locked`（锁屏，仅移动端首启 true）+ open/close/unlock |
| `src/shell/mobile/gesture.ts` | 新。纯函数：`shouldUnlock`（上滑 ≥1/3 屏）、`rubberBand`（0.85 阻尼）、`isDoubleTap`（280ms 窗口） |
| `src/shell/mobile/gesture.test.ts` | 新。vitest 5 例（阈值/回弹/下滑不解锁/阻尼/双击窗口） |
| `src/shell/mobile/appIcons.ts` | 新。appId → Lucide 图标映射（16 个内置 App + AppWindow 回退），仅移动外壳自用 |
| `src/shell/mobile/MobileStatusBar.svelte` | 新。左实时时钟；右 信号/Wi-Fi/电池（Battery API 有则显百分比，按电量换图标）；点右侧 → 控制中心 |
| `src/shell/mobile/MobileHome.svelte` | 新。4 列图标网格（`visibleAppDefs`）+ 底部 4 图标玻璃托盘（`sortDockApps` 前 4），在跑 App 带指示点；点击启动/还原最上层窗 |
| `src/shell/mobile/MobileHomeIndicator.svelte` | 新。底部横条：单击 → 全部最小化回主屏（延迟 280ms 等双击判定）；双击 → Exposé |
| `src/shell/mobile/MobileControlCenter.svelte` | 新。全屏毛玻璃面板：2×2 大色块 toggle（明暗/勿扰/声音/AI 在线）+ 音量/界面缩放滑块 + 主色色板；状态全部复用 settings/dnd/soundPrefs/aiConfig |
| `src/shell/mobile/MobileLockScreen.svelte` | 新。壁纸 + 大时钟/日期 + 上滑解锁（pointer drag 跟手 + 过阈飞出 / 未过弹簧回弹） |
| `src/shell/mobile/MobileIsland.svelte` | 新。顶部常驻黑色胶囊，notify 时展开活动卡片（等级色点+标题/副标题+操作键），消隐自动收回 |
| `src/shell/Desktop.svelte` | 改。`viewport.isMobile` 分支：隐藏 TopBar/Dock/DesktopIcons/StickyNotes/Widgets/Notifications，挂载 6 个移动组件；窗口层 top 让位状态栏+safe-area |
| `src/shell/Window.svelte` | 改。移动端标题栏 h-9→h-11、红绿灯容器 `scale-[1.5]` 放大命中区（桌面原样；未动 WindowControls.svelte） |

### 关键设计决策

- **桌面零回归 = 单一分支点**：所有移动/桌面差异都走 `viewport.isMobile` 三元/条件块；桌面端渲染的 DOM 与改前字节级一致（已核对 Desktop/Window 两处分支默认值）。
- **通知只接一处数据源**：灵动岛直接读 `notifications.items`（`sys.notify` → 通知中心服务 → pushNote），ttl/勿扰/历史全部由上游既有逻辑兜底，岛上零状态、零重复实现；移动端同时隐藏桌面 toast 层（同一数据源二选一渲染）。
- **锁屏手势纯函数化**：阈值/阻尼/双击判定抽在 `gesture.ts`，vitest 覆盖；组件只做 pointer 事件接线。解锁=飞出动画 240ms 后置 `locked=false`（刷新重新锁屏，不持久化）。
- **状态接线复用，语义不改**：控制中心 6 项全部写回既有 store（与 QuickSettings 同源），不新增任何设置字段。
- **AI 在线 tile**：反映 `aiConfig.apiKey` 是否已配置（无「AI 开关」既有语义），点击跳设置 App。
- **app.css 未动**：M5.1 的 safe-area 全部以 `pt-[calc(env(safe-area-inset-top)+…)]` 任意值内联（避免与 M1 并行改 app.css 冲突）；工具类若后续需要可再抽。
- **WindowControls.svelte 未动**（不在本里程碑文件所有权内）：红绿灯放大用外层 `scale-[1.5]` 包裹实现，视觉+热区同步放大。

### 验证结果

- `npx vitest run src/shell/mobile/gesture.test.ts`：5/5 通过。
- `npm run check`（svelte-check + tsc）：0 errors / 0 warnings。
- `npm run build`：成功（438ms）。

### 遗留

- ⏳ 手势精度（解锁阈值 1/3、阻尼 0.85、双击 280ms）待真机调优；锁屏/CC/岛视觉无法无头验证，待真机。
- ⏳ M5.8 剩余：桌面图标长按 → ContextMenu（下一轮，涉及 DesktopIcons.svelte，不在本轮文件所有权内）。
- ⏳ Battery Status API 仅 Chromium 系可用；Safari/Firefox 只显电池图标不显百分比（已按此设计降级）。
- ⏳ 锁屏暂无密码/PIN（U7 boot/login 统一做，本组件已预留桌面复用位）。

---

## 九、M3 实施记录（2026-07-18 · U7 开机/登录/锁屏 + U8 顶栏菜单）

### 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/system/session.svelte.ts` | 新。会话状态机：`SessionPhase`（boot/login/desktop/locked）+ TRANSITIONS 白名单迁移表（非法迁移返回 false 幂等拒绝）；`bootComplete`（移动端直进锁屏/桌面端去登录）/`loginAs`/`lock`/`unlock`/`reboot`；`sessionPrefs.skipBoot`（独立 `qz.session` 持久化键）；`power`/`powerConfirm` 关机两段态；`buildSystemMenu`/`buildAppMenu` 纯函数（注入回调，结构化兼容 MenuItem，避免 system→shell 反向依赖） |
| `src/shell/boot/BootScreen.svelte` | 新。黑底 logo + 1.5s rAF 进度条；`skipBoot` 或 `reducedMotion` 直调 `bootComplete` 跳过 |
| `src/shell/boot/LoginScreen.svelte` | 新。壁纸 + 毛玻璃罩 + 大时钟/日期 + users 表用户列表（首字母圆形头像 + Lucide User 角标），点击 `loginAs` 进桌面（无密码，PIN 留待后续） |
| `src/shell/boot/LockScreen.svelte` | 新。由 M5 MobileLockScreen 泛化为两端统一锁屏：壁纸 + 大时钟 + 当前用户（session.user 回退账号访客）+ vignette 压暗；移动端上滑手势（gesture.ts 纯函数判定），桌面端上滑/点击/任意键解锁；`svelte:window` 须组件顶层 → 键盘守卫收进 handler |
| `src/system/session.test.ts` | 新。vitest 16 例：合法全链/非法迁移拒绝/任意阶段 reboot/bootComplete/loginAs 阶段守卫/lock·unlock 幂等/关机确认三步/buildSystemMenu 序列·分割·danger·回调顺序/buildAppMenu 有无活动窗两态 |
| `src/App.svelte` | 改。按 phase 渲染（boot/login 不挂 Desktop；desktop 与 locked 共用同一 Desktop 实例 → 锁定只盖锁屏、窗口状态原样保留）；关机确认框（z-10009 毛玻璃模态）与关机黑屏「已关机」（z-10010，点击/任意键 reload） |
| `src/shell/TopBar.svelte` | 改。🍆 按钮接系统菜单（`openMenuAt` + `buildSystemMenu`）；🍆 右侧新增粗体活动 App 名按钮（无活动窗显「桌面」）接 App 菜单 |
| `src/shell/menu.svelte.ts` | 改。新增 `openMenuAt(x, y, items)`：按估算宽高做视口边缘夹取后定点开菜单（`openMenu` 改为薄封装） |
| `src/shell/Desktop.svelte` | 改。键盘守卫：关机确认框开着时 Esc 取消/Enter 确认并吞掉其它键；locked 阶段吞掉全部桌面快捷键；新增 Ctrl/Cmd+Q 锁定 |
| `src/shell/mobile/mobileUi.svelte.ts` | 改。移除旧移动端 `locked` 态（并入统一 session 状态机） |
| `src/shell/mobile/MobileControlCenter.svelte` | 改。头部加锁定按钮：关面板 → `lock()` 进统一锁屏 |
| `src/apps/Settings.svelte` | 改。新增「系统」小节：跳过开机动画开关（`sessionPrefs.skipBoot`） |
| `src/lib/motion.ts` / `motion.test.ts` | 顺带修 M2 遗留：神灯 clip 底角捏合指数 `t^1.4→t^0.6`（中点保持上宽下窄漏斗）；测试适配 Svelte 5 过渡 css 单参签名、magnify 远距断言避开浮点下溢 |

### 关键设计决策

- **状态机先行，UI 只是渲染函数**：所有流程合法性收口在 TRANSITIONS 表（如 boot→desktop 跳登录、login→locked 一律拒绝），UI 层无论怎么触发都不会把会话带进非法态；菜单构建同理抽成纯函数，TDD 裸跑不碰 DOM/内核。
- **锁定 ≠ 卸载**：desktop 与 locked 共用同一 Desktop 实例（`{:else}` 同分支），锁屏只是更高 z 层的覆盖 → 锁定后窗口/文件/播放状态零损耗，解锁即回原样。boot/login 阶段则刻意不挂 Desktop（通知/服务随 Desktop onMount 启动，避免未登录先跑服务）。
- **「用户主动锁定」与「移动端首启锁屏」分流**：`lock()` 只许 desktop→locked；boot→locked 留在迁移表里专供 `bootComplete` 直迁。
- **键盘语义单点收口**：关机确认框的 Esc/Enter、锁屏吞键、Ctrl/Cmd+Q 全走 Desktop 既有全局 handler（按「确认框 > 锁屏 > 菜单 > …」优先级短路），不在各组件分散挂 window listener 抢键。
- **关机三段式**：菜单「关机」→ `askShutdown` 确认框（防误触，macOS 心智）→ `confirmShutdown` 置 `power.off` 黑屏 → 点击/任意键 reload 回开机流程。会话态不持久化：刷新 = 重新开机，是有意设计。
- **Web 端语义简化**：「睡眠」合并为锁定（无真睡眠）；「关于本机/关于<App>」统一进任务管理器概况；登录无密码（PIN 预留）。

### 验证结果

- `npx vitest run`：5 文件 52 例全绿（session.test.ts 16 例新增，motion.test.ts 19 例修复后通过）。
- `npm run check`（svelte-check + tsc）：0 errors / 0 warnings。
- `npm run build`：成功（502ms）。

### 遗留

- ⏳ 开机/登录/锁屏/关机黑屏视觉与手势无法无头验证，待真机目检。
- ⏳ 登录/锁屏暂无密码/PIN（组件已预留位）。
- ~~⏳ App 级自定义菜单~~ ✅ M34 已清账：机制 M12.2 已通（registry `menus` → buildAppMenu 合并 → TopBar 渲染），M34 补齐 textedit/clipboard/appstore 三家真实全局动作菜单（registry.test.ts +9 例）；无全局动作可用的 App（Assistant/Screenshot/Reminders 等）保持回退窗口操作四项。

---

## 十、M4 实施记录（2026-07-18 · U9 控制中心化 + U10 首秀引导 + M5.8 长按菜单 + 图标去重）

### 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/shell/QuickSettings.svelte` | 改。小下拉 → macOS 风格控制中心：毛玻璃大面板（顶栏 ⚙️ 右上弹出，w-80≈320px），四区圆角卡片——连接区（AI 在线/勿扰 2×2 大色块 toggle，激活态 bg-qz-accent）、显示区（明/暗/自动/定时四段 + 界面缩放滑块带百分比读数）、声音区（开关 + 音量滑块）、外观区（accentPresets 主色 swatch + 下一张壁纸）。顶栏 ⚙️ 入口不变，自管开关 + 点外部关闭 |
| `src/system/aiConfig.svelte.ts` | 改。抽出 provider 感知纯函数 `aiReady`（openai 可空 key / anthropic 必填非空白 key），桌面与移动控制中心共用同一「AI 在线」判定 |
| `src/system/onboarding.svelte.ts` | 新。`onboardPrefs`（persisted 键 `qz.onboarded`，不入 SETTINGS_KEYS、随 qz.* 同步）+ `shouldShowOnboard` 纯函数 + `onboarding` 运行时开关 + `openOnboarding`/`finishOnboarding`（完成与跳过同语义写标记） |
| `src/shell/Onboarding.svelte` | 新。全屏三页首秀引导：①这是什么（logo + Web OS 定位 + 真窗口/真文件/真 Shell 三卡）②AI 能做什么（三要点 + 「去设置 AI」入口）③快捷键速查（精选 6 条 + 按 ? 提示）；壁纸背景 + 压暗景深、页点/上一步/下一步/开始使用、可跳过、safe-area 适配；z-10002 低于锁屏 |
| `src/shell/Desktop.svelte` | 改。onMount 首启门控由「无会话还原则开 Welcome 窗」改为 `shouldShowOnboard` 判定 → 未完成开全屏引导；完成后不再自动开 Welcome（Welcome App 保留手动打开）；键盘守卫：引导开着时 Esc/Enter=完成并吞掉其它键 |
| `src/shell/mobile/gesture.ts` | 改。新增长按纯函数：`LONG_PRESS_MS=500`、`LONG_PRESS_TOLERANCE=10`、`isLongPress`、`longPressCancelled`（x/y 较大者超容差即取消） |
| `src/shell/mobile/MobileHome.svelte` | 改。网格 + 托盘图标统一 pointer 接线：长按 ≥500ms 无超容差位移 → `openMenuAt` 唤起全局 ContextMenu（打开/最小化全部/关闭全部/固定·移除，与 Dock 右键同款项）；位移/抬起/pointercancel 清计时，`menuFired` 吞掉长按后的 click 防误开 App |
| `src/shell/DesktopIcons.svelte` | 改。菜单项构建抽成 `iconMenuItems`（打开/重命名/删除，右键与长按共用同一份）；触屏长按触发即退出拖拽态（dragId=null）再开菜单 |
| `src/lib/icons.ts` | 改。并入 M5 的 appIcons.ts：`APP_TO_ICON`（17 个内置 App）+ `appIconName`（未知 appId 回退 AppWindow），与 EMOJI_TO_ICON 的 App 段语义一一对应 |
| `src/shell/mobile/appIcons.ts` | 删。并入 `src/lib/icons.ts` —— 全系统图标数据层收敛为唯一一处 |
| 测试 | 新 `src/system/onboarding.test.ts`（2 例）、`src/system/aiConfig.test.ts`（2 例）；`gesture.test.ts` +2 例、`icons.test.ts` +2 例 |

### 关键设计决策

- **控制中心只接线、不新增状态**：U9 四区全部写回既有 store（settings/dnd/soundPrefs/aiConfig），与 M5 MobileControlCenter 同源 → 桌面/移动两端控制中心语义一致、设置项不分裂；「AI 在线」判定抽成 `aiReady` 纯函数两端共用。
- **首秀引导 z 序刻意低于锁屏**：移动端首启 boot→locked 时 Desktop 已挂载（onMount 即触发引导），z-10002 < 锁屏 10003 → 引导先藏于锁屏下、解锁自然露出；桌面端 login 后才挂 Desktop 无此时序问题；boot/login 阶段不挂 Desktop → 引导绝不在开机阶段弹出。
- **长按与点击共存的时序坑**：长按触发菜单后随后的 pointerup 仍派生 click → `menuFired` 标记在 onTap 头部吞掉一次；位移超容差/抬起/pointercancel 都清计时；DesktopIcons 长按触发先 `dragId=null` 退出拖拽态再开菜单，避免「菜单开着、图标还在跟手」。
- **菜单项单一来源**：移动端长按菜单与 Dock 右键同款项构建；桌面图标右键与长按共用 `iconMenuItems` → 各入口菜单永不走偏。
- **`qz.onboarded` 独立持久化键**：不入 SETTINGS_KEYS 主题白名单（不随主题导入/导出），随 qz.* 云同步；完成与跳过同语义（都写标记不再弹），Welcome App 保留从 Launchpad/Dock 手动打开看 4 卡片。

### 验证结果

- `npx vitest run`：7 文件 60 例全绿（新增 8 例：onboarding 2 / aiConfig 2 / gesture +2 / icons +2）。
- `npm run check`（svelte-check + tsc）：0 errors / 0 warnings。
- `npm run build`：成功（489ms）。

### 遗留

- ⏳ 控制中心面板观感、三页引导排版、长按手感（500ms/10px 阈值）无法无头验证，待真机目检。

---

## 十一、全里程碑总结（2026-07-18 · UI/UX 改造收官）

### M1–M5 交付清单

| 里程碑 | 交付内容 | 状态 |
|---|---|---|
| **M1 视觉地基** | U1 图标 Lucide 化（`lib/icons.ts` + `iconRegistry.ts` + `Icon.svelte` 三层体系，全系统 emoji 渲染下屏）；U2 玻璃升级（saturate 160% + sheen 内高光 + 可选 SVG 折射）；U3 Inter 可变字重预设 | ✅ |
| **M2 动效** | U4 弹簧化（`springEasing` 阻尼谐振子 + `kickSettle` 落位回弹 + pop 真弹簧）；U5 Genie 神灯最小化/还原（F10 清账，clip-path 梯形插值 500ms 吸入 Dock）；U6 Dock 高斯放大波形（`magnify` + 对称 margin 负反馈） | ✅ |
| **M3 仪式感** | U7 会话状态机（`session.svelte.ts` boot→login→desktop⇄locked）+ 开机/登录/锁屏三屏 + Ctrl/Cmd+Q 锁定；U8 顶栏系统菜单 + 活动 App 菜单 + 关机三段流程 | ✅ |
| **M4 收尾** | U9 QuickSettings 控制中心化（四区卡片，两端语义统一）；U10 全屏三页首秀引导（`qz.onboarded` 门控，取代首启自动开 Welcome）；M5.8 移动端图标长按菜单；图标映射去重（appIcons.ts 并入 icons.ts） | ✅ |
| **M5 移动端** | M5.1–M5.7 + M5.9 iOS 化移动外壳（移动基座/状态栏/Home 网格+托盘/Home Indicator/控制中心/锁屏/灵动岛；Exposé 窄屏自适应）；M5.8 触控打磨随 M4 完成 | ✅ |

**测试基座**：vitest 7 文件 60 例——icons 8 / gesture 7 / motion 19 / settings 6 / session 16 / onboarding 2 / aiConfig 2；`npm run check` 0 错 0 警；`npm run build` 通过。全部里程碑遵循「纯函数抽离 → TDD → 全量回归 → STATE/TEST_LOG 记录」约定。

### 待真机验证项汇总（无头环境验不了视觉/手感，统一 ⏳）

- **M1**：玻璃折射视觉效果（实验项，`backdrop-filter: url()` 仅 Chromium，默认关闭）。
- **M2**：神灯吸入流畅度、弹簧回弹手感、Dock 波形跟手性。
- **M3**：开机/登录/锁屏视觉与手势、关机黑屏；登录/锁屏暂无密码/PIN（预留位）。
- **M4**：控制中心面板观感、三页引导排版、长按手感（500ms/10px 阈值）。
- **M5**：解锁手势精度（阈值 1/3 屏、阻尼 0.85、双击 280ms）、锁屏/控制中心/灵动岛视觉；Battery Status API 仅 Chromium 系显百分比（Safari/Firefox 降级只显图标）。
- **远期**：~~App 级自定义菜单~~ ✅ M34 已清账（见上）。
