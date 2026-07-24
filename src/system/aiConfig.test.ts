// U9 控制中心「AI 在线」判定 · aiReady 纯函数测试（M4）
// 目标：provider 感知——OpenAI 兼容端点（本地/无鉴权网关）可空 key 即在线；
//       Anthropic 官方必须填 key；空白字符不算 key。
// M7：applyAiPreset / matchPreset（Spotlight AI 面板与设置共用）
import { describe, it, expect } from 'vitest';
import { aiReady, applyAiPreset, matchPreset, AI_PRESETS, ENV_AI_KEY, type AiConfig } from './aiConfig.svelte';

describe('aiReady（provider 感知的 AI 在线判定）', () => {
  it('OpenAI 兼容端点：空 key 也算在线（本地 LM Studio / 无鉴权网关）', () => {
    expect(aiReady({ provider: 'openai', apiKey: '' })).toBe(true);
    expect(aiReady({ provider: 'openai', apiKey: 'sk-anything' })).toBe(true);
  });

  it('Anthropic 官方：必须有非空白 key', () => {
    expect(aiReady({ provider: 'anthropic', apiKey: '' })).toBe(false);
    expect(aiReady({ provider: 'anthropic', apiKey: '   ' })).toBe(false); // 空白不算
    expect(aiReady({ provider: 'anthropic', apiKey: 'sk-ant-xxx' })).toBe(true);
  });
});

// 造一份与持久化存档无关的纯配置对象，避免污染真实 aiConfig
function freshCfg(): AiConfig {
  return { provider: 'anthropic', apiKey: 'user-key', baseURL: '', model: 'claude-opus-4-8', systemPrompt: '', maxTokens: 8000 };
}

describe('applyAiPreset（一键套用设备清单预设）', () => {
  it('套用 provider+baseURL+model；useEnvKey=false 不动现有 key', () => {
    const cfg = freshCfg();
    const local = AI_PRESETS[0]; // 本地 GLM-4.6V
    expect(local.useEnvKey).toBe(false);
    applyAiPreset(cfg, local);
    expect(cfg.provider).toBe('openai');
    expect(cfg.baseURL).toBe('/aiproxy/v1');
    expect(cfg.model).toBe('zai-org/glm-4.6v-flash');
    expect(cfg.apiKey).toBe('user-key'); // 原 key 保留
  });

  it('useEnvKey=true：环境有 key 则填入，没有则保留现有 key', () => {
    const cfg = freshCfg();
    const ws = AI_PRESETS[1]; // 工作站 minimax
    expect(ws.useEnvKey).toBe(true);
    applyAiPreset(cfg, ws);
    expect(cfg.baseURL).toBe('/aiproxy/lm/v1');
    expect(cfg.model).toBe('minimax/minimax-m2.7');
    expect(cfg.apiKey).toBe(ENV_AI_KEY || 'user-key'); // 有环境 key 用之，否则不动
  });

  it('Anthropic 预设：baseURL 清空走官方', () => {
    const cfg = freshCfg();
    cfg.baseURL = '/aiproxy/v1';
    applyAiPreset(cfg, AI_PRESETS[2]);
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.baseURL).toBe('');
    expect(cfg.model).toBe('claude-opus-4-8');
  });
});

describe('matchPreset（当前配置命中哪个预设）', () => {
  it('provider+baseURL+model 全等 → 命中对应预设', () => {
    expect(matchPreset({ provider: 'openai', baseURL: '/aiproxy/v1', model: 'zai-org/glm-4.6v-flash' })?.label).toContain('GLM');
    expect(matchPreset({ provider: 'openai', baseURL: '/aiproxy/lm/v1', model: 'minimax/minimax-m2.7' })?.label).toContain('minimax');
    expect(matchPreset({ provider: 'anthropic', baseURL: '', model: 'claude-opus-4-8' })?.label).toContain('Anthropic');
  });

  it('任一字段不符 → null（自定义配置不高亮任何预设）', () => {
    expect(matchPreset({ provider: 'openai', baseURL: '/aiproxy/v1', model: 'other-model' })).toBeNull();
    expect(matchPreset({ provider: 'anthropic', baseURL: '/aiproxy/v1', model: 'claude-opus-4-8' })).toBeNull();
    expect(matchPreset({ provider: 'openai', baseURL: '', model: '' })).toBeNull();
  });
});
