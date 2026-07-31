# Progresso — conector Koper

> **Nota sobre este documento.** Ele não existia até 2026-07-31, apesar da Seção 4 da constituição exigir seu preenchimento a cada ciclo desde o início do trabalho. Esta primeira versão foi **reconstruída retroativamente** a partir do histórico de commits da branch `feature/koper-connector-bootstrap` (42 commits, todos em 2026-07-30) e dos logs de deploy do Railway (projeto `powerful-joy`, serviço `koper-worker`). A partir de agora, todo ciclo novo é registrado aqui em tempo real, como a constituição exige.

---

## 2026-07-30 — Fundação do worker (PR #152)

Commits `d8a2dfe3` … `32cb8776` (11:18–11:22).

Criado o serviço `services/koper-worker` isolado da aplicação principal: pacote TypeScript estrito, validação de variáveis de ambiente com `zod`, conexão Playwright `connectOverCDP` ao Browserless, `GET /health`, `POST /diagnostics/browserless` protegido por Bearer token, Dockerfile para Railway, guia de deploy e Codespaces. Nenhuma leitura de dado do Koper ainda — só validação de que a infraestrutura (Browserless + Railway) funciona. PR #152 aberto para `main`, ainda não mesclado.

## 2026-07-30 — Login visual assistido, depois substituído

Commits `158df17e` … `ac562d99` (16:23–16:25).

Primeira tentativa: sessão visual temporária via Browserless (`liveUrl`) para login manual do Fábio, com timeout configurável. Funcionou, mas foi descartada horas depois.

Commits `63dded18` … `3fa21b61` (16:45–16:51).

**Hipótese:** dá para logar automaticamente com `KOPER_USERNAME`/`KOPER_PASSWORD` sem sessão visual, o que é mais rápido para o ciclo de diagnóstico. **Resultado:** confirmada — login automático implementado (`src/auth/koper-auto-login.ts`), validado, exposto num endpoint de teste. O fluxo visual manual foi removido (`3fa21b61 refactor(koper): remover fluxo visual não suportado`) por não ser mais necessário.

## 2026-07-30 — Reaproveitamento do login e detecção de sessão

Commits `caa7ad0d`, `f7f946e7`, `96d8706e` (16:57–16:58).

Login automático extraído para reuso por qualquer diagnóstico (`performKoperLogin`). Primeiro diagnóstico de navegação pós-login exposto.

Commit `e49dc72f` (17:01).

**Hipótese:** o diagnóstico está classificando sessões como não autenticadas mesmo após login bem-sucedido, porque a detecção depende de evento de navegação que nem sempre dispara a tempo. **Resultado:** confirmada — trocada a detecção para "ausência do campo de senha na tela renderizada", que é mais robusta. **Aprendizado registrado em `CLAUDE.md`, Seção 18.**

## 2026-07-30 — Descoberta da tela de Solicitações de estoque

Commit `0e45f2ae` (17:05).

**Hipótese:** a listagem de solicitações de estoque usa GraphQL, como o resto do Koper aparenta usar. **Ação:** instrumentado captura de operações GraphQL (`parseGraphQlOperation`) na página de solicitações. **Resultado:** diagnóstico exposto (`9d606ff4`), mas a primeira rodada não encontrou o card de "Solicitações" clicável de forma confiável.

Commit `b9724602` (17:09).

**Hipótese:** o seletor usado para clicar no card de solicitações não bate com o DOM real. **Resultado:** corrigido para clicar no card **visível** (havia elementos duplicados/ocultos com o mesmo texto).

Commits `7d229c01`, `906b83e9` (17:12–17:13).

**Hipótese:** existe uma rota direta (ex.: um `<a href>` ou atributo de rota) para "Solicitações" que evita precisar clicar em qualquer coisa. **Ação:** novo diagnóstico `discover-stock-route` que primeiro procura um `routeCandidate` por texto/atributo antes de tentar clique. **Resultado:** parcialmente confirmada — o diagnóstico roda, mas nas primeiras execuções `routeCandidate` veio `null` (nenhum link direto óbvio).

Commits `3b9665b4`, `479ac23a` (17:19).

**Ação paralela:** mapeamento do menu principal inteiro (`inspect-koper-menu-map`) para entender a estrutura de navegação por fora da hipótese de rota direta.

Commits `a418c697`, `aa9cc7a1` (18:10–18:11).

