import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { canReopen, derivePriority, isOpen, SLA_LABEL } from '../domain/sla.js';
import { AFFECTED, CATEGORIES, PRIORITIES, TICKET_TYPES, type DraftPayload, type TicketView } from '../domain/types.js';
import { tokens } from '../services/kbService.js';
import { LegacyUnavailableError, TicketNotFoundError, TicketRuleError } from '../services/ticketService.js';
import { INTENTS, type Decision, type HandoffTrigger, type TurnContext } from './context.js';

const decisionShape = {
  intent: z.enum(INTENTS),
  understood: z.string().min(3).describe('O que o funcionário quer, em 1 frase'),
  confidence: z.number().min(0).max(1).describe('Segurança 0-1'),
  rationale: z.string().min(3).describe('Por que esta ação (regra e fatos)'),
};

const pickDecision = (i: Decision & Record<string, unknown>): Decision => ({
  intent: i.intent,
  understood: i.understood,
  confidence: i.confidence,
  rationale: i.rationale,
});

const brief = (t: TicketView) => ({
  id: t.id,
  type: t.type,
  title: t.title,
  category: t.category,
  priority: t.priority,
  status: t.status,
  open: isOpen(t),
  updatedAt: t.updatedAt,
  overdue: t.overdue,
  dueAt: t.dueAt,
  canReopen: canReopen(t),
  description: t.description.slice(0, 400),
});

const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return A.size + B.size === 0 ? 0 : inter / (A.size + B.size - inter);
};

/** Executa uma ferramenta registrando o passo no trace e convertendo falhas esperadas em resultados para o modelo. */
async function traced<T extends object>(
  ctx: TurnContext,
  tool: string,
  label: string,
  input: unknown,
  fn: () => Promise<{ result: T; summary: string }>,
): Promise<T | { error: string; message: string }> {
  const t0 = Date.now();
  try {
    const { result, summary } = await fn();
    ctx.steps.push({ tool, label, input, summary, ok: true, durationMs: Date.now() - t0 });
    return result;
  } catch (e) {
    let error = 'INTERNAL_ERROR';
    let message = 'Falha inesperada na ferramenta';
    if (e instanceof LegacyUnavailableError) {
      error = 'LEGACY_UNAVAILABLE';
      message = e.message;
    } else if (e instanceof TicketNotFoundError) {
      error = 'NOT_FOUND';
      message = e.message;
    } else if (e instanceof TicketRuleError) {
      error = 'RULE_VIOLATION';
      message = e.message;
    } else {
      console.error(`[agent] tool ${tool} failed`, e);
    }
    ctx.steps.push({ tool, label, input, summary: `${error}: ${message}`, ok: false, durationMs: Date.now() - t0 });
    return { error, message };
  }
}

