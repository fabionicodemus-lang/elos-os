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
