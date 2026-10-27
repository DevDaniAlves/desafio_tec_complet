import { useState } from 'react';
import { Check, ChevronRight, LoaderCircle, Pencil, X, Clock, UserRound } from 'lucide-react';
import { ApiError, type Block, type DraftPayload, type TicketCard } from '../api';
import { PRIORITY_LABEL, STATUS_LABEL, fmtDateTime, fmtTime, relative } from '../format';

export interface BlockActions {
  send: (text: string) => void;
  confirm: (draftId: string) => Promise<void>;
  cancel: (draftId: string) => Promise<void>;
  edit: (draft: DraftPayload) => void;
  /** Cartões interativos só quando é a última mensagem e o agent está ativo. */
  interactive: boolean;
}

export function BlockView({ block, actions }: { block: Block; actions: BlockActions }) {
  switch (block.type) {
    case 'options':
      return (
        <div className="options">
          <div className="options-q">{block.question}</div>
          {block.options.map((o, i) => (
            <button key={o} className="option" disabled={!actions.interactive} onClick={() => actions.send(o)}>
              <span className="option-n">{i + 1}</span>
              {o}
            </button>
          ))}
        </div>
      );
    case 'ticket_list':
      return (
        <div className="ticket-list">
          {block.tickets.map((t) => (
            <button key={t.id} className="ticket-row" disabled={!actions.interactive} onClick={() => actions.send(`Quero saber sobre o ${t.id}`)}>
              <div className="ticket-row-main">
                <div className="ticket-id">{t.id}</div>
                <div className="ticket-title">{t.title}</div>
                <div className="ticket-meta">
                  <StatusPill ticket={t} /> <span className="muted">{fmtDateTime(t.updatedAt)}</span>
                </div>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      );
    case 'ticket':
      return <TicketCardView ticket={block.ticket} />;
    case 'draft':
      return <DraftCard block={block} actions={actions} />;
    case 'handoff':
      return (
        <div className="handoff-note">
          <UserRound size={15} />
          <span>
            Transferida para <b>{block.team}</b> · retorno em até {block.sla}
          </span>
        </div>
      );
  }
}

export function StatusPill({ ticket }: { ticket: Pick<TicketCard, 'status' | 'overdue'> }) {
  const tone = ticket.overdue ? 'danger' : ticket.status === 'resolved' || ticket.status === 'approved' ? 'success' : ticket.status === 'waiting_analyst' ? 'warning' : 'primary';
  return (
    <span className={`pill pill-${tone}`}>
      {STATUS_LABEL[ticket.status]}
      {ticket.overdue ? ' · prazo vencido' : ''}
    </span>
  );
}

export function TicketCardView({ ticket }: { ticket: TicketCard }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-kicker">Chamado</span>
        <span className="ticket-id">{ticket.id}</span>
        <StatusPill ticket={ticket} />
      </div>
      <div className="card-title">{ticket.title}</div>
      {ticket.description && <p className="card-desc">{ticket.description.split('\n\n')[0]}</p>}
      <dl className="card-grid">
        <div>
          <dt>Categoria</dt>
          <dd>{ticket.category}</dd>
        </div>
        <div>
          <dt>Prioridade</dt>
          <dd>{PRIORITY_LABEL[ticket.priority]}</dd>
        </div>
        <div>
          <dt>Aberto em</dt>
          <dd>{fmtDateTime(ticket.createdAt)}</dd>
        </div>
        <div>
          <dt>Última atualização</dt>
          <dd>
            {relative(ticket.updatedAt)}
            {ticket.overdue && <span className="overdue"> · prazo vencido</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

const AFFECTED_LABEL = { self: 'Somente você', team: 'Sua equipe', company: 'Toda a empresa' } as const;
const HEAD = { create: 'Novo chamado', update: 'Atualizar chamado', reopen: 'Reabrir chamado' } as const;

function DraftCard({ block, actions }: { block: Extract<Block, { type: 'draft' }>; actions: BlockActions }) {
  const d = block.draft;
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = block.state === 'pending';

  const run = async (kind: 'confirm' | 'cancel') => {
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'confirm' ? actions.confirm(block.draftId) : actions.cancel(block.draftId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível concluir. Tente de novo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`card draft ${pending ? '' : 'draft-done'}`}>
      <div className="card-head">
        <span className="card-kicker">{HEAD[d.action]}</span>
        <span className="ticket-id">{d.existingTicketId ?? `Rascunho ${block.draftId}`}</span>
        <span className={`pill ${pending ? 'pill-warning' : block.state === 'confirmed' ? 'pill-success' : 'pill-muted'}`}>
          {pending ? 'Aguardando confirmação' : block.state === 'confirmed' ? 'Confirmado' : 'Cancelado'}
        </span>
      </div>
      <div className="card-title">{d.title}</div>
      <p className="card-desc">{d.description}</p>
      <dl className="card-grid">
        <div>
          <dt>Categoria</dt>
          <dd>{d.category}</dd>
        </div>
        <div>
          <dt>Prioridade</dt>
          <dd>
            {PRIORITY_LABEL[d.priority]}
            {d.dueAt && (
              <span className="muted">
                {' '}
                · resposta até {fmtTime(d.dueAt)}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Afetados</dt>
          <dd>{AFFECTED_LABEL[d.affected]}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{d.type === 'INC' ? 'Incidente' : 'Requisição'}</dd>
        </div>
      </dl>
      {pending && (
        <div className="card-actions">
          <button className="btn btn-primary" disabled={!!busy || !actions.interactive} onClick={() => run('confirm')}>
            {busy === 'confirm' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
            Confirmar
          </button>
          <button className="btn btn-ghost" disabled={!!busy || !actions.interactive} onClick={() => actions.edit(d)}>
            <Pencil size={14} /> Editar
          </button>
          <button className="btn btn-ghost" disabled={!!busy || !actions.interactive} onClick={() => run('cancel')}>
            <X size={14} /> Cancelar
          </button>
        </div>
      )}
      {error && (
        <div className="inline-error" role="alert">
          <Clock size={14} /> {error}
        </div>
      )}
    </div>
  );
}
