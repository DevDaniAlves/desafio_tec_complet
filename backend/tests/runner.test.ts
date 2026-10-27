import { describe, expect, it } from 'vitest';
import { MastraRunner } from '../src/agent/mastraRunner.js';
import { setup } from './helpers.js';

const args = JSON.stringify({ message: 'Olá!', intent: 'smalltalk', understood: 'saudação', confidence: 0.9, rationale: 'teste' });
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

/** Modelo falso (spec v2) que SEMPRE responde chamando a ferramenta `reply`, para provar que o loop termina. */
function loopingModel() {
  const counter = { calls: 0 };
  const model = {
    specificationVersion: 'v2',
    provider: 'mock',
    modelId: 'mock',
    supportedUrls: {},
    async doGenerate() {
      counter.calls++;
      return { content: [{ type: 'tool-call', toolCallId: `c${counter.calls}`, toolName: 'reply', input: args }], finishReason: 'tool-calls', usage, warnings: [] };
    },
    async doStream() {
      counter.calls++;
      const id = `c${counter.calls}`;
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] });
            c.enqueue({ type: 'tool-call', toolCallId: id, toolName: 'reply', input: args });
            c.enqueue({ type: 'finish', finishReason: 'tool-calls', usage });
            c.close();
          },
        }),
      };
    },
  };
  return { model, counter };
}

describe('MastraRunner', () => {
  it('encerra o turno na ação terminal: uma única chamada ao modelo, não até o limite de passos', async () => {
    const s = await setup();
    const { model, counter } = loopingModel();
    const runner = new MastraRunner({ model: model as never, id: 'mock', providerOptions: {} });
    const out = await runner.run({ employee: s.ana, history: [{ role: 'user', content: 'oi' }], now: new Date() }, { tickets: s.tickets, kb: s.kb });
    expect(out.final?.action.kind).toBe('reply');
    expect(counter.calls).toBe(1);
  });
});
