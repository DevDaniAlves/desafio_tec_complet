import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type { Affected, Category, Priority, TicketStatus, TicketType } from './domain/types.js';

const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const EMPLOYEES = [
  { id: 'e-ana', name: 'Ana Souza', email: 'ana.souza@nexo.com.br', department: 'Financeiro', device: 'Notebook Dell Latitude · Windows 11', phone: null as string | null, role: 'employee', team: null },
  { id: 'e-carla', name: 'Carla Mendes', email: 'carla.mendes@nexo.com.br', department: 'Compras', device: 'Notebook Lenovo ThinkPad · Windows 10', phone: null, role: 'employee', team: null },
  { id: 'e-bruno', name: 'Bruno Tavares', email: 'bruno.tavares@nexo.com.br', department: 'Comercial', device: 'MacBook Air · macOS', phone: null, role: 'employee', team: null },
  { id: 'e-diego', name: 'Diego Ramos', email: 'diego.ramos@nexo.com.br', department: 'Engenharia', device: 'Notebook Dell XPS · Windows 11', phone: null, role: 'employee', team: null },
  { id: 'e-elisa', name: 'Elisa Prado', email: 'elisa.prado@nexo.com.br', department: 'RH', device: 'Notebook HP · Windows 11', phone: null, role: 'employee', team: null },
  { id: 'e-fabio', name: 'Fábio Nunes', email: 'fabio.nunes@nexo.com.br', department: 'Logística', device: 'Desktop Dell · Windows 10', phone: null, role: 'employee', team: null },
  { id: 'e-gabriela', name: 'Gabriela Rocha', email: 'gabriela.rocha@nexo.com.br', department: 'Marketing', device: 'MacBook Pro · macOS', phone: null, role: 'employee', team: null },
  { id: 'a-rafael', name: 'Rafael Lima', email: 'rafael.lima@nexo.com.br', department: 'TI', device: 'Notebook Dell · Windows 11', phone: null, role: 'analyst', team: 'Suporte N2' },
  { id: 'a-marina', name: 'Marina Costa', email: 'marina.costa@nexo.com.br', department: 'TI', device: 'Notebook Dell · Windows 11', phone: null, role: 'analyst', team: 'Suporte N1' },
] as const;

