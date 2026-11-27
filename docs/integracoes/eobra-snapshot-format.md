# Pacote de migração eObra — formato v1

Contrato de captura, validação e revisão. Este pacote descreve dados da origem;
não autoriza a criação automática de lançamentos, pagamentos ou movimentos bancários.
Os exemplos são sintéticos. Exportações reais e credenciais não pertencem ao repositório.

## Envelope JSON

```json
{
  "format": "elos.eobra.snapshot.v1",
  "source": {
    "host": "exemplo.eobra.com.br",
    "capturedAt": "2026-11-26T12:00:00.000Z",
    "referenceDate": "2026-11-26"
  },
  "scope": {
    "projectIds": ["project-example"],
    "allProjects": false
  },
  "archiveTypes": [
    {"key": "finance_title", "description": "Título agrupador de parcelas na origem"}
  ],
  "coverage": [
    {
      "entity": "project",
      "sourceProjectId": null,
      "expectedCount": 1,
      "expectedPages": 1,
      "collectedPages": [1],
      "detailsExpected": 1,
      "detailsCollected": ["project-example"],
      "complete": true,
      "filters": {"projectIds": ["project-example"]}
    }
  ],
  "records": [
    {
      "entity": "project",
      "sourceId": "project-example",
      "sourceProjectId": null,
      "parentSourceId": null,
      "links": [],
      "raw": {"id": "project-example", "name": "Obra sintética"},
      "normalized": {"name": "Obra sintética", "code": "EX-01"}
    }
  ]
}
```

O exemplo acima é propositalmente parcial: a inspeção deve listar as coberturas
ausentes e retornar `complete=false`. O contrato completo inclui as entidades
prioritárias, inclusive coberturas com contagem zero quando comprovadamente vazias.

## Identidade e relações

- Entidades prioritárias: `project`, `person`, `unit`, `sale`, `receivable`,
  `payable`, `settlement`, `bank_account`, `bank_transaction`, `correction_index`,
  `index_value`.
- `sourceId` é uma string estável, sem transformação em número, correspondência
  por nome ou remoção de zeros. A identidade é `(entity, sourceId)` dentro da
  instância `source.host`; para arquivo complementar, inclui `archiveType`.
- `sourceProjectId` é um vínculo à entidade `project`, não faz parte da identidade.
  Unidades, vendas, parcelas e baixas exigem a obra explicitamente.
- Cada link tem `{entity, sourceId, role}`. Um link para `raw_archive` acrescenta
  `archiveType`. Todo alvo deve existir no pacote; não há referência externa implícita.
- Relações comerciais podem incluir `primary` booleano, `allocated_amount` decimal,
  `ownership_percent` decimal com até quatro casas e `source_relation_id` textual.
  Esses campos registram o que foi observado; ausência não significa divisão igual
  nem relação principal. Mais de um principal na mesma função é uma inconsistência.
- `parentSourceId`, quando informado, deve corresponder exatamente a um link de
  `role="parent"`. A entidade e o tipo do pai vêm desse link.
- IDs obtidos em camadas diferentes da interface permanecem separados. O ID da
  parcela, o número exibido do título, o ID da venda e um ID de gerenciamento de
  plano não são aliases automáticos.
- Registros repetidos são identificados; conteúdo conflitante para a mesma
  identidade bloqueia a validação. A inspeção nunca escolhe uma versão silenciosamente.

## Cobertura

Uma entrada representa exatamente `(entity, sourceProjectId, archiveType?)`.
`sourceProjectId=null` significa conjunto global, não soma das obras.

| Campo | Regra |
| --- | --- |
| `expectedCount` | Contagem declarada pela origem, inteiro não negativo ou `null` se desconhecida |
| `collectedCount` | Opcional na entrada; a inspeção deriva dos registros distintos e confere uma alegação fornecida |
| `expectedPages` | Inteiro não negativo ou `null`; quantidade esperada de páginas da consulta |
| `collectedPages` | Números de página, começando em 1, sem repetição nem lacunas para uma coleta completa |
| `detailsExpected` | Quantidade de detalhes esperados; zero é explícito quando a listagem contém os dados necessários |
| `detailsCollected` | IDs dos registros com detalhe capturado, sem repetição e pertencentes à mesma cobertura |
| `complete` | Alegação do coletor; só continua verdadeira se as contagens, páginas e detalhes forem consistentes |
| `filters` | Objeto JSON com os filtros reais aplicados na captura |

