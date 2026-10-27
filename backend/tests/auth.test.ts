import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { setup, TEST_PASSWORD } from './helpers.js';

describe('autenticação (senha + JWT)', () => {
  it('entra com a senha correta e recebe um JWT que identifica o usuário', async () => {
    const { auth } = await setup();
    const r = await auth.login('ana.souza@nexo.com.br', TEST_PASSWORD, false);
    expect(r?.employee.id).toBe('e-ana');
    expect(r?.token.split('.')).toHaveLength(3);
    expect((await auth.fromToken(r!.token))?.email).toBe('ana.souza@nexo.com.br');
  });

  it('o e-mail não diferencia maiúsculas e a resposta nunca inclui o hash da senha', async () => {
    const { auth } = await setup();
    const r = await auth.login('  ANA.SOUZA@nexo.com.br ', TEST_PASSWORD, true);
    expect(r).not.toBeNull();
    expect(JSON.stringify(r)).not.toContain('scrypt$');
  });

  it('rejeita senha errada, senha vazia e e-mail inexistente com a mesma resposta', async () => {
    const { auth } = await setup();
    expect(await auth.login('ana.souza@nexo.com.br', 'errada', false)).toBeNull();
    expect(await auth.login('ana.souza@nexo.com.br', '', false)).toBeNull();
    expect(await auth.login('ninguem@nexo.com.br', TEST_PASSWORD, false)).toBeNull();
  });

  it('conta sem senha (não definida) não consegue entrar', async () => {
    const { auth, db } = await setup();
    await db.run("UPDATE employees SET password_hash = NULL WHERE id = 'e-ana'");
    expect(await auth.login('ana.souza@nexo.com.br', TEST_PASSWORD, false)).toBeNull();
  });

  it('rejeita token adulterado, assinado com outro segredo ou expirado', async () => {
    const { auth } = await setup();
    const good = (await auth.login('ana.souza@nexo.com.br', TEST_PASSWORD, false))!.token;
    expect(await auth.fromToken(good.slice(0, -3) + 'abc')).toBeNull();
    expect(await auth.fromToken(undefined)).toBeNull();
    const forged = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('e-ana').setIssuer('nexo-assist').setExpirationTime('1h').sign(new TextEncoder().encode('outro-segredo-qualquer-0123456789'));
    expect(await auth.fromToken(forged)).toBeNull();
    const expired = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('e-ana').setIssuer('nexo-assist').setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(new TextEncoder().encode('test-secret-test-secret-test-secret'));
    expect(await auth.fromToken(expired)).toBeNull();
  });

  it('o admin é criado a partir do ambiente e tem o papel admin', async () => {
    const { auth } = await setup();
    await auth.ensureAdmin('Admin@Nexo.com.br', 'Admin#456');
    const r = await auth.login('admin@nexo.com.br', 'Admin#456', false);
    expect(r?.employee.role).toBe('admin');
    expect(await auth.login('admin@nexo.com.br', TEST_PASSWORD, false)).toBeNull();
  });

  it('o telefone do WhatsApp só casa com funcionários (nunca analista/admin)', async () => {
    const { auth, db } = await setup();
    await db.run("UPDATE employees SET phone = '5511988887777' WHERE id IN ('e-ana','a-rafael')");
    expect((await auth.byPhone('+55 (11) 98888-7777'))?.id).toBe('e-ana');
    expect((await auth.byPhone('551188887777'))?.id).toBe('e-ana'); // sem o 9º dígito
  });
});

describe('vínculo de celular (admin)', () => {
  it('vincula, normaliza e remove o número de um funcionário', async () => {
    const { auth } = await setup();
    expect(await auth.setPhone('e-ana', '+55 (11) 99999-1234')).toBe('ok');
    expect((await auth.byPhone('5511999991234'))?.id).toBe('e-ana');
    expect(await auth.setPhone('e-ana', null)).toBe('ok');
    expect(await auth.byPhone('5511999991234')).toBeNull();
  });

  it('recusa número inválido, duplicado (inclusive com/sem o 9º dígito) e usuário que não é funcionário', async () => {
    const { auth } = await setup();
    expect(await auth.setPhone('e-ana', '123')).toBe('invalid');
    await auth.setPhone('e-ana', '5511999991234');
    expect(await auth.setPhone('e-carla', '551199991234')).toBe('conflict');
    expect(await auth.setPhone('a-rafael', '5511988880000')).toBe('not_found');
  });
});
