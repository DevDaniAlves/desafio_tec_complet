import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Inbox, LoaderCircle, LogOut, Search, SendHorizontal, UserCheck, Undo2, CircleCheckBig, Hourglass, Smartphone, Globe } from 'lucide-react';
import { ApiError, api, type ConsoleDetail, type ConsoleItem, type Message, type TicketCard } from '../api';
import { useAuth } from '../auth';
import { BlockView, StatusPill, type BlockActions } from '../components/Blocks';
import { Avatar, Mark } from '../components/Mark';
import { ActionChips } from '../components/Trace';
import { PRIORITY_LABEL, avatarBg, fmtDay, fmtTime, relative, shortStamp } from '../format';
import { useStream } from '../useStream';

type Filter = 'all' | 'needs' | 'agent' | 'mine';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'needs', label: 'Precisam de você' },
  { id: 'agent', label: 'Com o agent' },
  { id: 'mine', label: 'Minhas' },
];

const NOOP_ACTIONS: BlockActions = { send: () => undefined, confirm: async () => undefined, cancel: async () => undefined, edit: () => undefined, interactive: false };

export function Console() {
  const { user, signOut } = useAuth();
  const [items, setItems] = useState<ConsoleItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('needs');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConsoleDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const loadList = useCallback(async () => {
    try {
      setItems((await api.consoleList()).conversations);
      setListError(null);
    } catch (e) {
      setListError(e instanceof ApiError ? e.message : 'Falha ao carregar conversas.');
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api.consoleDetail(id);
      if (selectedRef.current === id) setDetail(d);
      setDetailError(null);
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : 'Falha ao carregar a conversa.');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setDetail(null);
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);

  // Eventos podem chegar em rajada (agent + sistema): agrupa os refetches.
  const timer = useRef<number | undefined>(undefined);
  useStream(
    '/api/console/stream',
    (e) => {
      if (e.type === 'typing') return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void loadList();
        if (selectedRef.current && e.conversationId === selectedRef.current) void loadDetail(selectedRef.current);
      }, 150);
    },
    () => {
      void loadList();
      if (selectedRef.current) void loadDetail(selectedRef.current);
    },
  );

  const needs = items?.filter((c) => c.status === 'waiting_agent').length ?? 0;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? [])
      .filter((c) => (filter === 'needs' ? c.status === 'waiting_agent' : filter === 'agent' ? c.status === 'agent' : filter === 'mine' ? c.assignedTo === user?.id && c.status === 'human' : true))
      .filter((c) => !q || c.employee.name.toLowerCase().includes(q) || (c.lastMessage?.text.toLowerCase().includes(q) ?? false) || (c.handoffSummary?.toLowerCase().includes(q) ?? false));
  }, [items, filter, query, user?.id]);

  if (!user) return null;

  return (
    <div className="console">
      <nav className="rail">
        <Mark size={22} color="#037AF6" />
        <div className="rail-btn active" title="Conversas">
          <Inbox size={19} />
          {needs > 0 && <span className="badge">{needs}</span>}
        </div>
        <div className="grow" />
        <button className="rail-btn" onClick={() => signOut()} title="Sair">
          <LogOut size={18} />
        </button>
        <div className="rail-me" title={`${user.name} · ${user.team ?? ''}`}>
          <Avatar name={user.name} size={36} />
          <span className="online" />
        </div>
      </nav>

      <section className="list">
        <header className="list-head">
          <div className="list-title">
            <h2>Conversas</h2>
            <span className="pill pill-success pill-dot">Disponível</span>
          </div>
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar conversa ou chamado" aria-label="Pesquisar" />
          </label>
          <div className="filters" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} className={`filter ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
                {f.label}
                {f.id === 'needs' && needs > 0 && <b>{needs}</b>}
              </button>
            ))}
          </div>
        </header>
        <div className="items">
          {!items && !listError && <div className="state-mini"><LoaderCircle className="spin" size={18} /> Carregando…</div>}
          {listError && (
            <div className="state-mini">
              <CircleAlert size={18} /> {listError} <button className="btn btn-outline btn-sm" onClick={() => void loadList()}>Tentar de novo</button>
            </div>
          )}
          {items && visible.length === 0 && <div className="state-mini muted">Nenhuma conversa neste filtro.</div>}
          {visible.map((c) => (
            <button key={c.id} className={`item ${selected === c.id ? 'on' : ''}`} onClick={() => setSelected(c.id)}>
              <Avatar name={c.employee.name} size={46} bg={avatarBg(c.employee.id)} />
              <div className="item-text">
                <div className="item-top">
                  <b>{c.employee.name}</b>
                  <span>{shortStamp(c.updatedAt)}</span>
                </div>
                <div className="item-preview">{c.lastMessage ? `${c.lastMessage.role === 'user' ? '' : c.lastMessage.role === 'system' ? '' : 'Nexo: '}${c.lastMessage.text}` : 'Sem mensagens'}</div>
                <ItemStatus c={c} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <ConversationPane detail={detail} error={detailError} me={user.id} onChanged={() => { void loadList(); void loadDetail(selected); }} />
      ) : (
        <div className="pane-empty">
          <Inbox size={30} />
          <p>Selecione uma conversa para ver o histórico e as decisões do agent.</p>
        </div>
      )}
    </div>
  );
}

function ItemStatus({ c }: { c: ConsoleItem }) {
  if (c.status === 'waiting_agent') {
    const low = c.handoffConfidence !== null && c.handoffConfidence < 0.5;
    return <span className="item-status warn">{low ? `Agent pediu ajuda · confiança ${Math.round((c.handoffConfidence ?? 0) * 100)}%` : `Transferida · ${c.team}`}{c.handoffAt ? ` · ${relative(c.handoffAt)}` : ''}</span>;
  }
  if (c.status === 'human') return <span className="item-status primary">Com {c.assignedName ?? 'analista'}</span>;
  if (c.status === 'closed') return <span className="item-status muted">Encerrada</span>;
  return <span className="item-status ok">Agent atendendo</span>;
}

function ConversationPane({ detail, error, me, onChanged }: { detail: ConsoleDetail | null; error: string | null; me: string; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [detail?.messages.length, detail?.conversation.id]);

  if (error && !detail) return <div className="pane-empty"><CircleAlert size={28} /><p>{error}</p></div>;
  if (!detail) return <div className="pane-empty"><LoaderCircle className="spin" size={24} /></div>;

  const { conversation: conv, employee, messages, tickets } = detail;
  const mine = conv.status === 'human' && conv.assignedTo === me;
  const first = employee.name.split(' ')[0]!;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Ação não concluída.');
    } finally {
      setBusy(null);
    }
  };

  const sendReply = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void run('reply', () => api.reply(conv.id, t).catch((e) => { setText(t); throw e; }));
  };

  return (
    <>
      <section className="convo">
        <header className="convo-head">
          <Avatar name={employee.name} size={40} bg={avatarBg(employee.id)} />
          <div className="convo-who">
            <b>{employee.name}</b>
            <span>
              {employee.department} · {employee.device} · {conv.channel === 'whatsapp' ? <><Smartphone size={11} /> WhatsApp</> : <><Globe size={11} /> Web</>}
            </span>
          </div>
          <ModePill status={conv.status} mine={mine} />
        </header>

        <div className="convo-messages">
          {conv.handoffSummary && conv.status !== 'agent' && (
            <div className="handoff-card">
              <div className="handoff-card-head">
                <Hourglass size={15} /> <b>Resumo do agent para o analista</b>
                {conv.handoffConfidence !== null && <span className="tag">confiança {Math.round(conv.handoffConfidence * 100)}%</span>}
              </div>
              <p>{conv.handoffSummary}</p>
              <div className="muted">Motivo: {conv.handoffReason} · {conv.team}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <ConsoleMessage key={m.id} m={m} showDay={i === 0 || fmtDay(m.createdAt) !== fmtDay(messages[i - 1]!.createdAt)} />
          ))}
          <div ref={bottom} />
        </div>

        <footer className="takeover">
          {actionError && <div className="inline-error" role="alert">{actionError}</div>}
          {conv.status === 'waiting_agent' && (
            <div className="takeover-row">
              <span className="warn-ico"><Hourglass size={17} /></span>
              <div className="grow">
                <b>{first} espera um atendente</b>
                <div className="muted">Agent pausado · ele não responde até você devolver</div>
              </div>
              <button className="btn btn-cta" disabled={!!busy} onClick={() => void run('take', () => api.take(conv.id))}>
                {busy === 'take' ? <LoaderCircle size={15} className="spin" /> : <UserCheck size={15} />} Assumir atendimento
              </button>
            </div>
          )}
          {conv.status === 'human' && (
            <>
              <div className="takeover-row">
                <div className="grow">
                  <b>{mine ? 'Você está atendendo' : `Com ${conv.assignedTo ? 'outro analista' : 'analista'}`}</b>
                  <div className="muted">Agent pausado nesta conversa</div>
                </div>
                {mine && (
                  <>
                    <button className="btn btn-outline" disabled={!!busy} onClick={() => void run('return', () => api.release(conv.id))}>
                      <Undo2 size={15} /> Devolver ao agent
                    </button>
                    <button className="btn btn-outline" disabled={!!busy} onClick={() => void run('close', () => api.close(conv.id))}>
                      <CircleCheckBig size={15} /> Encerrar atendimento
                    </button>
                  </>
                )}
              </div>
              <div className="console-composer">
                <textarea
                  rows={1}
                  disabled={!mine}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  placeholder={mine ? `Responder a ${first}…` : 'Assuma o atendimento para responder'}
                  aria-label="Resposta"
                />
                <button className="btn btn-primary" disabled={!mine || !text.trim()} onClick={sendReply}><SendHorizontal size={15} /></button>
              </div>
            </>
          )}
          {conv.status === 'agent' && (
            <div className="takeover-row">
              <div className="grow"><b>O agent está atendendo</b><div className="muted">Você pode assumir a qualquer momento.</div></div>
              <button className="btn btn-outline" disabled={!!busy} onClick={() => void run('take', async () => { await api.take(conv.id).catch(() => undefined); })}>Assumir</button>
            </div>
          )}
          {conv.status === 'closed' && <div className="takeover-row"><div className="grow muted">Conversa encerrada.</div></div>}
        </footer>
      </section>

      <TicketPanel name={first} tickets={tickets} summary={conv.handoffSummary} messages={messages} />
    </>
  );
}

function ModePill({ status, mine }: { status: string; mine: boolean }) {
  if (status === 'waiting_agent') return <span className="pill pill-warning">Aguardando atendente</span>;
  if (status === 'human') return <span className={`pill ${mine ? 'pill-success' : 'pill-primary'}`}>{mine ? 'Você está atendendo' : 'Em atendimento'}</span>;
  if (status === 'closed') return <span className="pill pill-muted">Encerrada</span>;
  return <span className="pill pill-primary">Agent atendendo</span>;
}

function ConsoleMessage({ m, showDay }: { m: Message; showDay: boolean }) {
  return (
    <>
      {showDay && <div className="day"><span>{fmtDay(m.createdAt)}</span></div>}
      {m.role === 'system' ? (
        <div className="sys"><span className="sys-line" /><span className="sys-text">{m.text} · {fmtTime(m.createdAt)}</span><span className="sys-line" /></div>
      ) : m.role === 'user' ? (
        <div className="c-msg c-client"><div className="c-bubble">{m.text}</div><div className="meta">{fmtTime(m.createdAt)}</div></div>
      ) : (
        <div className="c-msg c-agent">
          <div className="sender">{m.role === 'analyst' ? `${m.senderName} · Suporte` : 'Nexo Assist'}</div>
          {m.trace && <ActionChips trace={m.trace} />}
          <div className="c-bubble">{m.text}</div>
          {m.blocks.map((b, i) => <BlockView key={i} block={b} actions={NOOP_ACTIONS} />)}
          <div className="meta">{fmtTime(m.createdAt)}</div>
        </div>
      )}
    </>
  );
}

function TicketPanel({ name, tickets, summary, messages }: { name: string; tickets: TicketCard[]; summary: string | null; messages: Message[] }) {
  const currentId = useMemo(() => {
    const fromSummary = summary?.match(/\b(?:INC|REQ)-\d+\b/)?.[0];
    if (fromSummary) return fromSummary;
    for (const m of [...messages].reverse()) for (const b of m.blocks) if (b.type === 'ticket') return b.ticket.id;
    return null;
  }, [summary, messages]);
  const current = tickets.find((t) => t.id === currentId);
  const others = tickets.filter((t) => t.id !== currentId);
  const open = tickets.filter((t) => ['open', 'in_progress', 'waiting_analyst'].includes(t.status)).length;

  return (
    <aside className="history">
      <header>
        <b>Chamados de {name}</b>
        <span className="muted">{open} abertos · {tickets.length - open} encerrados</span>
      </header>
      <div className="history-body">
        {current && (
          <div>
            <div className="label">Desta conversa</div>
            <div className="current">
              <div className="ticket-id">{current.id}</div>
              <b>{current.title}</b>
              <div className="muted">{current.category} · prioridade {PRIORITY_LABEL[current.priority].toLowerCase()}</div>
              <StatusPill ticket={current} />
              {current.status === 'waiting_analyst' && <div className="muted">Transferido para um analista</div>}
              {current.overdue && <div className="overdue">Sem atualização {relative(current.updatedAt).replace('há ', 'há ')}, prazo vencido.</div>}
            </div>
          </div>
        )}
        <div>
          <div className="label">{current ? 'Outros chamados' : 'Chamados'}</div>
          {others.length === 0 && <div className="muted">Nenhum outro chamado.</div>}
          {others.map((t) => (
            <div key={t.id} className="hist-row">
              <b>{t.title}</b>
              <span className="muted"><span className="mono">{t.id}</span> · <StatusPill ticket={t} /></span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