Ambos os diagnósticos (`menu-map` e `stock-route`) passam a poder rodar na inicialização do container via `KOPER_STARTUP_DIAGNOSTIC` (Caminho A da Seção 4.2), evitando precisar do Console do Railway a cada ciclo.

Commits `87fd0a88`, `b730dc9d` (18:13–18:15).

**Hipótese:** "Solicitações" não é um item de topo do menu — é preciso abrir o módulo **Suprimentos** primeiro, e só então o item "Solicitações" aparece dentro dele. **Resultado:** confirmada. Estratégia registrada como `"open-menu-and-click-visible-item"`: abre o menu de Suprimentos, localiza o item visível "Solicitações", clica.

Commit `0a1627f9` (18:17).

**Hipótese:** agora que a navegação até a tela funciona, a listagem deve disparar uma operação GraphQL que ainda não foi capturada por timing. **Ação:** captura de operações GraphQL ampliada. **Resultado:** descartada — `graphql: []` em todas as execuções seguintes. Nenhuma operação GraphQL observada na tela de solicitações.

Commit `f25ca307` (18:19).

**Hipótese revisada:** se não é GraphQL, o transporte real deve aparecer mapeando **todas** as respostas XHR/fetch da página, não só as que parecem GraphQL. **Ação:** novo campo `network[]` no diagnóstico, registrando método, endpoint, tipo de conteúdo e chaves do corpo de toda requisição XHR/fetch. **Resultado:** confirmada — apareceu `GET https://api.koper.com.br/stock/v1/request` com parâmetros de paginação e filtro.

Commit `e7d01c45` (18:22) — **diagnóstico mais recente.**

**Hipótese:** `GET /stock/v1/request` é de fato o endpoint de listagem, e sua resposta contém os campos da tabela mostrada em tela. **Ação:** captura e parseia especificamente a resposta desse endpoint (`apiReads[]`), com `queryParams` (mascarando `accessToken` e `cb`), `dataKeys` e `fieldPaths` completos.

### Execução: `POST /diagnostics/koper/stock-route` — Caminho A

`KOPER_STARTUP_DIAGNOSTIC=stock-route`, deploy `9efa0027` (commit `e7d01c45`), log lido em `2026-07-30T21:23:36Z`, variável removida do Railway em `2026-07-31` (nesta sessão, ver abaixo).

**Resultado (trechos relevantes, `accessToken`/`cb` mascarados na origem):**

```json
{
  "authenticated": true,
  "strategy": "open-menu-and-click-visible-item",
  "menuOpened": true,
  "routeCandidate": null,
  "finalUrl": "https://app.koper.com.br/suprimentos/solicitacoes/",
  "title": "KOPER - Solicitações",
  "headings": ["Solicitações"],
  "tableHeaders": ["Solicitação", "Local De Consumo", "Quantidade", "Solicitado Em", "Entregar Até", "Status"],
  "graphql": [],
  "apiReads": [
    {
      "method": "GET",
      "status": 200,
      "endpoint": "https://api.koper.com.br/stock/v1/request",
      "queryParams": {
        "accessToken": "[REDACTED]",
        "cb": "[REDACTED]",
        "group": "request",
        "limit": "25",
        "offset": "0",
        "open": "yes",
        "orderFlag": "desc",
        "orderby": "requestDate",
        "typeDate": "requestDate"
      },
      "dataKeys": ["itemsAmount", "requests"],
      "fieldPaths": [
        "itemsAmount", "requests",
        "requests.requestId", "requests.requestAuxId",
        "requests.stockPlaceId", "requests.stockPlaceName",
        "requests.productAmount", "requests.requestDate", "requests.deadline",
        "requests.status", "requests.userName", "requests.userId",
        "requests.isUrgent", "requests.userAbbreviation",
        "requests.notApprovedAmount", "requests.isDraft", "requests.deadlinePeriod"
      ]
    }
  ]
}
```

Também observado no mapa de rede (não confirmado como relevante ainda): `GET https://api.koper.com.br/stock/v1/stock_place` (provável lista de locais de estoque, usada como filtro na tela).

**Hipótese confirmada.** Rota real, forma de navegação e endpoint de listagem da entidade `stock_request` estão identificados. **Transporte é REST, não GraphQL** — desvio registrado em `CLAUDE.md`, Seção 18, e no item 3 do Marco Técnico. Ver `docs/koper-inventory.md` para a tabela completa da entidade.

