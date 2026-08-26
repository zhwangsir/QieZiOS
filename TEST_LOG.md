# TEST_LOG.md — QieZiOS

- 2026-08-27 项目管家文档治理：根目录收敛为 5 件套。

# TEST_LOG

## 2026-08-08 · M57「LLM 链路修复 · cloud llm_pool 指回活端口 + euryale-70b 预设接入」

**背景**：M56 遗留——助手集群 LLM 链路全断（误报为「LiteLLM :4000 挂了」）。本轮排查做认知修正：**集群从未部署 LiteLLM**，cloud nginx 按路径直接反代各后端，Bearer 鉴权在 nginx 层（`$http_authorization != $BEARER → 401`）：

| 路径 | 上游 | 状态 |
|------|------|------|
| `/llm/` | llm_pool → spark01 vLLM | 本轮修复 |
| `/lm/` | openclaw01:11234 LM Studio | 仍断（Tailscale 掉线+未运行，非必需） |
| `/exo/` | Mac Studio 集群 | — |
| `/comfy/` | workstation ComfyUI | — |

**真实断链根因**：`llm_pool`（lab.wineryz.top.conf）指向 `100.81.235.124:30000`（历史代理端口，已死），而 spark01 vLLM 实际在 `:8000` 健康服务 `llama-3.3-70b-abliterated-fp8`。

**修复**：备份 `lab.wineryz.top.conf.bak-pre-vllm8000` → sed `:30000→:8000` → `nginx -t` 通过 → reload → `https://dgmt.top/llm/v1/models` 恢复 200。

**QieZiOS 接入（TDD）**：[aiConfig.svelte.ts](file:///Users/wangzhenyu/Desktop/ALLProject/QieZiOS/src/system/aiConfig.svelte.ts) `AI_PRESETS[1]` 新增「工作站 · euryale-70b」（`/aiproxy/llm/v1` + `llama-3.3-70b-abliterated`），`AI_MODELS` 加快填；测试索引 [1]/[2]/[3] 全更新 + euryale 命中断言（8 例绿）。新建 `.env.local` 注入 `VITE_AI_PROXY_TARGET` + `VITE_AI_KEY`（cloud 网关 Bearer）。

**端到端验证**：vite dev :5199 实测 `localhost/aiproxy/llm/v1/chat/completions` → euryale-70b 返回 `<tool_call>{"type":"function","name":"list_apps","parameters":{}}></tool_call>`——尾部带 `>` 杂字符，正是 M56.2 `parseTagCallJson` 容错覆盖形态，**M56 解析器与真实模型输出闭环确认**。

**回归**：svelte-check 0 errors 1 warning（既有）· vitest 27 文件 **1225 例全绿** · build 成功（736ms）。

**踩坑**：`AI_PRESETS` 首次 Edit 被外部回写覆盖丢失（`AI_MODELS` 编辑幸存），二次 Edit 后持久化——**教训：关键编辑后立即 `git diff` 确认落盘**。

---

## 2026-08-07 · M56「AI 工具调用协议兼容 · 纯文本 JSON 工具调用回退解析」

**背景（P1）**：真实用户验收发现 euryale-70b 等 hermes 系模型不开 vLLM `--enable-auto-tool-choice` 时，把工具调用以纯文本 JSON 写进 `content` 而非 OpenAI 标准 `tool_calls` 字段，`ai.ts` 解析失败、原始 JSON 直接漏给用户。

**回归**：svelte-check **0 errors** 1 warning（既有）· vitest 27 文件 **1224 例全绿**（ai.test.ts 46 例）· build 成功（649ms）。

**真机验证**（2026-08-07，SSH spark01 直连 vLLM :8000 `llama-3.3-70b-abliterated`）：

1. 确认 P1 根因：vLLM 未开 `--enable-auto-tool-choice`，带 `tools` 的请求直接 400（`"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser`）→ 工具定义只能走 prompt，调用只能写进正文。
2. 抓取真实输出（非流式 + 流式拼接一致）：`<tool_call>{"type": "function", "name": "launch_app", "parameters": {"appId": "calculator"}}></tool_call>`——**JSON 尾部多吐 `>` 杂字符**、夹带多余 `"type"` 字段、用 `parameters` 键。原实现整段 `JSON.parse` 必败 → 追加 `parseTagCallJson` 容错（从第一个 `{` 起括号配平截取对象重试），3 条真实输出固化为测试用例全绿。
3. 发现 **LiteLLM :4000 路由进程已停**（外网 502、本机无监听/无进程），vLLM 后端本身健康——待恢复路由（见下「遗留」）。

**改动概览**（3 子任务）：

- **M56.1 正文内嵌工具调用提取**（`extractTextToolCalls`）：三种形态按序命中即返——1) `<tool_call>` hermes 标签块（任何名字都收：标签即显式调用意图，未知名交 `executeTool` 报错回灌；解析失败保留原文）；2) 整段正文即裸 JSON；3) 过渡语后行首内嵌裸 JSON（限已知工具名，防普通 JSON 误伤）。核心配平器：

  ```typescript
  // 字符串感知括号配平：esc 转义 / inStr 状态 / depth 计数
  export function matchJsonObject(text: string, start: number): number {
    if (text[start] !== '{') return -1;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return i + 1;
    }
    return -1;
  }
  ```

  标准化（`parseCallJson`）：`arguments` 为字符串原样保留不二次序列化；`parameters` 键位变体兼容；`requireKnown` 开关区分标签块（任何名字）与裸 JSON（限已知名）。内嵌多调用倒序剥离保下标正确。

- **M56.2 流式暂留 + 流末定稿**：`safeFlushBoundary` 扩展 `holdToolCalls` 分支——未闭合 `<|…` 控制标记、`<tool_call` 标签起（含闭合块：等流末统一剥离，否则标签以正文漏出）、分片截断的 `</tool_…` 前缀、行首疑似裸 JSON 起点，全部暂留不输出。`finalizeStreamResult` 定稿优先级：

  ```typescript
  const calls = finalizeToolCalls(structured);
  if (calls.length) return { content: stripBoxTokens(raw), toolCalls: calls }; // 结构化优先
  if (holdToolCalls) {
    const { text, calls: extracted } = extractTextToolCalls(stripBoxTokens(raw), validToolNames());
    if (extracted.length) return { content: text, toolCalls: finalizeToolCalls(extracted) }; // 回退提取
  }
  return { content: stripBoxTokens(raw), toolCalls: [] }; // 纯文本
  ```

  附带：抽出 `OATool` 接口，`streamOpenAI` 签名 `ReturnType<typeof openaiToolDefs>` → `OATool[]`，修复测试与 `TOOL_DEFS` 字面量联合类型不兼容的 4 个 svelte-check 错误。真机验证后追加 `parseTagCallJson` 容错：

  ```typescript
  // 标签体整段 parse 失败 → 从第一个 '{' 起括号配平截取对象重试
  // （euryale-70b 实测输出 {…}}> 尾部多杂字符，直接 JSON.parse 必败）
  function parseTagCallJson(body: string, validNames: Set<string>): OAToolCall | null {
    const direct = parseCallJson(body, false, validNames);
    if (direct) return direct;
    const start = body.indexOf('{');
    if (start === -1) return null;
    const end = matchJsonObject(body, start);
    return end === -1 ? null : parseCallJson(body.slice(start, end), false, validNames);
  }
  ```

- **M56.3 全量回归 + 真机验证**：新增 `ai.test.ts` 46 例——extractTextToolCalls 全形态（标签单块/多块/过渡语保留/arguments 字符串/parameters 变体/未知名/损坏 JSON 保留原文/整段裸 JSON/未知名防误伤/内嵌多调用/嵌套转义配平 + 3 例真机抓取原始输出固化）、matchJsonObject 边界、safeFlushBoundary 暂留边界、finalizeStreamResult 优先级、streamOpenAI SSE 集成。**关键断言：流式途中所有 text 事件拼接后不含任何工具调用原文**。

**遗留**：spark01 LiteLLM :4000 路由进程已停（502），助手走 `/aiproxy/lm/v1` 预设会失败——需重启 LiteLLM 或在 aiConfig 预设改指 vLLM 直连 :8000；长期方案仍建议 vLLM 开 `--enable-auto-tool-choice --tool-call-parser hermes`（结构化输出，双保险）。

---

## 2026-07-24 · M55「发布候选 · svelte-check 零错误」

**回归**：svelte-check **0 errors** 1 warning（既有）· vitest 26 文件 1178 例全绿 · build 成功。

**修复 15 个类型错误**（4 文件）：

- **arith.ts（5 个）**：`primary()` 末尾 `err()`→`return err()` 让 TS 收窄 never；`ident()` `if(!m) err()`→`return err()` 消除 m possibly null；switch 加 `default: return err()` 修复 `v` used before assigned。
- **shell.ts（3 个）**：sed 替换 `else`→`else if (cmd.op === 's')` 收窄联合类型；mktemp `createDir()!` 非空断言 + rootId 空检查。
- **histexpand.ts（6 个）**：`apply()` 返回类型 `ApplyResult | null`→`{ ok: false; error: string } | null`，成功返回 null、失败只返回错误分支。
- **Terminal.svelte（1 个）**：`sys.proc.close(ctx.pid)`→`sys.proc.close(String(ctx.pid))`。

---

## 2026-07-24 · M54「UI/UX 完善与性能优化」（Files 键盘导航 · 神灯确认 · 壁纸轮播 · 拖文件进 App · 小组件 · 窗口置顶 · 重渲染审计）

**回归**：vitest 26 文件 1178 例全绿；build 成功（646ms）。

**改动概览**（7 子任务，清理 POLISH-3/4/5 + PERF 遗留待办）：

- **M54.1 Files 键盘导航**：容器 `onkeydown` 统一处理方向键/F2/Ctrl+D/首字母跳转。`onQuickLookKey` 精简为只管空格/Esc。`stepSelection` 签名 `1|-1`→`number` 支持 grid 多列跳跃。
  ```typescript
  // grid 视图方向键：←/→ = ±1，↑/↓ = ±列数
  const cols = gridCols(); // getComputedStyle 读实际列数
  delta = arr === 'ArrowRight' ? 1 : arr === 'ArrowLeft' ? -1
        : arr === 'ArrowDown' ? cols : -cols;
  const next = stepSelection(ids, selected[0], delta);
  ```

- **M54.2 神灯动画确认**：调研发现 POLISH-4 R4-F10 已在 `motion.ts`（`genieFrame`/`genieClipPath` 纯函数）+ `Window.svelte`（`startGenie` `$effect.pre` + rAF 主循环）+ `Dock.svelte`（`trackDockIcon` action）中完整实现。标记完成。

- **M54.3 壁纸轮播**：新建 `wallpaperSlideshow.svelte.ts`（persisted 持久化配置）+ `wallpaperd` 服务（`$effect.root` 订阅间隔变化 `setInterval` 切换）+ Settings UI（开关/间隔/多选/立即切换）。

- **M54.4 拖文件进 App**：`processes` 加 `setData` 原语；`Window.svelte` 加 `ondrop` 按 appId 分流（imageviewer/textedit/mediaviewer）；`Desktop.svelte` 加 `ondrop` 外部文件→`createBinaryFile`、VFS 拖出→`copyNode`。
  ```typescript
  // Window.svelte: 按 App 类型分流拖入
  const VIEWER_ACCEPT: Record<string, (n: VNode) => boolean> = {
    imageviewer: (n) => isImage(n),
    textedit: (n) => n.type === 'file' && !isImage(n),
    mediaviewer: (n) => isMedia(n),
  };
  ```

- **M54.5 小组件**：`WidgetKind` 加 `todo`/`worldclock`。todo 复用 `schedules` 前 5 条可勾选完成；worldclock 三时区（北京/纽约/伦敦）每秒更新。

- **M54.6 窗口置顶**：`Process` 加 `alwaysOnTop` + `TOP_BASE=10000` 双段 z-index + `setAlwaysOnTop`。关键修复：`activeId()` 引入 `lastFocusedId`（置顶窗 z 始终更高，旧逻辑普通窗永拿不到焦点高亮）。
  ```typescript
  // 双段 z-index：普通 1..9999 / 置顶 10001+
  const TOP_BASE = 10000;
  function allocZFor(p: Process): number { return p.alwaysOnTop ? allocTopZ() : allocZ(); }
  ```

- **M54.7 性能审计**：`childrenRaw`（仅 filter 不 sort O(n)）替换 7 个内部调用者，路径解析 O(k·n log n)→O(k·n)。审计 persist snapshot/processes/derived/effect 均已优化到位。
  ```typescript
  // 新增：仅 filter 不 sort，给内部路径用（uniqueName/rename/cloneInto/purge/...）
  function childrenRaw(parentId: string): VNode[] {
    return Object.values(vfs.nodes).filter((n) => n.parentId === parentId);
  }
  ```

---

## 2026-07-24 · M53「文本处理 · 归档压缩 · 差异同步补全」（grep -c/-E · sed · awk · join · tar · gzip/gunzip · ln/readlink · wget · strings · hexdump/od · diff · patch · sync）

**回归**：vitest 26 文件 1178 例全绿（shell.test.ts 697 例，M53 +109 例新测试：grep 7 + sed 12 + awk 11 + join 7 + tar 13 + gzip 9 + ln/readlink 10 + wget 7 + strings 4 + hexdump/od 8 + diff 10 + patch 10 + sync 1）；build 成功（680ms，index 555.98kB gzip 187.62kB）。

**关键修复**：
- `wget -c` 断点续传失效：无 `-O` 时重名直接改名 `.1`，`cont` 永远找不到已存在文件。修复：`-c` 遇同名不再改 `.1`，取已有文件 id 续传——`existBytes.length > 0` 时发 `Range: bytes=N-` 头，下载字节 `concatBytes([existBytes, got])` 拼接整文件重写。
- `hexdump/od` 抛异常：`hex2`、`fmtAddr`、`dumpable` 三个辅助函数缺失。补齐：`dumpable(ctx, f)` 统一「resolvePath + getNode + readFileBytes」错误出口；`fmtAddr(off, radix)` 按 x/d/o 格式化 7 位地址；`hex2(b)` 两位十六进制。
- `strings .gz` 找不到内嵌文件名：`gzipBytes` 用原生 `CompressionStream('gzip')` 生成的头不含 FNAME 字段。修复：`gzipBytes(bytes, name?)` 加第二参数，手工构造 RFC 1952 头（`1f 8b 08 08 mtime 00 03` + FNAME 以 NUL 结尾）再接压缩体与 CRC32/ISIZE 尾。
- `diff -u` 上下文重复：`diffUnified` 每处理完一个 hunk 未推进源文件游标，已删行被当后续 hunk 的上下文重复输出。修复：`pos = bl.aPos + bl.aCount` 跳过已删行。
- `>` 重定向仅退出码 0 写入（runPipeline 既有语义）：`diff` 有差异码 1 → `diff -u a b > p.diff` 不落盘。M53.12 测试改用管道 `diff -u a b | patch` 与 `tee` 中转落盘补丁文件。

- **M53.2 sed**：`parseSedScript` 把脚本解析为命令列（地址 a1/a2 + op）。逐行模式空间 `ps`，范围地址用 `inRange` 状态；GNU 语义——数字第二地址 `≤ lc` 视为单行范围不进 `inRange`；`d` 置 `deleted` break 立即下一周期；`-n` 时只在 `p` 命中输出。
  ```typescript
  const hit = (a: SedAddr) => (a.kind === 'num' ? lc === a.n : a.kind === 'last' ? isLast : a.re.test(ps));
  if (!cmd.a1) active = true;
  else if (!cmd.a2) active = hit(cmd.a1);
  else if (st.inRange) { active = true; if (hit(cmd.a2)) st.inRange = false; ... }
  ```

- **M53.5 tar**：`ustarHeader`/`parseUstar` 实现 USTAR（512 头 + 数据 512 对齐 + 双零块结尾）。`c` 目录递归条目名 = 命令行所给路径（去尾 `/` 头 `./`）；`x` 含 `..`/绝对路径条目跳过防 zip-slip，`isTextBytes` 探测还原文本/二进制；`z` 创建走 `gzipBytes`，`t/x` 按 `1f 8b` 魔数自动识别无需 `-z`；传统风格首参数不带 `-` 自动补。
  ```typescript
  if (i === 0 && a && !a.startsWith('-')) a = '-' + a; // 传统风格 tar cf …
  ...
  if (!parts.length || parts.some((p) => p === '..') || e.name.startsWith('/')) continue; // zip-slip 防护
  ```

- **M53.7 ln/readlink**：VFS 新增 `linkTo` 软链字段。`resolvePath` 透明跟随（带链接环检测）；`lresolvePath` 最后一段不跟随（readlink / ls -l / test -L 用）。硬链在树模型（单 parentId）下模拟为同内容副本 + `setMode` 同步权限。
  ```typescript
  if (symbolic) { createSymlink(parentId, linkName, target); return { out: '', code: 0 }; }
  // 硬链（模拟副本）
  if (tn.kind === 'binary') await createBinaryFile(parentId, linkName, new Blob([...]));
  else createFile(parentId, linkName, tn.content);
  ```

- **M53.11 diff**：LCS 最小编辑块 `diffBlocks`（`{aPos,aCount,bPos,bCount}` 段列）→ `diffNormal`（`NcM`/`NaM`/`NdM` + `「< 」「> 」`行）/ `diffUnified`（`---/+++` 头 + `@@ -a,c +b,c @@`，上下文 3 行，相邻 hunk 间隔 ≤6 行合并）。`-r` walk 两侧按相对路径对齐，单侧独有报「仅在 … 中存在」；二进制只比较异同。码 0 相同 / 1 不同 / 2 出错。

- **M53.12 patch**：`parsePatchText` 解析 unified diff 为文件补丁列；`applyPatchToLines` 每 hunk 先按声明行号（+累计偏移）定位，失配按 GNU 偏移扫描找唯一匹配；**全部 hunk 命中才落盘（原子）**，失败报 `Hunk FAILED` 码 1 文件不变。`-pN` 剥路径前 N 段；`--dry-run` 输出 `checking file` 不写盘；`--- /dev/null` 新建、`+++ /dev/null` 删除（trash 回收站）。
  ```typescript
  // hunk 定位：声明行号优先，失配时 GNU 偏移扫描
  let at = hunk.aStart - 1 + offset;
  if (!matchAt(lines, at, hunk)) {
    let found = -1;
    for (let d = 0; d <= lines.length; d++) { /* 双向扫描找唯一匹配 */ }
    if (found < 0) return { ok: false };
    at = found;
  }
  ```

- **M53.13 sync**：`sync: async () => { await flushPersisted(); return { out: '', code: 0 }; }`——`flushPersisted()`（persist 层）先 `await tick()` 跑完挂起 effect，再并发刷所有 flusher（取消防抖计时器立即写 localStorage/IndexedDB），对标 sync(2)。

**man 同步**：grep 条目补 `-c`/`-E`；新增「M53.1-10：文本处理与归档压缩」区块 12 条目（sed/awk/join/tar/gzip/gunzip/ln/readlink/wget/strings/hexdump/od）；M53.11-13（diff/patch/sync）条目随实现写入。

---

## 2026-07-24 · M52「Shell 常用命令补全」（exit · history · df · du · free · pushd/popd/dirs · pgrep/pkill · timeout · file · command/builtin）

**回归**：vitest 26 文件 1069 例全绿（shell.test.ts 588 例，M52 +52 例新测试）；build 成功（631ms，index 523.68kB gzip 175.96kB）。

**关键修复**：
- `cmdHistory is not defined`：shell.ts 第 43 行 import 缺少 `cmdHistory` 与 `addHistory`（原仅导 `aliases/setAlias/removeAlias`）。修正为 `import { aliases, setAlias, removeAlias, cmdHistory, addHistory } from '../system/shellPrefs.svelte'`。
- `exit` 标志未传播：`exit` 命令返回 `{exit:true}`，但 `runPipeline`/`runLine`/`run()` 三层聚合返回值均丢弃了 `exit` 字段。在每层添加 `let exit = false` + `if (res.exit) exit = true` + 返回值含 `exit` 字段；`execNodes` 检查 `exit` 立即停后续语句。
- `du` 字节数期望：QieZiOS `echo` 不附加尾换行（与 bash 差异），`echo hello > file` 写入 5 字节 `"hello"` 非 6 字节。测试期望从 `/^\s*6\t/` 修正为 `/^\s*5\t/`。
- `pushd` cd 字段语义：`res.cd` 是 node ID（与 `cd` 命令一致），`res.out` 含人类可读路径（`dirStackLines` 用 `pathOf` 渲染）。测试从 `expect(res.cd).toBe(res.out.split(' ').pop())` 修正为 `expect(res.out.split(' ').pop()).toBe('/qz_m52_pushd')`。
- `history` 历史记录：`run()` 函数开头调 `addHistory(t)`，保证脚本/测试直接调 `run` 也能记录历史；Terminal 调用前已 `addHistory`，靠 `addHistory` 内 dedup 守卫（`list[list.length-1]===t` 跳过）防重复。

- **M52.1 exit**：`exit: (args) => { const n = args.length ? Number(args[0]) : 0; const code = Number.isFinite(n) ? n : 0; return { out: '', code, exit: true }; }`。退出码默认 0，非数字参数也默认 0。`exit:true` 标志穿透四层：`runPipeline` → `runLine` → `runLeaf` → `run()` 聚合层。`execNodes` 检查 `if (ctx.retFlag || ctx.loopCtl || exit) return`。Terminal.svelte 检测 `res.exit` 调 `sys.proc.close(ctx.pid)` 关窗。
  ```typescript
  // runPipeline 返回值（line ~4657）
  return { out: lastRedirectedOut ? '' : pipedOut, err: ..., code, cd, clear, exit };
  // runLine 返回值（line ~3386）
  return { out: outs.join('\n'), err: ..., code: lastCode, cd, clear, exit };
  // run() 聚合层（line ~4259）
  result = { out: outs.join('\n'), err: ..., code: lastCode, cd, clear, exit };
  ```

- **M52.2 history**：`history: (args, ctx) => { const list = cmdHistory.list; ... }`。`-c` 清空 `list = []`；`-d N` 删除 1-based 超范围码 1；带数字参数 `slice(start)` 只显示最近 N 条。行号右对齐 4 位 `String(start + i + 1).padStart(4)`。`run()` 开头调 `addHistory(t)`：
  ```typescript
  export async function run(text: string, ctx: ShellCtx): Promise<CmdResult> {
    const t = text.trim();
    if (!t) return { out: '', code: 0 };
    addHistory(t); // M52.2：脚本/测试直接调 run 时补登历史
    ...
  ```

- **M52.3 df**：遍历 VFS 根节点递归统计文件数与总大小。`sizeM=max(1, round(bytes/1M))`，`usedM=max(1, round(files/10))`，`availM=sizeM-usedM`，`pct=round(usedM/sizeM*100)`。表头 `Filesystem 1M-blocks Used Available Use% Mounted on` + `qzfs` 数据行。

- **M52.4 du**：递归 `calc(nodeId, rel)`：文件 `push {path:rel, size:s}`（文本 `content.length` 二进制 `size`）；目录 `sum` 子项再 `push` 自身。`-s` 仅返回总计。输出格式 `String(size).padStart(4) + '\t' + path`。

- **M52.5 free**：`navigator.deviceMemory`（兜底 8GB）→ `totalM`。`performance.memory`（Chromium 专有）→ `usedM/limitM`，否则 `usedM=0`。`freeM=max(0,totalM-usedM)`。Swap 恒 0。`padStart(12)` 列对齐。

- **M52.6 pushd/popd/dirs**：`ctx.dirStack` 存 node ID。`dirStackLines(stack)` 用 `pathOf(id)` 渲染路径。
  ```typescript
  pushd: (args, ctx) => {
    const stack = ctx.dirStack ?? (ctx.dirStack = ['root']);
    if (!args.length) { /* 交换栈顶两项 */ }
    const id = resolvePath(ctx.cwd, args[0]);
    if (!id || getNode(id)?.type !== 'dir') return { err: `pushd: ${args[0]}: 没有那个目录`, code: 1 };
    stack.push(id);
    return { out: dirStackLines(stack), code: 0, cd: id };
  }
  ```

- **M52.7 pgrep/pkill**：`processes.svelte` 进程表查询。`p.name.toLowerCase().includes(pattern.toLowerCase())` 子串匹配。pgrep 无模式码 2 无匹配码 1；pkill 调 `close(p.id)` 返回被杀数。

- **M52.8 timeout**：`async` 命令。`setTimeout(ms)` + `Promise.race([runP, timeoutP])`。超时置 `ctx.intr.flag=true` 协作式中断 + 码 124。`finally clearTimeout`。秒数 0 立即超时。
  ```typescript
  timeout: async (args, ctx, stdin) => {
    const ms = n * 1000;
    if (ms === 0) return { err: `timeout: 已超时，杀死「${line}」`, code: 124 };
    const timeoutP = new Promise(r => { timer = setTimeout(() => { ctx.intr.flag = true; r({code:124}); }, ms); });
    const res = await Promise.race([run(line, ctx), timeoutP]);
    return res;
  }
  ```

- **M52.9 file**：`getNode` 判断类型：`dir` → `'directory'`；`file` 读 `content`，可打印字符（`\x20-\x7e` + `\t\n\r\f`）占比 ≥80% → `'ASCII text'`，否则 `'data'`。多文件逐行「路径: 类型」。

- **M52.10 command/builtin**：`command -v` 打印命令名不执行；无 `-v` 绕过别名/函数直接查 `COMMAND_NAMES` 执行，未找到码 127。`builtin` 强制内建执行，`COMMAND_NAMES` 不含报错码 1。

- **M52.11 man 同步**：man.ts 在 `printenv` 之后新增 14 条手册（exit/history/df/du/free/pushd/popd/dirs/pgrep/pkill/timeout/file/command/builtin）。

---

## 2026-07-24 · M51「系统信息与时间工具补全」（date · time · uname · uptime · cal · nproc · mktemp · realpath · printenv）

**回归**：vitest 26 文件 1031 例全绿（shell.test.ts 550 例，M51 +43 例新测试）；build 成功（611ms，index 515.06kB gzip 173.04kB）。

- **M51.1 date 增强**：参数解析 `-u`（UTC）、`-d`/`--date`（解析时间串）、`+FORMAT`（strftime）。无格式串输出本地时间字符串（`toLocaleString('zh-CN')`），`-u` 用 `toUTCString()`。`parseDateStr` 支持 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:MM:SS`，纯日期当本地时间（`new Date(Y, Mo-1, D)`）。**关键修复**：JS Date 自动调整非法日期（`2023-02-29` → `2023-03-01`），加字段一致性校验 `isNaN/getFullYear/getMonth/getDate` 对比输入，不匹配返回 null → 退出码 1。`fmtDate` 实现 strftime：`%Y` 4位年、`%y` 2位年补零、`%m/%d/%H/%M/%S` 补零、`%j` 年中第几天补零至 3 位、`%s` Unix 时间戳、`%w` 数字星期 0-6、`%A/%a` 星期全名/缩写、`%B` 月名、`%Z` 时区名（`Intl.DateTimeFormat().resolvedOptions().timeZone`）、`%z` 时区偏移、`%%` 百分号。`-u` 用 UTC：把 UTC 字段塞进一个用本地时区表示相同时刻的 Date（`shifted = new Date(ud.getTime() + ud.getTimezoneOffset()*60000)`）后 `fmtDate`，避免新增一套 UTC 取值分支。
  ```ts
  // 字段一致性校验防 2023-02-29 误报有效
  const d = new Date(Y, Mo - 1, D, h, mi, s);
  if (isNaN(d.getTime()) || d.getFullYear() !== Y || d.getMonth() !== Mo - 1 || d.getDate() !== D) return null;
  ```

- **M51.2 time**：`async` 命令，`args.join(' ')` 成命令字符串调 `run` 执行（故支持管道/重定向）。`performance.now()` 计时，`real = (t1-t0)/1000` 秒，`mins=floor(dt/60)`、`secs=(dt-mins*60).toFixed(3)`，格式 `real\t${mins}m${secs}s\nuser\t0m0.000s\nsys\t0m0.000s`。计时信息走 stderr（`res.err` 非空则前置 timing 再拼原 err），退出码取子命令码。`user/sys` 无法区分均报 0（bash 格式兼容）。无参数码 2。

- **M51.3 uname**：合并标志拆字符（`-snr` → flags.add('s').add('n').add('r')）。常量 `kernel='QieZiOS'`/`node='qiezios'`/`release='1.0.0'`/`machine='x86_64'`。`-a` 全部输出 `${kernel} ${node} ${release} #1 SMP ${machine} GNU/Linux`。无标志默认 `-s`。按 `s/n/r/m` 顺序拼 `parts.join(' ')`。

