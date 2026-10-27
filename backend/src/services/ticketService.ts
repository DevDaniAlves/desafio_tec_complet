import type { Db } from '../db.js';
import { nowIso } from '../db.js';
import { canReopen, dueDate, isOpen, slaState } from '../domain/sla.js';
import type { Affected, Category, Priority, Ticket, TicketStatus, TicketType, TicketView } from '../domain/types.js';

/**
 * Serviço de chamados SIMULADO. Representa o sistema legado: o agent só fala com ele por esta interface
 * e todo acesso é filtrado por `employeeId` — a privacidade é garantida aqui, não no prompt.
 */
export class LegacyUnavailableError extends Error {
  constructor() {
    super('Sistema de chamados indisponível no momento');
  }
}

export class TicketNotFoundError extends Error {
  constructor(id: string) {
    super(`Chamado ${id} não encontrado`);
  }
}

export class TicketRuleError extends Error {}

interface Row {
  id: string;
  employee_id: string;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: TicketStatus;
  affected: Affected;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const toTicket = (r: Row): Ticket => ({
  id: r.id,
  employeeId: r.employee_id,
  type: r.type,
  title: r.title,
  description: r.description,
  category: r.category,
  priority: r.priority,
  status: r.status,
  affected: r.affected,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  resolvedAt: r.resolved_at,
});

export const withSla = (t: Ticket, now = new Date()): TicketView => ({ ...t, ...slaState(t, now) });

export interface NewTicket {
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  affected: Affected;
}

export interface TicketServiceOptions {
  failureRate?: number;
  retries?: number;
  retryDelayMs?: number;
  random?: () => number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TicketService {
  private readonly failureRate: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly random: () => number;

  constructor(
    private readonly db: Db,
    opts: TicketServiceOptions = {},
  ) {
    this.failureRate = opts.failureRate ?? 0;
    this.retries = opts.retries ?? 3;
    this.retryDelayMs = opts.retryDelayMs ?? 250;
    this.random = opts.random ?? Math.random;
  }

  /** Simula a instabilidade do legado e absorve falhas curtas com retry + backoff. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (this.random() >= this.failureRate) return fn();
      if (attempt < this.retries) await sleep(this.retryDelayMs * 2 ** attempt);
    }
    throw new LegacyUnavailableError();
  }

  listByEmployee(employeeId: string, opts: { onlyOpen?: boolean } = {}): Promise<TicketView[]> {
    return this.call(() => this.listAll(employeeId, opts));
  }

  /** Sem a instabilidade simulada: usado pelo console (dados internos do service desk). */
  async listAll(employeeId: string, opts: { onlyOpen?: boolean } = {}): Promise<TicketView[]> {
    const rows = await this.db.all<Row>('SELECT * FROM tickets WHERE employee_id = $1 ORDER BY updated_at DESC', [employeeId]);
    const now = new Date();
    const all = rows.map((r) => withSla(toTicket(r), now));
    return opts.onlyOpen ? all.filter(isOpen) : all;
  }

  /** Devolve null tanto para "não existe" quanto para "é de outra pessoa": não vaza existência. */
  getForEmployee(employeeId: string, id: string): Promise<TicketView | null> {
    return this.call(async () => {
      const row = await this.db.get<Row>('SELECT * FROM tickets WHERE id = $1 AND employee_id = $2', [id, employeeId]);
      return row ? withSla(toTicket(row)) : null;
    });
  }

  create(employeeId: string, data: NewTicket): Promise<TicketView> {
    return this.call(async () => {
      const id = await this.nextId(data.type);
      const now = nowIso();
      await this.db.run(
        `INSERT INTO tickets (id, employee_id, type, title, description, category, priority, status, affected, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $9)`,
        [id, employeeId, data.type, data.title, data.description, data.category, data.priority, data.affected, now],
      );
      await this.addEvent(id, 'Chamado criado pelo Nexo Assist');
      return this.reload(id);
    });
  }

  update(employeeId: string, id: string, patch: { note: string; priority?: Priority }): Promise<TicketView> {
    return this.call(async () => {
      const t = await this.mustOwn(employeeId, id);
      if (!isOpen(t)) throw new TicketRuleError(`O chamado ${id} não está aberto; só chamados abertos podem ser atualizados.`);
      const now = nowIso();
      const description = `${t.description}\n\n[${now.slice(0, 10)}] ${patch.note}`;
      await this.db.run('UPDATE tickets SET description = $1, priority = $2, updated_at = $3 WHERE id = $4', [description, patch.priority ?? t.priority, now, id]);
      await this.addEvent(id, `Atualizado: ${patch.note}`);
      return this.reload(id);
    });
  }

  reopen(employeeId: string, id: string, note: string): Promise<TicketView> {
    return this.call(async () => {
      const t = await this.mustOwn(employeeId, id);
      if (!canReopen(t)) throw new TicketRuleError(`O chamado ${id} não pode ser reaberto (só resolvidos há até 7 dias).`);
      const now = nowIso();
      await this.db.run("UPDATE tickets SET status = 'open', resolved_at = NULL, description = $1, updated_at = $2 WHERE id = $3", [
        `${t.description}\n\n[${now.slice(0, 10)}] Reaberto: ${note}`,
        now,
        id,
      ]);
      await this.addEvent(id, `Reaberto: ${note}`);
      return this.reload(id);
    });
  }

  /** Marca o chamado como aguardando analista (transferência). */
  async markWaitingAnalyst(employeeId: string, id: string): Promise<void> {
    await this.call(async () => {
      await this.mustOwn(employeeId, id);
      await this.db.run("UPDATE tickets SET status = 'waiting_analyst' WHERE id = $1 AND status IN ('open','in_progress')", [id]);
    });
  }

  dueFor(priority: Priority, from = new Date()): string {
    return dueDate(priority, from).toISOString();
  }

  private async reload(id: string): Promise<TicketView> {
    return withSla(toTicket((await this.db.get<Row>('SELECT * FROM tickets WHERE id = $1', [id]))!));
  }

  private async mustOwn(employeeId: string, id: string): Promise<Ticket> {
    const row = await this.db.get<Row>('SELECT * FROM tickets WHERE id = $1 AND employee_id = $2', [id, employeeId]);
    if (!row) throw new TicketNotFoundError(id);
    return toTicket(row);
  }

  private async nextId(type: TicketType): Promise<string> {
    const start = type === 'INC' ? 20500 : 10500;
    const key = `ticket_${type}`;
    await this.db.run('INSERT INTO counters (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [key, start]);
    const row = await this.db.get<{ value: number }>('UPDATE counters SET value = value + 1 WHERE name = $1 RETURNING value', [key]);
    return `${type}-${row!.value}`;
  }

  private async addEvent(ticketId: string, note: string): Promise<void> {
    await this.db.run('INSERT INTO ticket_events (ticket_id, at, note) VALUES ($1, $2, $3)', [ticketId, nowIso(), note]);
  }
}
