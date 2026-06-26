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
- [x] **A4 `bgPromises` Map 只增不删（后台作业泄漏）**：`lib/shell.ts` 每个 `cmd &` 的 promise 永久留存（含完整结果串），`jobs.list` 封顶 30 但 bgPromises 无清理。修：作业完成后裁剪 bgPromises（与 jobs.list 同步/保留最近 N）。
  - ✅ 实现：`backgroundRun` 在 addJob 后裁剪——`live = new Set(jobs.list.map(j=>j.n))`，删掉 bgPromises 里不在 live 的键。jobs.list 已封顶 30 → bgPromises ⊆ jobs.list（≤30），长会话不再无限涨。prune 在 set(新 job) 之前、新 job.n 已在 live 不会误删。
  - ✅ 实测：`echo x &`→[1]、`fg`→显示输出（prune 不破坏 fg/wait，它们只认 jobs.list 内作业）。supervisor 子 Agent PASS（Map 迭代中删除安全/新作业不误删/fg·wait 不受影响/无回归）。npm check+build 0 错 0 警。
- [x] **A5 拖拽中关窗泄漏 rAF + snap 预览**：`shell/Window.svelte` 拖动/缩放时窗口若被其它逻辑关闭，`onpointerup` 不触发 → pending rAF 不取消、`snapState.preview` 不清。修：组件卸载 `$effect` 清理里 `cancelAnimationFrame` + 清 preview。
  - ✅ 实现：加 `onDestroy` 兜底——`if (raf) cancelAnimationFrame(raf)`（无条件，覆盖拖/缩两路）+ `if (dragging) snapState.preview = null`（仅本窗在拖时清，preview 是全局单信号只归当前拖拽窗，避免误清别窗）。正常关窗时 raf=0/dragging=false → 两 guard 皆 no-op，零副作用。
  - ✅ 浏览器实测：正常连续开关多窗 onDestroy 各触发、0 残留、无 JS 错误。⏳ 拖拽中关窗的视觉场景因无头预览视口尺寸为 0（移动模式禁拖 + rAF 冻结）本会话无法复现 → **待真机验证**。supervisor 子 Agent PASS（rAF 无条件清/preview 仅 dragging 守卫不误清/resize 不写 preview 故只需清 rAF/无双清/无回归全过；仅 out:pop 过渡 150ms 内残留属罕见路径 cosmetic）。npm check+build 0 错 0 警。
- [x] **A6 Live2D 加载失败泄漏 WebGL 上下文**：`lib/live2d.ts` `createPet` 若 `Live2DModel.from` 抛错，已建的 PIXI `Application`（WebGL 上下文）不回收 → 反复填错 URL 耗尽浏览器 ~16 上下文上限。修：model 加载失败前 `app.destroy()`。
  - ✅ 实现：`const app = new PIXI.Application` 之后的整段装配（Live2DModel.from / addChild / fit / ResizeObserver / 返回 Pet）包进 try；catch 里 `app.destroy(false,{children,texture,baseTexture})`（内层 try 吞二次错）后 `throw e` 重抛。成功路径 return 在 try 内、catch 不跑、行为与改前一致；失败路径回收已建 WebGL 上下文再抛。
  - ✅ npm check+build 0 错 0 警。supervisor 子 Agent PASS（try/catch 作用域/闭包捕获 app·ro·model/不双重销毁/catch 不引用未建的 ro 无 ReferenceError/对半装配 app 调 destroy 安全/调用方错误态不变/无回归全过；仅 fit·ro.observe 抛这一极罕见边界会漏 ro 但 WebGL 上下文已可靠回收，可接受）。⏳ Live2D/WebGL 无头预览验不了 → **待真机验证**（反复填错模型 URL 不再耗尽上下文）。
- [x] **A7 `vfs.move` 不查目标目录重名 → 同名并存、路径不可达**：`resolvePath` 只命中第一个同名，另一个永久无法按路径访问。修：move 落地前查重名，改名或拒绝。文件：`kernel/vfs.svelte.ts`。
  - ✅ 实现：`move` 在落地前 `n.name = uniqueName(destId, n.name)`——目标已有同名则改唯一名（「x 2.txt」），无冲突原样返回；调用时 n 仍在原父目录故 uniqueName 不把自己算进去。覆盖 GUI 拖拽（Files/DesktopIcons）+ shell `mv 进目录`。
  - ✅ 浏览器实测：根 a.txt(ROOT-A) `mv` 进已有 a.txt(INDIR-A) 的目录 → 得「a 2.txt(ROOT-A)」+原「a.txt(INDIR-A)」两者皆可达、根下不再有 a.txt。supervisor 子 Agent PASS（uniqueName 时机/无冲突不误改/同目录·跨目录 rename 路径不受影响/目录与二进制同样适用全过）。npm check+build 0 错 0 警。
