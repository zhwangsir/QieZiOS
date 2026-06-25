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

// 一条对话消息（纯文本；工具上下文由引擎内部维护）
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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

async function runAnthropicAgent(
  history: ChatTurn[],
  system: string,
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
) {
  const client = await loadAnthropic();
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
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
type OAMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

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

async function runOpenAIAgent(
  history: ChatTurn[],
  system: string,
  onEvent: (e: AiEvent) => void,
  signal?: AbortSignal,
) {
  const messages: OAMessage[] = [{ role: 'system', content: system }, ...history];
  const tools = openaiToolDefs();
  for (let turn = 0; turn < 8; turn++) {
    if (signal?.aborted) break;
    const { content, toolCalls } = await streamOpenAI(messages, tools, onEvent, signal);
    const asst: OAMessage = { role: 'assistant', content: content || null };
    if (toolCalls.length) asst.tool_calls = toolCalls;
    messages.push(asst);
    if (!toolCalls.length) break;
    for (const tc of toolCalls) {
      onEvent({ type: 'tool', name: tc.function.name });
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        /* 参数损坏：当空对象 */
      }
      const r = await executeTool(tc.function.name, args);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(r) });
    }
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
  let content = '';
  const toolCalls: OAToolCall[] = [];

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
      if (data === '[DONE]') return { content, toolCalls: finalizeToolCalls(toolCalls) };
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
        onEvent({ type: 'text', text: delta.content });
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
  return { content, toolCalls: finalizeToolCalls(toolCalls) };
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
