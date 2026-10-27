import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import { nowIso } from '../db.js';
import type { Block, Channel, ConversationStatus, DraftPayload, Trace } from '../domain/types.js';
import type { Broker } from './broker.js';

export interface Conversation {
  id: string;
  employeeId: string;
  status: ConversationStatus;
  channel: Channel;
  assignedTo: string | null;
  team: string | null;
  handoffReason: string | null;
  handoffSummary: string | null;
  handoffConfidence: number | null;
  handoffAt: string | null;
  userMsgCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'analyst' | 'system';
  text: string;
  blocks: Block[];
  trace: Trace | null;
  channel: Channel;
  senderName: string | null;
  createdAt: string;
}

export interface Draft {
  id: string;
  conversationId: string;
  employeeId: string;
  payload: DraftPayload;
  state: 'pending' | 'confirmed' | 'cancelled';
  ticketId: string | null;
}

interface ConvRow {
  id: string;
  employee_id: string;
  status: ConversationStatus;
  channel: Channel;
  assigned_to: string | null;
  team: string | null;
  handoff_reason: string | null;
  handoff_summary: string | null;
  handoff_confidence: number | null;
  handoff_at: string | null;
  user_msg_count: number;
  created_at: string;
  updated_at: string;
}

interface MsgRow {
  id: string;
  conversation_id: string;
  role: Message['role'];
  text: string;
  blocks: Block[];
  trace: Trace | null;
  channel: Channel;
  sender_name: string | null;
  created_at: string;
}

interface DraftRow {
  id: string;
  conversation_id: string;
  employee_id: string;
  payload: DraftPayload;
  state: Draft['state'];
  ticket_id: string | null;
}

const toConv = (r: ConvRow): Conversation => ({
  id: r.id,
  employeeId: r.employee_id,
  status: r.status,
  channel: r.channel,
  assignedTo: r.assigned_to,
  team: r.team,
  handoffReason: r.handoff_reason,
  handoffSummary: r.handoff_summary,
  handoffConfidence: r.handoff_confidence,
  handoffAt: r.handoff_at,
  userMsgCount: r.user_msg_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toMessage = (r: MsgRow, drafts?: Map<string, Draft>): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  text: r.text,
  blocks: drafts ? r.blocks.map((b) => (b.type === 'draft' ? { ...b, state: drafts.get(b.draftId)?.state ?? b.state } : b)) : r.blocks,
  trace: r.trace,
  channel: r.channel,
  senderName: r.sender_name,
  createdAt: r.created_at,
});

const toDraft = (r: DraftRow): Draft => ({ id: r.id, conversationId: r.conversation_id, employeeId: r.employee_id, payload: r.payload, state: r.state, ticketId: r.ticket_id });

export interface NewMessage {
  role: Message['role'];
  text: string;
  blocks?: Block[];
  trace?: Trace | null;
  channel: Channel;
  senderName?: string | null;
  externalId?: string | null;
}

export class ConversationService {
  constructor(
    private readonly db: Db,
    private readonly broker: Broker,
  ) {}

  /** Conversa ativa do funcionário (a "sessão"); cria uma nova se a anterior foi encerrada. */
  async getOrCreateActive(employeeId: string, channel: Channel): Promise<Conversation> {
    const row = await this.db.get<ConvRow>("SELECT * FROM conversations WHERE employee_id = $1 AND status != 'closed' ORDER BY created_at DESC LIMIT 1", [employeeId]);
    if (row) return toConv(row);
    const id = randomUUID();
    const now = nowIso();
    await this.db.run("INSERT INTO conversations (id, employee_id, status, channel, created_at, updated_at) VALUES ($1, $2, 'agent', $3, $4, $4)", [id, employeeId, channel, now]);
    this.broker.publishConversation(id, { type: 'conversation', conversationId: id });
    return (await this.get(id))!;
  }

  /** Conversa mais recente do funcionário, mesmo encerrada (para a UI mostrar o desfecho). */
  async latest(employeeId: string): Promise<Conversation | null> {
    const row = await this.db.get<ConvRow>('SELECT * FROM conversations WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1', [employeeId]);
    return row ? toConv(row) : null;
  }

  async get(id: string): Promise<Conversation | null> {
    const row = await this.db.get<ConvRow>('SELECT * FROM conversations WHERE id = $1', [id]);
    return row ? toConv(row) : null;
  }

  async messages(conversationId: string): Promise<Message[]> {
    const [rows, drafts] = await Promise.all([
      this.db.all<MsgRow>('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY seq', [conversationId]),
      this.drafts(conversationId),
    ]);
    const byId = new Map(drafts.map((d) => [d.id, d]));
    return rows.map((r) => toMessage(r, byId));
  }

  /** Idempotência para webhooks: o WhatsApp pode reentregar a mesma mensagem. */
  async hasExternalId(externalId: string): Promise<boolean> {
    return !!(await this.db.get('SELECT 1 AS x FROM messages WHERE external_id = $1', [externalId]));
  }

