import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ChatEngine } from '../agent/engine.js';
import type { AuthService } from '../services/authService.js';
import type { Broker } from '../services/broker.js';
import type { ConversationService, Message } from '../services/conversationService.js';
import type { EvolutionClient } from './evolution.js';
import { renderForWhatsApp } from './render.js';

const webhookSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  data: z
    .object({
      key: z.object({
        id: z.string(),
        remoteJid: z.string(),
        fromMe: z.boolean().optional(),
        senderPn: z.string().optional(),
        remoteJidAlt: z.string().optional(),
      }),
      message: z
        .object({
          conversation: z.string().optional(),
          extendedTextMessage: z.object({ text: z.string().optional() }).partial().optional(),
        })
        .passthrough()
        .nullish(),
    })
    .passthrough(),
});

const digits = (jid: string) => jid.split('@')[0]!.replace(/\D/g, '');

const safeEqual = (a: string | undefined, b: string): boolean => {
  if (a === undefined || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/** Como a Evolution se identificou no webhook: header `x-webhook-secret` ou `?secret=` na própria URL. */
export interface WebhookCredentials {
  header?: string | undefined;
  query?: string | undefined;
}

export class WhatsAppChannel {
  private readonly phoneByConversation = new Map<string, string>();

  constructor(
    private readonly client: EvolutionClient,
    private readonly engine: ChatEngine,
    private readonly auth: AuthService,
    private readonly conversations: ConversationService,
    /** Vazio = webhook aberto (a verificação da instância continua valendo). */
    private readonly secret: string,
    private readonly instance: string,
  ) {}

  /** Mensagens do agent/analista/sistema numa conversa cujo último canal foi o WhatsApp vão para o celular. */
  attach(broker: Broker): void {
    if (!this.client.enabled) return;
    broker.subscribeConsole((e) => {
      if (e.type === 'message') void this.deliver(e.message as Message);
      if (e.type === 'typing' && e.active) void this.typing(e.conversationId);
    });
  }

  private async phoneOf(conversationId: string): Promise<string | null> {
    const conv = await this.conversations.get(conversationId);
    if (!conv || conv.channel !== 'whatsapp') return null;
    const cached = this.phoneByConversation.get(conversationId);
    if (cached) return cached;
    const phone = (await this.auth.byId(conv.employeeId))?.phone;
    if (!phone) return null;
    this.phoneByConversation.set(conversationId, phone);
    return phone;
  }

  private async deliver(m: Message): Promise<void> {
    if (m.role === 'user') return;
    const phone = await this.phoneOf(m.conversationId);
    if (!phone) return;
    const text = renderForWhatsApp(m.role === 'system' && m.blocks.length ? '' : m.text, m.blocks);
    const prefix = m.role === 'analyst' ? `*${m.senderName ?? 'Analista'}* (Suporte)\n` : '';
    try {
      await this.client.sendText(phone, prefix + text);
    } catch (e) {
      console.error('[whatsapp] falha ao enviar', e);
    }
  }

  /** IDs de mensagem já vistos, com validade (memória limitada). */
  private readonly seen = new Map<string, number>();
  /** Última vez que avisamos cada remetente (evita responder o mesmo aviso a cada mensagem). */
  private readonly notified = new Map<string, number>();

  private static prune(map: Map<string, number>, now: number): void {
    if (map.size < 500) return;
    for (const [k, until] of map) if (until <= now) map.delete(k);
  }

  /** true só na primeira vez que o ID aparece (check-and-set síncrono: sem corrida entre cópias simultâneas). */
  private firstSight(id: string): boolean {
    const now = Date.now();
    WhatsAppChannel.prune(this.seen, now);
    if ((this.seen.get(id) ?? 0) > now) return false;
    this.seen.set(id, now + 15 * 60_000);
    return true;
  }

  /** true no máximo uma vez por `windowMs` para a mesma chave. */
  private shouldNotify(key: string, windowMs: number): boolean {
    const now = Date.now();
    WhatsAppChannel.prune(this.notified, now);
    if ((this.notified.get(key) ?? 0) > now) return false;
    this.notified.set(key, now + windowMs);
    return true;
  }

  private async typing(conversationId: string): Promise<void> {
    const phone = await this.phoneOf(conversationId);
    if (phone) await this.client.composing(phone).catch(() => undefined);
  }

  /** Retorna o status HTTP a responder à Evolution. 2xx sempre que a mensagem foi "tratada" (inclusive ignorada). */
  async handleWebhook(creds: WebhookCredentials, body: unknown): Promise<number> {
    // Segredo opcional: se configurado, precisa chegar no header OU no query string da URL do webhook.
    if (this.secret && !safeEqual(creds.header, this.secret) && !safeEqual(creds.query, this.secret)) return 401;
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) return 200;
    const { event, data, instance } = parsed.data;
    if (instance && instance !== this.instance) return 200; // evento de outra instância: ignora
    if (event.toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return 200;
    if (data.key.fromMe || data.key.remoteJid.endsWith('@g.us') || data.key.remoteJid === 'status@broadcast') return 200;

    // A Evolution pode entregar o mesmo evento mais de uma vez (às vezes no mesmo milissegundo).
    // A checagem é síncrona de propósito: duas cópias simultâneas não podem passar as duas.
    if (!this.firstSight(data.key.id)) return 200;

    // Em contas com LID o número real vem em senderPn/remoteJidAlt.
    const number = digits(data.key.senderPn ?? data.key.remoteJidAlt ?? data.key.remoteJid);
    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text;

    const employee = await this.auth.byPhone(number);
    if (!employee) {
      const lid = data.key.remoteJid.endsWith('@lid') && !data.key.senderPn && !data.key.remoteJidAlt;
      console.warn(`[whatsapp] remetente sem cadastro (final ${number.slice(-4)}${lid ? ', jid @lid sem número real: a Evolution não informou remoteJidAlt/senderPn' : ''})`);
      if (this.shouldNotify(`unknown:${number}`, 60 * 60_000)) {
        await this.client.sendText(number, 'Olá! Não encontrei este número no cadastro de funcionários da Nexo. Peça ao service desk (ramal 4000) para vinculá-lo.').catch(() => undefined);
      }
      return 200;
    }
    if (!text?.trim()) {
      if (this.shouldNotify(`notext:${number}`, 10 * 60_000)) {
        await this.client.sendText(number, 'Por enquanto só consigo ler mensagens de texto. Pode escrever o que precisa?').catch(() => undefined);
      }
      return 200;
    }
    // Processa em segundo plano para responder rápido ao webhook (a Evolution reenvia se demorar).
    void this.engine.handleEmployeeMessage({ employee, channel: 'whatsapp', text, externalId: `wa:${data.key.id}` }).catch((e) => console.error('[whatsapp] erro no engine', e));
    return 200;
  }
}
