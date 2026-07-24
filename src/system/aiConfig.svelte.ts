import { persisted } from '../kernel/persist.svelte';

// AI 配置（浏览器方案）。⚠️ 单人自托管：key 存 localStorage。
// provider 决定走哪种协议：
//   · anthropic —— 官方 Messages API，浏览器可直连（Anthropic 发了 CORS 头）
//   · openai    —— OpenAI 兼容 /chat/completions（自建网关 / 第三方）。浏览器受 CORS 限制，
//                  baseURL 一般填同源代理路径 /aiproxy/...（见 vite.config 的 server.proxy）
export interface AiConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  baseURL: string; // 接口地址：anthropic 留空=官方；openai 填 /aiproxy/lm/v1 之类
  model: string; // 任意模型 id（预设只是快填）
  systemPrompt: string; // 额外人设/指令（叠加在默认系统提示之上，留空=仅默认）
  maxTokens: number; // 单次回复最大 token（推理模型会先吃 token 思考，给足）
}

// 默认值可由本地 .env.local 的 VITE_AI_* 播种（首次无存档时生效；老存档缺字段也会从这里补）
const env = import.meta.env as Record<string, string | undefined>;

export const aiConfig = persisted<AiConfig>('qz.ai', {
  provider: (env.VITE_AI_PROVIDER as AiConfig['provider']) || 'anthropic',
  apiKey: env.VITE_AI_KEY || '',
  baseURL: env.VITE_AI_BASEURL || '',
  model: env.VITE_AI_MODEL || 'claude-opus-4-8',
  systemPrompt: '',
  maxTokens: 8000,
});

// AI 是否可用（provider 感知，纯函数）：OpenAI 兼容端点可空 key（本地/无鉴权网关）；
// Anthropic 官方必须填 key。与 Assistant/TextEdit/Files/DesktopPet 的 hasKey 判定同语义，
// 桌面控制中心（U9）与移动控制中心共用这一处判定。
export function aiReady(cfg: Pick<AiConfig, 'provider' | 'apiKey'>): boolean {
  return cfg.provider === 'openai' || cfg.apiKey.trim().length > 0;
}

// 环境里预置的 key（有就给「工作站」预设一键填上，免得每次手敲）
export const ENV_AI_KEY = env.VITE_AI_KEY || '';

// 一键预设：填好一整套 provider+地址+模型（key 由 useEnvKey 决定要不要从环境取）
export interface AiPreset {
  label: string;
  short: string; // 紧凑场景短名（Spotlight AI 面板 chips；设置面板仍用全名 label）
  provider: AiConfig['provider'];
  baseURL: string;
  model: string;
  useEnvKey: boolean;
}
export const AI_PRESETS: AiPreset[] = [
  {
    label: '本地 · GLM-4.6V（LM Studio 局域网）',
    short: 'GLM 本地',
    provider: 'openai',
    baseURL: '/aiproxy/v1', // 经 /aiproxy 转发到 .env.local 的 VITE_AI_PROXY_TARGET（本地 LM Studio 地址）
    model: 'zai-org/glm-4.6v-flash',
    useEnvKey: false, // 本地服务无需鉴权
  },
  {
    label: '工作站 · minimax（OpenAI 兼容）',
    short: 'minimax 工作站',
    provider: 'openai',
    baseURL: '/aiproxy/lm/v1',
    model: 'minimax/minimax-m2.7',
    useEnvKey: true,
  },
  {
    label: 'Anthropic 官方 · Opus',
    short: 'Opus',
    provider: 'anthropic',
    baseURL: '',
    model: 'claude-opus-4-8',
    useEnvKey: false,
  },
];

// 一键套用预设：填好 provider+地址+模型；useEnvKey 且环境里有 key 时顺带填 key（没有则不动现有 key）。
// 抽出共用：设置面板与 Spotlight AI 命令面板（M7）走同一处，语义不分裂。
export function applyAiPreset(cfg: AiConfig, p: AiPreset): void {
  cfg.provider = p.provider;
  cfg.baseURL = p.baseURL;
  cfg.model = p.model;
  if (p.useEnvKey && ENV_AI_KEY) cfg.apiKey = ENV_AI_KEY;
}

// 当前配置命中哪个预设（provider+baseURL+model 全等才算）。用于预设 chip 的激活态高亮；都不命中返回 null。
export function matchPreset(cfg: Pick<AiConfig, 'provider' | 'baseURL' | 'model'>): AiPreset | null {
  return (
    AI_PRESETS.find(
      (p) => p.provider === cfg.provider && p.baseURL === cfg.baseURL && p.model === cfg.model,
    ) ?? null
  );
}

// 模型 id 快填（点了只改 model，不动 provider）
export const AI_MODELS = [
  { id: 'zai-org/glm-4.6v-flash', label: 'GLM-4.6V（本地）' },
  { id: 'minimax/minimax-m2.7', label: 'minimax-m2.7（工作站）' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];
