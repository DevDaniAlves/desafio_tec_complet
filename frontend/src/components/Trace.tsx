import { useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Search, Ticket, Gauge, FileText, UserRoundCog, BookOpen } from 'lucide-react';
import type { Trace, TraceStep } from '../api';

const INTENT: Record<string, string> = {
  question: 'Dúvida',
  ticket_status: 'Consulta de chamado',
  open_ticket: 'Abrir chamado',
  update_ticket: 'Atualizar chamado',
  handoff: 'Falar com analista',
  out_of_scope: 'Fora do escopo de TI',
  clarify: 'Precisa de mais informação',
  smalltalk: 'Conversa',
};

const TOOL_ICON: Record<string, typeof Search> = {
  search_my_tickets: Ticket,
  get_ticket: Ticket,
  search_knowledge_base: BookOpen,
  calculate_priority: Gauge,
  draft_ticket: FileText,
  handoff_to_analyst: UserRoundCog,
};

const confidenceTone = (c: number) => (c >= 0.75 ? 'ok' : c >= 0.5 ? 'warn' : 'bad');

export function ActionChips({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="trace">
      <div className="chips">
        {trace.steps.map((s, i) => (
          <StepChip key={i} step={s} />
        ))}
        <button className="chip chip-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Por que respondi assim
        </button>
      </div>
      {open && <TraceDetail trace={trace} />}
    </div>
  );
}

function StepChip({ step }: { step: TraceStep }) {
  const Icon = TOOL_ICON[step.tool] ?? Search;
  return (
    <span className={`chip ${step.ok ? '' : 'chip-bad'}`} title={step.summary}>
      {step.ok ? <Icon size={13} /> : <CircleAlert size={13} />}
      {step.label}
    </span>
  );
}

export function TraceDetail({ trace }: { trace: Trace }) {
  const pct = Math.round(trace.confidence * 100);
  return (
    <div className="trace-detail">
      <dl>
        <dt>Entendeu</dt>
        <dd>
          {trace.understood} <span className="tag">{INTENT[trace.intent] ?? trace.intent}</span>
        </dd>
        <dt>Ação</dt>
        <dd>{trace.action}</dd>
        <dt>Segurança</dt>
        <dd>
          <span className="meter" aria-hidden="true">
            <span className={`meter-fill tone-${confidenceTone(trace.confidence)}`} style={{ width: `${pct}%` }} />
          </span>
          <b className={`tone-text-${confidenceTone(trace.confidence)}`}>{pct}%</b>
          {trace.confidence < 0.5 && <span className="muted"> · abaixo de 50%, o agent transfere para uma pessoa</span>}
        </dd>
        <dt>Por quê</dt>
        <dd>{trace.rationale}</dd>
      </dl>

      {trace.steps.length > 0 && (
        <ol className="steps">
          {trace.steps.map((s, i) => (
            <li key={i}>
              <span className="step-ico">{s.ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}</span>
              <div>
                <div className="step-head">
                  <span>{s.label}</span>
                  <code>{s.tool}</code>
                  <span className="muted">{s.durationMs} ms</span>
                </div>
                <div className="step-sum">{s.summary}</div>
                <details>
                  <summary>entrada</summary>
                  <pre>{JSON.stringify(s.input, null, 2)}</pre>
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="trace-foot">
        <code>{trace.model}</code>
        <span>
          {trace.usage.inputTokens} tokens de entrada · {trace.usage.outputTokens} de saída
        </span>
        <span>{(trace.latencyMs / 1000).toFixed(1)} s</span>
      </div>
    </div>
  );
}