- [x] **A9 `rename` 同名不去重（同类，A7 的姊妹项）**：GUI 重命名/`mv a.txt 已存在.txt` 把名字改成目录里已存在的名 → 同样产生同名并存、路径不可达（rename 是「显式改名」语义，去重会让用户输入的名被悄悄改，故倾向：检测冲突时拒绝 + 提示，而非自动 +2）。文件：`kernel/vfs.svelte.ts`、`apps/Files.svelte`、`lib/shell.ts`(mv 改名分支)。
  - ✅ 实现：`vfs.rename` 返回 boolean——空名/同目录已有同名(排除自己)→ false 不改、改成自己当前名→ true(no-op)、否则改名 true。Files commitRename / DesktopIcons commitIconRename 在 false 且名非空时 notify「已有同名项」；shell `mv` 重命名分支先查目标父目录重名(排除 src)→ 有则报错「目标已存在」不覆盖不半移动。顺手给 DesktopIcons commitIconRename 加 `renamingId!==id` 守卫（修一个**既存** bug：Escape 取消/Enter 后的二次 blur 会误提交）。
  - ✅ 浏览器实测：vfs.rename 改已存在兄弟名→false 名不变、改唯一名→true、改自己名→true；shell `mv` 改已存在名→code1「目标已存在」无重复、a9b 还在；改唯一名→成功。supervisor 子 Agent PASS（三调用方都正确处理 boolean/排除自己/新建流不卡死/mv 先查再动不半移动/A7 move 自动去重策略不受影响/无回归全过）。npm check+build 0 错 0 警。
- [x] **A8 `head -n -5` 负数语义错**：`parseCountAndFile` 不挡负数，`slice(0,-5)` 返回「除末 5 行外」。修：count 取 `Math.max(0, …)`。文件：`lib/shell.ts`。
  - ✅ 实现：`parseCountAndFile` 返回前 `count: Math.max(0, count)`，负数夹到 0（head/tail 输出空，正确）。`head -5` 简写走正数分支不受影响。实测 `head -n -5`/`tail -n -3`→空、`head -n 3`→前3行、`head -5`→前5行、`tail -n 2`→末2行。supervisor PASS（clamp 对 def/0/正/负都对、不影响 file 解析、无回归）。npm check+build 0 错 0 警。

> 🎉 **P0（正确性/健壮性）全部完成**（A1–A9 + 排除的 purge 误报，共 8 项已修）。

> 注：审计曾报 `vfs.purge` 删多层文件夹产生孤儿节点——实读代码确认是**后序递归（孙→子→父，children 每层重算）正确无孤儿**，已排除（误报）。

---

## 三、P1 · 功能完善（按价值/难度比）

- [x] **B1 自定义壁纸（上传图片 + 纯色）**：现只有 6 个内置 CSS 渐变。加本地图片上传（走 blobStore IndexedDB + objectURL）+ 纯色。美观=作者第一优先级、门面级可见。
  - ✅ 实现：`settings.customWallpaper`（{color|image|null}）；新 `system/wallpaperBlob.svelte.ts`（$effect 把 image blobId 异步解析成 objectURL $state，换图/清除时 revoke 旧的）；`theme.svelte.ts` 的 `--qz-wallpaper` 改 `wallpaperCss()`（纯色/图片优先于预设，图片用 `center / cover no-repeat url(...)` 铺满，未加载好回退预设）；Settings 壁纸区加 上传图片/纯色/恢复内置预设（换图/恢复时删旧 blob，含 applySettings 导入路径也删，免 IDB 堆积）。预设选中高亮排除自定义态。
  - ✅ 浏览器实测：上传合成 PNG→`--qz-wallpaper` 变 `url(blob:…)`、ls 存 {image,blobId}；纯色→#ff0000；恢复预设→渐变；色值 persist→reload→恢复 #0033cc 且桌面真实 background 含该色。supervisor 子 Agent PASS（objectURL 生命周期/cancelled 守卫/异步→响应式重算链/初次加载解析/分层无环/缺 blob 优雅回退全过；orphan-blob 清理已按建议补 applySettings 路径）。npm check+build 0 错 0 警。
