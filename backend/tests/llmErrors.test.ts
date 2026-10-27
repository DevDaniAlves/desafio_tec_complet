import { describe, expect, it } from 'vitest';
import { Gate, describeLlmError, isBusyError, retryAfterSeconds } from '../src/agent/llmErrors.js';

const quota = Object.assign(new Error('You exceeded your current quota. Please retry in 44.093384836s.'), { statusCode: 429 });

describe('erros do LLM', () => {
  it('reconhece cota/sobrecarga e extrai o tempo de espera sugerido', () => {
    expect(isBusyError(quota)).toBe(true);
    expect(isBusyError(new Error('This model is currently experiencing high demand.'))).toBe(true);
    expect(isBusyError(new Error('schema inválido'))).toBe(false);
    expect(retryAfterSeconds(quota)).toBeCloseTo(44.09, 1);
    expect(retryAfterSeconds(new Error('Please retry in 632.8ms.'))).toBeCloseTo(0.63, 1);
    expect(retryAfterSeconds(new Error('sem dica'))).toBeNull();
  });

  it('o resumo para log é curto e não despeja o corpo da resposta', () => {
    const big = new Error('x'.repeat(5000));
    expect(describeLlmError(big).message.length).toBeLessThanOrEqual(300);
  });
});

describe('Gate (limite de concorrência)', () => {
  it('nunca executa mais tarefas ao mesmo tempo que o limite', async () => {
    const gate = new Gate(2);
    let active = 0;
    let peak = 0;
    const job = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
    };
    await Promise.all(Array.from({ length: 8 }, () => gate.run(job)));
    expect(peak).toBe(2);
  });

  it('libera a vaga mesmo quando a tarefa falha', async () => {
    const gate = new Gate(1);
    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });
});
