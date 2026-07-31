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


---

## 2026-07-31 — Empresas do Koper identificadas via API

**Diagnóstico executado:** `POST /diagnostics/koper/companies`, pelo Caminho A com `KOPER_STARTUP_DIAGNOSTIC=companies`. Deployment Railway `208abe68-c66a-4dc8-b3f5-80b147a4b030` em `SUCCESS`; variável desativada após a leitura.

**Hipótese:** `GET /administrative/v1/multi_company` retorna identificadores e nomes suficientes para distinguir Bossa, Flow e Alma sem trocar a empresa ativa.

**Resultado:** confirmada. Autenticação concluída, empresa ativa detectada como **Bossa Empreendimentos**. `GET /administrative/v1/enterprise` retornou a empresa ativa e `GET /administrative/v1/multi_company` retornou exatamente três empresas:

| empresa | enterpriseId | branchId |
|---|---|---|
| Bossa Empreendimentos | `1645acb2-de18-11ed-bf03-8af8dfac4eab` | `804490ce-c492-4b11-8524-eaf8ee448d61` |
| Flow Aptos - Bossa | `6d3b4724-5880-11ee-827d-1219c832db49` | `1c527099-2e63-465f-b97a-772e36a93d8c` |
| Alma Seahouses - Bossa | `ec9ed276-742a-11ef-8533-1219c832db49` | `055e4192-07b9-46e7-a95f-4d0fd0130c98` |

Nenhuma troca de empresa foi executada; o diagnóstico permaneceu somente leitura.

**Arquivo alterado:** `src/diagnostics/inspect-koper-companies.ts` — adicionada captura restrita e sanitizada de `enterpriseId`, `branchId`, `enterpriseName`, `fantasyName` e `stockPlaceName`.

**Commit:** `71b242ed0661f41c33aea1f24ff8f2b5fd50a107` — `koper: capturar IDs e nomes das empresas — hipótese: multi_company identifica Flow e Alma sem troca de contexto`.

**Próximo bloqueio:** mecanismo de troca da empresa ativa ainda não descoberto.

**Próxima alteração pequena sugerida:** criar um diagnóstico exclusivamente de leitura que abra o seletor de empresa, clique em **Flow Aptos - Bossa** como navegação de contexto autorizada e capture, sem acionar outras ações, as requisições de rede, alterações de URL e nomes de chaves de storage provocadas pela troca. Antes de implementá-lo, confirmar pelo DOM o seletor e o item exato, usando nome completo e validando também o `enterpriseId`; nunca usar posição no menu.


---

## 2026-07-31 — Caminho visual do seletor multiempresa confirmado

**Diagnóstico executado:** `POST /diagnostics/koper/companies`, Caminho A, em três hipóteses pequenas. A variável de inicialização foi desativada após cada leitura.

1. Commit `66e165e`: clicar no controle da empresa ativa e procurar opções semânticas. Resultado: somente o botão “Bossa Empreendimentos”; hipótese descartada.
2. Commit `9451b2c`: ampliar a coleta para `div`/`span`. Resultado: o primeiro clique abre uma etapa intermediária com “Você está acessando informações da empresa: Bossa Empreendimentos” e a ação **Acessar outra empresa**; hipótese revisada com avanço.
3. Commit `4523068`: clicar em **Acessar outra empresa** e coletar o modal final sem selecionar empresa. Resultado: hipótese confirmada.

**Estrutura DOM confirmada:**

- modal de fundo: `data-testid="backdrop"`;
- cartões: `data-testid="multiCompaniesModal"`;
- cartão **FLOW APTOS - BOSSA** com ação “Acessar esta empresa”;
- cartão **ALMA SEAHOUSES - BOSSA** com ação “Acessar esta empresa”.

**Segurança:** nenhuma empresa foi selecionada nesta rodada; não houve alteração de dados do Koper.

**Deployment final do diagnóstico:** `5c661a32-609d-4711-b6c7-f7d2d8ac8593`, `SUCCESS`.

**Próximo bloqueio:** confirmar o mecanismo e os efeitos da seleção do Flow.

**Próxima alteração pequena sugerida:** diagnóstico dedicado que abre o seletor pelo caminho confirmado, localiza o cartão `data-testid="multiCompaniesModal"` contendo exatamente **FLOW APTOS - BOSSA**, clica somente na ação “Acessar esta empresa”, captura navegações e requisições de leitura, e confirma ao final que a empresa ativa passou a **Flow Aptos - Bossa**. Não usar índice do cartão.


---

## 2026-07-31 — Requisição de troca para o Flow identificada e bloqueada

**Diagnóstico executado:** `POST /diagnostics/koper/flow-context`, Caminho A, deployment `b0f4bbc6-4864-4f34-a72e-6e6c95e7faa2` em `SUCCESS`.

