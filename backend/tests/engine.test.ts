import { describe, expect, it } from 'vitest';
import type { DraftPayload } from '../src/domain/types.js';
import { decision, setup } from './helpers.js';

const draft: DraftPayload = {
  action: 'create',
  existingTicketId: null,
  title: 'VPN não conecta no notebook — erro 809',
  description: 'Desde 20/10 o notebook (Windows 11) não conecta na VPN e mostra o erro 809.',
  type: 'INC',
  category: 'Rede e VPN',
  priority: 'high',
  affected: 'self',
  dueAt: null,
};

const draftFinal = (d: DraftPayload = draft) => ({ action: { kind: 'draft' as const, message: 'Confira', draft: d }, decision: decision({ intent: 'open_ticket' }) });
type S = Awaited<ReturnType<typeof setup>>;
const convOf = async (s: S) => (await s.conversations.latest('e-ana'))!;
const pendingId = async (s: S) => (await s.conversations.pendingDraft((await convOf(s)).id))!.id;
const lastMsg = async (s: S) => (await s.conversations.messages((await convOf(s)).id)).at(-1)!;
const say = (s: S, text: string, channel: 'web' | 'whatsapp' = 'web') => s.engine.handleEmployeeMessage({ employee: s.ana, channel, text });

describe('engine: rascunho e confirmação', () => {
  it('não cria o chamado antes da confirmação', async () => {
    const s = await setup([draftFinal()]);
    const before = (await s.tickets.listByEmployee('e-ana')).length;
    await say(s, 'VPN com erro 809');
    expect((await s.tickets.listByEmployee('e-ana')).length).toBe(before);
    expect(await s.conversations.pendingDraft((await convOf(s)).id)).not.toBeNull();
  });

  it('confirmar cria exatamente um chamado, mesmo com cliques repetidos', async () => {
    const s = await setup([draftFinal()]);
    await say(s, 'VPN com erro 809');
    const id = await pendingId(s);
    const before = (await s.tickets.listByEmployee('e-ana')).length;
    await Promise.all([s.engine.confirmDraft(s.ana, id, 'web'), s.engine.confirmDraft(s.ana, id, 'web')]);
    expect((await s.tickets.listByEmployee('e-ana')).length).toBe(before + 1);
    expect((await lastMsg(s)).text).toContain('INC-');
  });

  it('responder "1" no WhatsApp confirma o rascunho sem passar pelo modelo', async () => {
    const s = await setup([draftFinal()]);
    await say(s, 'VPN com erro 809', 'whatsapp');
    await say(s, '1', 'whatsapp');
    expect(s.runner.calls.length).toBe(1);
    expect((await s.tickets.listByEmployee('e-ana')).some((t) => t.title.startsWith('VPN não conecta'))).toBe(true);
  });

  it('funcionário não confirma rascunho de outro', async () => {
    const s = await setup([draftFinal()]);
    await say(s, 'VPN');
    const id = await pendingId(s);
    const carla = (await s.auth.byId('e-carla'))!;
    await expect(s.engine.confirmDraft(carla, id, 'web')).rejects.toThrow();
  });

  it('chamado crítico confirmado transfere direto para o N2', async () => {
    const s = await setup([draftFinal({ ...draft, priority: 'critical' })]);
    await say(s, 'Toda a equipe está sem VPN');
    await s.engine.confirmDraft(s.ana, await pendingId(s), 'web');
    const conv = await convOf(s);
    expect(conv.status).toBe('waiting_agent');
    expect(conv.team).toBe('Suporte N2');
  });

  it('legado indisponível na confirmação mantém o rascunho pendente', async () => {
    const s = await setup([draftFinal()]);
    await say(s, 'VPN');
    const id = await pendingId(s);
    (s.tickets as unknown as { failureRate: number }).failureRate = 1;
    await s.engine.confirmDraft(s.ana, id, 'web');
    expect((await s.conversations.getDraft(id))?.state).toBe('pending');
    expect((await lastMsg(s)).text).toMatch(/indisponível/);
  });
});

