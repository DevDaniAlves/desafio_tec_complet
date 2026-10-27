import { PRIORITY_LABEL } from '../domain/labels.js';
import { SLA_LABEL } from '../domain/sla.js';
import type { Block, Channel, DraftPayload, Employee, Trace, TicketCard, TicketView } from '../domain/types.js';
import type { Conversation, ConversationService, Message } from '../services/conversationService.js';
import type { KbService } from '../services/kbService.js';
import { LegacyUnavailableError, type TicketService } from '../services/ticketService.js';
import type { AgentRunner, Final, FinalAction } from './context.js';

const HISTORY_WINDOW = 24;
const LOW_CONFIDENCE = 0.5;

export const toCard = (t: TicketView): TicketCard => ({
  id: t.id,
  title: t.title,
  description: t.description,
  category: t.category,
  priority: t.priority,
  status: t.status,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  dueAt: t.dueAt,
  overdue: t.overdue,
});

const teamFor = (trigger: string) => (trigger === 'low_confidence' ? 'Suporte N1' : 'Suporte N2');
const handoffSla = (trigger: string) => (trigger === 'critical' ? '1 hora (plantão 24h)' : '2 horas úteis');

/** Distingue limite de cota/sobrecarga do provedor (vale tentar de novo) de falhas reais. */
export function describeLlmError(e: unknown): { busy: boolean; message: string } {
  const text = [e instanceof Error ? e.message : String(e), (e as { cause?: { message?: string } })?.cause?.message ?? ''].join(' ');
  const busy = /quota|rate.?limit|429|RESOURCE_EXHAUSTED|overload|503|unavailable|high demand|try again later/i.test(text);
  return { busy, message: text.replace(/\s+/g, ' ').trim().slice(0, 300) };
}

export interface EngineDeps {
  conversations: ConversationService;
  tickets: TicketService;
  kb: KbService;
  runner: AgentRunner | null;
  sessionLimit: number;
  modelName: string;
}