**Hipótese:** clicar em “Acessar esta empresa” no cartão exato do Flow muda o contexto usando somente requisições de leitura.

**Resultado:** descartada. Após corrigir o seletor do cartão no commit `699cc3c`, o diagnóstico encontrou e clicou no cartão correto (`flowCardFound=true`, `flowSelected=true`). A aplicação tentou disparar:

- `POST https://api.koper.com.br/login/change_company`
- query keys: `accessToken`, `changeCompany`
- resource type: `xhr`

A rota de segurança abortou a requisição antes do envio. `blockedWrites` registrou a tentativa; `activeCompanyAfter` permaneceu **Bossa Empreendimentos**. Nenhuma troca ou alteração ocorreu no Koper.

**Commits:** `64aa020` (diagnóstico protegido), `edaab35` (endpoint/startup), `699cc3c` (seletor robusto do cartão).

**Bloqueio:** a Seção 3.1 da constituição proíbe `POST` REST ao Koper; apenas POST GraphQL inequivocamente de leitura era permitido. Embora `/login/change_company` aparente trocar apenas o contexto de sessão, a execução exige decisão explícita do Fábio e alteração prévia da constituição.

**Alternativas:**

1. Autorizar especificamente `POST /login/change_company` somente com o `enterpriseId` previamente validado de Flow/Alma, mantendo todos os demais POST REST bloqueados.
2. Manter a proibição e usar credenciais/sessões separadas que já iniciem em cada empresa, se o Koper oferecer esse recurso.
3. Fazer a seleção manual em uma sessão persistida e o worker apenas ler a empresa já ativa; mais frágil para sincronização automática.

**Recomendação técnica:** alternativa 1, com allowlist estrita do endpoint, validação de `enterpriseId`, confirmação posterior por `GET /administrative/v1/enterprise` e nenhuma captura/log do valor de `accessToken`.


---

## 2026-07-31 — Troca para Flow Aptos confirmada

**Diagnóstico executado:** `POST /diagnostics/koper/flow-context`, Caminho A. Deployment final `a2cdd16b-db00-4ec0-bf58-a27f1f444a35` em `SUCCESS`.

**Autorização:** Fábio autorizou explicitamente a exceção restrita para `POST /login/change_company`. A constituição foi atualizada antes do código no commit `afebc39` e alinhada ao corpo real no commit `3095f2e`.

**Mecanismo confirmado:**

- endpoint: `POST https://api.koper.com.br/login/change_company`;
- corpo JSON com chaves `accessToken`, `toEnterpriseId`, `changeCompany`;
- `toEnterpriseId` contém o `enterpriseId` do Flow;
- o valor de `accessToken` nunca é registrado;
- allowlist valida endpoint, método, conjunto exato de chaves e destino Flow.

**Resultado final:**

- `activeCompanyBefore: "Bossa Empreendimentos"`;
- `activeCompanyAfter: "Flow Aptos - Bossa"`;
- `flowCardFound: true`;
- `flowSelected: true`;
- `blockedWrites`: somente POSTs GraphQL do carregamento do dashboard, bloqueados por ainda não terem sido classificados; nenhum outro POST REST foi permitido;
- `GET /administrative/v1/enterprise` ocorreu após a recarga e a interface confirmou Flow.

**Hipótese confirmada.** A troca multiempresa pode ser automatizada com allowlist estrita e confirmação posterior.

**Commits de código:** `5b542e9`, `a5a1108`, `a61b57e`, `84ea83c`, `6d80216`.

**Próximo bloqueio:** os diagnósticos de Solicitações atualmente fazem login e navegam diretamente na empresa padrão. É necessário executar a seleção do Flow dentro da mesma sessão antes de abrir Suprimentos.

**Próxima alteração pequena sugerida:** extrair a seleção segura do Flow para helper reutilizável e criar um diagnóstico composto que confirme `Flow Aptos - Bossa` antes de abrir Suprimentos → Solicitações. Reutilizar os endpoints REST já descobertos, sem gravar dados.


---

## 2026-07-31 — Contexto Flow confirmado até Solicitações de estoque

**Hipótese:** após trocar com segurança da empresa `Bossa Empreendimentos` para `Flow Aptos - Bossa`, a navegação `Suprimentos → Solicitações` continuaria usando a rota e o endpoint REST já descobertos na empresa administrativa.

**Ação:** diagnóstico `flow-context` executado no Railway pelo deploy `c2ef2761-183f-4050-bcf2-d4e8066d846c`, sobre o commit `4dff2a6`. A única escrita REST permitida foi `POST /login/change_company`, com corpo validado por allowlist e destino limitado ao enterpriseId do Flow. Todas as demais escritas foram bloqueadas.

**Resultado:** hipótese confirmada.

