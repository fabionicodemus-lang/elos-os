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