export class ChatEngine {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly d: EngineDeps) {}

  /** Serializa o processamento por conversa: mensagens rápidas no WhatsApp não correm em paralelo. */
  private enqueue<T>(conversationId: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(conversationId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(job);
    this.queues.set(conversationId, next);
    void next
      .finally(() => {
        if (this.queues.get(conversationId) === next) this.queues.delete(conversationId);
      })
      .catch(() => undefined);
    return next;
  }

  async startNewSession(employee: Employee, channel: Channel): Promise<Conversation> {
    const cs = this.d.conversations;
    const current = await cs.getOrCreateActive(employee.id, channel);
    if (current.userMsgCount > 0 || current.status !== 'agent') {
      if (current.status === 'human' || current.status === 'waiting_agent') return current; // não abandona atendimento humano
      await cs.close(current.id);
    }
    return cs.getOrCreateActive(employee.id, channel);
  }

  async handleEmployeeMessage(p: { employee: Employee; channel: Channel; text: string; externalId?: string }): Promise<void> {
    const cs = this.d.conversations;
    const text = p.text.trim().slice(0, 2000);
    if (!text) return;
    if (p.externalId && (await cs.hasExternalId(p.externalId))) return;

    // "nova" reinicia a sessão quando o limite foi atingido (útil no WhatsApp, que não tem botão).
    let conv = await cs.getOrCreateActive(p.employee.id, p.channel);
    if (conv.userMsgCount >= this.d.sessionLimit && /^\/?nova$/i.test(text)) {
      await cs.close(conv.id);
      conv = await cs.getOrCreateActive(p.employee.id, p.channel);
      await cs.addMessage(conv.id, { role: 'system', text: 'Nova conversa iniciada.', channel: p.channel });
      return;
    }

    const convId = conv.id;
    await this.enqueue(convId, async () => {
      const fresh = (await cs.get(convId))!;
      if (fresh.userMsgCount >= this.d.sessionLimit) {
        await cs.addMessage(convId, {
          role: 'system',
          text: `Você atingiu o limite de ${this.d.sessionLimit} mensagens desta sessão. Inicie uma nova conversa${p.channel === 'whatsapp' ? ' enviando "nova"' : ''}.`,
          channel: p.channel,
        });
        return;
      }

      const resolved = await this.resolveShortReply(fresh, text);
      await cs.addMessage(convId, { role: 'user', text, channel: p.channel, externalId: p.externalId ?? null });

      // Agent pausado: a conversa está com um analista (ou esperando um). Registramos e silenciamos.
      if (fresh.status === 'human' || fresh.status === 'waiting_agent') return;

      const pending = await cs.pendingDraft(convId);
      if (pending) {
        if (/^(1|sim|confirmo|confirmar|confirma|pode criar|ok)$/i.test(text)) return this.confirmDraftLocked(p.employee, pending.id, p.channel);
        if (/^(3|cancelar|cancela|não|nao)$/i.test(text)) return this.cancelDraftLocked(p.employee, pending.id, p.channel);
      }

      await this.runAgent(p.employee, fresh, p.channel, resolved);
    });
  }

  /** "1" para escolher uma opção/chamado oferecido na última resposta (WhatsApp não tem botões). */
  private async resolveShortReply(conv: Conversation, text: string): Promise<string> {
    if (!/^\d{1,2}$/.test(text)) return text;
    const last = [...(await this.d.conversations.messages(conv.id))].reverse().find((m) => m.role === 'assistant');
    if (!last) return text;
    const idx = Number(text) - 1;
    for (const b of last.blocks) {
      if (b.type === 'options' && b.options[idx]) return b.options[idx]!;
      if (b.type === 'ticket_list' && b.tickets[idx]) return `Quero saber sobre o ${b.tickets[idx]!.id}`;
    }
    return text;
  }

  // --- confirmação de rascunho (determinística, sem LLM) ---

  async confirmDraft(employee: Employee, draftId: string, channel: Channel): Promise<void> {
    const draft = await this.d.conversations.getDraft(draftId);
    if (!draft || draft.employeeId !== employee.id) throw new Error('Rascunho não encontrado');
    await this.enqueue(draft.conversationId, () => this.confirmDraftLocked(employee, draftId, channel));
  }

  async cancelDraft(employee: Employee, draftId: string, channel: Channel): Promise<void> {
    const draft = await this.d.conversations.getDraft(draftId);
    if (!draft || draft.employeeId !== employee.id) throw new Error('Rascunho não encontrado');
    await this.enqueue(draft.conversationId, () => this.cancelDraftLocked(employee, draftId, channel));
  }

  private async confirmDraftLocked(employee: Employee, draftId: string, channel: Channel): Promise<void> {
    const cs = this.d.conversations;
    const draft = await cs.getDraft(draftId);
    if (!draft || draft.employeeId !== employee.id || draft.state !== 'pending') return;
    const t0 = Date.now();
    if (!(await cs.resolveDraft(draftId, 'confirmed'))) return; // outro clique já confirmou
    const dp: DraftPayload = draft.payload;
    try {
      let ticket: TicketView;
      if (dp.action === 'create') {
        ticket = await this.d.tickets.create(employee.id, { type: dp.type, title: dp.title, description: dp.description, category: dp.category, priority: dp.priority, affected: dp.affected });
      } else if (dp.action === 'update') {
        ticket = await this.d.tickets.update(employee.id, dp.existingTicketId!, { note: dp.description });
      } else {
        ticket = await this.d.tickets.reopen(employee.id, dp.existingTicketId!, dp.description);
      }
      await cs.linkDraftTicket(draftId, ticket.id);

      const verb = dp.action === 'create' ? 'criei o chamado' : dp.action === 'update' ? 'atualizei o chamado' : 'reabri o chamado';
      const sla = SLA_LABEL[ticket.priority];
      const trace: Trace = {
        model: 'regras',
        intent: dp.action === 'create' ? 'open_ticket' : 'update_ticket',
        understood: `O funcionário confirmou o rascunho ${draftId}`,
        action: `confirm_draft → ${dp.action}`,
        confidence: 1,
        rationale: 'Regra do Anexo A: o chamado só é criado/atualizado depois da confirmação explícita do funcionário.',
        steps: [{ tool: `${dp.action}_ticket`, label: dp.action === 'create' ? 'criou o chamado' : dp.action === 'update' ? 'atualizou o chamado' : 'reabriu o chamado', input: { draftId }, summary: `${ticket.id} · ${PRIORITY_LABEL[ticket.priority]}`, ok: true, durationMs: Date.now() - t0 }],
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: Date.now() - t0,
      };
      await cs.addMessage(draft.conversationId, {
        role: 'assistant',
        text: `Pronto, ${verb} ${ticket.id} com prioridade ${PRIORITY_LABEL[ticket.priority].toLowerCase()}. Um analista responde em até ${sla}.`,
        blocks: [{ type: 'ticket', ticket: toCard(ticket) }],
        trace,
        channel,
      });

      // Regra: casos críticos vão direto para um analista, com resumo.
      if (ticket.priority === 'critical') {
        await this.applyHandoff(draft.conversationId, channel, { kind: 'handoff', message: 'Como o caso é crítico, já chamei um analista do plantão.', trigger: 'critical', reason: 'Chamado crítico', summary: `${ticket.id} — ${ticket.title}\n${ticket.description}`, ticketId: ticket.id }, 1);
      }
    } catch (e) {
      // desfaz a reserva: o funcionário pode tentar de novo
      await cs.revertDraft(draftId);
      const unavailable = e instanceof LegacyUnavailableError;
      await cs.addMessage(draft.conversationId, {
        role: 'assistant',
        text: unavailable
          ? 'O sistema de chamados está indisponível por alguns instantes e não consegui concluir. Seu rascunho continua salvo: toque em Confirmar de novo em alguns segundos ou peça um analista.'
          : `Não consegui concluir: ${e instanceof Error ? e.message : 'erro inesperado'}.`,
        blocks: [{ type: 'draft', draftId, state: 'pending', draft: dp }],
        channel,
      });
    }
  }

  private async cancelDraftLocked(employee: Employee, draftId: string, channel: Channel): Promise<void> {
    const cs = this.d.conversations;
    const draft = await cs.getDraft(draftId);
    if (!draft || draft.employeeId !== employee.id || !(await cs.resolveDraft(draftId, 'cancelled'))) return;
    await cs.addMessage(draft.conversationId, { role: 'assistant', text: 'Tudo bem, não criei nada. Se quiser, é só me dizer o que mudar ou o que precisa.', channel });
  }

  // --- turno do agent ---

  private async runAgent(employee: Employee, conv: Conversation, channel: Channel, latestUserText: string): Promise<void> {
    const cs = this.d.conversations;
    if (!this.d.runner) {
      await cs.addMessage(conv.id, { role: 'assistant', text: 'O assistente ainda não está configurado (falta a chave do modelo no servidor). Peça a um analista para ajudar.', channel });
      return;
    }

    cs.setTyping(conv.id, true);
    try {
      const history = await this.buildHistory(conv.id, latestUserText);
      const out = await this.d.runner.run({ employee, history, now: new Date() }, { tickets: this.d.tickets, kb: this.d.kb });

      let final: Final | null = out.final;
      if (!final) {
        final = out.fallbackText
          ? { action: { kind: 'reply', message: out.fallbackText }, decision: { intent: 'clarify', understood: 'Resposta sem ação estruturada', confidence: 0.5, rationale: 'O modelo respondeu em texto livre, sem escolher uma ação terminal.' } }
          : null;
      }
      if (!final) {
        await cs.addMessage(conv.id, { role: 'assistant', text: 'Não consegui decidir como te ajudar com isso. Quer que eu chame um analista?', trace: this.errorTrace(out.model, 'O agent não chegou a uma ação dentro do limite de passos.', out.steps, out.latencyMs), channel });
        return;
      }

      let action: FinalAction = final.action;
      const trace: Trace = {
        model: out.model,
        intent: final.decision.intent,
        understood: final.decision.understood,
        action: this.describeAction(action),
        confidence: final.decision.confidence,
        rationale: final.decision.rationale,
        steps: out.steps,
        usage: out.usage,
        latencyMs: out.latencyMs,
      };

      // Rede de segurança determinística: baixa confiança nunca vira resposta/rascunho, vira transferência.
      if (final.decision.confidence < LOW_CONFIDENCE && action.kind !== 'handoff' && action.kind !== 'options') {
        action = {
          kind: 'handoff',
          message: 'Não tenho segurança para resolver isso sozinho. Vou chamar um analista para te ajudar.',
          trigger: 'low_confidence',
          reason: 'Baixa confiança do agent',
          summary: `${final.decision.understood}\nÚltima mensagem do funcionário: ${latestUserText}`,
          ticketId: null,
        };
        trace.action = `${this.describeAction(action)} (forçado: confiança ${Math.round(final.decision.confidence * 100)}% < ${LOW_CONFIDENCE * 100}%)`;
      }

      await this.applyAction(employee, conv, channel, action, trace);
    } catch (e) {
      console.error('[engine] agent failed', e);
      const detail = describeLlmError(e);
      await cs.addMessage(conv.id, {
        role: 'assistant',
        text: detail.busy
          ? 'Estou com muitas solicitações ao mesmo tempo. Aguarde alguns segundos e envie sua mensagem de novo.'
          : 'Tive um problema técnico para processar sua mensagem. Tente de novo em instantes ou peça um analista.',
        trace: this.errorTrace(this.d.modelName, detail.message, [], 0),
        channel,
      });
    } finally {
      cs.setTyping(conv.id, false);
    }
  }

  private async applyAction(employee: Employee, conv: Conversation, channel: Channel, action: FinalAction, trace: Trace): Promise<void> {
    const cs = this.d.conversations;
    switch (action.kind) {
      case 'reply':
        await cs.addMessage(conv.id, { role: 'assistant', text: action.message, trace, channel });
        return;
      case 'options':
        await cs.addMessage(conv.id, { role: 'assistant', text: action.message, blocks: [{ type: 'options', question: action.question, options: action.options }], trace, channel });
        return;
      case 'tickets': {
        const views = (await Promise.all(action.ticketIds.map((id) => this.d.tickets.getForEmployee(employee.id, id).catch(() => null)))).filter((t): t is TicketView => !!t);
        const blocks: Block[] = views.length === 1 ? [{ type: 'ticket', ticket: toCard(views[0]!) }] : [{ type: 'ticket_list', tickets: views.map(toCard) }];
        await cs.addMessage(conv.id, { role: 'assistant', text: action.message, blocks, trace, channel });
        return;
      }
      case 'draft': {
        await cs.cancelPendingDrafts(conv.id);
        const draft = await cs.createDraft(conv.id, employee.id, action.draft);
        await cs.addMessage(conv.id, { role: 'assistant', text: action.message, blocks: [{ type: 'draft', draftId: draft.id, state: 'pending', draft: action.draft }], trace, channel });
        return;
      }
      case 'handoff':
        await cs.addMessage(conv.id, { role: 'assistant', text: action.message, trace, channel });
        await this.applyHandoff(conv.id, channel, action, trace.confidence);
        if (action.ticketId) await this.d.tickets.markWaitingAnalyst(employee.id, action.ticketId).catch(() => undefined);
        return;
    }
  }

  private async applyHandoff(conversationId: string, channel: Channel, a: Extract<FinalAction, { kind: 'handoff' }>, confidence: number): Promise<void> {
    const team = teamFor(a.trigger);
    await this.d.conversations.handoff(conversationId, { team, reason: a.reason, summary: a.summary, confidence });
    await this.d.conversations.addMessage(conversationId, {
      role: 'system',
      text: `Transferida para ${team}`,
      blocks: [{ type: 'handoff', team, sla: handoffSla(a.trigger) }],
      channel,
    });
  }

  private async buildHistory(conversationId: string, latestUserText: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const msgs = (await this.d.conversations.messages(conversationId)).filter((m) => m.role !== 'system');
    const mapped = msgs.slice(-HISTORY_WINDOW).map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: this.historyText(m) }));
    // a última mensagem do usuário pode ter sido normalizada ("1" → opção escolhida)
    for (let i = mapped.length - 1; i >= 0; i--) {
      if (mapped[i]!.role === 'user') {
        mapped[i] = { role: 'user', content: latestUserText };
        break;
      }
    }
    while (mapped.length && mapped[0]!.role !== 'user') mapped.shift();
    return mapped;
  }

  private historyText(m: Message): string {
    const notes = m.blocks.map((b) => {
      switch (b.type) {
        case 'options':
          return `[Perguntei com opções: ${b.options.join(' / ')}]`;
        case 'ticket_list':
          return `[Mostrei chamados: ${b.tickets.map((t) => t.id).join(', ')}]`;
        case 'ticket':
          return `[Mostrei o chamado ${b.ticket.id}]`;
        case 'draft':
          return `[Rascunho ${b.draftId} (${b.state}): ${b.draft.action} "${b.draft.title}" · ${b.draft.category} · ${b.draft.priority}${b.draft.existingTicketId ? ` · ${b.draft.existingTicketId}` : ''}]`;
        case 'handoff':
          return `[Conversa transferida para ${b.team}]`;
      }
    });
    const prefix = m.role === 'analyst' ? `(Analista ${m.senderName ?? ''}) ` : '';
    return [prefix + m.text, ...notes].join('\n');
  }

  private describeAction(a: FinalAction): string {
    switch (a.kind) {
      case 'reply':
        return 'Respondeu em texto';
      case 'options':
        return 'Perguntou com opções rápidas';
      case 'tickets':
        return a.ticketIds.length > 1 ? 'Listou chamados para escolha' : 'Mostrou o chamado';
      case 'draft':
        return a.draft.action === 'create' ? 'Montou rascunho de novo chamado' : a.draft.action === 'update' ? `Montou rascunho de atualização do ${a.draft.existingTicketId}` : `Montou rascunho de reabertura do ${a.draft.existingTicketId}`;
      case 'handoff':
        return `Transferiu para analista (${a.trigger})`;
    }
  }

  private errorTrace(model: string, why: string, steps: Trace['steps'], latencyMs: number): Trace {
    return { model, intent: 'clarify', understood: 'Não foi possível processar', action: 'Falha controlada', confidence: 0, rationale: why, steps, usage: { inputTokens: 0, outputTokens: 0 }, latencyMs };
  }
}