- Empresa antes da troca: `Bossa Empreendimentos`.
- Empresa depois da troca: `Flow Aptos - Bossa`.
- Card do Flow localizado e selecionado.
- Rota final: `https://app.koper.com.br/suprimentos/solicitacoes/`.
- Listagem alcançada: `true`.
- Leitura observada: `GET https://api.koper.com.br/stock/v1/request`.
- Chaves de query observadas: `accessToken`, `cb`, `group`, `limit`, `offset`, `open`, `orderFlag`, `orderby`, `typeDate`.
- Nove POSTs GraphQL de leitura do dashboard foram bloqueados pela política conservadora; isso não impediu a troca de empresa nem a leitura REST da listagem.
- Nenhuma alteração de dado operacional foi realizada no Koper.
- `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado após a leitura do resultado, sem novo deploy.

**Aprendizado:** a rota visual e o contrato REST da listagem de `stock_request` são reutilizáveis entre os contextos Bossa e Flow. O contexto da empresa precisa fazer parte explícita de cada execução e de cada registro migrado, para evitar mistura de dados entre Bossa, Flow e Alma.

**Próxima alteração pequena sugerida:** ampliar somente a captura segura da resposta da listagem no contexto Flow para registrar `itemsAmount`, quantidade de registros retornados e os primeiros identificadores `requestId`/`requestAuxId`, sem capturar nomes de usuários ou o payload completo. Isso permitirá medir volume e confirmar a amostra real do Flow antes de criar a staging.


---

## 2026-07-31 — Volume, paginação e filtro de finalizadas no Flow

Diagnóstico `flow-context` ampliado pelos commits `c65e79bc`, `1d996ffc`, `385a76fd` e `2ffd2ae7`. Execução final no Railway: deploy `1b42a825-e8b8-4654-a4b2-dc8b190a7635` (SUCCESS).

**Resultado da listagem não finalizada:**
- endpoint: `GET https://api.koper.com.br/stock/v1/request`;
- `open=yes`;
- `itemsAmount=73`;
- `limit=25`, `offset=0`;
- primeira página com 25 registros;
- status observados: `Aberto`, `Aprovado totalmente` e `Aprovado parcialmente`;
- logo, “aprovado” não significa “finalizado”.

**Resultado de “Ver finalizados”:**
- rota: `/suprimentos/solicitacoes/finalizadas`;
- mesmo endpoint REST;
- única mudança funcional observada na query: `open=no`;
- `itemsAmount=829`;
- `limit=25`, `offset=0`;
- primeira página com 25 registros;
- status observados: `Finalizado` e `Cancelado`.

**Volume total conhecido no Flow:** 902 solicitações (73 com `open=yes` + 829 com `open=no`).

**Campos seguros confirmados:** `requestId`, `requestAuxId`, `stockPlaceId`, `stockPlaceName`, `productAmount`, `requestDate`, `deadline`, `status`, `isUrgent`, `isDraft`.

**Identificadores observados:** `requestId` é o número público da solicitação (ex.: 10563). `requestAuxId` apresentou valor 2 em toda a amostra e não deve ser usado como chave da solicitação. O local do Flow apresentou `stockPlaceId=169` e `stockPlaceName=Flow Aptos`.

**Paginação:** o contrato usa `limit` e `offset`; a primeira página prova `limit=25` e `offset=0`. Pelos totais, a extração completa precisará avançar o offset em passos de 25 até atingir `itemsAmount`. A leitura de uma segunda página ainda não foi executada neste ciclo.

Nenhum `accessToken`, `userName` ou `userId` foi registrado. Nenhuma criação, edição, aprovação ou exclusão foi realizada. `KOPER_STARTUP_DIAGNOSTIC` foi novamente esvaziado após a coleta.

**Próximo passo sugerido:** validar uma segunda página somente por GET (`offset=25`) e então implementar o cliente REST de produção para extrair todas as páginas para uma staging idempotente, ainda sem promover dados ao modelo final.


---

## 2026-07-31 — Pausa obrigatória: validação da segunda página

**Hipótese:** reutilizar a URL autenticada de `GET /stock/v1/request` e trocar somente `offset=0` por `offset=25` retornaria a segunda página com 25 registros.

**Iteração 1 — commit `37dac6a2`:** o GET com `offset=25` apareceu no mapa de rede como `resourceType=fetch`, mas o coletor de respostas não conseguiu registrar o corpo.

**Iteração 2 — commit `99457ea1`:** tentativa de retornar o JSON pelo `fetch` executado na página. A requisição apareceu na rede, porém o corpo não voltou ao diagnóstico, compatível com bloqueio de CORS no JavaScript da página.

**Iteração 3 — commit `89e357e6`:** tentativa com `browserContext.request.get`, evitando CORS. O cliente não retornou um corpo válido para o diagnóstico, provavelmente porque o contexto HTTP separado não herdou toda a autenticação necessária apesar de a URL conter o token.

