import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Agent } from '@mastra/core/agent';
import type { Config } from '../config.js';

export type AgentModel = ConstructorParameters<typeof Agent>[0]['model'];

export const DEFAULT_MODEL = 'gemini-3.5-flash';
/** Modelo reserva quando o principal estoura a cota (a cota do Gemini é por modelo). */
export const DEFAULT_FALLBACK = 'gemini-3.1-flash-lite';

export interface ResolvedModel {
  model: AgentModel;
  id: string;
  /** Ajustes do Gemini (ex.: reduzir o "thinking" para cortar latência e custo). */
  providerOptions: Record<string, Record<string, unknown>>;
  /** Usado automaticamente se o principal der 429/503. */
  fallback?: Omit<ResolvedModel, 'fallback'>;
}

type ModelConfig = Pick<Config, 'GEMINI_API_KEY' | 'AGENT_MODEL' | 'AGENT_FALLBACK_MODEL' | 'GEMINI_THINKING'>;

/** Monta o modelo Gemini da configuração. Retorna null sem a chave (o chat avisa o usuário). */
export function resolveModel(cfg: ModelConfig): ResolvedModel | null {
  if (!cfg.GEMINI_API_KEY) return null;
  const google = createGoogleGenerativeAI({ apiKey: cfg.GEMINI_API_KEY });
  const id = cfg.AGENT_MODEL || DEFAULT_MODEL;
  const fallbackId = cfg.AGENT_FALLBACK_MODEL === 'off' ? '' : cfg.AGENT_FALLBACK_MODEL || DEFAULT_FALLBACK;

  const build = (modelId: string) => ({
    model: google(modelId),
    id: modelId,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: cfg.GEMINI_THINKING } } },
  });
  return { ...build(id), ...(fallbackId && fallbackId !== id ? { fallback: build(fallbackId) } : {}) };
}