export function buildTools(ctx: TurnContext) {
  const emp = ctx.employee.id;

  const search_my_tickets = createTool({
    id: 'search_my_tickets',
    description: 'Chamados do funcionário atual (abertos e resolvidos), com status e prazo.',
    inputSchema: z.object({ only_open: z.boolean().default(false) }),
    execute: async ({ context }) =>
      traced(ctx, 'search_my_tickets', 'consultou seus chamados', context, async () => {
        const list = await ctx.tickets.listByEmployee(emp, { onlyOpen: context.only_open });
        return { result: { tickets: list.map(brief) }, summary: `${list.length} chamado(s) do funcionário` };
      }),
  });

  const get_ticket = createTool({
    id: 'get_ticket',
    description: 'Detalha um chamado pelo número (ex.: INC-20311). NOT_FOUND se não existir ou não for dele.',
    inputSchema: z.object({ ticket_id: z.string().min(3) }),
    execute: async ({ context }) =>
      traced(ctx, 'get_ticket', `consultou o ${context.ticket_id.toUpperCase()}`, context, async () => {
        const t = await ctx.tickets.getForEmployee(emp, context.ticket_id.trim().toUpperCase());
        if (!t) throw new TicketNotFoundError(context.ticket_id);
        return { result: { ticket: brief(t) }, summary: `${t.id} · ${t.status}${t.overdue ? ' · vencido' : ''}` };
      }),
  });

  const search_knowledge_base = createTool({
    id: 'search_knowledge_base',
    description: 'Busca artigos da central de ajuda por palavras-chave (ex.: "vpn erro 809").',
    inputSchema: z.object({ query: z.string().min(2) }),
    execute: async ({ context }) =>
      traced(ctx, 'search_knowledge_base', 'buscou na central de ajuda', context, async () => {
        const hits = await ctx.kb.search(context.query);
        return {
          result: { articles: hits.map((h) => ({ id: h.article.id, title: h.article.title, body: h.article.body, score: h.score })) },
          summary: hits.length ? hits.map((h) => h.article.title).join('; ') : 'nenhum artigo relevante',
        };
      }),
  });

  const calculate_priority = createTool({
    id: 'calculate_priority',
    description:
      'Calcula prioridade e prazo (regra do Anexo A). Obrigatório antes de rascunhar chamado novo.',
    inputSchema: z.object({
      affected: z.enum(AFFECTED),
      blocks_work: z.boolean(),
      same_day_commitment: z.boolean(),
      has_workaround: z.boolean(),
    }),
    execute: async ({ context }) =>
      traced(ctx, 'calculate_priority', 'classificou a prioridade', context, async () => {
        const { priority, reason } = derivePriority({
          affected: context.affected,
          blocksWork: context.blocks_work,
          sameDayCommitment: context.same_day_commitment,
          hasWorkaround: context.has_workaround,
        });
        const dueAt = ctx.tickets.dueFor(priority);
        ctx.priorityCalc = { priority, affected: context.affected, dueAt };
        return { result: { priority, reason, sla: SLA_LABEL[priority], respondeAte: dueAt }, summary: `${priority} · ${reason} · prazo ${SLA_LABEL[priority]}` };
      }),
  });

  const finish = (decision: Decision, action: NonNullable<TurnContext['final']>['action']) => {
    ctx.final = { decision, action };
    return { ok: true };
  };

  const reply = createTool({
    id: 'reply',
    description: 'Termina o turno com uma resposta em texto.',
    inputSchema: z.object({ message: z.string().min(1), ...decisionShape }),
    execute: async ({ context }) => finish(pickDecision(context), { kind: 'reply', message: context.message }),
  });

  const ask_options = createTool({
    id: 'ask_options',
    description: 'Termina o turno com UMA pergunta de múltipla escolha.',
    inputSchema: z.object({
      message: z.string().min(1),
      question: z.string().min(3),
      options: z.array(z.string().min(1).max(40)).min(2).max(5),
      ...decisionShape,
    }),
    execute: async ({ context }) => finish(pickDecision(context), { kind: 'options', message: context.message, question: context.question, options: context.options }),
  });

  const show_tickets = createTool({
    id: 'show_tickets',
    description:
      'Termina o turno mostrando chamados do funcionário (1 id = detalhe; vários = lista para escolher).',
    inputSchema: z.object({ message: z.string().min(1), ticket_ids: z.array(z.string()).min(1).max(8), ...decisionShape }),
    execute: async ({ context }) => {
      const owned = (await Promise.all(context.ticket_ids.map((id) => ctx.tickets.getForEmployee(emp, id.trim().toUpperCase()).catch(() => null)))).filter(
        (t): t is TicketView => !!t,
      );
      if (!owned.length) return { error: 'NOT_FOUND', message: 'Nenhum desses chamados pertence ao funcionário. Use search_my_tickets.' };
      return finish(pickDecision(context), { kind: 'tickets', message: context.message, ticketIds: owned.map((t) => t.id) });
    },
  });

  const draft_ticket = createTool({
    id: 'draft_ticket',
    description:
      'Termina o turno com um RASCUNHO para confirmação (nada é criado antes). action: create | update (chamado aberto) | reopen (resolvido há até 7 dias).',
    inputSchema: z.object({
      message: z.string().min(1),
      action: z.enum(['create', 'update', 'reopen']),
      existing_ticket_id: z.string().optional().describe('Obrigatório em update/reopen'),
      title: z.string().min(5).max(120),
      description: z.string().min(20).describe('Completa e autocontida'),
      type: z.enum(TICKET_TYPES),
      category: z.enum(CATEGORIES),
      priority: z.enum(PRIORITIES),
      affected: z.enum(AFFECTED),
      force_new: z.boolean().default(false).describe('só se o funcionário confirmou que é outro problema'),
      ...decisionShape,
    }),
    execute: async ({ context: c }) => {
      const out = await traced(ctx, 'draft_ticket', 'montou o rascunho', { action: c.action, title: c.title, category: c.category, priority: c.priority }, async () => {
        const mine = await ctx.tickets.listByEmployee(emp);
        let priority = c.priority;
        let existing: TicketView | undefined;

        if (c.action === 'create') {
          if (!ctx.priorityCalc) throw new TicketRuleError('Chame calculate_priority antes de montar o rascunho de um chamado novo.');
          priority = ctx.priorityCalc.priority; // a regra manda, não o modelo
          if (!c.force_new) {
            const q = tokens(`${c.title} ${c.description}`);
            const dup = mine
              .filter((t) => (isOpen(t) || canReopen(t)) && t.category === c.category)
              .map((t) => ({ t, s: jaccard(q, tokens(`${t.title} ${t.description}`)) }))
              .sort((a, b) => b.s - a.s)[0];
            if (dup && dup.s >= 0.3) {
              throw new TicketRuleError(
                `Possível duplicidade com ${dup.t.id} ("${dup.t.title}", ${isOpen(dup.t) ? 'aberto' : 'resolvido recentemente'}). Proponha action=${isOpen(dup.t) ? 'update' : 'reopen'} com existing_ticket_id=${dup.t.id}, ou use force_new só se o funcionário disser que é outro problema.`,
              );
            }
          }
        } else {
          existing = mine.find((t) => t.id === c.existing_ticket_id?.trim().toUpperCase());
          if (!existing) throw new TicketNotFoundError(c.existing_ticket_id ?? '(vazio)');
          if (c.action === 'update' && !isOpen(existing)) throw new TicketRuleError(`${existing.id} não está aberto; use action=reopen se foi resolvido há até 7 dias, senão crie um novo.`);
          if (c.action === 'reopen' && !canReopen(existing)) throw new TicketRuleError(`${existing.id} não pode ser reaberto (só resolvidos há até 7 dias).`);
          priority = existing.priority;
        }

        const draft: DraftPayload = {
          action: c.action,
          existingTicketId: existing?.id ?? null,
          title: c.title,
          description: c.description,
          type: existing?.type ?? c.type,
          category: existing?.category ?? c.category,
          priority,
          affected: c.affected,
          dueAt: ctx.tickets.dueFor(priority),
        };
        finish(pickDecision(c), { kind: 'draft', message: c.message, draft });
        return { result: { ok: true }, summary: `${c.action} · ${draft.type} · ${draft.category} · ${priority}${existing ? ` · ${existing.id}` : ''}` };
      });
      return out;
    },
  });

  const handoff_to_analyst = createTool({
    id: 'handoff_to_analyst',
    description:
      'Termina o turno transferindo a conversa para um analista; o agent para de responder.',
    inputSchema: z.object({
      message: z.string().min(1),
      trigger: z.enum(['user_request', 'critical', 'overdue', 'low_confidence']),
      reason: z.string().min(3),
      summary: z.string().min(20).describe('Resumo completo do caso para o analista'),
      ticket_id: z.string().optional(),
      ...decisionShape,
    }),
    execute: async ({ context: c }) =>
      traced(ctx, 'handoff_to_analyst', 'transferiu para um analista', { trigger: c.trigger, ticket_id: c.ticket_id }, async () => {
        let ticketId: string | null = null;
        if (c.ticket_id) {
          const t = await ctx.tickets.getForEmployee(emp, c.ticket_id.trim().toUpperCase());
          if (!t) throw new TicketNotFoundError(c.ticket_id);
          ticketId = t.id;
        }
        finish(pickDecision(c), { kind: 'handoff', message: c.message, trigger: c.trigger as HandoffTrigger, reason: c.reason, summary: c.summary, ticketId });
        return { result: { ok: true }, summary: `${c.trigger}: ${c.reason}` };
      }),
  });

  return { search_my_tickets, get_ticket, search_knowledge_base, calculate_priority, reply, ask_options, show_tickets, draft_ticket, handoff_to_analyst };
}
