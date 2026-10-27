import { useEffect, useRef } from 'react';
import { API_URL, authHeaders, type LiveEvent } from './api';

const EVENTS = new Set(['message', 'typing', 'conversation']);

/**
 * Assina o stream SSE com `fetch` (EventSource não permite o header Authorization do JWT).
 * Reconecta sozinho com backoff; a cada (re)conexão chama `onOpen` para o consumidor
 * ressincronizar o estado e não perder eventos emitidos durante a queda.
 */
export function useStream(path: string, onEvent: (e: LiveEvent) => void, onOpen?: () => void) {
  const handler = useRef(onEvent);
  const opened = useRef(onOpen);
  handler.current = onEvent;
  opened.current = onOpen;

  useEffect(() => {
    const ctrl = new AbortController();
    let retry = 1000;

    const run = async () => {
      while (!ctrl.signal.aborted) {
        try {
          const res = await fetch(`${API_URL}${path}`, { headers: { ...authHeaders(), accept: 'text/event-stream' }, signal: ctrl.signal });
          if (res.status === 401 || res.status === 403) return; // sem permissão: não adianta insistir
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          retry = 1000;
          opened.current?.();

          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, i);
              buf = buf.slice(i + 2);
              const type = /^event: (.+)$/m.exec(frame)?.[1];
              const data = /^data: (.+)$/m.exec(frame)?.[1];
              if (type && data && EVENTS.has(type)) handler.current(JSON.parse(data) as LiveEvent);
            }
          }
        } catch {
          if (ctrl.signal.aborted) return;
        }
        await new Promise((r) => setTimeout(r, retry));
        retry = Math.min(retry * 2, 15000);
      }
    };
    void run();
    return () => ctrl.abort();
  }, [path]);
}
