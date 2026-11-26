# eObra: cálculo de correção e conciliação do histórico

## Escopo

`lib/eobra-import/financial.mjs` é um módulo puro para conferir snapshots autorizados antes da promoção. Ele não consulta a origem, não escolhe índices, não lê o relógio e não altera o banco. As declarações públicas estão em `financial.d.mts`; os testes usam somente identidades e valores sintéticos.

O resultado `ok` indica consistência matemática do conjunto fornecido. Não substitui autenticação, isolamento por empresa/obra, completude da coleta, vínculo real entre venda/unidade/cliente, revisão do contrato ou regras de promoção do banco.

## Política por parcela

Cada parcela aberta e destravada precisa de `correction` explícita:

- `{ mode: "none" }`: evidência da origem de que esta parcela não é corrigida. Ausência de configuração não significa `none`.
- `{ mode: "index_number", base_month, base_value, reference_month, reference_value }`: cálculo pela razão entre dois valores de índice da mesma série, cujos vínculos são validados pelo snapshot.

As competências usam `AAAA-MM`. A base é independente da data da venda. A referência é fornecida pelo adaptador a partir da origem: o módulo não busca o último índice disponível, não aproxima competência ausente e não usa uma referência da data atual.

`lag_months` é opcional e só é aplicado como **conferência** quando fornecido. Nesse caso `calculation_month` também é obrigatório e deve satisfazer `reference_month = calculation_month - lag_months`. Omissão de defasagem não vira zero. Uma defasagem informada não autoriza derivar silenciosamente uma referência ausente.

Não há carência padrão, período de quatro meses, calendário de reajustes ou herança de configuração de outra venda. Periodicidade, aniversário, mudança após chaves, atualização proporcional e eventual piso contratual precisam ser lidos e modelados pelo fluxo de origem antes de habilitar cálculos futuros. O módulo calcula uma referência explícita; não implementa um agendador contratual.

Uma venda pode ter parcelas `none` e `index_number`. Nenhuma configuração é propagada automaticamente para as demais parcelas da mesma venda.

### Tratamento explícito de variação negativa

`negative_variation_policy` pode ser `use_negative` ou `maximum_of_period`. Omissão permite apenas conferir a razão dos dois valores fornecidos; não declara uma regra contratual para períodos futuros.

Para `maximum_of_period`, `index_values` deve conter `{ reference_month, value }` para **todos os meses da base até a referência, inclusive**. O módulo verifica igualdade entre os valores declarados da base/referência e as respectivas competências da série, rejeita duplicatas e lacunas e usa o maior valor da janela. Valores de meses posteriores não interferem no cálculo. Em empate, informa a ocorrência mais recente do máximo.

`effective_reference_month` e `effective_reference_value` identificam o índice efetivamente usado, enquanto o snapshot conserva a referência originalmente solicitada. Assim, uma queda seguida de recuperação abaixo do pico não reduz o valor calculado pela política de máxima. Ausência da série completa bloqueia esse cálculo; não há fallback para o último índice.

A mesma série/identidade precisa ser confirmada pelo snapshot e seus vínculos. A janela calculada é base–referência; sua correspondência ao período contratual deve ser verificada na origem. Taxas fixas e regras percentuais adicionais não são transformadas em CUB nem executadas por aproximação. Um histórico travado pode conservar esses valores, com aviso de que a regra não foi validada para continuidade.

## Decimais e fórmula

Dinheiro é recebido como string decimal com ponto e até duas casas. Índices aceitam até seis casas e devem ser estritamente positivos. Números JavaScript, vírgulas locais, notação científica, campos ausentes e precisão excedente são recusados. O parser/adaptador normaliza a representação, preservando o valor bruto na coleta.

O cálculo utiliza `BigInt`:

```text
principal corrigido = arredondar_em_centavos(original × índice_referência / índice_base)
correção = principal corrigido − original
atualizado = original + correção + juros + multa + outros acréscimos − desconto
```

