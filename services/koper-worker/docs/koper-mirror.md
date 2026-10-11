# Espelho completo Koper → Elos OS (multiempresa)

> Criado em 2026-10-10. Complementa `CLAUDE.md` (constituição), `koper-progress.md` e
> `koper-api-map.md`. Código: `src/mirror-koper.ts`. Testes: `src/mirror-koper.test.ts`.

## 1. Por que existe

Até aqui todo importador estava travado na empresa **Flow Aptos - Bossa** e a rotina
diária (`sync-koper-payables-daily.ts`) só cuidava de contas a pagar do Flow. O Fábio
pediu a base inteira da Bossa no Elos OS, com atualização diária.

O espelho é a **camada 1** dessa entrega: copia o Koper inteiro, das três empresas, para
`koper_staging_records`, sem tocar em nenhuma tabela operacional. A **camada 2**
(promoção para `payables`, `payable_cost_allocations`, pedidos, recebimentos etc.)
continua sendo feita entidade por entidade, com conciliação, lendo desta staging.

## 2. Regra de negócio das empresas (definida pelo Fábio em 2026-10-10)

O seletor no canto superior direito do Koper troca entre três empresas. O custo de cada
obra no Elos OS é a soma de dois pedaços:

| Obra no Elos OS     | Origem no Koper                                                                 |
|---------------------|----------------------------------------------------------------------------------|
| Flow                | Empresa Flow Aptos - Bossa inteira + empresa Bossa, centro de custo "Flow Aptos" |
| Alma                | Empresa Alma Seahouses - Bossa inteira + empresa Bossa, centros "Alma Seahouses" (202) e "Alma Seahouses - EMPRESA" (201) |
| Soul                | Empresa Bossa, centro de custo "Soul Residence" (102)                            |
| Jazz                | Empresa Bossa, centro de custo "Jazz Residence" (103)                            |
| Escritório Bossa    | Empresa Bossa, centros "Matriz" (3) e "Escritório Central" (135)                 |

## 3. Retrato do Koper em 2026-10-10 (lido pela interface logada, somente GET)

Contas a pagar por empresa (cabeçalho do Koper):

| Empresa                 | Títulos | Total (R$)     | Em aberto (R$) |
|-------------------------|--------:|---------------:|---------------:|
| Bossa Empreendimentos   |   3.651 |   6.594.965,34 |     735.720,49 |
| Flow Aptos - Bossa      |   4.079 |  19.267.130,93 |   3.795.429,73 |
| Alma Seahouses - Bossa  |     656 |   7.632.085,12 |   2.581.510,28 |

Empresa Bossa por centro de custo. "Cabeçalho" é o total que o próprio Koper mostra ao
filtrar a listagem por `costCenterId`; "soma de billValue" é a soma bruta das linhas
(detalhe lido para os 3.651 títulos):

| Centro de custo (id)            | Títulos | Cabeçalho (R$) | Soma de billValue (R$) |
|---------------------------------|--------:|---------------:|-----------------------:|
| Escritório Central (135)        |   2.407 |   3.738.213,01 |           3.754.593,03 |
| Matriz (3)                      |     691 |   1.766.072,90 |           1.767.023,08 |
| Soul Residence (102)            |     499 |     764.387,17 |             765.291,16 |
| Alma Seahouses (202)            |      32 |     307.865,98 |             307.865,98 |
| Alma Seahouses - EMPRESA (201)  |       3 |      16.300,00 |              16.300,00 |
| Jazz Residence (103)            |      11 |       2.126,28 |               2.126,28 |
| sem centro de custo (tipo Grupo)|       8 |              — |              39.819,46 |
| **Total**                       |   3.651 |   6.594.965,34 |           6.653.018,99 |

Não há contas a pagar com centro de custo "Flow Aptos" dentro da empresa Bossa.

Demais volumes (linhas de listagem):

| Entidade             | Bossa | Flow  | Alma |
|----------------------|------:|------:|-----:|
| Solicitações         |    47 |   944 |   72 |
| Cotações             |    11 |   440 |    2 |
| Ordens de compra     |   982 | 1.756 |  132 |
| Ordens de serviço    |   369 |   788 |  177 |
| Compras              | 2.834 | 2.938 |  390 |
| Fornecedores         |   637 |   637 |  637 |

## 4. Aprendizados sobre o Koper (evidência: sessão de 2026-10-10)

1. **O cabeçalho do Koper não é a soma de `billValue` — e a diferença tem composição exata.**
   `bills_to_pay` devolve o título pai de um agrupamento (`bill_type = "Grupo"`, sem centro
   de custo) **e** os filhos (`status = "Agrupada"`, `join_bill_id` preenchido), além de
   títulos `bill_type = "Crédito"`. Na empresa Bossa a conta fecha ao centavo:
   soma de billValue 6.653.018,99 − pais tipo Grupo 39.819,46 − créditos 12.950,31
   − descontos 7.012,05 + juros 168,76 + outros acréscimos 1.559,41 = 6.594.965,34
   (cabeçalho). No Flow a diferença soma da lista × cabeçalho é R$ 151.373,46 (a
   "divergência interna" do handoff de setembro); a composição dela ainda não foi
   detalhada, mas o mecanismo é o mesmo. **Na promoção, o pai tipo Grupo não pode virar
   custo** (os filhos já carregam o valor e o centro de custo); conferir se o Flow já
   promovido no Elos OS tem esse dobro.
