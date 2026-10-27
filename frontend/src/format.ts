import type { Priority, TicketStatus } from './api';

export const PRIORITY_LABEL: Record<Priority, string> = { critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa' };

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  waiting_analyst: 'Aguardando analista',
  approved: 'Aprovado',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

const TZ = 'America/Sao_Paulo';
export const fmtTime = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtDay = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' }).format(new Date(iso));
export const fmtDateTime = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;

export function relative(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'há 1 dia' : d < 14 ? `há ${d} dias` : `há ${Math.floor(d / 7)} semanas`;
}

/** Hora no relógio para hoje, data curta para outros dias (lista de conversas). */
export function shortStamp(iso: string): string {
  const d = new Date(iso);
  const same = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ }).format(d) === new Intl.DateTimeFormat('pt-BR', { timeZone: TZ }).format(new Date());
  return same ? fmtTime(iso) : fmtDay(iso);
}

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

const AVATAR_BG = ['#DCE9F7', '#F6E3D3', '#E6E1F7', '#DDF0E6', '#F7E1E6', '#E5E8EC', '#FBEFD0'];
export const avatarBg = (seed: string) => AVATAR_BG[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length]!;

export const TOOL_ICON_TEXT: Record<string, string> = {
  search_my_tickets: 'chamados',
  get_ticket: 'chamado',
  search_knowledge_base: 'ajuda',
  calculate_priority: 'prioridade',
  draft_ticket: 'rascunho',
  handoff_to_analyst: 'analista',
};
