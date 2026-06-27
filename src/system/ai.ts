import type Anthropic from '@anthropic-ai/sdk';
import { aiConfig } from './aiConfig.svelte';
import { TOOL_DEFS, executeTool } from './aiTools';

// ───────────────────────────────────────────────────────────
// AI 引擎 · 双协议（Anthropic / OpenAI 兼容）
//   runAgent  —— 带工具的 agent loop：调模型 → 要用工具就执行并回灌 → 再调，直到收尾。
//                「AI 底层驱动系统」走这条。
//   complete  —— 单轮补全（无工具）：给各 App 内嵌 AI 功能用（记事本润色/总结/续写…）。
// 协议差异全封在引擎内部，上层只给纯文本对话（ChatTurn），不用关心 provider。
// ───────────────────────────────────────────────────────────

export type AiEvent =
  | { type: 'text'; text: string } // 正文增量
  | { type: 'reasoning'; text: string } // 推理模型的「思考」增量（如 minimax）
  | { type: 'tool'; name: string } // 调了某个工具
  | { type: 'error'; message: string };

// 一条对话消息（文本 + 可选图片；工具上下文由引擎内部维护）
// images：data URL 数组（data:image/...;base64,...）。仅 user 消息有意义，喂给视觉模型。
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
}

const DEFAULT_SYSTEM_PROMPT = `你是 QieZiOS（一个跑在浏览器里的桌面系统 🍆）的内置 AI 助手。
你可以用提供的工具实际操作这个系统：启动 App、增删改文件、改外观主题。
当用户的请求需要操作系统时，直接调用相应工具去做，再用简短中文说明你做了什么。
启动 App 前先用 list_apps 查 id。回答简洁、口语化、用中文。`;

function buildSystem(): string {
  const persona = aiConfig.systemPrompt?.trim();
  return persona ? `${DEFAULT_SYSTEM_PROMPT}\n\n${persona}` : DEFAULT_SYSTEM_PROMPT;
}

// ── 对外 1：agent loop（带工具，驱动系统） ──────────────────
export async function runAgent(
  history: ChatTurn[],
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // 只有 Anthropic 官方 API 强制要 key；OpenAI 兼容端点可能无鉴权（本地 LM Studio / Ollama 等）
  if (aiConfig.provider === 'anthropic' && !aiConfig.apiKey) {
    onEvent({ type: 'error', message: '请先在「设置 → AI」里填入 API Key' });
    return;
  }
  try {
    if (aiConfig.provider === 'openai') await runOpenAIAgent(history, buildSystem(), onEvent, signal);
    else await runAnthropicAgent(history, buildSystem(), onEvent, signal);
  } catch (e) {
    if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return; // 主动停止：不当错误
    onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

// ── 对外 2：单轮补全（无工具，给各 App 内嵌 AI 用） ──────────
// system：本次任务的系统提示（直接替换，不叠加助手人设 → 结果可控）。
// onText：流式增量回调。返回完整文本。出错/中止会抛，调用方自行 catch。
export async function complete(
  prompt: string,
  opts: { system?: string; onText?: (t: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  if (aiConfig.provider === 'anthropic' && !aiConfig.apiKey) throw new Error('请先在「设置 → AI」里填入 API Key');
  const system = opts.system?.trim() || '你是一个有用的中文写作助手。';
  if (aiConfig.provider === 'openai') return completeOpenAI(prompt, system, opts.onText, opts.signal);
  return completeAnthropic(prompt, system, opts.onText, opts.signal);
}

// ─────────────────────────── Anthropic ───────────────────────────
async function loadAnthropic() {
  // 懒加载 SDK：只有第一次用 AI 时才下载这个 chunk（首屏不背它）
  const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
  return new AnthropicClient({
    apiKey: aiConfig.apiKey,
    baseURL: aiConfig.baseURL?.trim() || undefined, // 留空走官方
    dangerouslyAllowBrowser: true,
  });
}

// 把一条对话消息转成 Anthropic content：带图的 user 消息拼成「文本块 + 图片块」
type AnthropicMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
function anthropicContent(m: ChatTurn): string | Anthropic.ContentBlockParam[] {
  if (m.role === 'user' && m.images && m.images.length) {
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const url of m.images) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (match) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: match[1] as AnthropicMediaType, data: match[2] },
        });
      }
    }
    return blocks;
  }
  return m.content;
}

