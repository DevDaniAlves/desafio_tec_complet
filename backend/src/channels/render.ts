import { fmtDateTime, PRIORITY_LABEL, STATUS_LABEL } from '../domain/labels.js';
import type { Block, TicketCard } from '../domain/types.js';

const ticketLine = (t: TicketCard) =>
  `• *${t.id}* — ${t.title}\n  ${STATUS_LABEL[t.status]} · ${PRIORITY_LABEL[t.priority]}${t.overdue ? ' · ⚠️ prazo vencido' : ''}`;

function renderBlock(b: Block): string {
  switch (b.type) {
    case 'options':
      return `*${b.question}*\n${b.options.map((o, i) => `${i + 1}) ${o}`).join('\n')}\n_Responda com o número da opção._`;
    case 'ticket_list':
      return `${b.tickets.map(ticketLine).join('\n')}\n_Responda com o número do chamado._`;
    case 'ticket':
      return `${ticketLine(b.ticket)}\n  Aberto em ${fmtDateTime(b.ticket.createdAt)} · atualizado ${fmtDateTime(b.ticket.updatedAt)}`;
    case 'draft': {
      const d = b.draft;
      const head = d.action === 'create' ? 'Novo chamado' : d.action === 'update' ? `Atualizar ${d.existingTicketId}` : `Reabrir ${d.existingTicketId}`;
      const body = `*${head}* (rascunho ${b.draftId})\n*${d.title}*\n${d.description}\nCategoria: ${d.category} · Prioridade: ${PRIORITY_LABEL[d.priority]}${d.dueAt ? ` · resposta até ${fmtDateTime(d.dueAt)}` : ''}`;
      return b.state === 'pending' ? `${body}\n\nResponda *1* para confirmar, *2* para editar ou *3* para cancelar.` : body;
    }
    case 'handoff':
      return `_Conversa transferida para ${b.team}. Retorno em até ${b.sla}._`;
  }
}

/** A mesma mensagem estruturada vira cards na web e texto simples no WhatsApp. */
export function renderForWhatsApp(text: string, blocks: Block[]): string {
  return [text, ...blocks.map(renderBlock)].filter(Boolean).join('\n\n');
}
