import { describe, expect, it } from 'vitest';
import { addBusinessDays, addBusinessHours, canReopen, derivePriority, slaState } from '../src/domain/sla.js';
import { phoneVariants } from '../src/domain/phone.js';

describe('prazos (Anexo A)', () => {
  it('4 horas úteis a partir de sexta 17h (SP) caem na segunda 11h', () => {
    const due = addBusinessHours(new Date('2026-10-23T20:00:00Z'), 4); // sex 17:00 SP
    expect(due.toISOString()).toBe('2026-10-26T14:00:00.000Z'); // seg 11:00 SP
  });

  it('pedido fora do expediente começa a contar na abertura do próximo dia útil', () => {
    const due = addBusinessHours(new Date('2026-10-24T15:00:00Z'), 1); // sáb 12:00 SP
    expect(due.toISOString()).toBe('2026-10-26T12:00:00.000Z'); // seg 09:00 SP
  });

  it('3 dias úteis pulam o fim de semana', () => {
    expect(addBusinessDays(new Date('2026-10-22T15:00:00Z'), 3).toISOString()).toBe('2026-10-27T15:00:00.000Z'); // qui → ter
  });

  it('chamado médio sem atualização há 6 dias está vencido; resolvido nunca vence', () => {
    const updatedAt = new Date(Date.now() - 6 * 86400_000).toISOString();
    expect(slaState({ priority: 'medium', status: 'waiting_analyst', updatedAt }).overdue).toBe(true);
    expect(slaState({ priority: 'medium', status: 'resolved', updatedAt }).overdue).toBe(false);
  });

  it('reabertura só até 7 dias após a resolução', () => {
    const d = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
    expect(canReopen({ status: 'resolved', resolvedAt: d(4) })).toBe(true);
    expect(canReopen({ status: 'resolved', resolvedAt: d(9) })).toBe(false);
    expect(canReopen({ status: 'open', resolvedAt: null })).toBe(false);
  });
});

describe('prioridade (impacto × urgência)', () => {
  it('só eu + compromisso hoje + sem alternativa → alta', () => {
    expect(derivePriority({ affected: 'self', blocksWork: true, sameDayCommitment: true, hasWorkaround: false }).priority).toBe('high');
  });
  it('equipe parada → crítica', () => {
    expect(derivePriority({ affected: 'team', blocksWork: true, sameDayCommitment: false, hasWorkaround: false }).priority).toBe('critical');
  });
  it('atrapalha mas há alternativa → média', () => {
    expect(derivePriority({ affected: 'self', blocksWork: false, sameDayCommitment: false, hasWorkaround: true }).priority).toBe('medium');
  });
  it('pedido sem urgência → baixa', () => {
    expect(derivePriority({ affected: 'self', blocksWork: false, sameDayCommitment: false, hasWorkaround: false }).priority).toBe('low');
  });
});

describe('telefone', () => {
  it('casa número com e sem o 9º dígito', () => {
    expect(phoneVariants('+55 (11) 98888-7777')).toContain('551188887777');
    expect(phoneVariants('551188887777')).toContain('5511988887777');
  });
});