Há um único arredondamento `HALF_UP` no resultado final da razão. O fator não é arredondado antes de multiplicar. Valores monetários são limitados ao intervalo não negativo de `numeric(16,2)`; a correção pode ser negativa. A razão simples admite redução; o tratamento diferente só é aplicado quando a política de máxima está explicitamente informada e comprovada pela série.

`interest_amount`, `penalty_amount`, `other_accrual_amount` e `discount_amount` devem estar explícitos, inclusive `"0.00"`. O módulo não reclassifica juros como CUB, não extrai a correção como diferença residual e não converte um componente desconhecido em zero.

### Funções

| Função | Resultado |
| --- | --- |
| `calculateIndexNumberAmount` | Razão exata e correção monetária; lança erro para argumentos inválidos. |
| `calculateInstallmentCorrection` | Cálculo ou preservação de uma parcela, com `errors` e `warnings`. |
| `reconcilePaymentEvents` | Histórico de baixas/estornos sem duplicação, totais líquidos e divergências. |
| `reconcileInstallmentFinancials` | Confere política, componentes, pagamentos, saldo e situação, sem mudar a fonte. |

## Snapshots históricos

Para situação `paid`, `cancelled` ou `correction_locked=true`, `current_amount` e `correction_amount` são obrigatórios e conservados. A série corrente não substitui esses valores, mesmo que o snapshot atualizado seja zero. Snapshot ausente ou divergente dos componentes gera erro, sem reconstrução silenciosa.

A política de uma parcela histórica não é executada nem validada para uso futuro; o resultado traz um aviso explícito. Assim é possível conservar o histórico enquanto a configuração contratual ainda está sendo conferida, sem tratá-la como validada.

`source_snapshot` é uma cópia independente do argumento original. Valores fornecidos, inclusive os que causam erro, continuam disponíveis para revisão. Os resultados esperados aparecem em campos próprios, como `expected_current_amount` e `computed_balance_amount`.

## Eventos de recebimento e estorno

`reconcilePaymentEvents` recebe:

```js
{
  paid_amount: "35.00",
  events_complete: true,
  events: [
    { source_id: "pagamento-a", kind: "payment", amount: "40.00", occurred_on: "2022-04-15" },
    { source_id: "estorno-a", kind: "reversal", amount: "5.00", occurred_on: "2022-04-16", reverses_source_id: "pagamento-a" }
  ]
}
```

O exemplo é sintético. `medium` (`bank`, `cash`, `non_cash`, `unknown`) e `account_source_id` são opcionais e não são inferidos.

O adaptador deve fornecer **um único histórico de parcela por chamada**, isolado por ambiente, empresa e identidade do título. Deve verificar também que um ID de evento não aparece vinculado a parcelas diferentes e que os eventos pertencem à data de corte da coleta.

`events_complete=true` deve vir da conferência da coleta/paginação e do manifesto no servidor. Não basta um booleano enviado pelo cliente. Uma lista vazia também é explícita. Históricos incompletos não produzem um total líquido apresentado como confiável.

As regras são:

1. IDs são texto estável, conservando zeros à esquerda.
2. Valores dos eventos são positivos; `kind` determina adição ou subtração.
3. Repetição idêntica do mesmo ID conta uma vez e gera aviso.
4. Mesmo ID com valor, data, tipo, vínculo ou meio diferente bloqueia a conciliação.
5. Estorno referencia uma baixa existente no mesmo histórico e não pode anteceder sua data.
6. A soma dos estornos de uma baixa não pode superar seu valor.
7. Referência a outro estorno, baixa ausente e tipos como atualização monetária no lugar de pagamento são recusados.
8. Soma das baixas menos soma dos estornos deve corresponder exatamente a `paid_amount`.

Não há correspondência por nome, valor aproximado ou posição na exportação. A ordem dos eventos no arquivo não muda a conciliação. Até 10.000 eventos podem ser conferidos por parcela.

### Pagamento explicitamente estornado sem data civil válida do estorno

