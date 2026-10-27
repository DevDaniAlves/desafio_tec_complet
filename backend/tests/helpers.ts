import { ChatEngine } from '../src/agent/engine.js';
import type { AgentInput, AgentOutcome, AgentRunner, Final } from '../src/agent/context.js';
import { createPgliteDb, migrate } from '../src/db.js';
import { seed } from '../src/seed.js';
import { AuthService } from '../src/services/authService.js';
import { Broker } from '../src/services/broker.js';
import { hashPassword } from '../src/services/password.js';
import { ConversationService } from '../src/services/conversationService.js';
import { KbService } from '../src/services/kbService.js';
import { TicketService } from '../src/services/ticketService.js';

/** Agent roteirizado: devolve a próxima `Final` da fila e guarda as chamadas para asserções. */
export class ScriptedRunner implements AgentRunner {
  calls: AgentInput[] = [];
  constructor(private queue: Final[]) {}
  async run(input: AgentInput): Promise<AgentOutcome> {
    this.calls.push(input);
    return { final: this.queue.shift() ?? null, fallbackText: null, steps: [], model: 'scripted', usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 1 };
  }
}

export const decision = (over: Partial<Final['decision']> = {}): Final['decision'] => ({
  intent: 'question',
  understood: 'teste',
  confidence: 0.9,
  rationale: 'teste',
  ...over,
});

export const TEST_PASSWORD = 'Senha@123';
// scrypt é lento de propósito: calcula uma vez e reaproveita no seed de todos os testes.
const PASSWORD_HASH = await hashPassword(TEST_PASSWORD);

/** Cada teste ganha um Postgres (PGlite) novo, já migrado e populado pelo mesmo seed da aplicação. */
export async function setup(queue: Final[] = [], opts: { sessionLimit?: number; failureRate?: number } = {}) {
  const db = await createPgliteDb();
  await migrate(db);
  await seed(db, { passwordHash: PASSWORD_HASH });
  const broker = new Broker();
  const auth = new AuthService(db, 'test-secret-test-secret-test-secret');
  const conversations = new ConversationService(db, broker);
  const tickets = new TicketService(db, { failureRate: opts.failureRate ?? 0, retryDelayMs: 1 });
  const kb = new KbService(db);
  const runner = new ScriptedRunner(queue);
  const engine = new ChatEngine({ conversations, tickets, kb, runner, sessionLimit: opts.sessionLimit ?? 30, modelName: 'scripted' });
  const ana = (await auth.byId('e-ana'))!;
  return { db, broker, auth, conversations, tickets, kb, runner, engine, ana };
}