Todas as entidades prioritárias precisam estar inventariadas. Para `unit`, `sale`,
`receivable`, `payable` e `settlement`, é necessária uma cobertura por obra do escopo.
Os demais registros exigem a cobertura exata do seu conjunto. Uma cobertura global
de `project` deve comprovar as obras declaradas. Arquivos complementares exigem
cobertura própria. Não se infere conjunto vazio pela ausência de registros.

`ok` indica ausência de erro estrutural, financeiro, de referência ou de alegação
de cobertura. Uma coleta declaradamente parcial pode ter `ok=true` e
`complete=false`; declarar `complete=true` com contagens divergentes é um erro.

`complete` na saída significa que o **escopo declarado** foi capturado e validado.
`allProjectsComplete` também exige `scope.allProjects=true`. Nenhum deles significa
que os registros foram promovidos ao financeiro. Cada promoção tem sua validação
e resultado próprios; entidades arquivadas nunca são declaradas promovidas.

Contagens e totais são verificações de consistência do manifesto capturado. A
evidência externa de contagens/filtros deve ser obtida pelo coletor autorizado.

## Dados normalizados

Chaves do envelope usam camelCase; campos de `normalized` usam snake_case.
Campos adicionais são preservados, mas não ganham significado operacional automático.
Não são aceitos IDs canônicos do Elos como substituição de vínculos de origem.

### Cadastros e comercial

| Entidade | Campos mínimos e relações |
| --- | --- |
| `project` | `name`; `code`, `status`, documento da SPE e demais atributos podem ser preservados |
| `person` | `name`, `person_type` (`PF`, `PJ`, `OTHER`), `roles` (lista de `client`, `supplier`, `broker`, `other`), `status` (`active`, `inactive`); `tax_id` opcional validado quando informado |
| `unit` | `code`, `status` (`available`, `reserved`, `sold`, `inactive`), `sourceProjectId` e link `project` com role `project` |
| `sale` | `number` (número comercial), `sale_date`, `total_amount`, `status` (`active`, `cancelled`, `draft`); um ou mais links `unit` role `unit` e `person` role `buyer`; `contract_number` opcional |

O ID em `sale.sourceId` continua sendo o identificador técnico da origem. O número
comercial da venda fica em `normalized.number`. Não há união de pessoas por nome.
Uma pessoa pode ter mais de um papel; o destino decide explicitamente quais
cadastros canônicos serão criados ou vinculados.

Vendas podem ter múltiplas unidades e compradores. Os links são a autoridade das
relações. Se `normalized.units` for fornecido, a lista de
`{source_id, primary, allocated_amount}` deve espelhar exatamente os links de role
`unit`. Alocações monetárias completas devem somar `total_amount`; participações
completas devem somar 100%. Alocações parciais e ausência de um principal explícito
quando há várias relações ficam em `promotionBlockers`, sem escolher a primeira
unidade ou pessoa pela ordem da listagem.

`draft` não é promovido como venda ativa. Data e valor podem estar ausentes em um
rascunho, mas valores fornecidos devem ser válidos. Um rascunho cujo texto de data
não puder ser normalizado deve ser preservado como `raw_archive`, por exemplo com
`archiveType="sale_draft"`, mantendo o texto original em `raw`.

### Parcelas e títulos

`receivable` e `payable` exigem descrição ou documento, vencimento civil ISO,
`status` (`open`, `paid`, `partial`, `cancelled`, `unknown`), `correction_locked`
booleano e os valores abaixo, sempre como strings decimais em reais:

```json
{
  "description": "Parcela sintética",
  "due_date": "2026-12-10",
  "status": "open",
  "original_amount": "100.00",
  "current_amount": "110.00",
  "paid_amount": "0.00",
  "balance_amount": "110.00",
  "interest_amount": "0.00",
  "penalty_amount": "0.00",
  "correction_amount": "10.00",
  "other_accrual_amount": "0.00",
  "discount_amount": "0.00",
  "sequence_number": 1,
  "sequence_total": 12,
  "correction_locked": false,
  "correction": {
    "mode": "index_number",
    "base_month": "2025-01",
    "base_value": "1000.000000",
    "reference_month": "2026-11",
    "reference_value": "1100.000000"
  }
}
```

- Valores monetários usam duas casas decimais e são magnitudes não negativas,
  exceto `correction_amount`, que pode ser negativo quando comprovado pela política
  ou pelo histórico travado. Sinal e formato da origem permanecem em `raw`.
  Nenhum campo ausente vira zero.
- `current_amount = original_amount + interest_amount + penalty_amount +
  correction_amount + other_accrual_amount - discount_amount`.