2. **`costCenterId` é filtro válido** da listagem `GET /financial/v1/bills_to_pay`.
3. **A troca de empresa devolve um `accessToken` novo.** `POST /login/change_company`
   (corpo `accessToken`, `toEnterpriseId`, `changeCompany`) responde com outro token já no
   contexto da empresa escolhida. O token antigo continua lendo os dados da empresa anterior,
   mas passa a receber 401 em `/administrative/v1/enterprise`. Sempre recapturar token e
   cabeçalhos depois de trocar.
4. **Os ids são globais entre as três empresas** (um `billId` da Bossa não existe no Flow;
   pedir o detalhe dele no contexto do Flow devolve 400). Mesmo assim o espelho prefixa o id
   com a empresa, para a origem ficar explícita.
5. **A API só precisa de três coisas:** `accessToken` na query e os cabeçalhos
   `x-accesstoken` e `x-koper`. Não depende de cookie. Por isso o navegador remoto
   (Browserless) só é usado para login e troca de empresa; as milhares de leituras são feitas
   por HTTP direto do worker.
6. **Detalhe da compra é `GET /purchase/v1/purchase?purchaseId=`** e traz `purchaseOrders`,
   `servicesOrders`, `services`, `products` e `bills`. O `/supply/v2/purchases/details/{id}`
   exige cabeçalho `Authorization` e não é necessário.
7. Cotações históricas: `GET /purchase/v1/budget?budgetId=all` sem datas devolve tudo.

## 5. O que o espelho grava

`entity = mirror.<entidade>` e `koper_id = <empresa>:<id>` (empresa = `bossa`, `flow`, `alma`).
O payload é `{ _enterprise, _enterpriseId, data }`, com CPF, telefone e e-mail mascarados.

| Entidade (lista / detalhe)                          | Listagem                         | Detalhe                                  |
|-----------------------------------------------------|----------------------------------|------------------------------------------|
| `stock_place`                                       | `/stock/v1/stock_place`          | —                                        |
| `account`                                           | `/financial/v1/account`          | —                                        |
| `supplier`                                          | `/purchase/v1/supplier`          | —                                        |
| `bill_to_pay` / `bill_to_pay_detail`                | `/financial/v1/bills_to_pay`     | `?billId=`                               |
| `stock_request` / `stock_request_detail`            | `/stock/v1/request` (open yes/no)| `/stock/v1/product_request?requestId=`   |
| `purchase_budget` / `purchase_budget_detail`        | `/purchase/v1/budget`            | `?budgetId=`                             |
| `purchase_order` / `purchase_order_detail`          | `/purchase/v1/purchase_order`    | `?orderId=`                              |
| `service_order` / `service_order_detail`            | `/purchase/v1/service_order`     | `?orderId=`                              |
| `purchase` / `purchase_detail`                      | `/purchase/v1/purchase`          | `?purchaseId=`                           |
| `receipt_list`                                      | `/financial/v1/receipt` (`receiptId=all`) | —                               |
| `xml_invoice_list`                                  | `/financial/v1/xml_invoice` (`invoiceId=all`) | —                           |
| `receipt` (derivada)                                | ids das listas, compras e títulos| `/financial/v1/receipt?receiptId=`       |
| `xml_invoice` (derivada)                            | ids das listas, compras e títulos| `/financial/v1/xml_invoice?invoiceId=`   |
| `bill_to_receive`                                   | `/financial/v1/bills_to_receive` (`splittedBills` no/yes) | — (`?billReceiveId=` existe, mas leva ~11 s por título) |
| `product`                                           | `/stock/v1/product`              | —                                        |
| `building`                                          | `/engineering/v1/building`       | —                                        |
| `building_monitoring` / `building_monitoring_detail`| `/engineering/v1/building_monitoring` | `?buildMonitoringId=`               |
| `monitoring_items` (derivada, relida sempre)        | ids dos acompanhamentos          | `/engineering/v1/item_monitoring?buildMonitoringId=` |
| `construction_budget` / `construction_budget_detail`| `/engineering/v1/construction_budget` | `?engBudgetId=`                     |
| `construction_budget_items` (derivada, relida sempre)| ids dos orçamentos              | `/engineering/v1/item_budget?engBudgetId=` |
| `engineering_contract` / `engineering_contract_detail` | `/engineering/v1/contract`    | `?contractId=`                           |
| `build_measurement` / `build_measurement_detail`    | `/engineering/v1/build_measurement` (open yes/no) | `?measurementId=`       |

Com isso a cadeia da apropriação fica inteira na staging: título → recibo/nota → compra →
ordem de compra / ordem de serviço → solicitação, com centro de custo, plano de contas,
serviços e `buildMonitoringId` em cada elo.

## 6. Como roda

```
node dist/mirror-koper.js                 # plano: lê e compara, não grava
node dist/mirror-koper.js --write         # incremental: só relê detalhe do que é novo ou mudou
node dist/mirror-koper.js --write --full  # relê todos os detalhes
```

Variáveis opcionais: `KOPER_MIRROR_COMPANIES`, `KOPER_MIRROR_ENTITIES`,
`KOPER_MIRROR_CONCURRENCY` (padrão 8), `KOPER_MIRROR_DETAIL_LIMIT`.