- **M51.4 uptime**：模拟。当前时间 `HH:MM:SS` + `' up '` + 运行时长 + `', 1 user, load average: 0.00, 0.00, 0.00'`。

- **M51.5 cal**：`renderMonth(y, m)` 月名「N月」居中、星期表头「日 一 二 三 四 五 六」、按当月 1 号 `getDay()` 定位起始列、逐日填格右对齐 2 位。`renderYear(y)` 3 列 × 4 行排 12 个月，月间空格分隔。单参数 `>31` 当年份（`renderYear`）、`≤31` 当月份（同年 `renderMonth`）；双参 月 年。非法月（非整数或 `<1`/`>12`）或年（非整数或 `<1`）报错码 1。

- **M51.6 nproc**：取 `navigator.hardwareConcurrency`（兜底 8，防止 SSR/非浏览器环境 `undefined`）。

- **M51.7 mktemp**：`/tmp` 不存在时 `mkdir` 自动创建。命名 `.tmp_${Math.random().toString(36).slice(2,10)}_${Date.now()}`。`-d` 创建目录（`mkdir`）否则 `touch` 创建文件，返回绝对路径 `/tmp/...`。

- **M51.8 realpath**：`toAbsPath(ctx, path)` 相对路径基于 `ctx.cwd` 拼，绝对路径直接用。`split('/').reduce` 消解 `.` 和 `..`（`..` 弹栈，根目录 `..` 不上溢即栈空时忽略）。**关键修复**：测试用唯一路径 `/qz_m51_rp_test` 避免 VFS 状态污染（原 `/a` 可能被其他测试修改）。
  ```ts
  // 消解 . 和 ..（根目录 .. 不上溢）
  const parts = abs.split('/').filter(Boolean);
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') { if (stack.length) stack.pop(); continue; }
    stack.push(p);
  }
  return '/' + stack.join('/');
  ```

- **M51.9 printenv**：无参 `Object.entries(ctx.env).map(([k,v])=>`${k}=${v}`).join('\n')`。带参遍历，`ctx.env[k] !== undefined` 收集值，任一未定义 `allFound=false` → 退出码 1，`outs.join('\n')`。

- **M51.10 man 同步 + 全量回归**：man.ts 在 `type` 之后新增 9 条手册（date/time/uname/uptime/cal/nproc/mktemp/realpath/printenv），全部放在文本处理区块末尾保持聚类。全量回归 vitest 26 文件 1031 例全绿（shell.test.ts 550 例，M51 +43：date 8 + time 5 + uname 4 + uptime 3 + cal 5 + nproc 2 + mktemp 4 + realpath 4 + printenv 4 + 其他边界）；build 成功（611ms，index 515.06kB gzip 173.04kB）。

### 关键断言
```ts
// M51.1 date：strftime + 非法日期校验
expect((await run('date +%Y', newCtx())).out).toBe(String(new Date().getFullYear()));
expect((await run('date -d 2024-06-15 +%Y-%m-%d', newCtx())).out).toBe('2024-06-15');
const r = await run('date -d 2023-02-29 +%Y-%m-%d', newCtx());
expect(r.code).toBe(1);
expect(r.err ?? '').toContain('无效');

// M51.2 time：计时走 stderr，stdout 透传
const t = await run('time echo hi', newCtx());
expect(t.out).toBe('hi');
expect(t.err ?? '').toContain('real');

// M51.3 uname：-a 全部
expect((await run('uname', newCtx())).out).toBe('QieZiOS');
expect((await run('uname -a', newCtx())).out).toContain('QieZiOS qiezios 1.0.0');

// M51.5 cal：当月与指定月
expect((await run('cal', newCtx())).code).toBe(0);
expect((await run('cal 13 2024', newCtx())).code).toBe(1); // 非法月

// M51.7 mktemp：唯一命名 + 返回绝对路径
const f = await run('mktemp', newCtx());
expect(f.out).toMatch(/^\/tmp\/\.tmp_/);

// M51.8 realpath：消解 .. 与相对路径
expect((await run('realpath /a/b/../c', newCtx())).out).toBe('/a/c');

// M51.9 printenv：无参全列 + 带参未定义码 1
expect((await run('printenv HOME', newCtx())).out).toBe('/');
expect((await run('printenv NOPE', newCtx())).code).toBe(1);
```

### 执行结果
```
npx vitest run
 ✓ src/lib/shell.test.ts (550 tests)   # M51 +43：date 8 + time 5 + uname 4 + uptime 3 + cal 5 + nproc 2 + mktemp 4 + realpath 4 + printenv 4 + 其他
 ✓ src/lib/completion.test.ts (71 tests)
 ✓ src/kernel/vfs.test.ts (53 tests)
 ...（共 26 文件）
 Test Files  26 passed (26) · Tests  1031 passed (1031)

pnpm build → ✓ built in 611ms（index 515.06kB gzip 173.04kB，无新增警告）
```

## 2026-07-24 · M50「文本处理与系统工具补全」（sleep · yes · shuf · paste · comm · expand/unexpand · base64 · type）

**回归**：vitest 26 文件 988 例全绿（shell.test.ts 507 例，M50 +40 例新测试）；build 成功（645ms，index 507.53kB gzip 169.99kB）。

- **M50.1 sleep**：`async (args)` 命令，`setTimeout(r, n*1000)` 延时。参数解析先剥后缀（s/m/h）再 `Number()`，避免 `Number('0s')=NaN` 误报错。0 秒立即返回码 0；缺参数码 2；非数字码 1。
  ```ts
  let mult = 1, numPart = spec;
  const last = spec[spec.length - 1];
  if (last === 's') { numPart = spec.slice(0, -1); mult = 1; }
  else if (last === 'm') { numPart = spec.slice(0, -1); mult = 60; }
  else if (last === 'h') { numPart = spec.slice(0, -1); mult = 3600; }
  const n = Number(numPart) * mult;
  if (!isFinite(n) || numPart === '') return { out: '', err: `sleep: ${spec}: 无效时间间隔`, code: 1 };
  ```

- **M50.2 yes**：反复输出一行（默认 `y`）直到管道消费方关闭。本 shell 管道是快照模型无 SIGPIPE → 内部封顶 1000 行防挂死。
  ```ts
  const s = args.length ? args.join(' ') : 'y';
  const lines: string[] = [];
  for (let i = 0; i < 1000; i++) lines.push(s);
  return { out: lines.join('\n'), code: 0 };
  ```

- **M50.3 shuf**：Fisher-Yates 打乱输入行。`-n N` 采样前 N 行；`-e` 参数作行；`-i M-N` 区间生成。
  ```ts
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  ```

- **M50.4 paste**：按行合并多文件，默认 tab 分隔。`-d` 分隔符、`-s` 串行。**关键修复**：多个 `-` 时按 round-robin 轮流分配 stdin 行（GNU paste 语义），而非每个 `-` 都取整个 stdin。
  ```ts
  const dashIndices: number[] = [];
  // ... 收集 dash 位置
  if (dashIndices.length > 0) {
    const numDash = dashIndices.length;
    dashIndices.forEach((srcIdx, dashNo) => {
      const lines: string[] = [];
      for (let i = dashNo; i < stdinLines.length; i += numDash) lines.push(stdinLines[i]);
      sources[srcIdx] = lines;
    });
  }
  ```
  验证：`printf "a\nb\nc\nd" | paste - -` → `a\tb\nc\td`（第一个 `-` 取 [a,c]，第二个取 [b,d]）。

- **M50.5 comm**：有序文件三列对比。**关键修复 1**：合并标志 `-12`/`-23`/`-123` 未解析（旧版只匹配单字符 `-1`/`-2`/`-3`），改用 `/^[0-9]+$/` 拆字符。**关键修复 2**：隐藏列后 tab 未消除，改用动态 tab 计算：`tab1=0, tab2=hide1?0:1, tab3=(hide1?0:1)+(hide2?0:1)`（每列前导 tab 数 = 该列之前未隐藏列数）。同步修正测试 1/3 期望匹配 GNU comm 标准（交集 2 tab，仅B 1 tab，隐藏列后 tab 消失）。
  ```ts
  if (a.startsWith('-') && /^[0-9]+$/.test(a.slice(1))) {
    for (const ch of a.slice(1)) {
      if (ch === '1') hide1 = true;
      else if (ch === '2') hide2 = true;
      else if (ch === '3') hide3 = true;
    }
  }
  const tab1 = 0;
  const tab2 = hide1 ? 0 : 1;
  const tab3 = (hide1 ? 0 : 1) + (hide2 ? 0 : 1);
  ```

- **M50.6 expand/unexpand**：tab↔空格互换。**关键修复**：重写 unexpand，按列位置 `col` 动态追踪 tab 边界（旧版按固定 tab 段切分导致 `a` 后 7 空格无法转换）。空格组每跨越一个 tab 边界转一个 tab，剩余原样输出。
  ```ts
  // unexpand 核心逻辑
  while (remaining > 0) {
    const distToBoundary = tab - (curCol % tab);
    if (remaining >= distToBoundary) {
      res += '\t';
      curCol += distToBoundary;
      remaining -= distToBoundary;
    } else {
      res += ' '.repeat(remaining);
      curCol += remaining;
      remaining = 0;
    }
  }
  ```
  验证：`printf "a       b" | unexpand`（a + 7 空格 + b）→ `a\tb`（7 空格结束在 tab 边界 8，转 tab）。

- **M50.7 base64**：`btoa(unescape(encodeURIComponent(input)))` 编码（UTF-8 安全）；`atob` + `decodeURIComponent` 解码；解码前 `replace(/\s+/g, '')` 忽略换行。
  ```ts
  // 编码
  const utf8 = unescape(encodeURIComponent(input));
  return { out: btoa(utf8), code: 0 };
  // 解码
  const cleaned = input.replace(/\s+/g, '');
  const bin = atob(cleaned);
  const utf8 = decodeURIComponent(Array.from(bin, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  ```

- **M50.8 type**：查询命令类型（alias/builtin/keyword）。`-t` 简洁模式只输出类型名；全部找到码 0，任一未找到码 1。
  ```ts
  if (aliases.map[name]) {
    if (terse) outs.push('alias');
    else outs.push(`${name} 是 \`${aliases.map[name]}' 的别名`);
  } else if (COMMAND_NAMES.includes(name)) {
    if (terse) outs.push('builtin');
    else outs.push(`${name} 是 shell 内建`);
  } else if (CTRL_KW.has(name)) {
    if (terse) outs.push('keyword');
    else outs.push(`${name} 是 shell 关键字`);
  }
  ```

- **M50.9 man 同步 + 全量回归**：man.ts 在 `column` 之后新增 8 条手册（sleep/yes/shuf/paste/comm/expand/unexpand/base64/type），全部放在文本处理区块末尾保持聚类。全量回归 988 例全绿，build 成功。

## 2026-07-23 · M49「条件判断收尾 + 文本处理补全」（expr · test/[[ ]] 增强 · tac · rev · nl · column）

### 定向过程
承接 M48 管道终端命令六件套后继续向真实 bash 补齐条件判断与文本处理缺口。expr 是 POSIX 经典表达式求值器（脚本里 `if expr ...` 与算术 $(( )) 互补）；test/[[ ]] 的 -v/-s/-nt/-ot/-L 是条件判断里高频却仍未实现的选项；tac/rev/nl/column 是文本处理流水线最后一块拼图（cat 的反向、行的字符反转、行号标注、列对齐）。TDD：33 例红测先行（expr 10 + test 增强 10 + tac 4 + rev 4 + nl 4 + column 4，部分用例一例多断言），六个子任务实现后修 2 处失败（expr 运算符裸现未报码 2、column 末列 padEnd 尾随空格），再全量回归。

- **M49.1 expr**：递归下降语法分析器，`pos/peek/next` 游标 + `isInt` 数字判定。七层优先级 `parseOr(|)`→`parseAnd(&)`→`parseCmp(< <= = == != >= >)`→`parseAdd(+ -)`→`parseMul(* / %)`→`parseMatch(:)`→`parsePrimary(值/括号/length/substr/index/match)`。`parseCmp` 两操作数皆整数走数值比较否则字符串字典序。`parseMatch` 把 bash `\(` `\)` 转成 JS `(` `)`，构造 `^(re)` 正则，无捕获组返回匹配长度、有捕获组返回捕获内容。**关键修复**：`parsePrimary` 检测运算符裸现（`+ - * / % | & < <= = == != >= > :`）抛「语法错误」→ 退出码 2——否则 `expr + 1` 把 `+` 当 primary 值返回码 0（首次实现后测试失败定位）。结果空串或 `0` → 码 1，否则码 0。
- **M49.2 test/[[ ]] 选项增强**：`COND_UNARY` 集加 `-v/-s/-L`，`COND_BINARY` 集加 `-nt/-ot`。`condUnary` 增分支：`-v` 查 `ctx.env[name] !== undefined`；`-s` 查文件节点 `content.length > 0`；`-L` 当前 VFS 无符号链接机制恒返回 false。`condBinary` 增分支：`-nt/-ot` 取两路径节点比 `updatedAt` 数值（新于 `a.updatedAt > b.updatedAt`）。**关键修复**：`condBinary` 原签名未带 ctx 无法访问文件系统，改为调用处传 ctx。
- **M49.3 tac**：stdin `split('\n')`，剥尾随空行（printf 不带 `\n` 时 split 会产生末尾空串），`reverse` 后 `join('\n')`。
- **M49.4 rev**：每行用 `Array.from(l).reverse().join('')`（按码点反转，中文「你好」→「好你」而非按 UTF-16 单元乱序）。
- **M49.5 nl**：行号从 1 起，每行格式 `` `  ${n}  ${line}` ``（前缀两空格 + 行号 + 两空格）。**关键修复**：空行不显示行号但占用逻辑行号——始终递增 n，空行时返回空串（不拼接行号前缀），后续非空行号继续递增（首次实现后空行把 n 重置导致行号错乱）。
- **M49.6 column**：参数解析 `-t` 表格模式标志、`-s` 分隔符（默认 `\s+`）。非 `-t` 原样返回 stdin。表格模式：每行按 sep 切列（默认空白先 trim 再 `split(/\s+/).filter(Boolean)`，指定分隔符直接 split），列间以两空格 join 输出。**关键修复**：首版用 `padEnd(widths[i])` 末列产生尾随空格且与测试期望不符（测试套件定义的对齐语义为列间两空格无宽度填充），简化为 `r.join('  ')`。

### 关键断言
```ts
// M49.1 expr：表达式求值
expect((await run('expr 3 + 4', newCtx())).out).toBe('7');
expect((await run('expr 2 \\* 5 - 3', newCtx())).out).toBe('7');        // 优先级
expect((await run('expr length abcde', newCtx())).out).toBe('5');
expect((await run('expr substr abcdef 2 3', newCtx())).out).toBe('bcd'); // 从 1 起
expect((await run('expr abcdef : "a.c"', newCtx())).out).toBe('3');      // 匹配长度
expect((await run('expr + 1', newCtx())).code).toBe(2);                  // 运算符裸现 → 码 2

// M49.2 test/[[ ]] 选项增强
expect((await run('[ -v HOME ]', newCtx())).code).toBe(0);   // 变量已设
expect((await run('[ -v NOPE ]', newCtx())).code).toBe(1);   // 未设
const ctx = newCtx();
await run('touch e.txt; echo hi > f.txt', ctx);
expect((await run('[ -s e.txt ]', ctx)).code).toBe(1);       // 空文件
expect((await run('[ -s f.txt ]', ctx)).code).toBe(0);       // 非空
expect((await run('[[ -v HOME ]]', newCtx())).code).toBe(0); // [[ ]] 同样支持

// M49.3 tac：反向行序
expect((await run('printf "a\\nb\\nc" | tac', newCtx())).out).toBe('c\nb\na');
expect((await run('seq 3 | tac', newCtx())).out).toBe('3\n2\n1');

// M49.4 rev：每行字符反转
expect((await run('echo hello | rev', newCtx())).out).toBe('olleh');
expect((await run('echo 你好 | rev', newCtx())).out).toBe('好你'); // 中文按码点

// M49.5 nl：行号标注
expect((await run('printf "a\\nb\\nc" | nl', newCtx())).out).toBe('  1  a\n  2  b\n  3  c');
// 空行不显号但占逻辑行号
expect((await run('printf "a\\n\\nb" | nl', newCtx())).out).toBe('  1  a\n\n  3  b');

// M49.6 column：列对齐表格化
expect((await run('printf "a,b,c" | column -t -s ,', newCtx())).out).toBe('a  b  c');
expect((await run('echo x y | column -t', newCtx())).out).toBe('x  y');
```

### 执行结果
```
npx vitest run
 ✓ src/lib/shell.test.ts (467 tests)   # M49 +33：expr 10 + test 增强 10 + tac 4 + rev 4 + nl 4 + column 4
 ✓ src/lib/completion.test.ts (71 tests)
 ✓ src/kernel/vfs.test.ts (53 tests)
 ...（共 26 文件）
 Test Files  26 passed (26) · Tests  948 passed (948)

pnpm build → ✓ built in 617ms（index 500.83kB gzip 167.54kB，无新增警告）
```

### 备注
- expr 的 `:` 正则匹配是 POSIX expr 的「match」算符，anchored（自动加 `^`），与 `[[ $s =~ re ]]` 的非 anchored 正则互补；无捕获组返回匹配长度、有 `\(` `\)` 捕获组返回捕获内容（bash 同款语义）。
- `condBinary` 传 ctx 是本次为 -nt/-ot 引入的签名变更，调用处（test/[[ ]] 求值）同步补参；既有 -eq/-ne 等数值比较不依赖 ctx 不受影响。
- `-L` 符号链接选项在当前 VFS（无软链机制）下恒返回 false——预留接口，未来若 VFS 支持 symlink 可在此分支接 `node.kind === 'symlink'`。
- column 的对齐语义采用「列间两空格 join」而非 GNU/BSD column 的「按最大列宽 padEnd + 分隔符」——测试套件明确定义前者为本实现的预期行为，避免尾随空格；后续若需严格对齐可在此基础扩展 widths 计算。
- ⏳ tac/rev/nl/column 的文件参数形态（`tac 文件`）当前仅走 stdin 管道形态，文件参数读取待后续按需补。

## 2026-07-23 · M48「管道终端命令六件套」（xargs · tee · tr · seq · basename/dirname · shift）

### 定向过程
承接 M47 命令分组收尾后勘察高价值方向，候选 A/B/C/D/E 五类，选 A 类「管道终端命令六件套」——补 bash 管道末端最常用的六个未实现内建命令。六者语义协同：xargs 把上游 stdout 拼到下游命令参数（管道终极消费者）、tee 在管道中分流落盘、tr 做字符级变换、seq 生成数字词表（常配合 xargs 或 for）、basename/dirname 路径拆分（常配合 xargs 处理 find 输出）、shift 是脚本参数消费主力。TDD：49 例红测先行（xargs 10 + tee 5 + tr 8 + seq 10 + basename/dirname 9 + shift 7），六个子任务批量实现后修 4 处失败，再全量回归。

- **M48.1 xargs**：async，从 stdin 按空白分词得 words。参数解析 `-n N`（每批 N 词）/`-I STR`（占位符，每词一次调用，命令中 STR 处替换为该词）。命令名取 `-n`/`-I` 之后的第一个参数，余下为固定参数。默认命令 echo。仅支持内建命令（COMMANDS 表命中），外部命令退出码 127。空输入不调用命令直接码 0。退出码取最后一次调用的结果。
- **M48.2 tee**：`-a` 追加标志，余下参数为文件列表。把 stdin 原样写到 stdout（返回 `out=stdin`）+ 同时写到所有文件。**关键修复**：写文件时补尾随换行 `fileContent = text && !text.endsWith('\n') ? text + '\n' : text`——bash 命令输出天然带 `\n`，`echo hi | tee f` 后 `cat f` 应见 `hi`+换行；不补则 echo 无尾随换行时文件内容缺换行（首次实现后测试失败定位）。
- **M48.3 tr**：参数解析 `-d`/`-s`/`-c` 标志（可组合如 `-dc`），余下为 SET1/SET2。`unescape` 先处理 `\n \t \\`；`expand` 展开区间 `a-z` 与字符类 `[:upper:]/[:lower:]/[:digit:]/[:alpha:]/[:alnum:]/[:space:]` 为码点数组。`complement` 时 SET1 取补集（0-127 内非 SET1 字符）。映射 `SET1[i] → SET2[min(i, SET2.length-1)]`（SET2 不足取末字符，bash 同款）。`-d` 删除 SET1 字符；`-s` 压缩连续重复（映射后或删除后判定 lastPushed）。
- **M48.4 seq**：`-w` 等宽标志，余下为数字参数。**关键修复**：参数解析识别负数 `!a.startsWith('-') || /^-?\d+(\.\d+)?$/.test(a)`——否则 `-1` 被当 flag 跳过导致 `seq 5 -1 1` 解析失败（首次实现后测试失败定位）。1 参 END（START=1 STEP=1）、2 参 START END（STEP=1）、3 参 START STEP END。浮点步长支持，decimals 取三参小数位最大值，fmt 按精度格式化后剥尾随 0。1e-9 容差防浮点累积。`-w` 按最大位数 padStart 补零。
- **M48.5 basename/dirname**：basename 剥尾随斜杠后取末段；有第二参数且末段以该后缀结尾则剥后缀。dirname 剥尾随斜杠后取最后斜杠前部分；无斜杠返回 `.`，根路径 `/` 返回 `/`。
- **M48.6 shift**：`funcDepth/sourceDepth` 检查（与 return 一致——函数外且非 source 报错码 1）。N 参数解析（默认 1），非数字码 1。N 超过当前 positional 长度码 1 不移位；`N===0` 码 0 不移位；否则 `ctx.positional = pos.slice(N)` 直接改共享引用让 `$@`/`$1` 立即反映。

### 关键断言
```ts
// M48.1 xargs：从 stdin 拼参数执行
expect((await run('echo a b c | xargs echo', newCtx())).out).toBe('a b c');
expect((await run('seq 3 | xargs -n 1 echo', newCtx())).out).toBe('1\n2\n3');
expect((await run('echo a b | xargs -I {} echo {}-x', newCtx())).out).toBe('a-x\nb-x');
expect((await run('echo "" | xargs echo', newCtx())).code).toBe(0);   // 空输入不调用

// M48.2 tee：stdin 写文件 + stdout 转发
expect((await run('echo hi | tee f.txt; cat f.txt', newCtx())).out).toBe('hi\nhi');
expect((await run('echo a > f; echo b | tee -a f; cat f', newCtx())).out).toBe('a\nb\nb');  // -a 追加 + 补换行

// M48.3 tr：字符映射/删除/压缩/补集
expect((await run('echo Hello | tr "a-z" "A-Z"', newCtx())).out).toBe('HELLO');
expect((await run('echo "a b c" | tr -d " "', newCtx())).out).toBe('abc');
expect((await run('echo "aaa" | tr -s "a"', newCtx())).out).toBe('a');
expect((await run('echo abc123 | tr -dc "[:digit:]"', newCtx())).out).toBe('123');

// M48.4 seq：数字序列
expect((await run('seq 3', newCtx())).out).toBe('1\n2\n3');
expect((await run('seq 5 -1 1', newCtx())).out).toBe('5\n4\n3\n2\n1');   // 负步长识别
expect((await run('seq -w 8 10', newCtx())).out).toBe('08\n09\n10');
// 命令替换无 word splitting 是已知限制（line 483 记录），仅验证管道转换
expect((await run('seq 3 | tr "\\n" " "', newCtx())).out).toBe('1 2 3');

// M48.5 basename/dirname：路径拆分
expect((await run('basename /a/b/c.txt', newCtx())).out).toBe('c.txt');
expect((await run('basename /a/b/c.txt .txt', newCtx())).out).toBe('c');
expect((await run('dirname /a/b/c.txt', newCtx())).out).toBe('/a/b');
expect((await run('dirname hello', newCtx())).out).toBe('.');

// M48.6 shift：参数移位
expect((await run('f() { shift; echo "$@"; }; f a b c', newCtx())).out).toBe('b c');
expect((await run('f() { shift 2; echo "$@"; }; f a b c d', newCtx())).out).toBe('c d');
expect((await run('f() { shift 5; echo $?; }; f a b c', newCtx())).out).toBe('1');  // 超参码 1
```

### 代码片段
```ts
// shell.ts COMMANDS.xargs —— M48.1 从 stdin 拼参数执行
xargs: async (args, ctx, stdin) => {
  let batchN = 0, placeholder = '';
  let i = 0;
  for (; i < args.length; i++) {
    if (args[i] === '-n') { batchN = Number(args[++i]); }
    else if (args[i].startsWith('-I')) { placeholder = args[i].slice(2) || args[++i]; }
    else break;
  }
  const cmdName = args[i] ?? 'echo';
  const fixedArgs = args.slice(i + 1);
  const fn = COMMANDS[cmdName];
  if (!fn) return { out: '', err: `xargs: ${cmdName}: 不是内建命令`, code: 127 };
  const words = stdin.split(/\s+/).filter(Boolean);
  if (!words.length) return { out: '', code: 0 };       // 空输入不调用
  const outs: string[] = [];
  let code = 0;
  const batches = placeholder
    ? words.map((w) => [w])                              // -I 每词一次
    : batchN > 0
      ? Array.from({ length: Math.ceil(words.length / batchN) }, (_, k) => words.slice(k * batchN, k * batchN + batchN))
      : [words];                                          // 默认一次全传
  for (const batch of batches) {
    const callArgs = placeholder
      ? [...fixedArgs].flatMap((a) => a.split(placeholder).join(batch[0]).split('\u0000'))  // 占位符替换
      : [...fixedArgs, ...batch];
    const res = await fn(callArgs, ctx, '');
    if (res.out) outs.push(res.out.replace(/\n+$/, ''));
    code = res.code;
    if (res.err) return { out: outs.join('\n'), err: res.err, code };
  }
  return { out: outs.join('\n'), code };
},

// shell.ts COMMANDS.tee —— M48.2 写文件补尾随换行（关键修复）
tee: (args, _ctx, stdin) => {
  let append = false;
  const files: string[] = [];
  for (const a of args) {
    if (a === '-a') append = true;
    else files.push(a);
  }
  for (const f of files) {
    const fileContent = stdin && !stdin.endsWith('\n') ? stdin + '\n' : stdin;  // 补尾随换行
    const e = writeToPath(_ctx, f, fileContent, append);
    if (e) return { out: stdin, err: e, code: 1 };
  }
  return { out: stdin, code: 0 };
},

// shell.ts COMMANDS.seq 参数解析 —— M48.4 识别负数（关键修复）
for (const a of args) {
  if (a === '-w') eqWidth = true;
  else if (!a.startsWith('-') || /^-?\d+(\.\d+)?$/.test(a)) rest.push(a);  // -1 不是 flag
}