- [x] **B2 删除确认（不可逆操作）**：Files/桌面图标/Trash 删除全程无确认，purge/清空回收站一键即焚。加轻量确认（非原生 confirm）或软删可撤销 toast。
  - ✅ 实现：回收站「彻底删除」(单项)+「清空回收站」用**两次点击确认**（非模态）——首点变「确认?/确认清空？」红底白字 3s、再点才执行；切换/超时自动 revert，两态互斥，`onDestroy` 清 timer。软删除（Files/桌面图标 trash）本就可从回收站还原，故确认只加在**不可逆**操作上。
  - ✅ 浏览器实测：彻底删除首点→「确认?」项数不变、再点→真删；清空首点→「确认清空？」不变、再点→清空为 0。**首次点击绝不删除**。supervisor 子 Agent PASS（首点无执行路径绕过/timer 生命周期无泄漏 + onDestroy 清理/互斥/restore 竞态 inert 自愈/无回归）。npm check+build 0 错 0 警。
  - 备注：软删除的「撤销 toast」需给通知系统加 action 按钮，拆为后续 **B16**（可选增强）。
- [x] **B16 删除撤销 toast（通知 action 按钮）**：软删除（trash）后弹一条带「撤销」的 toast，6s 内一键还原。
  - ✅ 实现：`Note` 加可选 `action:{label,run}`（只对活动 toast，进历史剥掉函数免序列化）；`Notifications.svelte` toast 改 `<div>`（内嵌 action 按钮，stopPropagation→run+dismiss）；Files `trashWithUndo` 在 del(单)/delTargets(批) 后弹「已删除[N 项] + 名字 + 撤销」（撤销=restoreFromTrash 闭包捕获 ids）。直接调 pushNote（绕开 sys.notify 的 bus，避免 action 函数过事件总线）。
  - ✅ 浏览器实测：选 2 文件删→toast「已删除 2 项…撤销」、点撤销→两文件还原回根目录（证 action.run 执行）。toast 视觉淡出受无头 out:fade 冻结验不了（dismissNote 已从数组移除、真机会淡出）。supervisor 子 Agent PASS（action 序列化双保险/div 回归无问题/restore 幂等空安全/del·delTargets 接入/分层无环/无回归）。npm check+build 0 错 0 警。
- [x] **B3 Reminders 选具体时间（datetime）**：现只能「N 秒后」；底层 `Schedule.fireAt` 已支持绝对时间，纯 UI 缺口。加 `datetime-local` + 每天/每小时预设。文件：`apps/Reminders.svelte`。
  - ✅ 实现：mode 三选（多久后/指定时间/循环）；relative·repeat 用「数字 + 单位 s/m/h/d」算毫秒走 in/every；datetime 用 `<input type=datetime-local>` → `new Date().getTime()`（本地时区解析）校验未来 → `{in: ts-now}`，过去/空则警告不加；`fmtWhen` 远期显绝对时间、近期显「Ns 后」、循环显「每 N 单位」。
  - ✅ 浏览器实测：指定时间(分钟精度)建 fireAt 提醒、循环 2 小时→every=7200000、过去时间被拒、datetime 输入条件显示、fmtWhen「27s 后」「每 2 小时」。supervisor 子 Agent PASS（datetime 本地时区解析正确/in·every 契约/unit=d 不超 setInterval 上限/mode 切换无误加/secs·recurring 移除无残留/边界全过）。npm check+build 0 错 0 警。
