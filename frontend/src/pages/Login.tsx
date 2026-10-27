import { useState, type FormEvent } from 'react';
import { LoaderCircle, MessageSquareText } from 'lucide-react';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { Mark } from '../components/Mark';

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('ana.souza@nexo.com.br');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(email, password, remember);
      signIn(r.token, r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="showcase">
        <div className="brand brand-light">
          <Mark size={24} color="#fff" />
          <span>Nexo Assist</span>
        </div>

        <div className="story">
          <div className="eyebrow">Service desk de TI da Nexo</div>
          <h1 className="display">Seu problema de TI, resolvido em uma conversa.</h1>
          <p className="lede">Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de ajuda e chama um analista quando precisa.</p>

          <div className="demo" aria-hidden="true">
            <div className="demo-user">Meu notebook não conecta na VPN. Erro 809.</div>
            <div className="demo-agent">
              <div className="demo-chips">consultou seus chamados · criou um chamado</div>
              <div>Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.</div>
              <div className="demo-ticket">
                <b>INC-20517</b> <span>Rede e VPN · Alta · em até 4 h</span>
              </div>
            </div>
          </div>
        </div>

        <div className="stats">
          <div>
            <b>8 s</b>
            <span>primeira resposta, em média</span>
          </div>
          <div>
            <b>72%</b>
            <span>resolvidos sem fila</span>
          </div>
          <div>
            <b>6</b>
            <span>analistas online agora</span>
          </div>
        </div>
      </aside>

      <main className="login-form-wrap">
        <div className="login-top">
          <span className="muted">Problema para entrar?</span> <b>Ligue no ramal 4000</b>
        </div>

        <form className="login-form" onSubmit={submit}>
          <h2>Entrar</h2>
          <p className="muted">Use seu e-mail corporativo e a senha da rede Nexo.</p>

          <label>
            E-mail corporativo
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome.sobrenome@nexo.com.br" />
          </label>
          <label>
            <span className="label-row">
              Senha <a href="#senha" onClick={(e) => e.preventDefault()}>Esqueci minha senha</a>
            </span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
          </label>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Manter conectado neste computador
          </label>

          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-cta btn-block" disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <MessageSquareText size={16} />}
            Entrar
          </button>
        </form>

        <footer className="login-foot">
          <span>© 2026 Nexo · Service desk de TI</span>
          <span>Privacidade e uso de dados</span>
        </footer>
      </main>
    </div>
  );
}