Logs: `KOPER_MIRROR_START`, `KOPER_MIRROR_COMPANY`, `KOPER_MIRROR_ENTITY` (um por
entidade e empresa, com lidos/inseridos/alterados/sumidos), `KOPER_MIRROR_RESULT`.
Sai com erro se alguma listagem vier incompleta ou algum detalhe falhar.

Garantias: só GET no Koper (mais a troca de empresa da allowlist); nunca apaga na staging;
registro que some da origem vira `sync_state = missing_at_source`, e só quando a listagem
veio inteira; rodar duas vezes sem mudança no Koper não altera nenhum hash.

## 7. O que ainda falta mapear (próximas entidades do catálogo)

- Financeiro: tributos, plano de contas (`item_chart_account` respondeu 500 com os
  parâmetros testados), movimentação bancária.
- Suprimentos: entradas de estoque (`/stock/v1/entry` e `pending_entry` responderam 404 na
  empresa Bossa; conferir no Flow), serviços (`/supply/v2/services` exige `Authorization`).
- Engenharia: composições e insumos do orçamento, planejamento.
- Comercial e pós-obra: vendas, contratos de venda, clientes, assistências técnicas.
- RH: folha e rateio.

## 8. Camada 2 — promoção das contas a pagar (`src/promote-mirror-payables.ts`)

Lê `mirror.bill_to_pay` e `mirror.bill_to_pay_detail` das empresas **Bossa** e **Alma** e
grava em `public.payables`. O Flow fica fora: continua em `sync-koper-payables-daily.ts`
(`source_system = koper_flow`).

| Item               | Regra                                                                                 |
|--------------------|---------------------------------------------------------------------------------------|
| Identidade         | `source_system` = `koper_bossa` ou `koper_alma`; `source_id` = `koper_bill:<billId>`; `id` = UUID determinístico do `billId` (mesma semente do Flow) |
| Obra               | Tabela da Seção 2, pelo `cost_center.id` do detalhe; na empresa Alma, sempre Alma     |
| Fornecedor         | `suppliers` com `source_system = koper` e `source_id` = id do Koper; sem esse cadastro, reaproveita o fornecedor existente quando há exatamente um com o mesmo nome (mesmo critério da rotina do Flow); beneficiário que não é fornecedor entra como `employee:<id>`, `customer:<id>` ou `commission:<id>`; guia de tributo usa um cadastro por tipo de tributo (`tax:<tax_type_id>`, ex.: "PIS — Programa de Integração Social") e folha usa `payroll:<id>`; nome sozinho nunca é chave |
| Pagamento          | `isPaid`/`paymentDate`/`paymentValue` da listagem; filho de agrupamento herda a baixa do título pai |
| Não promove        | pai de agrupamento (`Grupo`), `Crédito`, sem centro de custo mapeado, sem beneficiário, sem vencimento, pago sem data |
| Já existente       | só recebe baixa (aberto → pago); valor ou vencimento divergente vira exceção, sem sobrescrever |
| Apropriação        | entra como "À Apropriar"; centro de custo e plano de contas do Koper ficam em `notes`; rateio por serviço/WBS é etapa separada |

Rotina diária única: `node dist/sync-koper-mirror-daily.js` (espelho + promoção).
Obras criadas em 2026-10-10 por `src/ensure-bossa-projects.ts`: Alma Seahouses,
Soul Residence, Jazz Residence e Escritório Bossa.

## 9. Pendências

1. Rateio por serviço/WBS dos títulos de Alma, Soul, Jazz e Escritório
   (`payable_cost_allocations`): depende de promover os orçamentos dessas obras a partir de
   `mirror.construction_budget*` e `mirror.monitoring_items`.
2. Títulos tipo `Crédito` (créditos de fornecedor): definir como representar no Elos OS.
3. As 59 exceções `existing_value_or_due_date_conflict` da rotina diária do Flow.
4. Conferir no Flow já promovido se há título pai de agrupamento contado junto com os filhos.
5. Promoção de contas a receber, solicitações, ordens, compras e contratos de Bossa e Alma.

## 10. Estado ao fim de 2026-10-10

- Serviço Railway `koper-mirror` (projeto `powerful-joy`), branch `feature/koper-mirror`,
  raiz `/services/koper-worker`. Variáveis por referência ao `koper-audit-runner`.
- Carga completa da staging concluída: 49.162 registros na primeira carga e mais 12.454
  ao incluir recebíveis, produtos e engenharia. Rodada incremental das três empresas e 22
  entidades leva cerca de 5 minutos e meio.
- Volumes lidos (linhas de listagem): contas a pagar 3.651 / 4.079 / 656 (Bossa / Flow /
  Alma); contas a receber 2.251 / 3.979 / 722; notas manuais 2.657 / 2.132 / 334; notas
  eletrônicas 400 / 1.069 / 92; contratos 4 / 22 / 5; medições 7 / 143 / 25; orçamentos de
  obra 6 / 2 / 1; produtos 1.220 (cadastro comum às três).
- Duas notas eletrônicas do Flow falharam ao ler o detalhe nas duas rodadas; a causa ainda
  não foi identificada. A partir do commit `4e66846` o relatório traz o id e o erro em
  `detailProblemSamples` (resposta 400/404 conta como `detailNotFound`, o resto como falha).