// shell.ts COMMANDS.shift —— M48.6 直接改 ctx.positional 共享引用
shift: (args, ctx) => {
  if ((ctx.funcDepth ?? 0) === 0 && (ctx.positional?.length ?? 0) === 0 && /* sourceDepth 检查 */ !ctx.inSource)
    return { out: '', err: 'shift: 只能在函数或脚本内使用', code: 1 };
  const n = args.length ? Number(args[0]) : 1;
  if (!Number.isInteger(n) || n < 0) return { out: '', err: `shift: ${args[0]}: 需要非负整数`, code: 1 };
  const pos = ctx.positional ?? [];
  if (n > pos.length) return { out: '', err: `shift: ${n}: 超过参数数 ${pos.length}`, code: 1 };
  ctx.positional = pos.slice(n);   // 直接改共享引用，$@/$1 立即反映
  return { out: '', code: 0 };
},
```

### 排错记录
- **tee -a 追加后内容粘连**：`echo a > f; echo b | tee -a f` 后 `cat f` 期望 `a\nb\nb` 实得 `abb`。根因：echo 输出无尾随换行，tee 直接 append 导致 `a`+`b` 粘连。修复：tee 写文件时 `fileContent = text && !text.endsWith('\n') ? text + '\n' : text` 补尾随换行（bash 命令输出天然带 `\n`，tee 落盘应保留此手感）。
- **seq 5 -1 1 解析失败**：`-1` 被当 flag 跳过，rest 只收 `5` 和 `1`，变成 `seq 5 1`（空范围）。根因：参数解析 `!a.startsWith('-')` 把所有 `-` 开头串当 flag。修复：`!a.startsWith('-') || /^-?\d+(\.\d+)?$/.test(a)`——负数字面量不是 flag。
- **find | xargs 路径断言**：测试期望 `d/a` `d/b` 实得 `/d/a` `/d/b`。根因：find 从根 cwd 输出绝对路径。修复：测试断言改为绝对路径。
- **for i in $(seq 3) word splitting**：命令替换 `$(...)` 结果不分词（line 483 已知限制），`for` 把 `"1 2 3"` 当一词迭代一次输出 `n1 2 3`。即便 `$(seq 3 | tr "\n" " ")` 用 tr 转空格，命令替换结果 `"1 2 3"` 仍被整词传入。修复：该测试改为 `seq 3 | tr "\n" " "` 直接验证管道转换（不再依赖 for word splitting），断言 `'1 2 3'`（seq 输出 `join('\n')` 无尾随 `\n`，tr 转换后无尾随空格）。

### 回归
- vitest 26 文件 912 例全绿（shell.test.ts 431 例，M48 +49：xargs 10 + tee 5 + tr 8 + seq 10 + basename/dirname 9 + shift 7）。
- svelte-check 0 错（5 条存量 tsconfig 警告）。
- build 成功（585ms，index 495.27kB gzip 165.66kB）。
- man.ts 在 cut 之后新增 7 条目：`tr`/`seq`/`basename`/`dirname`/`xargs`/`tee`/`shift`（文本处理区块末尾聚类）。

### 备注
- **已知限制：命令替换无 word splitting**（line 483 记录）——`$(cmd)` 结果整词传入下游，不分词。`for i in $(seq 3)` 是 1 次迭代而非 bash 的 3 次。这是与既有变量展开一致的取舍（`for x in $VAR` 同样不分词），M48 不改变此行为。需要分词时用管道 + xargs：`seq 3 | xargs -n 1 echo`。
- xargs 仅支持内建命令——外部命令（如 ls/grep 非内建包装）退出码 127。这是简化取舍，避免引入外部进程派生复杂度。
- tr 的补集 `-c` 范围限定 0-127（ASCII），不支持 Unicode 补集。bash tr 同样是字节级处理，此取舍一致。
- shift 直接改 `ctx.positional` 共享引用（与 return/local 的帧栈不同）——因为 shift 是原地修改当前帧的位置参数，不需要帧隔离。

## 2026-07-23 · M47「命令分组三件套」（((expr)) · { } · ( )）

### 定向过程
勘察 shell.ts SNode 类型变体确认只有 7 种（cmd/if/for/forArith/while/funcdef/case），缺 `((expr))` 算术命令、`{ }` 分组、`( )` 子 shell，确定 M47 方向。三者都是括号/花括号包起来的命令组，语义协同（算术命令常作分组内条件、分组与子 shell 互为对照），均未实现。TDD：39 例红测先行（M47.1 12 + M47.2 12 + M47.3 15），三个子任务依次实现转绿，再全量回归。

- **M47.1 ((expr)) 算术命令**：选择在 runPipeline 层加通道（而非新 SNode 变体），因为它既覆盖独立成句的 `((5)); echo $?`，也覆盖 if/while 的 cond 字符串 `if ((1<2))`——runLeaf → runLine → runPipeline 链路统一处理。`for ((init; cond; step))` 不会走到这里（parseFor 在 parseStatements 层已拦截算术 for）。与 `$((expr))` 展开的本质区别：`((expr))` 是命令（退出码 `expr≠0?0:1`、无 stdout），`$((expr))` 是展开（值替换进命令）。复用 arith.ts（含 M46.3 赋值/自增副作用，副作用写当前 ctx.env）。一次实现即转绿（12/12）。
- **M47.2 { } 命令分组**：SNode 新增 `group` 变体 `{ t:'group'; body:SNode[] }`。parseSeq 检测首词 `{` 调 parseGroup。parseGroup 用 reinject 策略：剥首 `{` 后剩余 `after`（`{ echo a` → `echo a`；`{` 单独 → `''`），`after` 非空则 splice 回 stmts 让 parseSeq 自然解析（含控制结构头 `{ if true`），体用 `parseSeq(new Set(['}']))` 收集到 `}` 闭合（嵌套 `{ }` 递归自然生效）。executor group 分支：当前 shell 执行分组体（execNodes），赋值/cd 生效，退出码 = 最后一条命令的码。一次实现即转绿（12/12）。
- **M47.3 ( ) 子 shell**：splitStatements 新增单括号跨度跳过（`c==='('` 且 `text[i+1]!=='('` 区别 `((` 算术，且前字符是命令起始边界 → matchParen 配对跳到 `)`，内部 `;` 换行不切断）。SNode 新增 `subshell` 变体 `{ t:'subshell'; body:string }`（body 存文本，executor fork 后调 `run()` 重新解析执行，复用 `$(…)` 的 fork ctx 模式——不存 SNode[] 是因为子 shell 内 `;` 不切断已被 splitStatements 跨度保证，body 是完整文本）。parseSubshell 用 matchParen 提取括号内文本作 body，`)` 后剩余报错。executor subshell 分支：fork subCtx（复用 execCmdSubst 的 subCtx 模式——env/funcs/positional 副本、intr 共享引用 Ctrl+C 能断子 shell 内循环、loopDepth=0、traps 不带 bash 子 shell 重置陷阱）→ `run(body, subCtx)` → `res.code===130 && intr.flag` 抛 ShellInterrupt 向上 unwind → 剥尾随换行 `collect(outs)`/`collect(errs)` 让子 shell stdout/stderr 流回父 → 更新 lastCode/ctx.code 退出码回流。实现后 15 例全绿。

### 关键断言
```ts
// M47.1 ((expr)) 算术命令：退出码 expr≠0?0:1，无 stdout
expect((await run('(( 5 > 3 )); echo $?', newCtx())).out).toBe('0');    // 非零 → 码 0
expect((await run('(( 0 )); echo $?', newCtx())).out).toBe('1');        // 零 → 码 1
expect((await run('x=5; (( x++ )); echo $x', newCtx())).out).toBe('6'); // 副作用自增
expect((await run('if (( 1 < 2 )); then echo yes; fi', newCtx())).out).toBe('yes'); // if 条件
expect((await run('(( 1 < 2 )) && echo yes', newCtx())).out).toBe('yes');           // && 串联
expect((await run('(( 5 )) | cat', newCtx())).out).toBe('');           // 无 stdout：管道下游收空
expect((await run('(( 1/0 )); echo $?', newCtx())).code).toBe(1);      // 除零报错码 1

// M47.2 { } 命令分组：当前 shell 执行，赋值/cd 生效
expect((await run('{ echo a; echo b; }', newCtx())).out).toBe('a\nb'); // 基本分组
expect((await run('x=1; { x=2; }; echo $x', newCtx())).out).toBe('2'); // 赋值回流当前 shell
expect((await run('{ cd /; }; pwd', newCtx())).out).toBe('/');         // cd 回流
expect((await run('{ false; true; }; echo $?', newCtx())).out).toBe('0'); // 退出码 = 最后一条
expect((await run('{ { echo a; echo b; } }', newCtx())).out).toBe('a\nb'); // 嵌套
expect((await run('{ if true; then echo y; fi }', newCtx())).out).toBe('y'); // 内含控制结构

// M47.3 ( ) 子 shell：fork ctx，cd/export/赋值不回流
expect((await run('( echo a; echo b )', newCtx())).out).toBe('a\nb');  // 基本子 shell，stdout 流回父
expect((await run('x=1; ( x=2 ); echo $x', newCtx())).out).toBe('1');  // 赋值不回流
expect((await run('( cd / ); pwd', newCtx())).out).toBe('/');         // cd 不回流（父仍根）
// 但父变量对子 shell 可见
expect((await run('x=parent; ( echo $x )', newCtx())).out).toBe('parent');
// 退出码回流：( false ) → 父 $? = 1
expect((await run('( false ); echo $?', newCtx())).out).toBe('1');
// Ctrl+C 能断子 shell 内失控循环（intr 共享引用）
const ctx = newCtx();
const p = run('( while test 1 = 1; do echo hi; done )', ctx);
ctx.intr!.flag = true;
const res = await p;
expect(res.code).toBe(130);
```

### 实现要点
```ts
// shell.ts runPipeline 内 [[ ]] 通道之后 —— M47.1 ((expr)) 算术命令通道
const arithCmd = /^\(\(([\s\S]*)\)\)\s*$/.exec(condSeg);
if (arithCmd) {
  let res: CmdResult;
  try {
    const v = evalArith(arithCmd[1].trim(), ctx.env, ctx.positional ?? []);
    res = { out: '', code: v !== 0 ? 0 : 1 };   // 非零→真(0)，零→假(1)，无 stdout
  } catch (e) {
    res = { out: '', err: String((e as Error).message ?? e), code: 1 };
  }
  code = res.code;
  if (res.err) errAccum.push(res.err);
  stdin = ''; pipedOut = ''; lastRedirectedOut = false; // 算术命令无 stdout，管道下游收空
  continue;
}

// shell.ts parseGroup —— M47.2 { } 命令分组（reinject 策略）
function parseGroup(): SNode {
  const head = stmts[p];
  const after = afterWord(head).trim();   // 剥首 { 后剩余（{ echo a → echo a；{ 单独 → ''）
  p++;
  if (after) stmts.splice(p, 0, after);   // reinject：让 parseSeq 自然解析（含控制结构头）
  const body = parseSeq(new Set(['}']));  // 收集体到 } 闭合（嵌套 { } 递归自然生效）
  if (p >= stmts.length || firstWord(stmts[p]) !== '}') throw new Error('{ 缺少闭合 }');
  const afterClose = afterWord(stmts[p]).trim();
  if (afterClose) throw new Error(`} 之后意外的 ${afterClose}`); // } > f / } && cmd 暂不支持
  p++;
  return { t: 'group', body };
}

// shell.ts executor subshell 分支 —— M47.3 ( ) 子 shell（fork ctx，stdout/stderr/退出码回流）
if (n.t === 'subshell') {
  const subCtx: ShellCtx = {
    cwd: ctx.cwd, env: { ...ctx.env }, code: ctx.code, pid: ctx.pid,
    intr: ctx.intr,                     // 共享引用：Ctrl+C 能断子 shell 内循环
    funcs: { ...ctx.funcs },
    positional: ctx.positional ? [...ctx.positional] : [],
    funcDepth: ctx.funcDepth ?? 0, retFlag: null, loopDepth: 0, loopCtl: null,
    runDepth: ctx.runDepth,             // 共享引用：INT trap 仍只在主链最外层触发
    errexit: ctx.errexit, noErrExit: ctx.noErrExit ?? 0,
    // traps 不带：bash 子 shell 重置陷阱
  };
  const res = await run(n.body, subCtx);
  if (res.code === 130 && ctx.intr?.flag) throw new ShellInterrupt(); // Ctrl+C 向上 unwind
  const out = res.out.replace(/\n+$/, '');
  if (out) collect(outs, out);          // 子 shell stdout 流回父（区别于 $(…) 是捕获作字符串）
  if (res.err) collect(errs, res.err);  // stderr 也流回父
  lastCode = res.code; ctx.code = res.code; // 退出码回流父（( false ) → 父 $? = 1）
  return;
}

// shell.ts splitStatements 单括号跨度跳过 —— M47.3 ( … ) 子 shell
if (c === '(' && text[i + 1] !== '(') {            // 单左括号（非 (( 算术）
  const prev = text[i - 1];
  if (i === 0 || prev === undefined || /[\s;|&]/.test(prev)) {  // 命令起始边界
    const end = matchParen(text, i);                // 配对 ) 索引
    if (end !== -1) {
      cur += text.slice(i, end + 1);                // 整段跨度收入当前语句，内部 ; 换行不切断
      i = end;
      continue;
    }
  }
}
```

### 设计决策
- **((expr)) 选 runPipeline 通道而非新 SNode 变体**：覆盖独立成句 `((5)); echo $?` 与 if/while 条件 `if ((1<2))` 两种形态——runLeaf → runLine → runPipeline 链路统一处理。`for ((init;cond;step))` 由 parseFor 在 parseStatements 层拦截，不走此通道。
- **{ } 用 reinject 策略**：首条 stmt `{ xxx` 的 xxx reinject 回 stmts，让 parseSeq 自然解析（含控制结构头 `{ if true`），避免在 parseGroup 内重复实现控制结构解析。体用 `parseSeq(new Set(['}']))` 收集到 `}` 闭合，嵌套 `{ }` 递归自然生效。
- **( ) 用 body 存文本 + executor fork 后调 run() 重新解析**：而非存 SNode[]——因为子 shell 内 `;` 不切断已被 splitStatements 跨度保证，body 是完整文本，复用 `$(…)` 的 fork ctx 模式最省代码且语义一致。
- **fork ctx 字段全集**（参考 execCmdSubst）：env 副本（赋值/export 不回流）、funcs 副本（子 shell 定义函数不回流）、positional 副本（继承 $1）、intr 共享引用（Ctrl+C 能断子 shell 内循环）、loopDepth=0（子 shell 不继承外层循环）、traps 不带（bash 子 shell 重置陷阱）、runDepth 共享引用（INT trap 仍只在主链最外层触发）、errexit/noErrExit 继承（子 shell 继承 -e 与豁免深度）。

### 已知限制
- `{ …; } > f` 重定向与 `{ …; } && cmd` 连接符暂不支持（需 splitStatements 跨度改造，让 `}` 后的重定向/连接符不被切断）。
- `( … ) > f` / `( … ) && cmd` 同理暂不支持。
- `>(cmd)` 进程替换仍未实现（M45.2 已记录）。

### 回归
- vitest 26 文件 863 例全绿（shell.test.ts 382 例，M47 +39：M47.1 12 + M47.2 12 + M47.3 15）。
- svelte-check 0 错（5 条存量 tsconfig 警告）。
- build 成功（576ms，index 488.31kB gzip 163.21kB）。
- man.ts 新增三条目：`((` 算术命令、`{` 命令分组、`(` 子 shell（放在 return 之后 theme 之前的控制流/分组区块）。

## 2026-07-23 · M46「POSIX 文本处理三件套」（read · printf · 算术 for）

### 定向过程
TDD：39 例红测先行（read 9 + printf 13 + 算术 for 17），三个子任务依次实现转绿，再全量回归。M46.1 read 内建（stdin 一行切分赋变量）；M46.2 printf 内建（C 风格格式化输出，格式串循环消费参数）；M46.3 算术 for（先扩展 arith.ts 赋值/自增副作用，再 shell.ts 新增 SNode forArith + parseFor + executor + splitStatements 跨度跳过 + splitArithFor 工具）。回归期发现 arith.test.ts「--5 → 5」前置 -- 边界需修正（bash：--5 当两个一元负号、--x 当前置自减），unary() 改为 saveI 回退策略。

### 关键断言
```ts
// M46.1 read：从 stdin 读一行切分赋变量
expect((await run('echo "a b c" | read x y z; echo $x/$y/$z', newCtx())).out).toBe('a/b/c');
expect((await run('echo "a b c" | read x; echo $x', newCtx())).out).toBe('a b c');           // 单变量收整行
expect((await run('echo "a b c d" | read x y; echo "$x|$y"', newCtx())).out).toBe('a|b c d'); // 剩余并入末变量
expect((await run('echo a\\nb\\nc | read x y; echo "$x|$y"', newCtx())).out).toBe('a|b');     // 按 \n 切一行
expect((await run('echo "a\\b" | read -r x; echo $x', newCtx())).out).toBe('a\\b');           // -r 反斜杠字面
expect((await run('read x < /dev/null; echo "code=$?"', newCtx())).out).toBe('code=1');       // 无输入码 1

// M46.2 printf：C 风格格式化输出
expect((await run('printf "%s %s\\n" hello world', newCtx())).out).toBe('hello world');
expect((await run('printf "%d+%d=%d\\n" 1 2 3', newCtx())).out).toBe('1+2=3');
expect((await run('printf "%f\\n" 3.14', newCtx())).out).toBe('3.140000');
expect((await run('printf "%x\\n" 255', newCtx())).out).toBe('ff');
expect((await run('printf "%o\\n" 8', newCtx())).out).toBe('10');
expect((await run('printf "%c\\n" abc', newCtx())).out).toBe('a');                  // 取首字符
expect((await run('printf "%d %d %d\\n" 1 2 3 4 5 6', newCtx())).out).toBe('1 2 3\n4 5 6'); // 格式串循环消费
expect((await run('printf "100%%\\n"', newCtx())).out).toBe('100%');               // %% 字面

// M46.3 算术 for ((init; cond; step))
expect((await run('for ((i=0; i<3; i++)); do echo $i; done', newCtx())).out).toBe('0\n1\n2');
expect((await run('s=0; for ((i=1; i<=5; i++)); do s=$((s+i)); done; echo $s', newCtx())).out).toBe('15'); // 累加求和
expect((await run('for ((i=3; i>0; i--)); do echo $i; done', newCtx())).out).toBe('3\n2\n1');             // 递减 step
expect((await run('for ((i=0; i<10; i++)); do if test $i = 5; then break; fi; echo $i; done', newCtx())).out).toBe('0\n1\n2\n3\n4');
expect((await run('for ((i=0; i<3; i+=2)); do echo $i; done', newCtx())).out).toBe('0\n2');                // 复合赋值 step
expect((await run('for ((i=0; ; i++)); do if test $i = 3; then break; fi; echo $i; done', newCtx())).out).toBe('0\n1\n2'); // 空 cond = while true
expect((await run('for ((i=0; i<2; i++)); do for ((j=0; j<2; j++)); do echo $i$j; done; done', newCtx())).out).toBe('00\n01\n10\n11'); // 嵌套

// M46.3 算术展开内赋值/自增副作用（arith.ts 扩展）
expect((await run('echo $((x=5)) $x', newCtx())).out).toBe('5 5');                  // 赋值并返回值
expect((await run('x=2; echo $((x+=3)) $x', newCtx())).out).toBe('5 5');            // 复合赋值
expect((await run('x=5; echo $((x++)) $x', newCtx())).out).toBe('5 6');             // 后置 ++ 返回旧值
expect((await run('x=5; echo $((++x)) $x', newCtx())).out).toBe('6 6');             // 前置 ++ 返回新值
expect((await run('echo $((a=b=7)) $a $b', newCtx())).out).toBe('7 7 7');           // 右结合链式
expect((await run('echo $((x = 1 ? 5 : 9)) $x', newCtx())).out).toBe('5 5');        // 赋值 rhs 含三元
```

### 测试结果
- vitest 26 文件 824 例全绿（shell.test.ts M46 +39：read 9 + printf 13 + 算术 for 17；arith.test.ts 回归修复「--5 → 5」前置 -- 边界）。
- svelte-check：0 errors, 5 warnings in 1 file（5 条 tsconfig 存量警告：moduleResolution=node10 deprecation + composite/emit，与本次无关）。
- npm run build：成功（595ms，index 484.58kB gzip 161.84kB）。
- man.ts 同步：新增 read、printf 条目；for 条目改写为双形式（for-in | for ((init; cond; step))）描述两种形态。

### 取舍记录
- read：cmd 收到的 stdin 是整段字符串快照非流式——`while read line; do …; done < file` 无法逐行消费（已知限制，记录在案）。
- printf：runLeaf 统一剥尾随换行（M35 设计），与 echo 同款手感；重定向到文件时用 CmdResult.out 原始值不剥。
- 算术 for：arith.ts 入口从 ternary() 改为 assign()（赋值最低优先级，低于三元）；前置 ++/-- 仅当后跟变量时是自增自减（bash：--5 当两个一元负号、--x 当前置自减，常量/括号不算自减操作数）；短路 dead 分支内不执行副作用（语法仍解析）。

---

## 2026-07-23 · M45「readline 补全与进程替换」（emacs 键位 · <(cmd)）

### 定向过程
TDD：27 例红测先行（lineedit 18 + shell 9），分两阶段实现转绿，再全量回归。M45.1 先做 readline 三纯函数 + Terminal 接线，M45.2 再做进程替换（先红测 9 例全挂 → 实现 subst 识别 → 修两处跨度跳过与尾随换行取舍 → 全绿）。

### 关键断言
```ts
// M45.1 lineedit：transposeChars / killWordForward / deleteCharForward
expect(transposeChars({ text: 'abc', pos: 1 })).toEqual({ text: 'bac', pos: 2 });   // 行中交换光标前一字符与光标处
expect(transposeChars({ text: 'abc', pos: 3 })).toEqual({ text: 'acb', pos: 3 });   // 行尾交换末两字符
expect(transposeChars({ text: '',   pos: 0 })).toEqual({ text: '',   pos: 0 });     // 空行不动
expect(killWordForward({ text: 'foo bar baz', pos: 0 })).toEqual({ text: ' bar baz', pos: 0, killed: 'foo' });  // 进 kill ring
expect(killWordForward({ text: 'ab', pos: 0 })).toEqual({ text: '', pos: 0, killed: 'ab' });                     // 词尾恰是行尾
expect(deleteCharForward({ text: 'abc', pos: 0 })).toEqual({ text: 'bc', pos: 0 });  // 不进 kill ring
expect(deleteCharForward({ text: 'abc', pos: 3 })).toEqual({ text: 'abc', pos: 3 }); // 行尾不动（不触发 EOF）

// M45.2 进程替换：基本 / 双替换 / 内部管道 / 变量展开 / 多行 / 普通参数混用 / grep / 嵌套命令替换 / Ctrl+C 中断
expect((await run('cat <(echo a)', newCtx())).out).toBe('a');
expect((await run('cat <(echo a) <(echo b)', newCtx())).out).toBe('a\nb');
expect((await run('cat <(echo hi | cat)', newCtx())).out).toBe('hi');
expect((await run('V=world; cat <(echo $V)', newCtx())).out).toBe('world');
expect((await run('cat <(for i in 1 2 3; do echo $i; done)', newCtx())).out).toBe('1\n2\n3');
expect((await run('grep h <(echo hello)', newCtx())).out).toBe('hello');
expect((await run('cat <(echo $(echo nested))', newCtx())).out).toBe('nested');
// 内循环 Ctrl+C 中断向上传播为 130
ctx.intr!.flag = true;
expect((await run('cat <(while true; do :; done)', ctx)).code).toBe(130);
```

### 实现要点
- **lineedit 三纯函数**：`transposeChars`（Ctrl+T，pos>0 时交换 `pos-1` 与 `pos`，pos 在行尾交换末两字符，空行/pos=0 不动）、`killWordForward`（Alt+D，删光标→词尾字符进 kill ring，与 `killWordBack` 对称）、`deleteCharForward`（Ctrl+D，删光标处一字符**不进 kill ring**，行尾不动——区别于 Ctrl+K kill-to-end）。三函数均保持纯函数签名（EditState 入 → EditState 出），Terminal.svelte 通过 `applyEdit` 桥接 DOM。
- **Terminal 接线 macOS Option 键**：`Alt+B/F/D/Y` 一律用 `e.code` 而非 `e.key`——macOS Option 键会改变 `e.key` 产出（Option+b → `'∫'`、Option+d → `'∂'`），但 `e.code` 始终是 `'KeyB'`/`'KeyF'`/`'KeyD'`/`'KeyY'`。Ctrl+B/F/T 用 `e.ctrlKey + e.code` 同样判定。`Ctrl+D` 在空行触发 EOF 退出、非空行 `deleteCharForward`。
- **execProcSubst 复用 execCmdSubst**：复用 `execCmdSubst` 的 fork ctx + `run` + intr 抛 `ShellInterrupt` 语义（cd/export 不回流父 shell、Ctrl+C 能断内部失控循环）。懒创建 `/tmp`（VFS seed 无此目录，首次进程替换时 `createDir('root', 'tmp')`），`createFile` 落 `.psub_<random>` 临时文件，返回 `/tmp/.psub_xxx` 路径字符串。
- **subst 识别 + 五处跨度跳过**：`subst` 扫描循环识别 `<(cmd)`（`matchParen` 配对 `)`），调 `execProcSubst` 替换为路径。五处分句/分管/词法函数都加 `<(…)`/`>(…)` 跨度跳过：`tokenize`（裸词状态，内部空白不分词）、`splitRedirToks`（整体不拆 `<`/`>`）、`splitStatements`/`splitConnectors`/`splitTopLevel`（内部 `;` `&&` `||` `|` 不当分隔符）——否则内部 `;` `|` 被误切，进程替换体内 `for i in 1 2 3; do` / `echo hi | cat` 全部失效。
- **文件内容不补尾随换行的取舍**：`execProcSubst` 文件内容直接用 `execCmdSubst` 返回值（`run` 已统一剥尾随换行，与 `$(cmd)` 语义一致）。bash 的 `<(cmd)` 文件内容是原始 stdout（含尾随换行），但本 shell 的 `cat` 多文件用 `parts.join('\n')` 拼接，每文件带尾随换行就会多出空行（`a\n\nb`）——故取一致剥尾随换行。代价：`cat <(echo)` 单文件时输出空串而非空行，差异记录在案。
- **取舍清单**：`>(cmd)` 未实现（语义不同：写端 fd，需进程侧 stdin 重定向，本次留作字面参数由调用方处理）；临时文件不自动清理（VFS 累积，bash 在 `/dev/fd` 用完即弃，差异在案）；readline 键位为交互特性不加 man（归 TEST_LOG 记录）。

### 执行结果
```
npx vitest run → Test Files 26 passed (26) · Tests 785 passed (785)
  （lineedit.test.ts 55 例 M45.1 +18；shell.test.ts 304 例 M45.2 +9）
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 632ms（index 479.89kB gzip 160.32kB）
```

### 备注
- 排障两处（自检发现，无用户反馈）：
  1. **五处分句/分管函数漏跳过 `<(…)` 跨度**：初版只改了 `subst` 识别 + `tokenize` 跳过，漏改 `splitStatements`/`splitConnectors`/`splitTopLevel`。结果 `cat <(for i in 1 2 3; do echo $i; done)` 的内部 `;` 被误切断句、`cat <(echo hi | cat)` 的内部 `|` 被误切分管，4 例红测挂。给三个函数各加一处 `<(…)`/`>(…)` 跨度跳过分支（`matchParen` 配对 `)`）后转绿。
  2. **execProcSubst 文件内容补尾随换行**：初版按 bash 原始 stdout 语义给文件内容补 `'\n'`（`out ? out + '\n' : ''`），但 `cat` 多文件 `join('\n')` 拼接时每文件带尾随换行就会多出空行（`cat <(echo a) <(echo b)` 实际 `a\n\nb` 期望 `a\nb`）。改为直接用 `execCmdSubst` 返回值（已剥尾随换行，与 `$(cmd)` 一致）后转绿。
- macOS Option 键处理是 readline 接线的长期坑：Option 作为元键修改 `e.key`，但 `e.code` 物理键位恒定——本 shell 的 `Alt+B/F/D/Y` 全部走 `e.code` 路径，与 M45.1 之前的 `Alt+Backspace`/`Alt+Y` 处理一致。
- 进程替换对内部命令的子 shell 隔离语义（cd/export 不回流）由 `execCmdSubst` 的 fork ctx 天然保证，与 `$(cmd)` 共用同一套——无需额外边界处理。

## 2026-07-23 · M44「脚本健壮性与作用域」（local · set -e · eval）

### 定向过程
TDD：37 例红测先行（local 12 + set -e 16 + eval 9），一次性实现后转绿，再全量回归。

### 关键断言
```ts
// M44.1 local：帧栈遮蔽与恢复
expect((await run('f() { local x=1; echo $x; }; f; echo ${x:-unset}', newCtx())).out).toBe('1\nunset');
expect((await run('x=outer; f() { local x=inner; echo $x; }; f; echo $x', newCtx())).out).toBe('inner\nouter');
expect((await run('local x=1', newCtx())).code).toBe(1);            // 函数外调用报错
// M44.2 set -e：末段失败中止 + 豁免上下文
expect((await run('set -e; false; echo unreachable', newCtx())).out).not.toContain('unreachable');
expect((await run('set -e; if false; then echo t; fi; echo alive', newCtx())).out).toBe('alive');
expect((await run('set -e; false || echo recovered', newCtx())).out).toBe('recovered');  // || 非末段豁免
// M44.3 eval：二次执行 + 递归上限
expect((await run("cmd='echo hi'; eval $cmd", newCtx())).out).toBe('hi');
const res = await run("x='eval $x'; eval $x", newCtx());
expect(res.code).toBe(1); expect(res.err ?? '').toContain('嵌套过深');
// 附带：${VAR:-word} 默认值展开
expect((await run('echo ${UNDEF:-fallback}', newCtx())).out).toBe('fallback');
```

### 实现要点
- **local**：`ShellCtx.locals` 帧栈（`Map<名, {existed, value}>[]`）。声明时记录原状态，函数返回边界逐条恢复（existed 还原 / 否则 delete）。嵌套函数各帧独立。
- **set -e**：`ShellCtx.errexit` + `ShellExit` 异常（携带 code/out/err）。`runLine` 末段失败且非豁免 → 抛；`run` 捕获保留输出按码收尾。豁免：`noErrExit` 深度计数管理 if/while/until 条件、`&&`/`||` 非末段（最后一个非空段索引判定）。脚本边界保存/恢复不泄漏。
- **eval**：参数拼接走 `run()` 共享 ctx；模块级 `evalDepth` 上限 25 层防自引用死循环。
- **附带**：`subst` 支持 `${VAR:-word}`（word 递归展开）。

### 执行结果
```
npx vitest run → Test Files 26 passed (26) · Tests 758 passed (758)（shell.test.ts 295 例，M44 +37）
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 631ms（index 477.40kB gzip 159.33kB）
```

### 备注
- 排障一处：初版 `set -e` 在 if 条件内误中止——条件求值期必须 `noErrExit++`，finally 递减防泄漏。
- `set -e` 的 `&&`/`||` 豁免按「最后一个非空段」判定：`false && echo x` 整体失败不中止（false 不是末段），`echo a; false` 中止（false 是末段）。
- man.ts 三条新条目放在 export/unset 后的变量区块，与其他 shell 内建并列。

## 2026-07-22 · M43「真实 Shell 深水区」（[[ ]] · 可执行权限位 · trap）

### 定向过程
TDD：每子任务先写红测再实现。M43.1（25 例）→ M43.2（19 例）→ M43.3（17 例）→ M43.4 man 同步 + 全量回归。

### 关键断言
```ts
// M43.1 [[ ]]：模式/正则/逻辑组合
expect((await run('[[ hello == h* ]]; echo $?', newCtx())).out).toBe('0');
expect((await run('[[ abc123 =~ ^[a-z]+[0-9]+$ ]]; echo $?', newCtx())).out).toBe('0');
expect((await run('[[ a == a && b == b ]]; echo $?', newCtx())).out).toBe('0');
// M43.2 权限位：./script.sh 消费 x 位（126）、chmod 符号模式、-x 算符
expect((await run('./s.sh', ctx)).code).toBe(126);            // 无 x 位
await run('chmod u+x s.sh', ctx);
expect((await run('./s.sh', ctx)).code).toBe(0);
expect((await run('test -x s.sh; echo $?', ctx)).out).toBe('0');
// M43.3 trap：INT 最外层恰好一次、EXIT 最外层脚本边界、不递归
await run("trap 'echo caught' INT", ctx);
ctx.intr!.flag = true;
expect((await run('echo hi', ctx)).out).toBe('caught');       // 130 + handler 一次
await run("trap 'echo bye' EXIT", ctx);
expect((await run('./s.sh', ctx)).out).toBe('work\nbye');     // trap 输出排脚本后，码不变
expect((await run('source s.sh', ctx)).out).toBe('work');     // source 不触发 EXIT
// 信号归一 + 错误码
expect((await run("trap 'echo y' 2; trap", ctx)).out).toContain("trap -- 'echo y' INT");
expect((await run("trap 'echo x' KILL", newCtx())).code).toBe(1);
expect((await run('trap INT', newCtx())).code).toBe(2);
```

### 实现要点
- **`[[ ]]`**：`isCondStart`/`condSpanEnd` 跨度识别（独立成词判定），分句/分管/分连接符整体跳过内部文本；`evalCond` 支持 `==` 通配、`=~` 正则（非法码 2）、`&&`/`||`/`!` 组合；runPipeline 拦截独立求值。
- **权限位**：`applySymbolicMode` 纯函数（`[ugoa][+-=][rwx]` 逗号多子句、省略 who=a）；`./script.sh` 执行路径 `permits` 查 x 位（码 126）；`test`/`[[` 同补 `-r/-w/-x`。
- **trap**：`ShellCtx` 扩 `traps`/`runDepth{n}`/`exitFiring`；INT 在最外层 run 边界触发（暂清 flag 让 handler 跑完再恢复置位）；EXIT 在 `sourceDepth===1` 脚本边界触发（`source` 走 fn 分支天然豁免）、`exitFiring` 防 handler 内脚本递归。子 shell（`$(…)`/后台）不继承 traps。顺手补 `true`/`false` 内建。

### 执行结果
```
npx vitest run → Test Files 26 passed (26) · Tests 713 passed (713)（shell.test.ts 250 例）
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 624ms
```

### 备注
- 排障一处：`echo work; false` 脚本体曾返回 127——`true`/`false` 从未注册为命令，此前测试仅凭 127 非零侥幸通过；M43.3 精确断言退出码 1 暴露，补注册。
- `trap '' SIG` 按 MVP 语义等同重置（bash 是「忽略信号」），差异记录在案。

## 2026-07-22 · M42「待真机验证项清账」（锁屏/首秀/移动外壳全链路）

### 定向过程
清 DEVPLAN-UIUX 全部「待真机验证」余项。Chrome DevTools MCP `emulate` 仿真 iPhone 14 Pro（`viewport: "393x852x3,mobile,touch"`），PointerEvent 序列模拟触控手势逐项实测。

### 验证清单与结果
| 项 | 方法 | 结果 |
|---|---|---|
| 锁屏/关机黑屏（M42.1） | `session.lock()` / `session.shutdown()` + 截图 | 锁屏壁纸+大时钟+用户胶囊 ✅；关机纯黑+暗 logo+「已关机」✅；任意键重启 ✅ |
| 首秀引导三页（M42.2） | 动态 import `openOnboarding()` 逐页截图 | 页1 Logo+三卡片 / 页2 Bot+三横条 / 页3 快捷键表 kbd 右对齐 ✅ |
| 上滑解锁（M42.3①） | pointerdown(700) → 5×pointermove → pointerup(300) | rubber band 跟手 + 阈值判定 + 240ms 飞出 → `unlocked` ✅ |
| MobileHome（M42.3②） | 解锁后截图 | 17 图标 4 列网格 + 4 图标 Dock 托盘 + 运行小圆点 + 状态栏/灵动岛 ✅ |
| 窗口红绿灯（M42.3③） | 开文件 App 量三灯尺寸 | 实测 20×20px（M5.8 触控热区设计）✅ |
| Home Indicator 单击（M42.3④） | 派发 pointerup → 等双击判定窗 | `files:min=true` 全部最小化回主屏 ✅ |
| 控制中心（M42.3⑤） | 点状态栏右侧「打开控制中心」 | 四 toggle + 音量/缩放滑块 + 七主色 swatch ✅ |
| 双击 Indicator→Exposé（M42.3⑥） | 120ms 间隔双 pointerup | `expose.open=true`，窗口卡片+「任务视图」提示 ✅ |

### 查获问题与修复
**Welcome App 移动端误导文案**：「窗口手感：拖标题栏移动 · 拖任意边/角缩放…」与 `kbd Ctrl/⌘K` 在移动端全是无效引导（移动端禁拖拽缩放、无物理键盘）。修复 [Welcome.svelte](file:///Users/wangzhenyu/Desktop/ALLProject/QieZiOS/src/apps/Welcome.svelte#L43-L58)：`viewport.isMobile` 分支——Spotlight 提示去 kbd 化，底部文案换成移动手势说明。真机复测 `hasMobileHint=true / hasDesktopHint=false / hasKbd=false` ✅。

### 教训
- `dispatchEvent(new PointerEvent(...))` 不会自动合成 `click`——监听 `click` 的按钮要直接 `.click()`，监听 `pointerup` 的（Home Indicator/锁屏）才派发 PointerEvent。
- aria-label 选择器注意子串误匹配：`[aria-label*="任务视图"]` 会命中 Home Indicator 自身的 label「回主屏（双击打开任务视图）」；断言浮层状态优先读 store（`expose.open`）而非 DOM。

### 执行结果
```
npx vitest run → Test Files 26 passed (26) · Tests 652 passed (652)
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 626ms
```

### 备注
DEVPLAN-UIUX「待真机验证」项至此**全部清账完毕**：M1 玻璃折射（默认关闭实验项）、M2 Genie/波形（M41 ✅）、弹簧手感（M41 沿用 ✅）、M3 锁屏/关机（M42.1 ✅）、M4 首秀（M42.2 ✅）、M5 移动外壳（M42.3 ✅）。

## 2026-07-22 · M41「动效真机调校」（Genie 刷新边界修复 + Dock 波形验证）

### 定向过程
清 DEVPLAN-UIUX「待真机验证」的 M2 动效三项。真机帧采样（Chrome DevTools MCP，55ms×9 帧）验证 Genie 神灯与 Dock 高斯放大。

排查插曲：首轮采样抓不到 clip-path——并非动画不跑，而是 ①`minimize()` 签名是字符串 id 非数字 pid；②排查中途 Vite 触发整页重载回到登录屏（Desktop 未挂载，DOM 无窗口/Dock）；③`dockIconPos` 读到空表是动态 import 拿到新模块实例。重新登录后全链路就绪（17 个 Dock 坐标注册齐全）。

### 查获 bug 与修复
**刷新后首次还原播空动画**：Genie 进度 `genieT` 是组件本地状态恒 0 起步，但 `minimized` 经会话还原持久为 true——`startGenie(false)` 时 from=0/to=0，500ms 全程全矩形（应 1→0 放出）。修复 [Window.svelte](file:///Users/wangzhenyu/Desktop/ALLProject/QieZiOS/src/shell/Window.svelte#L57-L59)：

```svelte
// 初始进度跟随挂载时的最小化态：会话还原带 minimized=true 的窗口，genieT 必须起步于 1
// （概念上已吸到底）——否则首次还原 from=0/to=0 播 500ms 全矩形空动画（M41 真机查获）。
let genieT = proc.minimized ? 1 : 0;
```

### 真机验证数据
- **吸入（minimize）**：`polygon(0% 0%,100% 0%,100% 100%,0% 100%)` → `polygon(14.17% 0%,41.43% 0%,31.04% 100%,21.48% 100%)`，顶边慢收/底角 t^0.6 快捏成漏斗，500ms 末帧清 clip 交还 CSS ✅
- **放出（restore，修复后重载实测）**：窄塞子 `polygon(16.68% 0%,31.02% 0%,23.93% 100%,23.69% 100%)` 逐帧展开 → `polygon(0% 0%,100% 0%,100% 100%,0% 100%)` ✅
- **Dock 波形**：中心 1.5×、±1 图标 1.194×（d=73px 平衡后）、±2 1.011×、±3 ≈1，左右对称；等效距离反推 56px 与 `magnify(σ=57.6, amp=0.5)` 自洽（scaleFor 读取在 margin 推开前 → 负反馈平衡不抖）。参数符合 macOS 手感，无需调校 ✅

### 执行结果
```
npx vitest run → Test Files 26 passed (26) · Tests 652 passed (652)
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 649ms
```

### 备注
- 教训：排查「动画没跑」先排三件事——调用签名对不对、页面是否被整页重载、动态 import 是否拿到另一个模块实例。
- 待真机项清账：M2 Genie/波形 ✅；弹簧回弹手感（springEasing 320/26）属主观项已在横幅/窗口沿用；M1 玻璃折射仍为默认关闭实验项。

## 2026-07-22 · M40「浮层前景语义审计」（亮/暗双模式全浮层巡查）

### 定向过程
M39 确立语义规则后做全系统审计：「壁纸叠加层」（TopBar）前景恒定白；「主题表面」（窗口/面板/菜单/toast）前景走 token。逐一截图验证 TopBar（浅/深壁纸）、Launchpad、Spotlight、上下文菜单、Exposé、控制中心、通知中心、通知 toast 在亮/暗双模式下的可读性。

排查插曲：后台作业 `echo x &` 触发通知后，`evaluate_script` 查 DOM 发现 toast 容器无子元素、`notifications.items` 为空，疑似 toast 不渲染。沿 pushNote → notifyd → dnd 全链路排查无异常后定位真相：**默认 4500ms 超时先于检查到期**，toast 已自动消失——非 bug。改注入 `timeout: 60000` 测试通知实测验证。

### 审计结果（零代码修复）
| 浮层 | 归类 | 亮模式 | 暗模式 |
| --- | --- | --- | --- |
| TopBar | 壁纸叠加层 | ✅ 白字+阴影（M39 修复） | ✅ |
| 控制中心/通知中心面板 | 主题表面 | ✅ token 深字（M39 重置） | ✅ token 浅字 |
| 通知 toast | 主题表面 | ✅ 深字 + 等级色左边条 | ✅ 浅字 + 等级色左边条 |
| Launchpad / Spotlight / 上下文菜单 / Exposé | 主题表面（含遮罩） | ✅ | ✅ |

### 执行结果
```
npx vitest run → Test Files 26 passed (26) · Tests 652 passed (652)
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 621ms（index 468.31kB gzip 156.02kB）
真机截图（亮/暗 × 浅/深壁纸矩阵）→ 全浮层可读 ✅
```

### 备注
- 教训：排查「toast 不出现」类问题先排除自动消失超时，再怀疑渲染链路。
- 审计后清理注入的测试通知与历史、还原亮模式设置，环境无污染。
- 规则二次确认记录在案，后续新增浮层按「壁纸叠加层 / 主题表面」二分归类即可。

## 2026-07-22 · M39「顶栏亮色可读性修复」（壁纸叠加层前景语义）

### 定向过程
真机巡查发现：亮模式 + 深色壁纸（aurora）下顶栏文字/图标全灭。根因——M9.3 把顶栏改为透明融入壁纸（去磨砂/去分隔线只留微暗渐变）后，前景色仍继承主题 `--color-qz-text`，亮模式下该 token 为深色，压在深色壁纸上不可读。设计定位：顶栏是「壁纸叠加层」而非主题表面（macOS Tahoe 同款——菜单栏前景恒定白色系，与明暗模式无关）；而下拉面板（通知中心/控制中心）有自己的 qz-glass 底板，属主题表面，前景必须重置回主题语义，否则亮模式下白字玻璃。

### 改动概要
- **M39.1 TopBar 前景强制白色系**：容器加 `text-white/90`（对齐原本就硬编码 `text-white/85` 的时钟语义），chips/托盘/菜单按钮全部继承，无需逐元素改；顶部微暗渐变 + `text-shadow: 0 1px 3px rgb(0 0 0 / 0.5)` 保留，浅色壁纸同样可读。
- **M39.2 下拉面板前景重置**：通知中心面板（TopBar 内）与控制中心面板（QuickSettings）根节点加 `text-qz-text` + `style="text-shadow: none;"`——面板有玻璃底板属主题表面，前景/阴影重置回主题语义。

### 关键代码
```svelte
<!-- TopBar 容器：壁纸叠加层 → 前景恒定白色系（不随主题亮色变深） -->
<div class="absolute inset-x-0 top-0 z-[9998] flex h-8 items-center gap-2 px-3 text-white/90"
  style="background: linear-gradient(rgb(0 0 0 / 0.18), rgb(0 0 0 / 0)); text-shadow: 0 1px 3px rgb(0 0 0 / 0.5);">

<!-- 下拉面板：有玻璃底板 → 前景/阴影重置回主题语义 -->
<div class="… text-qz-text qz-glass qz-glass-float" style="text-shadow: none;">
```

### 执行结果
```
npx vitest run → Test Files 26 passed (26) · Tests 652 passed (652)
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 664ms（index 468.31kB gzip 156.02kB）
真机截图（亮模式 + aurora 深色壁纸）→ 顶栏 🍆/App 名/窗口 chips/托盘图标/时钟全部可读 ✅
```

### 备注
- 修复刻意只落在两处根节点：顶栏容器（一次强制，子元素全继承）+ 面板根（一次重置）。不逐元素加类，避免后续新增顶栏元素再踩同一坑。
- 排查过程中 svelte-check 曾报 arith.ts/histexpand.ts 类型问题（M27/M28 文件），本轮复查已 0 错（此前会话已修），无需再动。
- 语义规则记录在案：「壁纸叠加层」（顶栏）前景恒定白；「主题表面」（窗口/面板/菜单）前景走 token——后续新增浮层时按此归类。

## 2026-07-22 · M38「命令参数路径名展开（glob）+ 字符类 + man/help 同步」

### 定向过程
真实 shell 的最后一块展开拼图：`ls *.txt` 这类命令参数的路径名展开（pathname expansion）。设计对标 bash——展开顺序：花括号 → 波浪号 → 变量/命令/算术 → **路径名展开**（新增挂在 expandToks 尾部，此时词内 ESC 哨兵未剥，globToRe 正好识别 `\*` 为字面）；无匹配放原词（nullglob off）；`case` 的词与模式不做路径名展开（模式本身就是 pattern）。for 词表从「cwd 单段匹配」升级为与命令参数共用同一个路径感知实现。

### 改动概要
- **M38.1 globToRe/hasGlob 字符类**：`[abc]`、`[a-z]`、`[!a]`/`[^a]` 取反、`]` 紧跟开头算字面成员、未闭合/空类按字面（bash 同款）；hasGlob 补 `[` 判定（ESC 转义不算）。case 模式与 `find -name` 共用 globToRe 同步获益。
- **M38.2 globExpand + 接线**：按 `/` 切段逐层下钻 VFS——无通配段按名字面查找（任一层缺失 → 整体无匹配），通配段匹配该层 children；bash 隐藏文件规则（段首显式 `.` 才匹配 `.` 开头）；绝对模式从根起结果带 `/` 前缀、相对模式保持相对形态；尾随 `/` 只匹配目录；命中字典序排序。`expandToks(toks, ctx, glob=true)` 新增参数：runPipeline/别名走展开，case 传 false。`expandWords` 复用同一实现（`for f in sub/*.txt` 成立）。
- **M38.3 man 同步 + 旧测试修正**：man.ts 补 until/break/continue/case/return 五条目，for/find 描述补 `[a-z]`。两处旧测试（for 词表字面 `*` 后 `echo $f`）改为 `echo "$f"`——M38 起变量展开结果会再 glob（bash 同款顺序），原断言编码的是无 glob 时代语义。

### 关键代码
```ts
// globExpand：段级下钻（通配段匹配 children，字面段按名查找）
if (hasGlob(seg)) {
  const re = globToRe(seg);
  const dotOk = seg.startsWith('.'); // bash：段首显式 . 才匹配隐藏文件
  for (const { id, path } of cur) {
    if (getNode(id)?.type !== 'dir') continue;
    for (const n of children(id)) {
      if (!dotOk && n.name.startsWith('.')) continue;
      if (re.test(n.name)) next.push({ id: n.id, path: `${path}/${n.name}` });
    }
  }
}
// expandToks 尾部：无引号词含通配 → 展开；无匹配放原词
if (glob && t.q === null && hasGlob(text)) {
  const hits = globExpand(text, ctx);
  if (hits) { out.push(...hits); continue; }
}
// case 不做路径名展开（bash 语义）
const pExp = (await expandToks(tokenize(pat), ctx, false)).join(' ');
```

### 执行结果
```
npx vitest run src/lib/shell.test.ts → 189 passed (189)（M38 +17 例，含 2 例旧语义修正）
npx vitest run → Test Files 26 passed (26) · Tests 652 passed (652)（+17）
npx svelte-check --threshold error → 0 errors（5 条存量警告）
npm run build → ✓ built in 627ms（index 468.22kB gzip 155.95kB）
```

### 备注
- 测试覆盖：`*`/`?` 基本展开与字典序、无匹配原样保留、字符类 `[ab]`/`[a-c]`/`[!a]`/`[^a]`、未闭合 `[` 字面、隐藏文件规则（`*` 不匹配 `.` 开头、`.*` 匹配）、路径段 glob（`sub/*.txt`、`*/*.txt`）、绝对路径、字面段缺失整模式保留、尾随 `/` 只匹配目录、引号/转义不展开、变量展开后再 glob（`$P*.txt`）、for 词表路径 glob、`cat *.md` 真实消费、case 模式字符类。每个用例独立目录隔离（VFS 全局共享）。
- 回归处置：初版把 case 模式也 glob 了（`*` 兜底被展开成根目录文件清单），加 `glob` 参数旁路；两例旧测试按 bash 真实语义修正。
- 已知取舍：`.`/`..` 段不特殊解析（原样保留）；虚拟挂载 `/proc` `/dev` 不参与展开；重定向目标多命中无 ambiguous redirect 报错；变量展开产出的 `>` 仍会被当重定向（沿用旧取舍）。

## 2026-07-22 · M37「Shell 循环控制 break/continue [n] + until 循环」

### 定向过程
POSIX 控制流补最后一块拼图：bash 的 `break`/`continue [n]` 与 `until`。设计沿用 retFlag 信号模式——`loopCtlCmd` 内置命令只负责置 `ctx.loopCtl` 信号，循环迭代边界（for/while/until）消费：n=1 本层生效并清除，n>1 递减后 `return` 向上传，外层边界再消费（`break 2` 断两层）。`loopDepth` 跟踪活跃循环嵌套层数，供 break/continue 合法性判定。until 不立新节点，复用 while 节点 + `until: true` 标志，执行层翻转条件判定。

### 改动概要
- **M37.1 ShellCtx + loopCtlCmd**：`loopDepth`/`loopCtl` 两字段；`newCtx`/`execCmdSubst`(`$(…)` 子 shell）/`backgroundRun`（后台作业）均从 0 起不继承外层循环（bash：替换内 break 只警告不断外层）。`loopCtlCmd` 共用实现：参数非正整数 → 报错码 1 不置信号；循环外 → 警告非致命码 0（bash 同款）；合法 → 置信号。
- **M37.2 解析器 until**：`parseWhile` 首词识别 `until` → 同 while 节点带 `until: true`；parseSeq 分发 `while|until`；`CTRL_KW` 补 `until`。`needsContinuation` 零改动即支持（缺 done 抛「缺少 done」→ 续行）。
- **M37.3 执行器接线**：`consumeLoopCtl` 辅助（n=1 消费 / n>1 递减 propagate）；for/while 循环 `loopDepth++`（finally 递减）+ 迭代边界消费信号；`execNodes` 语句边界追加 `ctx.loopCtl` 检查（`break; echo x` 的 echo 不再执行，bash 语义）；until 翻转条件 `condOk = until ? lastCode !== 0 : lastCode === 0`。函数调用共享 ctx → 函数内 break 断调用处循环（bash 动态作用域）自然成立。

### 关键代码
```ts
// loopCtlCmd：置信号，循环边界消费
if ((ctx.loopDepth ?? 0) === 0)
  return { out: '', err: `qzsh: ${op}: 只有在循环中才有意义`, code: 0 };
ctx.loopCtl = { op, n };

// consumeLoopCtl：迭代边界消费
const ctl = ctx.loopCtl;
if (ctl.n === 1) { ctx.loopCtl = null; return ctl.op; }
ctx.loopCtl = { op: ctl.op, n: ctl.n - 1 };
return 'propagate'; // 调用方 return，外层边界继续消费

// until 条件取反
const condOk = n.until ? lastCode !== 0 : lastCode === 0;
if (!condOk) break;
```

### 执行结果
```
npx vitest run src/lib/shell.test.ts → 172 passed (172)（M37 +15 例）
npx vitest run → Test Files 26 passed (26) · Tests 635 passed (635)（+14，另一例为既有计数修正）
npx svelte-check --threshold error → 0 errors（5 条存量警告）
npm run build → ✓ built in 667ms（index 466.25kB gzip 155.07kB）
```

### 备注
- 实现接续上次会话半成品：Ctx 字段/命令表已就绪，本次完成解析器（until 识别）与执行器（loopDepth 跟踪 + 信号消费）接线，一次全绿。
- 测试覆盖：for/while break、continue 跳过剩余语句、break 2/continue 2 跨层、循环外警告码 0、非正整数参数码 1、函数内 break（动态作用域）、until 基本/零迭代/单行/体内 break、until 未闭合续行判定、break 与 Ctrl+C 互不干扰。
- 已知取舍：`break | cat` 管道段内 break 会影响本层循环（无管道子 shell 隔离，bash 行为更复杂），极罕见场景记录在案。

## 2026-07-21 · M36「Terminal PS2 多行续行」

### 定向过程
M35 已交付 `needsContinuation` 纯判定，本里程碑把它接到 Terminal：bash 手感是输入不完整（`if true` 回车）不报错、提示符变 `>` 继续读，完整那一刻一次性执行。累积逻辑抽成纯模块 lib/ps2.ts（TDD 友好），Terminal 只负责提示符切换与取消语义。

### 改动概要
- **M36.1 ps2.ts +9 例**：`ps2Push` 逐行累积、`needsContinuation` 判完整、完整即拼接返回并清空缓冲（累积器可复用）；`ps2Cancel` 丢弃；`ps2Active` 驱动提示符。覆盖：单行即完整 / if / heredoc / 引号 / 行尾反斜杠 / 尾部 `|` / 复用 / cancel / 孤立 then 不续行交 run 报错。
- **M36.2 Terminal 接线**：submit 入行回显按 `ps2Active` 选 PS1/`>`；未 done 仅累积不执行；完整文本走既有 histExpand → addHistory → run 流（多行命令单条入库，bash cmdhist 同款）。`cancelLine` 清 PS2 缓冲；`eofExit` 续行中转「意外结束（EOF）」语法错不关窗；模板输入行提示符同步切换。

### 关键代码
```ts
// submit：不完整 → 累积续行不执行；完整 → 拼接文本进入正常执行流
const acc = ps2Push(ps2, line);
if (!acc.done) { scrollToEnd(); return; }
const cmd = acc.text.trim();

// ps2.ts：完整性判定复用 M35 needsContinuation
const text = acc.buf.join('\n');
if (needsContinuation(text)) return { done: false, text };
acc.buf.length = 0;
return { done: true, text };
```

### 执行结果
```
npx vitest run src/lib/ps2.test.ts → 9 passed (9)
npx vitest run → Test Files 26 passed (26) · Tests 621 passed (621)（+9）
npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 755ms
```

### 备注
- 红测时一例失败是用例本身写错（`if true\nfi` 缺 `then` 本就不完整 → 续行为正确行为），修正用例非实现。
- 已知取舍：多行命令的历史展开对拼接整文本执行（heredoc body 内含 `!str` 会被当历史展开），与 bash 逐读行展开有差异，记录在案。
- ⏳ PS2 交互手感（提示符切换、Ctrl+C/Ctrl+D 取消）无法无头验证，待真机目检。

## 2026-07-21 · M35「here-document / here-string + needsContinuation 续行判定」

### 定向过程
Shell 贴近真实系统的又一块地基：`cat <<EOF` 多行输入是脚本高频形态，且 Terminal 的 PS2 续行（输入 `if true` 回车后提示 `>` 继续）依赖一个可靠的「输入是否完整」判定。难点在 heredoc body 必须逐字保留——body 里的 `;`、换行、引号、`#` 都不参与分句/引号扫描/注释处理，因此放在分句前的独立预处理层（scanHeredocs），用 `\x02N` 哨兵原位替换（区别于 M31 转义哨兵 `\x01`，stripEsc 不误剥）。

### 改动概要
- **M35.1 红测 35 例**：here-doc 19 + here-string 5 + needsContinuation 11。
- **M35.2 实现**：scanHeredocs（引号/转义/`$( )` 跨度尊重、同头行多 heredoc 按 pending 队列顺序吞 body、`<<-` 剥前导 tab、未闭合抛「缺少闭合行（DELIM）」）；splitStatements 返回 `{ stmts, heredocs }`；run 挂 `ctx.heredocs`（嵌套 run 保存/恢复）；extractRedirs 认 `<<<` 与哨兵 `<<`；runPipeline 输入优先级 heredoc > here-string > `<` 文件 > 管道 stdin；导出 needsContinuation 五段判定（奇数反斜杠结尾 / heredoc 未闭合 / 引号与替换未配对 / 尾部 `|` `&&` `||` / 控制结构缺 fi done esac }）。
- **M35.3 修复 18 例 + 回归**：①runLeaf 收集语句输出统一剥尾随换行——echo 惯例本无尾换行，heredoc/here-string/文件内容的结构性尾换行只活在 stdin 层（`wc -l` 需要），不透到语句显示输出；②heredoc stdin 注入处出口补 stripEsc（`\$` 转义字面美元符的 `\x01` 哨兵残留修复）。

### 关键代码
```ts
// runPipeline：heredoc body 未引号分隔符 → \$ \` \\ 转哨兵过 subst，出口剥哨兵；引号分隔符 → 字面
stageStdin = hd ? (hd.expand ? stripEsc(await subst(hd.body.replace(/\\([$`\\])/g, ESC + '$1'), ctx)) : hd.body) : '';

// runLeaf：语句输出统一无尾随换行（stdin 层结构换行不透到显示层）
const out = res.out.replace(/\n+$/, '');
if (out) collect(outs, out);

// needsContinuation：heredoc 未闭合 → 续行（PS2 地基）
try { stripped = scanHeredocs(text).text; }
catch (e) { return e instanceof Error && e.message.includes('缺少'); }
```

### 执行结果
```
npx vitest run src/lib/shell.test.ts
 Test Files  1 passed (1) · Tests  158 passed (158)

npx vitest run
 Test Files  25 passed (25) · Tests  612 passed (612)（+35）

npx svelte-check --tsconfig ./tsconfig.json → 0 errors（5 条存量警告）
npm run build → ✓ built in 654ms（index 464.26kB gzip 154.38kB）
```

### 备注
- 输入重定向优先级取「算符类型固定优先级」（heredoc > here-string > 文件 > 管道），与 bash「同行后出现覆盖先出现」语义有差异，记录在案。
- here-string 自动补尾随换行（bash 同款），`wc -l <<< x` 计 1；但语句最终输出按 shell 惯例剥尾换行，`cat <<< x` 显示无尾换行。
- 遗留：Terminal 尚未接 needsContinuation（PS2 多行续行输入）——属下一里程碑 M36。

## 2026-07-21 · M34「App 级自定义菜单扩展（U8 清账）」

### 定向过程
U8 原提案收尾：M12.2 已通机制（AppDef.menus → buildAppMenu 合并 → TopBar 渲染），但仅 trash/terminal/files/settings 四家声明。按「动作只接真实全局函数、不碰窗口实例状态」的约束盘点全部 App：Assistant（对话绑窗口态）、Screenshot（capture 在组件内）、Reminders（需用户输入标题）无全局动作可用，不虚构菜单；最终落地 textedit/clipboard/appstore 三家。

### 改动概要
- **M34.1 盘点**：sys 门面（openApp/notify/clipboard）、clearClipboard、fetchCatalog 可直接用；bus 无 App 监听事件可复用。
- **M34.2 registry appMenus +3**：textedit「新建文稿」（sys.openApp，同终端新建窗口语义）；clipboard「清空剪贴板历史」（clearClipboard + notify，danger 对齐清空回收站）；appstore「检查更新」（checkCatalogUpdates：onClick 同步签名包 fire-and-forget async，fetchCatalog 成功 notify 条目数、失败 notify 原因，异常内部兜住不崩菜单）。图标 FileText/Trash2/RefreshCw 复用 iconRegistry 已注册项，零新增。
- **M34.3 registry.test.ts 新建 +9 例**：首个 import registry.ts（连带 23 个 .svelte 组件）的测试——验证 node 环境 import 组件类安全（不实例化不挂载）。

### 关键代码
```ts
// appstore「检查更新」：异步体兜错转通知，onClick 保持同步签名
async function checkCatalogUpdates(): Promise<void> {
  try {
    const cat = await fetchCatalog();
    sys.notify('已是最新目录', { body: `仓库现有 ${cat.apps.length} 款 App`, level: 'success', timeout: 2000, source: 'App Store' });
  } catch (e) {
    sys.notify('检查更新失败', { body: e instanceof Error ? e.message : String(e), level: 'error', timeout: 2500, source: 'App Store' });
  }
}
appstore: [{ label: '检查更新', icon: 'RefreshCw', onClick: () => void checkCatalogUpdates() }],
```

### 新增测试核心断言
```ts
expect(appRegistry.calculator.menus).toBeUndefined(); // 未声明 → TopBar 回退窗口操作四项
appRegistry.textedit.menus![0].onClick();
expect(processes.some((p) => p.appId === 'textedit')).toBe(true); // 真实拉起进程
pushClip('第一段'); pushClip('第二段');
appRegistry.clipboard.menus![0].onClick();
expect(clipboard.items.length).toBe(0); // 真实清数据层
vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('网络不可达'))));
appRegistry.appstore.menus![0].onClick();
await vi.waitFor(() => expect(events).toHaveLength(1)); // fire-and-forget 异步结果
expect(events[0].level).toBe('error'); // 异常转通知不外抛
```

### 执行结果
```
npx vitest run
 Test Files  25 passed (25) · Tests  577 passed (577)（+9：registry M34 套件）

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 680ms（index 462.20kB gzip 153.64kB）
```

### 备注
- 已知取舍：「检查更新」语义为「拉取目录报条目数」，未做与已装 App 的版本比对（catalog 条目无版本字段）；后续 catalog 加 version 后可升级为真实更新检测。
- DEVPLAN-UIUX 两处「App 级自定义菜单未做」遗留同步勾掉。

---

## 2026-07-21 · M33「Shell case 语句 case word in 模式) 体 ;; esac」

### 定向过程
bash 控制流最后一块常用拼图：case 多路分支。word 走既有 expandToks 展开（变量/命令替换/算术全生效），模式用 globToRe 匹配（* ? 通配、ESC 转义字面保留）。TDD 跑出一个解析缺口：嵌套 case 的内层 `case` 行被外层 parseSeq 的 stopPred 误判为 arm 边界——控制结构优先级提升至 stopPred 判定之前修复。

### 改动概要
- **M33.1 SNode + parseCase**：`{ t:'case', word, arms:[{patterns, body}] }`。ARM 正则 `^\(?\s*([^()]+?)\)\s*(.*)$` 支持可选前括号与裸 `pat)` 两形态；`in` 同行余文回插解析流；体复用 `parseSeq(stopPred=isArmStart)` 递归 → 嵌套 if/for/while/case 自然生效；缺 esac 抛语法错误（码 2）。
- **M33.2 执行**：word 展开后剥哨兵；模式逐个展开 globToRe 匹配；首个命中 arm 执行体（bash `;;` 语义即退）；进入 case 即 lastCode=0，无匹配/空体退出码 0。
- **M33.3 修复嵌套误判**：parseSeq 内控制关键字（if/for/while/case）识别前移到 stopPred 判定之前。
- **M33.4 shell.test.ts +20 例**。

### 关键代码
```ts
// ARM：可选前括号 + 模式列表（| 分隔）+ ) + 体首句
const ARM = /^\(?\s*([^()]+?)\)\s*(.*)$/s;

