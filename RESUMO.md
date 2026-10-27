# Nexo Assist · Desafio Técnico (resumo)

Agent de service desk de TI com chat no **site** e no **WhatsApp**, console do analista e painel de admin. Stack: TypeScript, Fastify, PostgreSQL, Mastra + Google Gemini, JWT, Evolution API, React/Vite.

## Links

- Repositório: https://github.com/DevDaniAlves/desafio_tec_complet (README e [`GUIA_DE_USO.md`](GUIA_DE_USO.md) com o passo a passo completo)
- Aplicação: https://desafiotecfront-production.up.railway.app
- API: https://desafiotecback-production.up.railway.app

## Acesso

Senha de todas as contas: `Nexo@2026`

- Funcionária (chat): `ana.souza@nexo.com.br`
- Analista (console): `rafael.lima@nexo.com.br`
- Admin (WhatsApp e cadastro de celulares): `admin@nexo.com.br`

## WhatsApp de testes: +55 (65) 99232-6088

Como os chamados são privados, o agent identifica quem fala pelo **número do celular**. Por isso, um número só conversa com o agent depois de ser **cadastrado no admin** e vinculado a um funcionário. Quem não estiver cadastrado recebe apenas um aviso e não acessa nada.

Para testar:

1. Entre como admin → **WhatsApp** → **Celulares dos funcionários**.
2. Vincule o **seu** celular (DDI+DDD+número, ex.: `5511999998888`) a um funcionário, como a Ana.
3. Mande uma mensagem do seu celular para o número de testes.
4. Fale *"Qual o status do meu chamado?"* ou *"Meu notebook não conecta na VPN, erro 809"*. O agent mostra um rascunho e só cria o chamado depois de você confirmar (no WhatsApp, responda 1).

## Destaques

O agent explica cada decisão ("Por que respondi assim": o que entendeu, a segurança, o motivo e os passos). As regras de privacidade, prioridade e confirmação estão no código, não só no prompt. Há 55 testes automatizados.
