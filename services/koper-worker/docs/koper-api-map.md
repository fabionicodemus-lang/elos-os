# Mapa da API do Koper — fluxo prioritário

> **Fonte.** Extraído de um HAR capturado manualmente pelo Fábio em 2026-07-31, navegando o fluxo prioritário inteiro no contexto **`Flow Aptos - Bossa`** com o DevTools aberto. O HAR bruto **não é versionado** (contém `accessToken` de sessão e dados pessoais/valores reais). Deste arquivo constam apenas: método, caminho, chaves de query (nunca valores) e **estrutura de campos** das respostas (nunca valores). Alinhado à Seção 3.2/3.3 da constituição.
>
> Parâmetros onipresentes omitidos das tabelas: `accessToken`, `cb` (cache-buster), `appVersion`, `visited-page`. Todos os endpoints são REST em `https://api.koper.com.br`. Existe também um host `graphql.koper.com.br`, não usado pelo fluxo prioritário observado.

## 1. Mapa de rotas (29 operações, `OPTIONS` omitido)

Legenda: ✅ = corpo de resposta capturado neste HAR (estrutura na Seção 2). Sem ✅ = endpoint e parâmetros confirmados, corpo ainda não capturado (o Chrome descartou a maioria dos corpos ao salvar; só 12 das 195 respostas vieram completas).

### Administrativo / cadastros-base
| operação | params (de negócio) | status | corpo |
|---|---|---|---|
| `GET /administrative/v1/enterprise` | `page` | 200 | ✅ (empresa ativa) |
| `GET /administrative/v1/multi_company` | `page` | 200 | ✅ (lista de empresas) |
| `GET /administrative/v1/user` | `app` | 200 | ✅ |
| `GET /administrative/v2/tags` | `module`, `submodule` | 200 | ✅ |
| `POST /login/change_company` | `changeCompany` | 200 | troca de empresa (exceção allowlisted) |

### Suprimentos / estoque
| operação | params (de negócio) | status | corpo |
|---|---|---|---|
| `GET /stock/v1/request` | `group`, `limit`, `offset`, `open`, `orderFlag`, `orderby`, `typeDate` | 200 | (já mapeado antes) |
| `GET /stock/v1/product_request` | `group`, `history`, `productRequestId`, `requestId` | 200 | (já mapeado antes) |
| `GET /stock/v1/stock_place` | `buildingFinished`, `page` | 200 | ✅ |
| `GET /stock/v1/sector` | `buildingFinished`, `stockPlaceId` | 200 | — |
| `GET /stock/v1/entry` | `limit`, `offset`, `orderFlag`, `orderby` | 200 | — |
| `GET /stock/v1/pending_entry` | `limit`, `offset`, `orderFlag`, `orderby`, `originType`, `placeEntryId` | 200 | — |
| `GET /stock/v1/product_entry` | `entryId`, `pending` | 200 | — |
| `GET /stock/v1/temp_entry` | — | 200 | — |
| `GET /stock/v1/prod_req_comment` | `productRequestId` | 404 | — |

### Compras
| operação | params (de negócio) | status | corpo |
|---|---|---|---|
| `GET /purchase/v1/budget` | `budgetId`, `group`, `initialDate`, `finalDate`, `limit`, `offset`, `orderFlag`, `orderby`, `typeDate` | 200/404 | — |
| `GET /purchase/v1/budget_negotiation` | — | 404 | — |
| `GET /purchase/v1/purchase` | `initialDate`, `finalDate`, `limit`, `offset`, `orderFlag`, `orderby` | 200 | — |
| `GET /purchase/v1/purchase_order` | `orderId`, `invoiceId`, `open`, `limit`, `offset`, `page`, `orderFlag`, `orderby`, `typeDate` | 200/404 | parcial |
| `GET /purchase/v1/service_order` | `orderId`, `open`, `limit`, `offset`, `orderFlag`, `orderby` | 200 | — |
| `GET /purchase/v1/supplier` | `supplierId`, `supplierType`, `page`, `limit`, `offset`, `orderFlag`, `orderby` | 200 | ✅ |
| `GET /supply/v2/purchases/details/{id}` | (id no path) | 200 | — |