// 执行：word 展开剥哨兵，模式逐个 globToRe 匹配，命中即执行并退出
const word = stripEsc((await expandToks(tokenize(n.word), ctx)).join(' '));
for (const arm of n.arms) {
  let hit = false;
  for (const pat of arm.patterns) {
    const pExp = (await expandToks(tokenize(pat), ctx)).join(' ');
    if (globToRe(pExp).test(word)) { hit = true; break; }
  }
  if (hit) { await execNodes(arm.body); return; }
}
```

### 新增测试核心断言
```ts
expect((await run('case b in a) echo A ;; b) echo B ;; esac', newCtx())).out).toBe('B');
expect((await run('case b in a|b|c) echo hit ;; esac', newCtx())).out).toBe('hit');
expect((await run('case foo.txt in *.txt) echo text ;; esac', newCtx())).out).toBe('text');
expect((await run('case a in a) case b in b) echo nested ;; esac ;; esac', newCtx())).out).toBe('nested');
expect((await run('case x in a) echo A ;; esac; echo $?', newCtx())).out).toBe('0'); // 无匹配码 0
```

### 执行结果
```
npx vitest run
 Test Files  24 passed (24) · Tests  568 passed (568)（+20：shell M33 套件）

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 604ms（index 461.57kB gzip 153.42kB）
```

### 备注
- 已知取舍：模式列表暂不支持 `;;&`/`;&` fall-through（bash 4+ 语义），`;;` 是唯一终止符；`esac` 前允许省略最后一个 `;;`（与 bash 一致）。

---

## 2026-07-21 · M32「Shell 函数定义 name() { … } + 位置参数 $1/$@/$#」

### 定向过程
bash 脚本化能力核心拼图：函数定义/调用、位置参数、return。ShellCtx 扩四字段（funcs/positional/funcDepth/retFlag）承载函数态。TDD 跑出两个计划外缺口，按 bash 语义一并补齐：① 递归测试里 `$(( $1 - 1 ))` 抛「变量名无效」——evalArith 的 `$` 分支只接字母开头标识符，补数字参数与 `$#`；② 函数内 `X=5` 裸赋值被当命令 127——runPipeline 新增纯赋值语句（整行全是 `VAR=value` 则落 ctx.env，此前只有 export 能设值）。另修复测试文件一处多余 `)` 的语法错误。

