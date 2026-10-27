# Nexo Assist · Frontend

Interface do Nexo Assist (React + Vite + TypeScript estrito), seguindo o protótipo do Nexo (cores, tipografia e layout). Três áreas, escolhidas pelo papel da conta:

| Papel | Tela |
|---|---|
| Funcionário | login → **chat** com o agent (cards de chamado, rascunho para confirmar, opções rápidas, limite de 30 mensagens, "Por que respondi assim" com as decisões do agent) + perfil |
| Analista | **console**: lista de conversas com filtros, histórico, assumir (agent pausado), devolver ao agent, encerrar, painel de chamados do funcionário |
| Admin | **WhatsApp**: criar a conexão, ler o QR code, ver o estado, desconectar, registrar o webhook e vincular o celular de cada funcionário |

O backend fica em outro repositório (`nexo-assist-backend`). A autenticação é um **JWT** guardado em `localStorage` e enviado em `Authorization: Bearer`; o tempo real usa SSE via `fetch` (para poder enviar o header), com reconexão automática.

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:5173  (proxy de /api → http://127.0.0.1:3101)
```

Suba antes o backend (porta 3101). Em dev `VITE_API_URL` fica vazio e o Vite faz o proxy; se o backend usar outra porta, ajuste `server.proxy` em `vite.config.ts`.

Scripts: `npm run typecheck` · `npm run build` (gera `dist/`).

## Deploy na Railway

1. Crie um serviço a partir deste repositório (build pelo `Dockerfile`: Vite + nginx).
2. Defina a variável **`VITE_API_URL`** com a URL pública do backend (ex.: `https://desafiotecback-production.up.railway.app`). Ela é lida **no build**; ao mudar, faça um novo deploy.
3. No backend, defina `WEB_ORIGIN` com a URL deste frontend (CORS).

O nginx escuta em `$PORT` (injetada pela Railway) e devolve `index.html` para qualquer rota (SPA).

## Deploy atual

- Frontend: https://desafiotecfront-production.up.railway.app
- API (`VITE_API_URL`): https://desafiotecback-production.up.railway.app

## Estrutura

```
src/
  api.ts            cliente HTTP + tipos do contrato (JWT, 401 → logout)
  auth.tsx          contexto de autenticação
  useStream.ts      SSE com fetch + reconexão
  components/       Blocks (cards, rascunho, opções), Trace (decisões do agent), Mark/Avatar
  pages/            Login, Chat, Profile, Console, Admin
```
