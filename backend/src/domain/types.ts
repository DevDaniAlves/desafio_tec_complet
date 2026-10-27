export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CATEGORIES = ['Acesso', 'Rede e VPN', 'Hardware', 'Software', 'E-mail', 'Outros'] as const;
export type Category = (typeof CATEGORIES)[number];

export const TICKET_TYPES = ['INC', 'REQ'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_analyst', 'approved', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const AFFECTED = ['self', 'team', 'company'] as const;
export type Affected = (typeof AFFECTED)[number];

export type Role = 'employee' | 'analyst' | 'admin';
export type Channel = 'web' | 'whatsapp';
export type ConversationStatus = 'agent' | 'waiting_agent' | 'human' | 'closed';

export interface Employee {
  id: string;
  name: string;
  email: string;
  department: string;
  phone: string | null;
  device: string;
  role: Role;
  team: string | null;
}

export interface Ticket {
  id: string;
  employeeId: string;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: TicketStatus;
  affected: Affected;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface TicketView extends Ticket {
  dueAt: string | null;
  overdue: boolean;
}

export interface Article {
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface TicketCard {
  id: string;
  title: string;
  description?: string;
  category: Category;
  priority: Priority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  overdue: boolean;
}

export interface DraftPayload {
  action: 'create' | 'update' | 'reopen';
  existingTicketId: string | null;
  title: string;
  description: string;
  type: TicketType;
  category: Category;
  priority: Priority;
  affected: Affected;
  dueAt: string | null;
}

/** Blocos ricos de uma mensagem. A UI web renderiza como cards; o WhatsApp como texto. */
export type Block =
  | { type: 'options'; question: string; options: string[] }
  | { type: 'ticket_list'; tickets: TicketCard[] }
  | { type: 'ticket'; ticket: TicketCard }
  | { type: 'draft'; draftId: string; state: 'pending' | 'confirmed' | 'cancelled'; draft: DraftPayload }
  | { type: 'handoff'; team: string; sla: string };

/** Explicação de uma resposta do agent: o que entendeu, o que fez, com que segurança e por quê. */
export interface Trace {
  model: string;
  intent: string;
  understood: string;
  action: string;
  confidence: number;
  rationale: string;
  steps: TraceStep[];
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export interface TraceStep {
  tool: string;
  label: string;
  input: unknown;
  summary: string;
  ok: boolean;
  durationMs: number;
}
