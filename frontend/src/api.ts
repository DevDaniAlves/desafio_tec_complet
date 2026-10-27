// Tipos espelham o contrato do backend (backend/src/domain/types.ts e services/conversationService.ts).

export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_analyst' | 'approved' | 'resolved' | 'closed';
export type ConversationStatus = 'agent' | 'waiting_agent' | 'human' | 'closed';

export interface User {
  id: string;
  name: string;
  email: string;
  department: string;
  device: string;
  role: 'employee' | 'analyst' | 'admin';
  team: string | null;
}

export interface TicketCard {
  id: string;
  title: string;
  description?: string;
  category: string;
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
  type: 'INC' | 'REQ';
  category: string;
  priority: Priority;
  affected: 'self' | 'team' | 'company';
  dueAt: string | null;
}

export type Block =
  | { type: 'options'; question: string; options: string[] }
  | { type: 'ticket_list'; tickets: TicketCard[] }
  | { type: 'ticket'; ticket: TicketCard }
  | { type: 'draft'; draftId: string; state: 'pending' | 'confirmed' | 'cancelled'; draft: DraftPayload }
  | { type: 'handoff'; team: string; sla: string };

export interface TraceStep {
  tool: string;
  label: string;
  input: unknown;
  summary: string;
  ok: boolean;
  durationMs: number;
}

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

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'analyst' | 'system';
  text: string;
  blocks: Block[];
  trace: Trace | null;
  channel: 'web' | 'whatsapp';
  senderName: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  employeeId: string;
  status: ConversationStatus;
  channel: 'web' | 'whatsapp';
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

export interface SessionPayload {
  conversation: Conversation;
  messages: Message[];
  limit: number;
}

export interface ConsoleItem extends Conversation {
  employee: User;
  assignedName: string | null;
  lastMessage: Message | null;
}

export interface ConsoleDetail {
  conversation: Conversation;
  employee: User;
  messages: Message[];
  tickets: TicketCard[];
}

export type LiveEvent =
  | { type: 'message'; conversationId: string; message: Message }
  | { type: 'typing'; conversationId: string; active: boolean }
  | { type: 'conversation'; conversationId: string };

export type WhatsAppState = 'open' | 'connecting' | 'close' | 'not_created' | 'unknown';

export interface WhatsAppStatus {
  enabled: boolean;
  instance: string;
  state: WhatsAppState;
  webhook: { url: string | null; enabled: boolean; matches: boolean; expectedUrl: string | null };
}

export interface AdminEmployee {
  id: string;
  name: string;
  email: string;
  department: string;
  phone: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Base da API: vazia em dev (o Vite faz proxy de /api); em produção vem de VITE_API_URL (backend na Railway). */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

const TOKEN_KEY = 'nexo_token';
export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* armazenamento indisponível: sessão só em memória */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Chamado quando o servidor responde 401 com um token salvo (expirou/foi invalidado). */
let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export const authHeaders = (): Record<string, string> => {
  const t = tokenStore.get();
  return t ? { authorization: `Bearer ${t}` } : {};
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...authHeaders(), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Verifique sua rede.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && tokenStore.get() && !path.startsWith('/api/auth/login')) onUnauthorized();
  if (!res.ok) throw new ApiError(data.error ?? 'Algo deu errado. Tente novamente.', res.status);
  return data as T;
}

export const api = {
  login: (email: string, password: string, remember: boolean) => request<{ token: string; expiresIn: number; user: User }>('POST', '/api/auth/login', { email, password, remember }),
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  resetPassword: () => request<{ ok: true; sentTo: string }>('POST', '/api/auth/reset-password'),
  session: () => request<SessionPayload>('GET', '/api/chat/session'),
  newSession: () => request<SessionPayload>('POST', '/api/chat/new-session'),
  send: (text: string) => request<{ accepted: true }>('POST', '/api/chat/messages', { text }),
  draft: (id: string, decision: 'confirm' | 'cancel') => request<{ ok: true }>('POST', `/api/chat/drafts/${id}/${decision}`),
  consoleList: () => request<{ conversations: ConsoleItem[] }>('GET', '/api/console/conversations'),
  consoleDetail: (id: string) => request<ConsoleDetail>('GET', `/api/console/conversations/${id}`),
  take: (id: string) => request<{ ok: true }>('POST', `/api/console/conversations/${id}/take`),
  reply: (id: string, text: string) => request<{ ok: true }>('POST', `/api/console/conversations/${id}/messages`, { text }),
  release: (id: string) => request<{ ok: true }>('POST', `/api/console/conversations/${id}/return`),
  close: (id: string) => request<{ ok: true }>('POST', `/api/console/conversations/${id}/close`),
  whatsapp: () => request<WhatsAppStatus>('GET', '/api/admin/whatsapp'),
  whatsappConnect: () => request<{ state: WhatsAppState; qr: string | null; pairingCode: string | null }>('POST', '/api/admin/whatsapp/connect'),
  whatsappWebhook: () => request<WhatsAppStatus>('POST', '/api/admin/whatsapp/webhook'),
  adminEmployees: () => request<{ employees: AdminEmployee[] }>('GET', '/api/admin/employees'),
  setPhone: (id: string, phone: string | null) => request<{ ok: true }>('PUT', `/api/admin/employees/${id}/phone`, { phone }),
  whatsappLogout: () => request<WhatsAppStatus>('POST', '/api/admin/whatsapp/logout'),
};