**Resultado:** a semântica de paginação permanece fortemente indicada por `limit=25`, `offset=0` e `itemsAmount`, e o GET com `offset=25` foi efetivamente emitido uma vez, mas a segunda página ainda não foi validada pelo conteúdo. Hipótese **não fechada**.

Conforme a Seção 5 da constituição, o trabalho foi pausado após três tentativas consecutivas no mesmo bloqueio. `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado. Nenhuma escrita operacional foi realizada.

**Alternativas para decisão do Fábio:**
1. Instrumentar o erro de forma sanitizada (apenas estágio, status HTTP e classe do erro) antes de uma nova tentativa.
2. Acionar a paginação visual da tabela e capturar o XHR normal gerado pelo próprio Koper.
3. Considerar suficiente o contrato `limit/offset/itemsAmount` já observado e implementar o cliente de produção com um teste inicial de duas páginas em modo dry-run.

**Recomendação:** opção 2, por reproduzir exatamente o comportamento autorizado da interface e evitar diferenças de autenticação/CORS.


---

## 2026-07-31 — Paginação visual das solicitações do Flow confirmada

**Hipótese:** a listagem não possui paginação numérica; ao alcançar o fim da tabela, a rolagem infinita da própria interface dispara o próximo GET com `offset=25`.

**Iteração visual — commits `c8399085` e `18f5faf8`.** A primeira tentativa procurou um paginador numérico visível, que não existe. Em seguida, o diagnóstico passou a rolar a janela e os elementos roláveis até o final, reproduzindo o comportamento normal da interface.

**Execução final:** diagnóstico `flow-context`, deployment Railway `09e50ddf-0ec2-4eff-8e08-af03d0b49eda` (SUCCESS), resultado lido em 2026-07-31T17:02:31Z.

**Resultado seguro:**

```json
{
  "activePage1": {
    "open": "yes",
    "limit": 25,
    "offset": 0,
    "itemsAmount": 73,
    "returnedRecords": 25
  },
  "activePage2": {
    "open": "yes",
    "limit": 25,
    "offset": 25,
    "itemsAmount": 73,
    "returnedRecords": 25
  },
  "finalizedPage1": {
    "open": "no",
    "limit": 25,
    "offset": 0,
    "itemsAmount": 829,
    "returnedRecords": 25
  }
}
```

A segunda página trouxe IDs diferentes da primeira (início observado: `6998`, `6271`, `6073`, `5512`) e confirmou também o estado `Rascunho` com `isDraft=true`. A amostra da página 2 alcança pelo menos 27/09/2024, comprovando histórico anterior ao intervalo visível no print inicial.

**Hipótese confirmada.** O contrato é paginação por rolagem infinita, com `limit=25` e incremento de `offset` em 25. Uma extração completa deve acumular páginas até atingir `itemsAmount` ou receber uma página menor que o limite.

**Segurança:** nenhum `accessToken`, `userName` ou `userId` foi registrado; nenhuma criação, edição, aprovação, cancelamento ou exclusão foi executada. POSTs GraphQL não classificados permaneceram bloqueados. `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado após a leitura.

**Marco:** a descoberta de Solicitações de estoque está fechada para revisão no PR #152. Não iniciar cotações nem gravação no Elos OS antes da revisão do Fábio.


---

## 2026-07-31 — Primeira descoberta automatizada de Orçamentos do Flow

**Hipótese:** no contexto `Flow Aptos - Bossa`, navegar por `Compras → Orçamentos → Ver finalizados` revelaria a rota e o transporte reais da listagem histórica sem executar escrita operacional.

**Iteração 1 — commit `d1ba4ade`:** o seletor presumido `button-Compras` não existia no DOM; `quotationListReached=false`. O build inicialmente falhou por dois campos obrigatórios ausentes no retorno sem autenticação e foi corrigido no commit `5bbbbb23`.

**Iteração 2 — commit `3ee270ec`:** o módulo Compras foi localizado pelo asset visual `purchase` já carregado pela interface.

**Execução final:** diagnóstico `flow-context`, deployment Railway `437ff62c-dd1d-45df-a44f-34404516635a` (SUCCESS), resultado em 2026-07-31T18:14:46Z.

**Resultado:**
- `quotationListReached=true`;
- `quotationFinalizedClicked=true`;
- rota final: `https://app.koper.com.br/compras/orcamentos/finalizados`;
- listagem: `GET https://api.koper.com.br/purchase/v1/budget`;
- endpoint relacionado: `GET /purchase/v1/budget_negotiation`;
- fornecedores/filtro: `GET /purchase/v1/supplier`;
- query finalizada expõe as chaves `budgetId`, `initialDate`, `finalDate`, `limit`, `offset`, `orderFlag`, `orderby` e `typeDate`, além dos parâmetros sensíveis sanitizados.

