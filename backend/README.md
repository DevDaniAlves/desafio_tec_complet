# Nexo Assist · Backend

API do Nexo Assist: agent de service desk de TI da Nexo. O funcionário descreve o problema numa conversa (no **site** ou no **WhatsApp**) e o agent consulta os chamados dele, busca na central de ajuda, abre/atualiza chamados (sempre com confirmação) e chama um analista quando precisa. O analista atende pelo **console** e o admin conecta o **WhatsApp**.

Node 22 · TypeScript estrito · Fastify · PostgreSQL (`pg`) · **Mastra** + Google Gemini · JWT (`jose`) · Evolution API v2.
O frontend fica em outro repositório (`nexo-assist-frontend`) e fala com esta API por HTTP + SSE.

## Rodar localmente

```bash
npm install
cp .env.example .env          # preencha GEMINI_API_KEY e JWT_SECRET
docker compose up -d          # Postgres em localhost:5442
npm run dev                   # http://localhost:3101
```

No primeiro start o schema é criado e o banco é populado (equivale a `npm run db:seed`). Para apagar tudo e popular de novo: `npm run db:reset`.

**Contas de demonstração.** Todas usam a senha de `SEED_PASSWORD` (em dev, vazio = `Nexo@2026`):

| Papel | E-mail | Vai para |
|---|---|---|
| Funcionária | `ana.souza@nexo.com.br` (e `carla.mendes@`, `bruno.tavares@`, `diego.ramos@`, `elisa.prado@`, `fabio.nunes@`, `gabriela.rocha@`) | chat |
| Analista N2 / N1 | `rafael.lima@nexo.com.br` / `marina.costa@nexo.com.br` | console |
| Admin | `ADMIN_EMAIL` (padrão `admin@nexo.com.br`) com `ADMIN_PASSWORD` | conexão do WhatsApp |

Scripts: `npm test` (45 testes, sem Docker nem rede: PGlite = Postgres real em WASM) · `npm run typecheck` · `npm run db:seed` · `npm run db:reset`.

## Autenticação

Contas têm senha (hash **scrypt**, sem dependências) e o login devolve um **JWT HS256** (`POST /api/auth/login` → `{ token, user }`). O cliente envia `Authorization: Bearer <token>`; o servidor valida a assinatura **e recarrega o usuário do banco** a cada requisição, então papel e existência são sempre atuais. Sem sessão no servidor. Papéis: `employee`, `analyst`, `admin` (rotas `/api/chat/*`, `/api/console/*`, `/api/admin/*` exigem o papel certo). O login responde igual para e-mail inexistente e senha errada, com tempo parecido, e tem rate limit.

## WhatsApp (Evolution API)

1. Configure `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e a **URL do webhook** em `PUBLIC_WEBHOOK_URL` (na Railway pode ficar vazia: usa `https://$RAILWAY_PUBLIC_DOMAIN/api/whatsapp/webhook`).
2. Ao subir, o backend **cria a instância e registra o webhook** na Evolution sozinho (com novas tentativas se a Evolution ainda estiver subindo). Daí em diante, cada mensagem recebida no WhatsApp chega em `POST /api/whatsapp/webhook`, o agent responde e a resposta volta pela Evolution.
3. Entre no frontend como **admin** → **WhatsApp** → *Criar conexão e gerar QR code* e leia o QR no celular do bot (Aparelhos conectados). A tela mostra o estado da conexão e permite desconectar e re-registrar o webhook.
4. Na mesma tela, vincule o **celular de cada funcionário** (DDI+DDD+número). É por esse número que o WhatsApp identifica quem fala; números desconhecidos recebem um aviso e **não acessam nada**.

No WhatsApp não há botões, então as mesmas mensagens estruturadas viram texto: opções são `1) 2) 3)` (a resposta "2" é resolvida para a opção antes de chegar ao modelo) e o rascunho aceita **1** confirmar / **2** editar / **3** cancelar (a confirmação não passa pelo LLM). A conversa é a mesma da web.

## Deploy na Railway

