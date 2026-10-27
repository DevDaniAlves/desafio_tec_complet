import { Agent } from '@mastra/core/agent';
import type { TraceStep } from '../domain/types.js';
import type { AgentInput, AgentOutcome, AgentRunner, TurnContext } from './context.js';
import type { ResolvedModel } from './model.js';
import { buildInstructions } from './prompt.js';
import { buildTools } from './tools.js';

const MAX_STEPS = 6;

interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Agent do Nexo Assist sobre o Mastra. Um `Agent` é montado por turno porque as ferramentas
 * capturam o `TurnContext` (funcionário autenticado + trace): é isso que garante que o modelo
 * nunca escolhe "de quem" são os dados. O provedor do modelo (Gemini/Claude) é injetado.
 */
export class MastraRunner implements AgentRunner {
  constructor(private readonly llm: Pick<ResolvedModel, 'model' | 'id' | 'providerOptions'>) {}

  async run(input: AgentInput, deps: Pick<TurnContext, 'tickets' | 'kb'>): Promise<AgentOutcome> {
    const t0 = Date.now();
    const ctx: TurnContext = { employee: input.employee, tickets: deps.tickets, kb: deps.kb, steps: [], priorityCalc: null, final: null };

    const agent = new Agent({
      name: 'nexo-assist',
      instructions: buildInstructions(input.employee, input.now),
      model: this.llm.model,
      tools: buildTools(ctx),
    });

    const messages = input.history.map((m) =>
      m.role === 'user' ? { role: 'user' as const, content: m.content } : { role: 'assistant' as const, content: m.content },
    );

    const result = await agent.generate(messages, {
      maxSteps: MAX_STEPS,
      toolChoice: 'required',
      stopWhen: () => ctx.final !== null,
      modelSettings: { maxOutputTokens: 1200, temperature: 0.2 },
      ...(this.llm.providerOptions ? { providerOptions: this.llm.providerOptions as never } : {}),
    });

    const usage = ((result as { totalUsage?: UsageLike }).totalUsage ?? (result as { usage?: UsageLike }).usage ?? {}) as UsageLike;
    const steps: TraceStep[] = ctx.steps;
    return {
      final: ctx.final,
      fallbackText: ctx.final ? null : ((result as { text?: string }).text?.trim() || null),
      steps,
      model: this.llm.id,
      usage: { inputTokens: usage.inputTokens ?? usage.promptTokens ?? 0, outputTokens: usage.outputTokens ?? usage.completionTokens ?? 0 },
      latencyMs: Date.now() - t0,
    };
  }
}