- [x] **B4 记事本查找/替换**：TextEdit 是裸 textarea，无查找替换/行号/字数（Studio 的 CodeMirror 反而有，两编辑器割裂）。加 Ctrl+F 查找+替换 + 字数行数。
  - ✅ 实现：Ctrl+F 唤起查找条（查找输入 + n/total 计数 + 上/下导航环绕 + 区分大小写开关 + 替换输入/替换/全部 + 关闭/Esc）；`matchIndices` 非重叠命中、`gotoMatch` setSelectionRange 选中、`replaceCurrent`/`replaceAll`（gated on writable，直接写 node.content 经 bind 自动存）；底部状态栏「行 · 字符」。bind:this 引用用 `$state` + 局部 const 捕获避免闭包丢失收窄。
  - ✅ 浏览器实测：Ctrl+F 开条、查 alpha 计数 4（大小写不敏感含 Alpha）、Enter 选中并前进（2/4）、替换全部→`X beta…`、计数 0/0、状态栏「4 行 · 44 字符」。supervisor 子 Agent PASS（replaceAll 预算 idxs 单遍拼接不重复替换、replaceCurrent 命中才替、node.content 赋值合法触发存盘、$state ref 闭包收窄、权限 gating、Ctrl+F/Esc 作用域不影响别处、边界全过；计数显示按建议 clamp）。npm check+build 0 错 0 警。
- [x] **B5 Files 复制/剪切/粘贴**（多选拆为 B15）：现只能新建/重命名/拖拽移动/删除，无复制文件本身。vfs 加 `copyNode`。文件：`apps/Files.svelte`、`kernel/vfs.svelte.ts`。
  - ✅ 实现：vfs `copyNode`(递归深拷贝；顶层 uniqueName 去重、子项进新空目录原名、二进制 getBlob+putBlob 复制出独立新 blobId、属主归当前用户、防复制进自己/子孙)；Files `clip`{id,cut} + copyItem/cutItem/paste(cut→move、copy→copyNode 可多次)；右键 复制/剪切/(目录)粘贴到此 + 工具栏粘贴按钮 + 键盘 Ctrl+C/X(item)·Ctrl+V(网格)。
  - ✅ 浏览器实测：copyNode 复制含文本+二进制的文件夹→递归全复制、二进制 blobId 不同但字节相同、改原文副本不变(深拷贝独立)；UI 右键复制→工具栏粘贴→生成「x 2.txt」内容正确。supervisor 子 Agent PASS（递归终止/blob 独立/isInside 防自包含/async pasting 锁/move 复用/键盘冒泡不双处理/无回归全过）。npm check+build 0 错 0 警。
- [x] **B15 Files 多选 + 批量操作**（B5 拆出；框选拖拽延后）：网格项 Ctrl/Shift 多选 + 批量 删除/移动/复制。需要 selection 状态 + 各操作支持多 id。文件：`apps/Files.svelte`。
  - ✅ 实现：`selected: string[]` + `lastClicked`；点击=单选 / Ctrl·⌘=切换 / Shift=范围（按 items 当前顺序）；选中态 ring+bg；`clip` 改 `{ids[],cut}`，copy/cut/paste/delete 全走「有效目标」(在多选里就整组、否则单个)；批量删除（操作条「删除选中」/ Delete·Backspace 键 / 右键「删除 N 项」）；右键未选中项先设为唯一选择；背景点击 / 进文件夹 / 切搜索 清选；del·delTargets·cut-paste 同步清理 selected。框选拖拽（box-select）+ 多选拖拽移动延后（headless 验不了，价值边际）。
  - ✅ 浏览器实测：单选=1、Ctrl 多选=3、Ctrl 取消=2、删除选中→只删选中两项+selected 清零、点空白清选、Delete 键同效。supervisor 子 Agent PASS（click/dblclick/drag/contextmenu 共存/背景清选/Shift 范围/多 id copy·move·delete/右键先选中/selected 无悬挂崩溃/无回归全过）。npm check+build 0 错 0 警。
- [x] **B6 通知中心 / 系统托盘**：顶栏右侧只有时钟、通知弹完即焚无历史。加托盘区（通知历史面板 + 明暗/桌宠快捷开关）。文件：`shell/TopBar.svelte`、`system/notifications.svelte.ts`、新面板组件。
  - ✅ 实现：`notifications.svelte.ts` 加持久化 `noteHistory`（封顶 40 + `lastSeen`）+ `unreadCount`/`markNotesSeen`/`clearHistory`；`pushNote` 同时进活动 toast 与历史。TopBar 右侧加系统托盘：明暗切换(🌙/☀️ 跟随 mode)、通知铃铛🔔(未读角标>9 显 9+) + 下拉面板(等级竖条/标题/正文/相对时间，倒序，含清空+空态)，点外部关闭、打开即清未读。
  - ✅ 浏览器实测：3 条通知→历史累积、角标计数、面板倒序、打开清未读、明暗切换(colorScheme+图标跟随)、清空→空态。**supervisor 子 Agent 抓到 1 个真崩溃**：`nid` 刷新后重置为 0 而 `noteHistory` 持久化 → 新通知 id 撞历史旧 id → keyed each 重复 key `each_key_duplicate` 崩溃（单会话测试漏掉）→ 已修：`nid` 从历史最大 id 之上起步。复现验证：刷新后开机通知 id=9（不撞旧 [5,6,7,8]）、历史全唯一、开面板无崩溃无 JS 错误。npm check+build 0 错 0 警。
