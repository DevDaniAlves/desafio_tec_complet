import { describe, expect, it } from 'vitest';
import { WhatsAppChannel } from '../src/channels/whatsapp.js';
import { setup } from './helpers.js';

const upsert = (over: Record<string, unknown> = {}) => ({
  event: 'messages.upsert',
  instance: 'nexo-assist',
  data: { key: { id: 'ABC1', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' } },
  ...over,
});

async function channel(secret: string) {
  const s = await setup();
  const sent: string[] = [];
  const client = { enabled: true, sendText: async (_n: string, t: string) => void sent.push(t) } as never;
  return { s, sent, wa: new WhatsAppChannel(client, s.engine, s.auth, s.conversations, secret, 'nexo-assist') };
}

describe('webhook do WhatsApp', () => {
  it('com segredo configurado: recusa sem credencial e aceita pelo header ou pelo ?secret=', async () => {
    const { wa } = await channel('s3gredo');
    expect(await wa.handleWebhook({}, upsert())).toBe(401);
    expect(await wa.handleWebhook({ header: 'errado' }, upsert())).toBe(401);
    expect(await wa.handleWebhook({ header: 's3gredo' }, upsert())).toBe(200);
    expect(await wa.handleWebhook({ query: 's3gredo' }, upsert())).toBe(200);
  });

  it('sem segredo (vazio): aceita sem credencial, mas ainda ignora outra instância', async () => {
    const { wa, sent } = await channel('');
    expect(await wa.handleWebhook({}, upsert())).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.join(' ')).toMatch(/não encontrei este número/i); // número desconhecido recebe aviso
    const before = sent.length;
    expect(await wa.handleWebhook({}, upsert({ instance: 'outra-instancia' }))).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.length).toBe(before); // ignorado, nada enviado
  });

  it('ignora mensagens enviadas pelo próprio bot e de grupos', async () => {
    const { wa, sent } = await channel('');
    const fromMe = upsert({ data: { key: { id: 'X', remoteJid: '5511999990000@s.whatsapp.net', fromMe: true }, message: { conversation: 'eco' } } });
    const group = upsert({ data: { key: { id: 'Y', remoteJid: '1203630@g.us', fromMe: false }, message: { conversation: 'oi grupo' } } });
    expect(await wa.handleWebhook({}, fromMe)).toBe(200);
    expect(await wa.handleWebhook({}, group)).toBe(200);
    expect(sent).toHaveLength(0);
  });
});
