# Fase 4 — motor unificado de previsão financeira

## Objetivo

A Fase 4 elimina a separação entre a previsão da Engenharia e o Fluxo de Caixa. As duas telas passam a consumir o mesmo motor de cálculo, localizado em:

```text
lib/forecast/engine.mjs
```

O motor é composto apenas por funções puras. Consultas ao Supabase e transformação das estruturas operacionais ficam centralizadas em:

```text
lib/forecast/server.ts
```

Assim, nenhuma página contém uma versão própria das fórmulas financeiras.

## Fontes utilizadas

O carregador unificado lê:

- orçamento vinculado à linha de base;
- serviços e itens ativos do orçamento;
- atividades do cronograma;
- última medição de progresso de cada atividade;
- contratos formalizados e seus itens;
- aditivos alocados por serviço;
- medições contratuais válidas;
- itens das medições;
- contas a pagar abertas e pagas da obra.

A linha de base escolhida na tela de curvas também define a revisão de orçamento usada pelo motor.

## Três camadas

Cada serviço possui valores mensais e totais em três camadas.

### 1. Realizado

```text
realizado = soma das contas a pagar efetivamente pagas
```

A data utilizada é `paid_at` e o valor é `paid_amount`, com fallback para `amount`.

Quando a conta foi gerada por uma medição contratual, o pagamento é distribuído entre os serviços da medição proporcionalmente ao valor bruto de seus itens.

Contas da obra sem vínculo com uma medição aparecem em uma linha separada chamada **Sem serviço vinculado**. Elas nunca são escondidas nem reduzem arbitrariamente o saldo de um serviço do orçamento.

### 2. Comprometido

A camada comprometida possui duas parcelas explícitas:

```text
comprometido = payables abertas + comprometido futuro ainda não faturado
```

#### Payables abertas

Medições aprovadas que já geraram conta a pagar entram pela data de vencimento da própria payable.

```text
comprometido payable = valor da conta aberta
```

#### Contrato ainda não faturado

Para cada contrato e serviço:

```text
valor contratado do serviço =
itens do contrato
+ aditivos alocados ao serviço
```

```text
saldo não medido =
máximo(0, valor contratado do serviço − valor bruto aprovado do serviço)
```

O saldo não medido é distribuído pelo cronograma atualizado do serviço e deslocado pelos dias de pagamento do contrato.

#### Retenções e descontos já medidos

O valor bruto aprovado pode ser maior que a soma do que já foi pago e da payable aberta. Essa diferença contém retenções e outros valores ainda não representados por saída de caixa.

```text
resíduo aprovado =
máximo(0, medido bruto aprovado − realizado pago − payable aberta)
```

Esse resíduo permanece comprometido e é projetado no encerramento do contrato, acrescido do prazo de pagamento. Isso evita que uma retenção volte incorretamente para a camada “a comprometer”.

### 3. A comprometer

A camada é sempre calculada por subtração:

```text
a comprometer =
máximo(0, orçamento do serviço − realizado − comprometido)
```

Ela nunca é calculada como uma nova soma independente.

Quando um contrato é ativado, seu valor reduz exatamente essa camada. Quando uma medição gera payable, o valor migra do comprometido futuro para payables abertas. Quando a payable é paga, migra para realizado.

## Custo final e desvio

```text
custo final projetado =
realizado + comprometido + a comprometer
```

```text
desvio projetado =
custo final projetado − orçamento
```

```text
desvio percentual =
desvio projetado ÷ orçamento × 100
```

Se realizado e comprometido já ultrapassarem o orçamento:

- `a comprometer` fica igual a zero;
- o custo final permanece acima do orçamento;
- o desvio aparece em vermelho.

O estouro nunca reduz artificialmente o custo restante.

## Distribuição pelo cronograma atualizado

O perfil futuro de cada serviço é calculado com as atividades vinculadas ao serviço.

Para cada atividade:

1. usa o progresso físico acumulado mais recente;
2. remove a parcela já concluída;
3. usa `current_start/current_finish`, com fallback para as datas da baseline;
4. distribui o saldo pelos dias úteis futuros;
5. domingo não conta;
6. sábado obedece à configuração da linha de base;
7. o peso entre atividades do mesmo serviço usa o custo atribuído e o físico restante.