Serviços: **Postgres** e **Evolution** (já existentes) + este backend (build pelo `Dockerfile`). Variáveis do backend:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | referência ao Postgres: `${{Postgres.DATABASE_URL}}` (use a URL **interna** da rede privada) |
| `JWT_SECRET` | **obrigatório** (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | conta de admin (sem `ADMIN_PASSWORD` em produção, nenhum admin é criado) |
| `SEED_PASSWORD` | senha das contas demo (sem ela, em produção as contas demo não conseguem entrar) |
| `WEB_ORIGIN` | URL do frontend na Railway (CORS), ex.: `https://desafiotecfront-production.up.railway.app` |
| `GEMINI_API_KEY` | chave do Gemini (Google AI Studio) |
| `EVOLUTION_API_URL` | URL da Evolution (interna `http://<servico>.railway.internal:8080` ou pública) |
| `EVOLUTION_API_KEY` | chave da Evolution |
| `EVOLUTION_WEBHOOK_SECRET` | **opcional**. Se definido, o webhook exige o segredo no header `x-webhook-secret` **ou** em `?secret=` na `PUBLIC_WEBHOOK_URL` (use a query se a sua Evolution não envia headers). Vazio = sem verificação (só confere a instância) |
| `PUBLIC_WEBHOOK_URL` | opcional; padrão `https://$RAILWAY_PUBLIC_DOMAIN/api/whatsapp/webhook`. Para tráfego interno: `http://<backend>.railway.internal:<PORT>/api/whatsapp/webhook` |

`NODE_ENV=production` já vem do Dockerfile. Healthcheck: `GET /api/health`. Para dados reais (sem demo) use `SEED_ON_START=false`.

## Deploy atual

- API: https://desafiotecback-production.up.railway.app (`/api/health`)
- Frontend: https://desafiotecfront-production.up.railway.app
- No backend, `WEB_ORIGIN` = URL do frontend; no frontend, `VITE_API_URL` = URL da API.

## Arquitetura

```
frontend (outro repo) ── REST + SSE (JWT) ──► http/app.ts ◄── channels/whatsapp.ts ◄── Evolution API (webhook)
                                                  │
                                                  ▼
                        agent/engine.ts  (estado da conversa, pausa, limites, rascunho→confirmação, handoff)
                                                  │ AgentRunner (interface)
                                                  ▼
                        agent/mastraRunner.ts ── Mastra Agent + tools ──► services/{ticketService, kbService}
                                                                              │
                                                       PostgreSQL (conversas, mensagens, rascunhos, chamados, KB, contas)
```

- **Interface / agent / serviços separados.** O agent só enxerga `TicketService` (o "sistema legado" simulado: ids, SLA, instabilidade com retry+backoff) e `KbService`. `AgentRunner` é uma interface: os testes usam um agent roteirizado, e dá para trocar o Mastra ou o provedor (`LLM_PROVIDER`).
- **Uma mensagem estruturada, dois renderizadores.** Cada resposta é `texto + blocks[] + trace`; a web desenha cards, o WhatsApp usa `channels/render.ts`.
- **Tempo real** por SSE; o cliente usa `fetch` streaming (para enviar o JWT) e reconecta sozinho.
- **Pausa do agent** é estado persistido (`conversations.status`: `agent | waiting_agent | human | closed`). Fora de `agent`, o engine registra a mensagem e **não chama o modelo**.

## Como o agent decide

Cada turno é um loop do Mastra (máx. 6 passos, `toolChoice: 'required'`). O modelo **nunca responde com texto solto**: termina chamando uma ferramenta terminal.

| Consulta (pode encadear) | Terminal (encerra o turno) |
|---|---|
| `search_my_tickets`, `get_ticket`, `search_knowledge_base`, `calculate_priority` | `reply`, `ask_options`, `show_tickets`, `draft_ticket`, `handoff_to_analyst` |

Toda ferramenta terminal exige `intent`, `understood`, `confidence` (0–1) e `rationale`: é isso que alimenta a **visibilidade das decisões** (ações acima de cada resposta + "Por que respondi assim" com entendimento, ação, segurança, motivo, passos, modelo, tokens e latência). O prompt descreve o fluxo, mas **as regras importantes são impostas em código**:

| Regra | Onde |
|---|---|
| Chamado só é criado/atualizado após confirmação | `draft_ticket` só gera rascunho; criar acontece em `engine.confirmDraft` (transição atômica: clique duplo cria 1 chamado) |
| Privacidade | Toda consulta recebe o `employeeId` do **token**, nunca do modelo; chamado alheio devolve `NOT_FOUND` igual a inexistente |
| Prioridade/prazo | `calculate_priority` (regra determinística); o rascunho **sobrescreve** a prioridade sugerida pelo modelo; SLA em horas/dias úteis (seg–sex 8–18h, fuso SP) a partir da última atualização |
| Sem duplicidade | `draft_ticket(create)` recusa se há chamado aberto/reabrível parecido; reabrir só até 7 dias |
| Baixa confiança | `confidence < 0.5` em resposta/rascunho vira **transferência forçada** |
| Crítico | Chamado crítico confirmado transfere direto para o N2 |
| Limite | 30 mensagens do funcionário por sessão |
| Legado instável | Retry com backoff; se persistir, o rascunho continua salvo e o agent informa (simule com `LEGACY_FAILURE_RATE=0.3`) |
| Cota/sobrecarga do LLM | Erro de cota (429/503) vira mensagem amigável "tente em alguns segundos" |

## Modelo e custo

Padrão `gemini-3.5-flash` (rápido e barato; `GEMINI_THINKING=low` reduz latência). Se o modelo principal estourar a cota (429/503), o agent tenta sozinho o modelo reserva `gemini-3.1-flash-lite` (a cota do Gemini é por modelo; `AGENT_FALLBACK_MODEL`), e `LLM_CONCURRENCY` limita quantos turnos chamam o LLM ao mesmo tempo. Custo por conversa contido por: máx. 6 passos, `maxOutputTokens` 1200, histórico de 24 mensagens, agent pausado fora de `agent`, confirmação sem LLM e descrições de ferramentas enxutas. Tokens e latência de cada resposta ficam no trace. Atenção: no plano gratuito do Gemini o limite é baixo (≈5 req/min) e cada resposta usa 2–3 chamadas.

## Trade-offs e próximos passos

- **JWT stateless**: simples e sem sessão no servidor; logout é só descartar o token (para revogação imediata, adicionar uma versão de token por usuário).
- **Postgres com SQL direto**, `timestamptz`/`jsonb`; um processo da API (o pub/sub de SSE é em memória) — para escalar horizontalmente, trocar o `Broker` por Redis ou `LISTEN/NOTIFY`.
- **Busca da central de ajuda lexical** (≈10 artigos): previsível e testável; embeddings se a base crescer.
- Com mais tempo: suíte de avaliação com o modelo real (casos dourados e injeção de prompt), streaming de tokens, áudio/anexos no WhatsApp e auditoria do console.
