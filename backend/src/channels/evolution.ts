import type { Config } from '../config.js';

const MAX_LEN = 3800;

export type ConnectionState = 'open' | 'connecting' | 'close' | 'not_created' | 'unknown';

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface WebhookInfo {
  url: string | null;
  enabled: boolean;
  matches: boolean;
}

export interface QrResult {
  /** Imagem do QR (data URL) quando há um QR para ler. */
  qr: string | null;
  pairingCode: string | null;
}

type EvoConfig = Pick<Config, 'EVOLUTION_API_URL' | 'EVOLUTION_API_KEY' | 'EVOLUTION_INSTANCE' | 'EVOLUTION_WEBHOOK_SECRET'>;

/** Cliente da Evolution API v2: envio de mensagens e administração da instância (conexão, QR, webhook). */
export class EvolutionClient {
  constructor(private readonly cfg: EvoConfig) {}

  get enabled(): boolean {
    return !!(this.cfg.EVOLUTION_API_URL && this.cfg.EVOLUTION_API_KEY);
  }

  get instance(): string {
    return this.cfg.EVOLUTION_INSTANCE;
  }

  private async request<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; data: T }> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.EVOLUTION_API_URL.replace(/\/$/, '')}${path}`, {
        method,
        headers: { 'content-type': 'application/json', apikey: this.cfg.EVOLUTION_API_KEY },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new EvolutionError('Não foi possível falar com a Evolution API (verifique EVOLUTION_API_URL).', 502);
    }
    const text = await res.text();
    if (!res.ok && !okStatuses.includes(res.status)) {
      let detail = text.slice(0, 200);
      try {
        const j = JSON.parse(text) as { message?: unknown; response?: { message?: unknown } };
        detail = JSON.stringify(j.response?.message ?? j.message ?? j).slice(0, 200);
      } catch {
        /* texto puro */
      }
      throw new EvolutionError(`Evolution ${method} ${path} → HTTP ${res.status} ${detail}`, res.status === 401 ? 401 : 502);
    }
    return { status: res.status, data: (text ? safeJson(text) : {}) as T };
  }

  // --- mensagens ---

  async sendText(number: string, text: string): Promise<void> {
    for (let i = 0; i < text.length; i += MAX_LEN) {
      await this.request('POST', `/message/sendText/${this.instance}`, { number, text: text.slice(i, i + MAX_LEN) });
    }
  }

  async composing(number: string): Promise<void> {
    await this.request('POST', `/chat/sendPresence/${this.instance}`, { number, presence: 'composing', delay: 3000 });
  }

  // --- administração da instância ---

  async state(): Promise<ConnectionState> {
    const r = await this.request<{ instance?: { state?: string } }>('GET', `/instance/connectionState/${this.instance}`, undefined, [404]);
    if (r.status === 404) return 'not_created';
    const s = r.data.instance?.state;
    return s === 'open' || s === 'connecting' || s === 'close' ? s : 'unknown';
  }

  /** Cria a instância se ainda não existir (idempotente). Retorna o QR devolvido na criação, se houver. */
  async ensureInstance(webhookUrl: string | null): Promise<QrResult | null> {
    if ((await this.state()) !== 'not_created') return null;
    const r = await this.request<{ qrcode?: { base64?: string; pairingCode?: string } }>('POST', '/instance/create', {
      instanceName: this.instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      rejectCall: true,
      msgCall: 'Este número atende só por mensagem de texto.',
      groupsIgnore: true,
      readMessages: true,
      ...(webhookUrl ? { webhook: this.webhookBody(webhookUrl) } : {}),
    });
    const qr = r.data.qrcode;
    return qr?.base64 ? { qr: toDataUrl(qr.base64), pairingCode: qr.pairingCode ?? null } : null;
  }

  /** Pede um novo QR code para a instância (a instância precisa existir e não estar conectada). */
  async connect(): Promise<QrResult> {
    const r = await this.request<{ base64?: string; pairingCode?: string; code?: string }>('GET', `/instance/connect/${this.instance}`);
    return { qr: r.data.base64 ? toDataUrl(r.data.base64) : null, pairingCode: r.data.pairingCode ?? null };
  }

  async logout(): Promise<void> {
    await this.request('DELETE', `/instance/logout/${this.instance}`, undefined, [404, 400]);
  }

  private webhookBody(url: string) {
    return {
      enabled: true,
      url,
      byEvents: false,
      base64: false,
      headers: this.cfg.EVOLUTION_WEBHOOK_SECRET ? { 'x-webhook-secret': this.cfg.EVOLUTION_WEBHOOK_SECRET } : {},
      events: ['MESSAGES_UPSERT'],
    };
  }

  /** Aponta a instância para o webhook deste backend (a Evolution passa a chamá-lo a cada mensagem recebida). */
  async setWebhook(url: string): Promise<void> {
    await this.request('POST', `/webhook/set/${this.instance}`, { webhook: this.webhookBody(url) });
  }

  async webhook(expectedUrl: string | null): Promise<WebhookInfo> {
    const r = await this.request<{ url?: string; enabled?: boolean } | null>('GET', `/webhook/find/${this.instance}`, undefined, [404]);
    const url = r.status === 404 ? null : (r.data?.url ?? null);
    return { url, enabled: !!r.data?.enabled && !!url, matches: !!url && !!expectedUrl && url === expectedUrl };
  }
}

const safeJson = (t: string): unknown => {
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
};

const toDataUrl = (b64: string) => (b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`);