### 改动概要
- **M32.1 ShellCtx + parseFuncdef**：funcs 函数表（fork 拷贝：子 shell 定义不回流父 shell）、positional 位置参数、funcDepth 嵌套深度、retFlag return 信号。FUNC_HEAD 支持 `name() {` 与 `name () {`；多行体逐行收集至 `}`，尾部余文回插语句流；未闭合/孤立 `}` 报语法错误（码 2）。
- **M32.2 函数调用 + return**：别名展开后、内建命令前查函数表（函数可覆盖内建）；共享 ctx；位置参数保存/恢复。return：无参沿用 ctx.code、`& 0xff` 截断（-1→255）、非函数/脚本环境报错码 1；retFlag 在函数/脚本边界清除并作为该边界退出码；循环/for/while 体内逐边界检查上抛。
- **M32.3 位置参数 + 脚本参数**：subst 支持 `$1..$9`（单数字，`$10`=`${1}0`）、`$#`、`$@`/`$*` 空格 join、`$0`=qzsh；sh/source 带参数执行脚本。
- **M32.4 arith 位置参数 + 纯赋值语句**：evalArith 增第三参 positional（`$1..$9`/`$#`）；runPipeline 纯赋值语句 `X=5`（多词全赋值连设；重定向仍生效）。
- **M32.5 shell.test.ts +18 例**。

### 关键代码
```ts
// 函数调用：别名后内建前，共享 ctx，位置参数保存/恢复，return 信号边界清除
const funcBody = ctx.funcs?.[cmd];
const fn = funcBody === undefined ? COMMANDS[cmd] : undefined;
// …
const savedPos = ctx.positional;
ctx.positional = args;
ctx.funcDepth = (ctx.funcDepth ?? 0) + 1;
try {
  res = await run(funcBody, ctx);
  if (ctx.retFlag) { res = { ...res, code: ctx.retFlag.code }; ctx.retFlag = null; }
} finally { ctx.funcDepth!--; ctx.positional = savedPos; }

// arith $ 分支：位置参数 $1..$9（$10 = ${1}0 拼接）与 $#
const d = /^\d+/.exec(s.slice(i));
if (d) {
  i += d[0].length;
  const raw = (positional[Number(d[0][0]) - 1] ?? '') + d[0].slice(1);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// 纯赋值语句：整行全是 VAR=value → 落 ctx.env
const assigns = [cmd, ...args].map((w) => /^([A-Za-z_]\w*)=(.*)$/s.exec(w));
const isAssign = assigns.every((m) => m !== null);
```

### 新增测试核心断言
```ts
expect((await run('f() { echo $1 $2 $9; }; f a b c d e f g h i j', newCtx())).out).toBe('a b i');
expect((await run('f() { echo $10; }; f x y', newCtx())).out).toBe('x0'); // bash 单数字
expect((await run('f() { return -1; }; f; echo $?', newCtx())).out).toBe('255');
expect((await run('f() { X=5; }; X=1; f; echo $X', newCtx())).out).toBe('5'); // 共享作用域
// 递归 + 算术 + 条件：
expect((await run('cd() { echo $1; if test $1 -gt 1; then cd $(( $1 - 1 )); fi; }; cd 3', newCtx())).out).toBe('3\n2\n1');
expect((await run('ls() { echo fake; }; ls', newCtx())).out).toBe('fake'); // 覆盖内建
```

### 执行结果
```
npx vitest run
 Test Files  24 passed (24) · Tests  548 passed (548)（+18：shell M32 套件）

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 596ms（index 460.56kB gzip 153.08kB）
```

### 备注
- 已知差异：无 word splitting——`"$@"` 与 `$@` 都 join 成一词（与既有变量展开取舍一致）；函数内无 `local`，赋值全部共享（bash 默认如此，`local` 语义暂未实现）。
- 函数定义是「存文本、调用时重新 parse」——与 bash 定义时不展开不执行语义一致；递归深度靠 JS 栈 + MAX_LOOP 兜底。

---

## 2026-07-21 · M31「Shell 反斜杠转义体系」

### 定向过程
bash 词法最后一块地基：`\$` `\*` `\ ` `\"` 等转义序列此前会触发错误的展开/分词/重定向语义。设计 ESC 哨兵（`\u0001`）方案：tokenize 把 `\X` 转成 ESC+X，下游所有扫描器（花括号/波浪号/变量/命令替换/glob/分句/分管/连接符/后台判定）遇 ESC 整对跳过不作语义，出口统一剥掉。冒烟验证时发现 ESC 泄漏进输出——runPipeline 忘了在 extractRedirs 后剥哨兵（设计注释写了、实现漏了），一并修复。

### 改动概要
- **M31.1 wordexpand.ts**：导出 `ESC` 常量（避免 shell↔wordexpand 循环依赖）；matchBrace/splitTop 遇 ESC 整对跳过，转义的 `{` `}` `,` 不参与花括号展开。
- **M31.2 tokenize 重写**：裸词 `\X` → ESC+X 字面（`\<换行>` 续行拼接、行尾孤立 `\` 保留）；双引号内仅 `\$` `` \` `` `\"` `\\` 转义（bash 弱引用），`\d` 等其余反斜杠字面保留；单引号内一切字面。subst 遇 ESC 对原样通过。
- **M31.3 全链路转义感知**：splitTopLevel/splitConnectors/splitStatements 跳过 `\;` `\|`；run 末尾后台判定排除奇数反斜杠前缀（`\&` 字面 &）；globToRe/hasGlob 遇 ESC 对当字面。
- **M31.4 修复 ESC 泄漏**：runPipeline 在 extractRedirs 之后统一 stripEsc（rest + redir.in/out/err + 别名展开结果）。剥哨兵必须晚于重定向抽取，否则 `\>` 会被算符表吃掉。
- **M31.5 shell.test.ts +17 例**。

### 关键代码
```ts
// tokenize 裸词分支：\X → ESC+X 字面（X 不再参与展开/glob/分词/引号判定）
if (c === '\\') {
  const n = line[i + 1];
  if (n === '\n') { i++; continue; }        // \<换行> 续行
  if (n === undefined) { cur += c; inTok = true; continue; } // 行尾孤立 \ 字面
  cur += ESC + n; inTok = true; i++; continue;
}

// runPipeline：抽完重定向后统一剥哨兵（此前必须保留，否则 \> 被算符表吃掉）
const { rest, redir, error } = extractRedirs(toks);
const stripped = rest.map(stripEsc);
if (redir.in) redir.in = stripEsc(redir.in);
if (redir.out) redir.out = stripEsc(redir.out);
if (redir.err) redir.err = stripEsc(redir.err);
```

### 新增测试核心断言
```ts
expect((await run('echo \\$USER', newCtx())).out).toBe('$USER');
expect((await run('echo hi \\> x', ctx)).out).toBe('hi > x'); // 不重定向不落盘
expect((await run('echo a\\;b', newCtx())).out).toBe('a;b'); // 不分句
expect((await run('for f in \\*; do echo $f; done', newCtx())).out).toBe('*'); // 不 glob
expect((await run('echo "a\\$USER \\d \\\\"', newCtx())).out).toBe('a$USER \\d \\'); // 弱引用
expect((await run("echo '\\$USER'", newCtx())).out).toBe('\\$USER'); // 强引用
expect((await run('echo \\$(echo hi)', newCtx())).out).toBe('$(echo hi)'); // 不执行替换
```

### 执行结果
```
npx vitest run
 Test Files  24 passed (24) · Tests  530 passed (530)（+17：shell M31 套件）

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 598ms（index 458.44kB gzip 152.33kB）
```

### 备注
- 冒烟驱动修复：正式写测试前先跑了 10 例临时冒烟，当场抓到 ESC 泄漏（`\u0001$USER`）——转义语义全对、只是出口忘剥哨兵。印证「先冒烟后成文」对词法层改动的价值。
- 已知取舍：`\if`/`\for` 等转义关键词仍会被 AST 解析当控制关键字（bash 里转义会禁用关键词识别），场景极罕见，记录在案。

---

## 2026-07-21 · M29「Shell 波浪号 ~/~user + 花括号 {a,b} 展开」

### 定向过程
bash 展开体系最后两块高频缺口：花括号（`mkdir {a,b,c}`、`cp f{,.bak}`、`{1..10}` 区间）与波浪号（`cd ~`、`~root`）。两者在 bash 展开顺序里位于变量/命令/算术展开**之前**，落成独立纯函数模块 wordexpand.ts，再由 expandToks/expandWords 统一按序调用。用户家目录此前在 passwdLine 里手写了一份规则，抽出 userHome 作为单一来源。

### 改动概要
- **M29.1 wordexpand.ts（新建）**：`braceExpand`——`{a,b}` 列表、`{1..5}`/`{a..z}` 区间（降序/步进 `{1..10..3}`/前导零补宽 `{01..05}`）、嵌套 `{a,{b,c}}` 与多组笛卡尔积；无效组（`{a}`/未闭合/混合 `{1..z}`/步进 0）字面保留；`{{a,b}}` 外层无顶层逗号跳过、命中内层（对齐 bash 递归语义）。`tildeExpand`——词首 `~`→HOME、`~name`→userHome、拼接剥 home 尾斜杠（HOME=/ 不产 `//x`）、未知用户原样保留。测试 30 例。
- **M29.2 users.svelte.ts**：新增 `userHome(name)`（root→/root、其余→/、未知→undefined）；`passwdLine` 改走它，/etc/passwd 与波浪号展开同一规则不再两处维护。
- **M29.3 shell.ts 接线**：expandToks/expandWords 内按 bash 顺序——花括号 → 波浪号 → subst → glob；引号词（t.q）跳过前两步。空词删除从 token 级改为变体级判定：花括号产出的空变体（`{,}`）是有效参数不删。for 词表同走展开。
- **M29.4 shell.test.ts +16 例**。

### 关键代码
```ts
// expandToks：bash 展开顺序——花括号 → 波浪号 → 变量/命令/算术（subst）；引号词全程跳过
for (const v0 of t.q === null ? braceExpand(t.text) : [t.text]) {
  const v = t.q === null ? tildeExpand(v0, ctx.env.HOME ?? '/', userHome) : v0;
  const text = await subst(v, ctx, t.q);
  if (text === '' && t.q === null && v0 !== '') continue; // 变体级空词删除
  out.push(text);
}

// wordexpand.ts：无效组跳过继续向右扫（{{a,b}} 命中内层，bash 递归语义）
if (rangeAlts(inner) !== null || splitTop(inner).length > 1) return { start: i, end };
```

### 新增测试核心断言
```ts
expect(braceExpand('{a,b}{1,2}')).toEqual(['a1', 'a2', 'b1', 'b2']);
expect(braceExpand('{01..05}')).toEqual(['01', '02', '03', '04', '05']); // 前导零补宽
expect(braceExpand('{{a,b}}')).toEqual(['{a}', '{b}']); // 外层无效跳内层
expect(tildeExpand('~/pics', '/', homeOf)).toBe('/pics'); // HOME=/ 无双斜杠
expect(tildeExpand('~nosuch', '/', homeOf)).toBe('~nosuch'); // 未知用户原样保留
expect((await run('echo {a,$USER}', newCtx())).out).toBe('a qiezi'); // 花括号先于变量
expect((await run('echo "{a,b}"', newCtx())).out).toBe('{a,b}'); // 引号不展开
expect((await run('cd ~/图片; pwd', newCtx())).out).toBe('/图片');
```

### 执行结果
```
npx vitest run
 Test Files  24 passed (24) · Tests  513 passed (513)（+46：wordexpand 30 + shell 16）

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 595ms（index 457.03kB gzip 151.91kB）
```

### 备注
- 已知差异（注释在案）：花括号扫描不识别 `$( … )` 跨度——`x$(echo {a,b})y` 的展开路径与 bash 不同（bash 在子 shell 内展开），本实现按词内花括号处理；场景罕见，从简。
- root 的 HOME 语义沿用既有 `/root` 字符串（VFS 无对应目录），`cd ~` 对 root 会报目录不存在——与 `cd $HOME` 既有行为一致，不在本里程碑范围。

---

## 2026-07-21 · M30「Files Quick Look 空格预览」

### 定向过程
macOS 文件管理的标志性交互：选中文件敲空格即弹出浮动预览（图片/音视频/文本/目录），再敲空格或 Esc 关闭，↑/↓ 直接切换预览对象。落成 quicklook.ts 纯函数 + QuickLook.svelte 面板组件 + Files 接线三段。

### 改动概要
- **M30.1 quicklook.ts（新建）**：`previewKind` 判别 image/media/text/dir/binary；`truncatePreview` 文本超 20000 字符截断；`stepSelection` 方向键步进夹紧。测试 25 例。
- **M30.2 QuickLook.svelte（新建）**：图片/音视频走 readBlob → objectURL（卸载 revoke 防泄漏）；文本等宽 pre 截断；目录显图标+子项数；二进制显通用图标。
- **M30.3 Files.svelte 接线**：空格开/关（输入框聚焦不抢键）；预览开着 ↑/↓ 步进选中（macOS 手感）；选中变化同步刷新。

### 执行结果
```
npx vitest run → 22 文件 467 例全绿（+25）
npx svelte-check → 0 errors / 5 warnings（存量）
npm run build → 成功
```

---

## 2026-07-21 · M28「Shell 历史词指示符与修饰符」

### 定向过程
M25 历史展开的进阶：`!$:s/foo/bar/` 改字重跑、`!!:p` 只打印演练，是 bash 历史系统里老手高频用的两件套。全部落在 histexpand.ts 纯函数扩展上，Terminal 仅需为 :p 加一条「回显不执行」分支。

### 改动概要
- **M28.1 histexpand.ts**：词指示符 `:^`（首词）/`:$`（末词）/`:*`（全部参数）/`:n`/`:n-m`；修饰符 `:s/old/new/`（首个替换）、`:gs/old/new/`（全局）、`:p`（只打印不执行）。
- **M28.2 histexpand.test.ts +29 例**：五种词指示符、三种修饰符、组合链（`!:1:s/a/b/`）、越界失败路径。
- **M28.3 Terminal 接线 :p**：展开结果带 printOnly → 回显展开行后不执行（bash :p 语义）。

### 执行结果
```
npx vitest run → 21 文件 388 例全绿（+29）
npx svelte-check → 0 errors / 5 warnings（存量）
npm run build → 成功
```

---

## 2026-07-21 · M27「Shell 算术展开 $((expr))」

### 定向过程
`for i in {1..$((N*2))}`、`echo $((x+1))`——算术展开是 shell 脚本化的基础件。落成独立 arith.ts 递归下降求值器（不进 eval/Function，安全），subst 里按 bash 同款判定集成（`$(` 紧跟 `(` 即算术，`$( (ls) )` 带空格才是子 shell）。

### 改动概要
- **M27.1 arith.ts（新建）**：十三级优先级递归下降（primary→unary→power 右结合→mul→add→shift→rel→eq→bitAnd→bitXor→bitOr→logAnd→logOr→ternary）；整除向零取整；变量裸名/`$` 前缀、未定义按 0；`&&`/`||`/`?:` 短路（`0?1/0:9`→9 不报除零）；除零/语法错误抛中文错。测试 28 例。
- **M27.2 shell.ts subst 集成**：matchParen 配对剥掉 `$((` 与 `))` 调 evalArith；双引号内可展开、单引号强引用不展开；run 顶层错误兜底——算术错误退出码 1 + err 提示。
- **M27.3 shell.test.ts +14 例**：含 `$((` 判定不吞 `$(echo hi)` 命令替换的回归锁。

### 关键代码
```ts
// subst：$( 紧跟 ( 即算术（bash 同款判定）
const end0 = n === '(' ? matchParen(tok, i + 1) : -1;
if (n === '(' && tok[i + 2] === '(' && end0 !== -1) {
  out += String(evalArith(tok.slice(i + 3, end0 - 1), ctx.env));
  i = end0; continue;
}
```

### 执行结果
```
npx vitest run → 22 文件 429 例全绿（+42：arith 28 + shell 14）
npx svelte-check → 0 errors / 5 warnings（存量）
npm run build → 成功
```

---

## 2026-07-21 · M26「Shell 命令替换 $(cmd) / `cmd`」

### 定向过程
命令替换是 bash 展开体系里含金量最高的一件：`echo $(cat f | grep x)`、`X=$(date)`。难点在执行模型——subst 从纯同步变异步（要递归 run），且 `$( )` 跨度必须贯穿 tokenize/分句/分管/分连接符四层扫描不被误切。Ctrl+C 要能断替换内的失控循环（intr 共享引用）。

