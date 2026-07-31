# Inventário de entidades — Koper

> Memória viva do projeto (Seção 15 da constituição). Reconstruído em 2026-07-31 a partir do histórico de commits de `feature/koper-connector-bootstrap` e dos logs de diagnóstico do Railway — ver `docs/koper-progress.md` para o relato completo do ciclo que gerou cada linha. Atualizar esta tabela a cada avanço, não só ao final da entidade.

---

## `stock_request` — Solicitações de estoque

| Campo | Conteúdo |
|---|---|
| módulo do Koper | Suprimentos |
| rota visual (listagem) | `https://app.koper.com.br/suprimentos/solicitacoes/` (chegada via clique: abrir menu "Suprimentos" → clicar item visível "Solicitações"; não há link/rota direta detectável no DOM) |
| rota visual (detalhe) | `https://app.koper.com.br/suprimentos/solicitacoes/{requestId}` (ex.: `.../8649`), alcançada clicando na linha (`table tbody tr`) da listagem |
| endpoint (listagem) | `GET https://api.koper.com.br/stock/v1/request` — **REST, não GraphQL** (ver `CLAUDE.md`, Seção 18) |
| endpoint (detalhe) | `GET https://api.koper.com.br/stock/v1/product_request?requestId={numero}` — **endpoint diferente do de listagem**, não é `/stock/v1/request/{id}` |
| operação | N/A (REST simples, sem `operationName`) |
| variáveis — listagem (query params confirmados) | `group=request`, `limit=25`, `offset=0`, `open=yes`, `orderFlag=desc`, `orderby=requestDate`, `typeDate=requestDate`, além de `accessToken` e `cb` (cache-buster, tratar como sensível por segurança) |
| variáveis — detalhe (query params confirmados) | `requestId={numero}` (obrigatório, ex. `8649`), `group=request`, `appVersion`, `visited-page` (caminho da tela atual), além de `accessToken` e `cb` |
| paginação | **Confirmada ponta a ponta.** Rolagem infinita na interface; `limit=25`, primeira página `offset=0`, segunda página `offset=25`, ambas com 25 registros e `itemsAmount=73` no conjunto ativo. Avançar o offset em passos de 25 até acumular `itemsAmount` ou a página retornar menos que o limite. |
| campos principais — listagem (confirmados na resposta) | `itemsAmount`; por item em `requests[]`: `requestId`, `requestAuxId`, `stockPlaceId`, `stockPlaceName`, `productAmount`, `requestDate`, `deadline`, `status`, `userName`, `userId`, `isUrgent`, `userAbbreviation`, `notApprovedAmount`, `isDraft`, `deadlinePeriod` |
| campos principais — detalhe (confirmados na resposta) | `itemsAmount`, `stockPlaceName`, `requestDate`, `userName`, `userId`, `deadline`, `showDeadline`, `stockPlaceId`, `techAssistId`, `buildMonitoringId`, `isDraft`, `requestId`, `status`, `requestAuxId`, `notApprovedAmount`, `commentRequest`, `filename`, `fileId`, e **itens** em `products[]`: `productId`, `productName`, `productFullName`, `mainProductId`, `genericProdSeq`, `prodReference`, `productAmount`, `prodFinished`, `prodCanceled`, `prodCancelRequest`, `approvedTransf`, `approvedPurchase`, `productRequestId`, `approvedAmount`, `approvedDate`, `approvedUserName`, `historyId`, `historyMessage`, `unitMeasureId`, `symbol`, `inputId`, `inputUnit`, `specialMeasure`, `comments`, `totalComments`, `enabledToCancel`, `measures`, e serviços em `products[].services[]`: `itemMonitInputId`, `monitInputPchId`, `inputAmount` |
| campos visíveis na tela (não necessariamente 1:1 com a API) | Solicitação (nº, ex. `#10531`), Local De Consumo, Quantidade, Solicitado Em, Entregar Até, Status |
| identificador | **Confirmado para leitura e futura staging:** `requestId` é o número público usado na rota visual e no endpoint de detalhe, variando por solicitação. `requestAuxId` apresentou valor `2` em toda a amostra do Flow e não identifica o registro. Usar `requestId` como `koper_id`, sempre junto do `enterpriseId` de origem no isolamento multiempresa. |
| relacionamentos | `stockPlaceId` → local de estoque/obra (nome em `stockPlaceName`; amostra observada inclui "Escritório Central" e "Soul Residence" — indica que `stockPlaceId` pode misturar centros administrativos e empreendimentos, não só obras); `userId` → usuário solicitante (nome em `userName`, abreviação em `userAbbreviation`); `products[].productId` → produto/material; `techAssistId`, `buildMonitoringId` → possíveis vínculos com assistência técnica e monitoramento de obra, ainda não investigados |
| volume encontrado | Flow: **902 solicitações**, sendo 73 com `open=yes` e 829 com `open=no`. Páginas 1 e 2 do conjunto ativo confirmadas (25 registros cada); histórico observado até pelo menos 27/09/2024. |
| endpoint relacionado observado | `GET https://api.koper.com.br/stock/v1/stock_place` (`accessToken`, `cb`) — provável listagem de locais de estoque para filtro; não investigado a fundo ainda |
| tabela staging | Não criada. |
| tabela final Elos OS | Não definida. |
| status | **descoberta fechada para revisão:** listagem, detalhe, filtros ativo/finalizado, volumes, identificador e paginação confirmados. Nenhuma staging ou gravação no Elos OS iniciada. |

