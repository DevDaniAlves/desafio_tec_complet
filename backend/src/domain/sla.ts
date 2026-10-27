import type { Priority, Ticket, TicketStatus } from './types.js';

/**
 * Horário comercial do service desk: seg-sex, 8h-18h, America/Sao_Paulo (UTC-3, sem horário de verão).
 * Trabalhamos com um "relógio local" deslocado em -3h para usar getUTC* como hora de parede.
 */
const OFFSET_MS = -3 * 3600_000;
const START_HOUR = 8;
const END_HOUR = 18;

const toLocal = (d: Date) => new Date(d.getTime() + OFFSET_MS);
const fromLocal = (d: Date) => new Date(d.getTime() - OFFSET_MS);
const isBusinessDay = (local: Date) => local.getUTCDay() >= 1 && local.getUTCDay() <= 5;

/** Move para o próximo instante dentro do horário comercial (ou o próprio, se já estiver). */
function clampToBusiness(local: Date): Date {
  const d = new Date(local);
  for (let i = 0; i < 10; i++) {
    const h = d.getUTCHours() + d.getUTCMinutes() / 60;
    if (isBusinessDay(d) && h >= START_HOUR && h < END_HOUR) return d;
    if (isBusinessDay(d) && h < START_HOUR) {
      d.setUTCHours(START_HOUR, 0, 0, 0);
      return d;
    }
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(START_HOUR, 0, 0, 0);
  }
  return d;
}

export function addBusinessHours(from: Date, hours: number): Date {
  let cursor = clampToBusiness(toLocal(from));
  let remaining = hours * 60;
  while (remaining > 0) {
    const endOfDay = new Date(cursor);
    endOfDay.setUTCHours(END_HOUR, 0, 0, 0);
    const available = (endOfDay.getTime() - cursor.getTime()) / 60_000;
    if (remaining <= available) {
      cursor = new Date(cursor.getTime() + remaining * 60_000);
      remaining = 0;
    } else {
      remaining -= available;
      cursor = clampToBusiness(new Date(endOfDay.getTime() + 1));
    }
  }
  return fromLocal(cursor);
}

export function addBusinessDays(from: Date, days: number): Date {
  const local = toLocal(from);
  let left = days;
  while (left > 0) {
    local.setUTCDate(local.getUTCDate() + 1);
    if (isBusinessDay(local)) left--;
  }
  return fromLocal(local);
}

export const SLA_LABEL: Record<Priority, string> = {
  critical: '1 hora',
  high: '4 horas úteis',
  medium: '3 dias úteis',
  low: '5 dias úteis',
};

/** Prazo para a próxima resposta/atualização a partir de `from`. */
export function dueDate(priority: Priority, from: Date): Date {
  switch (priority) {
    case 'critical':
      return new Date(from.getTime() + 3600_000);
    case 'high':
      return addBusinessHours(from, 4);
    case 'medium':
      return addBusinessDays(from, 3);
    case 'low':
      return addBusinessDays(from, 5);
  }
}

const OPEN_STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting_analyst'];
export const isOpen = (t: Pick<Ticket, 'status'>) => OPEN_STATUSES.includes(t.status);

/** O prazo vale para a primeira resposta e para cada atualização: conta a partir de `updatedAt`. */
export function slaState(t: Pick<Ticket, 'priority' | 'status' | 'updatedAt'>, now = new Date()) {
  if (!isOpen(t)) return { dueAt: null, overdue: false };
  const due = dueDate(t.priority, new Date(t.updatedAt));
  return { dueAt: due.toISOString(), overdue: now > due };
}

const REOPEN_WINDOW_MS = 7 * 24 * 3600_000;
export function canReopen(t: Pick<Ticket, 'status' | 'resolvedAt'>, now = new Date()): boolean {
  if (t.status !== 'resolved' || !t.resolvedAt) return false;
  return now.getTime() - new Date(t.resolvedAt).getTime() <= REOPEN_WINDOW_MS;
}

export interface Impact {
  affected: 'self' | 'team' | 'company';
  blocksWork: boolean;
  sameDayCommitment: boolean;
  hasWorkaround: boolean;
}

/** Regra do Anexo A: impacto (quantos afetados) × urgência (compromisso em risco). Determinística, fora do LLM. */
export function derivePriority(i: Impact): { priority: Priority; reason: string } {
  if (i.affected !== 'self' && i.blocksWork) return { priority: 'critical', reason: 'Algo parado para uma equipe ou a empresa' };
  if (i.affected === 'company') return { priority: 'critical', reason: 'Impacto em toda a empresa' };
  if (i.blocksWork && !i.hasWorkaround) return { priority: 'high', reason: 'Impede a pessoa de trabalhar' };
  if (i.sameDayCommitment) return { priority: 'high', reason: 'Há um compromisso no mesmo dia em risco' };
  if (i.affected === 'team') return { priority: 'medium', reason: 'Afeta a equipe, mas há alternativa' };
  if (i.hasWorkaround || i.blocksWork) return { priority: 'medium', reason: 'Atrapalha, mas há alternativa' };
  return { priority: 'low', reason: 'Pedido ou melhoria sem urgência' };
}
