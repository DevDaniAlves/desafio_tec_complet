import type { Affected, DraftPayload, Employee, Priority, TraceStep } from '../domain/types.js';
import type { KbService } from '../services/kbService.js';
import type { TicketService } from '../services/ticketService.js';

export const INTENTS = ['question', 'ticket_status', 'open_ticket', 'update_ticket', 'handoff', 'out_of_scope', 'clarify', 'smalltalk'] as const;
export type Intent = (typeof INTENTS)[number];

export interface Decision {
  intent: Intent;
  understood: string;
  confidence: number;
  rationale: string;
}

export type HandoffTrigger = 'user_request' | 'critical' | 'overdue' | 'low_confidence';

/** Ação terminal escolhida pelo agent. O orquestrador é quem a executa (persistência, estado da conversa). */
export type FinalAction =
  | { kind: 'reply'; message: string }
  | { kind: 'options'; message: string; question: string; options: string[] }
  | { kind: 'tickets'; message: string; ticketIds: string[] }
  | { kind: 'draft'; message: string; draft: DraftPayload }
  | { kind: 'handoff'; message: string; trigger: HandoffTrigger; reason: string; summary: string; ticketId: string | null };

export interface Final {
  action: FinalAction;
  decision: Decision;
}

/** Estado de UM turno do agent. Criado a cada mensagem; nada aqui sobrevive entre turnos. */
export interface TurnContext {
  employee: Employee;
  tickets: TicketService;
  kb: KbService;
  steps: TraceStep[];
  priorityCalc: { priority: Priority; affected: Affected; dueAt: string } | null;
  final: Final | null;
}

export interface AgentInput {
  employee: Employee;
  history: { role: 'user' | 'assistant'; content: string }[];
  now: Date;
}

export interface AgentOutcome {
  final: Final | null;
  fallbackText: string | null;
  steps: TraceStep[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

/** Fronteira entre orquestração e LLM: permite trocar o framework e testar com um agent roteirizado. */
export interface AgentRunner {
  run(input: AgentInput, deps: { tickets: TicketService; kb: KbService }): Promise<AgentOutcome>;
}