async function runAnthropicAgent(
  history: ChatTurn[],
  system: string,
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
) {
  const client = await loadAnthropic();
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: anthropicContent(m),
  }));
  for (let turn = 0; turn < 8; turn++) {
    if (signal?.aborted) break;
    const stream = client.messages.stream(
      {
        model: aiConfig.model || 'claude-opus-4-8',
        max_tokens: aiConfig.maxTokens || 8000,
        system,
        tools: TOOL_DEFS as Anthropic.Tool[],
        messages,
      },
      { signal },
    );
    stream.on('text', (t) => onEvent({ type: 'text', text: t }));
    const msg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason !== 'tool_use') break;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        onEvent({ type: 'tool', name: block.name });
        const r = await executeTool(block.name, block.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(r) });
      }
    }
    messages.push({ role: 'user', content: results });
  }
}

async function completeAnthropic(
  prompt: string,
  system: string,
  onText?: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const client = await loadAnthropic();
  const stream = client.messages.stream(
    {
      model: aiConfig.model || 'claude-opus-4-8',
      max_tokens: aiConfig.maxTokens || 8000,
      system,
      messages: [{ role: 'user', content: prompt }],
    },
    { signal },
  );
  if (onText) stream.on('text', (t) => onText(t));
  const msg = await stream.finalMessage();
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// ────────────────────── OpenAI 兼容（fetch + SSE） ──────────────────────
interface OAToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
// OpenAI 多模态：user content 可以是字符串，或「文本+图片」分块数组
type OAContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
type OAMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OAContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OAToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

// 把上层对话（ChatTurn）转成 OpenAI 消息：带图的 user 消息拼成多模态分块
function historyToOA(history: ChatTurn[]): OAMessage[] {
  return history.map((m): OAMessage => {
    if (m.role === 'user' && m.images && m.images.length) {
      const parts: OAContentPart[] = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const url of m.images) parts.push({ type: 'image_url', image_url: { url } });
      return { role: 'user', content: parts };
    }
    if (m.role === 'user') return { role: 'user', content: m.content };
    return { role: 'assistant', content: m.content };
  });
}

function chatUrl(): string {
  const base = (aiConfig.baseURL || '').trim().replace(/\/+$/, '');
  return base + '/chat/completions';
}
function openaiToolDefs() {
  return TOOL_DEFS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// 工具调用签名（名字 + 顶层参数键排序后的 JSON）→ 同名同参视为同一次调用，用来识别打转
function toolSignature(name: string, args: Record<string, unknown>): string {
  let argStr = '{}';
  try {
    argStr = JSON.stringify(args, Object.keys(args).sort());
  } catch {
    /* 参数无法序列化：忽略，只按名字算 */
  }
  return `${name}:${argStr}`;
}

const MAX_AGENT_TURNS = 8;
const TOOL_REPEAT_LIMIT = 2; // 同名同参允许执行的次数；第 3 次起判定打转、不再执行

async function runOpenAIAgent(
  history: ChatTurn[],
  system: string,
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
) {
  const messages: OAMessage[] = [{ role: 'system', content: system }, ...historyToOA(history)];
  const tools = openaiToolDefs();
  const callCounts = new Map<string, number>(); // 工具调用签名 → 已执行次数（防打转）
  let forceFinish = false; // 触发后下一轮去掉 tools，逼模型用已有结果给最终答复

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    if (signal?.aborted) break;
    // 最后一轮 或 已判定打转：不再提供工具 → 模型只能输出文字收尾（不会再发起工具调用）
    const offerTools = !forceFinish && turn < MAX_AGENT_TURNS - 1;
    const { content, toolCalls } = await streamOpenAI(
      messages,
      offerTools ? tools : undefined,
      onEvent,
      signal,
    );
    const asst: OAMessage = { role: 'assistant', content: content || null };
    if (toolCalls.length) asst.tool_calls = toolCalls;
    messages.push(asst);
    if (!toolCalls.length) break; // 出文本、无工具调用 → 收工

    let allRedundant = true; // 这一轮是否「全是重复调用」（是 → 下轮强制收尾）
    for (const tc of toolCalls) {
      onEvent({ type: 'tool', name: tc.function.name });
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        /* 参数损坏：当空对象 */
      }
      const sig = toolSignature(tc.function.name, args);
      const seen = callCounts.get(sig) ?? 0;
      if (seen >= TOOL_REPEAT_LIMIT) {
        // 同工具同参已调过多次：不再执行，回灌一句提示打断打转
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: '（你已多次以相同参数调用该工具，结果见上文。请勿重复调用，直接据此给出最终回答。）',
        });
      } else {
        callCounts.set(sig, seen + 1);
        allRedundant = false;
        const r = await executeTool(tc.function.name, args);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(r) });
      }
    }
    if (allRedundant) forceFinish = true; // 整轮都是重复调用 → 下一轮摘掉工具逼它作答
  }
}

