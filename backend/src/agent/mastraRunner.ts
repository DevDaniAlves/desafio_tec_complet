import { Agent } from '@mastra/core/agent';
import type { TraceStep } from '../domain/types.js';
import type { AgentInput, AgentOutcome, AgentRunner, TurnContext } from './context.js';
import { Gate, isBusyError, retryAfterSeconds, sleep } from './llmErrors.js';
import type { ResolvedModel } from './model.js';
import { buildInstructions } from './prompt.js';
import { buildTools } from './tools.js';

const MAX_STEPS = 6;
/** Espera máxima para tentar o mesmo modelo de novo depois de um 429 (acima disso, avisa o usuário). */
const MAX_RETRY_WAIT_S = 20;

interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

type ModelSpec = Pick<ResolvedModel, 'model' | 'id' | 'providerOptions'>;

/**
 * Agent do Nexo Assist sobre o Mastra. Um `Agent` é montado por turno porque as ferramentas
 * capturam o `TurnContext` (funcionário autenticado + trace): é isso que garante que o modelo
 * nunca escolhe "de quem" são os dados. O modelo (Gemini) é injetado.
 *
 * Proteção da cota: no máximo `concurrency` turnos ao mesmo tempo; em 429/503 tenta o modelo
 * reserva e, sem reserva, espera o tempo que o provedor sugeriu (se for curto) e repete uma vez.
 * Repetir é seguro porque as ferramentas só leem até a ação terminal; nada é gravado no meio.
 */
export class MastraRunner implements AgentRunner {
  private readonly gate: Gate;

  constructor(
    private readonly llm: ResolvedModel,
    concurrency = 2,
  ) {
    this.gate = new Gate(concurrency);
  }

  run(input: AgentInput, deps: Pick<TurnContext, 'tickets' | 'kb'>): Promise<AgentOutcome> {
    return this.gate.run(async () => {
      try {
        return await this.attempt(this.llm, input, deps);
      } catch (e) {
        if (!isBusyError(e)) throw e;
        if (this.llm.fallback) {
          console.warn(`[agent] ${this.llm.id} sem cota/sobrecarregado; usando ${this.llm.fallback.id}`);
          try {
            return await this.attempt(this.llm.fallback, input, deps);
          } catch (e2) {
            if (!isBusyError(e2)) throw e2;
            e = e2;
          }
        }
        const wait = retryAfterSeconds(e);
        if (wait !== null && wait <= MAX_RETRY_WAIT_S) {
          await sleep(wait * 1000 + 300);
          return this.attempt(this.llm.fallback ?? this.llm, input, deps);
        }
        throw e;
      }
    });
  }

  private async attempt(spec: ModelSpec, input: AgentInput, deps: Pick<TurnContext, 'tickets' | 'kb'>): Promise<AgentOutcome> {
    const t0 = Date.now();
    const ctx: TurnContext = { employee: input.employee, tickets: deps.tickets, kb: deps.kb, steps: [], priorityCalc: null, final: null };

    const agent = new Agent({
      name: 'nexo-assist',
      instructions: buildInstructions(input.employee, input.now),
      model: spec.model,
      tools: buildTools(ctx),
    });

    const messages = input.history.map((m) =>
      m.role === 'user' ? { role: 'user' as const, content: m.content } : { role: 'assistant' as const, content: m.content },
    );

    const result = await agent.generate(messages, {
      toolChoice: 'required',
      // Para na primeira ação terminal ou no limite de passos. (Não usar maxSteps junto: ele substitui o stopWhen.)
      stopWhen: [() => ctx.final !== null, ({ steps }: { steps: unknown[] }) => steps.length >= MAX_STEPS],
      modelSettings: { maxOutputTokens: 1200, temperature: 0.2 },
      ...(spec.providerOptions ? { providerOptions: spec.providerOptions as never } : {}),
    });

    const stepCount = (result as { steps?: unknown[] }).steps?.length ?? 0;
    console.log(`[agent] ${spec.id}: ${stepCount} passo(s) em ${Date.now() - t0} ms`);
    const usage = ((result as { totalUsage?: UsageLike }).totalUsage ?? (result as { usage?: UsageLike }).usage ?? {}) as UsageLike;
    const steps: TraceStep[] = ctx.steps;
    return {
      final: ctx.final,
      fallbackText: ctx.final ? null : ((result as { text?: string }).text?.trim() || null),
      steps,
      model: spec.id,
      usage: { inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0, outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0 },
      latencyMs: Date.now() - t0,
    };
  }
}
