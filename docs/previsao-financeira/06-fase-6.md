# Previsão financeira — Fase 6: rateio dos títulos e previsão pelas parcelas do contrato

## 1. Títulos sem medição entram no serviço certo

Antes, um título só era ligado a um serviço quando vinha de uma medição de contrato. Notas fiscais,
notas manuais e títulos avulsos ficavam em **"Sem serviço vinculado"** e não abatiam o saldo dos
serviços — o saldo continuava inteiro em "a comprometer" (dupla contagem com o realizado).

Agora a ordem é:

1. título ligado a medição → rateio pelos itens da medição (como antes, mantém o vínculo com o contrato);
2. título sem medição → rateio por `payable_cost_allocations` do próprio título (proporcional a `allocation_amount`);
3. sem rateio → continua em "Sem serviço vinculado".

Serviços que recebem gasto pelo rateio mas não estão no orçamento aparecem com o nome correto e orçamento zero.

## 2. Previsão pelas parcelas do contrato

Tabela `forecast_service_settings` (uma linha por obra + serviço), com RLS por `schedule.view` / `schedule.manage`:

| financial_mode | Comportamento |
| --- | --- |
| `schedule` (padrão) | saldo do orçamento distribuído pelo cronograma do serviço |
| `payment_plan` | gasto previsto = parcelas lançadas no contas a pagar (pagas na data do pagamento, abertas no vencimento). "A comprometer" fica zero; a diferença para o orçamento aparece como desvio. |

O cronograma continua controlando o prazo e o avanço físico do serviço; só a camada financeira muda.

Tela: **Engenharia → Previsão Financeira por Serviço**, coluna **Previsão**, botão "Usar parcelas" / "Usar cronograma".
Aviso `payment_plan_without_installments` quando o serviço está marcado mas não tem parcelas lançadas.

Primeiro uso (18/10/2026, Flow Aptos): 10.01 Janelas em alumínio (Liv Esquadrias, 18 parcelas) e 21.01 Elevadores (Elo Elevadores, 27 parcelas).

## Testes

`lib/forecast/engine.test.mjs`: parcelas sem distribuição pelo cronograma, aviso sem parcelas, padrão continua pelo cronograma.