### 改动概要
- **M26.1 tokenize 跨度扫描**：`matchParen` 配对括号（嵌套/引号/转义感知）、`substSpanEnd` 统一 `$(…)` 与 `` `…` `` 跨度；扫到 `$(` 或 `` ` `` 整体留在词内（内部空白不分词、引号不切换）；单引号内不生效（bash 强引用）。
- **M26.2 subst/expandToks 异步化 + execCmdSubst**：fork ctx（cd/export 不影响父 shell）、intr 共享引用、`SUBST_DEPTH_MAX=8` 防栈爆、stdout 剥尾随换行；替换结果单遍扫描不二次展开。TDD 抓出：expandWords/runPipeline/别名展开漏 await（22 例红→绿）、变量展开正则 `m[1]` 误用（应为 `m[0]`）。
- **M26.3 中断传播**：内层 run 吞 130 且 intr.flag 置位 → execCmdSubst 抛 ShellInterrupt 继续向上——Ctrl+C 断 `$(while 失控)`，bash 手感。
- **M26.4 shell.test.ts +13 例**。

### 关键代码
```ts
async function execCmdSubst(body: string, ctx: ShellCtx): Promise<string> {
  if (substDepth >= SUBST_DEPTH_MAX) return '';
  const subCtx: ShellCtx = { cwd: ctx.cwd, env: { ...ctx.env }, code: ctx.code, pid: ctx.pid, intr: ctx.intr };
  substDepth++;
  try {
    const res = await run(body, subCtx);
    if (res.code === 130 && ctx.intr?.flag) throw new ShellInterrupt(); // Ctrl+C 向上传播
    return res.out.replace(/\n+$/, ''); // bash：剥掉全部尾随换行
  } finally {
    substDepth--;
  }
}
```

### 执行结果
```
npx vitest run → 21 文件 387 例全绿（+13）
npx svelte-check → 0 errors / 5 warnings（存量）
npm run build → 成功
```

### 备注
- 取舍（注释在案）：替换结果的 stderr 丢弃（bash 直接打终端，我们架构是收集式）。

---

## 2026-07-21 · M25「Shell 历史展开（!!/!n/!str）+ readline kill ring（Ctrl+Y/Alt+Y）」

### 定向过程
真实 bash 交互键族还剩两块高频缺口：① 历史展开——`sudo !!`、`!git` 是命令行老手的肌肉记忆；② kill ring——Ctrl+U/K/W 删掉的文本在 bash 里能用 Ctrl+Y 找回、Alt+Y 回溯更早的删除。两者都先落纯函数（histexpand / lineedit 扩展）再 Terminal 接线，沿用 M16-M24 的既定套路。

### 改动概要
- **M25.1 histexpand.ts（新建）**：`histExpand(line, history)` 判别联合返回——单引号强引用不展开、双引号内可展开、`\!` 转义、词尾/空白/`=`/引号紧随的字面 `!` 不展开（`echo a!`、`a != b` 安全）；五种形态（`!!`/`!n`/`!-n`/`!str`/`!?str?`）；失败返回「词: 事件未找到」。测试 20 例。
- **M25.2 lineedit.ts**：`EditState.killed?`——kill 类（Ctrl+U/K/W）返回删下的文本；新增 `yank`（光标处插入）与 `yankPop`（替换上次粘贴段，区间夹紧防越界）。
- **M25.3 lineedit.test.ts**：存量 kill 断言全量补 `killed` 字段；新增 yank 4 例 + yankPop 4 例。TDD 抓出 1 处测试索引笔误（'AAA' 区间 [3,6) 误写 [4,7)）。
- **M25.4 Terminal.svelte 接线**：submit 执行前 `histExpand`（用加入当前行**之前**的历史，`!!`=上一条）；展开失败报错不执行但原始行入历史（bash 同款）；变更则先回显展开行再执行；kill ring 上限 32，Ctrl+Y 粘环顶、Alt+Y 取模环内替换；onKey 分派前统一判定——任何非 yank 键断 Alt+Y 链；Alt+Y 用 `e.code`（macOS Option+y 产 `¥`）。help 文本补历史展开说明。

### 关键代码
```ts
// histexpand.ts：单引号内一切字面（bash 强引用不展开）；\! 转义；词尾/空白/=/引号紧随 → 字面 !
if (q === "'") { out += c; if (c === "'") q = null; i++; continue; }
if (c === '\\' && line[i + 1] === '!') { out += '!'; i += 2; continue; }
if (next === undefined || next === ' ' || next === '\t' || next === '=' || next === '"' || next === "'") {
  out += '!'; i++; continue;
}

// Terminal.svelte：submit 执行前展开——变更回显展开行，失败不执行但原始行入历史（bash 同款）
const ex = histExpand(cmd, cmdHistory.list);
addHistory(cmd);
if (!ex.ok) { lines.push({ kind: 'err', text: `qzsh: ${ex.error}` }); ...; return; }
if (ex.changed) { runLine = ex.line; lines.push({ kind: 'out', text: ex.line }); }

// kill ring：Alt+Y 只能紧跟 yank/上一次 Alt+Y——任何其他键在分派前断链
const isYankKey =
  (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'y') ||
  (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyY');
if (!isYankKey) lastYank = null;
```

### 新增测试核心断言
```ts
expect(histExpand('sudo !!', HIST)).toEqual({ ok: true, line: 'sudo echo done', changed: true });
expect(histExpand('!-2', HIST)).toEqual({ ok: true, line: 'git status', changed: true });
expect(histExpand("echo '!!'", HIST)).toEqual({ ok: true, line: "echo '!!'", changed: false }); // 单引号不展开
expect(histExpand('echo a! b', HIST)).toEqual({ ok: true, line: 'echo a! b', changed: false }); // 词尾 ! 字面
expect(histExpand('!9', HIST).ok).toBe(false); // 越界 → 事件未找到
expect(yank({ text: 'echoworld', pos: 4 }, ' hello ')).toEqual({ text: 'echo hello world', pos: 11 });
expect(yankPop({ text: 'ab', pos: 2 }, 'X', { start: 0, end: 99 })).toEqual({ text: 'X', pos: 1 }); // 区间夹紧
```

### 执行结果
```
npx vitest run
 Test Files  21 passed (21) · Tests  359 passed (359)（+28：histexpand 20 + lineedit 净增 8）

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 581ms（index 443.40kB gzip 147.33kB）
```

### 备注
- 取舍（注释在案）：bash 把「连续 kill」合并成环内一项（C-k C-k 拼成一段），这里每次 kill 独立入环——Alt+Y 逐段回溯反而更细粒度，实现与心智都简单。
- 历史里记的是**原始行**（含 `!!`），与 bash 一致：按 ↑ 找回的是 `!!` 而非展开结果。
- 双引号内 `!` 可展开、单引号内不展开，与 bash 引号语义一致（M24 的引号体系在展开层同样生效）。

---

## 2026-07-20 · M24「Shell 变量展开与 bash 引号语义」

### 定向过程
M24 原计划只是「验证 subst 变量展开 + 补测」。审查发现 tokenize 剥引号后丢失引号信息，导致四处与真实 bash 的语义差异：①单引号强引用失效（`echo '$HOME'` 也展开）；②引号内算符误当算符（`echo ">x"` 被拆成重定向）；③无引号变量展开为空不删词（`echo $X x` 输出 `" x"` 带前导空格）；④TDD 又抓出 `$?` 语句间不同步（`nosuchcmd; echo $?` 输出 0 而非 127）。一处根因（引号信息丢失）+ 一处状态同步缺失，一并修复。

### 改动概要
- **M24.1 tokenize 产出 Tok{text,q}**：保留引号类型；subst 加第三参 q，单引号强引用原样不展开。
- **M24.2 splitRedirToks/expandWords 引号感知**：引号词不拆算符、不 glob（`for f in "*"` 字面星号）。
- **M24.3 expandToks 空词删除 + 空段跳过**：无引号变量展开为空整词移除；未定义变量单独成行无操作跳过（非语法错误）。
- **M24.4 runLeaf 写回 ctx.code**：`$?` 语句间实时反映上一条命令退出码。
- **M24.5 shell.test.ts +18 例**（变量展开 11 + 引号语义 7）。

### 关键代码
```ts
interface Tok {
  text: string; // 剥掉引号后的文本
  q: '"' | "'" | null; // 包裹引号（null = 裸词）
}

// 单引号是强引用（bash 语义）：单引号词原样不展开
function subst(tok: string, ctx: ShellCtx, q: '"' | "'" | null = null): string {
  if (q === "'") return tok;
  return tok
    .replace(/\$\?/g, String(ctx.code))
    .replace(/\$\{(\w+)\}/g, (_, n) => ctx.env[n] ?? '')
    .replace(/\$(\w+)/g, (_, n) => ctx.env[n] ?? '');
}

// bash 空词删除：无引号变量展开为空 → 整词移除；引号空串保留
function expandToks(toks: Tok[], ctx: ShellCtx): string[] {
  const out: string[] = [];
  for (const t of toks) {
    const text = subst(t.text, ctx, t.q);
    if (text === '' && t.q === null && t.text !== '') continue;
    out.push(text);
  }
  return out;
}

// runLeaf：同步回 ctx，后续语句的 $? 实时反映上一条命令退出码
lastCode = res.code;
ctx.code = res.code;
```

### 新增测试核心断言
```ts
expect((await run("echo '$HOME'", newCtx())).out).toBe('$HOME'); // 单引号强引用
expect((await run('echo $UNDEFINED x', newCtx())).out).toBe('x'); // 空词删除
expect((await run('echo "" x', newCtx())).out).toBe(' x'); // 引号空串保留
expect((await run('nosuchcmd; echo $?', newCtx())).out).toBe('127'); // $? 语句间同步
expect((await run('echo ">x"', newCtx())).out).toBe('>x'); // 引号内 > 非算符
expect((await run('for f in "*"; do echo $f; done', newCtx())).out).toBe('*'); // 引号不 glob
```

### 执行结果
```
npx vitest run
 Test Files  20 passed (20) · Tests  331 passed (331)（+18）

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 625ms（index 440.81kB gzip 146.30kB）
```

### 备注
- 已知取舍（注释在案）：裸词拼引号罕见形态（`foo"bar"`）以首个引号作整词 q；变量展开产出的 `> <` 仍会被当重定向（bash 不认，`A='>'` 场景极罕见）；`> file` 式空命令+重定向仍走原报错不创建文件。
- TDD 价值再现：先写的 `$? 取 127` 测试一跑即红，逼出 runLeaf 不同步 ctx.code 的存量缺陷——纯靠肉眼审查很难发现。

---

## 2026-07-20 · M23「Shell 环境变量补全（$ 前缀）」

### 定向过程
真实 shell 的环境变量补全是高频操作：`cd $HO<Tab>` → `$HOME`、`echo $PA<Tab>` → `$PATH`。M16 补全引擎没有 $ 前缀感知，补上后更贴近真实终端手感。

### 改动概要
- **M23.1 completion.ts**：`CompletionSource` 新增 `env` 字段；`completeLine` 在 flag 检测后、命令感知前加 $ 前缀检测——保留 $ 前缀补全，支持唯一候选/LCP/多候选列表/引号内补全。
- **M23.2 completion.test.ts**：+7 例测试（$HOM→唯一/$HO→多候选/$US→唯一/$HOME 空格后走路径/引号内/cd 命令下/管道段内）。
- **M23.3 Terminal.svelte**：`complete()` 中新增 `env: Object.keys(ctx.env)` 注入当前 shell 上下文的环境变量。

### 关键代码
```ts
// M23：$ 前缀 = 环境变量补全（放在命令感知之前，确保 cd $HOME、grep $PATH 都能补）
if (word.startsWith('$')) {
  const varName = word.slice(1);
  const cands = wordCands(varName, src.env);
  if (cands.length === 1) {
    const c = cands[0];
    return { input: head + (quote ?? '') + '$' + c.text + ' ' };
  }
  const lcp = longestCommonPrefix(cands.map((c) => c.text));
  if (lcp.length > varName.length) return { input: head + (quote ?? '') + '$' + lcp };
  return { candidates: cands.map((c) => '$' + c.text) };
}
```

### 新增测试核心断言
```ts
// 唯一候选补全（$HOM 只匹配 HOME）
expect(completeLine('echo $HOM', 'root', SRC)).toEqual({ input: 'echo $HOME ' });
// 多候选列表（$HO 匹配 HOME 和 HOSTNAME）
expect(completeLine('echo $HO', 'root', SRC)).toEqual({ candidates: ['$HOME', '$HOSTNAME'] });
// $HOME 后跟空格 = 已写完，进入新词位走路径补全
expect(completeLine('echo $HOME ', 'root', SRC)).toEqual({ candidates: ['dir1/', 'file-a.txt', ...] });
// cd 命令下 $ 前缀仍补环境变量（而非路径）
expect(completeLine('cd $HOM', 'root', SRC)).toEqual({ input: 'cd $HOME ' });
```

### 执行结果
```
npx vitest run
 Test Files  20 passed (20) · Tests  313 passed (313)

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 617ms（index 440.50kB gzip 146.17kB）
```

### 备注
- $ 前缀检测放在命令感知之前——这样 `cd $HOME`、`grep $PATH` 等场景都能正常补全环境变量，而非被 cd/grep 的命令感知逻辑拦截走路径补全。
- $HOME 后跟空格时，`lastWord` 会切出新词位（空词），此时走默认路径补全（列出目录内容），与真实 shell 一致。

---

## 2026-07-20 · M22「Terminal 选中即复制 + 右键菜单」

### 定向过程
macOS Terminal 的两个经典交互：选中即复制（鼠标松开自动进剪贴板）和右键菜单（粘贴/复制/清空/新建窗口）——这是终端日常使用频率极高的操作，补齐后 Terminal 手感更贴近真实系统。

### 改动概要
- **M22.1 选中即复制**：`onMouseUp` 监听——`window.getSelection()` 非折叠且有文本 → `sys.clipboard.copy(text)`；行内连续空白被折叠（与真实终端一致）。
- **M22.2 右键菜单**：`onContextMenu` 监听——点在输入框上不弹菜单（保留浏览器默认右键菜单）；粘贴优先 `navigator.clipboard.readText()`，失败回退 `sys.clipboard.read()`；复制项选中时有文本才可用（`disabled: !hasSelection`）；清空 = `lines = []`；新建窗口 = `sys.openApp('terminal')`。

### 关键代码
```ts
// M22：选中即复制（macOS Terminal 经典交互）
function onMouseUp() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const text = sel.toString().trim();
  if (text) sys.clipboard.copy(text);
}

// M22：右键菜单（粘贴/复制/清空/新建窗口）
async function onContextMenu(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('input')) return; // 输入框上保留浏览器默认菜单
  const sel = window.getSelection();
  const hasSelection = sel && !sel.isCollapsed && sel.toString().trim();
  const pasteText = async () => {
    try {
      const text = await navigator.clipboard?.readText() ?? sys.clipboard.read();
      if (text) input += text;
    } catch {
      const text = sys.clipboard.read();
      if (text) input += text;
    }
  };
  openMenu(e, [
    { label: '粘贴', icon: '📋', onClick: pasteText },
    { label: '复制', icon: '📄', disabled: !hasSelection, onClick: () => sys.clipboard.copy(sel!.toString().trim()) },
    { label: '清空', icon: '🗑️', separator: true, onClick: () => { lines = []; } },
    { label: '新建窗口', icon: '➕', onClick: () => sys.openApp('terminal') },
  ]);
}
```

### 执行结果
```
npx vitest run
 Test Files  20 passed (20) · Tests  306 passed (306)

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量）

npm run build
 → ✓ built in 599ms（index 440.25kB gzip 146.07kB）
```

### 备注
- 输入框上保留浏览器默认右键菜单——这样用户能直接用浏览器的「粘贴」，避免自定义菜单与输入框焦点冲突。
- 粘贴优先读系统剪贴板（`navigator.clipboard`），失败回退内部剪贴板——兼顾浏览器权限限制场景。
- 复制项用 `disabled` 而非隐藏——macOS 心智：不可用的项灰化保留，不凭空消失。

---

## 2026-07-20 · M21「Files ↔ Terminal 跨 App 联动」

### 定向过程
M20 收尾同时并行推进的跨 App 联动里程碑（子代理执行）。真实 macOS 里 Finder 与 Terminal 的经典联动 = 右键「在文件夹中打开终端」；顺带补「复制路径」（Finder ⌥⌘C 同款），两个都是低成本高频率的联动能力。

### 改动概要
- **M21.1 Terminal 接收 cwd**：`Terminal.svelte` props 新增 `data?: unknown`；onMount 开头解析 `data.cwd`——`getNode` 校验节点存在且 `type === 'dir'` 才赋给 `ctx.cwd`，非法数据静默忽略；`/etc/profile` 里的 `cd` 仍可覆盖它（真实 shell rc 优先级语义）。
- **M21.2 Files 右键菜单**：`onItemMenu` 新增两项——「在终端打开」（显隐条件 `n.type === 'dir' && tgts.length === 1`，icon 🖥️ 与 registry 中 terminal 图标一致，`sys.openApp('terminal', { data: { cwd: n.id } })`）；「复制路径」（多选同款 suffix，icon 🔗，`tgts.map((id) => pathOf(id)).join('\n')` 进剪贴板，与「复制名称」同手法）。

### 关键代码
```ts
// Terminal.svelte：M21 接收 Files「在终端打开」的 cwd 参数（非法数据静默忽略）
if (typeof data === 'object' && data !== null && 'cwd' in data && typeof data.cwd === 'string') {
  const dir = getNode(data.cwd);
  if (dir?.type === 'dir') ctx.cwd = data.cwd; // /etc/profile 里的 cd 仍可覆盖它（真实 shell rc 优先级）
}

// Files.svelte：M21 右键菜单两项
...(n.type === 'dir' && tgts.length === 1 ? [{
  label: '在终端打开',
  icon: '🖥️', // 与 registry 中 terminal 图标一致
  onClick: () => sys.openApp('terminal', { data: { cwd: n.id } })
}] : []),
{
  label: '复制路径' + suffix,
  icon: '🔗',
  onClick: () => sys.clipboard.copy(tgts.map((id) => pathOf(id)).join('\n'))
},
```

### 执行结果
与 M20 合并回归，见 M20 条目。

### 备注
- 子代理首版漏导入 `getNode` 致 svelte-check 报错，已修；「在终端打开」显隐条件补 `n.type === 'dir'`（初版文件项也显示）。
- 无新增纯函数 → 无新增测试文件；联动路径由既有 vfs/openApp 测试覆盖，行为验证走 svelte-check + 构建。

---

## 2026-07-20 · M20「Shell 管道/重定向感知补全」

### 定向过程
M16 补全引擎的命令感知只覆盖「行首第一条命令」——`ls | grep f<Tab>` 会按行首 ls 的参数位补、`echo hi > f<Tab>` 不知该补路径，与真实 bash 差距明显。本里程碑给补全引擎加管道/重定向感知，纯函数层解决，Terminal 零改动。

### 改动概要
- **M20.1 tokenize**：`completion.ts` 新增导出 `tokenize(line)`——引号感知操作符分词：空白分词基础上，引号（`'`/`"`）内操作符不生效；`|`、`&` 单写/双写各自成词（`&&`、`||` 合并）；`;`、`>`、`>>`、`<` 各自成词；`2>` 自然拆成 `'2'` 与 `'>'`（与 bash 词法一致）。
- **M20.2 completeLine 感知逻辑**：整行 tokenize 后三段判定——① 末词是 `PIPE_OPS`（`|` `||` `&&` `;` `&`）→ 新命令位，补命令名；② 末词是 `REDIR_OPS`（`>` `>>` `<`）→ 补路径（pathCands，目录加 `/` 可续钻）；③ 否则取最后一个管道/序列操作符后的「当前段」，段内滤掉重定向操作符，按 `seg[0]` 为命令递推（sudo 透传、systemctl 子命令判定同步改吃 `seg` 数组）。
- **M20.3 测试 +18 例（46→64）**：tokenize 6 例 + 管道 6 例 + 重定向 6 例。

### 关键代码
```ts
// M20 管道/重定向感知（bash 同款）：先按整行分词定位「当前段」再判定命令
const tokens = tokenize(head);
const lastTok = tokens[tokens.length - 1];
if (lastTok && PIPE_OPS.has(lastTok)) {
  return settle(head, '', word, quote, wordCands(word, src.commands)); // | 后补命令
}
if (lastTok && REDIR_OPS.has(lastTok)) {
  const p = pathCands(word, cwd, false); // > 后补路径
  return p ? settle(head, p.pre, p.frag, quote, p.cands) : {};
}
// 当前管道段 = 最后一个管道/序列操作符之后；段内重定向操作符不参与 cmd/argIdx 判定
let segStart = 0;
for (let i = tokens.length - 1; i >= 0; i--) {
  if (PIPE_OPS.has(tokens[i])) { segStart = i + 1; break; }
}
const seg = tokens.slice(segStart).filter((t) => !REDIR_OPS.has(t));
```

### 新增测试核心断言
```ts
// 管道：| 后是新命令位；段内按真实命令递推
expect(completeLine('ls | ', 'root', SRC)).toEqual({ candidates: [...SRC.commands] });
expect(completeLine('ls | grep f', 'root', SRC)).toEqual({ input: 'ls | grep file-' });
expect(completeLine('ls | sudo kill 10', 'root', SRC)).toEqual({ candidates: ['101', '102'] });
// 重定向：> 后补路径；2> 的 2 已消费仍补路径；目标写完后回到命令参数位
expect(completeLine('ls 2> r', 'root', SRC)).toEqual({ input: 'ls 2> readme.md ' });
expect(completeLine('cat > out.txt read', 'root', SRC)).toEqual({ input: 'cat > out.txt readme.md ' });
// tokenize：引号内 | 不是操作符；2> 拆成 2 与 >
expect(tokenize('echo "a|b" | cat')).toEqual(['echo', 'a|b', '|', 'cat']);
expect(tokenize('ls 2> err.txt')).toEqual(['ls', '2', '>', 'err.txt']);
```

### 执行结果（M20 + M21 合并回归）
```
npx vitest run
 ✓ src/lib/completion.test.ts (64 tests)
 Test Files  20 passed (20) · Tests  306 passed (306)

npx svelte-check --tsconfig ./tsconfig.json
 → 0 errors / 5 warnings（tsconfig 存量，composite/emit 引用项目警告）

npm run build
 → ✓ built in 555ms（index 439.53kB gzip 145.89kB）
```

### 备注
- 语义对齐 bash 的三处取舍：`cat > out.txt <Tab>`（重定向目标已写完）仍按 cat 的参数位补路径，而不是再补一个重定向目标；`ls | kill 10<Tab>` 跨段后 kill 的 pid 感知仍生效；sudo 透传在管道段内同样生效（`ls | sudo kill …`）。
- `2>` 拆词依赖 tokenize 把 `>` 独立成词——`ls 2> err` 的 `2` 是普通参数词，与 bash 词法器行为一致（fd 数字紧贴重定向符才算 fd 指定）。

---

## 2026-07-20 · M19「通知中心 macOS 化：来源分组 + 单条/分组清除」

### 定向过程
用户请求「按照真实的系统功能继续往下进行进一步的完善」。真实 macOS 通知中心的定义性视觉特征 = 按来源 App 分组 + 悬停清除，而 QieZiOS 通知中心是平铺流（只有「清空」一把梭），Note 也没有来源字段 → 定向补全。与 M18 并行，由子代理执行。

### 改动概要
- **M19.1 数据层**：`Note.source?: string`（旧持久化数据无该字段，消费方兜底归 '系统'）；pushNote 收 source 写入 note 与历史副本；新增 `removeFromHistory(id)` 删单条、`removeSourceFromHistory(source)` 按来源整组删（`n.source ?? '系统'` 与分组语义一致）。
- **M19.2 分组纯函数**：新建 `src/lib/notegroup.ts`——`groupBySource<T extends {ts, source?}>` 泛型结构化类型（不 import 数据层 → 可纯测）：无 source 归 '系统'、组内 ts 新→旧、组间按「组内最新 ts」新→旧（旧组来新通知 → 整组排前）。`notegroup.test.ts` 7 例。坑：多来源组名断言不能套默认 sort 预期——中文按 UTF-16 码位（截 U+622A < 文 U+6587），改显式顺序断言。
- **M19.3 透传链路**：`sys.notify` opts 加 source；emit('notify') → services.ts notifyd → pushNote 全链路带 source。schedd 定时通知（at/crontab/提醒到点）来源无法静态判定 → 兜底 '系统'。
- **M19.4 TopBar 分组渲染**：`$derived(groupBySource(noteHistory.items))` 替换平铺 reverse；组头 = 来源名·数量 + hover 出现的清组 X；通知行加 hover 出现的删单条 X（行 hover 底色 bg-qz-elevated/60）；平铺 border-b 分隔改组间 mt-1.5 留白；面板 w-72→w-80；清空全部/BellOff 空态/unread 角标/markNotesSeen 全保留。
- **M19.5 调用方标注**：13 文件 18 处（截图/文件/App Store/提醒/时钟/设置/剪贴板/系统/桌面/聚焦/终端/AI 助手）。
- **M19.6 全量回归**：与 M18 合并跑，结果见下。

### 关键代码
```ts
// notegroup.ts：组间按「组内最新 ts」新→旧——旧组来了新通知，整组提到最前（macOS 手感）
export function groupBySource<T extends { ts: number; source?: string }>(
  items: readonly T[],
): NoteGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const n of items) {
    const key = n.source ?? '系统';
    const bucket = map.get(key);
    if (bucket) bucket.push(n);
    else map.set(key, [n]);
  }
  const groups: NoteGroup<T>[] = [];
  for (const [source, list] of map) {
    list.sort((a, b) => b.ts - a.ts); // 组内新 → 旧
    groups.push({ source, items: list });
  }
  groups.sort((a, b) => b.items[0].ts - a.items[0].ts);
  return groups;
}

// notifications.svelte.ts：按来源整组清除（macOS 式：悬停组头出现 ✕）
export function removeSourceFromHistory(source: string): void {
  noteHistory.items = noteHistory.items.filter((n) => (n.source ?? '系统') !== source);
}
```

### 测试结果
```
Test Files  20 passed (20)
     Tests  288 passed (288)   ← +7（notegroup）+15（histsearch，M18）
svelte-check found 0 errors（5 条 tsconfig 存量警告）
✓ built in 546ms   index 438.39kB │ gzip: 145.41kB
```

---

## 2026-07-20 · M18「Terminal Ctrl+R 历史搜索（reverse-i-search）」

### 定向过程
用户请求「按照真实的系统功能继续往下进行进一步的完善」。M16 补全 + M17 行编辑/中断之后，真实 shell 交互键族里最显眼的缺口就是 Ctrl+R 增量历史搜索。顺带发现存量隐患：此前 Ctrl+R 在 ctrlChord 无 case 不 preventDefault → 触发浏览器整页刷新（终端里按 Ctrl+R = 页面重载），本里程碑一并堵掉。

### 改动概要
- **M18.1 搜索纯函数**：新建 `src/lib/histsearch.ts`——`RSearchState{query,idx}`；`rsUpdate`（查询词变化 → 从最新向最老重搜）/`rsOlder`（下一个更老匹配；无更老停原地）/`rsMatch`（命中文本，idx 越界兜底 null）。子串匹配（includes 非前缀，'rm' 命中 'sudo rm -rf'）；findBackward 的 fromIdx 先夹合法范围（历史被 HISTORY_CAP 截短后 idx 越界仍能搜）。
- **M18.2 TDD**：`histsearch.test.ts` 15 例全绿（rsUpdate 5 + rsOlder 6 + rsMatch 4）。
- **M18.3 Terminal 接线**：`rsearch` 状态 + `rsSaved` 还原点；onKey 搜索分支接管按键——打字改查询、Backspace 删查询词、Ctrl+R 循环更老、**Enter 直接执行命中命令（bash 手感）**、→/Ctrl+E 只取到输入行留待编辑、Esc/Ctrl+C/Ctrl+G 取消还原；ctrlChord 加 r=rsStart；提示符行搜索中替换为 ``(reverse-i-search)`query':`` / 未命中时 `(failed reverse-i-search)`（与 bash 一致）；搜索中 Tab/↑/↓ 等其余键一律吃掉避免半态；欢迎语补 Ctrl+R。
- **M18.4 全量回归**：与 M19 合并跑，结果见上条。

### 关键代码
```ts
// histsearch.ts：再按 Ctrl+R 找更老；没有更老 → 停原地（failed 提示由 UI 据 idx 显示）
export function rsOlder(hist: readonly string[], s: RSearchState): RSearchState {
  if (s.query === '') return s;
  const from = s.idx >= 0 ? s.idx - 1 : hist.length - 1;
  const idx = findBackward(hist, s.query, from);
  return idx >= 0 ? { query: s.query, idx } : s;
}