  async addMessage(conversationId: string, m: NewMessage): Promise<Message> {
    const id = randomUUID();
    const now = nowIso();
    const blocks = m.blocks ?? [];
    await this.db.run(
      `INSERT INTO messages (id, conversation_id, role, text, blocks, trace, channel, sender_name, external_id, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
      [id, conversationId, m.role, m.text, JSON.stringify(blocks), m.trace ? JSON.stringify(m.trace) : null, m.channel, m.senderName ?? null, m.externalId ?? null, now],
    );
    await this.db.run("UPDATE conversations SET updated_at = $1, channel = CASE WHEN $2::text = 'user' THEN $3::text ELSE channel END WHERE id = $4", [now, m.role, m.channel, conversationId]);
    if (m.role === 'user') await this.db.run('UPDATE conversations SET user_msg_count = user_msg_count + 1 WHERE id = $1', [conversationId]);
    const message: Message = { id, conversationId, role: m.role, text: m.text, blocks, trace: m.trace ?? null, channel: m.channel, senderName: m.senderName ?? null, createdAt: now };
    this.broker.publishConversation(conversationId, { type: 'message', conversationId, message });
    return message;
  }

  setTyping(conversationId: string, active: boolean, steps?: string[]): void {
    this.broker.publishConversation(conversationId, { type: 'typing', conversationId, active, ...(steps ? { steps } : {}) });
  }

  async handoff(conversationId: string, h: { team: string; reason: string; summary: string; confidence: number }): Promise<void> {
    const now = nowIso();
    await this.db.run(
      "UPDATE conversations SET status = 'waiting_agent', team = $1, handoff_reason = $2, handoff_summary = $3, handoff_confidence = $4, handoff_at = $5, assigned_to = NULL, updated_at = $5 WHERE id = $6",
      [h.team, h.reason, h.summary, h.confidence, now, conversationId],
    );
    this.broker.publishConversation(conversationId, { type: 'conversation', conversationId });
  }

  async take(conversationId: string, analystId: string): Promise<boolean> {
    const changed = await this.db.run(
      "UPDATE conversations SET status = 'human', assigned_to = $1, updated_at = $2 WHERE id = $3 AND status IN ('waiting_agent','human') AND (assigned_to IS NULL OR assigned_to = $1)",
      [analystId, nowIso(), conversationId],
    );
    if (changed) this.broker.publishConversation(conversationId, { type: 'conversation', conversationId });
    return changed > 0;
  }

  async release(conversationId: string): Promise<void> {
    await this.db.run("UPDATE conversations SET status = 'agent', assigned_to = NULL, updated_at = $1 WHERE id = $2", [nowIso(), conversationId]);
    this.broker.publishConversation(conversationId, { type: 'conversation', conversationId });
  }

  async close(conversationId: string): Promise<void> {
    await this.db.run("UPDATE conversations SET status = 'closed', updated_at = $1 WHERE id = $2", [nowIso(), conversationId]);
    this.broker.publishConversation(conversationId, { type: 'conversation', conversationId });
  }

  // --- rascunhos de chamado ---

  async createDraft(conversationId: string, employeeId: string, payload: DraftPayload): Promise<Draft> {
    const row = await this.db.get<{ value: number }>(
      "INSERT INTO counters (name, value) VALUES ('draft', 380) ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value",
    );
    const id = `D-${row!.value}`;
    await this.db.run('INSERT INTO drafts (id, conversation_id, employee_id, payload, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)', [id, conversationId, employeeId, JSON.stringify(payload), nowIso()]);
    return (await this.getDraft(id))!;
  }

  async getDraft(id: string): Promise<Draft | null> {
    const r = await this.db.get<DraftRow>('SELECT * FROM drafts WHERE id = $1', [id]);
    return r ? toDraft(r) : null;
  }

  async pendingDraft(conversationId: string): Promise<Draft | null> {
    const r = await this.db.get<DraftRow>("SELECT * FROM drafts WHERE conversation_id = $1 AND state = 'pending' ORDER BY created_at DESC LIMIT 1", [conversationId]);
    return r ? toDraft(r) : null;
  }

  private async drafts(conversationId: string): Promise<Draft[]> {
    return (await this.db.all<DraftRow>('SELECT * FROM drafts WHERE conversation_id = $1', [conversationId])).map(toDraft);
  }

  /** Transição atômica: só um clique/resposta consegue confirmar ou cancelar um rascunho pendente. */
  async resolveDraft(id: string, state: 'confirmed' | 'cancelled', ticketId: string | null = null): Promise<boolean> {
    return (await this.db.run("UPDATE drafts SET state = $1, ticket_id = $2 WHERE id = $3 AND state = 'pending'", [state, ticketId, id])) > 0;
  }

  async linkDraftTicket(id: string, ticketId: string): Promise<void> {
    await this.db.run('UPDATE drafts SET ticket_id = $1 WHERE id = $2', [ticketId, id]);
  }

  /** Desfaz a reserva feita na confirmação quando o sistema de chamados falhou. */
  async revertDraft(id: string): Promise<void> {
    await this.db.run("UPDATE drafts SET state = 'pending', ticket_id = NULL WHERE id = $1", [id]);
  }

  /** Supersede rascunhos pendentes antigos quando um novo é criado. */
  async cancelPendingDrafts(conversationId: string): Promise<void> {
    await this.db.run("UPDATE drafts SET state = 'cancelled' WHERE conversation_id = $1 AND state = 'pending'", [conversationId]);
  }

  // --- console ---

  async listForConsole(): Promise<(Conversation & { lastMessage: Message | null })[]> {
    const rows = await this.db.all<ConvRow & { last: MsgRow | null }>(
      `SELECT c.*, to_jsonb(m.*) - 'seq' AS last
       FROM conversations c
       LEFT JOIN LATERAL (SELECT * FROM messages WHERE conversation_id = c.id ORDER BY seq DESC LIMIT 1) m ON true
       ORDER BY c.updated_at DESC`,
    );
    return rows.map((r) => ({ ...toConv(r), lastMessage: r.last ? toMessage(r.last) : null }));
  }
}
