# Fase 5 — memória de previsão por snapshots

## Objetivo

A Fase 5 preserva o resultado do motor unificado da Fase 4 para responder perguntas como:

- o que a obra previa em determinado mês;
- quanto o custo final projetado mudou entre dois congelamentos;
- quanto estava previsto para um mês encerrado e quanto foi efetivamente pago;
- quando o desvio contra o orçamento começou a aparecer.

O snapshot não contém uma nova fórmula. Ele persiste o resultado produzido por `lib/forecast/engine.mjs` e carregado por `lib/forecast/server.ts`.

## Infraestrutura automática

O repositório não possuía infraestrutura de agendamento mensal:

- não havia `pg_cron`;
- não havia Supabase Edge Function;
- não havia cron do Vercel;
- não havia workflow GitHub com gatilho `schedule`.

Por isso, esta fase implementa somente o botão manual **Congelar previsão do mês**. O campo `source` aceita `automatic` para uma evolução futura, mas nenhuma infraestrutura nova de agendamento foi criada.

## Tabelas

### `forecast_snapshots`

Cabeçalho imutável do congelamento.

Principais campos:

- `company_id` e `project_id`;
- `baseline_id` e `budget_id` usados pelo motor;
- `reference_month`: competência do snapshot, sempre no primeiro dia do mês;
- `forecast_as_of_date`: data de corte da previsão;
- `captured_at`: instante exato do congelamento;
- `source`: `manual` ou `automatic`;
- `created_by`;
- total do orçamento;
- totais realizado, comprometido e a comprometer;
- custo final projetado e desvio;
- prazo padrão de pagamento utilizado;
- versão do motor;
- rótulos congelados da baseline e do orçamento;
- avisos de integridade;
- campos de arquivamento.

As seguintes identidades são validadas no banco:

```text
custo final projetado = realizado + comprometido + a comprometer
```

```text
desvio = custo final projetado − orçamento
```

### `forecast_snapshot_rows`

Cada linha representa:

```text
snapshot + serviço + mês + camada + valor
```

Camadas permitidas:

- `actual`;
- `committed`;
- `to_commit`.

Além do `service_id`, são congelados `service_key`, código, nome e orçamento do serviço. Assim, renomear um serviço futuramente não reescreve o histórico.

Custos sem serviço usam `service_id` nulo e mantêm a chave especial produzida pelo motor.

## Geração manual

Na rota:

```text
/engenharia/previsao-financeira
```

foi incluído o botão **Congelar previsão do mês**.

Fluxo:

1. a ação exige `schedule.manage`;
2. recarrega o motor unificado na data atual de São Paulo;
3. interrompe a gravação se alguma fonte do motor falhar;
4. transforma o resultado por serviço e mês nas três camadas;
5. chama `create_forecast_snapshot`;
6. a função grava cabeçalho e linhas na mesma transação;
7. a soma das linhas é comparada aos totais recebidos;
8. qualquer erro desfaz todo o snapshot.

Snapshots manuais não podem ser retroativos. O banco exige:

```text
reference_month = primeiro dia do mês atual
forecast_as_of_date = data atual
```

Podem existir vários snapshots na mesma competência. O instante `captured_at` diferencia congelamentos feitos antes e depois de uma revisão importante.

## Imutabilidade

A imutabilidade é garantida no banco, não apenas na interface.

### Cabeçalho

Depois de criado, nenhum campo financeiro, referência ou metadado pode ser alterado. A exclusão também é bloqueada.

A única transição permitida é:

```text
ativo → arquivado
```

O arquivamento apenas preenche `archived_at` e `archived_by`. A interface não oferece restauração.

### Linhas

`forecast_snapshot_rows` não permite atualização nem exclusão. As linhas são inseridas somente pela função transacional de criação.

Alterar contratos, medições, payables, orçamento ou cronograma depois do congelamento não modifica o snapshot.

## Multiempresa e RLS

As duas tabelas possuem `company_id` e RLS.

Leitura:

```text
schedule.view ou schedule.manage
```

Criação e arquivamento:

```text
schedule.manage
```

Triggers também validam que:

- a obra pertence à empresa;
- baseline e orçamento pertencem à mesma empresa e obra;
- a linha pertence ao mesmo snapshot, empresa e obra;
- o serviço pertence à empresa.

Não existe permissão de inserção, edição ou exclusão direta para o papel `authenticated`. As escritas válidas passam pelas funções transacionais.

## Histórico de previsões

Nova rota:

```text
/engenharia/previsao-financeira/historico
```

A tela oferece:

- lista dos snapshots;
- filtros de competência, origem e arquivamento;
- usuário e instante do congelamento;
- baseline e orçamento congelados;
- custo final e desvio de cada registro;
- arquivamento sem exclusão;
- comparação entre Snapshot A e Snapshot B por serviço;
- comparação do Snapshot A com o realizado atual;
- gráfico da evolução do custo final projetado e do orçamento.

## Comparação entre dois snapshots

Para cada serviço, a tela mostra lado a lado:

- orçamento;
- realizado;
- comprometido;
- a comprometer;
- custo final projetado;
- desvio.

A variação é calculada por:

```text
variação = valor do Snapshot B − valor do Snapshot A
```

As comparações ficam em funções puras de `lib/forecast/snapshot-comparison.mjs` e não são duplicadas na página.

## Snapshot versus realizado atual

Para cada competência:

```text
previsto no snapshot = realizado + comprometido + a comprometer congelados no mês
```

```text
desvio em R$ = realizado atual − previsto no snapshot
```

```text
desvio % = desvio em R$ ÷ previsto no snapshot × 100
```

Quando o previsto é zero, o percentual é exibido como não aplicável.

Somente meses anteriores ao mês atual entram no indicador consolidado de precisão. O mês atual aparece como **em andamento** e meses posteriores aparecem como futuros.

## Evolução do custo final

Cada ponto do gráfico usa os totais armazenados no cabeçalho:

- eixo horizontal: `captured_at` / competência;
- série principal: `projected_cost_total`;
- série de referência: `budget_total`.

Como os totais são congelados, o gráfico representa a história real das decisões e revisões da obra.

## Testes

### Funções puras

Arquivo:

```text
lib/forecast/snapshot-comparison.test.mjs
```

Casos cobertos:

- consolidação correta das três camadas;
- orçamento repetido nas linhas não é multiplicado;
- migração de valores entre camadas na comparação;
- valores congelados permanecem independentes de dados operacionais posteriores;
- comparação mensal com o realizado;
- percentual nulo quando a previsão era zero;
- ordenação cronológica da evolução.

### Banco

Arquivo:

```text
supabase/tests/20260803_0077_forecast_snapshots_rls.sql
```

Valida:

- isolamento entre empresas;
- bloqueio de escrita direta;
- bloqueio de referências cruzadas;
- impossibilidade de editar ou excluir cabeçalho e linhas;
- arquivamento permitido;
- impossibilidade de restaurar pela escrita direta;
- fechamento entre linhas e total congelado.

## Arquivos principais

- `supabase/migrations/20260803_0077_forecast_snapshots.sql`;
- `supabase/tests/20260803_0077_forecast_snapshots_rls.sql`;
- `lib/forecast/snapshot-comparison.mjs`;
- `lib/forecast/snapshot-comparison.d.mts`;
- `lib/forecast/snapshot-comparison.test.mjs`;
- `app/engenharia/previsao-financeira/actions.ts`;
- `app/engenharia/previsao-financeira/page.tsx`;
- `app/engenharia/previsao-financeira/historico/page.tsx`;
- `app/forecast-snapshots.css`.

## Implantação

A migration é apenas versionada na branch da Fase 5. Durante o desenvolvimento:

- nenhuma migration é executada no Supabase de produção;
- nenhum snapshot é criado retroativamente;
- nenhum dado existente é alterado;
- nenhum deploy de produção é realizado.
