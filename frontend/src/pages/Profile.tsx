import { useState } from 'react';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';

export function Profile() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      setSentTo((await api.resetPassword()).sentTo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar o link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Meu perfil</h1>
      <p className="muted">Seus dados de acesso ao service desk de TI.</p>

      <section className="panel">
        <Row label="Nome" value={user.name} />
        <Row label="E-mail corporativo" value={user.email} />
        <Row label="Departamento" value={user.department} />
        <Row label="Equipamento" value={user.device} hint="O assistente usa isto para saber se um artigo se aplica ao seu caso." />
        <div className="row">
          <div>
            <b>Senha</b>
            <div className="muted">Gerenciado pela TI · alterada há 42 dias</div>
          </div>
          <button className="btn btn-outline" onClick={reset} disabled={busy}>
            {busy && <LoaderCircle size={14} className="spin" />} Redefinir senha
          </button>
        </div>
        {sentTo && (
          <div className="notice notice-ok">
            <CheckCircle2 size={16} /> Enviaremos um link de redefinição para {sentTo}.
          </div>
        )}
        {error && <div className="inline-error">{error}</div>}
      </section>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="row">
      <div>
        <b>{label}</b>
        {hint && <div className="muted">{hint}</div>}
      </div>
      <span>{value}</span>
    </div>
  );
}
