/**
 * Popula o banco com os dados de exemplo (funcionários, analistas, central de ajuda, chamados e conversas).
 *   npm run db:seed    → cria o schema e popula se estiver vazio (idempotente)
 *   npm run db:reset   → APAGA tudo e popula de novo
 * Senha das contas de demonstração: SEED_PASSWORD (padrão em dev: Nexo@2026).
 */
import { config } from '../src/config.js';
import { createPgDb, migrate } from '../src/db.js';
import { resetData, seed } from '../src/seed.js';
import { AuthService } from '../src/services/authService.js';
import { hashPassword } from '../src/services/password.js';

const db = createPgDb(config.DATABASE_URL);
try {
  await migrate(db);
  if (process.argv.includes('--reset')) {
    await resetData(db);
    console.log('Dados anteriores apagados.');
  }
  const password = config.SEED_PASSWORD || (config.NODE_ENV === 'production' ? '' : 'Nexo@2026');
  const populated = await seed(db, { ...(password ? { passwordHash: await hashPassword(password) } : {}) });
  const adminPassword = config.ADMIN_PASSWORD || password;
  if (adminPassword) await new AuthService(db, 'seed-script').ensureAdmin(config.ADMIN_EMAIL, adminPassword);
  console.log(populated ? 'Banco populado: 9 usuários + admin, 10 artigos, 10 chamados e 4 conversas.' : 'Banco já possui dados; nada a fazer (use `npm run db:reset` para recomeçar).');
  if (password) console.log(`Senha das contas de demonstração: ${password}`);
} finally {
  await db.close();
}