---

## `engineering_work` — Obras (módulo Engenharia)

> Mapeado manualmente pelo Fábio via prints em 2026-07-31, não por diagnóstico automatizado. Ver `docs/koper-progress.md`, ciclo "Mapeamento manual — módulo Engenharia e seletor de empresa".

| Campo | Conteúdo |
|---|---|
| módulo do Koper | Engenharia |
| rota visual | `https://app.koper.com.br/engenharia/obras` (caminho: ícone "Engenharia" na barra vertical esquerda → "Obras" no submenu) |
| endpoint | não descoberto |
| empresa observada | Bossa Empreendimentos |
| obras observadas | ESCRITÓRIO CENTRAL (Itapema-SC, Edifício Comercial, sem data de conclusão); SOUL RESIDENCE (Itapema-SC, Edifício Residencial, conclusão 28/10/2023) |
| campos visíveis na tela | nome da obra, localização, tipo, data de conclusão; card com botão "VER MAIS DETALHES"; controles: "ORDENAR POR" (padrão "Nome da obra A-Z"), "Pesquisar em obras", "+ OBRA", "VER FINALIZADAS", contador "Número de registros" |
| menu lateral do módulo (não explorado ainda) | Obras, Orçamentos de obra, Planejamento de obra, Acompanhamento de obra, Diário de obra, Ordens de produção, Contratos e medições (com submenu), Cadastros (com submenu) |
| status | **rota visual confirmada; API ainda não descoberta** |

## Entidade transversal — Empresas do Koper (escopo multi-empresa)

> **Achado crítico, mapeado manualmente em 2026-07-31.** Cada empreendimento da Bossa é tratado no Koper como uma **empresa separada**, não como uma obra dentro de uma única empresa. Isso afeta todo o desenho do conector — ver `CLAUDE.md`, Seção 18, e `docs/koper-progress.md` para a implicação completa.

| Campo | Conteúdo |
|---|---|
| comportamento | seletor de empresa ativa no canto superior direito da interface; a empresa selecionada define o escopo de todos os dados carregados nas telas e (presumivelmente) nas chamadas de API |
| escopo confirmado via `GET /administrative/v1/multi_company` | **Bossa Empreendimentos** — `enterpriseId=1645acb2-de18-11ed-bf03-8af8dfac4eab`, `branchId=804490ce-c492-4b11-8524-eaf8ee448d61`; **Flow Aptos - Bossa** — `enterpriseId=6d3b4724-5880-11ee-827d-1219c832db49`, `branchId=1c527099-2e63-465f-b97a-772e36a93d8c`; **Alma Seahouses - Bossa** — `enterpriseId=ec9ed276-742a-11ef-8533-1219c832db49`, `branchId=055e4192-07b9-46e7-a95f-4d0fd0130c98` |
| endpoints confirmados | `GET https://api.koper.com.br/administrative/v1/enterprise` retorna a empresa ativa e seus dados; `GET https://api.koper.com.br/administrative/v1/multi_company` retorna a lista das três empresas autorizadas |
| identificador | `enterpriseId` confirmado como ID de empresa exposto por ambos os endpoints; `branchId` também deve ser preservado como identificador de filial/contexto. Nunca usar posição no menu ou nome como chave. |
| mecanismo de troca confirmado | caminho visual: empresa ativa → **Acessar outra empresa** → cartão `data-testid="multiCompaniesModal"` → **Acessar esta empresa**. Endpoint: `POST https://api.koper.com.br/login/change_company`; corpo JSON com `accessToken`, `toEnterpriseId`, `changeCompany`. Allowlist valida `toEnterpriseId`; token nunca é registrado. Troca Bossa → Flow confirmada por `activeCompanyAfter="Flow Aptos - Bossa"`. |
| status | **descoberto e confirmado para Flow: lista, IDs, caminho visual, endpoint, corpo e confirmação pós-troca** |

---


## `quotation` — Orçamentos/cotações de compra