- Obras criadas no Elos OS: Alma Seahouses, Soul Residence, Jazz Residence, Escritório Bossa.
- Promoção de contas a pagar autorizada pelo Fábio em 2026-10-10. Piloto de 3 títulos
  gravado e conferido (Escritório Bossa, R$ 2.321,34). Plano completo: 4.287 títulos —
  empresa Bossa 3.633 (Escritório Bossa 3.090 / R$ 5.510.127,39; Soul 497 / R$ 763.829,57;
  Alma 35 / R$ 324.165,98; Jazz 11 / R$ 2.126,28) e empresa Alma 654 / R$ 7.558.922,29.
  Ficam de fora 9 pais de agrupamento (R$ 40.569,46) e 11 créditos de fornecedor
  (R$ 196.157,31, sendo um de R$ 183.207,00 no Alma). Fornecedores: 195 reaproveitados por
  nome único, 258 cadastros novos (inclui um por tipo de tributo e os clientes de devolução).
- Rotina diária: comando do serviço `node dist/sync-koper-mirror-daily.js`, cron `0 8 * * *`
  (05h de Brasília), uma hora depois do `koper-audit-runner` do Flow.

## 11. Medição da cadeia de apropriação (2026-10-10, somente leitura)

Script `src/audit-mirror-appropriation-chain.ts`, serviço Railway `koper-mirror-tools`
(mesma branch; só lê a staging, não chama o Koper e não grava nada). Pergunta respondida:
dos títulos já gravados como "À Apropriar", até onde a staging permite seguir
título → nota → compra → ordem de compra → solicitação / ordem de serviço → contrato / medição.

Melhor evidência por título (quantidade de títulos; pais de agrupamento e créditos fora):

| Obra | Títulos | Item do acompanhamento | Só serviço | Só obra | Nenhuma |
| --- | ---: | ---: | ---: | ---: | ---: |
| Flow (empresa Flow) | 4.032 | 2.301 | 1.506 | 73 | 152 |
| Alma (empresa Alma + centros 201/202 da Bossa) | 689 | 298 | 313 | 70 | 8 |
| Soul (centro 102) | 497 | 232 | 194 | 36 | 35 |
| Jazz (centro 103) | 11 | 0 | 0 | 0 | 11 |
| Escritório Bossa (centros 3 e 135) | 3.090 | 1.250 | 1.353 | 138 | 349 |

- "Item do acompanhamento": algum elo traz `itemMonitInputId`, `itemMonitoringId`,
  `itemMonitContractId` ou `itemReference`. "Só serviço": apenas `serviceId` (vem de
  `receipt.services[]`). "Nenhuma" é quase tudo tributo (Bossa 370 de 395, Flow 142 de 152).
- Alcance por empresa do Koper (títulos): Flow — compra 3.608, ordem de compra 1.745,
  solicitação de material 1.568, ordem de serviço 901; Alma — 608 / 190 / 176 / 257;
  Bossa — 3.030 / 1.028 / 45 / 568.
- Títulos que citam ordem de serviço ausente da staging: Flow 446, Bossa 349, Alma 28.
  Causa conhecida para parte deles: a listagem sem `open` devolve só as finalizadas
  (Bossa: 369 finalizadas + 29 abertas; ordens de compra 982 + 3). Corrigido no espelho
  com as variantes `open=yes` e `open=no`; a carga entra na próxima rodada diária. Se
  ainda sobrar ausência depois disso, a causa é outra e precisa ser investigada.

### Contrato e medição

- A ordem de serviço não devolve o id do contrato. O detalhe da medição traz `contractId`
  e `supplierId`, mas não traz itens.
- Itens da medição: `GET /engineering/v1/item_measurement?measurementId=&limit=&offset=&orderby=itemReference&orderFlag=asc`
  → `services[]` com `contractId`, `itemMonitoringId`, `itemReference`, `serviceId`,
  `itemMeasurementId` e valores. Entidade `mirror.measurement_items` criada (entra na
  próxima rodada diária).
- `fncReleaseId` / `fncStageReleaseId` do recibo **não são o id da medição**: no Flow,
  47 e 40 dos 118 recibos com liberação têm um número que também existe como medição,
  mas o fornecedor coincide em 0 e 4 casos. É coincidência de numeração.
- Todo recibo com liberação é de fornecedor que tem contrato (Flow 118 de 118; Alma 23
  de 23; Bossa não tem recibo com liberação). Títulos que citam liberação: Flow 154,
  Alma 33.
- Vínculo inferido ordem de serviço ↔ contrato por fornecedor + `itemMonitoringId`:
  Flow 43 títulos (todos em contrato com medição); Alma e Bossa 0.
- Em aberto: qual entidade do Koper é a "liberação" (`fncReleaseId`) e como ela aponta
  para a medição. Sem isso, o título chega ao contrato pelo fornecedor, mas não a uma
  medição específica.

### Insumos do acompanhamento

`GET /engineering/v1/monitoring_input?itemMonitoringId=` devolve os insumos de um item
(`inputId`, `baseInputId`, `inputName`, `inputType`, …). Ainda não confirmado se `inputId`
é o `itemMonitInputId` citado nas ordens de compra e solicitações. Não está no espelho.

## 12. Orçamento e rateio por serviço — Alma (2026-10-10)

### Como o Elos OS mostra custo por serviço

