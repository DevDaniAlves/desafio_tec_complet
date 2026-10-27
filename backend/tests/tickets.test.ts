import { describe, expect, it } from 'vitest';
import { buildTools } from '../src/agent/tools.js';
import type { TurnContext } from '../src/agent/context.js';
import { LegacyUnavailableError, TicketRuleError } from '../src/services/ticketService.js';
import { setup } from './helpers.js';

describe('serviço de chamados (privacidade e regras)', () => {
  it('não entrega chamado de outro funcionário nem revela que existe', async () => {
    const { tickets } = await setup();
    expect(await tickets.getForEmployee('e-ana', 'INC-20455')).toBeNull(); // é do Diego
    expect((await tickets.listByEmployee('e-ana')).every((t) => t.employeeId === 'e-ana')).toBe(true);
  });

  it('não permite atualizar chamado de outra pessoa', async () => {
    const { tickets } = await setup();
    await expect(tickets.update('e-ana', 'INC-20455', { note: 'x' })).rejects.toThrow(/não encontrado/);
  });

  it('só reabre resolvido há até 7 dias', async () => {
    const { tickets } = await setup();
    await expect(tickets.reopen('e-ana', 'INC-20150', 'voltou a bloquear')).resolves.toMatchObject({ status: 'open' });
    await expect(tickets.reopen('e-ana', 'INC-19877', 'x')).rejects.toBeInstanceOf(TicketRuleError);
  });

  it('marca vencido o chamado médio parado há 6 dias (seed)', async () => {
    const { tickets } = await setup();
    const t = await tickets.getForEmployee('e-ana', 'INC-20311');
    expect(t?.overdue).toBe(true);
  });

  it('numera os chamados novos em sequência', async () => {
    const { tickets } = await setup();
    const base = { type: 'INC' as const, title: 'Teste de numeração', description: 'Descrição longa o bastante para o teste.', category: 'Outros' as const, priority: 'low' as const, affected: 'self' as const };
    const a = await tickets.create('e-ana', base);
    const b = await tickets.create('e-ana', base);
    expect(a.id).toBe('INC-20517');
    expect(b.id).toBe('INC-20518');
  });

  it('absorve falhas do legado com retry e acaba sinalizando indisponibilidade', async () => {
    const { tickets: flaky } = await setup([], { failureRate: 1 });
    await expect(flaky.listByEmployee('e-ana')).rejects.toBeInstanceOf(LegacyUnavailableError);
  });
});

describe('ferramentas do agent', () => {
  const ctxFor = (s: Awaited<ReturnType<typeof setup>>): TurnContext => ({ employee: s.ana, tickets: s.tickets, kb: s.kb, steps: [], priorityCalc: null, final: null });
  // As ferramentas do Mastra aceitam `{ context }`; chamamos direto para testar a regra sem LLM.
  const run = (tool: unknown, context: unknown) => (tool as { execute: (a: unknown) => Promise<unknown> }).execute({ context });

  const baseDraft = {
    message: 'Confira',
    action: 'create',
    title: 'Notebook lento depois da atualização',
    description: 'O notebook está muito lento desde a atualização do Windows, reiniciar não resolveu.',
    type: 'INC',
    category: 'Hardware',
    priority: 'low',
    affected: 'self',
    force_new: false,
    intent: 'open_ticket',
    understood: 'abrir chamado',
    confidence: 0.9,
    rationale: 'teste',
  };

  it('exige calculate_priority antes de rascunhar um chamado novo', async () => {
    const s = await setup();
    const ctx = ctxFor(s);
    const r = (await run(buildTools(ctx).draft_ticket, baseDraft)) as { error?: string };
    expect(r.error).toBe('RULE_VIOLATION');
    expect(ctx.final).toBeNull();
  });

  it('bloqueia duplicidade: problema igual ao INC-20311 aberto deve virar atualização', async () => {
    const s = await setup();
    const ctx = ctxFor(s);
    const tools = buildTools(ctx);
    await run(tools.calculate_priority, { affected: 'self', blocks_work: false, same_day_commitment: false, has_workaround: true });
    const r = (await run(tools.draft_ticket, baseDraft)) as { error?: string; message?: string };
    expect(r.error).toBe('RULE_VIOLATION');
    expect(r.message).toContain('INC-20311');
    expect(ctx.final).toBeNull();
  });

  it('a prioridade do rascunho vem da regra, não do modelo', async () => {
    const s = await setup();
    const ctx = ctxFor(s);
    const tools = buildTools(ctx);
    await run(tools.calculate_priority, { affected: 'self', blocks_work: true, same_day_commitment: true, has_workaround: false });
    await run(tools.draft_ticket, { ...baseDraft, title: 'VPN não conecta no notebook', description: 'Erro 809 ao conectar na VPN desde ontem, reunião com cliente às 14h.', category: 'Rede e VPN', priority: 'low' });
    expect(ctx.final?.action.kind).toBe('draft');
    if (ctx.final?.action.kind === 'draft') expect(ctx.final.action.draft.priority).toBe('high');
  });

  it('get_ticket de chamado alheio devolve NOT_FOUND', async () => {
    const s = await setup();
    const r = (await run(buildTools(ctxFor(s)).get_ticket, { ticket_id: 'INC-20455' })) as { error?: string };
    expect(r.error).toBe('NOT_FOUND');
  });

  it('central de ajuda encontra o artigo da VPN 809', async () => {
    const s = await setup();
    expect((await s.kb.search('vpn erro 809'))[0]?.article.id).toBe('kb-vpn-809');
  });
});