| Campo | Conteúdo |
|---|---|
| módulo do Koper | Compras |
| rota visual ativa | `/compras/orcamentos` — título “Orçamentos Recebidos”; visualizações por produtos, fornecedores e conjunto de orçamento |
| rota visual finalizada | `/compras/orcamentos/finalizados` — título “Orçamentos” |
| endpoint de listagem | `GET https://api.koper.com.br/purchase/v1/budget` — REST |
| endpoints relacionados | `GET /purchase/v1/budget_negotiation`; `GET /purchase/v1/supplier` |
| query finalizada observada | chaves `budgetId`, `initialDate`, `finalDate`, `limit`, `offset`, `orderFlag`, `orderby`, `typeDate`; valores ainda não capturados |
| campos visíveis na listagem | Código, Fornecedor, Data Orçamento, Data Resposta, Qtd. Produtos, Valor Total |
| detalhe visual observado | orçamento 3268; informações gerais; etapas Produtos, Frete e Pagamento; código do fornecedor, datas, validade, itens, quantidades, preços, descontos, prazo e total |
| identificador | em aberto: `budgetId` aparece na query, mas ainda falta confirmar seu valor e separar conjunto, resposta e fornecedor |
| paginação | indício de rolagem infinita e query `limit/offset`; segunda página ainda não validada |
| volume | não medido |
| tabela staging | não criada |
| status | **rota e endpoints descobertos; contrato do JSON ainda em aberto.** O período padrão vazio responde 404; três tentativas de selecionar `Todos` não dispararam nova leitura. Próximo passo recomendado: diagnóstico estrutural do DOM do filtro. |


## Todas as demais entidades do fluxo prioritário

Ainda **não iniciado**: cotação, participantes/preços, pedido de compra, recebimento, nota fiscal, conta a pagar, pagamento — e toda a Fase 2 (cadastros-base: empresas, empreendimentos, obras, centros de custo, etapas, fornecedores, clientes, unidades imobiliárias, usuários).

| entidade | status |
|---|---|
| cadastros-base (Fase 2) | não iniciado |
| quotation (cotação) | não iniciado |
| purchase_order (pedido de compra) | não iniciado |
| receipt (recebimento) | não iniciado |
| invoice (nota fiscal) | não iniciado |
| accounts_payable (conta a pagar) | não iniciado |
| payment (pagamento) | não iniciado |
| comercial / contas a receber (Fase 5) | não iniciado — **lembrete:** antes de desenhar qualquer estrutura de recebíveis/CUB, rodar grep por `CUB`, `receb`, `correc`, `INCC`, `IPCA` no repositório (Seção 11 da constituição); já existem migrations `supabase/migrations/20260723_0007_koper_receivable_details.sql` e `20260723_0007_koper_receivables_audit.sql` que precisam ser revisadas antes de duplicar trabalho. |


## Confirmação multiempresa — Flow (2026-07-31)

A entidade `stock_request` foi confirmada dentro do contexto `Flow Aptos - Bossa`. Após a troca controlada de empresa, a interface chegou a `/suprimentos/solicitacoes/` e executou `GET https://api.koper.com.br/stock/v1/request` com as mesmas chaves de paginação, filtro e ordenação observadas no contexto Bossa. Portanto, a descoberta do contrato de listagem pode ser reutilizada, mas toda extração e staging deve guardar o `enterpriseId` de origem e executar uma empresa por vez. Volume e amostra de IDs do Flow ainda precisam ser medidos.


## Solicitações do Flow — contrato de listagem fechado em 2026-07-31

| conjunto | filtro | total | página observada | status observados |
|---|---:|---:|---:|---|
| não finalizadas | `open=yes` | 73 | `limit=25&offset=0` e `offset=25` | Aberto; Aprovado totalmente; Aprovado parcialmente; Rascunho (`isDraft=true`) |
| finalizadas/canceladas | `open=no` | 829 | `limit=25&offset=0` | Finalizado; Cancelado |

Total conhecido: **902 solicitações** no contexto `Flow Aptos - Bossa`.

A rota de finalizadas é `/suprimentos/solicitacoes/finalizadas`, mas o endpoint permanece `GET /stock/v1/request`. O seletor entre os conjuntos é o parâmetro `open`.

Mapeamento de identidade confirmado:
- `requestId`: identificador/número público da solicitação e candidato a `koper_id`;
- `requestAuxId`: valor 2 em toda a amostra; não identifica a solicitação;
- `stockPlaceId=169`: local `Flow Aptos`;
- cada registro migrado também deve carregar o `enterpriseId` do Flow para isolamento multiempresa.

A paginação foi validada ponta a ponta pela rolagem infinita da interface: `limit=25`, `offset=0` e depois `offset=25`, com 25 registros distintos em cada resposta e `itemsAmount=73`. O extrator deve incrementar o offset em 25 até acumular `itemsAmount` ou receber página menor que o limite.