**Hipótese confirmada.** O transporte da listagem é REST. O corpo ainda não foi lido; volume, campos, identificadores e paginação visual permanecem abertos.

Nenhuma criação, aprovação, negociação, escolha de fornecedor ou ordem de compra foi executada. POSTs GraphQL não classificados permaneceram bloqueados. `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado após a leitura.


---

## 2026-07-31 — Pausa obrigatória: carregar histórico completo de Orçamentos

**Hipótese:** selecionar visualmente o período `Todos` na listagem finalizada faria `GET /purchase/v1/budget` retornar o corpo histórico.

**Tentativa 1 — commit `1a76ea32`:** leitura segura do JSON. O Koper consultou o período padrão de julho de 2026 e respondeu 404 porque não há orçamentos nesse intervalo. Contrato confirmado: `budgetId=all`, `limit=25`, `offset=0`, `orderFlag=desc`, `orderby=budgetId`, `typeDate=budgetDate`.

**Tentativa 2 — commit `742b56c6`:** tentativa de selecionar `Todos` por um elemento `<select>` nativo. Nenhuma nova requisição foi disparada; o filtro não é um select HTML nativo.

**Tentativa 3 — commits `a014f635`/`fb4191f3`:** tentativa de abrir o dropdown Angular pelo texto do período atual e clicar em `Todos`. O build intermediário falhou por uma chave excedente e foi corrigido; na execução válida, nenhuma nova requisição foi disparada. O componente não expõe esses textos como elementos clicáveis no DOM acessível.

**Execução final:** deployment `4c690bbe-6892-4fe9-a842-98f1106c080a` (SUCCESS). Resultado: rota e endpoints confirmados, mas `quotationReads` contém somente as duas respostas 404 do período vazio; corpo, volume e campos continuam abertos.

Trabalho pausado após três tentativas no mesmo bloqueio, conforme a Seção 5. `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado. Nenhuma escrita operacional foi executada.

**Alternativas:**
1. Diagnosticar o DOM do filtro, registrando somente tags, classes, atributos e textos curtos dos controles próximos a “DATA ORÇAMENTO”, para construir um seletor fundamentado.
2. Reproduzir a seleção manual do Fábio por coordenadas visuais relativas ao rótulo e capturar o XHR normal do Koper.
3. Testar em dry-run uma cópia do GET autenticado removendo `initialDate`/`finalDate`, hipótese indicada pela opção “Todos”, sem persistência.

**Recomendação:** alternativa 1, porque descobre o controle real sem depender de resolução de tela nem repetir os problemas de autenticação do GET separado.


## 2026-07-31 — Diagnóstico estrutural do filtro histórico de Orçamentos

Commit `1a1c5a2`.

**Hipótese:** o filtro de período da tela `/compras/orcamentos/finalizados` é um componente customizado, e a inspeção sanitizada do DOM revelaria um seletor fundamentado. **Resultado:** confirmada.

No contexto `Flow Aptos - Bossa`, a área superior da tela contém:

- filtro de fornecedor: `div.dropdown.custom-select` e `a.dropdown-toggle`, ambos com o texto `Todos`;
- filtro de período: `div.dropdown` contendo `div.input-default.dropdown-toggle`, com o texto `01/07/2026 - 31/07/2026`;
- pesquisa: `input.form-control[type=search]`.

Isso comprova que o texto `Todos` identificado nas tentativas anteriores pertence ao fornecedor, não ao período. O filtro de data não é um `<select>` nativo; por isso, seleção nativa e clique textual em `Mês atual`/`Todos` não produziram nova leitura.

As únicas leituras observadas continuaram sendo `GET /purchase/v1/budget`: uma consulta de 25–31/07/2026 e a listagem finalizada de 01–31/07/2026, esta com `budgetId=all`, `limit=25`, `offset=0`, `orderFlag=desc`, `orderby=budgetId` e `typeDate=budgetDate`. Ambas responderam 404 por ausência de registros nos períodos consultados.