A origem pode identificar um pagamento como estornado, manter sua data original válida e fornecer uma data inválida para o evento de estorno. Nessa situação, o adaptador pode usar `kind: "voided_payment"`, preservando o valor positivo e a data do pagamento original, com `voided_by_source_id` e `voided_date_unknown: true`. A decisão precisa de evidência explícita da origem; um erro de data em um estorno comum não provoca essa conversão.

O snapshot exige um link `voided_by` para o `raw_archive` tipado que conserva o estorno original e sua data bruta, com ID igual ao declarado. Caso o arquivo tenha link inverso `original_payment`, esse vínculo deve apontar ao pagamento anulado. Não é permitido subtrair esse pagamento outra vez com um evento `reversal`.

`voided_payment` tem efeito financeiro zero. `voided_amount` e `voided_event_count` preservam o volume histórico no resultado puro; o resumo do snapshot usa `voided_count`. A soma líquida continua sendo pagamentos efetivos menos estornos datados. Um pagamento substituto permanece um evento independente, incluindo meios não bancários.

`history_dates_complete=false` informa que o histórico temporal do estorno está incompleto, mesmo quando `totals_complete=true` e o saldo confere. O snapshot expõe essa indicação em `summary.history_dates_complete` e `summary.settlements.history_dates_complete`. A cobertura da coleta pode estar completa: não se inventa data, não se usa a data do pagamento como data do estorno e não se cria movimentação bancária para preencher a lacuna.

## Saldos, parciais e cancelamentos

O saldo deve satisfazer `balance_amount = current_amount - paid_amount`, sem tolerância que esconda centavos. Pago maior que atualizado sinaliza crédito excedente a tratar explicitamente.

As situações `open` e `partial` podem representar saldo positivo com recebimento líquido positivo. Nesse caso o resultado inclui:

```js
{
  canonical_status: "open",
  settlement_state: "partial",
  requires_partial_support: true
}
```

Isso não autoriza promoção em um modelo que ainda não tenha leituras e baixas parciais corretas. Não deve chamar a RPC legada que quita integralmente o título. Não deve reduzir o principal ao saldo ou desdobrar parcelas sem evidência dos títulos-pai/filho da origem. O principal e a base CUB continuam preservados.

Quitadas precisam de saldo zero; `partial` precisa de pago e saldo positivos. Em canceladas, `balance_amount` é o saldo histórico observado e pode continuar positivo, desde que seja exatamente `current_amount - paid_amount`. `computed_balance_amount` conserva esse saldo, enquanto `collectible_balance_amount` é zero pelo estado `cancelled`. Esse histórico não gera cobrança, previsão ou nova correção. O módulo não inventa desconto nem reduz o principal para zerar o saldo histórico. Um abatimento efetivamente capturado deve aparecer nos componentes; valores que não reconciliam continuam com erro.

Uma cancelada pode ter baixas parciais ou históricas integrais. Quando os eventos líquidos conferem, a situação de cancelamento não apaga o recebimento/pagamento histórico. A promoção preserva esses valores e os leitores incluem somente os eventos efetivos no realizado; os títulos cancelados continuam excluídos do saldo exigível. Isso exige uma classificação inequívoca de cancelamento na origem e não converte uma parcela estornada em quitada.

Os resumos de migração mantêm `balance_amount` como soma histórica e publicam `collectible_balance_amount` separado, excluindo canceladas. A revisão mostra as duas colunas. Valores não interpretados geram aviso de totais parciais por carteira, sem apresentar essa soma como completa.

Nenhuma dessas funções cria movimentação bancária. Eventos históricos importados e movimentos operacionais do banco devem permanecer separados até que o vínculo bancário tenha sido validado.

## Suporte nativo a parciais e histórico

A migration local `20261126151453_finance_partial_settlements.sql` prepara o modelo e suas leituras. Ela não representa aplicação em produção.