- A tela Engenharia › Custo x Orçamento (`lib/cost-vs-budget/server.ts`, branch `main`) agrupa
  por **serviço** (`engineering_services`, o "centro de custo" do Elos OS): soma o orçamento
  pelos `engineering_budget_items.service_id` e o custo pelos `payable_cost_allocations`
  com `source_system = koper_native_resolution`.
- **Trava conhecida:** essa tela (e `lib/cost-vs-budget/title-details.ts`) lê só títulos com
  `source_system = koper_flow`. Enquanto isso não for ampliado para `koper_alma` e
  `koper_bossa`, o rateio do Alma fica gravado mas não aparece na tela. A mudança são duas
  linhas na `main` (app em produção) e depende de aprovação do Fábio.
- Catálogo: os serviços do Koper já estão no Elos OS como `KOPER-S<serviceId>`
  (`source_system = koper`, `source_id = <serviceId>`); o catálogo é o mesmo nas três
  empresas do Koper. Faltavam 3 dos 89 serviços citados pelo Alma.
- Formato do rateio já usado no Flow (2.919 títulos): `source_id = <billId>:<n>`, método
  `koper_receipt_purchase` (nota manual) ou `koper_invoice_purchase_order` (nota eletrônica),
  evidência em `evidence.nativeEvidence`.

### Orçamento do Alma no Koper

- Acompanhamento de obra 133 ("Alma Seahouses Obra"): 129 itens, 62 folhas com serviço.
- O previsto está lançado **por etapa**: só 9,4% do total está em folhas com serviço; o resto
  está em 8 etapas cujo previsto é maior que a soma dos filhos (uma delas concentra 81% do
  total). Não há previsto negativo.
- Regra adotada em `src/promote-mirror-budget.ts`: folha com serviço vira item com serviço;
  a diferença "previsto da etapa − soma dos filhos" vira item **sem serviço** na etapa
  (marcador `Koper etapa itemMonitoringId=<id>`). O total fecha ao centavo com o do Koper e
  nada é distribuído por conta própria. Orçamento: `KOPER-ACOMP-133`,
  `source_id = monitoring:133`.

### Rateio dos títulos (`src/promote-mirror-allocations.ts`)

Plano para os 689 títulos do Alma (empresa Alma + centros 201/202 da empresa Bossa):

| Situação | Títulos | % do valor |
| --- | ---: | ---: |
| Resolvido pela nota manual com serviço (grava já) | 473 | 85,6% |
| Material: depende do de-para de insumos (entra na rodada diária) | 127 | 7,4% |
| Ordem de compra ainda fora da staging (ordens abertas, rodada diária) | 8 | 0,2% |
| Produto de nota sem vínculo com item do acompanhamento | 59 | 2,6% |
| Nota manual com produto e sem ordem de compra | 7 | 2,6% |
| Sem documento, tributo, devolução, produto fora da ordem | 15 | 1,6% |

- 468 dos 473 têm destino único (um serviço); nos 5 com mais de um serviço o peso
  "valor × quantidade" fechou com o total da nota.
- O Koper não liga guia de tributo a serviço; esses títulos continuam "À Apropriar".

### De-para de insumos (materiais)

- Produto de solicitação / ordem de compra cita `itemMonitInputId`. A consulta
  `GET /engineering/v1/monitoring_input?services=yes&inputId=&buildMonitoringId=&page=stockRequest`
  devolve `[{ itemMonitInputId, itemMonitoringId, monitItemReference, serviceName, … }]`.
  Entidade `mirror.monitoring_input_services` (id `<buildMonitoringId>-<inputId>`), derivada
  dos detalhes de solicitação e ordem de compra já na staging.
- Catálogo de serviços: `GET /engineering/v1/service?orderFlag=asc&orderby=serviceName&limit=&offset=`
  → `services[]` com `serviceId`, `serviceName`, `categoryId`, `categoryName`, `unitName`.
  Entidade `mirror.service`. (`/supply/v2/services` exige cabeçalho `Authorization` e não é usado.)

### Serviço `koper-mirror-tools`

Comando fixo `node dist/tools.js`; ferramenta em `KOPER_TOOL` (`chain-audit`, `inspect-elos`,
`budget`, `allocations`, ou várias separadas por vírgula), obra em `KOPER_TOOL_TARGET`,
gravação só com `KOPER_TOOL_WRITE=true`, piloto com `KOPER_ALLOC_LIMIT`. Não tem credencial
do Koper.

### Gravado em 2026-10-10 (autorizado pelo Fábio)

- Orçamento `KOPER-ACOMP-133` na obra Alma Seahouses: 67 grupos e 70 itens (62 com serviço,
  8 de etapa sem serviço); total conferido igual ao do Koper. 3 serviços novos no catálogo
  (`KOPER-S4190`, `KOPER-S4192`, `KOPER-S4218`).
- Rateio: piloto de 5 títulos e depois o restante — 473 títulos, 478 linhas em
  `payable_cost_allocations`, soma de cada título conferida com o valor do título. Metade
  dos títulos ficou ligada a um item do orçamento, a outra metade só ao serviço.
- Tela: PR #299 na `main` (commit `5dcae2b`) — `lib/cost-vs-budget/server.ts` e
  `title-details.ts` passam a ler títulos `koper_alma` e `koper_bossa`. Deploy do app
  concluído. O check `Vercel – crm-elos` já falhava na `main` antes dessa mudança.