Depois da distribuição por dia de execução, cada parcela é deslocada em dias corridos pelo prazo de pagamento. O deslocamento é feito no nível diário, permitindo tratar corretamente viradas de mês.

## Prazo padrão da obra

Foi adicionado em `projects`:

```text
forecast_default_payment_days integer default 30
```

O campo aceita de 0 a 365 dias e é aplicado apenas à camada **a comprometer**.

Contratos continuam usando seu próprio `payment_days`.

A configuração pode ser alterada em:

```text
/engenharia/previsao-financeira
```

## Fronteira com o Fluxo de Caixa

O Fluxo de Caixa já possui payables abertas na série **A realizar**. Portanto, a nova série segue obrigatoriamente esta fórmula:

```text
Projetado Engenharia =
comprometido futuro ainda não faturado
+ a comprometer
```

Payables abertas são excluídas dessa série.

```text
saldo projetado completo =
saldo projetado atual − Projetado Engenharia
```

A fronteira está declarada no retorno do motor:

```text
openPayablesExcludedFromEngineeringProjected = true
engineeringProjectedFormula = committedFuture + toCommit
```

## Tela de Curvas

Em `/engenharia/curvas`:

- a curva física continua usando a lógica da Fase 2;
- a baseline financeira permanece congelada;
- a linha financeira **Previsão atual** passa a usar a soma das três camadas;
- a linha **Realizado** passa a representar pagamentos efetivos;
- a composição mensal mostra realizado, comprometido e a comprometer;
- a tabela mensal separa payables abertas do comprometido ainda não faturado.

## Fluxo de Caixa

Em `/financeiro/fluxo-de-caixa`:

- permanece a série de payables cadastradas em **A realizar**;
- é adicionada a série **Projetado Engenharia**;
- é adicionado o cartão **Saldo projetado completo**;
- o gráfico mensal mostra a nova série sem duplicar payables.

A projeção da Engenharia é apresentada quando uma obra está selecionada.

## Previsão por serviço

Nova rota:

```text
/engenharia/previsao-financeira
```

A tela apresenta:

- orçamento;
- realizado;
- comprometido;
- payables abertas dentro do comprometido;
- comprometido futuro não faturado;
- a comprometer;
- custo final projetado;
- desvio em reais e percentual;
- composição mensal;
- totais da obra;
- avisos de fontes sem serviço e serviços sem cronograma futuro.

## Materiais

Nesta fase não existe fonte de pedido de compra.

Por isso, materiais sem contrato permanecem integralmente na camada **a comprometer**, distribuídos pelo orçamento e pelo cronograma.

A interface do motor aceita fontes genéricas:

```text
kind: contract | purchase_order
```

Assim, pedidos de compra poderão entrar futuramente na camada comprometida sem mudar as fórmulas nem as telas consumidoras.

## Testes

Arquivo:

```text
lib/forecast/engine.test.mjs
```

Casos cobertos:

1. serviço sem contrato fica 100% a comprometer;
2. contrato reduz exatamente a camada a comprometer;
3. medição aprovada migra para payable prevista;
4. pagamento migra para realizado;
5. soma das camadas forma o custo final;
6. payables abertas são excluídas de Projetado Engenharia;
7. estouro zera a comprometer e mantém o desvio;
8. prazo de pagamento atravessando a virada do mês;
9. fonte futura de pedido de compra usando a mesma interface do comprometido.

## Arquivos principais

- `lib/forecast/engine.mjs`;
- `lib/forecast/engine.d.mts`;
- `lib/forecast/engine.test.mjs`;
- `lib/forecast/server.ts`;
- `app/engenharia/previsao-financeira/page.tsx`;
- `app/engenharia/previsao-financeira/actions.ts`;
- `app/engenharia/curvas/page.tsx`;
- `app/financeiro/fluxo-de-caixa/page.tsx`;
- `app/forecast.css`;
- `supabase/migrations/20260803_0076_project_forecast_settings.sql`.

## Implantação

A migration é somente versionada nesta branch. Nenhum dado existente é alterado diretamente e nenhum deploy de produção é realizado durante a Fase 4.