- [x] **B7 窗口四角四分屏 + 键盘平铺**：snap 只有左/右/最大化。加拖到角→1/4 屏 + Super/Ctrl+方向键平铺。文件：`shell/Window.svelte`、`shell/Desktop.svelte`。
  - ✅ 实现：`Window.updateSnap` 加四角检测——上边缘靠左/右 20%→tl/tr（上半四分屏）中间→max，下边缘靠左/右 20%→bl/br（下半四分屏）中间→不吸附，左/右边缘中部→半屏；snapZone 加 tl/tr/bl/br，`applySnap` 泛化（非 max 用 preview 几何）无需特判。`Desktop` 绑 winLayer + `tile()` + Ctrl+Alt+方向键（←左半 →右半 ↑最大化 ↓还原）。
  - ✅ 键盘实测：Ctrl+Alt+↑→maximized、↓→还原、←→un-max+x=0+宽设值（headless 视口 0 故几何 0、真机才有真半屏）。⏳ 拖拽四角吸附视觉因无头视口 0 验不了 → **待真机验证**。supervisor 子 Agent PASS（分支互斥+全覆盖/四角几何对含奇数无缝/applySnap 泛化不漏/A5 兼容/tile 防御/键盘守卫不冲突；Ctrl+Alt+方向键个别 OS=屏幕旋转属 caveat 非 bug）。npm check+build 0 错 0 警。
- [x] **B8 Spotlight 搜文件正文 + 动作命令**：现只搜 App 名/文件名、结果硬截断。加遍历 `vfs.nodes.content` 搜正文 + 常用系统动作（切暗色/清空回收站等）。文件：`shell/Spotlight.svelte`。
  - ✅ 实现：文件过滤改 `name 或 文本正文 includes(q)`，内容命中时 `snippetFor` 截含关键词片段显在文件名下；`ACTIONS` 动作列表（切换明暗主题/清空回收站/打开终端/打开设置/显示桌面·最小化所有/关闭所有窗口，各 label+keywords+run）按 q 匹配 → kind `action`，activate 调 run。结果顺序 apps+installed+actions+files+AI；keyed each 前缀加 `:` 分隔防未来 id 撞键。
  - ✅ 浏览器实测：搜 'brown'(只在内容)→ b8notes.txt 带片段「…brown fox…」；搜 '暗'→「切换明暗主题」、'终端'→「打开终端」动作；点动作→主题真翻转 + Spotlight 关闭。supervisor 子 Agent PASS（动作副作用 closeall 拷贝数组遍历安全/selected 越界有守卫不崩/正文扫描性能在节点量级可接受/snippetFor 边界/分层无环/无回归；建议的 keyed 前缀分隔已采纳）。npm check+build 0 错 0 警。
- [ ] **B9 Dock 排序 + pin/unpin**：顺序写死、不能固定/拖排。存 `settings.dockOrder`/`dockPinned`。文件：`shell/Dock.svelte`、`system/settings.svelte.ts`。
- [x] **B10 桌宠/伙伴 无-key 引导 + AI 就绪判断 provider 感知**：未配 AI 时聊天直接走错误回落，无引导。加「去设置配 AI」提示+跳转（对齐其它 App 的 hasKey 守卫）。文件：`shell/DesktopPet.svelte`、`apps/Companion.svelte`。
  - ✅ 实现（比审计更深）：发现 DesktopPet/TextEdit/Files 的 `hasKey=!!apiKey` **非 provider 感知** → 本地/网关(OpenAI 兼容、无 key)被误判「没配 AI」、AI 功能被错误隐藏。三处统一改 `provider==='openai' || !!apiKey`（与 Assistant 的 aiReady 一致）。DesktopPet 无-key 提示加「去设置 AI →」跳转按钮（开设置 + 关气泡）。Companion 不用 AI 聊天（只加载 Live2D 模型 URL）故无需改。
  - ✅ 浏览器实测：provider=openai+空 key → TextEdit AI 动作条显示、桌宠聊天显示输入框（修复误判）；provider=anthropic+空 key → 桌宠显「去设置 AI」按钮、点它开设置+关气泡。supervisor 子 Agent PASS（provider 逻辑与 Assistant 字节一致/hasKey 改语义后三文件所有用法仍对/跳转正确/有 key 用户无回归/仅 UI 门控不碰 complete 调用）。npm check+build 0 错 0 警。
