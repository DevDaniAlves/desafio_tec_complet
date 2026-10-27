import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Agent } from '@mastra/core/agent';
import type { Config } from '../config.js';

export type AgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export const DEFAULT_MODEL = { google: 'gemini-3.5-flash', anthropic: 'claude-haiku-5-5' } as const;

/** Escolhe o provedor de LLM pela configuração. Retorna null quando falta a chave (o chat avisa o usuário). */
export interface ResolvedModel {
  model: AgentModel;
  id: string;
  provider: string;
  /** Ajustes por provedor (ex.: reduzir o "thinking" do Gemini para cortar latência e custo). */
  providerOptions?: Record<string, Record<string, unknown>>;
}

export function resolveModel(cfg: Pick<Config, 'LLM_PROVIDER' | 'GEMINI_API_KEY' | 'ANTHROPIC_API_KEY' | 'AGENT_MODEL' | 'GEMINI_THINKING'>): ResolvedModel | null {
  const id = cfg.AGENT_MODEL || DEFAULT_MODEL[cfg.LLM_PROVIDER];
  if (cfg.LLM_PROVIDER === 'google') {
    if (!cfg.GEMINI_API_KEY) return null;
    return {
      model: createGoogleGenerativeAI({ apiKey: cfg.GEMINI_API_KEY })(id),
      id,
      provider: 'google',
      providerOptions: { google: { thinkingConfig: { thinkingLevel: cfg.GEMINI_THINKING } } },
    };
  }
  if (!cfg.ANTHROPIC_API_KEY) return null;
  return { model: createAnthropic({ apiKey: cfg.ANTHROPIC_API_KEY })(id), id, provider: 'anthropic' };
}