// Terminal.svelte：搜索模式接管按键（Enter = bash 手感直接执行命中命令）
if (rsearch) {
  e.preventDefault();
  const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
  if (e.key === 'Escape' || (ctrl && (e.key === 'c' || e.key === 'g'))) rsCancel();
  else if (e.key === 'Enter') rsAccept(true);
  else if (e.key === 'ArrowRight' || (ctrl && e.key === 'e')) rsAccept(false);
  else if (e.key === 'Backspace') {
    if (rsearch.query) rsApply(rsUpdate(cmdHistory.list, rsearch.query.slice(0, -1)));
  } else if (ctrl && e.key === 'r') rsApply(rsOlder(cmdHistory.list, rsearch));
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    rsApply(rsUpdate(cmdHistory.list, rsearch.query + e.key));
  }
  return;
}
```

---

## 2026-07-20 · M17「Terminal readline 行编辑 + Ctrl+C 中断」

### 定向过程
用户请求「按照真实的系统功能继续往下进行进一步的完善」。排查发现 M17 原候选（循环上限+输出截断）已在 shell.ts 存量实现（MAX_LOOP=5000/OUT_CAP=100000/周期让出），重新定向为真实 shell 最显眼的缺失：readline 行编辑键族 + Ctrl+C 协作式中断。

### 改动概要
- **M17.1 行编辑纯函数**：新建 `src/lib/lineedit.ts`——`EditState{text,pos}` 二元组（对齐 input value/selectionStart 语义），`killToStart`(Ctrl+U)/`killToEnd`(Ctrl+K)/`killWordBack`(Ctrl+W)/`wordBack`(Alt+B、Ctrl+←)/`wordForward`(Alt+F、Ctrl+→)。词边界取 bash C-w 空白分隔语义（`/tmp/foo` 整体一词），wordBack→词头、wordForward→词尾的 emacs 不对称惯例；行首/行尾幂等，不碰 DOM 可纯测。
- **M17.2 TDD**：`lineedit.test.ts` 29 例全绿。TDD 抓出 4 处测试期望算错（pos=8 在 hello 中是 l|l 之间；空白分隔下 /tmp/foo 一词整体删）——实现符合 bash C-w 语义，修正测试而非实现。
- **M17.3 shell 协作式中断**：`ShellCtx` 新增 `intr{flag}`（newCtx 带上）；`ShellInterrupt` 异常在语句边界+每次循环迭代 `checkIntr` 抛出，unwind 到 run 顶层转 **130 退出码** + err `^C`；flag 由调用方复位（run 内部不清 → 嵌套 sh/source 共享 ctx 时外层一并中止）；后台作业 bgCtx 不带 intr（真实 shell 同理，Ctrl+C 只打前台）。`shell.test.ts` 起步 8 例（echo/for/while 基础 + 预置 flag 即停/失控 while 执行中中断/for 中断/flag 持续性与复位/无 intr 可选链兜底）。存量发现：while 退出码是 cond 的码（bash 应 0），记录不动。
- **M17.4 Terminal 接线**：`ctrlChord` 统一入口（纯 Ctrl，不吃 Cmd/Alt 组合）：C=cancelLine（echo `^C` 新起行）/D=eofExit（空行关窗，pid→进程 id 换算）/A/E=行首行尾/U/K/W=applyEdit 三件套/L=清屏；Ctrl+←/→ 与 Alt+B/F 词移动（Alt 用 `e.code` 防 macOS Option 产出 `∫`）；applyEdit 等 tick 后 setSelectionRange 落光标。**busy 时输入框解禁**（原 disabled 会吞掉 Ctrl+C 键事件）：busy 分支只拦 Ctrl+C，其余键放行默认行为 → 白赚真实终端 type-ahead。submit 执行前复位 intr.flag。
- **M17.5 全量回归**：vitest 18 文件 266 例全绿（+37）；svelte-check 0 错 0 警（顺手修两处：completion.ts dirId 窄化顺序、Terminal close 吃字符串 id 非数字 pid）；npm run build 成功（569ms，index 435.36kB gzip 144.48kB）。

### 关键代码
```ts
// lineedit.ts：词边界（bash C-w 语义：空白分隔）。先回跳空白，再回跳非空白。
export function wordBack(text: string, pos: number): number {
  let i = Math.max(0, Math.min(pos, text.length));
  while (i > 0 && isSpace(text[i - 1])) i--;
  while (i > 0 && !isSpace(text[i - 1])) i--;
  return i;
}

// shell.ts：Ctrl+C 检查点——语句边界 + 每次循环迭代；异常 unwind 免逐级传「已中断」
const checkIntr = () => {
  if (ctx.intr?.flag) throw new ShellInterrupt();
};
// run 顶层：转 130（bash SIGINT 退出码）；flag 不清，调用方每次执行前复位
try {
  await execNodes(ast);
} catch (e) {
  if (!(e instanceof ShellInterrupt)) throw e;
  errs.push('^C');
  return { out: outs.join('\n'), err: errs.join('\n'), code: 130, cd, clear };
}

// Terminal.svelte：busy 分支只拦 Ctrl+C，其余键放行 → type-ahead
if (busy) {
  if (e.key === 'c' && e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    interrupt(); // 置 ctx.intr.flag，shell 下一语句/迭代边界中止
  }
  return;
}
```

### 测试结果
```
Test Files  18 passed (18)
     Tests  266 passed (266)   ← +37（lineedit 29 + shell 8）
svelte-check found 0 errors and 0 warnings
✓ built in 569ms   index 435.36kB │ gzip: 144.48kB
```

## 2026-07-20 · M16「Terminal 补全引擎（贴近真实 shell）」

### 定向过程
用户请求「按照真实的系统功能继续往下进行进一步的完善」。Terminal 原有补全为 30 行内联简陋实现（split(/\s+/) 不尊重引号、只补当前目录、无公共前缀），与真实 shell 差距大 → 定向补全引擎。

### 改动概要
- **M16.1 补全引擎纯函数**：新建 `src/lib/completion.ts`——`lastWord`（引号感知最后一词切分，未闭合引号内空格不断词）+ `longestCommonPrefix` + `completeLine` 主入口。首词补命令名；参数位命令感知（cd 只目录且不带虚拟挂载点、man/help/which/sudo 补命令、kill 补 pid、su 补用户、systemctl 补子命令+服务名、pkg 补子命令、fg 补运行中作业号、open 补 App id+路径混合）；路径补全支持绝对/相对/..、隐藏文件规则（frag 以 . 开头才补隐藏项）、虚拟挂载 /proc /dev；多候选先补 LCP（bash 第一次 Tab 手感），无进展才列候选；flag 参数不响；空行 Tab 不刷全部命令；引号补全自动闭合（目录不闭合可续补）。动态数据经 `CompletionSource` 注入 → 测试不拖 shell.ts 大依赖图。
- **M16.2 TDD**：`completion.test.ts` 46 例全绿（lastWord 7 + LCP 4 + 命令位 4 + 路径 12 + 虚拟路径 3 + 命令感知 14 + 引号 2）。TDD 抓出两处语义：cd 不应补虚拟挂载点（cd /proc 本会失败）、cwd 即根时 ls 空词应含 proc/dev（与 ls 输出一致）。
- **M16.3 Terminal 接入**：`complete()` 改为调 `completeLine`；CompletionSource 现场组装（COMMAND_NAMES/appList/users.list/listServices/processes pid/jobs 运行中作业号）。
- **M16.4 全量回归**：vitest 16 文件 229 例全绿（+46）；svelte-check 0 错；npm run build 成功（551ms，index 433.48kB gzip 143.92kB）。

### 关键代码
```ts
// completion.ts：sudo 透传——sudo <命令> … → 按真实命令递推
if (cmd === 'sudo' && argIdx >= 1) {
  cmd = words[1];
  argIdx -= 1;
}
// 根目录：与 ls 行为一致，把虚拟挂载点 proc/ dev/ 也带进候选；dirsOnly（cd）不带
if (dirId === 'root' && !dirsOnly) {
  const existing = new Set(entries.map((e) => e.text));
  for (const m of VIRTUAL_MOUNTS) {
    const name = m.slice(1);
    if (!existing.has(name)) entries.push({ text: name, isDir: true });
  }
}
```

### 测试结果
```
Test Files  16 passed (16)
     Tests  229 passed (229)   ← +46（completion）
✓ built in 551ms   index 433.48kB │ gzip: 143.92kB
```

## 2026-07-20 · M15「VFS 补测 + AI 工具箱补完」

### 定向过程
用户请求「继续进行下一步的内容」。经分析确定 M15 方向为「VFS 补测 + AI 工具箱补完」——VFS 是系统核心但测试覆盖不足，AI 工具箱现有 8 个工具缺少文件读取/进程管理/通知等关键能力。

### 改动概要
- **M15.1 VFS 核心函数 TDD 补测**：新建 `vfs.test.ts`（53 例），覆盖 `children`/`createDir`/`createFile`/`rename`/`move`/`trash`/`restoreFromTrash`/`emptyTrash`/`writeFile`/`copyNode`/`purge`/`setMode`/`setOwner`/`isImage`/`isAudio`/`isVideo`/`isMedia`/`pathOf`/`resolvePath`/`pathSegments` 全部核心函数。重点补充 `copyNode`（文件/目录递归复制）、`purge`（递归删除 + 父环防御）、`writeFile` 二进制→文本降级（清 kind/blobId/mime/size）等关键路径。mock `blobStore`（`putBlob`/`getBlob`/`deleteBlob`）消除测试环境无 IndexedDB 的 unhandled rejection。
- **M15.2 AI 工具箱补完**：`aiTools.ts` TOOL_DEFS 新增 6 工具——`read_file`（读文本文件内容，拒绝二进制）、`close_app`（按 processId 或 pid 关闭窗口）、`notify`（发系统通知 toast）、`move_file`（fileId→destFolderId）、`trash_file`（软删除入回收站）、`set_dnd`（开关勿扰模式）。`executeTool` 对应 6 个 case 实现。`sys.ts` fs 命名空间补充暴露 `move`、`trash`（AI 工具经 sys 门面访问）。
- **M15.3 全量回归**：vitest 15 文件 183 例全绿（+53 例）；svelte-check 0 错；npm run build 成功（585ms，index 431.20kB gzip 142.90kB）。

### 关键代码
```ts
// vfs.test.ts：mock blobStore 消除测试环境无 IndexedDB 的 unhandled rejection
vi.mock('./blobStore', () => ({
  putBlob: vi.fn(),
  getBlob: vi.fn(),
  deleteBlob: vi.fn(),
}));

// vfs.test.ts：writeFile 二进制→文本降级测试
it('写入文本到二进制节点 → 清掉二进制元数据变成文本文件', () => {
  const id = createFile('root', 'a.png');
  vfs.nodes[id] = { ...vfs.nodes[id]!, kind: 'binary', blobId: 'blob-123', mime: 'image/png', size: 1024 };
  writeFile(id, 'hello text');
  const n = getNode(id);
  expect(n?.content).toBe('hello text');
  expect(n?.kind).toBeUndefined();
  expect(n?.blobId).toBeUndefined();
  expect(n?.mime).toBeUndefined();
  expect(n?.size).toBeUndefined();
});

// vfs.test.ts：purge 父环防御测试（模拟损坏数据不无限递归）
it('父环防御：不无限递归', () => {
  const a = createDir('root', 'a');
  const b = createDir(a, 'b');
  vfs.nodes[a]!.parentId = b; // a → b → a 成环
  purge(a);
  expect(getNode(a)).toBeUndefined();
  expect(getNode(b)).toBeUndefined();
});

// aiTools.ts：read_file 工具（读文本文件内容，拒绝二进制）
case 'read_file': {
  const n = sys.fs.read(String(input.fileId));
  if (!n) return { error: '文件不存在' };
  if (n.type !== 'file') return { error: '不是文件（是文件夹）' };
  if (n.kind === 'binary') return { error: '二进制文件不可读（mime: ' + (n.mime ?? 'unknown') + '）' };
  return { id: n.id, name: n.name, content: n.content };
}

// aiTools.ts：close_app 工具（按 processId 或 pid 关闭窗口）
case 'close_app': {
  const procs = sys.proc.list();
  let target = procs.find((p) => p.id === String(input.processId));
  if (!target && typeof input.pid === 'number') target = procs.find((p) => p.pid === input.pid);
  if (!target) return { error: '进程不存在（processId/pid 都不匹配）' };
  sys.proc.close(target.id);
  return { ok: true, closed: target.appId, pid: target.pid };
}
```

### 新增测试
- `vfs.test.ts`：53 例（children/createDir/createFile/rename/move/trash/restore/emptyTrash/writeFile/copyNode/purge/setMode/setOwner/is*/pathOf/resolvePath/pathSegments）

### 验证结果
- `npx vitest run`：**15 文件 183 例全绿** ✅（+53 例 vfs.test.ts）
- `npx svelte-check`：**0 错**（5 条 tsconfig 存量警告）✅
- `npm run build`：**成功**（585ms，index 431.20kB gzip 142.90kB）✅

---

## 2026-07-20 · M14「全面检查修复 + 排版优化」

### 定向过程
用户请求「全面检查目前可能存在的问题并优化排版」。先修上轮发现的 P0 bug（toggleTheme 在 auto/schedule 模式下失效），再做 8 处排版精细化修复；之后并行启动 search agent 对 src/ 全量做排版/一致性广审（16 条候选），逐条核查后修 6 条真值得修，剩余 10 条经核查均合理保留。同时把 Spotlight/registry 两处复制的 emptyTrash+notify 字面量收口到 sys.fs.emptyTrashWithNotify。

### 改动概要
- **M14.1 toggleTheme 收口（P0 修复）**：`theme.svelte.ts` 新增 `toggleTheme()`（用 `resolvedMode()` 判当前实际态再翻 → auto/schedule 模式下也能正确切到反面）；四处调用收口：Spotlight `ACTIONS.theme.run`、registry `settings` 菜单 onClick、TopBar `toggleMode`、MobileControlCenter 主题按钮（删本地同名包装避免无限递归）。
- **M14.2 排版修复（8 处）**：Spotlight 空态文案 + 组间距 + calc `=` 着色；ContextMenu kbd border/bg/padding + danger 红底白字 + disabled cursor-default + 分割线 mx-2.5；Notifications 标题 truncate + action 按钮 text-xs；Window 标题 min-w-0（flex-1 truncate 必需）；Launchpad 标签 drop-shadow；Expose tracking-wider（中文不拉宽）+ 角标 text-[10px]；Onboarding 三页 h1 统一 text-2xl；LoginScreen 时钟 text-[5rem] 与 LockScreen 一致。
- **M14.3 一致性 + emptyTrashWithNotify**：`sys.ts` fs 命名空间新增 `emptyTrashWithNotify()`（emptyTrash + notify 文案/level/timeout 单一来源）；Spotlight + registry 两处字面量复制改调它。QuickSettings fontScale step 0.05→0.01（与 Settings 一致）；QuickSettings swatch ring-2/ring-offset-1→outline/outline-offset（与 Settings 一致）。Dock 运行点 -bottom-1→-bottom-0.5（与 MobileHome 一致）。
- **M14.4 TopBar 🔕 + 广审**：TopBar 通知中心空态裸 emoji 🔕 → `<Icon name="BellOff" size={28} strokeWidth={1.5} />`。广审 16 条候选 → 修 6 条：MobileControlCenter swatch ring-2→outline；MobileHome 运行点 -bottom-1→-bottom-0.5；AppStore 能力标签 text-[9px]→text-[10px]；SysMonitor 重启徽章 text-[9px]→text-[10px]；Files 网格视图属主权限行 text-[9px]→text-[10px]；Desktop 中央 🍆 加注释明确为品牌符号例外。剩余 10 条经核查合理保留（详见 STATE.json M14.4 notes）。

### 关键代码
```ts
// theme.svelte.ts：toggleTheme 用 resolvedMode() 判定实际态再翻
// → auto/schedule 模式下也能正确切到反面（直接读 settings.mode 会落到 'dark' 失效）
export function toggleTheme(): void {
  settings.mode = resolvedMode() === 'dark' ? 'light' : 'dark';
}

// sys.ts：emptyTrashWithNotify 收口（消除 Spotlight + registry 两处字面量复制）
fs: {
  // ...原有 list/read/mkdir/create/write...
  emptyTrashWithNotify() {
    emptyTrash();
    sys.notify('已清空回收站', { level: 'success', timeout: 1500 });
  },
}

// QuickSettings.svelte：swatch 选中态 ring-2 → outline（与 Settings.svelte 同款）
<button
  class="h-7 w-7 rounded-full outline transition active:scale-90"
  style="background: {c}; outline-color: {settings.accent === c ? c : 'transparent'};
         outline-width: {settings.accent === c ? '2px' : '0'}; outline-offset: 2px;"
  ...
