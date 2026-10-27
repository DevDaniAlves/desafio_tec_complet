# Nexo Assist

> **Resumo para envio: [RESUMO.md](RESUMO.md)** · **Guia completo (contas, roteiro e WhatsApp): [GUIA_DE_USO.md](GUIA_DE_USO.md)**

**Publicado na Railway:** [aplicação](https://desafiotecfront-production.up.railway.app) · [API](https://desafiotecback-production.up.railway.app/api/health)

Dois projetos independentes, cada um com seu repositório git, Dockerfile e README (deploy na Railway):

| Pasta | O que é |
|---|---|
| [`backend/`](backend/README.md) | API (Fastify + Postgres + agent Mastra/Gemini + JWT + WhatsApp via Evolution) |
| [`frontend/`](frontend/README.md) | Interface (React + Vite): chat do funcionário, console do analista e painel de admin do WhatsApp |

`nexo/nexo.pen` é o protótipo de design de referência e `Desafio_Tecnico_Nexo_Assist_PRD_v5.pdf` o enunciado.

Rodar tudo localmente: veja o README de cada pasta (backend em :3101, frontend em :5173).