describe('engine: transferência e pausa do agent', () => {
  it('transfere com resumo e o agent não responde mais', async () => {
    const s = await setup([
      { action: { kind: 'handoff', message: 'Chamei um analista.', trigger: 'user_request', reason: 'Pediu analista', summary: 'Notebook lento, INC-20311 vencido.', ticketId: 'INC-20311' }, decision: decision({ intent: 'handoff' }) },
    ]);
    await say(s, 'Quero falar com um analista');
    const conv = await convOf(s);
    expect(conv.status).toBe('waiting_agent');
    expect(conv.handoffSummary).toContain('INC-20311');
    expect((await s.tickets.getForEmployee('e-ana', 'INC-20311'))?.status).toBe('waiting_analyst');

    await say(s, 'alô?');
    expect(s.runner.calls.length).toBe(1); // segunda mensagem não acionou o agent
    expect((await s.conversations.messages(conv.id)).filter((m) => m.role === 'user').length).toBe(2);
  });

  it('baixa confiança vira transferência (rede de segurança)', async () => {
    const s = await setup([{ action: { kind: 'reply', message: 'Talvez seja isso...' }, decision: decision({ confidence: 0.3, understood: 'Mac congela sem padrão' }) }]);
    await say(s, 'meu mac congela');
    const conv = await convOf(s);
    expect(conv.status).toBe('waiting_agent');
    expect(conv.team).toBe('Suporte N1');
    const reply = (await s.conversations.messages(conv.id)).find((m) => m.role === 'assistant')!;
    expect(reply.trace?.action).toContain('forçado');
  });

  it('após o analista devolver, o agent volta a responder', async () => {
    const s = await setup([{ action: { kind: 'reply', message: 'Oi de novo!' }, decision: decision() }]);
    const conv = await s.conversations.getOrCreateActive('e-ana', 'web');
    await s.conversations.handoff(conv.id, { team: 'Suporte N2', reason: 'x', summary: 'y', confidence: 1 });
    expect(await s.conversations.take(conv.id, 'a-rafael')).toBe(true);
    await s.conversations.release(conv.id);
    await say(s, 'obrigada');
    expect(s.runner.calls.length).toBe(1);
  });

  it('dois analistas não assumem a mesma conversa', async () => {
    const s = await setup();
    const conv = await s.conversations.getOrCreateActive('e-ana', 'web');
    await s.conversations.handoff(conv.id, { team: 'Suporte N2', reason: 'x', summary: 'y', confidence: 1 });
    expect(await s.conversations.take(conv.id, 'a-rafael')).toBe(true);
    expect(await s.conversations.take(conv.id, 'a-marina')).toBe(false);
  });
});

describe('engine: limites e contexto', () => {
  it('bloqueia depois do limite de mensagens por sessão', async () => {
    const s = await setup([{ action: { kind: 'reply', message: 'ok' }, decision: decision() }, { action: { kind: 'reply', message: 'ok' }, decision: decision() }], { sessionLimit: 2 });
    for (const t of ['um', 'dois', 'três']) await say(s, t);
    expect(s.runner.calls.length).toBe(2);
    expect((await lastMsg(s)).text).toMatch(/limite/);
  });

  it('número digitado vira a opção escolhida antes de chegar ao modelo', async () => {
    const s = await setup([
      { action: { kind: 'options', message: 'Quem é afetado?', question: 'Quem?', options: ['Só eu', 'Minha equipe'] }, decision: decision() },
      { action: { kind: 'reply', message: 'ok' }, decision: decision() },
    ]);
    await say(s, 'VPN caiu', 'whatsapp');
    await say(s, '2', 'whatsapp');
    expect(s.runner.calls[1]!.history.at(-1)!.content).toBe('Minha equipe');
  });

  it('webhook repetido (mesmo id externo) é ignorado', async () => {
    const s = await setup([{ action: { kind: 'reply', message: 'ok' }, decision: decision() }]);
    const p = { employee: s.ana, channel: 'whatsapp' as const, text: 'oi', externalId: 'wa:ABC' };
    await s.engine.handleEmployeeMessage(p);
    await s.engine.handleEmployeeMessage(p);
    expect(s.runner.calls.length).toBe(1);
  });
});

describe('seed', () => {
  it('popula usuários, artigos, chamados e conversas do console, e é idempotente', async () => {
    const s = await setup();
    const n = async (t: string) => (await s.db.get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${t}`))!.n;
    expect(await n('employees')).toBe(9);
    expect(await n('articles')).toBe(10);
    expect(await n('tickets')).toBe(10);
    expect(await n('conversations')).toBe(4);
    const { seed } = await import('../src/seed.js');
    expect(await seed(s.db)).toBe(false); // segunda chamada não duplica
    expect(await n('employees')).toBe(9);
  });

  it('o console lista as conversas semeadas com a última mensagem', async () => {
    const s = await setup();
    const list = await s.conversations.listForConsole();
    expect(list.filter((c) => c.status === 'waiting_agent').length).toBe(2);
    expect(list.every((c) => c.lastMessage)).toBe(true);
  });
});