- Depois de gravar, `KOPER_TOOL_WRITE` voltou para `false`.

### Pendências do rateio do Alma

1. Materiais (135 títulos): rodar `KOPER_TOOL=allocations` em modo plano depois da primeira
   rodada diária que carregar `mirror.monitoring_input_services` e as ordens abertas; conferir
   o plano antes de gravar, porque o caminho de material ainda não foi exercitado com dado real.
2. O texto "À Apropriar" continua nas observações dos títulos já rateados (`payables.notes`).
3. Guias de tributo retido: verificar se o Koper tem alguma ligação com a nota de origem.
4. Rateio ainda não entra na rotina diária (`sync-koper-mirror-daily.ts`); título novo do
   Alma entra "À Apropriar" até a ferramenta ser rodada de novo.
5. Soul, Jazz e Escritório Bossa: mesma ferramenta, falta configurar o alvo (`TARGETS` em
   `src/mirror-shared.ts`) e decidir qual acompanhamento do Koper é o orçamento de cada um.

## 13. Flow — conferência dos títulos e rateio que faltava (2026-10-10 / 11)

Ferramentas novas no `koper-mirror-tools` (alvo `KOPER_TOOL_TARGET=flow`):
`reconcile` (`src/reconcile-mirror-payables.ts`, leitura), `payable-corrections`
(`src/plan-payable-corrections.ts`, leitura) e `allocations` com o alvo `flow`. O orçamento
do Flow nunca é criado nem alterado por estas ferramentas (`budgetFromMonitoring: false`).

### Títulos: Elos OS × Koper

- Os 4.079 títulos do Flow no Koper estão todos no Elos OS (nada a importar). Tipos no
  Koper: `Original`, `Parcela`, `Crédito`, `Grupo`.
- O Elos OS tem 4.113 títulos `koper_flow`. A diferença de valor para o Koper fecha ao centavo:
  30 títulos que não existem mais no Koper (27 já rateados; vários são previsões de
  recebimento, vistos pela última vez entre agosto e outubro), 28 créditos de fornecedor
  lançados como despesa, 19 pais de agrupamento com todos os filhos também lançados e 4
  registros `koper_bill:missing-…`; mais 28 títulos com valor diferente.
- Também: 7 pagos no Koper e abertos no Elos OS; 49 com vencimento diferente.
- Nada disso foi alterado. O ensaio lista 140 títulos com a ação proposta (cancelar com
  `status = cancelled`, atualizar valor / vencimento, dar baixa); a planilha foi entregue ao
  Fábio para decisão título a título. A rotina diária antiga do Flow
  (`sync-koper-payables-daily.ts`) segue intocada.

### Rateio

- **Validação da régua:** nos títulos do Flow já rateados que a cadeia do espelho também
  resolve (1.929), o serviço coincide em 100%; em 1.888 o resultado é idêntico (serviço, item
  do orçamento e valor). Nos outros 41 o rateio gravado é menor que o valor atual do título
  (o título mudou de valor depois de rateado).
- **De-para de serviço:** no Flow os rateios foram reapontados para o orçamento oficial, então
  o serviço do Koper nem sempre é o `KOPER-S<id>`. O de-para é aprendido do histórico
  (`learnCrosswalk`): título com um único serviço do Koper na cadeia e um único serviço no
  rateio gravado dá um voto; só vale serviço com votos unânimes. Resultado: 108 serviços,
  1.911 votos, nenhum conflito (70 apontam para o próprio serviço do catálogo, 38 para
  serviço do orçamento oficial). Serviço sem histórico cai no catálogo. Casar por nome
  idêntico foi testado e descartado (errou 3 de 21).
- **Item do orçamento:** regra já usada pelo Flow — item de código único para o serviço entre
  os orçamentos aprovados da obra.
- **Gravado:** 158 títulos (piloto de 5 e depois 153), todos de nota manual com serviço,
  conferidos linha a linha; 1 serviço novo no catálogo. O Flow passou de 2.919 para 3.077
  títulos rateados. Nenhum rateio existente foi alterado.
- **Fica de fora, por motivo:** 652 de material (dependem de `mirror.monitoring_input_services`
  e das ordens abertas), 142 guias de tributo, 71 sem documento / devolução / comissão, 160
  notas de produto sem vínculo com item do acompanhamento ou sem ordem de compra, 7 que
  sumiram do Koper ou têm valor zero.
- **A investigar no caminho de material:** 96 títulos já rateados pela rotina antiga caem em
  "produto não encontrado na ordem de compra" pela régua nova — provável diferença entre
  produto genérico e produto específico (`mainProductId`). Validar contra o histórico depois
  que o de-para de insumos estiver carregado, antes de gravar material do Flow.

## 14. Primeira rodada diária completa e materiais (2026-10-11)

### Rotina diária `koper-mirror` (08:00 UTC)

- Rodou em 8 minutos: 75 entidades lidas nas três empresas, nenhuma entidade com falha,
  nenhuma listagem incompleta, 4.221 registros novos na staging.
- Entidades novas carregadas: `mirror.service` (401 por empresa),
  `mirror.measurement_items` (7 / 143 / 25 — Bossa / Flow / Alma),
  `mirror.monitoring_input_services` (902 / 1.659 / 120) e ordens abertas (ordens de compra
  +3 / +5 / +8; ordens de serviço +29 / +33 / +3).
