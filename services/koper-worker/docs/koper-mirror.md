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
