/** Texto útil de um erro do provedor (o erro do AI SDK carrega o corpo da resposta inteiro). */
const errorText = (e: unknown): string =>
  [e instanceof Error ? e.message : String(e), (e as { cause?: { message?: string } } | null)?.cause?.message ?? ''].join(' ');

const BUSY = /quota|rate.?limit|429|RESOURCE_EXHAUSTED|overload|503|unavailable|high demand|try again later/i;

/** Cota estourada ou provedor sobrecarregado: vale tentar de novo (ou usar outro modelo). */
export const isBusyError = (e: unknown): boolean => {
  const status = (e as { statusCode?: number } | null)?.statusCode;
  return status === 429 || status === 503 || BUSY.test(errorText(e));
};

/** "Please retry in 44.09s" / "retry in 632.8ms" → segundos de espera sugeridos pelo provedor. */
export function retryAfterSeconds(e: unknown): number | null {
  const m = /retry in ([\d.]+)\s*(ms|s)\b/i.exec(errorText(e));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? (m[2]!.toLowerCase() === 'ms' ? n / 1000 : n) : null;
}

/** Resumo curto e seguro para log/trace (sem despejar o corpo da resposta). */
export function describeLlmError(e: unknown): { busy: boolean; retryAfter: number | null; message: string } {
  return { busy: isBusyError(e), retryAfter: retryAfterSeconds(e), message: errorText(e).replace(/\s+/g, ' ').trim().slice(0, 300) };
}

/** Limita quantas execuções do agent rodam ao mesmo tempo (protege a cota do provedor). */
export class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await job();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