### Financeiro
| operação | params (de negócio) | status | corpo |
|---|---|---|---|
| `GET /financial/v1/bills_to_pay` | `billId`, `allBills`, `initialDate`, `finalDate`, `limit`, `offset`, `orderFlag`, `orderby`, `typeDate` | 200 | ✅ (contas a pagar) |
| `GET /financial/v2/bills-to-pay/{id}/events` | (id no path) | 200 | — |
| `GET /financial/v1/account` | `page` | 200 | ✅ (contas bancárias) |
| `GET /financial/v1/item_chart_account` | `page`, `typeChartAccount` | 200 | — (plano de contas) |
| `GET /financial/v1/receipt` | `receiptId` | 200 | — |
| `GET /financial/v1/supplier` | `supplierId`, `disabled`, `page` | 200 | — |
| `GET /financial/v1/xml_invoice` | `invoiceId` | 200 | ✅ (nota fiscal + XML) |

> **Resolução do bloqueio da cotação 3268:** o detalhe do orçamento é `GET /purchase/v1/budget?budgetId={id}&group=request` — **não precisa de clique na linha virtualizada**. O crawl visual de 5 ciclos que falhou fica obsoleto: basta chamar a listagem `budgetId=all` para obter os IDs e depois `budgetId={id}` para cada detalhe. O corpo do detalhe ainda não foi capturado neste HAR (a resposta veio vazia); capturar num próximo diagnóstico direcionado, ou num novo HAR abrindo uma cotação.

## 2. Estrutura de respostas capturadas (só campos, sem valores)

### `GET /administrative/v1/enterprise` — empresa ativa (objeto)
`enterpriseId`, `branchId`, `enterpriseName`, `fantasyName`, `cnpj`, `stateRegistration`, `municipalRegistration`, `stockPlaceId`, `stockPlaceName`, `isBranch`, `fatherEnterpriseId`, `status`, `expireDate`, `paymentStatus`, `logoLink`, `creci`, `phone`, `cellphone`, `address.{addressId,addressName,number,complement,neighborhood,city,state,zipcode}`, `partners`, `representatives.{representativeId,personId,name,fantasyName,cpf,cnpj,gender,maritalStatus,birthday,occupation,position,website,email,phone,cellphone,address.*}`, `departments.{departmentId,departmentName}`, `branches`, `accountant`, `files`, `levelPermission.{moduleName,signatureBlocked,components.{name,permission}}`, `idIntegrationTimeTracking`, `filled`.

### `GET /administrative/v1/multi_company` — empresas autorizadas (array)
Por empresa: `enterpriseId`, `branchId`, `enterpriseName`, `fantasyName`, `cnpj`, `stockPlaceName`, `fatherEnterpriseId`, `accountantId`, `creationDate`, `logoLink`, `phone`, `address.{addressId,addressName,number,complement,neighborhood,city,state,stateSymbol,zipcode}`, `partners`, `users`, `idIntegrationTimeTracking`.

### `GET /administrative/v1/user` — usuário logado (objeto)
`userId`, `personName`, `userAbbreviation`, `email`, `phone`, `cellphone`, `address`, `photoUrl`, `admin`, `userBlocked`, `updatePassword`, `fixedMenu`, `hash`, `filled`, `levelPermission.{moduleName,signatureBlocked,components.{name,permission}}`.

### `GET /administrative/v2/tags` — etiquetas (objeto paginado)
`total`, `limit`, `offset`, `items.{tagId,tagName,tagModule,tagSubmodule,colorHex,isUsed,createdAt,updatedAt}`.

### `GET /stock/v1/stock_place` — locais de estoque (array)
Por local: `stockPlaceId`, `stockName`, `buildingId`, `buildMonitoringId`, `buildingFinished`, `sectorAmount`, `deadline`, `deadlinePeriod`, `inventoryPeriod`, `alertInventoryPeriod`, `phone`, `cellphone`, `address.{addressId,addressName,number,complement,neighborhood,city,state,zipcode}`.

### `GET /purchase/v1/supplier` — fornecedores (objeto)
`suppliersAmount`, `suppliers.{supplierId,supplierName,companyName,cnpj,cnpjType,cpf,cpfType,email,phone,creditBalance,commissionValue,isProvider,isService,isCarrier,isRealEstate,address.{addressId,addressName,number,complement,neighborhood,city,state,zipcode}}`.

### `GET /financial/v1/account` — contas bancárias / cobrança (array)
Por conta: `accountId`, `accountName`, `accountNumber`, `accountDigit`, `accountType`, `bankAccountName`, `bankAccountType`, `bankCode`, `fncBankCode`, `bankName`, `agencyNumber`, `agencyDigit`, `operation`, `initialBalance`, `accountBalance`, `initialDate`, `portfolio`, `ourNumber`, `lastDocumentNumber`, `shippingNumber`, `recipientCode`, `pixType`, `pixNumber`, `acceptance`, `instructions`, `rates`, `interestRateValue`, `lateFeeRateValue`, `lateFeeDays`, `discount1RateValue`/`discount1Days`, `discount2RateValue`/`discount2Days`, `discount3RateValue`/`discount3Days`, `protestReturnDays`, `protestReturnCode`, `movementBlockedPeriod`, `conciliationStatus`, `hasCheck`, `sendEmail`, `bsOtherAccruals`, `setupBankSlipId`, `setupBankSlipInfoId`.