**Itens do Marco Técnico (Seção 16) fechados por este ciclo:** 1 (rota), 2 (navegação), 3 (endpoint, adaptado para REST), 6 (parte de variáveis de listagem: paginação `limit`/`offset`, filtro `open`, ordenação `orderby`/`orderFlag`, filtro de data `typeDate`).

**Itens ainda em aberto:** 4 (não se aplica em REST — mas falta confirmar se há paginação além da primeira página, isto é, se `itemsAmount` reflete o total real e como o offset avança), 7 (endpoint de **detalhe** de uma solicitação individual — ainda não observado), 8 (confirmar se `requestId` é de fato o identificador imutável, ou se `requestAuxId` — visível como `#10531` na tela — é o número público e `requestId` o interno), 9–14 (cliente de produção, staging, amostra, validação, idempotência — nada disso começou).

---

## 2026-07-31 — Reconstrução da documentação e correção de branch

**Diagnóstico executado:** nenhum novo diagnóstico Koper nesta sessão. Trabalho de auditoria e correção de processo.

**Resultado:**
- Confirmado GitHub e Railway disponíveis nesta sessão (Railway precisou ser conectado durante a sessão, com autorização do Fábio).
- Identificado que a branch designada para esta sessão (`claude/koper-connector-bootstrap-1trwgg`) estava vazia — todo o trabalho real do conector está em `feature/koper-connector-bootstrap`, que é a branch que o serviço Railway `koper-worker` (projeto `powerful-joy`) de fato observa para deploy automático.
- Identificado que `services/koper-worker/CLAUDE.md`, `docs/koper-progress.md` e `docs/koper-inventory.md` nunca haviam sido commitados, apesar de exigidos pela própria constituição desde o primeiro ciclo.
- `KOPER_STARTUP_DIAGNOSTIC` estava setado como `stock-route` desde o último ciclo; removido (esvaziado) do Railway nesta sessão, conforme Caminho A da Seção 4.2, já que o resultado já havia sido lido e registrado acima.

**Hipótese confirmada/descartada:** N/A — ciclo de correção de processo, não de descoberta.

**Arquivos alterados:** `services/koper-worker/CLAUDE.md` (criado), `services/koper-worker/docs/koper-progress.md` (criado), `services/koper-worker/docs/koper-inventory.md` (criado).

**Próximo bloqueio:** nenhum técnico. Falta decidir com o Fábio se o PR #152 (ainda com descrição da etapa de fundação) deve ser atualizado para refletir todo o trabalho de descoberta já feito, ou se um PR novo deve ser aberto quando a entidade `stock_request` fechar (Seção 6 da constituição).

**Próxima alteração pequena sugerida:** com a listagem confirmada, o próximo ciclo de descoberta deveria mirar o **endpoint de detalhe** de uma solicitação individual — hipótese: `GET https://api.koper.com.br/stock/v1/request/{requestId}` (ou similar), disparado ao clicar numa linha da tabela (`#10531`, etc.). Isso fecha o item 7 do Marco Técnico e ajuda a confirmar qual campo (`requestId` vs. `requestAuxId`) é o identificador imutável real (item 8).

---

## 2026-07-31 — Detalhe da solicitação de estoque descoberto

Diagnóstico novo: `src/diagnostics/inspect-stock-request-detail.ts`, exposto em `POST /diagnostics/koper/stock-request-detail` e como `KOPER_STARTUP_DIAGNOSTIC=stock-request-detail`. Reaproveita `openLikelyMenu` e `clickVisibleStockOccurrence` de `discover-stock-route.ts` (exportadas nesta rodada com uma alteração mínima).

**Iteração 1 — commit `c52d1f9`/`4c77d28`.** **Hipótese:** clicar numa linha da tabela de solicitações dispara `GET /stock/v1/request/{requestId}`. **Ação:** diagnóstico que localiza a linha por texto `/^#\d+/` e clica. **Resultado:** `rowClicked: false`, `message: "KOPER_STOCK_REQUEST_ROW_NOT_FOUND"` — o seletor por texto não achou o elemento (provavelmente porque o número vem misturado com outro texto no mesmo nó, ex. `#8649 por GA`). **Descartada** a busca por texto isolado.

**Iteração 2 — commit `f772ea6`.** **Hipótese revisada:** clicar diretamente na primeira `<tr>` real da tabela (`table tbody tr`) é mais robusto que procurar por texto. **Resultado:** confirmada — `rowClicked: true`, `finalUrl: https://app.koper.com.br/suprimentos/solicitacoes/8649` (clicou na linha `#8649`). A rota de detalhe usa o número da solicitação diretamente no caminho. Mas `detailReads: []` — o filtro de rede ainda procurava `/stock/v1/request/{id}`, que não existe.

