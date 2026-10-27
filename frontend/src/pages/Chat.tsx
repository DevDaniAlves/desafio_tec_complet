import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CircleAlert, LoaderCircle, MessageCirclePlus, RefreshCw, SendHorizontal, Smartphone, UserRound } from 'lucide-react';
import { ApiError, api, type DraftPayload, type LiveEvent, type Message, type SessionPayload } from '../api';
import { BlockView, type BlockActions } from '../components/Blocks';
import { Avatar, Mark } from '../components/Mark';
import { ActionChips } from '../components/Trace';
import { fmtDay, fmtTime } from '../format';
import { useStream } from '../useStream';

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: SessionPayload };

export function Chat() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad({ kind: 'ready', data: await api.session() });
    } catch (e) {
      setLoad({ kind: 'error', message: e instanceof ApiError ? e.message : 'Não foi possível carregar a conversa.' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useStream(
    '/api/chat/stream',
    (e: LiveEvent) => {
      if (e.type === 'typing') return setTyping(e.active);
      if (e.type === 'conversation') return void refresh();
      setLoad((cur) => {
        if (cur.kind !== 'ready') return cur;
        if (e.conversationId !== cur.data.conversation.id) {
          void refresh();
          return cur;
        }
        if (cur.data.messages.some((m) => m.id === e.message.id)) return cur;
        const conversation = e.message.role === 'user' ? { ...cur.data.conversation, userMsgCount: cur.data.conversation.userMsgCount + 1 } : cur.data.conversation;
        return { kind: 'ready', data: { ...cur.data, conversation, messages: [...cur.data.messages, e.message] } };
      });
      // mensagens podem mudar o estado de rascunhos já exibidos (confirmado/cancelado)
      if (e.message.role !== 'user') void refresh();
    },
    () => void refresh(),
  );

  const data = load.kind === 'ready' ? load.data : null;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.messages.length, typing]);

  const conv = data?.conversation;
  const used = conv?.userMsgCount ?? 0;
  const limitReached = !!data && used >= data.limit;
  const closed = conv?.status === 'closed';
  const paused = conv?.status === 'waiting_agent' || conv?.status === 'human';
  const canWrite = !!conv && !closed && !limitReached;

  const send = useCallback(
    async (t: string) => {
      const value = t.trim();
      if (!value) return;
      setSendError(null);
      setText('');
      try {
        await api.send(value);
      } catch (e) {
        setText(value);
        setSendError(e instanceof ApiError ? e.message : 'Não foi possível enviar.');
      }
    },
    [],
  );

  const startNew = async () => {
    try {
      setLoad({ kind: 'ready', data: await api.newSession() });
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : 'Não foi possível iniciar uma nova conversa.');
    }
  };

  const lastId = data?.messages.at(-1)?.id;
  const actions = (m: Message): BlockActions => ({
    send: (t) => void send(t),
    confirm: async (id) => {
      await api.draft(id, 'confirm');
    },
    cancel: async (id) => {
      await api.draft(id, 'cancel');
    },
    edit: (d: DraftPayload) => {
      setText(`Quero ajustar o rascunho "${d.title}": `);
      input.current?.focus();
    },
    interactive: canWrite && (m.id === lastId || m.blocks.some((b) => b.type === 'draft' && b.state === 'pending')),
  });

  const pendingDraft = useMemo(() => data?.messages.flatMap((m) => m.blocks).find((b) => b.type === 'draft' && b.state === 'pending'), [data?.messages]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !text.trim() && pendingDraft?.type === 'draft') {
      e.preventDefault();
      void api.draft(pendingDraft.draftId, 'confirm');
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(text);
    }
  };

  if (load.kind === 'loading') return <ChatSkeleton />;
  if (load.kind === 'error') {
    return (
      <div className="state-center">
        <CircleAlert size={28} />
        <p>{load.message}</p>
        <button className="btn btn-outline" onClick={() => void refresh()}>
          <RefreshCw size={14} /> Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className="chat">
      <div className="messages" role="log" aria-live="polite">
        <div className="messages-inner">
          {data!.messages.length === 0 && <EmptyState onPick={(t) => void send(t)} />}
          {withDays(data!.messages).map((row) =>
            row.kind === 'day' ? (
              <div key={row.key} className="day">
                <span>{row.label}</span>
              </div>
            ) : (
              <MessageRow key={row.m.id} m={row.m} actions={actions(row.m)} />
            ),
          )}
          {typing && (
            <div className="msg msg-agent">
              <div className="msg-avatar">
                <Mark size={14} color="#fff" />
              </div>
              <div className="bubble typing" aria-label="Nexo Assist está digitando">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="composer-area">
        <div className="composer-inner">
          {paused && (
            <div className="banner banner-warn">
              <UserRound size={15} />
              {conv!.status === 'human' ? 'Você está conversando com um analista. O assistente está pausado.' : 'Um analista vai falar com você em breve. O assistente está pausado.'}
            </div>
          )}
          {(closed || limitReached) && (
            <div className="banner">
              <span>{closed ? 'Este atendimento foi encerrado.' : `Você atingiu o limite de ${data!.limit} mensagens desta sessão.`}</span>
              <button className="btn btn-primary btn-sm" onClick={() => void startNew()}>
                <MessageCirclePlus size={14} /> Nova conversa
              </button>
            </div>
          )}
          {sendError && (
            <div className="inline-error" role="alert">
              {sendError}
            </div>
          )}
          <div className="composer">
            <textarea
              ref={input}
              rows={1}
              value={text}
              disabled={!canWrite}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder={canWrite ? 'Escreva para o Nexo…' : 'Conversa indisponível'}
              maxLength={2000}
              aria-label="Mensagem"
            />
            <button className="btn btn-primary" disabled={!canWrite || !text.trim()} onClick={() => void send(text)}>
              <SendHorizontal size={15} /> Enviar
            </button>
          </div>
          <div className="composer-foot">
            <span>
              {used}/{data!.limit} mensagens nesta sessão
            </span>
            <span>Enter envia · Shift+Enter quebra a linha</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type Row = { kind: 'day'; key: string; label: string } | { kind: 'msg'; m: Message };

function withDays(messages: Message[]): Row[] {
  const rows: Row[] = [];
  let last = '';
  for (const m of messages) {
    const day = fmtDay(m.createdAt);
    if (day !== last) {
      rows.push({ kind: 'day', key: `d-${m.id}`, label: day === fmtDay(new Date().toISOString()) ? 'Hoje' : day });
      last = day;
    }
    rows.push({ kind: 'msg', m });
  }
  return rows;
}

function MessageRow({ m, actions }: { m: Message; actions: BlockActions }) {
  if (m.role === 'system') {
    return (
      <div className="sys">
        <span className="sys-line" />
        <span className="sys-text">
          {m.text}
          {m.blocks.map((b, i) => (
            <span key={i}>
              {' '}
              <BlockView block={b} actions={actions} />
            </span>
          ))}
        </span>
        <span className="sys-line" />
      </div>
    );
  }

  if (m.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="bubble bubble-user">{m.text}</div>
        <div className="meta">
          {m.channel === 'whatsapp' && <Smartphone size={11} />} {fmtTime(m.createdAt)}
        </div>
      </div>
    );
  }

  const isAnalyst = m.role === 'analyst';
  return (
    <div className="msg msg-agent">
      <div className="msg-avatar">{isAnalyst ? <Avatar name={m.senderName ?? 'Analista'} size={28} /> : <Mark size={14} color="#fff" />}</div>
      <div className="msg-body">
        <div className="sender">
          {isAnalyst ? `${m.senderName} · Suporte` : 'Nexo Assist'} <span>{fmtTime(m.createdAt)}</span>
        </div>
        {m.trace && <ActionChips trace={m.trace} />}
        {m.text && <div className="bubble bubble-agent">{m.text}</div>}
        {m.blocks.map((b, i) => (
          <BlockView key={i} block={b} actions={actions} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  const ideas = ['Meu notebook não conecta na VPN. Erro 809.', 'Qual o status do meu chamado?', 'Preciso de acesso a uma pasta no SharePoint', 'Qual o horário do service desk?'];
  return (
    <div className="empty">
      <div className="empty-mark">
        <Mark size={26} color="#fff" />
      </div>
      <h2 className="display">Como posso ajudar com TI hoje?</h2>
      <p className="muted">Descreva o problema com suas palavras. Eu consulto seus chamados e a central de ajuda antes de abrir qualquer coisa.</p>
      <div className="ideas">
        {ideas.map((i) => (
          <button key={i} className="idea" onClick={() => onPick(i)}>
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="state-center" aria-busy="true">
      <LoaderCircle className="spin" size={24} />
      <p className="muted">Carregando sua conversa…</p>
    </div>
  );
}