### `GET /financial/v1/bills_to_pay` — contas a pagar (objeto)
Totais: `billsAmount`, `totalBills`, `totalPaid`, `totalNotPaid`, `totalConsolidated`, `totalNotConsolidated`, `totalDiscount`, `totalInterest`.
Por título em `bills.{billToPayId,billId,fatherBillId,joinBillId,billOrder,billValue,paymentValue,paymentDate,paymentType,dueDate,isPaid,splitted,installmentAmount,discountValue,interestValue,lateFeeValue,otherAccruals,accountId,accountName,checkId,invoiceNumber,receiptNumber,billReceiptNumber,recTypeId,recTypeName,originName,hasRecurrence,taxId,taxDraft,receiptDraft,billComments,tags,payroll_apportionment,bankSlipFileId,bankSlipFilename,proofPayFileId,proofPayFilename}`.

### `GET /financial/v1/xml_invoice` — nota fiscal + XML (objeto)
Cabeçalho: `invoiceId`, `invoiceNumber`, `invoiceType`, `accessKey`, `emitDate`, `exitDate`, `situation`, `isDraft`, `finNFe`, `references`, `creditValue`, `xmlFileId`, `pdfFileId`, `stockPlaceId`, `stockPlaceName`, `costCenterId`, `costCenterName`, `costCenterAddress.*`, `chartAccountId`, `chartAccountName`, `itemChartAccountId`, `itemChartName`, `buildMonitoringId`, `deliverySupplierId`, `deliverySupplierName`, `registerUserName`, `cancelationUser{Id,Name,Date}`.
`total.{totalValue,totalNF,totalTax,totalDiscount,shippingValue,otherValues,cofins,pis,ipi,st}`.
`products.{productId,productName,productFullName,mainProductId,numberItem,prodReference,amount,unitValue,totalValue,unitMeasure,symbol,cfop,invoiceCfop,inputId,inputUnit,apportionment,infAdProd,isTool,supplierProductId,supplierProductCode,supplierProductName,supplierProdCodeId,supplierUnitMeasure,supplierConversionFactor}`.
`supplier.{supplierId,supplierName,mainSupplierId,mainSupplierName,fantasyName,branchId,cnpj,phone,creditBalance,isProvider,isService,isCarrier,address.*}`.
`receiver.{companyName,cnpj,phone,deliveryPlace,address.*}`.
`carrier.{typeShipping,volume}`.
`bill.{billToPayId,duplicates.{billId,duplicateNumber,billOrder,joinBillId,billValue,dueDate,paymentDate,paymentValue,paymentForm,paymentId,discountValue,interestValue,lateFeeValue,chequeNumber,accountId,accountName,accountType,isPaid,billReceiptNumber,bankSlipFileId,bankSlipFilename,proofPayFileId,proofPayFilename}}`.
`purchaseOrders`.

## 3. Implicações para a extração

1. **Cadastros-base (Fase 2) praticamente mapeados numa tacada:** empresas (`enterprise`/`multi_company`), usuários (`user`), fornecedores (`purchase/supplier`, `financial/supplier`), locais de estoque (`stock_place`/`sector`), plano de contas (`item_chart_account`), contas bancárias (`account`), etiquetas (`tags`).
2. **Fluxo de suprimentos completo tem rota confirmada ponta a ponta:** solicitação (`stock/request` → `product_request`) → cotação (`purchase/budget`) → pedido (`purchase/purchase_order`, `service_order`, `supply/v2/purchases/details`) → entrada/recebimento (`stock/entry`, `pending_entry`, `product_entry`) → nota fiscal (`financial/xml_invoice`) → conta a pagar (`financial/bills_to_pay` + `/events`).
3. **Todos usam paginação `limit`/`offset`** (mesmo padrão já homologado em `stock/request`), com `orderby`/`orderFlag` e filtros de data `initialDate`/`finalDate`/`typeDate`.
4. **Corpos ainda não capturados** (budget detail, purchase, purchase_order 200, service_order, entries, receipt, item_chart_account): capturar em diagnóstico direcionado por endpoint (agora que a rota é conhecida, um GET autenticado pela própria interface já resolve) ou num próximo HAR abrindo cada tela uma vez.