- Promoção de títulos: nada novo a criar, conferência ok.
- O Railway marcou a rodada como falha porque duas notas eletrônicas do Flow (as mesmas de
  sempre) devolveram erro 500 no detalhe. A partir desta data a rodada só é dada como falha
  quando uma entidade inteira falha, uma listagem vem incompleta ou os detalhes com erro
  passam de 1% do pedido (mínimo de 5); falha isolada continua no relatório
  (`detailProblemSamples`, `detailFailuresTolerated`).

### Caminho de material validado contra o histórico do Flow

Com o de-para de insumos carregado, a régua foi comparada com os títulos de nota eletrônica
do Flow já rateados pela rotina antiga: 761 de 771 comparáveis ficaram idênticos (serviço,
item do orçamento e valor). Dos 10 restantes, 8 têm no gravado o marcador legado
`KOPER-SR-LEGACY` onde a régua acha o serviço real e 2 diferem em 1 centavo de
arredondamento.

### Alma — materiais gravados

Autorizado pelo Fábio em 2026-10-10. Piloto de 5 títulos e depois 120: 125 títulos de
material (115 de nota eletrônica, 10 de nota manual), todos ligados a item do orçamento,
conferidos linha a linha. O Alma passou a 598 de 689 títulos rateados (93% do valor). Ficam
"À Apropriar": 66 notas de produto sem vínculo com item do acompanhamento, 7 notas manuais
com produto sem ordem de compra, 4 com produto não encontrado na ordem e 14 sem documento,
tributo ou devolução.

### Flow — materiais só ensaiados

- 540 títulos de material ficariam rateados (428 no item do orçamento). **Não gravado**:
  aguarda o ok do Fábio.
- De-para aprendido agora com 134 serviços e 1 conflito: serviço 336 "Pisos em Porcelanato"
  tem 2 votos para o item 15.04 do orçamento oficial e 2 para o próprio `KOPER-S336`.
  Títulos com esse serviço ficam de fora até o Fábio decidir.
- Ainda sem solução pela régua: 181 títulos sem rateio e 121 já rateados caem em "produto não
  encontrado na ordem de compra" (hipótese a testar: produto genérico × específico,
  `mainProductId`).

## 15. Flow — materiais gravados, decisão do Porcelanato e investigação (2026-10-11)

### Gravado (autorizado pelo Fábio em 2026-10-11)

- Materiais do Flow: piloto de 5 títulos e depois 545 — 550 títulos, 830 linhas, conferidos
  linha a linha (nenhuma linha faltando, nenhum título desbalanceado). O Flow passou a 3.627
  títulos rateados.
- Decisão do Fábio: serviço 336 "Pisos em Porcelanato" do Koper vai para a linha 15.04 do
  orçamento oficial. Fica registrada em `TARGETS.flow.serviceDecisions`
  (`src/mirror-shared.ts`) e vale acima do histórico. As 2 linhas que esta ferramenta tinha
  gravado no serviço avulso `KOPER-S336` foram reapontadas (evidência guarda
  `repointedFromServiceId` e `repointNote`). É a única exceção à regra de nunca alterar linha
  existente, e só alcança linhas com `evidence.origin = "mirror"`.

### "Produto não encontrado na ordem de compra" — o que era

Censo dos títulos nessa situação (`KOPER_ALLOC_DEBUG=true`, somente leitura):

- A nota eletrônica (`mirror.xml_invoice`) guarda o produto como o XML foi associado: às vezes
  sem código do Koper, às vezes outra variação do produto pedido.
- A **entrada de estoque** da mesma nota (`mirror.purchase_detail`, ligada por
  `xmlInvoiceId`) guarda o produto como o comprador deu entrada contra a ordem de compra. Em
  todos os 121 títulos que a rotina antiga já tinha rateado e em 130 dos 184 sem rateio, os
  produtos da entrada de estoque estão todos na ordem.
- Regra nova (`resolveBill`): quando a leitura pelos produtos da nota falha por "produto não
  encontrado" ou "sem vínculo", a nota é relida pelas linhas da entrada de estoque (produto,
  preço × quantidade; total com ou sem desconto, o que fechar melhor, tolerância de 10%). A
  evidência grava `lineSource: "entrada de estoque"`. Nota que resolve pelos próprios
  produtos continua como antes.
- Validação contra o histórico: dos 120 títulos comparáveis já rateados pela rotina antiga
  (métodos `koper_nfe_stock_entry_single_service` e `koper_invoice_purchase_order`), 118
  ficaram idênticos e 2 diferem em 1 centavo.
- Resultado: 124 títulos novos resolvidos por essa regra. Gravados com autorização do Fábio
  (piloto de 5 e depois 119, 234 linhas, conferidos linha a linha). O Flow passou a 3.751
  títulos com rateio (3.724 depois do cancelamento abaixo).

### O que continua sem solução (e por quê)

- Produto fora da ordem mesmo na entrada de estoque (item comprado junto, sem pedido): 51
  notas eletrônicas e 3 manuais. Só sai com regra de negócio (por exemplo, seguir o rateio do
  resto da nota) — decisão do Fábio.