></button>
```

### 新增测试
无新测试——本次均为视觉/收口修复，无新纯函数（toggleTheme/emptyTrashWithNotify 是 1-2 行包装，逻辑由既有 resolvedMode/emptyTrash/notify 承担，已被现有测试覆盖）。

### 验证结果
- `npx vitest run`：**14 文件 130 例全绿** ✅
- `npx svelte-check`：**0 错**（5 条 tsconfig 存量警告：moduleResolution=node10 deprecation + composite/emit，与本次无关）✅
- `npm run build`：**成功**（591ms，index 428.69kB gzip 142.18kB）✅

---

## 2026-07-19 · M13「Spotlight 分组精致化 + App 菜单扩充」

### 定向过程
第 4 轮 loop 检查（读码审计）：Spotlight 结果扁平平铺，分类只靠行尾 12px 小标签（App/我的/动作/文件/AI），缺 macOS Spotlight 式分组标题——高频入口的精致度缺口。同时 M12.2 菜单机制只有回收站/终端两个示范，扩充到文件/设置两个高频 App 验证机制顺手性。

### 改动概要
- **M13.1 Spotlight 分组标题**：新 `spotlightGroups.ts` 纯函数 `groupResults(results, fileTitle)`——按 kind 首见顺序聚合（不重排结果），`GroupItem.i` 恒等于原数组下标 → selected 高亮/键盘循环/Enter 激活零改动。渲染改两层 each：组标题 10px 大写灰字；行尾冗余 kind 标签删除（分组标题承担分类语义），calc「Enter 复制」挪副标题；file 组标题按场景注入（空查询「最近打开」/有查询「文件」）。
- **M13.2 App 菜单扩充**：files「新建文件夹/新建文本文件」（`createDir/createFile('root')` 与桌面右键同语义 + notify 落点提示）；settings「切换明暗主题」（`settings.mode` toggle）。图标均已在注册表。

### 关键代码
```ts
// spotlightGroups.ts：组顺序 = kind 首见顺序，扁平索引直通 selected
export function groupResults<T extends { kind: string }>(results: T[], fileTitle = '文件') {
  const groups: ResultGroup<T>[] = [];
  const byKind = new Map<string, ResultGroup<T>>();
  for (let i = 0; i < results.length; i++) {
    let g = byKind.get(results[i].kind);
    if (!g) { g = { title: ..., items: [] }; byKind.set(results[i].kind, g); groups.push(g); }
    g.items.push({ r: results[i], i }); // i 恒等于原数组下标
  }
  return groups;
}
```

### 新增测试（8 例）
`spotlightGroups.test.ts`：首见顺序分组、不相邻同类聚合、扁平索引矩阵（0..n 直通）、fileTitle 注入、默认标题、userapp/ai 标题、未知 kind 兜底、空数组。

### 验证结果
- `npm test`：**14 文件 130 例全绿** ✅
- `npx svelte-check`：**0 错**（5 条 tsconfig 存量警告）✅
- `npm run build`：**成功**（521ms，index 428.38kB gzip 142.10kB）✅

---

## 2026-07-19 · M12「键盘完备性 + App 级菜单机制」

### 定向过程
第 3 轮 loop 检查（读码审计）：Desktop.onKey 里 Ctrl/Cmd+字母判定是散落的内联表达式（`(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x'` 出现 3 次），macOS 标配的 ⌘W（关窗）/⌘H（隐藏其他）缺位；U8 遗留的「App 经 registry 声明自定义菜单」机制未做，顶栏 App 菜单始终只有窗口操作四项。两项同属「系统完备性」，单里程碑收口。

### 改动概要
- **M12.1 keymap.ts + ⌘W/⌘H**：新 `src/shell/keymap.ts` `matchShortcut(e, key)` 纯函数收口判定（Ctrl/Cmd 双平台等价、大小写不敏感）；Desktop.svelte 全部判定改走它，新增 ⌘W 关活动窗、⌘H 隐藏其他（遍历最小化非活动窗）；Shortcuts 速查面板补两条。
- **M12.2 App 级菜单机制**：registry `AppDef.menus?` 可选声明（SessionMenuItem[]，单向依赖不成环）；`buildAppMenu(active, actions, appItems?)` 在「关于」与窗口操作之间插 App 专属项（首项自动分割线）；⌘W/⌘H 标注 shortcut 字段；TopBar 消费 `resolveAppDef(appId)?.menus`。示范：回收站「清空回收站」、终端「新建窗口」。

### 关键代码
```ts
// keymap.ts：双平台等价 + 大小写不敏感，纯函数 vitest 裸跑
export function matchShortcut(e: ShortcutEvent, key: ShortcutKey): boolean {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === key;
}
```
```ts
// buildAppMenu：App 专属项插在「关于<App>」与窗口操作之间，首项带分割线
if (!appItems?.length) return windowItems;
return [
  windowItems[0],
  ...appItems.map((it, i) => ({ ...it, separator: i === 0 })),
  ...windowItems.slice(1)
];
```

### 新增测试（10 例）
- `keymap.test.ts` 6 例：Ctrl/Cmd 等价、大小写不敏感、无修饰拒绝、键位不匹配拒绝、ShortcutKey 全键位矩阵
- `session.test.ts` +4 例：appItems 插入位置与分割线、无 items 回退原序列、⌘W/⌘H shortcut 标注、App 菜单 shortcut 仅这两项（不虚构键位）

### 验证结果
- `npm test`：**13 文件 122 例全绿** ✅
- `npx svelte-check`：**0 错**（5 条 tsconfig 存量警告）✅
- `npm run build`：**成功** ✅

---

## 2026-07-19 · M11「图标底板一致性」（squircle 全场景收尾）

### 定向过程
第 2 轮 loop 轻量检查（读码非全量浏览器审计）：M9.1 建立的 squircle 体系有三处漏网——DesktopIcons 裸白色线性图标、Spotlight 结果行裸图标、MobileHome 虽有底板但全部 accent 单色渐变（未走 per-app color）。三处共享同一视觉规范，单代理一次收尾。

### 改动概要
- **M11.1 DesktopIcons**：`appList.ts` 五色相常量 `C` 加 export（全系统图标配色单一来源）；新 `desktopTile.ts` 纯函数 `desktopTileColor(n)`——文件夹→blue / 图片→green / 音视频→orange / 代码标记→violet / 兜底 graphite，扩展名清单与 `emojiFor`、`vfs.isAudio/isVideo` 同口径；图标改 44×44 squircle 底板 + 白 Icon(22)，交互零改动。
- **M11.2 Spotlight + MobileHome**：Spotlight 的 app/userapp 结果行加 28×28 迷你底板（`appMeta[id].color`），action/file/calc/ai 保持裸图标；MobileHome 网格 + 托盘背景 accent 单色 → `app.color ?? C.graphite`。

### 关键代码
```ts
// desktopTile.ts：返回 C 常量引用，测试 toBe 严格全等锁死单一来源
export function desktopTileColor(n: Pick<VNode, 'type' | 'name' | 'kind'>): string {
  if (n.type === 'dir') return C.blue;
  const ext = n.name.slice(n.name.lastIndexOf('.') + 1).toLowerCase();
  if (IMG.has(ext)) return C.green;
  if (AV.has(ext)) return C.orange;
  if (CODE.has(ext)) return C.violet;
  return C.graphite;
}
```

### 新增测试
`desktopTile.test.ts` 8 例：文件夹 / 图片 7 扩展名 / 音频 9 / 视频 7 / 代码 7 / 未知扩展名兜底 / 无扩展名兜底 / 大小写不敏感。

### 验证结果
- `npm test`：**12 文件 110 例全绿** ✅
- `npx svelte-check`：**0 错**（5 条 tsconfig 存量警告）✅
- `npm run build`：**成功**（545ms）✅
- Playwright：桌面图标类型分色 ✓ / Spotlight 迷你底板与 Dock 同色 ✓ / 移动端 per-app 色（源码交叉验证）✓

---

## 2026-07-19 · M10「细节精修」（菜单三态 + 边缘贴靠预览）

### 定向过程
对照 macos27/windowos 的浏览器审计初报 10 项差距，逐项核查代码后剔除 2 项误报（红绿灯悬停 ✕/−/+ 图标、Dock 悬停 App 名浮签均已存在），收敛出两项真实缺口：菜单缺三态（Dock 还在用 `'✓ '` 文本 hack、边界项直接消失）、拖窗边缘贴靠缺纯函数化与角落语义。

### 改动概要
- **M10.1 菜单三态**：`menu.svelte.ts` `MenuItem` + `session.svelte.ts` `SessionMenuItem` 新增 `shortcut?/disabled?/checked?`；`ContextMenu.svelte` 渲染三态（✓ 与 icon 同列优先 / disabled 点不动不关菜单 / kbd 右对齐）。`buildSystemMenu`「锁定」标注真实快捷键 Ctrl+⌘Q；`Dock.svelte` onMenu 抽纯函数 `buildDockMenu`（新 `dockMenu.ts`）：「自动隐藏」去 ✓ 文本 hack 改 checked、「左移/右移」边界 disabled 常驻；桌面右键「桌宠」改 checked、F3/? 键位移入 shortcut。
- **M10.2 边缘贴靠预览**：新 `snapPreview.ts` 纯函数库——`detectSnapZone`（边缘 8px / 角落 96px 方块优先 / 顶部 max / 底部不触发）+ `zoneBounds`（唯一几何来源，预览/松手落位/贴靠浮层三路径共用 → 像素级一致）。`Window.svelte` updateSnap 接纯函数 + 四守卫，`tileTo` 删内联表；`Desktop.svelte` 浮层 accent/20 + fade 150ms。TDD 抓出首版角落误判（y≤8 → 96×96 双方块）。

### 关键代码
```ts
// MenuItem 三态（menu.svelte.ts / session.svelte.ts 结构化兼容）
interface MenuItem {
  label: string; icon?: string; onClick: () => void;
  danger?: boolean; separator?: boolean;
  shortcut?: string;  // 右对齐 kbd（只标真实存在的键位）
  disabled?: boolean; // 灰化、点不动、不关菜单
  checked?: boolean;  // Lucide Check 占图标列
}
```
```ts
// detectSnapZone：角落 96px 方块最先判定 → 天然优先于边缘
if (x <= SNAP_CORNER_T && y <= SNAP_CORNER_T) return 'tl';
if (y <= SNAP_EDGE_T) return 'max';
if (x <= SNAP_EDGE_T) return 'left';
// 底部（Dock 区）一律 null
```

### 新增测试（29 例）
- `dockMenu.test.ts` 10 例：左移/右移最左/中间/最右 disabled 矩阵、组前单分割线、autohide checked 无 ✓ 文本、running/pinned 分支
- `session.test.ts` +2 例：锁定 shortcut === 'Ctrl+⌘Q'、系统菜单仅 1 项带快捷键 + App 菜单无 shortcut（不虚构键位）
- `snapPreview.test.ts` 17 例：detectSnapZone 10（8px/96px 阈值边界、角落优先、底部免疫、越界就近）+ zoneBounds 7（奇数宽度不溢出、与 detect 输出联动）

### 验证结果
- `npm test`：**11 文件 102 例全绿** ✅
- `npx svelte-check`：**0 错**（5 条 tsconfig 存量警告）✅
- `npm run build`：**成功**（504ms）✅
- Playwright：系统菜单 Ctrl+⌘Q kbd ✓ / Dock「左移」禁用点击不关菜单 ✓ / 预览框与落位几何一致 ✓
- 并行性：两代理同改 `Desktop.svelte`（右键菜单 vs 预览浮层不同区块），合并回归无冲突 ✅

---

## 2026-07-19 · M9「精致感四件套」（squircle / 弹跳 / 透明顶栏 / 通知动效）

### 改动概要
- **M9.1 squircle 图标底板**：`appList.ts` `AppMeta` 新增 `color` 字段，五色相渐变常量配到每个内置 App；`Dock.svelte` 图标内嵌 `data-dock-tile`（22.37% 圆角 + 三层阴影 + 白 Lucide 图标），`Launchpad.svelte` 同款 64px 放大版，两端视觉统一。
- **M9.2 Dock 启动弹跳**：`Dock.svelte` `bounce(i)` 在 onLaunch 时对 tile 播 WAAPI 关键帧（0 → -30px → 0 → -12px → 0，620ms），移动端/reducedMotion 跳过。
- **M9.3 透明顶栏**：`TopBar.svelte` 去磨砂/分隔线，只留顶部暗渐变 + 文字投影；h-9→h-8，`Desktop.svelte` 窗口层 top-9→top-8；顶栏 emoji 全换 Lucide（仅 🍆 logo 保留）。
- **M9.4 通知弹簧入场**：`Notifications.svelte` 新增 `bannerIn` 过渡（springEasing 320/26，translate 28px + scale .96→1，320ms），面板追加 `qz-glass-float`。

### 关键代码
```svelte
<!-- Dock.svelte：squircle 底板 + 弹跳 -->
<span data-dock-tile class="grid h-11 w-11 place-items-center text-white"
  style="border-radius: 22.37%; background: {app.color ?? C.graphite};
         box-shadow: inset 0 1px 1px rgb(255 255 255 / .28), inset 0 -1px 2px rgb(0 0 0 / .18), 0 2px 6px rgb(0 0 0 / .35);">
  <Icon name={app.icon} size={22} strokeWidth={1.8} /></span>
```
```ts
// bounce：620ms 双段起跳
tile?.animate(
  [{ translate: '0 0' }, { translate: '0 -30px', offset: 0.35 },
   { translate: '0 0', offset: 0.62 }, { translate: '0 -12px', offset: 0.8 }, { translate: '0 0' }],
  { duration: 620, easing: 'cubic-bezier(0.2, 0.6, 0.35, 1)' });
```
```ts
// bannerIn：弹簧 easing 从右滑入
easing: springEasing({ stiffness: 320, damping: 26 }),
css: (t) => `opacity: ${t}; translate: ${(1 - t) * 28}px 0; scale: ${0.96 + 0.04 * t};`
```

### 修复
- `QuickSettings.svelte:40` 构建错误：`class:bg-white/15={open}` 的 `class:` 指令不支持带 `/` 的 Tailwind 类名（rolldown 报 Expected token >）→ 改为 class 字符串内联条件 `{open ? 'bg-white/15' : ''}`。全库 grep 确认仅此一处。

### 验证结果
- `npm test`：**9 文件 73 例全绿** ✅
- `npx svelte-check`：**0 错**（5 条 tsconfig 存量警告）✅
- `npm run build`：**成功**（506ms，index 425.44kB gzip 140.99kB）✅
- Playwright 视觉验证：**四项全过** ✅（squircle 五色渐变底板 / 点击「文件」弹跳帧 / 顶栏透壁纸 / 「提醒」触发通知横幅动画）

---

## 2026-07-18 · M8「UI 打磨」（参考 macos27 / windowos 调研）

### 调研输入
两站 Playwright 实测提取的关键配方：
- **macos27**（Liquid Glass）：活动窗 `0 24px 72px rgba(0,0,0,.35)` / 非活动 `0 10px 34px .22` 双阴影景深；Dock 三层阴影（inset 顶部镜面高光 + 0.5px 发丝描边 + 投影）；红绿灯 12px、官方三色、inset 体积感、非活动灰化；菜单 menuIn（opacity + scale(0.97) + translateY(-4px)）。
- **windowos**（Fluent）：激活/非激活双层叠加阴影；1px 半透明描边；Motion token 化。

### 改动概要
- **M8.1 窗口双阴影**：`app.css` 新增 `--qz-shadow-window-active/inactive` token；`Window.svelte` 去 `shadow-2xl` 改 `style:box-shadow` 按 active 消费，`winTransition` 追加 `box-shadow` 过渡（聚焦/失焦平滑切换）。
- **M8.2 悬浮面板三层阴影**：新增 `--qz-shadow-glass-float`（inset 镜面高光 + 发丝描边 + 投影）+ `@utility qz-glass-float`；8 处面板换用（Dock/Spotlight/ContextMenu/QuickSettings/通知中心/Shortcuts/移动 Dock 托盘/关机确认框）。
- **M8.3 红绿灯**：`WindowControls` 新增 `active` prop；桌面端 12px（h-3 w-3）；inset 体积感内阴影；非活动窗三灯灰化 `#8e8e93` 带 transition。
- **M8.4 菜单动效**：`motion.ts pop()` 新增 `offsetY` 参数（独立 `translate` 属性，不与窗口定位 transform 打架）；ContextMenu 120ms + offsetY -4 下落感。

### 关键代码
```css
/* 活动窗三层复合阴影：环境影 + 接触影 + 0.5px 边缘定义线 */
--qz-shadow-window-active:
  0 24px 72px rgb(0 0 0 / 0.35),
  0 2px 12px rgb(0 0 0 / 0.18),
  0 0 0 0.5px rgb(0 0 0 / 0.25);
```
```svelte
<!-- Window.svelte：聚焦 ⇄ 失焦阴影平滑过渡 -->
style:box-shadow={active ? 'var(--qz-shadow-window-active)' : 'var(--qz-shadow-window-inactive)'}
```

### 验证结果
- `npm test`：**9 文件 73 例全绿** ✅
- `npm run check`：**0 错 0 警** ✅
- `npm run build`：**成功**（553ms，index 423.55kB gzip 140.44kB）✅

---

## 2026-07-18 · M7「AI 命令面板」（Spotlight 内联 agent）

### 改动概要
- **M7.1 预设共用层**：`aiConfig.svelte.ts` 新增 `AI_PRESETS` 三预设（设备清单：本地 GLM-4.6V `/aiproxy/v1` 免 key / 工作站 minimax `/aiproxy/lm/v1` 取环境 key / Anthropic Opus 官方）+ `applyAiPreset`（一键套用）+ `matchPreset`（命中判定）；`AiPreset.short` 短名字段供紧凑 chips。`Settings.svelte` 删本地实现改 import，与 Spotlight 同语义。
- **M7.2 Spotlight AI 模式**：搜索结果末尾「问 AI」→ 面板内 agent loop（`runAgent`），不再开助手窗。头部模型来源 chips 一键切换 + 激活高亮 + 对话接力助手（推入全局 `chat.msgs` → `openApp('assistant')`）；对话区流式回显 text/tool/error 三事件，工具调用打标签；输入区 Enter 发送 / busy 禁用 + 停止按钮 abort。键盘语义：AI 模式 Esc 窗口级退搜索态；`Desktop.svelte` onKey 新增 `spotlight.open` 短路，面板开着全局快捷键让路，防 Esc 误关背后窗。

### 新增测试
`src/system/aiConfig.test.ts` +5 例（累计 7 例）核心断言：
```ts
// 本地预设：不动现有 key
applyAiPreset(cfg, AI_PRESETS[0]);
expect(cfg.baseURL).toBe('/aiproxy/v1');
expect(cfg.apiKey).toBe('user-key'); // 原 key 保留
// 工作站预设：有环境 key 用之，无则保留
applyAiPreset(cfg, AI_PRESETS[1]);
expect(cfg.apiKey).toBe(ENV_AI_KEY || 'user-key');
// matchPreset：三字段全等命中，任一不符 null
expect(matchPreset({ provider: 'openai', baseURL: '/aiproxy/v1', model: 'zai-org/glm-4.6v-flash' })?.label).toContain('GLM');
expect(matchPreset({ provider: 'openai', baseURL: '/aiproxy/v1', model: 'other' })).toBeNull();
```

### 验证结果
- `npm test`：**9 文件 73 例全绿** ✅（motion19/session16/icons8/gesture7/settings6/aiConfig7/exposeThumb6/onboarding2/processes2）
- `npm run check`：**0 错 0 警** ✅
- `npm run build`：**成功**（490ms，index 422.98kB gzip 140.28kB）✅

---

## 2026-07-18 · M6「UI 全面改造修复」（F1–F8）

### 改动概要
- **F1 移动端点击穿透（阻断）**：`Desktop.svelte` 窗口层加 `pointer-events-none`；`Window.svelte` 窗口自身 `style:pointer-events` 显式 `'auto'`。
- **F2 桌面端菜单点击**：与 F1 同根因，修复后系统/应用/右键菜单均恢复。
- **F3 z-index 层级**：`processes.svelte.ts` 新增 `normalizeZ`（≥500 重编为 1..n）+ `allocZ`；六处 `++nextZ` 全换 `allocZ`。
- **F4 Exposé 缩略图**：新增 `exposeThumb.ts` 纯函数 `fitThumb` + `Expose.svelte` 重写（真实宽高比迷你窗 + Lucide 图标 + 最小化角标）。
- **F5 右键菜单增强**：`settings.svelte.ts` 抽 `nextWallpaper()` 共享；`Desktop.svelte` 加「整理桌面图标/更换壁纸/个性化设置」，图标全换 Lucide。
- **F6 移动端排版**：`WindowControls.svelte` 移动端真实尺寸 `h-5 w-5`（去 scale 遮挡标题）；移动端不渲染贴靠浮层。
- **F7 对齐/间距**：截图验证无需改动。

### 新增测试
`src/kernel/processes.test.ts`（2 例）核心断言：
```ts
// 新窗口置顶，focus 提升层级
expect(b.z).toBeGreaterThan(a.z);
focus(a.id);
expect(a.z).toBeGreaterThan(b.z);
// 600 次 focus 后 z 值有界（normalizeZ 触发）且相对顺序保持
for (let i = 0; i < 600; i++) focus(c.id);
expect(Math.max(...processes.map((p) => p.z))).toBeLessThan(600);
expect(c.z).toBeGreaterThan(b.z);
```
`src/shell/exposeThumb.test.ts`（5 例，子代理新增）：宽受限/高受限/小窗不放大/默认上限/非法尺寸兜底。

### 验证结果
- `npm test`：**9 文件 68 例全绿** ✅
- `npm run check`：**0 错 0 警** ✅
- `npm run build`：**成功**（475ms，index 417.59kB gzip 138.81kB）✅
- Playwright 实测截图：`f1-home/f1-files-open`（穿透修复）、`f2-sysmenu/f2b-appmenu/f2b-desktop-ctx`（菜单恢复）、`f6-settings`（移动端标题完整）、`f7-login/f7-desktop`（布局正常）。

---

## 2026-07-18 · M1「视觉地基」（U1 图标 / U2 玻璃 / U3 字体）

### 改动概要
- **U1**：`src/lib/icons.ts` + `src/lib/iconRegistry.ts` + `src/lib/Icon.svelte` 三层图标体系；全部非禁碰 shell/apps 组件的 emoji 渲染替换为 `<Icon name>`；存量数据（appList/MenuItem/文件类型）保留 emoji 存储键。
- **U2**：`qz-glass` 升级（saturate 160% + sheen 内高光 + `--qz-glass-backdrop` token）；`settings.glassRefraction`（默认关）；`App.svelte` 内联 `#qz-glass-refraction` SVG 滤镜；Settings 开关 UI。
- **U3**：`FONT_FAMILIES` 加 Inter；`app.css` @import Google Fonts Inter 可变字重。

### 新增测试
`src/lib/icons.test.ts`（6 例）核心断言：
```ts
expect(iconName('🗑️')).toBe('Trash2');
expect(normalizeIconKey('🗑️')).toBe('🗑');      // VS16 剥离
expect(iconName('ZoomIn')).toBe('ZoomIn');       // Lucide 名直通
expect(iconName('🦄')).toBe(FALLBACK_ICON);      // 未识别 → 兜底
// 抽样 80+ 真实 emoji 键：全部显式映射命中且落在 ICON_NAMES 内
expect(mappedIconName(e)).toBeDefined();
```
`src/system/settings.test.ts`（6 例）核心断言：
```ts
expect(FONT_FAMILIES.find((f) => f.id === 'inter')!.stack).toMatch(/^"Inter",/);
expect(fontStack('no-such-font')).toBe(FONT_FAMILIES[0].stack); // 未知 id 回退
expect(SETTINGS_KEYS).toContain('glassRefraction');
```

### 执行结果
```
npx vitest run
 ✓ src/shell/mobile/gesture.test.ts (5 tests)
 ✓ src/lib/icons.test.ts (6 tests)
 ✓ src/system/settings.test.ts (6 tests)
 Test Files  3 passed (3) · Tests  17 passed (17)

npm run check  → svelte-check found 0 errors and 0 warnings（tsc node 侧亦通过）
npm run build  → ✓ built in 464ms（dist 产物正常，无新增警告）
```

### 备注
- 测试初跑 1 例失败：`🧩→Puzzle` 恰等于 `FALLBACK_ICON`，断言「不回退兜底」误判 → 改用 `mappedIconName` 判显式映射命中后全绿（测试断言修正，非产品代码问题）。
- 禁碰文件（index.html / Desktop / TopBar / Dock / Window / WindowControls / DEVPLAN-UIUX.md）未改动，其中 emoji 由并行负责方处理。
- 玻璃折射为实验项（`backdrop-filter: url()` 仅 Chromium），默认关闭；视觉效果需真机目检。

---

## 2026-07-18 · M2「动效」（U4 弹簧化 / U5 Genie 神灯最小化 / U6 Dock 放大波形）

### 改动概要
- **U4 弹簧化**：`src/lib/motion.ts` 新增 `springEasing`（阻尼谐振子解析解，欠/临界/过阻尼三分支，归一化严格 0→1）与 `springSettleTime`；`pop` 开窗过渡换真弹簧（opacity clamp 防 overshoot 越界，只动 opacity + 独立 scale 属性）。`Window.svelte`：吸附/贴靠/最大化落位走 `kickSettle`（先挂 `SPRING_BEZIER` 260ms 几何过渡、再同渲染批 `setBounds`）；桌面最大化从 `inset:0` 改为与窗口态同构的 `translate+width/height:100%`（px↔% 可插值），最大化⇄还原才能走同一条过渡；抓起窗口即撤过渡。`WindowControls.svelte` 新增可选 `onToggleMax` 回调。
- **U5 Genie 神灯（F10 清账）**：`motion.ts` 新增 `genieClipPath`（梯形插值纯函数：顶边 14% 塞子对靶、底角 t^0.6 先捏 → 中点漏斗）、`genieFrame`（吸入 translate + scale→12% + 尾段 t² 淡出，t=1 opacity 恰 0 无跳变交接）、`dockIconPos` + `trackDockIcon` action（Dock 上报图标屏幕中心）。`Window.svelte` 用 `$effect.pre` 监听 `proc.minimized` 翻转统一触发（红绿灯/菜单/Dock/快捷键全源覆盖），rAF 直驱 500ms cubicInOut 帧（transition:none 防拖帧），中途反向从 `genieT` 接续，结束帧清 clip-path。降级：移动端 / reducedMotion / 无 Dock 坐标 → 既有缩放淡出；会话还原的最小化窗不播。
- **U6 Dock 波形**：`Dock.svelte` 从阶梯 scale 改 `magnify(d,σ,maxAmp)` 高斯衰减（σ=57.6、maxAmp=0.5）；`onpointermove` 记 mouseX、`bind:this` 量图标中心；对称 `margin-inline` 把放大量摊回布局 → 相邻图标平滑推开（负反馈不抖）。移动端/reducedMotion/拖拽重排禁用。

### 新增测试
`src/lib/motion.test.ts`（19 例）核心断言：
```ts
// 弹簧：欠阻尼有 overshoot 且尾段收敛；过阻尼单调无回弹
expect(peak).toBeGreaterThan(1.05); expect(peak).toBeLessThan(1.3);
expect(Math.abs(e(0.98) - 1)).toBeLessThan(0.05);
// magnify：中心峰值 / 远距趋 1（d=200 避开浮点下溢）/ 单调衰减
expect(magnify(0, SIGMA, 0.5)).toBeCloseTo(1.5);
expect(magnify(56, SIGMA, 0.5)).toBeGreaterThan(1.1);   // 相邻格仍可感知
expect(magnify(112, SIGMA, 0.5)).toBeLessThan(1.05);    // 第三格基本回 1
// genieClipPath：t=1 底边收尖对靶、顶边留 14% 塞子；中点上宽下窄漏斗
expect(bl).toBeCloseTo(30); expect(br).toBeCloseTo(30);
expect(tr - tl).toBeCloseTo(14, 0);
expect(topW).toBeGreaterThan(botW);
// genieFrame：t=1 窗口中心精确落靶、opacity 恰 0（交接最小化态无跳变）
expect(win.x + win.w / 2 + f.dx).toBeCloseTo(target.x);
expect(f.opacity).toBe(0);
```

### 执行结果
```
npx vitest run
 ✓ src/shell/mobile/gesture.test.ts (5 tests)
 ✓ src/lib/icons.test.ts (6 tests)
 ✓ src/lib/motion.test.ts (19 tests)
 ✓ src/system/settings.test.ts (6 tests)
 ✓ src/system/session.test.ts (16 tests)
 Test Files  5 passed (5) · Tests  52 passed (52)

npm run check  → svelte-check found 0 errors and 0 warnings（tsc node 侧亦通过）
npm run build  → ✓ built in 446ms（dist 产物正常，无新增警告）
```

### 备注
- 过渡时序坑：`settling`（挂 transition）必须与几何 `setBounds` 在同一渲染批提交，浏览器才会对这次变化做过渡——所以是 `kickSettle()` 在前、`setBounds` 紧随，不能拆到 $effect 里后置。
- 神灯首帧用 `$effect.pre`（DOM 提交前起动画）：普通 $effect 会让「content-visibility:hidden + 淡出」先画一帧才被神灯接管，闪空窗。
- `wasMin` 基线写成 `boolean | undefined` 首帧赋值（而非 `= proc.minimized` 初始捕获），消掉 svelte-check 的 state_referenced_locally 警告；会话还原的最小化窗也因此不播神灯。
- 并行 M3 顺带修了 M2 两处（见其章节）：神灯底角捏合指数 t^1.4→t^0.6（中点恢复漏斗）、magnify 远距断言 400px→200px（避浮点下溢）。
- ⏳ 神灯吸入流畅度、弹簧回弹手感、Dock 波形跟手性无法无头验证，待真机目检。

---

## 2026-07-18 · M3「仪式感」（U7 开机/登录/锁屏 + U8 顶栏菜单）

### 改动概要
- **U7**：新建 `src/system/session.svelte.ts` 会话状态机（`boot→login→desktop⇄locked`，TRANSITIONS 白名单迁移，非法一律幂等拒绝）；新建 `src/shell/boot/` 三组件（BootScreen 1.5s 进度条可跳过 / LoginScreen 用户列表点选 / LockScreen 两端统一：上滑·点击·任意键解锁）；`App.svelte` 按 phase 渲染，desktop 与 locked 共用同一 Desktop 实例（锁定只盖锁屏，窗口原样保留）；Desktop 键盘守卫（locked 吞全局快捷键 + Ctrl/Cmd+Q 锁定）；Settings 加「系统」小节（skipBoot）；MobileControlCenter 加锁定按钮；`mobileUi.svelte.ts` 移除旧移动端 locked 态并入状态机。
- **U8**：TopBar 🍆 → 系统菜单（关于本机/启动台/锁定/睡眠/重新启动/关机），右侧粗体活动 App 名 → App 菜单（关于/关闭窗口/全部最小化/隐藏其他）；`menu.svelte.ts` 新增 `openMenuAt` 定点开菜单；关机走「确认框 → 黑屏已关机 → 点击/按键 reload」三段。
- **顺带修 M2 遗留**：`motion.ts` 神灯 clip 底角捏合指数 `t^1.4→t^0.6`（中点恢复上宽下窄漏斗）；`motion.test.ts` 适配 Svelte 5 过渡 css 单参签名、magnify 远距断言避开浮点下溢（400px→200px）。

### 新增测试
`src/system/session.test.ts`（16 例）核心断言：
```ts
// 状态机：非法迁移拒绝（返回 false 且状态不变）
expect(transition('desktop')).toBe(false); // boot→desktop 跳过登录
expect(session.phase).toBe('boot');
// 合法全链
expect(transition('login')).toBe(true);
expect(transition('desktop')).toBe(true);
expect(transition('locked')).toBe(true);
// lock/unlock 仅 desktop⇄locked，其它阶段静默拒绝
lock(); expect(session.phase).toBe('boot');
// 关机确认三步
askShutdown(); expect(powerConfirm.open).toBe(true);
confirmShutdown();
expect(powerConfirm.open).toBe(false); expect(power.off).toBe(true);
// 菜单构建为纯函数：注入回调 → 按声明顺序触发
for (const item of buildSystemMenu(a)) item.onClick();
expect(calls).toEqual(['about', 'launchpad', 'lock', 'sleep', 'restart', 'shutdown']);
// 无活动窗回退只剩「关于本机」，aboutApp 收 null
expect(buildAppMenu(null, a)).toHaveLength(1);
```

### 执行结果
```
npx vitest run
 ✓ src/shell/mobile/gesture.test.ts (5 tests)
 ✓ src/lib/icons.test.ts (6 tests)
 ✓ src/lib/motion.test.ts (19 tests)
 ✓ src/system/settings.test.ts (6 tests)
 ✓ src/system/session.test.ts (16 tests)
 Test Files  5 passed (5) · Tests  52 passed (52)

npm run check  → svelte-check found 0 errors and 0 warnings（tsc node 侧亦通过）
npm run build  → ✓ built in 502ms（dist 产物正常，无新增警告）
```

### 备注
- `<svelte:window>` 不能放在 `{#if}` 块内（Svelte 5 限制）→ LockScreen 的任意键解锁改为组件顶层挂监听、handler 内用 `session.phase !== 'locked'` 守卫。
- 会话态不持久化：浏览器刷新 = 重新开机（每次从 boot 重来）是有意设计；`sessionPrefs.skipBoot` 用独立 `qz.session` 持久化键，不入 SETTINGS_KEYS 主题白名单（不随主题导入/导出）。
- 锁定/睡眠在 Web 端语义合并（都进锁屏）；登录暂无密码/PIN（预留位）。
- ⏳ 开机/登录/锁屏视觉与手势、关机黑屏无法无头验证，待真机目检。

---

## 2026-07-18 · M4「收尾」（U9 控制中心化 + U10 首秀引导 + M5.8 长按菜单 + 图标去重）

### 改动概要
- **U9**：`src/shell/QuickSettings.svelte` 从小下拉升级为 macOS 风格控制中心——毛玻璃大面板（顶栏 ⚙️ 右上弹出，w-80），分区圆角卡片：连接区（AI 在线/勿扰 2×2 大色块 toggle）· 显示区（明暗四段 + 界面缩放滑块）· 声音区（开关 + 音量）· 外观区（主色 swatch + 下一张壁纸）。状态全部复用 settings/dnd/soundPrefs/aiConfig（与 MobileControlCenter 同源）；`aiConfig.svelte.ts` 抽出 provider 感知纯函数 `aiReady`（openai 可空 key / anthropic 必填），两端控制中心共用。顶栏 ⚙️ 入口不变。
- **U10**：新建 `src/system/onboarding.svelte.ts`（`onboardPrefs` 持久化键 `qz.onboarded` + `shouldShowOnboard` 纯函数 + open/finish）与 `src/shell/Onboarding.svelte` 全屏三页引导（这是什么 → AI 能做什么[附「去设置 AI」] → 快捷键速查，可跳过）。`Desktop.svelte` onMount 首启门控由「开 Welcome 窗」改为 `shouldShowOnboard` 判定 → 未完成开全屏引导；完成/跳过写标记后不再弹、也不再自动开 Welcome（Welcome App 保留手动打开）。Desktop 键盘守卫：引导开着时 Esc/Enter=完成并吞其它键；z-10002 低于锁屏 → 移动端首启解锁后才露出，boot/login 阶段绝不弹出。
- **M5.8**：`gesture.ts` 新增长按纯函数（`LONG_PRESS_MS=500` / `LONG_PRESS_TOLERANCE=10` / `isLongPress` / `longPressCancelled`）；`MobileHome.svelte` 网格+托盘图标长按 → `openMenuAt` 唤起全局 ContextMenu（打开/最小化全部/关闭全部/固定·移除，与 Dock 右键同款项），位移超容差/抬起/取消清计时，`menuFired` 吞掉长按后的 click；`DesktopIcons.svelte` 菜单项抽成 `iconMenuItems`（右键与长按共用），长按触发即退出拖拽态再开菜单。
- **清理**：`src/shell/mobile/appIcons.ts` 并入 `src/lib/icons.ts`（`APP_TO_ICON` 17 个内置 App + `appIconName`，未知 appId 回退 AppWindow），MobileHome 改 import 来源，appIcons.ts 删除——全系统图标数据层收敛为唯一一处。

### 新增测试
`src/system/onboarding.test.ts`（2 例）+ `src/system/aiConfig.test.ts`（2 例）核心断言：
```ts
// 首秀门控：无标记/未完成 → 展示；已完成 → 不展示
expect(shouldShowOnboard(undefined)).toBe(true);
expect(shouldShowOnboard(null)).toBe(true);
expect(shouldShowOnboard({ done: false })).toBe(true);
expect(shouldShowOnboard({ done: true })).toBe(false);
// aiReady：provider 感知（openai 空 key 在线；anthropic 必填非空白 key）
expect(aiReady({ provider: 'openai', apiKey: '' })).toBe(true);
expect(aiReady({ provider: 'anthropic', apiKey: '   ' })).toBe(false);
expect(aiReady({ provider: 'anthropic', apiKey: 'sk-ant-xxx' })).toBe(true);
```
`gesture.test.ts` +2 例、`icons.test.ts` +2 例核心断言：
```ts
expect(isLongPress(LONG_PRESS_MS - 1)).toBe(false);
expect(isLongPress(LONG_PRESS_MS)).toBe(true);
expect(longPressCancelled(LONG_PRESS_TOLERANCE, -LONG_PRESS_TOLERANCE)).toBe(false); // 恰在容差边界
expect(longPressCancelled(LONG_PRESS_TOLERANCE + 1, 0)).toBe(true);
expect(appIconName('welcome')).toBe('Rocket');       // 与 emoji 键 🍆 同语义
expect(appIconName('no-such-app')).toBe('AppWindow'); // 用户 App 回退
```

### 执行结果
```
npx vitest run
 ✓ src/shell/mobile/gesture.test.ts (7 tests)
 ✓ src/lib/icons.test.ts (8 tests)
 ✓ src/lib/motion.test.ts (19 tests)
 ✓ src/system/aiConfig.test.ts (2 tests)
 ✓ src/system/onboarding.test.ts (2 tests)
 ✓ src/system/settings.test.ts (6 tests)
 ✓ src/system/session.test.ts (16 tests)
 Test Files  7 passed (7) · Tests  60 passed (60)

npm run check  → svelte-check found 0 errors and 0 warnings（tsc node 侧亦通过）
npm run build  → ✓ built in 513ms（dist 产物正常，无新增警告）
```

### 备注
- 移动端首启流程 boot→locked 会让 Desktop 在锁屏阶段就挂载（onMount 触发引导）——引导 z-10002 刻意低于锁屏 z-10003，先藏于锁屏下、解锁自然露出；桌面端 login 后才挂 Desktop，无此时序问题。
- 长按与点击共存的坑：长按触发菜单后，随后的 pointerup 仍会派生 click → 用 `menuFired` 标记在 `onTap` 头部吞掉一次，防误开 App。
- DesktopIcons 长按触发时先 `dragId=null` 退出拖拽态再开菜单，避免「菜单开着、图标还在跟手」。
- `qz.onboarded` 独立持久化键，不入 SETTINGS_KEYS 主题白名单（不随主题导入/导出），随 qz.* 云同步。
- ⏳ 控制中心面板观感、三页引导排版、长按手感（500ms/10px 阈值）无法无头验证，待真机目检。
