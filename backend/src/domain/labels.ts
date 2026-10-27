import type { Priority, TicketStatus } from './types.js';

export const PRIORITY_LABEL: Record<Priority, string> = { critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa' };

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  waiting_analyst: 'Aguardando analista',
  approved: 'Aprovado',
  resolved: 'Resolvido',
  closed: 'Encerrado',
};

export const fmtDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