O diagnóstico foi executado no Railway com sucesso e `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado imediatamente após a coleta. Nenhuma escrita operacional foi executada.

**Próximo passo seguro:** clicar especificamente em `div.input-default.dropdown-toggle` associado ao rótulo de data, inspecionar as opções abertas e somente então selecionar `Todos`, capturando a requisição normal produzida pela interface.


## 2026-07-31 — Tentativas de selecionar “Todos” no período de Orçamentos

Commits `11c0022` e `f4a4d60`.

Objetivo autorizado: abrir o dropdown de período da rota `/compras/orcamentos/finalizados` e selecionar `Todos`, preservando o Koper como origem somente leitura.

Foram testadas duas estratégias fundamentadas pela inspeção anterior:

1. localizar `div.input-default.dropdown-toggle` pelo texto no formato de intervalo de datas e buscar `Todos` dentro do mesmo dropdown;
2. após abrir o controle datado, buscar globalmente o `Todos` visível abaixo e horizontalmente alinhado ao botão, descartando o `Todos` do fornecedor.

A primeira execução foi interrompida por encerramento transitório da página remota pelo Browserless. A repetição e a estratégia visual chegaram normalmente à tela finalizada, porém não produziram uma nova leitura: permaneceram somente as consultas de julho de 2026 com resposta 404. Isso indica que o item do menu de período é renderizado por mecanismo que não foi alcançado pelos seletores atuais, possivelmente calendário/popover com eventos Angular associados a outro nó.

Por segurança e em cumprimento ao limite de tentativas da constituição, o ciclo foi interrompido sem novas tentativas. `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado. Nenhuma escrita operacional, mudança de filtro equivocada ou captura de segredo foi executada.

**Bloqueio atual:** identificar o nó/evento efetivamente acionável da opção `Todos` após o popover de período estar aberto.

**Próximo caminho recomendado:** em um diagnóstico separado, capturar somente a árvore sanitizada e as caixas visuais dos elementos que surgem após abrir o controle de data, sem tentar selecionar opção. Com essa evidência, construir um seletor exato em novo ciclo.


## 2026-07-31 — Evidência visual do menu de período e encerramento da sessão

Commit `d8404ac`.

O print manual confirmou que o dropdown datado abre um menu vertical imediatamente abaixo do controle, nesta ordem: `Todos`, `Hoje`, `Semana atual`, `Mês atual`, `Últimos 7 dias`, `Últimos 30 dias` e `Período específico`.

Com base nessa evidência, o diagnóstico passou a clicar na primeira opção por coordenada relativa ao botão do período: 30 px à direita do início e 18 px abaixo da borda inferior. O deploy do código ficou saudável.

Duas execuções do diagnóstico foram encerradas pelo Browserless durante a espera posterior ao clique, com `Target page, context or browser has been closed`, antes da emissão do JSON final. Portanto, ainda não há confirmação da query produzida por `Todos`. O ciclo foi interrompido e `KOPER_STARTUP_DIAGNOSTIC` foi esvaziado.

**Próximo passo:** reduzir o tempo total do diagnóstico de orçamentos, removendo esperas e etapas anteriores que não são necessárias nesta rodada, e só então repetir o clique relativo.


## 2026-07-31 — “Todos” e paginação de Orçamentos confirmados

Commits `a407c52`, `201b239`, `20347e2`, `d2a5c01` e `cc37615`.

Foi criado o modo temporário `KOPER_QUOTATION_ONLY=true`, que preserva login e troca autorizada para `Flow Aptos - Bossa`, mas pula o inventário já concluído de Solicitações. A rota confirmada `/compras/orcamentos/finalizados` passou a ser aberta diretamente por GET, evitando a tela intermediária dependente de GraphQL POST bloqueado.

A seleção visual de `Todos`, pela primeira opção imediatamente abaixo do controle datado, foi confirmada por uma nova leitura com status 200:

- endpoint: `GET /purchase/v1/budget`;
- `budgetId=all`;
- `limit=25`;
- `offset=0`;
- `orderFlag=desc`;
- `orderby=budgetId`;
- sem `initialDate`, `finalDate` ou `typeDate`.

A resposta usa `budgetAmount`, não `itemsAmount`, e informou **440 registros históricos**. A primeira página retornou 25 registros.

A rolagem infinita foi validada em seguida. Ela disparou a mesma consulta com `offset=25`, retornando mais 25 registros distintos. Página 1: IDs 3268 a 3037 na amostra ordenada; página 2: IDs 3006 a 2709. Não houve repetição entre as páginas.

O diagnóstico registrou somente `budgetId`, `supplierId`, `buildMonitoringId`, datas, quantidade de produtos e valor total. Nomes de fornecedores foram excluídos da amostra. `KOPER_STARTUP_DIAGNOSTIC` e `KOPER_QUOTATION_ONLY` foram esvaziados após a leitura. Nenhuma escrita operacional foi executada.


## 2026-07-31 — Início do detalhe da cotação 3268

Após concluir listagem e paginação, iniciou-se a descoberta somente leitura do detalhe da cotação 3268.

A primeira tentativa buscou o texto `3268` depois da rolagem para `offset=25`; o elemento já não estava visível. A segunda voltou os contêineres ao topo, mas a tabela virtualizada não tornou o código acionável novamente. A terceira ação foi somente estrutural e confirmou:

- código em `td.ng-binding`;
- pai imediato `tr.ng-scope`;
- ausência de `href`, `ng-click`, `ui-sref` e `role`;
- o comportamento de abertura é provavelmente um listener Angular/JavaScript ligado à linha.

Nenhum detalhe foi aberto e nenhum endpoint adicional foi capturado. Conforme o limite de tentativas, o ciclo foi encerrado. `KOPER_STARTUP_DIAGNOSTIC` e `KOPER_QUOTATION_ONLY` foram esvaziados.

**Próximo passo fundamentado:** localizar o `td` com texto exato `3268` e clicar diretamente no `tr` pai antes de executar a paginação visual.


## 2026-07-31 — Quinta tentativa no detalhe 3268 e leitura de processo

Commit `25ca0b6`, deployment `505347e2` (SUCCESS), resultado lido em 2026-07-31T20:22:02Z.

**Hipótese:** o detalhe abre quando o `tr.ng-scope` pai da célula `td.ng-binding` com texto `3268` é clicado enquanto a primeira página ainda está visível, antes da rolagem para `offset=25`. **Resultado: descartada.** O elemento existe no DOM (a inspeção estrutural o encontra de novo), mas `getByText(/^3268$/).locator("xpath=ancestor::tr[1]")` não o resolveu como visível — o clique não ocorreu, o fallback pós-rolagem também não encontrou o código, `quotationDetailReads=[]` e `quotationDetailUrl=null`. A troca para o Flow, a seleção de "Todos" (`budgetAmount=440`) e a paginação (`offset=0` e `offset=25`, 25 registros distintos cada) funcionaram normalmente — o bloqueio é exclusivamente o clique na linha virtualizada.

Este é o **quinto ciclo** consecutivo na mesma família de bloqueio (abrir o detalhe por clique). Variáveis `KOPER_STARTUP_DIAGNOSTIC` e `KOPER_QUOTATION_ONLY` esvaziadas imediatamente após a leitura. Nenhuma escrita operacional.

**Decisão de processo:** em vez de uma sexta hipótese de clique, o Fábio pediu uma leitura do processo. Ela está em `docs/koper-metodo-otimizacao.md` — com a recomendação principal de resolver esta classe de bloqueio por **sessão de gravação assistida (LiveURL)**: o Fábio clica, o worker grava os endpoints. O detalhe da 3268 é o primeiro candidato.

---

## 2026-07-31 — HAR manual do Fábio: mapa da API do fluxo prioritário inteiro

**Método:** em vez de continuar o crawl visual do detalhe da cotação 3268 (5 ciclos sem sucesso por causa da tabela Angular virtualizada), o Fábio capturou manualmente um HAR navegando o fluxo prioritário completo no contexto `Flow Aptos - Bossa`, com o DevTools → Network filtrado em Fetch/XHR. Arquivo de 40MB entregue zipado neste chat.

**Processamento (somente leitura, sanitizado):** o HAR bruto **não foi versionado** (contém `accessToken` e dados pessoais/valores). Um script local extraiu apenas método, caminho, chaves de query (nunca valores) e a **estrutura de campos** das respostas (nunca valores), conforme Seção 3.2/3.3. Resultado consolidado no novo `docs/koper-api-map.md`.

**Resultado — 29 operações REST mapeadas** cobrindo todas as fases do fluxo prioritário:
- **Cadastros-base:** `enterprise`, `multi_company`, `user`, `tags`, `stock_place`, `sector`, `purchase/supplier`, `financial/supplier`, `item_chart_account`, `account`.
- **Suprimentos:** `stock/request`, `product_request`, `entry`, `pending_entry`, `product_entry`, `temp_entry`, `prod_req_comment`.
- **Compras:** `purchase/budget` (cotação), `budget_negotiation`, `purchase`, `purchase_order`, `service_order`, `supply/v2/purchases/details/{id}`.
- **Financeiro:** `bills_to_pay` (+ `/events`), `account`, `item_chart_account`, `receipt`, `xml_invoice`.
- **Troca de empresa:** `POST /login/change_company`.

**Corpos de resposta capturados (8, estrutura no api-map):** `enterprise`, `multi_company`, `user`, `tags`, `stock_place`, `purchase/supplier`, `financial/account`, `financial/bills_to_pay`, `financial/xml_invoice`. Os demais vieram vazios (o Chrome descartou 183 de 195 corpos ao salvar) — endpoint e params confirmados, corpo pendente.

**Bloqueio da cotação 3268 RESOLVIDO:** o detalhe do orçamento é `GET /purchase/v1/budget?budgetId={id}&group=request` — não depende de clicar na linha virtualizada. O crawl visual fica obsoleto. O commit `25ca0b6` (clique no `tr` pai) não é mais necessário para descobrir o endpoint; pode ser mantido só como fallback ou removido. O corpo do detalhe ainda não foi capturado (resposta vazia neste HAR); capturar em diagnóstico direcionado por `budgetId` ou em novo HAR abrindo uma cotação.

