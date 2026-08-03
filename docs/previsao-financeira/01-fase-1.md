# Previsão financeira — Fase 1: fundações das curvas

## Objetivo

Corrigir premissas de cálculo e validações da curva física e financeira existente, sem criar tabelas, alterar dados persistidos ou mudar a arquitetura do módulo.

## Escopo implementado

### 1. Peso físico proporcional ao custo

Antes, cada atividade recebia o mesmo peso físico:

```text
peso físico = 100 / quantidade de atividades
```

Agora, quando existe custo atribuído, o peso é calculado por:

```text
peso físico da atividade =
  custo atribuído à atividade
  / soma dos custos atribuídos de todas as atividades
  × 100
```

O custo utilizado é o mesmo resultado de `assignActivityCosts()`, seja ele:

- informado diretamente em `planned_cost`; ou
- inferido a partir do custo do serviço no orçamento.

Regras de segurança:

- atividade com custo zero recebe peso físico zero;
- quando todas as atividades possuem custo zero, o sistema mantém temporariamente o peso igual por atividade;
- nesse fallback, a tela exibe o aviso **Curva física sem ponderação por custo**.

### 2. Distribuição mensal por dias úteis

Antes, a curva distribuía o custo e o físico por dias corridos, apesar de o cronograma utilizar dias úteis.

Agora, a fração mensal é:

```text
fração mensal =
  dias úteis da atividade dentro do mês
  / total de dias úteis da atividade
```

Regras usadas:

- domingo nunca é dia útil;
- sábado só é considerado quando `work_on_saturday = true` na linha de base;
- físico e financeiro utilizam a mesma fração mensal;
- quando uma atividade não possui nenhum dia útil no intervalo, 100% do custo e do peso são alocados no mês de `planned_start`;
- atividades nesse caso são informadas em aviso na tela.

### 3. Validação de nova linha de base

A criação de uma linha de base agora exige que o orçamento vinculado:

- pertença à mesma empresa;
- pertença à mesma obra;
- não esteja arquivado;
- esteja com `status = approved`;
- esteja marcado com `is_base = true`.

O conceito de **orçamento base da obra existe** no sistema, por meio dos campos `is_base` e `base_set_at` e da rotina `set_engineering_budget_base`.

Linhas de base existentes não são alteradas. Quando a linha selecionada aponta para um orçamento não aprovado, a tela de curvas exibe o selo **Orçamento não aprovado**.

### 4. Alertas de integridade

Foi adicionado o painel **Alertas de integridade**, acima dos gráficos.

O painel verifica:

1. serviços ativos do orçamento sem nenhuma atividade no cronograma;
2. serviços cujos custos explícitos programados superam o valor do orçamento;
3. atividades vinculadas a serviços ausentes da revisão do orçamento;
4. itens ativos do orçamento sem `service_id`.

Quando não há ocorrências, o painel apresenta o selo verde **Cobertura íntegra**.

Os alertas são informativos e não bloqueiam a visualização da curva.

### 5. Separação da lógica de cálculo

As funções puras foram extraídas para:

```text
app/engenharia/curvas/curve-calculations.mjs
```

As declarações TypeScript estão em:

```text
app/engenharia/curvas/curve-calculations.d.mts
```

Funções principais:

- `assignActivityCosts()`;
- `buildCurves()`;
- `detectIntegrityAlerts()`.

## Testes

Os testes unitários estão em:

```text
app/engenharia/curvas/curve-calculations.test.mjs
```

Execução:

```bash
npm test
```

Cobertura dos testes:

- ponderação física proporcional ao custo;
- fallback de peso igual quando todos os custos são zero;
- distribuição atravessando três meses sem sábado;
- distribuição atravessando três meses com sábado;
- fallback de atividade sem dia útil;
- serviço do orçamento sem atividade;
- custo explícito acima do orçamento;
- atividade com serviço ausente da revisão;
- item ativo sem serviço vinculado.

Resultado local da fase:

```text
9 testes executados
9 testes aprovados
0 falhas
```

## Arquivos alterados

- `app/engenharia/curvas/page.tsx`
- `app/engenharia/curvas/curve-calculations.mjs`
- `app/engenharia/curvas/curve-calculations.d.mts`
- `app/engenharia/curvas/curve-calculations.test.mjs`
- `app/engenharia/cronograma/actions.ts`
- `app/curves.css`
- `package.json`
- `docs/previsao-financeira/01-fase-1.md`

## Banco de dados e arquitetura

Nesta fase:

- nenhuma tabela foi criada;
- nenhuma migration foi criada;
- nenhum dado existente foi alterado;
- nenhuma integração financeira foi modificada;
- nenhuma regra do fluxo de caixa foi alterada;
- não houve deploy.

## Antes e depois

### Antes

- peso físico igual por atividade;
- distribuição mensal por dias corridos;
- linha de base aceitava qualquer orçamento não arquivado;
- inconsistências de cobertura não eram detalhadas.

### Depois

- peso físico proporcional ao custo atribuído;
- distribuição mensal por dias úteis;
- nova linha de base exige orçamento base aprovado;
- painel identifica exatamente onde o orçamento não foi distribuído ou foi superprogramado.

## Capturas de tela

Não foram incluídas capturas nesta fase porque não houve deploy e não foi utilizado um ambiente autenticado de execução. A validação visual deve ser feita no preview do Pull Request ou em ambiente local antes do merge.
