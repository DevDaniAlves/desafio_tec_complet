import { z } from 'zod';
import type { ChatEngine } from '../agent/engine.js';
import type { AuthService } from '../services/authService.js';
import type { Broker } from '../services/broker.js';
import type { ConversationService, Message } from '../services/conversationService.js';
import type { EvolutionClient } from './evolution.js';
import { renderForWhatsApp } from './render.js';

const webhookSchema = z.object({
  event: z.string(),
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

export class WhatsAppChannel {
  private readonly phoneByConversation = new Map<string, string>();

  constructor(
    private readonly client: EvolutionClient,
    private readonly engine: ChatEngine,
    private readonly auth: AuthService,
    private readonly conversations: ConversationService,
    private readonly secret: string,
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

  private async typing(conversationId: string): Promise<void> {
    const phone = await this.phoneOf(conversationId);
    if (phone) await this.client.composing(phone).catch(() => undefined);
  }

  /** Retorna o status HTTP a responder à Evolution. 2xx sempre que a mensagem foi "tratada" (inclusive ignorada). */
  async handleWebhook(secretHeader: string | undefined, body: unknown): Promise<number> {
    if (!this.secret || secretHeader !== this.secret) return 401;
    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) return 200;
    const { event, data } = parsed.data;
    if (event.toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return 200;
    if (data.key.fromMe || data.key.remoteJid.endsWith('@g.us') || data.key.remoteJid === 'status@broadcast') return 200;

    // Em contas com LID o número real vem em senderPn/remoteJidAlt.
    const number = digits(data.key.senderPn ?? data.key.remoteJidAlt ?? data.key.remoteJid);
    const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text;

    const employee = await this.auth.byPhone(number);
    if (!employee) {
      await this.client.sendText(number, 'Olá! Não encontrei este número no cadastro de funcionários da Nexo. Peça ao service desk (ramal 4000) para vinculá-lo.').catch(() => undefined);
      return 200;
    }
    if (!text?.trim()) {
      await this.client.sendText(number, 'Por enquanto só consigo ler mensagens de texto. Pode escrever o que precisa?').catch(() => undefined);
      return 200;
    }
    // Processa em segundo plano para responder rápido ao webhook (a Evolution reenvia se demorar).
    void this.engine.handleEmployeeMessage({ employee, channel: 'whatsapp', text, externalId: `wa:${data.key.id}` }).catch((e) => console.error('[whatsapp] erro no engine', e));
    return 200;
  }
}
