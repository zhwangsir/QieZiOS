import Anthropic from '@anthropic-ai/sdk';
import { aiConfig } from './aiConfig.svelte';
import { TOOL_DEFS, executeTool } from './aiTools';

// ───────────────────────────────────────────────────────────
// AI 引擎 · 流式 + 工具调用 agent loop
// runAgent：跑「调模型 → 若要用工具则执行并回灌 → 再调模型」直到 end_turn。
// 通过 onEvent 把文本增量、工具调用、错误推给 UI。
// ───────────────────────────────────────────────────────────
export type AiEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'error'; message: string };

// 默认系统提示：告诉 AI 它能用工具驱动系统。用户的自定义人设会叠加在它之后（工具能力始终保留）。
const DEFAULT_SYSTEM_PROMPT = `你是 QieZiOS（一个跑在浏览器里的桌面系统 🍆）的内置 AI 助手。
你可以用提供的工具实际操作这个系统：启动 App、增删改文件、改外观主题。
当用户的请求需要操作系统时，直接调用相应工具去做，再用简短中文说明你做了什么。
启动 App 前先用 list_apps 查 id。回答简洁、口语化、用中文。`;

export async function runAgent(
  history: Anthropic.MessageParam[],
  onEvent: (e: AiEvent) => void,
): Promise<void> {
  if (!aiConfig.apiKey) {
    onEvent({ type: 'error', message: '请先在「设置 → AI」里填入 Anthropic API Key' });
    return;
  }

  const client = new Anthropic({
    apiKey: aiConfig.apiKey,
    baseURL: aiConfig.baseURL?.trim() || undefined, // 留空走官方
    dangerouslyAllowBrowser: true,
  });
  const messages: Anthropic.MessageParam[] = [...history];

  // 默认提示 + 用户自定义人设（叠加，保留工具能力）
  const persona = aiConfig.systemPrompt?.trim();
  const system = persona ? `${DEFAULT_SYSTEM_PROMPT}\n\n${persona}` : DEFAULT_SYSTEM_PROMPT;

  try {
    // 最多 8 轮（防工具调用死循环）
    for (let turn = 0; turn < 8; turn++) {
      const stream = client.messages.stream({
        model: aiConfig.model || 'claude-opus-4-8',
        max_tokens: aiConfig.maxTokens || 8000,
        system,
        tools: TOOL_DEFS as Anthropic.Tool[],
        messages,
      });
      stream.on('text', (t) => onEvent({ type: 'text', text: t }));
      const msg = await stream.finalMessage();
      messages.push({ role: 'assistant', content: msg.content });

      if (msg.stop_reason !== 'tool_use') break;

      // 执行这一轮 AI 要调的所有工具，把结果一起回灌
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
  } catch (e) {
    onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
