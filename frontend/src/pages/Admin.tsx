import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, LogOut, QrCode, RefreshCw, Smartphone, Unplug, Webhook } from 'lucide-react';
import { ApiError, api, type AdminEmployee, type WhatsAppState, type WhatsAppStatus } from '../api';
import { useAuth } from '../auth';
import { Avatar, Mark } from '../components/Mark';

const STATE_UI: Record<WhatsAppState, { label: string; tone: string }> = {
  open: { label: 'Conectado', tone: 'success' },
  connecting: { label: 'Aguardando leitura do QR code', tone: 'warning' },
  close: { label: 'Desconectado', tone: 'danger' },
  not_created: { label: 'Conexão ainda não criada', tone: 'muted' },
  unknown: { label: 'Indisponível', tone: 'muted' },
};

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

// O QR code do WhatsApp expira em ~45 s; renovamos antes disso enquanto ele estiver na tela.
const QR_REFRESH_MS = 35_000;
const POLL_MS = 3_000;

export function Admin() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <div className="admin">
      <header className="admin-top">
        <div className="brand">
          <Mark size={20} color="#037AF6" />
          <span>Nexo Assist</span>
          <span className="tag">Administração</span>
        </div>
        <div className="admin-user">
          <Avatar name={user.name} size={30} />
          <span>{user.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => signOut()}>
            <LogOut size={14} /> Sair
          </button>
        </div>
      </header>

      <main className="admin-main">
        <h1 className="page-title">WhatsApp</h1>
        <p className="muted">Conecte o número que vai atender os funcionários e vincule cada celular a um funcionário.</p>
        <ConnectionCard />
        <PhonesCard />
      </main>
    </div>
  );
}

