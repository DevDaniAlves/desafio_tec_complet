import pg from 'pg';

/** Resultado mínimo que os serviços precisam de qualquer driver. */
interface Result {
  rows: unknown[];
  count: number;
}
type Exec = (sql: string, params: unknown[]) => Promise<Result>;

/**
 * Fachada fina sobre o Postgres. Produção usa `pg` (Pool); os testes usam PGlite (Postgres real em WASM),
 * então o mesmo SQL roda nos dois sem mocks.
 */
export class Db {
  constructor(
    private readonly exec: Exec,
    private readonly runTx: <T>(fn: (exec: Exec) => Promise<T>) => Promise<T>,
    private readonly closer: () => Promise<void>,
  ) {}

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.exec(sql, params)).rows as T[];
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  /** Executa e devolve o número de linhas afetadas. */
  async run(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.exec(sql, params)).count;
  }

  tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.runTx((exec) => fn(new Db(exec, (inner) => inner(exec), async () => undefined)));
  }

  close(): Promise<void> {
    return this.closer();
  }
}

const iso = (v: string) => new Date(v).toISOString();

/** timestamptz volta como string ISO (o resto do código trabalha com ISO) e bigint como number. */
const TIMESTAMPTZ = 1184;
const INT8 = 20;

export function createPgDb(connectionString: string): Db {
  pg.types.setTypeParser(TIMESTAMPTZ, iso);
  pg.types.setTypeParser(INT8, (v) => Number(v));
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (e) => console.error('[pg] erro no pool', e));

  const execOn =
    (q: { query: (sql: string, params: unknown[]) => Promise<pg.QueryResult> }): Exec =>
    async (sql, params) => {
      const r = await q.query(sql, params);
      return { rows: r.rows, count: r.rowCount ?? 0 };
    };

  return new Db(
    execOn(pool),
    async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(execOn(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    () => pool.end(),
  );
}

/** Postgres em processo (WASM) para testes: zero Docker, semântica real de Postgres. */
export async function createPgliteDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite({ parsers: { [TIMESTAMPTZ]: iso, [INT8]: (v: string) => Number(v) } });
  await lite.waitReady;
  const execOn =
    (q: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Exec =>
    async (sql, params) => {
      const r = await q.query(sql, params);
      return { rows: r.rows, count: r.affectedRows ?? r.rows.length };
    };
  return new Db(
    execOn(lite),
    (fn) => lite.transaction((tx) => fn(execOn(tx))),
    () => lite.close(),
  );
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    department TEXT NOT NULL,
    phone TEXT,
    device TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('employee','analyst','admin')),
    team TEXT,
    password_hash TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    affected TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_employee ON tickets(employee_id)`,
  `CREATE TABLE IF NOT EXISTS ticket_events (
    id SERIAL PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    at TIMESTAMPTZ NOT NULL,
    note TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tags JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    status TEXT NOT NULL,
    channel TEXT NOT NULL,
    assigned_to TEXT REFERENCES employees(id),
    team TEXT,
    handoff_reason TEXT,
    handoff_summary TEXT,
    handoff_confidence DOUBLE PRECISION,
    handoff_at TIMESTAMPTZ,
    user_msg_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conv_employee ON conversations(employee_id, status)`,
  `CREATE TABLE IF NOT EXISTS messages (
    seq BIGSERIAL,
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL CHECK (role IN ('user','assistant','analyst','system')),
    text TEXT NOT NULL,
    blocks JSONB NOT NULL DEFAULT '[]',
    trace JSONB,
    channel TEXT NOT NULL,
    sender_name TEXT,
    external_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, seq)`,
  `CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    employee_id TEXT NOT NULL REFERENCES employees(id),
    payload JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    ticket_id TEXT,
    created_at TIMESTAMPTZ NOT NULL
  )`,
];

/** Ajustes para bancos criados por versões anteriores (todos idempotentes). */
const UPGRADES = [
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash TEXT`,
  `ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check`,
  `ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role IN ('employee','analyst','admin'))`,
  `DROP TABLE IF EXISTS sessions`,
];

export async function migrate(db: Db): Promise<void> {
  for (const stmt of SCHEMA) await db.run(stmt);
  for (const stmt of UPGRADES) await db.run(stmt);
}

export const nowIso = () => new Date().toISOString();