- Em todos os estados: `current_amount = paid_amount + balance_amount`.
  Em `cancelled`, `balance_amount` é histórico e pode ser positivo; a classificação
  explícita de cancelamento torna o saldo exigível zero. Original, atualizado,
  componentes, baixas e residual histórico permanecem preservados. Pagamentos
  parciais ou integrais continuam no realizado quando seus eventos líquidos
  reconciliam. Não se inventa desconto para zerar o histórico nem se projeta
  cobrança sobre esse saldo. A composição e o status observados precisam ser
  inequívocos; divergências permanecem pendentes.
- Os resumos financeiros expõem `balance_amount` histórico e
  `collectible_balance_amount` exigível separadamente. Na inspeção,
  `totalsComplete=false` sinaliza totais não conferidos; na revisão SQL,
  `totals.<carteira>.complete=false` indica campos monetários não interpretados.
- `unknown` fica bloqueado. `partial` pode ser um retrato válido quando as baixas
  reconciliam; a promoção só ocorre quando o modelo de destino suportar esse estado.
- `receivable` exige link `sale` role `sale`, `sequence_number` e `sequence_total`.
  A unidade e comprador vêm dessa venda real, com verificação da obra.
- `payable` exige link `person` role `supplier` ou `counterparty_name` explícito.
- Todo pagamento informado precisa reconciliar com eventos de `settlement` do
  pacote e com cobertura completa dessas baixas. Não se inventam data nem conta.
- `correction.mode="none"` explicita ausência de correção. `index_number` exige
  base e referência explícitas, link `correction_index` role `correction_index` e
  valores mensais correspondentes. Não se aplica carência padrão de quatro meses.
- `lag_months` e `calculation_month` podem ser fornecidos quando documentados na
  regra de origem. Histórico travado deve preservar o valor efetivamente capturado.
- `negative_variation_policy="maximum_of_period"` exige registros `index_value`
  de todos os meses entre base e referência para o índice explicitamente vinculado.
  A inspeção monta a série para o motor a partir desses registros, sem repeti-la nem
  alterar o `normalized` de cada parcela. Se a parcela também informar
  `index_values:[{reference_month,value}]`, cada ponto deve coincidir com o cadastro
  mensal capturado da mesma série.
  O motor financeiro seleciona a máxima do período comprovado; não usa somente o
  último mês nem dados posteriores ao corte. `use_negative` usa a razão explícita.
  A ausência dessa política não comprova qual regra aplicar em atualizações futuras.
- Histórico pago, cancelado ou explicitamente travado pode preservar política
  ausente, com aviso. Uma regra capturada ainda sem motor, como taxa fixa, permanece
  explícita no histórico travado e em `promotionBlockers`; não é convertida em
  `none`. Não são autorizados reajustes futuros por essa preservação.

### Baixas, contas e índices

| Entidade | Campos mínimos e relações |
| --- | --- |
| `settlement` | `kind` (`payment`, `reversal`, `voided_payment`), `amount`, `occurred_on`, `medium` (`bank`, `cash`, `non_cash`); link para parcela role `installment`; banco/caixa exige link `bank_account` role `account`; estorno exige link `settlement` role `reverses` |
| `bank_account` | `name`, `status` (`active`, `inactive`), `currency` (`BRL`); `account_type`, titular/SPE, banco, agência, número e saldo inicial preservados quando existentes |
| `bank_transaction` | `occurred_on`, `direction` (`credit`, `debit`), `amount`, `status` (`posted`, `cancelled`); link `bank_account` role `account`; se representar baixa, link `settlement` role `settlement` |
| `correction_index` | `code`, `name`, `value_type` (`index_number`, `percentage`) |
| `index_value` | `reference_month` (`YYYY-MM`), `value` decimal string com até seis casas; link `correction_index` role `index` |

Um estorno mantém ID próprio e referencia o evento original. Estornos não podem
exceder o pagamento, trocar a parcela nem anteceder o evento revertido. Uma conta
prevista não substitui a conta de liquidação. `unknown` em meio de baixa permanece
pendente. `non_cash` preserva liquidação não bancária sem fabricar conta financeira.

Quando a origem marca explicitamente um pagamento como estornado, mas o evento
de estorno não tem data civil válida, `voided_payment` conserva o valor e a data
originais do pagamento com efeito líquido zero. Exige
`normalized.voided_by_source_id`, `normalized.voided_date_unknown=true` e exatamente
um link `voided_by` para `raw_archive` com `archiveType` declarado e ID correspondente.
O arquivo conserva a data bruta inválida. Um backlink `original_payment`, quando
informado, deve referenciar o pagamento anulado. Não se inventa data nem se aplica
outro `reversal` ao mesmo pagamento. Um substituto efetivo é uma baixa independente.

