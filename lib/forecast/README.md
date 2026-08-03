# Motor unificado de previsão

Este diretório contém o único motor de previsão financeira do Elos OS.

## Regra de arquitetura

- `engine.mjs`: funções puras, sem Supabase, React ou efeitos colaterais.
- `server.ts`: carrega e normaliza orçamento, cronograma, contratos, medições e payables.
- páginas de Engenharia e Financeiro apenas apresentam o resultado retornado pelo motor.

## Fronteira anti-dupla-contagem

```text
Realizado = payables pagas
Comprometido = payables abertas + compromissos ainda não faturados
A comprometer = máximo(0, orçamento − realizado − comprometido)
Projetado Engenharia no Fluxo = comprometido ainda não faturado + a comprometer
```

Payables abertas nunca entram na série `Projetado Engenharia`, pois já estão na série financeira `A realizar`.

## Fontes futuras

A interface `commitments` aceita fontes com `kind: contract` e `kind: purchase_order`. A Fase 4 implementa contratos; pedidos de compra poderão ser acrescentados sem duplicar ou reescrever as fórmulas.