const ARTICLES = [
  { id: 'kb-vpn-809', title: 'VPN com erro 809', tags: ['vpn', 'erro 809', 'rede', 'conexão remota'], body: 'VPN com erro 809: reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.' },
  { id: 'kb-horario', title: 'Horário do service desk', tags: ['horário', 'atendimento', 'plantão', 'funcionamento'], body: 'Horário do service desk: de segunda a sexta, das 8h às 18h. Chamados críticos têm plantão 24 horas. Ramal 4000.' },
  { id: 'kb-senha-rede', title: 'Redefinir a senha da rede', tags: ['senha', 'redefinir', 'bloqueada', 'login', 'acesso'], body: 'Para redefinir a senha da rede, acesse senha.nexo.com.br com seu e-mail corporativo e siga o link enviado. Após 5 tentativas erradas a conta bloqueia por 30 minutos; se continuar bloqueada, abra um chamado de Acesso.' },
  { id: 'kb-wifi', title: 'Wi-Fi corporativo (Nexo-Corp)', tags: ['wifi', 'wi-fi', 'internet', 'rede', 'sem fio'], body: 'Conecte-se à rede Nexo-Corp com seu e-mail e senha da rede. A rede Nexo-Visitas é só para visitantes e não acessa sistemas internos. Se a Nexo-Corp não aparecer, desative e ative o Wi-Fi e reinicie o notebook.' },
  { id: 'kb-outlook-celular', title: 'Outlook não sincroniza no celular', tags: ['outlook', 'email', 'e-mail', 'celular', 'sincronizar', 'sincroniza'], body: 'No celular, remova a conta e adicione de novo pelo app Outlook usando o e-mail corporativo. Confirme que o app está atualizado e que o aplicativo Microsoft Authenticator está ativo. Se o erro persistir, abra um chamado de E-mail.' },
  { id: 'kb-software', title: 'Como instalar um software', tags: ['software', 'instalar', 'programa', 'portal de softwares', 'licença'], body: 'Softwares homologados estão no portal de softwares (Menu Iniciar > Portal Nexo). Softwares fora do catálogo exigem uma requisição (REQ) de Software com justificativa e aprovação do gestor.' },
  { id: 'kb-impressora', title: 'Impressora não imprime', tags: ['impressora', 'imprimir', 'impressão', 'fila'], body: 'Cancele os documentos da fila de impressão, desligue e ligue a impressora e tente de novo. Se a impressora não aparecer, adicione-a pelo endereço impressao.nexo.com.br. Persistindo, abra um chamado de Hardware.' },
  { id: 'kb-lentidao', title: 'Notebook lento: diagnóstico rápido', tags: ['lento', 'lentidão', 'notebook', 'travando', 'desempenho', 'windows', 'atualização'], body: 'Reinicie o notebook, feche programas que não usa e rode o diagnóstico da central (Portal Nexo > Diagnóstico). Se a lentidão continuar após a reinicialização e o diagnóstico, abra um chamado de Hardware.' },
  { id: 'kb-teams', title: 'Teams: sem áudio ou vídeo', tags: ['teams', 'reunião', 'áudio', 'vídeo', 'microfone', 'câmera'], body: 'No Teams, abra Configurações > Dispositivos e escolha o microfone e a câmera corretos. Verifique também a permissão do Windows em Privacidade > Microfone/Câmera. Se persistir, abra um chamado de Software.' },
  { id: 'kb-acesso-pasta', title: 'Acesso a pastas e sistemas', tags: ['acesso', 'pasta', 'sharepoint', 'sap', 'permissão', 'sistema'], body: 'Pedidos de acesso a pastas, SharePoint e sistemas (SAP, etc.) são requisições (REQ) de Acesso e precisam de aprovação do gestor da área. Informe o recurso e a justificativa.' },
];

interface SeedTicket {
  id: string;
  emp: string;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: TicketStatus;
  affected: Affected;
  createdAgo: number;
  updatedAgo: number;
  resolvedAgo?: number;
}