`summary.settlements.voided_amount` e `voided_count` mostram o histórico anulado;
ele não entra em `payment_amount`, `reversal_amount` ou `net_amount`.
`summary.history_dates_complete` e `summary.settlements.history_dates_complete`
ficam `false`, independentemente dos totais e da cobertura. Assim uma coleta
completa e monetariamente conciliada não é descrita como histórico temporal
completo. Um estorno comum com data inválida continua bloqueado; o normalizador
não o converte implicitamente em anulação.

## Arquivos complementares

Entidades sem promoção implementada são registros `raw_archive`, com `archiveType`
previamente declarado em `archiveTypes`. Exemplos: `finance_title`, `payment_plan`,
`bill_manager_item`, `contract_document`, `collection_case`, `sale_draft`,
`company_cost_center` e `company_financial_title`.

```json
{
  "entity": "raw_archive",
  "archiveType": "finance_title",
  "sourceId": "title-example",
  "sourceProjectId": "project-example",
  "parentSourceId": null,
  "links": [],
  "raw": {"number": "100", "label": "Título sintético"},
  "normalized": {"description": "Título agrupador preservado para auditoria"}
}
```

Esses registros participam da cobertura, do hash e da verificação de referências,
com resultado `archived`. Não se cria venda, parcela, baixa ou banco a partir deles
por semelhança de nome, número ou formato.

Um centro de custo de escritório ou ativo não é automaticamente uma obra. Registros
financeiros corporativos sem obra compatível podem ser arquivados com
`sourceProjectId=null`, tipo documentado e cobertura global explícita. O relatório
identifica que a promoção desses dados ainda não existe.

## API de inspeção e hashes

`inspectEobraSnapshot(input)` aceita objeto JSON, string JSON, `Uint8Array` ou
`ArrayBuffer`. Retorna envelope inspecionado com `ok`, `complete`,
`allProjectsComplete`, `snapshotHash`, `summary`, `errors` e `warnings`.
Cada registro recebe `identity`, `recordHash`, `errors` e `warnings`; cada cobertura
recebe `collectedCount`, `complete`, `errors` e `warnings` calculados.

Cada registro também recebe `promotionBlockers` e `disposition`:

| Disposition | Significado |
| --- | --- |
| `candidate` | A captura é coerente; ainda exige validação do destino, vínculos explícitos e confirmação antes de promover |
| `archived` | Dados preservados em auditoria de origem; nenhuma promoção financeira ou movimento de caixa é inferido |
| `blocked` | Há erro na captura ou condição que o destino ainda não representa |

Baixas, contas, movimentos e índices são preservados como evidências separadas.
Arquivar essas entidades não significa lançar pagamento nem alterar saldo bancário.
`summary` retorna contagens de registros, identidades únicas, erros, arquivos e
pendências de promoção, separadas por entidade. Também informa coberturas completas,
incompletas e ausentes; totais monetários de recebíveis, contas a pagar e baixas são
strings exatas, com `totalsComplete=false` quando há erro, ambiguidade ou cobertura
financeira incompleta. Totais parciais não são prova de completude.

`canonicalEobraJson(value)` serializa JSON com chaves de objeto ordenadas.
`hashEobraValue(value)` aplica SHA-256 sobre essa representação. O hash de registro
inclui identidade, vínculos ordenados, dados brutos e normalizados; não inclui os
erros derivados. A ordem das propriedades, registros e links não altera os hashes.
A ordem de arrays dentro de dados brutos ou normalizados é preservada.

Entrada inválida gera mensagens em português na inspeção. Não se executam código,
fórmulas, URLs, instruções textuais ou chamadas à origem. Não devem constar cookies,
senhas, tokens ou cabeçalhos de autenticação no pacote.

O núcleo local aceita até 200 MiB de JSON UTF-8 e 100.000 registros. O transporte
multipartes usa manifesto de até 2 MiB e partes de até 2 MiB/500 registros; a rota
legada de arquivo único continua com limite próprio de 50 MiB. A profundidade máxima
é 40; objetos têm no máximo 10.000 chaves; arrays, 100.000 itens; cada registro tem
no máximo 2.000 relações. Valores não representáveis em JSON, getters, ciclos,
inteiros numéricos sem precisão e conteúdo além dos limites são rejeitados. Os
limites encerram a inspeção com erro, sem truncar silenciosamente a captura.
