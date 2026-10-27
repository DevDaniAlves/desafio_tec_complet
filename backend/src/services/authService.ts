import { SignJWT, jwtVerify } from 'jose';
import type { Db } from '../db.js';
import { normalizePhone, phoneVariants } from '../domain/phone.js';
import type { Employee } from '../domain/types.js';
import { hashPassword, verifyPassword } from './password.js';

const ISSUER = 'nexo-assist';
// Nunca selecionamos password_hash para fora do AuthService.
const COLS = 'id, name, email, department, phone, device, role, team';

// Hash fixo usado quando o e-mail não existe: o tempo de resposta não revela quais e-mails são válidos.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

export interface LoginResult {
  token: string;
  employee: Employee;
  expiresInSec: number;
}

export class AuthService {
  private readonly key: Uint8Array;

  constructor(
    private readonly db: Db,
    jwtSecret: string,
  ) {
    this.key = new TextEncoder().encode(jwtSecret);
  }

  /** E-mail + senha → JWT assinado (HS256). Stateless: o servidor não guarda sessão. */
  async login(email: string, password: string, remember: boolean): Promise<LoginResult | null> {
    const row = await this.db.get<Employee & { password_hash: string | null }>(`SELECT ${COLS}, password_hash FROM employees WHERE lower(email) = lower($1)`, [email.trim()]);
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) return null;
    const { password_hash: _omit, ...employee } = row;
    const expiresInSec = remember ? 30 * 24 * 3600 : 12 * 3600;
    const token = await new SignJWT({ role: employee.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(employee.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${expiresInSec}s`)
      .sign(this.key);
    return { token, employee, expiresInSec };
  }

  /** Valida o JWT e recarrega o usuário do banco (papel e existência sempre atuais). */
  async fromToken(token: string | undefined): Promise<Employee | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      return payload.sub ? await this.byId(payload.sub) : null;
    } catch {
      return null;
    }
  }

  async byId(id: string): Promise<Employee | null> {
    return (await this.db.get<Employee>(`SELECT ${COLS} FROM employees WHERE id = $1`, [id])) ?? null;
  }

  async byPhone(phone: string): Promise<Employee | null> {
    const variants = phoneVariants(phone);
    if (!variants.length) return null;
    const rows = await this.db.all<Employee>(`SELECT ${COLS} FROM employees WHERE role = 'employee' AND phone IS NOT NULL`);
    return rows.find((r) => phoneVariants(r.phone ?? '').some((v) => variants.includes(v))) ?? null;
  }

  /** Funcionários (com o celular vinculado, se houver): base da tela de admin do WhatsApp. */
  async listEmployees(): Promise<Employee[]> {
    return this.db.all<Employee>(`SELECT ${COLS} FROM employees WHERE role = 'employee' ORDER BY name`);
  }

  /** Vincula (ou remove, com null) o celular de um funcionário. O mesmo número não pode ficar em duas contas. */
  async setPhone(id: string, phone: string | null): Promise<'ok' | 'not_found' | 'invalid' | 'conflict'> {
    const target = await this.db.get<{ id: string }>("SELECT id FROM employees WHERE id = $1 AND role = 'employee'", [id]);
    if (!target) return 'not_found';
    if (phone === null || phone.trim() === '') {
      await this.db.run('UPDATE employees SET phone = NULL WHERE id = $1', [id]);
      return 'ok';
    }
    const digits = normalizePhone(phone);
    if (!/^\d{12,13}$/.test(digits)) return 'invalid'; // 55 + DDD + 8/9 dígitos
    const variants = phoneVariants(digits);
    const others = await this.db.all<{ id: string; phone: string }>('SELECT id, phone FROM employees WHERE phone IS NOT NULL AND id <> $1', [id]);
    if (others.some((o) => phoneVariants(o.phone).some((v) => variants.includes(v)))) return 'conflict';
    await this.db.run('UPDATE employees SET phone = $1 WHERE id = $2', [digits, id]);
    return 'ok';
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.db.run('UPDATE employees SET password_hash = $1 WHERE id = $2', [await hashPassword(password), id]);
  }

  /** Cria/atualiza a conta de administrador a partir do ambiente (ADMIN_EMAIL / ADMIN_PASSWORD). */
  async ensureAdmin(email: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    await this.db.run(
      `INSERT INTO employees (id, name, email, department, phone, device, role, team, password_hash)
       VALUES ('a-admin', 'Administrador', $1, 'TI', NULL, '-', 'admin', NULL, $2)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash`,
      [email.trim().toLowerCase(), hash],
    );
  }

  /** Contas sem senha (ex.: seed antigo) recebem a senha de demonstração informada. Retorna quantas. */
  async backfillPasswords(password: string): Promise<number> {
    return this.db.run('UPDATE employees SET password_hash = $1 WHERE password_hash IS NULL', [await hashPassword(password)]);
  }
}
