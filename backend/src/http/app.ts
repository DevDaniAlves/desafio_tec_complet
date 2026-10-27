import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { toCard, type ChatEngine } from '../agent/engine.js';
import { EvolutionError, type EvolutionClient } from '../channels/evolution.js';
import type { WhatsAppChannel } from '../channels/whatsapp.js';
import type { Config } from '../config.js';
import type { Employee } from '../domain/types.js';
import type { AuthService } from '../services/authService.js';
import type { Broker, LiveEvent } from '../services/broker.js';
import type { ConversationService } from '../services/conversationService.js';
import type { TicketService } from '../services/ticketService.js';

export interface AppDeps {
  config: Config;
  auth: AuthService;
  conversations: ConversationService;
  tickets: TicketService;
  engine: ChatEngine;
  broker: Broker;
  whatsapp: WhatsAppChannel | null;
  evolution: EvolutionClient;
  /** URL que a Evolution chama a cada mensagem (PUBLIC_WEBHOOK_URL ou derivada da Railway). */
  webhookUrl: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: Employee;
  }
}

export async function buildApp(d: AppDeps) {
  const app = Fastify({ logger: d.config.NODE_ENV !== 'test', bodyLimit: 64 * 1024, trustProxy: true });
  const origins = d.config.WEB_ORIGIN.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const originAllowed = (o: string | undefined) => !!o && (origins.includes('*') || origins.includes(o));

  await app.register(cors, { origin: (o, cb) => cb(null, !o || originAllowed(o)), methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['authorization', 'content-type'], maxAge: 600 });
  await app.register(rateLimit, { global: true, max: 240, timeWindow: '1 minute' });

  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
  };

  const requireUser = (...roles: Employee['role'][]) => async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await d.auth.fromToken(bearer(req));
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (roles.length && !roles.includes(user.role)) return reply.code(403).send({ error: 'forbidden' });
    req.user = user;
  };

  const publicUser = (u: Employee) => ({ id: u.id, name: u.name, email: u.email, department: u.department, device: u.device, role: u.role, team: u.team });

  // --- auth (JWT) ---
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1), remember: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Informe e-mail e senha.' });
    const session = await d.auth.login(body.data.email, body.data.password, body.data.remember ?? false);
    if (!session) return reply.code(401).send({ error: 'E-mail ou senha inválidos.' });
    return { token: session.token, expiresIn: session.expiresInSec, user: publicUser(session.employee) };
  });

  app.get('/api/auth/me', { preHandler: requireUser() }, async (req) => ({ user: publicUser(req.user!) }));

  // Fluxo simulado: em produção dispararia o e-mail de redefinição do diretório corporativo.
  app.post('/api/auth/reset-password', { preHandler: requireUser(), config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req) => ({ ok: true, sentTo: req.user!.email }));

  // --- SSE (o JWT vai no header; o cliente usa fetch streaming, não EventSource) ---
  const sse = (req: FastifyRequest, reply: FastifyReply, subscribe: (send: (e: LiveEvent) => void) => () => void) => {
    reply.hijack();
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(originAllowed(origin) ? { 'access-control-allow-origin': origin!, vary: 'Origin' } : {}),
    });
    const send = (e: LiveEvent) => reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const unsubscribe = subscribe(send);
    const beat = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    reply.raw.write(': connected\n\n');
    req.raw.on('close', () => {
      clearInterval(beat);
      unsubscribe();
    });
  };

  // --- chat do funcionário ---
  const sessionPayload = async (user: Employee) => {
    const conv = (await d.conversations.latest(user.id)) ?? (await d.conversations.getOrCreateActive(user.id, 'web'));
    return { conversation: conv, messages: await d.conversations.messages(conv.id), limit: d.config.SESSION_MESSAGE_LIMIT };
  };

  app.get('/api/chat/session', { preHandler: requireUser('employee') }, async (req) => sessionPayload(req.user!));

  app.post('/api/chat/new-session', { preHandler: requireUser('employee') }, async (req) => {
    await d.engine.startNewSession(req.user!, 'web');
    return sessionPayload(req.user!);
  });

  app.post('/api/chat/messages', { preHandler: requireUser('employee'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Mensagem inválida.' });
    void d.engine.handleEmployeeMessage({ employee: req.user!, channel: 'web', text: body.data.text }).catch((e) => req.log.error(e));
    return reply.code(202).send({ accepted: true });
  });

  app.post('/api/chat/drafts/:id/:decision', { preHandler: requireUser('employee') }, async (req, reply) => {
    const { id, decision } = req.params as { id: string; decision: string };
    if (decision !== 'confirm' && decision !== 'cancel') return reply.code(404).send({ error: 'not_found' });
    try {
      await (decision === 'confirm' ? d.engine.confirmDraft(req.user!, id, 'web') : d.engine.cancelDraft(req.user!, id, 'web'));
    } catch {
      return reply.code(404).send({ error: 'Rascunho não encontrado.' });
    }
    return { ok: true };
  });

  app.get('/api/chat/stream', { preHandler: requireUser('employee') }, (req, reply) => {
    const user = req.user!;
    sse(req, reply, (send) =>
      d.broker.subscribeConsole((e) => {
        void d.conversations.get(e.conversationId).then((c) => {
          if (c?.employeeId === user.id) send(e);
        });
      }),
    );
  });

  // --- console do analista ---
  const analyst = requireUser('analyst');

  app.get('/api/console/conversations', { preHandler: analyst }, async () => ({
    conversations: await Promise.all(
      (await d.conversations.listForConsole()).map(async (c) => {
        const emp = (await d.auth.byId(c.employeeId))!;
        return { ...c, employee: publicUser(emp), assignedName: c.assignedTo ? ((await d.auth.byId(c.assignedTo))?.name ?? null) : null };
      }),
    ),
  }));

  const consoleConv = (id: string) => d.conversations.get(id);

  app.get('/api/console/conversations/:id', { preHandler: analyst }, async (req, reply) => {
    const conv = await consoleConv((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: 'not_found' });
    const emp = (await d.auth.byId(conv.employeeId))!;
    const tickets = (await d.tickets.listAll(emp.id)).map(toCard);
    return { conversation: conv, employee: publicUser(emp), messages: await d.conversations.messages(conv.id), tickets };
  });

  app.post('/api/console/conversations/:id/take', { preHandler: analyst }, async (req, reply) => {
    const me = req.user!;
    const conv = await consoleConv((req.params as { id: string }).id);
    if (!conv) return reply.code(404).send({ error: 'not_found' });
    const wasMine = conv.assignedTo === me.id && conv.status === 'human';
    if (!(await d.conversations.take(conv.id, me.id))) return reply.code(409).send({ error: 'Esta conversa já está com outro analista ou foi encerrada.' });
    if (!wasMine) await d.conversations.addMessage(conv.id, { role: 'system', text: `${me.name} assumiu o atendimento`, channel: conv.channel });
    return { ok: true };
  });

  app.post('/api/console/conversations/:id/messages', { preHandler: analyst }, async (req, reply) => {
    const me = req.user!;
    const conv = await consoleConv((req.params as { id: string }).id);
    const body = z.object({ text: z.string().trim().min(1).max(4000) }).safeParse(req.body);
    if (!conv || !body.success) return reply.code(400).send({ error: 'Requisição inválida.' });
    if (conv.status !== 'human' || conv.assignedTo !== me.id) return reply.code(409).send({ error: 'Assuma a conversa para responder.' });
    await d.conversations.addMessage(conv.id, { role: 'analyst', text: body.data.text, channel: conv.channel, senderName: me.name });
    return { ok: true };
  });

  app.post('/api/console/conversations/:id/return', { preHandler: analyst }, async (req, reply) => {
    const me = req.user!;
    const conv = await consoleConv((req.params as { id: string }).id);
    if (!conv || conv.status !== 'human' || conv.assignedTo !== me.id) return reply.code(409).send({ error: 'Você não está atendendo esta conversa.' });
    await d.conversations.release(conv.id);
    await d.conversations.addMessage(conv.id, { role: 'system', text: `${me.name} devolveu a conversa ao Nexo Assist`, channel: conv.channel });
    await d.conversations.addMessage(conv.id, { role: 'assistant', text: 'Voltei a ajudar por aqui. Se precisar de mais alguma coisa, é só me dizer.', channel: conv.channel });
    return { ok: true };
  });

  app.post('/api/console/conversations/:id/close', { preHandler: analyst }, async (req, reply) => {
    const me = req.user!;
    const conv = await consoleConv((req.params as { id: string }).id);
    if (!conv || conv.status === 'closed') return reply.code(409).send({ error: 'Conversa já encerrada.' });
    await d.conversations.addMessage(conv.id, { role: 'system', text: `${me.name} encerrou o atendimento`, channel: conv.channel });
    await d.conversations.close(conv.id);
    return { ok: true };
  });

  app.get('/api/console/stream', { preHandler: analyst }, (req, reply) => sse(req, reply, (send) => d.broker.subscribeConsole(send)));

  // --- admin: conexão do WhatsApp (Evolution API) ---
  const admin = requireUser('admin');
  const evo = async <T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> => {
    if (!d.evolution.enabled) {
      void reply.code(503).send({ error: 'Evolution API não configurada (defina EVOLUTION_API_URL e EVOLUTION_API_KEY no backend).' });
      return undefined;
    }
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof EvolutionError ? e.status : 502;
      void reply.code(status).send({ error: e instanceof Error ? e.message : 'Falha ao falar com a Evolution API.' });
      return undefined;
    }
  };

  const whatsappStatus = async () => {
    const state = await d.evolution.state();
    const webhook = state === 'not_created' ? { url: null, enabled: false, matches: false } : await d.evolution.webhook(d.webhookUrl);
    return { enabled: true, instance: d.evolution.instance, state, webhook: { ...webhook, expectedUrl: d.webhookUrl } };
  };

  app.get('/api/admin/whatsapp', { preHandler: admin }, async (req, reply) => {
    if (!d.evolution.enabled) return { enabled: false, instance: d.evolution.instance, state: 'unknown', webhook: { url: null, enabled: false, matches: false, expectedUrl: d.webhookUrl } };
    return evo(reply, whatsappStatus);
  });

  // Cria a instância (se preciso), garante o webhook e devolve um QR code para parear o número.
  app.post('/api/admin/whatsapp/connect', { preHandler: admin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) =>
    evo(reply, async () => {
      const created = await d.evolution.ensureInstance(d.webhookUrl);
      if (d.webhookUrl) await d.evolution.setWebhook(d.webhookUrl);
      const state = await d.evolution.state();
      if (state === 'open') return { state, qr: null, pairingCode: null };
      const qr = created?.qr ? created : await d.evolution.connect();
      return { state, qr: qr.qr, pairingCode: qr.pairingCode };
    }),
  );

  app.post('/api/admin/whatsapp/webhook', { preHandler: admin }, async (req, reply) =>
    evo(reply, async () => {
      if (!d.webhookUrl) throw new EvolutionError('Defina PUBLIC_WEBHOOK_URL no .env do backend.', 400);
      await d.evolution.ensureInstance(d.webhookUrl);
      await d.evolution.setWebhook(d.webhookUrl);
      return whatsappStatus();
    }),
  );

  app.post('/api/admin/whatsapp/logout', { preHandler: admin }, async (req, reply) =>
    evo(reply, async () => {
      await d.evolution.logout();
      return whatsappStatus();
    }),
  );

  // Vínculo celular → funcionário: é por este número que o WhatsApp identifica quem está falando.
  app.get('/api/admin/employees', { preHandler: admin }, async () => ({
    employees: (await d.auth.listEmployees()).map((e) => ({ id: e.id, name: e.name, email: e.email, department: e.department, phone: e.phone })),
  }));

  app.put('/api/admin/employees/:id/phone', { preHandler: admin }, async (req, reply) => {
    const body = z.object({ phone: z.string().max(30).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Informe o número ou null para remover.' });
    const r = await d.auth.setPhone((req.params as { id: string }).id, body.data.phone);
    if (r === 'not_found') return reply.code(404).send({ error: 'Funcionário não encontrado.' });
    if (r === 'invalid') return reply.code(400).send({ error: 'Número inválido. Use DDI+DDD+número, ex.: 5511999998888.' });
    if (r === 'conflict') return reply.code(409).send({ error: 'Este número já está vinculado a outro funcionário.' });
    return { ok: true };
  });

  // --- WhatsApp: webhook chamado pela Evolution a cada mensagem recebida ---
  if (d.whatsapp) {
    const wa = d.whatsapp;
    app.post('/api/whatsapp/webhook', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
      const query = (req.query as { secret?: string }).secret;
      const status = await wa.handleWebhook({ header: req.headers['x-webhook-secret'] as string | undefined, query }, req.body);
      return reply.code(status).send({ ok: status < 300 });
    });
  }

  app.get('/api/health', async () => ({ ok: true }));

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    req.log.error(err);
    reply.code(err.statusCode ?? 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : 'Erro interno.' });
  });

  return app;
}
