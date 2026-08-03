# Previsão financeira — Fase 2: curva viva

## Objetivo

Transformar a tela de Curvas Física e Financeira em uma visão que preserve a linha de base original e, ao mesmo tempo, reflita reprogramações, medições e custos reais já registrados no módulo de execução.

A Fase 2 não cria tabelas, não altera dados persistidos e não modifica o fluxo de registro das medições. Ela apenas lê:

- `engineering_schedule_activities`;
- `engineering_schedule_progress_measurements`;
- orçamento, serviços e linha de base já usados na Fase 1.

## Três visões da curva

### Baseline

É o plano original congelado.

Usa:

- `planned_start`;
- `planned_finish`;
- custo atribuído pela Fase 1;
- calendário de dias úteis da linha de base.

As medições não alteram essa série.

### Previsão atual

Representa a melhor estimativa disponível na data de consulta.

Para cada atividade:

```text
previsão atual = realizado reconhecido + saldo físico futuro valorizado pelo orçamento
```

O saldo futuro é calculado por:

```text
saldo futuro = custo atribuído × (1 − progresso físico acumulado)
```

A previsão nunca utiliza `custo atribuído − custo realizado` como saldo. Assim, um estouro já ocorrido não reduz artificialmente o custo necessário para concluir o físico restante.

Exemplo:

```text
Custo atribuído: R$ 100.000
Progresso: 50%
Custo realizado: R$ 70.000
Saldo futuro: R$ 100.000 × 50% = R$ 50.000
Previsão atual final: R$ 70.000 + R$ 50.000 = R$ 120.000
Desvio previsto: +R$ 20.000
```

### Realizado

É construído pelas medições acumuladas registradas para cada atividade.

Como `progress_percent` e `actual_cost` são acumulados, o valor de cada competência é obtido pela diferença entre a medição atual e a anterior.

```text
progresso do período = progresso acumulado atual − progresso acumulado anterior
custo do período = custo acumulado atual − custo acumulado anterior
```

Quando ainda não existe custo real informado, o realizado financeiro é estimado por:

```text
custo estimado do período = custo atribuído × variação do progresso físico
```

## Datas usadas na previsão atual

A última medição disponível até a data de consulta define o estado da atividade.

Ordem de uso para o início:

1. `current_start` da última medição;
2. `actual_start`, quando aplicável;
3. `planned_start` da baseline.

Ordem de uso para o término:

1. `current_finish` da última medição;
2. `planned_finish` da baseline.

Como `current_start` e `current_finish` são obrigatórios no registro atual, normalmente eles serão a fonte efetiva da reprogramação.

## Regras por situação da atividade

### Sem medição

Quando não existe nenhuma medição na obra, a tela reproduz exatamente a curva da Fase 1 e mostra:

> Sem dados de execução — mostrando apenas o plano.

Quando já existem medições na obra, uma atividade sem histórico é tratada como não iniciada e seu custo integral permanece no saldo futuro, usando as datas disponíveis.

### Não iniciada

O custo integral e o peso físico integral são distribuídos entre as datas atuais, em dias úteis.

### Em andamento

A parcela executada permanece nos meses das medições.

O saldo físico é distribuído entre a data de consulta e o término reprogramado:

```text
saldo físico = 1 − progresso acumulado
saldo financeiro futuro = custo atribuído × saldo físico
```

### Concluída

Uma atividade é considerada concluída quando:

- `progress_percent >= 100`; ou
- `actual_finish` está preenchido.

Nenhum custo ou progresso futuro é gerado para ela.

Se `actual_finish` estiver preenchido com progresso inferior a 100%, o complemento físico é reconhecido na competência da última medição para encerrar a atividade.

## Regra de preservação do passado

Meses anteriores à competência atual são formados exclusivamente pelas medições existentes.

A reprogramação altera somente o saldo futuro. O sistema não redistribui teoricamente o realizado para meses passados.

Correções que reduzam progresso ou custo acumulado aparecem como valores negativos na competência da correção. O histórico anterior não é reescrito.

## Custo real informado tardiamente

