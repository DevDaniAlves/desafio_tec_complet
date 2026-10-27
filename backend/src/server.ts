import { ChatEngine } from './agent/engine.js';
import { MastraRunner } from './agent/mastraRunner.js';
import { resolveModel } from './agent/model.js';
import { EvolutionClient } from './channels/evolution.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { config, webhookUrl } from './config.js';
import { createPgDb, migrate } from './db.js';
import { buildApp } from './http/app.js';
import { seed } from './seed.js';
import { AuthService } from './services/authService.js';
import { Broker } from './services/broker.js';
import { ConversationService } from './services/conversationService.js';
import { KbService } from './services/kbService.js';
import { hashPassword } from './services/password.js';
import { TicketService } from './services/ticketService.js';

const isProd = config.NODE_ENV === 'production';

if (!config.JWT_SECRET && isProd) {
  console.error('[nexo] JWT_SECRET é obrigatório em produção (use uma string aleatória longa).');
  process.exit(1);
}
if (!config.JWT_SECRET) console.warn('[nexo] JWT_SECRET ausente: usando um segredo de desenvolvimento. NÃO use assim em produção.');

const db = createPgDb(config.DATABASE_URL);
try {
  await migrate(db);
} catch (e) {
  console.error(`[nexo] Não foi possível conectar ao Postgres em ${config.DATABASE_URL.replace(/:\/\/.*@/, '://***@')}.`, e);
  process.exit(1);
}

const auth = new AuthService(db, config.JWT_SECRET || 'dev-only-secret-change-me');

// Senha das contas de demonstração: SEED_PASSWORD; em dev há um padrão, em produção precisa ser explícita.
const demoPassword = config.SEED_PASSWORD || (isProd ? '' : 'Nexo@2026');
if (config.SEED_ON_START === 'true') {
  if (await seed(db, { ...(demoPassword ? { passwordHash: await hashPassword(demoPassword) } : {}) })) {
    console.log('[nexo] Banco populado com os dados de exemplo.');
  }
  if (demoPassword) {
    const fixed = await auth.backfillPasswords(demoPassword);
    if (fixed) console.log(`[nexo] ${fixed} conta(s) sem senha receberam a senha de demonstração.`);
  } else {
    console.warn('[nexo] SEED_PASSWORD não definido: as contas de demonstração não conseguem entrar (defina SEED_PASSWORD).');
  }
}

const adminPassword = config.ADMIN_PASSWORD || (isProd ? '' : demoPassword);
if (adminPassword) {
  await auth.ensureAdmin(config.ADMIN_EMAIL, adminPassword);
  console.log(`[nexo] Conta admin pronta: ${config.ADMIN_EMAIL}`);
} else {
  console.warn('[nexo] ADMIN_PASSWORD não definido: nenhuma conta admin foi criada (defina ADMIN_EMAIL e ADMIN_PASSWORD).');
}

const broker = new Broker();
const conversations = new ConversationService(db, broker);
const tickets = new TicketService(db, { failureRate: config.LEGACY_FAILURE_RATE });
const kb = new KbService(db);
const llm = resolveModel(config);
const runner = llm ? new MastraRunner(llm) : null;
if (llm) console.log(`[nexo] LLM: ${llm.provider} / ${llm.id}`);
else console.warn(`[nexo] Chave do provedor "${config.LLM_PROVIDER}" ausente (${config.LLM_PROVIDER === 'google' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'}): o chat responderá que o assistente não está configurado.`);

const engine = new ChatEngine({ conversations, tickets, kb, runner, sessionLimit: config.SESSION_MESSAGE_LIMIT, modelName: llm?.id ?? 'indisponível' });

const evolution = new EvolutionClient(config);
const whatsapp = new WhatsAppChannel(evolution, engine, auth, conversations, config.EVOLUTION_WEBHOOK_SECRET);
whatsapp.attach(broker);

const hookUrl = webhookUrl(config);
const app = await buildApp({ config, auth, conversations, tickets, engine, broker, whatsapp, evolution, webhookUrl: hookUrl });
await app.listen({ port: config.PORT, host: '0.0.0.0' });

/**
 * Registra o webhook (PUBLIC_WEBHOOK_URL) na Evolution: a partir daí, cada mensagem recebida no WhatsApp
 * chega ao agent. Tenta de novo por alguns minutos caso a Evolution ainda esteja subindo (deploys paralelos).
 */
async function syncWebhook(attempt = 1): Promise<void> {
  if (!evolution.enabled || !hookUrl) {
    if (attempt === 1) console.log('[nexo] WhatsApp: Evolution/PUBLIC_WEBHOOK_URL não configurados; webhook não registrado.');
    return;
  }
  try {
    await evolution.ensureInstance(hookUrl);
    await evolution.setWebhook(hookUrl);
    console.log(`[nexo] WhatsApp: webhook registrado → ${hookUrl}`);
  } catch (e) {
    if (attempt >= 20) return void console.error('[nexo] WhatsApp: desisti de registrar o webhook (use o painel de admin).', e instanceof Error ? e.message : e);
    console.warn(`[nexo] WhatsApp: Evolution indisponível (tentativa ${attempt}); nova tentativa em 15 s.`);
    setTimeout(() => void syncWebhook(attempt + 1), 15_000).unref();
  }
}
void syncWebhook();

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