**Hipótese confirmada.** O HAR manual é ordens de magnitude mais eficiente que o crawl visual para mapear rotas: uma navegada de ~10 min do Fábio substituiu dezenas de ciclos de deploy. **Registrado em `CLAUDE.md`, Seção 18, como método preferido para descoberta de rotas de telas novas.**

**Próximo passo sugerido:** com as rotas conhecidas, capturar os corpos que faltam por diagnóstico direcionado (agora que o endpoint é conhecido, um GET autenticado pela interface resolve) — priorizar `budget?budgetId` (detalhe da cotação), `purchase`, `purchase_order`, `service_order` e as entradas de estoque. Ou pedir ao Fábio um segundo HAR abrindo uma cotação, um pedido e um recebimento, um de cada, para pegar os corpos numa tacada.

---

## 2026-07-31 — Detalhe do pedido/compra 13667 confirmado

Deployment Railway `f537a98c-041f-47ef-b4ba-ea4c043b46e6` (SUCCESS), resultado em 2026-07-31T22:06:50Z.

O modo direcionado `KOPER_PURCHASE_DETAIL_ONLY=true` abriu somente a rota conhecida pelo HAR, `https://web.koper.com.br/suprimentos/compras/13667`, após login e troca autorizada para `Flow Aptos - Bossa`. A interface disparou `GET /supply/v2/purchases/details/13667`, status 200.

O corpo confirmou a ligação operacional do pedido de serviço: `purchaseId=13667`, `costCenterId=168`, `supplierId=38`, `receiptId=12828`, `receiptNumber=16931`, `purchaseDate=2026-07-30`, `purchaseValue=31415`, `totalPurchase=31415`, `totalProducts=0`, `totalServices=31415`, serviço `17` com quantidade `51,5` e valor unitário `610`, ordem de serviço `11516` finalizada e conta a pagar `billId=15902` / `billToPayId=14525`, vencimento em 19/08/2026, valor `29844,25`. Não há XML/nota fiscal ligada neste registro (`xmlInvoiceId`, `invoiceNumber` nulos).

O navegador também revelou a rota de leitura do próximo elo: `GET /_next/data/{build}/financeiro/contas-a-pagar/15902.json?billToPayId=14525`. Nove POSTs GraphQL auxiliares foram bloqueados; nenhuma escrita operacional foi executada. As variáveis temporárias foram esvaziadas após a coleta.

**Próximo passo:** capturar somente a estrutura sanitizada desse JSON de conta a pagar durante o mesmo diagnóstico direcionado e, com os campos confirmados, mapear o detalhe financeiro sem depender de navegação visual.

---

## 2026-07-31 — Conta a pagar 15902 mapeada diretamente

Deployments Railway `67476478-44f9-400a-a254-cfcc7584238c` e `de103dbc-3079-477d-abc8-0b4364cbea8f` (SUCCESS). O diagnóstico abriu diretamente `https://web.koper.com.br/financeiro/contas-a-pagar/15902?billToPayId=14525` no contexto `Flow Aptos - Bossa`.

Endpoints confirmados:

- `GET /financial/v1/bills_to_pay?billId=15902` — detalhe financeiro;
- `GET /financial/v2/bills-to-pay/15902/events` — histórico de eventos;
- auxiliares de leitura: `item_chart_account`, `account`, `supplier`, `stock_place` e `tags`.

Valores operacionais sanitizados confirmados: `billId=15902`, `billToPayId=14525`, `supplierId=38`, `costCenterId=168`, `chartAccountId=9`, `itemChartAccountId=58`, valor `29844,25`, vencimento em 19/08/2026, status `Pendente`, `isPaid=false`, sem conta bancária, pagamento, comprovante ou boleto vinculados. O endpoint de eventos retornou um registro criado em 31/07/2026. Nomes, CPF/CNPJ, comentários, textos livres e corpo do evento não foram registrados.

O vínculo pedido `13667` → conta a pagar `15902/14525` está fechado. Nenhuma origem de nota fiscal ou recebimento veio em `origins[]` neste título; a ligação foi obtida pelo corpo do pedido. Nove POSTs GraphQL auxiliares permaneceram bloqueados. Nenhuma escrita operacional foi executada. As variáveis temporárias foram esvaziadas após a leitura.

**Próximo passo:** voltar ao fluxo de suprimentos e mapear uma compra de materiais que contenha `purchaseOrders[]` e `products[]`, pois o exemplo 13667 é uma contratação de serviço. Priorizar no HAR as rotas `purchase_order`, `stock/entry`, `pending_entry` e `product_entry` para fechar pedido de materiais → entrada → nota fiscal.
