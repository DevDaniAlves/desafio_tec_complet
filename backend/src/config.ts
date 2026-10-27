import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3101),
  // Origens do frontend permitidas no CORS (separadas por vírgula)
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().default(''),
  // Senha das contas de demonstração (seed). Em produção, sem isto as contas demo ficam sem senha.
  SEED_PASSWORD: z.string().default(''),
  SEED_ON_START: z.enum(['true', 'false']).default('true'),
  ADMIN_EMAIL: z.string().default('admin@nexo.com.br'),
  ADMIN_PASSWORD: z.string().default(''),
  DATABASE_URL: z.string().default('postgres://nexo:nexo@localhost:5442/nexo'),
  GEMINI_API_KEY: z.string().default(''),
  // Quanto o Gemini 3.x "pensa" antes de responder: low = mais rápido e barato
  GEMINI_THINKING: z.enum(['low', 'medium', 'high']).default('low'),
  // Vazio = gemini-3.5-flash
  AGENT_MODEL: z.string().default(''),
  // Modelo reserva se o principal estourar a cota (vazio = gemini-3.1-flash-lite; 'off' desliga)
  AGENT_FALLBACK_MODEL: z.string().default(''),
  // Quantos turnos do agent podem chamar o LLM ao mesmo tempo
  LLM_CONCURRENCY: z.coerce.number().int().min(1).default(2),
  SESSION_MESSAGE_LIMIT: z.coerce.number().default(30),
  LEGACY_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  EVOLUTION_API_URL: z.string().default(''),
  EVOLUTION_API_KEY: z.string().default(''),
  EVOLUTION_INSTANCE: z.string().default('nexo-assist'),
  EVOLUTION_WEBHOOK_SECRET: z.string().default(''),
  // URL que a Evolution chama a cada mensagem recebida. Vazio = https://$RAILWAY_PUBLIC_DOMAIN/api/whatsapp/webhook
  PUBLIC_WEBHOOK_URL: z.string().default(''),
  RAILWAY_PUBLIC_DOMAIN: z.string().default(''),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);
/** URL do webhook do WhatsApp: explícita (PUBLIC_WEBHOOK_URL) ou derivada do domínio público da Railway. */
export const webhookUrl = (c: Pick<Config, 'PUBLIC_WEBHOOK_URL' | 'RAILWAY_PUBLIC_DOMAIN'>): string | null =>
  c.PUBLIC_WEBHOOK_URL || (c.RAILWAY_PUBLIC_DOMAIN ? `https://${c.RAILWAY_PUBLIC_DOMAIN}/api/whatsapp/webhook` : null);

export const config = loadConfig();