const TICKETS: SeedTicket[] = [
  { id: 'INC-20311', emp: 'e-ana', type: 'INC', title: 'Notebook lento após atualização do Windows', description: 'Lentidão geral desde a atualização de 15/10. Reiniciar e rodar o diagnóstico da central não resolveu.', category: 'Hardware', priority: 'medium', status: 'waiting_analyst', affected: 'self', createdAgo: 8 * DAY, updatedAgo: 6 * DAY },
  { id: 'INC-20298', emp: 'e-ana', type: 'INC', title: 'Acesso à pasta Financeiro no SharePoint', description: 'Sem permissão de leitura na pasta Financeiro/Fechamento.', category: 'Acesso', priority: 'medium', status: 'in_progress', affected: 'self', createdAgo: 4 * DAY, updatedAgo: 1 * DAY },
  { id: 'REQ-10442', emp: 'e-ana', type: 'REQ', title: 'Segundo monitor para home office', description: 'Solicitação de um segundo monitor para trabalho remoto.', category: 'Hardware', priority: 'low', status: 'approved', affected: 'self', createdAgo: 10 * DAY, updatedAgo: 7 * DAY },
  { id: 'INC-20150', emp: 'e-ana', type: 'INC', title: 'Senha do SAP bloqueada', description: 'Conta do SAP bloqueada após tentativas erradas.', category: 'Acesso', priority: 'medium', status: 'resolved', affected: 'self', createdAgo: 6 * DAY, updatedAgo: 4 * DAY, resolvedAgo: 4 * DAY },
  { id: 'INC-19877', emp: 'e-ana', type: 'INC', title: 'Outlook não sincroniza no celular', description: 'Caixa de entrada não atualiza no app do celular.', category: 'E-mail', priority: 'low', status: 'resolved', affected: 'self', createdAgo: 60 * DAY, updatedAgo: 55 * DAY, resolvedAgo: 55 * DAY },
  { id: 'INC-19410', emp: 'e-ana', type: 'INC', title: 'Troca de senha da rede', description: 'Senha da rede expirada.', category: 'Acesso', priority: 'low', status: 'resolved', affected: 'self', createdAgo: 110 * DAY, updatedAgo: 108 * DAY, resolvedAgo: 108 * DAY },
  { id: 'REQ-10390', emp: 'e-carla', type: 'REQ', title: 'Acesso ao módulo de compras do SAP', description: 'Preciso do perfil de comprador no SAP para fechar pedidos.', category: 'Acesso', priority: 'high', status: 'in_progress', affected: 'self', createdAgo: 1 * DAY, updatedAgo: 3 * 3600_000 },
  { id: 'INC-20402', emp: 'e-bruno', type: 'INC', title: 'Teams sem áudio nas reuniões', description: 'Microfone não é detectado no Teams.', category: 'Software', priority: 'medium', status: 'open', affected: 'self', createdAgo: 2 * DAY, updatedAgo: 2 * DAY },
  { id: 'INC-20455', emp: 'e-diego', type: 'INC', title: 'Pipeline de build sem acesso ao registry', description: 'Servidores de build da equipe não acessam o registry interno.', category: 'Rede e VPN', priority: 'critical', status: 'in_progress', affected: 'team', createdAgo: 3 * 3600_000, updatedAgo: 30 * 60_000 },
  { id: 'INC-20120', emp: 'e-fabio', type: 'INC', title: 'Impressora de etiquetas parada', description: 'Impressora de etiquetas do galpão não imprime.', category: 'Hardware', priority: 'high', status: 'resolved', affected: 'team', createdAgo: 2 * DAY, updatedAgo: 1 * DAY, resolvedAgo: 1 * DAY },
];

const TABLES = ['messages', 'drafts', 'conversations', 'ticket_events', 'tickets', 'articles', 'counters', 'employees'];

