# Nexo Assist · Guia de uso e de teste

O Nexo Assist é um agent de service desk de TI. O funcionário descreve o problema com as próprias palavras, no **site** ou no **WhatsApp**, e o agent consulta os chamados dele, busca na central de ajuda, abre ou atualiza chamados (sempre mostrando um rascunho para confirmar) e chama um analista quando precisa. O analista atende pelo **console**, e o **admin** conecta o WhatsApp e cadastra os números.

## Endereços

| O quê | Onde |
|---|---|
| Aplicação (frontend) | `https://desafiotecfront-production.up.railway.app` |
| API (backend) | `https://desafiotecback-production.up.railway.app` (teste: `/api/health`) |
| **WhatsApp de testes** | **+55 (65) 99232-6088** · [abrir conversa](https://wa.me/5565992326088) |

## Contas de teste

Todas usam a mesma senha de demonstração: **`Nexo@2026`**. O login leva cada perfil à sua tela.

| Perfil | E-mail | Para que serve |
|---|---|---|
| Funcionária | `ana.souza@nexo.com.br` | Chat com o agent. Já tem 6 chamados: um vencido, um aguardando analista, um reabrível |
| Outros funcionários | `carla.mendes@`, `bruno.tavares@`, `diego.ramos@`, `elisa.prado@`, `fabio.nunes@`, `gabriela.rocha@` `nexo.com.br` | Cada um enxerga **só os próprios** chamados |
| Analista N2 | `rafael.lima@nexo.com.br` | Console: conversas, assumir, devolver, encerrar |
| Analista N1 | `marina.costa@nexo.com.br` | Idem, com outro nome no atendimento |
| **Admin** | `admin@nexo.com.br` | Conectar o WhatsApp e **cadastrar celulares** |

## Roteiro rápido (site)

1. **Dúvida resolvida sem chamado.** Entre como Ana e pergunte *"Qual o horário do service desk?"*. O agent responde pela central de ajuda.
2. **Abrir um chamado conversando.** Escreva *"Meu notebook não conecta na VPN, erro 809"*. O agent vê que o artigo só vale para Windows 10 (o notebook da Ana é Windows 11), pergunta quem é afetado, calcula a prioridade e mostra um **rascunho**. O chamado só é criado quando você toca em **Confirmar**.
3. **Consultar chamado.** *"Qual o status do meu chamado?"* lista os chamados abertos. O INC-20311 aparece como **prazo vencido** e o agent oferece chamar um analista.
4. **Sem duplicar.** Descrever de novo o problema do INC-20311 faz o agent propor **atualizar** o chamado existente, não criar outro.
5. **Falar com uma pessoa.** *"Quero falar com um analista"*: a conversa fica **aguardando atendente** e o agent para de responder.
6. **Ver por que o agent respondeu assim.** Acima de cada resposta há as ações do agent; **"Por que respondi assim"** abre o que ele entendeu, a ação, a segurança (%), o motivo, cada passo e os tokens gastos.
7. **Fora de escopo.** Pergunte algo de RH ou financeiro: o agent redireciona.

## Console do analista

Entre como `rafael.lima@nexo.com.br`. Na lista, o filtro **Precisam de você** mostra as conversas transferidas, com o resumo que o agent preparou e a confiança dele. Clique em **Assumir atendimento** (o agent fica pausado), responda ao funcionário e, ao terminar, **Devolver ao agent** ou **Encerrar atendimento**. O painel da direita mostra os chamados do funcionário.

## WhatsApp: a ideia

O agent conversa por WhatsApp **com os funcionários da Nexo**, e é a mesma conversa do site (quem começa num canal continua no outro). Para saber **quem** está falando, o sistema usa o **número do celular**, porque os chamados são privados: cada pessoa só pode ver os próprios. Por isso:

> **Um celular só conversa com o agent depois de ser cadastrado no admin e vinculado a um funcionário.**
> Um número que não está cadastrado recebe só um aviso ("não encontrei este número no cadastro") e **não acessa nada**.

### Como testar o WhatsApp

1. Entre como **admin** (`admin@nexo.com.br`). A tela **WhatsApp** mostra o estado da conexão do número de testes (deve estar **Conectado**).
2. Em **Celulares dos funcionários**, escolha um funcionário (por exemplo **Ana Souza**, que já tem chamados) e digite o **seu** celular com DDI + DDD + número, como `5511999998888`. Clique em **Salvar**.
3. Do **seu celular**, mande uma mensagem para o número de testes: **+55 (65) 99232-6088**.
4. O agent responde como se você fosse a funcionária escolhida: *"Qual o status do meu chamado?"*, *"Meu notebook não conecta na VPN"*, etc. Pelo site, a mesma conversa aparece logada como essa funcionária.

Detalhes do WhatsApp (que não tem botões):

- **Opções** chegam numeradas (`1) Só eu`, `2) Minha equipe`...). Responda com o número.
- **Rascunho de chamado:** responda **1** para confirmar, **2** para editar ou **3** para cancelar.
- Se o chamado for **crítico**, ou se você pedir, o agent transfere para um analista e **para de responder**; a resposta do analista chega no seu WhatsApp.
- Para remover o vínculo, use **Remover** na mesma tela do admin. O mesmo número não pode ficar em dois funcionários.
- Se o número de testes aparecer **Desconectado**, o admin clica em **Gerar QR code** e lê o código no celular do bot (*Aparelhos conectados*).

## Boas práticas e limites

- Cada sessão aceita **30 mensagens** do funcionário. No site, aparece **Nova conversa**; no WhatsApp, envie `nova`.
- O modelo (Google Gemini) tem limite de uso no plano gratuito. Se aparecer *"Estou com muitas solicitações"*, espere alguns segundos e envie de novo.
- As senhas acima são **de demonstração**; em produção as contas viriam do SSO da empresa.