**Iteração 3 — commit `6fbd86f`.** **Hipótese:** preciso ver todo o tráfego xhr/fetch da tela de detalhe antes de adivinhar o endpoint, do mesmo jeito que funcionou para a listagem. **Ação:** adicionado campo `network[]` sem filtro. **Resultado:** revelou `GET https://api.koper.com.br/stock/v1/product_request` com `requestId=8649` como query param — endpoint totalmente diferente do que eu presumia (não é `/stock/v1/request/{id}`, é `/stock/v1/product_request?requestId=...`).

**Iteração 4 — commit `8ea9599`.** **Hipótese:** ajustando o filtro para `/stock/v1/product_request`, capturo o corpo da resposta. **Resultado:** confirmada.

### Execução final: `POST /diagnostics/koper/stock-request-detail` — Caminho A

`KOPER_STARTUP_DIAGNOSTIC=stock-request-detail`, deploy `39bbfb0b`, log lido em `2026-07-31T14:11:19Z`, variável removida do Railway logo em seguida.

**Resultado (query params sensíveis mascarados na origem):**

```json
{
  "authenticated": true,
  "listReached": true,
  "rowClicked": true,
  "clickedRowText": "#8649 por GA Escritório Central 3 itens 27/11/2025 15:23:03 04/12/2025 Aprovado",
  "finalUrl": "https://app.koper.com.br/suprimentos/solicitacoes/8649",
  "detailReads": [
    {
      "method": "GET",
      "status": 200,
      "endpoint": "https://api.koper.com.br/stock/v1/product_request",
      "queryParams": {
        "accessToken": "[REDACTED]",
        "appVersion": "5.9.0.5",
        "cb": "[REDACTED]",
        "group": "request",
        "requestId": "8649",
        "visited-page": "/suprimentos/solicitacoes/8649"
      },
      "dataKeys": [
        "itemsAmount", "stockPlaceName", "requestDate", "userName", "userId",
        "deadline", "showDeadline", "stockPlaceId", "techAssistId",
        "buildMonitoringId", "isDraft", "requestId", "status", "requestAuxId",
        "notApprovedAmount", "commentRequest", "products", "filename", "fileId"
      ],
      "fieldPaths": [
        "products.productId", "products.productName", "products.productFullName",
        "products.mainProductId", "products.genericProdSeq", "products.prodReference",
        "products.productAmount", "products.prodFinished", "products.prodCanceled",
        "products.prodCancelRequest", "products.approvedTransf", "products.approvedPurchase",
        "products.productRequestId", "products.approvedAmount", "products.approvedDate",
        "products.approvedUserName", "products.historyId", "products.historyMessage",
        "products.unitMeasureId", "products.symbol", "products.inputId",
        "products.inputUnit", "products.specialMeasure", "products.comments",
        "products.totalComments", "products.enabledToCancel", "products.measures",
        "products.services", "products.services.itemMonitInputId",
        "products.services.monitInputPchId", "products.services.inputAmount"
      ]
    }
  ]
}
```

**Hipótese confirmada.** Endpoint de detalhe: `GET https://api.koper.com.br/stock/v1/product_request?requestId={numero}&group=request&...`. O `requestId` usado na URL (`8649`) é o mesmo número exibido como `#8649` na listagem — forte evidência de que `requestId` é o identificador usado para endereçar o registro. A resposta também traz `requestAuxId` como campo **separado** de `requestId`; não temos ainda os *valores* de cada um lado a lado para provar se são iguais ou diferentes (só os nomes dos campos foram capturados, não os valores completos do corpo). **Ver `docs/koper-inventory.md` para a tabela atualizada.**

**Itens do Marco Técnico fechados por este ciclo:** 7 (operação de detalhe confirmada). Item 8 (identificador imutável) avança bastante — `requestId` é o campo usado para buscar o detalhe — mas fica **parcialmente aberto** até confirmarmos por valor que `requestId` (não `requestAuxId`) é de fato o campo a usar como `koper_id` na staging.

**Próximo bloqueio:** nenhum técnico crítico. Para fechar o item 8 com certeza, o próximo diagnóstico deveria capturar e comparar os **valores** de `requestId` e `requestAuxId` no mesmo registro (não só os nomes dos campos) — hoje `collectFieldPaths` só lista caminhos, não valores, para não vazar dado potencialmente sensível sem controle. Também ficou pendente confirmar a paginação real da listagem (item 4) e iniciar a extração para `src/koper/` (item 9).