- [x] **B11 快捷键速查面板**：快捷键硬编码、无处可查。先做 `?` 唤起的速查面板（后续再做可重绑定）。文件：`shell/Desktop.svelte`、`apps/Settings.svelte`。
  - ✅ 实现：新 `shortcutsState.svelte.ts`（开关）+ `Shortcuts.svelte`（居中浮层，分组列出 窗口/系统/编辑·终端 共 12+ 条，kbd 标签，点遮罩/Esc/关闭按钮关）；Desktop onKey 加 `?` 唤起（input 聚焦不触发）+ shortcuts 开时 Esc/? 关并吞键；桌面右键菜单加「键盘快捷键 (?)」。z-[10003] 在 spotlight 之上。
  - ✅ 浏览器实测：`?`→开（列出含 Ctrl+Alt 平铺等 12 条）、Esc→关、`?`→重开、点外部→关、右键菜单项→开。supervisor 子 Agent PASS（onKey 顺序/吞键合理、? 在 input guard 后、点外部、z-index、无环、无回归全过）。npm check+build 0 错 0 警。
- [x] **B12 Launchpad 全 App 网格**（关于本机部分已被 SysMonitor 概况页覆盖）：App 入口分散，无统一「所有 App」网格。
  - ✅ 实现：新 `launchpadState.svelte.ts` + `Launchpad.svelte`（全屏 backdrop-blur 浮层，搜索框即时过滤 `visibleAppDefs()` + App 网格，点击 `launchAppDef`+关闭，Esc/点遮罩关、Enter 启首个）；顶栏装饰性 🍆 改成按钮唤起；Desktop render + onKey Esc 关；速查表加入口。「关于本机」（版本/进程/服务/存储计数）已由 SysMonitor 概况页提供，不另做。
  - ✅ 浏览器实测：点 🍆→开（20 个 App 带图标标题）、搜「终端」→过滤剩终端、点 App→启动+关闭、重开、Esc 关。supervisor 子 Agent PASS（onKey 顺序/四浮层状态独立/launchAppDef 与 Dock 同源/点遮罩 vs 内容 pointer 处理正确/z-index/无环/无回归；ship it）。npm check+build 0 错 0 警。
- [ ] **B13 多窗平铺布局 / 任务视图**：现只有 cascade 层叠。加「网格平铺/并排两窗」一键布局，可选 exposé 总览。文件：`kernel/processes.svelte.ts`、`shell/Desktop.svelte`。

---

## 四、P2 · 一致性打磨

- [x] **C1 右键菜单覆盖（一致性）**：补 TopBar chip 右键菜单；桌面图标/Files/Dock/Window 早已有右键，Trash 有可见按钮（还原/彻底删除带 B2 确认）→ 覆盖已齐。「删除反馈 toast + 可撤销」拆为 B16。文件：`shell/TopBar.svelte`。
  - ✅ 实现：顶栏窗口切换 chip 加 `oncontextmenu`→ `onChipMenu`（最小化/还原 + 最大化/还原大小[动态 label] + 关闭[danger]），与 Dock/Window 一致——不必先切到窗口就能关/最大化。
  - ✅ 浏览器实测：右键计算器 chip→菜单→关闭→只关它(时钟不动)；右键时钟→最大化→maximized；已最大化时显「还原大小」。supervisor 子 Agent PASS（动作用 p.id/动态 label 对应/MenuItem 形状与 Dock 一致/contextmenu·onclick 共存/close 后 chip 干净消失/无环无未用/无回归）。npm check+build 0 错 0 警。

---

> 进度记录见各项后的「✅ …」注脚。当前循环：刚建立本 backlog，正在做 **B1 自定义壁纸**（破除「只有内置渐变」、兑现美观第一优先级）。