- Solicitação de material feita no Koper sem apropriação (o produto da solicitação não tem
  `services[]`): 46 notas eletrônicas e 7 manuais sem rateio; a rotina antiga rateou outras
  36 assim, por método que a evidência gravada não explica.
- Hipótese testada e **descartada**: usar o item do acompanhamento quando o insumo aparece em
  um único item. Nos 7 títulos em que dava para comparar com o rateio antigo, o serviço saiu
  diferente em todos. Não foi implementada.

### Títulos do Elos OS que não existem mais no Koper (30)

Ensaio `payable-corrections` (somente leitura) com a natureza de cada um, lida do registro
antigo da staging (`bill_to_pay`):

- 12 eram previsão automática de recorrência (`receiptDraft` + `hasRecurrence`) e 1 era
  rascunho de tributo: o Koper apagou, não há substituto.
- 15 eram previsão lançada à mão (documento "PREVISÃO…"), apagada no Koper; em um caso dois
  títulos reais pagos somam exatamente o valor previsto.
- 2 eram títulos reais que no Koper viraram dois cada (as duas partes somam exatamente o
  valor original, estão pagas e já estão no Elos OS): o original ficou duplicado.

Todos estavam em aberto no Elos OS e 27 tinham rateio.

**Cancelados com autorização do Fábio em 2026-10-11** pela ferramenta `payable-cancel`
(`src/cancel-missing-payables.ts`), piloto de 5 e depois 25:

- nada é apagado: `payables.status` passa de `open` a `cancelled` e `notes` ganha a data e o
  motivo; `source_system` / `source_id` e as linhas de rateio ficam como estão. As telas só
  leem títulos `open` e `paid` (`lib/cost-vs-budget/server.ts`), então o rateio do título
  cancelado deixa de contar;
- lista fechada em `TARGETS.flow.approvedCancellations` (30 números): título que sumir do
  Koper depois não é cancelado sozinho;
- travas por título: está na lista, está `open` (pago nunca é cancelado), não aparece na
  listagem espelhada do Koper e essa listagem tem pelo menos 1.000 títulos;
- conferência depois de gravar: os 30 ficaram `cancelled`, valores iguais, as 27 linhas de
  rateio intactas, nenhum outro título mudou de situação;
- para desfazer um: voltar `status` para `open` (a anotação em `notes` mostra a data).

Depois disso o Flow tem 4.079 títulos ativos vindos do Koper — o mesmo número do Koper — e a
lista de divergências caiu de 140 para 110 títulos (crédito de fornecedor como despesa, pai
de agrupamento, valor, baixa e vencimento), que continuam aguardando SIM / NÃO na planilha.
O rateio e o ensaio de correções passaram a ignorar título cancelado.

## 16. Exceção à regra "nunca escrever no Koper" — serviços no orçamento do Alma (2026-10-11)

A regra continua valendo para o worker: ele só lê o Koper. Em 2026-10-11 o Fábio pediu, pela
conversa, que a base do orçamento do Flow fosse copiada para o Alma **dentro do Koper**, para
gerar os centros de custo. Foi feito uma única vez, à mão assistida, pela tela do próprio
Koper com o login dele (Engenharia › Orçamentos de obra › "Adicionar serviço") — nada passou
pelo worker nem por chamada direta à API fora da tela.

- Origem: orçamento "Flow Aptos - OBRA" (#100, empresa Flow Aptos - Bossa), 108 serviços em
  28 etapas. O orçamento "Flow Aptos - INDIRETOS" (#166) ficou de fora.
- Destino: orçamento "Alma Seahouses - OBRA" (#298, empresa Alma Seahouses - Bossa), que
  tinha só as 28 etapas e 38 subetapas, sem serviço. Passou a 174 itens (66 de estrutura,
  intocados, e 108 serviços novos, `itemBudgetId` 826 a 933).
- Cada serviço entrou na etapa de mesmo número do Flow; os de "Estaca Hélice Contínua" e
  "Bloco" dentro das subetapas 2.1 e 2.2, que existem nos dois orçamentos. Mesmo serviço
  (`serviceId`) e mesma composição (`compositionId`) do Flow: os dois cadastros são comuns
  às empresas.
- Quantidade: o Koper recusa zero ("preencha uma quantidade maior que zero") e o valor
  unitário vem travado da composição. Por decisão do Fábio todos entraram com quantidade 1,
  só para existir o centro de custo; o total do orçamento é provisório até o levantamento.
  Em 3 serviços de forma (lajes, vigas, pilares) o valor unitário da composição hoje difere
  em centavos do que está gravado no orçamento do Flow.
- Conferência: antes de cada gravação a tela foi conferida (serviço, composição, etapa,
  quantidade) e depois o orçamento foi relido inteiro: cada serviço do Flow aparece
  exatamente uma vez, na etapa esperada, com quantidade 1; foram 108 gravações, todas de
  criação de item, nenhuma alteração ou exclusão.
- O acompanhamento "Alma Seahouses Obra" (#133), onde as compras são apropriadas hoje, **não
  foi alterado** (129 itens antes e depois). Os serviços novos só chegam a ele quando o
  Fábio gerar planejamento / acompanhamento a partir do orçamento.
- No Elos OS nada mudou: o orçamento `KOPER-ACOMP-133` do Alma vem do acompanhamento, não do
  orçamento #298. A rotina diária passa a espelhar os itens novos em
  `mirror.construction_budget_items`.
