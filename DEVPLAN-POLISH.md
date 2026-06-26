# QieZiOS 完善与查漏计划（自治完善循环的真相源）

> 「对标 Linux」backlog（G1–G7 + 融合三件套 + Phase H）已全部完成。本文件是**之后的完善/查漏待办**，由自我驱动的开发循环（`/loop 继续向下开发并将所有的功能完善后检查不足之处然后继续进行`）每次读取、挑第一个未完成项推进。
> 来源：2026-06-26 两路子 Agent 审计（正确性/健壮性 + 功能完整度/体验），均实读源码确认。
> 勾选规则：完成且通过验证（check+build+浏览器/DOM 级，过不了就标 ⏳ 待真机验证）才把 `[ ]` 改 `[x]`，并补一句验证结论。安全暂缓、功能优先（见记忆 prioritize-features-over-security）。

---

## 一、执行协议（每次循环照此做，一次只做一项）

1. 读本文件，挑**价值最高的未完成 `[ ]`**：数据丢失/崩溃类 P0 与高价值可见 P1 优先交替推进，其余按列表顺序。全 `[x]` → 发通知「🎉 完善计划全部完成」并停止循环。
2. **实现**：可派 builder 子 Agent，遵循四层架构（kernel/system/shell/apps）、Svelte 5 runes、`sys.*` 门面、加 App 在 appList.ts+registry.ts 登记、注意 Windows 大小写撞名 + 循环 import（registry 别 import desktopApps、system 别反向 import lib/shell 用注入）。
3. **监督**：派 supervisor 子 Agent 跑 `npm run check`+`npm run build` 审 diff；不过关打回（≤3 轮），3 轮仍不过关就撤销改动、标「⚠️ 受阻」、跳下一项——绝不提交跑不过的代码。
4. **收尾**：`git add -A` → 中文规范 commit（末尾带 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`）→ push；勾 `[x]` + 写验证结论；同步 CLAUDE.md。完成一项即停，等下次循环。

---

## 二、P0 · 正确性 / 健壮性（数据丢失/泄漏优先）

- [x] **A1 助手对话+附图超 localStorage 配额 → 静默丢失**：`assistantChat` 连同 `images`（JPEG data URL）整体 persisted；配额满时 `persist` 静默 catch 忽略 → 用户以为存了、刷新全丢。
  - ✅ 实现：`persisted()` 加可选 `serialize(snapshot)` 存盘前变换参（不传=原样存，对其余 18 个调用零影响）；`chat` 传 serialize 把有图消息剥成 `{...m, images:undefined, imageCount:N}`（图字节只留内存供本会话显示/喂模型，不写盘）；ChatMsg 加 `imageCount`；Assistant 刷新后渲染「🖼 N 张附图（历史不保留原图）」占位。加 DEV 钩子 `__qzChat`。
  - ✅ 浏览器实测：注入带 5000 字节假图的消息→内存仍有图(5022)、localStorage 那条 images 被剥+imageCount=1、qz.chat 总大小仅 116 字符（图没进盘）；reload 后对话文本完整保留、imageCount 在、占位渲染。supervisor 子 Agent PASS（serialize 默认分支与改前字节级等价、订阅不变、其余 persisted 零回归、类型/边界/DEV 钩子全过）。npm check+build 0 错 0 警。
- [x] **A2 `persisted` 每次字段变更都全量 `JSON.stringify`+snapshot**（`kernel/persist.svelte.ts:54`，在 effect 体内、只有写盘防抖）→ TextEdit 打字时每键序列化整棵 VFS，大文件卡顿。修：effect 体内只做轻量 deepRead 订阅，把 snapshot+stringify 移进防抖回调。⚠️ 核心 helper，务必验证「所有 persisted 仍正确订阅+持久化（含键增删）」。
  - ✅ 实现（低风险版）：`$state.snapshot` **保留在 effect 体内**（深读维持订阅，与改前字节级等价、零数据丢失风险），只把更重的 `serialize + JSON.stringify` 推迟进防抖 setTimeout 回调。高频变更（逐字输入）每键只做一次轻量 snapshot（对象图克隆、字符串按引用复用），停手 debounceMs 后才序列化一次整棵树——而序列化开销 ∝ 内容大小，是大文件时的主要瓶颈。（未采用 deepRead 替换 snapshot 的激进版，避免动订阅那一步的风险。）
  - ✅ 浏览器实测：VFS 建/写防抖后落盘（120ms 前没、250/500ms 后有）、chat 序列化路径仍剥图留 imageCount、快速三连写只末值落盘、rm→trash 持久化、刷新各存储正常加载。supervisor 子 Agent PASS（订阅字节级不变/闭包捕获无陈旧无饥饿/serialize 纯函数/异常 locus 非回归/debounce 语义不变）。npm check+build 0 错 0 警。
- [ ] **A3 过期一次性 `at` 命令开机并发补发执行**：schedd 重新武装时 `Math.max(0,delay)` 让过期任务立即 fire，命令型会经 shell 执行 → 刷新后批量跑过期命令（与真 `at` 过期不补相反，可能 rm 等意外副作用）。修：重新武装时过期的命令型一次性任务只移除不执行（提醒型可保留补发通知或也丢弃）。文件：`system/services.ts`。
- [ ] **A4 `bgPromises` Map 只增不删（后台作业泄漏）**：`lib/shell.ts` 每个 `cmd &` 的 promise 永久留存（含完整结果串），`jobs.list` 封顶 30 但 bgPromises 无清理。修：作业完成后裁剪 bgPromises（与 jobs.list 同步/保留最近 N）。
- [ ] **A5 拖拽中关窗泄漏 rAF + snap 预览**：`shell/Window.svelte` 拖动/缩放时窗口若被其它逻辑关闭，`onpointerup` 不触发 → pending rAF 不取消、`snapState.preview` 不清。修：组件卸载 `$effect` 清理里 `cancelAnimationFrame` + 清 preview。
- [ ] **A6 Live2D 加载失败泄漏 WebGL 上下文**：`lib/live2d.ts` `createPet` 若 `Live2DModel.from` 抛错，已建的 PIXI `Application`（WebGL 上下文）不回收 → 反复填错 URL 耗尽浏览器 ~16 上下文上限。修：model 加载失败前 `app.destroy()`。
- [x] **A7 `vfs.move` 不查目标目录重名 → 同名并存、路径不可达**：`resolvePath` 只命中第一个同名，另一个永久无法按路径访问。修：move 落地前查重名，改名或拒绝。文件：`kernel/vfs.svelte.ts`。
  - ✅ 实现：`move` 在落地前 `n.name = uniqueName(destId, n.name)`——目标已有同名则改唯一名（「x 2.txt」），无冲突原样返回；调用时 n 仍在原父目录故 uniqueName 不把自己算进去。覆盖 GUI 拖拽（Files/DesktopIcons）+ shell `mv 进目录`。
  - ✅ 浏览器实测：根 a.txt(ROOT-A) `mv` 进已有 a.txt(INDIR-A) 的目录 → 得「a 2.txt(ROOT-A)」+原「a.txt(INDIR-A)」两者皆可达、根下不再有 a.txt。supervisor 子 Agent PASS（uniqueName 时机/无冲突不误改/同目录·跨目录 rename 路径不受影响/目录与二进制同样适用全过）。npm check+build 0 错 0 警。
- [ ] **A9 `rename` 同名不去重（同类，A7 的姊妹项）**：GUI 重命名/`mv a.txt 已存在.txt` 把名字改成目录里已存在的名 → 同样产生同名并存、路径不可达（rename 是「显式改名」语义，去重会让用户输入的名被悄悄改，故倾向：检测冲突时拒绝 + 提示，而非自动 +2）。文件：`kernel/vfs.svelte.ts`、`apps/Files.svelte`、`lib/shell.ts`(mv 改名分支)。
- [ ] **A8 `head -n -5` 负数语义错**：`parseCountAndFile` 不挡负数，`slice(0,-5)` 返回「除末 5 行外」。修：count 取 `Math.max(0, …)`。文件：`lib/shell.ts`。

> 注：审计曾报 `vfs.purge` 删多层文件夹产生孤儿节点——实读代码确认是**后序递归（孙→子→父，children 每层重算）正确无孤儿**，已排除（误报）。

---

## 三、P1 · 功能完善（按价值/难度比）

- [x] **B1 自定义壁纸（上传图片 + 纯色）**：现只有 6 个内置 CSS 渐变。加本地图片上传（走 blobStore IndexedDB + objectURL）+ 纯色。美观=作者第一优先级、门面级可见。
  - ✅ 实现：`settings.customWallpaper`（{color|image|null}）；新 `system/wallpaperBlob.svelte.ts`（$effect 把 image blobId 异步解析成 objectURL $state，换图/清除时 revoke 旧的）；`theme.svelte.ts` 的 `--qz-wallpaper` 改 `wallpaperCss()`（纯色/图片优先于预设，图片用 `center / cover no-repeat url(...)` 铺满，未加载好回退预设）；Settings 壁纸区加 上传图片/纯色/恢复内置预设（换图/恢复时删旧 blob，含 applySettings 导入路径也删，免 IDB 堆积）。预设选中高亮排除自定义态。
  - ✅ 浏览器实测：上传合成 PNG→`--qz-wallpaper` 变 `url(blob:…)`、ls 存 {image,blobId}；纯色→#ff0000；恢复预设→渐变；色值 persist→reload→恢复 #0033cc 且桌面真实 background 含该色。supervisor 子 Agent PASS（objectURL 生命周期/cancelled 守卫/异步→响应式重算链/初次加载解析/分层无环/缺 blob 优雅回退全过；orphan-blob 清理已按建议补 applySettings 路径）。npm check+build 0 错 0 警。
- [ ] **B2 删除确认 + 撤销 toast**：Files/桌面图标/Trash 删除全程无确认，purge/清空回收站一键即焚。加轻量确认（非原生 confirm）或软删可撤销 toast。
- [x] **B3 Reminders 选具体时间（datetime）**：现只能「N 秒后」；底层 `Schedule.fireAt` 已支持绝对时间，纯 UI 缺口。加 `datetime-local` + 每天/每小时预设。文件：`apps/Reminders.svelte`。
  - ✅ 实现：mode 三选（多久后/指定时间/循环）；relative·repeat 用「数字 + 单位 s/m/h/d」算毫秒走 in/every；datetime 用 `<input type=datetime-local>` → `new Date().getTime()`（本地时区解析）校验未来 → `{in: ts-now}`，过去/空则警告不加；`fmtWhen` 远期显绝对时间、近期显「Ns 后」、循环显「每 N 单位」。
  - ✅ 浏览器实测：指定时间(分钟精度)建 fireAt 提醒、循环 2 小时→every=7200000、过去时间被拒、datetime 输入条件显示、fmtWhen「27s 后」「每 2 小时」。supervisor 子 Agent PASS（datetime 本地时区解析正确/in·every 契约/unit=d 不超 setInterval 上限/mode 切换无误加/secs·recurring 移除无残留/边界全过）。npm check+build 0 错 0 警。
- [x] **B4 记事本查找/替换**：TextEdit 是裸 textarea，无查找替换/行号/字数（Studio 的 CodeMirror 反而有，两编辑器割裂）。加 Ctrl+F 查找+替换 + 字数行数。
  - ✅ 实现：Ctrl+F 唤起查找条（查找输入 + n/total 计数 + 上/下导航环绕 + 区分大小写开关 + 替换输入/替换/全部 + 关闭/Esc）；`matchIndices` 非重叠命中、`gotoMatch` setSelectionRange 选中、`replaceCurrent`/`replaceAll`（gated on writable，直接写 node.content 经 bind 自动存）；底部状态栏「行 · 字符」。bind:this 引用用 `$state` + 局部 const 捕获避免闭包丢失收窄。
  - ✅ 浏览器实测：Ctrl+F 开条、查 alpha 计数 4（大小写不敏感含 Alpha）、Enter 选中并前进（2/4）、替换全部→`X beta…`、计数 0/0、状态栏「4 行 · 44 字符」。supervisor 子 Agent PASS（replaceAll 预算 idxs 单遍拼接不重复替换、replaceCurrent 命中才替、node.content 赋值合法触发存盘、$state ref 闭包收窄、权限 gating、Ctrl+F/Esc 作用域不影响别处、边界全过；计数显示按建议 clamp）。npm check+build 0 错 0 警。
- [ ] **B5 Files 复制/剪切/粘贴 + 多选**：现只能新建/重命名/拖拽移动/删除，无复制文件本身、无多选。vfs 加 `copyNode`，组件加 selection。文件：`apps/Files.svelte`、`kernel/vfs.svelte.ts`。
- [ ] **B6 通知中心 / 系统托盘**：顶栏右侧只有时钟、通知弹完即焚无历史。加托盘区（通知历史面板 + 明暗/桌宠快捷开关）。文件：`shell/TopBar.svelte`、`system/notifications.svelte.ts`、新面板组件。
- [ ] **B7 窗口四角四分屏 + 键盘平铺**：snap 只有左/右/最大化。加拖到角→1/4 屏 + Super/Ctrl+方向键平铺。文件：`shell/Window.svelte`、`shell/Desktop.svelte`。
- [ ] **B8 Spotlight 搜文件正文 + 动作命令**：现只搜 App 名/文件名、结果硬截断。加遍历 `vfs.nodes.content` 搜正文 + 常用系统动作（切暗色/清空回收站等）。文件：`shell/Spotlight.svelte`。
- [ ] **B9 Dock 排序 + pin/unpin**：顺序写死、不能固定/拖排。存 `settings.dockOrder`/`dockPinned`。文件：`shell/Dock.svelte`、`system/settings.svelte.ts`。
- [ ] **B10 桌宠/伙伴 无-key 引导**：未配 AI 时聊天直接走错误回落，无引导。加「去设置配 AI」提示+跳转（对齐其它 App 的 hasKey 守卫）。文件：`shell/DesktopPet.svelte`、`apps/Companion.svelte`。
- [ ] **B11 快捷键速查面板**：快捷键硬编码、无处可查。先做 `?` 唤起的速查面板（后续再做可重绑定）。文件：`shell/Desktop.svelte`、`apps/Settings.svelte`。
- [ ] **B12 Launchpad 全 App 网格 + 关于本机**：App 入口分散，无统一「所有 App」网格、无版本/用量「关于」页。文件：新 App + appList/registry。
- [ ] **B13 多窗平铺布局 / 任务视图**：现只有 cascade 层叠。加「网格平铺/并排两窗」一键布局，可选 exposé 总览。文件：`kernel/processes.svelte.ts`、`shell/Desktop.svelte`。

---

## 四、P2 · 一致性打磨

- [ ] **C1 右键菜单覆盖 + 删除反馈统一**：补 TopBar chip / Trash 项 / 桌面图标右键；统一删除反馈（toast + 可撤销）。文件：`shell/TopBar.svelte`、`apps/Trash.svelte`、`shell/DesktopIcons.svelte`、`shell/menu.svelte.ts`。

---

> 进度记录见各项后的「✅ …」注脚。当前循环：刚建立本 backlog，正在做 **B1 自定义壁纸**（破除「只有内置渐变」、兑现美观第一优先级）。