Contas a pagar conservam `amount` nominal e recebem componentes explícitos: `installment_interest_amount`, `correction_amount`, `late_fee_amount`, `other_accrual_amount` e `discount_amount`. `adjusted_amount` é gerado pela composição e não pode ser gravado pelo importador. Os componentes padrão zero preservam o comportamento de títulos legados. Nas duas carteiras, o saldo exigível de título aberto é `max(adjusted_amount - paid_amount, 0)`, com fallback para o nominal somente no legado sem atualizado. O helper de leitura retorna `historical_balance_amount` sem apagar o residual de canceladas; `remaining_amount` continua zero para essas parcelas. As telas mostram ambos os saldos quando o título está cancelado.

Uma parcela parcialmente recebida continua canonicamente `open`, com valor pago acumulado e saldo residual. A trava de correção é mantida: sem amortização contratual comprovada, pagamentos parciais não autorizam recalcular o principal inteiro por um índice novo. Cancelar diretamente um título com baixa líquida é recusado, preservando o histórico para tratamento explícito.

As novas sobrecargas de sete argumentos de `receive_finance_receivable` e `pay_finance_payable` recebem `p_request_id` UUID estável por intenção. Elas acumulam a baixa, mantêm o título aberto até saldo zero e gravam uma movimentação operacional por evento. Retry idêntico retorna o mesmo evento mesmo depois da quitação; reutilizar a intenção com outro título, valor, data, conta ou usuário é recusado. Os formulários enviam a mesma intenção na repetição do envio. As versões legadas de seis argumentos conservam quitação integral do saldo restante e recusam parcial sem intenção estável.

O retry verifica novamente a permissão atual da carteira e a relação empresa/obra/conta/SPE antes de retornar o ID. A permissão operacional permanece a mesma do contrato nativo: não se acrescenta exigência de leitura administrativa de contas. Uma conta posteriormente inativada pode continuar consultável no replay já concluído, mas rejeita uma nova baixa. O helper interno não é executável por `PUBLIC`, `anon` ou `authenticated`; somente os pontos operacionais autorizados o invocam.

`finance_title_payment_events(company, project, kind, ids)` oferece o histórico por data com autorização da carteira ou de relatórios, sem exigir acesso administrativo aos arquivos importados. O retorno reúne baixas históricas de origem, baixas nativas e o fallback de snapshot legado quando não existe histórico de eventos. O fallback não reconstrói várias baixas na última data. Eventos `voided_payment` retornam como marcador de valor zero com `history_dates_complete=false`; os leitores conservam o aviso e não os somam no realizado.

O ledger histórico não altera saldo bancário. A ponte `bank_transaction_id` da origem permanece desabilitada por restrição própria. Os leitores têm regra de deduplicação para uma eventual ponte futura validada, sem ativá-la por conta própria. `medium` preserva a distinção entre banco, caixa e liquidação não bancária; o histórico de quitação não representa, por si só, extrato bancário.

As telas de carteiras, detalhe da venda, fluxo, relatórios e dashboard, além dos resumos comerciais, apropriações e Elos IA, usam saldo residual e eventos datados. Leituras totais são paginadas; divergência de histórico é sinalizada e não é substituída por um agregado sem data. O detalhe da venda mostra todas as unidades vinculadas, identifica a principal e conserva um único total contratual, sem dividir valores ausentes entre imóveis.

## Verificação

```sh
node --test tests/imports/eobra-financial.test.mjs
node --test tests/imports/eobra-snapshot.test.mjs tests/finance/partial-*.test.mjs
npx eslint lib/eobra-import/financial.mjs lib/eobra-import/financial.d.mts tests/imports/eobra-financial.test.mjs
```

Os testes exercitam centavos acima da precisão segura de `Number`, meia unidade de centavo, precisão de seis casas dos índices, ausência de configuração, competência/defasagem explícitas, parcelas sem correção na mesma lógica, preservação histórica, múltiplas baixas, estornos, replays, conflitos, parciais, cancelamentos e pureza das funções. Exemplos observados em uma origem devem ser conferidos fora do repositório e não substituem a leitura da regra contratual completa.
