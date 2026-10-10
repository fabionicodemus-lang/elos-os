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

Empresa Bossa por centro de custo (detalhe dos 3.651 títulos, soma de `billValue`):

| Centro de custo (id)            | Títulos | Total (R$)   |
|---------------------------------|--------:|-------------:|
| Escritório Central (135)        |   2.407 | 3.754.593,03 |
| Matriz (3)                      |     691 | 1.767.023,08 |
| Soul Residence (102)            |     499 |   765.291,16 |
| Alma Seahouses (202)            |      32 |   307.865,98 |
| Alma Seahouses - EMPRESA (201)  |       3 |    16.300,00 |
| Jazz Residence (103)            |      11 |     2.126,28 |
| sem centro de custo (tipo Grupo)|       8 |    39.819,46 |

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

1. **Títulos agrupados contam em dobro na listagem.** `bills_to_pay` devolve o título
   pai (`bill_type = "Grupo"`, sem centro de custo) **e** os filhos (`status = "Agrupada"`,
   `join_bill_id` preenchido). O cabeçalho (`totalBills`) ignora os pais. Na Bossa: 8 pais =
   23 filhos = R$ 39.819,46. No Flow a diferença cabeçalho × soma da lista é R$ 151.373,46 —
   é a "divergência interna" registrada no handoff de setembro. **Na promoção, o pai tipo
   Grupo não pode virar custo**; conferir se o Flow já promovido no Elos OS tem esse dobro.
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
| `receipt` (derivada)                                | ids vindos de compras e títulos  | `/financial/v1/receipt?receiptId=`       |
| `xml_invoice` (derivada)                            | ids vindos de compras e títulos  | `/financial/v1/xml_invoice?invoiceId=`   |

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

- Financeiro: contas a receber, notas manuais sem compra, tributos, plano de contas
  (`item_chart_account`), movimentação bancária.
- Suprimentos: entradas de estoque (`/stock/v1/entry`, `product_entry`), produtos, serviços.
- Engenharia: orçamentos de obra, contratos, medições (`/engineering/v1/*`).
- Comercial e pós-obra: vendas, contratos de venda, clientes, assistências técnicas.
- RH: folha e rateio.

## 8. Decisões pendentes para a camada 2 (promoção)

1. Projetos no Elos OS para Alma, Soul, Jazz e Escritório Bossa (o Flow já existe).
2. `source_system` dos títulos novos: sugerido `koper_bossa` e `koper_alma`, no padrão do
   `koper_flow` já usado.
3. Títulos tipo Grupo: promover só os filhos.
4. As 59 exceções `existing_value_or_due_date_conflict` da rotina diária do Flow.