/** Apaga todos os dados (mantém o schema). Usado por `npm run db:reset`. */
export async function resetData(db: Db): Promise<void> {
  await db.run(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

/**
 * Popula funcionários, analistas, central de ajuda, chamados em situações variadas e conversas
 * para o console. Idempotente: não faz nada se já houver funcionários. Retorna true se populou.
 */
export async function seed(db: Db, opts: { passwordHash?: string } = {}): Promise<boolean> {
  const has = await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM employees');
  if (has && has.n > 0) return false;

  await db.tx(async (tx) => {
    for (const e of EMPLOYEES) {
      await tx.run('INSERT INTO employees (id, name, email, department, phone, device, role, team, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
        e.id,
        e.name,
        e.email,
        e.department,
        e.phone,
        e.device,
        e.role,
        e.team,
        opts.passwordHash ?? null,
      ]);
    }

    for (const a of ARTICLES) await tx.run('INSERT INTO articles (id, title, body, tags) VALUES ($1, $2, $3, $4::jsonb)', [a.id, a.title, a.body, JSON.stringify(a.tags)]);

    for (const t of TICKETS) {
      await tx.run(
        `INSERT INTO tickets (id, employee_id, type, title, description, category, priority, status, affected, created_at, updated_at, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [t.id, t.emp, t.type, t.title, t.description, t.category, t.priority, t.status, t.affected, ago(t.createdAgo), ago(t.updatedAgo), t.resolvedAgo ? ago(t.resolvedAgo) : null],
      );
    }
    await tx.run("INSERT INTO counters (name, value) VALUES ('ticket_INC', 20516), ('ticket_REQ', 10500)");

    await seedConversations(tx);
  });
  return true;
}

interface SeedMsg {
  role: 'user' | 'assistant' | 'analyst';
  text: string;
  agoMs: number;
  sender?: string;
}

async function seedConversations(db: Db): Promise<void> {
  const conv = async (
    emp: string,
    status: string,
    updatedAgo: number,
    extra: { team?: string; reason?: string; summary?: string; confidence?: number; assigned?: string },
    msgs: SeedMsg[],
  ) => {
    const id = randomUUID();
    await db.run(
      `INSERT INTO conversations (id, employee_id, status, channel, assigned_to, team, handoff_reason, handoff_summary, handoff_confidence, handoff_at, user_msg_count, created_at, updated_at)
       VALUES ($1, $2, $3, 'web', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        emp,
        status,
        extra.assigned ?? null,
        extra.team ?? null,
        extra.reason ?? null,
        extra.summary ?? null,
        extra.confidence ?? null,
        extra.reason ? ago(updatedAgo) : null,
        msgs.filter((m) => m.role === 'user').length,
        ago(updatedAgo + 600_000),
        ago(updatedAgo),
      ],
    );
    for (const m of msgs) {
      await db.run("INSERT INTO messages (id, conversation_id, role, text, blocks, channel, sender_name, created_at) VALUES ($1, $2, $3, $4, '[]'::jsonb, 'web', $5, $6)", [
        randomUUID(),
        id,
        m.role,
        m.text,
        m.sender ?? null,
        ago(m.agoMs),
      ]);
    }
  };

  await conv('e-carla', 'waiting_agent', 25 * 60_000, { team: 'Suporte N2', reason: 'Funcionário pediu um analista', summary: 'Precisa de acesso ao SAP ainda hoje (REQ-10390 em andamento).', confidence: 0.9 }, [
    { role: 'user', text: 'Preciso de acesso ao SAP ainda hoje', agoMs: 28 * 60_000 },
    { role: 'assistant', text: 'Você já tem o REQ-10390 em andamento. Quer que eu chame um analista para acelerar?', agoMs: 27 * 60_000 },
    { role: 'user', text: 'Sim, por favor', agoMs: 26 * 60_000 },
    { role: 'assistant', text: 'Encaminhei para o Suporte N2. Um analista fala com você em até 2 h úteis.', agoMs: 25 * 60_000 },
  ]);
  await conv('e-bruno', 'waiting_agent', 40 * 60_000, { team: 'Suporte N1', reason: 'Baixa confiança do agent', summary: 'Relata travamentos intermitentes no Mac sem padrão claro; não foi possível classificar.', confidence: 0.41 }, [
    { role: 'user', text: 'Meu Mac congela de vez em quando e não sei o motivo', agoMs: 44 * 60_000 },
    { role: 'assistant', text: 'Não encontrei um artigo que se encaixe. Vou chamar um analista para isso.', agoMs: 40 * 60_000 },
  ]);
  await conv('e-fabio', 'agent', 30 * 60_000, {}, [
    { role: 'user', text: 'Como instalo o Teams no meu desktop?', agoMs: 32 * 60_000 },
    { role: 'assistant', text: 'Softwares homologados estão no portal de softwares (Menu Iniciar > Portal Nexo).', agoMs: 31 * 60_000 },
    { role: 'user', text: 'Isso resolveu, obrigado!', agoMs: 30 * 60_000 },
  ]);
  await conv('e-gabriela', 'closed', 20 * 3600_000, { assigned: 'a-marina' }, [
    { role: 'user', text: 'A senha do Wi-Fi não funciona', agoMs: 21 * 3600_000 },
    { role: 'assistant', text: 'Use seu e-mail e a senha da rede na Nexo-Corp. A Nexo-Visitas é só para visitantes.', agoMs: 20.9 * 3600_000 },
  ]);
}