async function completeOpenAI(
  prompt: string,
  system: string,
  onText?: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const messages: OAMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ];
  const { content } = await streamOpenAI(
    messages,
    undefined,
    (e) => {
      if (e.type === 'text' && onText) onText(e.text);
    },
    signal,
  );
  return content;
}

// 某些模型（如 GLM）会用 <|begin_of_box|>…<|end_of_box|> 等控制标记包裹答案，
// 这些不该显示给用户。下面在流式输出时安全地剥掉它们（含跨分片拆开的标记）。
function stripBoxTokens(s: string): string {
  return s.replace(/<\|[^|]*\|>/g, '');
}
// 把已累积文本切成「可安全输出」与「暂留」两段：结尾若有未闭合的 <|… 或孤立 <，先留着等后续分片
function safeFlushBoundary(s: string): string {
  const open = s.lastIndexOf('<|');
  if (open !== -1 && s.indexOf('|>', open) === -1) return s.slice(0, open);
  if (s.endsWith('<')) return s.slice(0, -1);
  return s;
}
// 比对「已清洗文本」和「已输出长度」，把新增的干净文本推给 onEvent，返回新的已输出长度。
// final=true 时连暂留尾巴一起输出（流结束，不再有后续分片）。
function flushCleanText(
  raw: string,
  emittedLen: number,
  onEvent: (e: AiEvent) => void,
  final = false,
): number {
  const cleaned = stripBoxTokens(final ? raw : safeFlushBoundary(raw));
  if (cleaned.length > emittedLen) {
    onEvent({ type: 'text', text: cleaned.slice(emittedLen) });
    return cleaned.length;
  }
  return emittedLen;
}

// 跑一次流式请求：累积正文 + 工具调用（增量按 index 拼），推理增量实时推给 onEvent。
async function streamOpenAI(
  messages: OAMessage[],
  tools: ReturnType<typeof openaiToolDefs> | undefined,
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: OAToolCall[] }> {
  const res = await fetch(chatUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiConfig.apiKey}` },
    body: JSON.stringify({
      model: aiConfig.model || 'minimax/minimax-m2.7',
      max_tokens: aiConfig.maxTokens || 8000,
      stream: true,
      messages,
      ...(tools && tools.length ? { tools } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${detail ? ' · ' + detail.slice(0, 300) : ''}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = ''; // 原始累积（含控制标记）
  let emittedLen = 0; // 已通过 onEvent 输出的「清洗后」字符数
  const toolCalls: OAToolCall[] = [];

  try {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        flushCleanText(content, emittedLen, onEvent, true); // 收尾：吐出暂留尾巴
        return { content: stripBoxTokens(content), toolCalls: finalizeToolCalls(toolCalls) };
      }
      let json: {
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        emittedLen = flushCleanText(content, emittedLen, onEvent); // 安全剥离控制标记后再输出
      }
      if (delta.reasoning_content) onEvent({ type: 'reasoning', text: delta.reasoning_content });
      if (Array.isArray(delta.tool_calls)) {
        for (const d of delta.tool_calls) {
          const idx = d.index ?? 0;
          let tc = toolCalls[idx];
          if (!tc) tc = toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (d.id) tc.id = d.id;
          if (d.function?.name) tc.function.name += d.function.name;
          if (d.function?.arguments) tc.function.arguments += d.function.arguments;
        }
      }
    }
  }
  flushCleanText(content, emittedLen, onEvent, true); // 流自然结束也收尾
  return { content: stripBoxTokens(content), toolCalls: finalizeToolCalls(toolCalls) };
  } finally {
    // [DONE] / 流自然结束 / 中断 都在此释放 reader：取消底层流（关连接）+ 释放锁，
    // 否则 reader 与连接悬挂到 GC（agent loop 每问至多 8 轮，长会话累积泄漏）。
    try {
      await reader.cancel();
    } catch {
      /* 已中断/已结束的流取消可能抛，忽略 */
    }
  }
}

// 去掉数组空洞、补 id 兜底（个别网关流式不回 id → 用下标合成，保证回灌时 tool_call_id 对得上）
function finalizeToolCalls(arr: OAToolCall[]): OAToolCall[] {
  return arr
    .filter((t) => t && t.function.name)
    .map((t, i) => ({ ...t, id: t.id || `call_${i}` }));
}

// 开发期把引擎挂到 window，方便在控制台/预览里直接验证整条链路
if (import.meta.env.DEV) {
  (globalThis as unknown as { __qzAi: { runAgent: typeof runAgent; complete: typeof complete } }).__qzAi =
    { runAgent, complete };
}