**Próxima alteração pequena sugerida:** ajustar a captura para incluir o valor de `requestId` e `requestAuxId` (só esses dois campos, não o payload inteiro) no resultado do diagnóstico de detalhe, para decidir em definitivo qual usar como `koper_id`.

---

## 2026-07-31 — Mapeamento manual: módulo Engenharia e seletor de empresa

**Diagnóstico executado:** nenhum diagnóstico automatizado. Mapeamento manual feito pelo Fábio navegando o Koper diretamente e relatando por escrito (prints + descrição textual estruturada).

**Resultado — achado crítico:** cada empreendimento da Bossa é uma **empresa separada dentro do Koper**, selecionada por um seletor no canto superior direito da interface, não uma "obra" dentro de uma única empresa Bossa. Estrutura confirmada visualmente:

1. **Bossa Empreendimentos** — custos administrativos, escritório central, e pós-obra do Soul Residence. Obras visíveis nesta empresa: ESCRITÓRIO CENTRAL e SOUL RESIDENCE.
2. **Empresa do Flow** — dados operacionais, financeiros, de engenharia e de suprimentos do Flow Aptos. Nome e ID exatos ainda não capturados.
3. **Empresa do Alma** — idem, para Alma Seahouses. Nome e ID exatos ainda não capturados.

Rota do módulo Engenharia → Obras confirmada: `https://app.koper.com.br/engenharia/obras` (ícone "Engenharia" na barra vertical esquerda → "Obras" no submenu). Menu lateral do módulo mapeado (Obras, Orçamentos de obra, Planejamento de obra, Acompanhamento de obra, Diário de obra, Ordens de produção, Contratos e medições, Cadastros) — não explorado além do título. Detalhes completos em `docs/koper-inventory.md`, entidades `engineering_work` e "Empresas do Koper".

**Implicação para o conector:** todo o trabalho de descoberta feito até aqui (login, listagem e detalhe de Solicitações de estoque) foi validado **apenas dentro da empresa "Bossa Empreendimentos"**, que segundo este mapeamento é a empresa administrativa — **não** a empresa que contém as Solicitações de estoque reais do Flow, que é o dado que efetivamente precisamos importar primeiro (Seção 1 da constituição: Flow Aptos é um dos empreendimentos prioritários). O `koper-worker` não pode assumir a empresa ativa após login como escopo único — precisa descobrir e percorrer todas as empresas autorizadas.

Isso não invalida a descoberta de rota/navegação/endpoints já feita (a estrutura de URLs e a forma de navegar até Suprimentos → Solicitações deve ser a mesma em qualquer empresa) — mas invalida a suposição implícita de que os dados que vimos (`#8649`, `#10531` etc.) pertencem ao Flow. Eles pertencem à empresa Bossa Empreendimentos (provavelmente relacionados ao Escritório Central ou pós-obra do Soul).

**Pista já em mãos:** o diagnóstico `discover-stock-route` de 2026-07-30 já capturou, sem que soubéssemos o significado na hora, duas chamadas que muito provavelmente são a fonte da lista de empresas: `GET https://api.koper.com.br/administrative/v1/enterprise` e `GET https://api.koper.com.br/administrative/v1/multi_company` (ambas com `accessToken`, `cb`, `page`). Não sabemos ainda o formato da resposta.

**Hipótese confirmada/descartada:** N/A — mapeamento manual, não um ciclo de diagnóstico com hipótese testável por código.

**Arquivos alterados nesta entrada:** `docs/koper-inventory.md` (duas entidades novas: `engineering_work` e "Empresas do Koper"), `docs/koper-progress.md` (esta entrada), `CLAUDE.md` (Seção 18, aprendizado sobre estrutura multi-empresa).

**Próximo bloqueio:** nenhum técnico ainda — é o próximo passo de descoberta.

**Próxima alteração pequena sugerida (em andamento neste mesmo ciclo):** instrumentar o diagnóstico para capturar, logo após o login e antes de navegar para Suprimentos: (1) o texto da empresa ativa exibido no seletor superior direito, e (2) o corpo das respostas de `administrative/v1/enterprise` e `administrative/v1/multi_company`, para descobrir o formato de lista de empresas — sem clicar em nada que troque a empresa ativa ainda. Ver próxima entrada.