function ConnectionCard() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<{ image: string | null; code: string | null } | null>(null);
  const [busy, setBusy] = useState<'connect' | 'logout' | 'webhook' | null>(null);
  const qrAt = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const s = await api.whatsapp();
      setStatus(s);
      setError(null);
      if (s.state === 'open') setQr(null);
      return s;
    } catch (e) {
      setError(errMsg(e, 'Não foi possível consultar o WhatsApp.'));
      return null;
    }
  }, []);

  const connect = useCallback(async () => {
    setBusy('connect');
    setError(null);
    try {
      const r = await api.whatsappConnect();
      qrAt.current = Date.now();
      setQr(r.state === 'open' ? null : { image: r.qr, code: r.pairingCode });
      await refresh();
    } catch (e) {
      setError(errMsg(e, 'Não foi possível gerar o QR code.'));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Enquanto o QR está na tela: acompanha a conexão e renova o QR antes de expirar.
  useEffect(() => {
    if (!qr) return;
    const id = window.setInterval(async () => {
      const s = await refresh();
      if (s && s.state !== 'open' && Date.now() - qrAt.current > QR_REFRESH_MS) void connect();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [qr, refresh, connect]);

  const run = async (kind: 'logout' | 'webhook') => {
    setBusy(kind);
    setError(null);
    try {
      setStatus(await (kind === 'logout' ? api.whatsappLogout() : api.whatsappWebhook()));
      if (kind === 'logout') setQr(null);
    } catch (e) {
      setError(errMsg(e, 'Ação não concluída.'));
    } finally {
      setBusy(null);
    }
  };

  const ui = status ? STATE_UI[status.state] : null;
  const connected = status?.state === 'open';

  return (
    <section className="panel admin-card">
      <div className="admin-card-head">
        <div>
          <h2>Conexão</h2>
          <div className="muted">Instância {status?.instance ?? '…'}</div>
        </div>
        {ui && <span className={`pill pill-${ui.tone} pill-dot`}>{ui.label}</span>}
      </div>

      {!status && !error && (
        <div className="state-mini">
          <LoaderCircle className="spin" size={18} /> Consultando a Evolution API…
        </div>
      )}

      {status && !status.enabled && (
        <div className="inline-error">
          <CircleAlert size={14} /> Evolution API não configurada. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY no .env do backend.
        </div>
      )}

      {status?.enabled && (
        <>
          {connected ? (
            <div className="notice notice-ok">
              <CheckCircle2 size={16} /> WhatsApp conectado. As mensagens recebidas neste número são respondidas pelo agent.
            </div>
          ) : qr ? (
            <div className="qr-box">
              {qr.image ? <img src={qr.image} alt="QR code para conectar o WhatsApp" width={240} height={240} /> : <div className="qr-wait"><LoaderCircle className="spin" /></div>}
              <ol className="qr-steps">
                <li>No celular do bot, abra o WhatsApp.</li>
                <li>
                  Toque em <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b>.
                </li>
                <li>Aponte a câmera para este QR code. Ele se renova sozinho.</li>
                {qr.code && (
                  <li>
                    Ou use o código de pareamento: <code>{qr.code}</code>
                  </li>
                )}
              </ol>
            </div>
          ) : null}

          <div className="admin-actions">
            {!connected && (
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void connect()}>
                {busy === 'connect' ? <LoaderCircle size={15} className="spin" /> : <QrCode size={15} />}
                {status.state === 'not_created' ? 'Criar conexão e gerar QR code' : 'Gerar QR code'}
              </button>
            )}
            {connected && (
              <button className="btn btn-outline" disabled={!!busy} onClick={() => void run('logout')}>
                {busy === 'logout' ? <LoaderCircle size={15} className="spin" /> : <Unplug size={15} />} Desconectar
              </button>
            )}
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => void refresh()}>
              <RefreshCw size={14} /> Atualizar
            </button>
          </div>

          <div className="webhook-row">
            <Webhook size={16} />
            <div className="grow">
              <b>Webhook</b>
              <div className="muted mono">{status.webhook.expectedUrl ?? 'PUBLIC_WEBHOOK_URL não definido no backend'}</div>
            </div>
            {status.webhook.matches ? (
              <span className="pill pill-success">Registrado</span>
            ) : (
              <button className="btn btn-outline btn-sm" disabled={!!busy || !status.webhook.expectedUrl} onClick={() => void run('webhook')}>
                {busy === 'webhook' && <LoaderCircle size={14} className="spin" />} Registrar webhook
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={14} /> {error}
        </div>
      )}
    </section>
  );
}

function PhonesCard() {
  const [rows, setRows] = useState<AdminEmployee[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await api.adminEmployees()).employees);
      setError(null);
    } catch (e) {
      setError(errMsg(e, 'Não foi possível carregar os funcionários.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="panel admin-card">
      <div className="admin-card-head">
        <div>
          <h2>Celulares dos funcionários</h2>
          <div className="muted">O WhatsApp identifica quem está falando pelo número. Use DDI + DDD + número (ex.: 5511999998888).</div>
        </div>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={14} /> {error}
        </div>
      )}
      {!rows && !error && (
        <div className="state-mini">
          <LoaderCircle className="spin" size={18} /> Carregando…
        </div>
      )}
      {rows && (
        <table className="phones">
          <tbody>
            {rows.map((r) => (
              <PhoneRow key={r.id} row={r} onSaved={load} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PhoneRow({ row, onSaved }: { row: AdminEmployee; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(row.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = value.trim() !== (row.phone ?? '');

  const save = async (phone: string | null) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.setPhone(row.id, phone);
      await onSaved();
      if (phone === null) setValue('');
      setMsg({ ok: true, text: phone === null ? 'Removido' : 'Salvo' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, 'Não foi possível salvar.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>
        <b>{row.name}</b>
        <div className="muted">{row.department}</div>
      </td>
      <td>
        <label className="phone-input">
          <Smartphone size={14} />
          <input
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="5511999998888"
            aria-label={`Celular de ${row.name}`}
            onKeyDown={(e) => e.key === 'Enter' && dirty && value.trim() && void save(value.trim())}
          />
        </label>
      </td>
      <td className="phone-actions">
        <button className="btn btn-outline btn-sm" disabled={busy || !dirty || !value.trim()} onClick={() => void save(value.trim())}>
          Salvar
        </button>
        {row.phone && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save(null)}>
            Remover
          </button>
        )}
        {msg && <span className={msg.ok ? 'ok-text' : 'err-text'}>{msg.text}</span>}
      </td>
    </tr>
  );
}
