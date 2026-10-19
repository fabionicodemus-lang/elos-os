# Centros de custo de incorporação

Custos do empreendimento que não são obra ganham centros de custo próprios, com apropriação direta
(notas, títulos) e orçado vindo do estudo de viabilidade aprovado (baseline).

| Centro | Nome | Orçado vem de | Projeção no resultado |
| --- | --- | --- | --- |
| INC.01 | Terreno, ITBI, registro e IPTU | terreno à vista + IPTU + outros do terreno | maior entre orçado e apropriado |
| INC.02 | Outorga onerosa | outorga onerosa | maior entre orçado e apropriado |
| INC.03 | Projetos e aprovações | custo de projetos do estudo | maior entre orçado e apropriado |
| INC.04 | Comissões e corretagem | comissão do estudo | taxa do estudo × VGV, nunca abaixo do apropriado |
| INC.05 | Marketing e vendas | marketing | maior entre orçado e apropriado |
| INC.06 | Impostos da incorporação (RET/PIS/COFINS) | impostos do estudo | taxa do estudo × VGV, nunca abaixo do apropriado |
| INC.07 | Administração central | administração central | maior entre orçado e apropriado |
| INC.08 | Custo financeiro | custo financeiro | maior entre orçado e apropriado |
| INC.09 | Distratos (devoluções a clientes) | zero | apropriado |

ISS continua como custo de obra.

## Banco

- `engineering_services.development_cost_category` marca o serviço como centro de incorporação.
- `development_cost_budgets` (obra + centro): orçado, origem `feasibility` ou `manual`. RLS por
  `commercial.incorporation.view` / `commercial.incorporation.manage`.
- `apply_feasibility_development_budget(project_id)`: cria os centros que faltarem e grava o orçado do
  estudo; orçados ajustados à mão (`manual`) não são sobrescritos.

## Telas

- **Comercial → Incorporação → Resultado**: painel "Centros de custo · orçado × apropriado" (orçado,
  pago, em aberto, saldo, consumo, status e projeção), botão para gerar/atualizar pelo estudo e ajuste do
  orçado por centro.
- **Previsão Financeira** e **Custo x Orçamento** da obra ignoram a parte dos títulos rateada nesses centros.

## Títulos sem centro

Títulos sem centro (SEM-CC) podem ser de obra ou de incorporação. No resultado, eles consomem primeiro o
saldo ainda não apropriado dos centros (exceto comissões e impostos); só o que passar disso aumenta o custo.

## Primeiro uso (19/10/2026, Flow Aptos)

Orçado total R$ 6.586.074,63 (= custo total do baseline − obra). Reapropriados dos títulos SEM-CC:
outorga 27 títulos (R$ 551.355), comissões externas 13 (R$ 211.318), RET 14 (R$ 127.615), devoluções de
distrato 7 (R$ 208.000). Projetos executivos (01.02) passaram para INC.03 (27 rateios, R$ 460.989); o
item 01.02 do orçamento Rev03 e a atividade do cronograma ficaram inativos. Cópia dos registros
alterados em `elos_import.backup_rows` (motivo `reapropriacao_incorporacao_2026-10-19`).