O campo `actual_cost` é acumulado e possui valor padrão zero. Portanto, não existe distinção estrutural entre “não informado” e “realmente zero”.

Enquanto o custo permanece zerado, a curva estima o realizado pelo progresso físico. Quando aparece o primeiro valor positivo depois de medições anteriores com progresso, a diferença necessária para conciliar o acumulado é lançada integralmente naquele mês.

A tela mostra o aviso:

> Custo real informado tardiamente.

Esse aviso indica que a competência pode estar inflada pela conciliação tardia do acumulado, e não necessariamente por gasto ocorrido somente naquele mês.

## Distribuição no calendário

Baseline, previsão atual e saldo futuro usam as regras da Fase 1:

- domingo não conta;
- sábado conta somente quando `work_on_saturday = true`;
- a fração mensal usa dias úteis do intervalo;
- intervalos sem nenhum dia útil são alocados integralmente no mês inicial e geram aviso.

## Indicadores de desvio

A tela apresenta:

### Desvio no marco de 50%

Diferença, em meses, entre a primeira competência em que a baseline atinge 50% físico e a primeira competência em que a previsão atual atinge 50%.

### Desvio no término

Diferença, em meses, entre o término físico da baseline e o término físico da previsão atual.

### Desvio financeiro até a competência atual

```text
desvio financeiro = realizado ou estimado acumulado − baseline acumulada
```

Valor positivo indica execução financeira acima do plano até a data.

## Tela

A rota `/engenharia/curvas` passa a apresentar:

- selo de curva viva com a data de corte;
- aviso quando não há medições;
- cartões de previsão atual, atraso e desvio financeiro;
- gráfico físico com Baseline, Previsão atual e Realizado;
- gráfico financeiro com Baseline, Previsão atual e Realizado/estimado;
- desembolso mensal com as três séries;
- tabela mensal com físico acumulado, financeiro mensal e financeiro acumulado para as três visões;
- valores negativos destacados para correções;
- aviso de custo real informado tardiamente.

## Funções puras

A lógica permanece em:

```text
app/engenharia/curvas/curve-calculations.mjs
```

Funções principais:

- `assignActivityCosts()`;
- `buildCurves()`;
- `buildLiveCurves()`;
- `calculateCurveDeviations()`;
- `detectIntegrityAlerts()`.

As declarações TypeScript ficam em:

```text
app/engenharia/curvas/curve-calculations.d.mts
```

## Testes

A suíte cobre as regras da Fase 1 e acrescenta:

- atividade atrasada deslocando custo futuro;
- atividade concluída sem previsão futura;
- atividade com 40% executado e 60% de saldo físico;
- estouro realizado preservado na previsão final;
- obra sem medições reproduzindo exatamente a Fase 1;
- custo real informado tardiamente;
- correções negativas no mês da medição.

Arquivo:

```text
app/engenharia/curvas/curve-calculations.test.mjs
```

Comando:

```bash
npm test
```

## Arquivos alterados

- `app/engenharia/curvas/page.tsx`;
- `app/engenharia/curvas/curve-calculations.mjs`;
- `app/engenharia/curvas/curve-calculations.d.mts`;
- `app/engenharia/curvas/curve-calculations.test.mjs`;
- `app/curves.css`;
- `docs/previsao-financeira/02-fase-2.md`.

## Banco de dados e implantação

Nesta fase:

- nenhuma tabela foi criada;
- nenhuma migration foi criada;
- nenhum registro existente foi alterado;
- o formulário de medição não foi modificado;
- o fluxo de caixa financeiro não foi modificado;
- não houve deploy de produção.

## Limitações mantidas para fases posteriores

- `actual_cost = 0` não diferencia custo não informado de custo real zero;
- custo real tardio não é redistribuído retroativamente;
- a curva ainda não incorpora pedidos, contratos, contas a pagar, prazo de pagamento ou estoque;
- a previsão futura continua valorizada pelo orçamento, sem produtividade financeira específica;
- feriados não são tratados, apenas domingos e a regra de sábado da linha de base.
