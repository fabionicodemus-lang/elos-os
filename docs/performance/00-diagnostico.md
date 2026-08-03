# 00 · Diagnóstico de performance do Elos OS

Auditoria da issue #240. Esta é uma entrega **somente de diagnóstico**: nenhuma migration foi criada, nenhuma mudança de arquitetura foi aplicada, nenhum dado real foi tocado. O objetivo é apresentar problemas, evidências, impacto, risco, esforço, números atuais, metas, a ordem recomendada de correção e a divisão em PRs pequenos, para aprovação antes de qualquer alteração de código.

- Branch de trabalho: `claude/performance-optimization`
- Data: 2026-08-03
- Estado do repositório ao final desta entrega: apenas este documento adicionado.

---

## 1. Como as medições foram feitas

Não há acesso a dados de produção, e por regra não deve haver. Para não inventar números, os valores abaixo vêm de duas fontes objetivas:

1. **Build real do projeto** (`npm run build`, Next.js 16 / Turbopack), para tamanhos de bundle, CSS e chunks de servidor.
2. **Harness de carga sobre o motor puro** (`lib/forecast/engine.mjs`) e sobre a paginação (`lib/supabase-pagination.ts`), com **dados sintéticos** gerados em memória. Mede tempo de CPU, crescimento de heap e tamanho do payload serializado.

**Limite honesto destes números:** eles provam o *mecanismo* de cada problema e a *forma* como ele escala (linear, quadrático, dependente de dado sujo). Eles **não** substituem a medição com os volumes reais do Flow e do Alma. A prioridade final de alguns itens depende de quantos serviços, atividades e — principalmente — quantas datas inválidas existem hoje no banco. Isso está sinalizado onde é decisivo.

Os scripts de medição foram usados apenas para produzir este relatório e **não fazem parte do commit**. A Etapa 2 pode convertê-los em teste de carga versionado, conforme já pede o `claude-access.md`.

---

## 2. Estado atual dos portões de qualidade

| Portão | Resultado | Observação |
|---|---|---|
| `npm test` | **42/42 aprovados** em ~2,6 s | Base de testes do motor e das curvas está verde. Qualquer otimização precisa mantê-la verde. |
| `npm run lint` | **51 problemas: 27 erros, 24 avisos** | Ver seção 8. Não são bugs de performance, mas o `claude-access.md` exige lint limpo antes de PR pronta. |
| `npm run build` | **Aprovado** em ~101 s | Passa. Emite ~1.464 KB de JS estático e ~542 KB de CSS estático. |

O build passou. (No ambiente isolado desta auditoria ele falha ao buscar fontes do Google por bloqueio de rede — isso é do ambiente, não do código; confirmado contornando localmente e revertendo em seguida.)

---

## 3. As 10 rotas mais pesadas

Ranqueadas por número de idas ao Supabase por requisição. Rotas que chamam `loadProjectForecast` recebem peso extra porque esse carregador dispara, sozinho, 13 consultas (2 + 11) e roda o motor.

| # | Rota | `fetchAllRows` | `.from()` diretos | Chama forecast | Peso |
|---|---|---:|---:|---:|---:|
| 1 | `execucao/qualidade` | 14 | 18 | — | 60 |
| 2 | `execucao/contratacoes-servicos` | 15 | 15 | — | 60 |
| 3 | `suprimentos/indicadores` | 14 | 14 | — | 56 |
| 4 | `execucao/diario-obras` | 11 | 13 | — | 46 |
| 5 | `engenharia/contratos` | 11 | 11 | — | 44 |
| 6 | `financeiro/notas-manuais` | 9 | 16 | — | 43 |
| 7 | `engenharia/previsao-financeira/historico` | 3 | 3 | 2 | 42 |
| 8 | `financeiro/fluxo-de-caixa` | 0 | 3 | 2 | 33 |
| 9 | `engenharia/previsao-financeira` | 0 | 0 | 2 | 30 |
| 10 | `engenharia/curvas` | 0 | 0 | 2 | 30 |

As rotas 8, 9 e 10 têm poucas consultas *no arquivo*, mas cada `loadProjectForecast` esconde 13 consultas ilimitadas e o motor. São elas as do incidente. As rotas 1–6 têm um problema diferente: **muitas consultas sequenciais e agregação em JavaScript** do que deveria ser um `COUNT`/`SUM` no banco.

---

## 4. Problemas encontrados

Cada item traz: evidência, impacto, risco de corrigir e esforço.

### P1 — O motor monta uma matriz densa serviços × meses, e o número de meses depende da pior data do banco

`lib/forecast/engine.mjs` gera uma célula para **cada** combinação de serviço e mês (linhas 424–477), mesmo quando o valor é zero. O conjunto de meses (`allMonthKeys`) é a união de todos os meses com qualquer movimento. O horizonte defensivo permite até **240 meses** (`MAX_FORECAST_MONTHS`, linha 2). Uma única atividade com data corrompida (ex.: início 1990, fim 2090) infla a janela de ~13 meses para 240.

**Evidência (harness, dados sintéticos, mesmos serviços/atividades, mudando só as datas ruins):**

```
600 serviços × 20 ativ., 0 datas ruins →  53 meses →  31.800 células →  7 MB de JSON de serviços
600 serviços × 20 ativ., 5 datas ruins → 240 meses → 144.000 células → 20 MB de JSON de serviços
2000 serviços × 20 ativ., 300 datas ruins → 240 meses → 480.000 células → 70 MB de JSON de serviços
```

Cinco datas inválidas **triplicam** o payload. O `serviceRows` é serializado e enviado ao cliente; somado aos arrays de origem ainda vivos no request e a requisições concorrentes, chega-se à ordem de grandeza do incidente (~1,8 GB / erro 500 em `/engenharia/curvas` e `/financeiro/fluxo-de-caixa`).

- **Impacto:** altíssimo. É a causa raiz do incidente.
- **Risco de corrigir:** médio. Duas frentes — (a) tornar a matriz esparsa preservando resultados idênticos; (b) ancorar a janela de meses no cronograma real e não na pior data. Precisa de cobertura de teste comparando saída antes/depois.
- **Esforço:** médio.

### P2 — `distributeByProfile` recalcula o mesmo perfil do serviço a cada compromisso

Para cada compromisso, o motor reconstrói toda a distribuição mensal do serviço (`engine.mjs`, `distributeByProfile`, linhas 127–198), refazendo o mesmo trabalho quando vários compromissos apontam ao mesmo serviço com o mesmo prazo.

**Evidência (harness — tudo fixo, variando só o nº de compromissos por serviço):**

```
 1 compromisso/serviço → 1.175 ms   (memória e resultado idênticos)
 4 compromissos/serviço → 2.342 ms
16 compromissos/serviço → 7.579 ms
```

Mesma memória, mesmo resultado, **6,5× mais tempo**. Trabalho puramente redundante.

- **Impacto:** alto em obras com muitos contratos por serviço.
- **Risco de corrigir:** baixo. Cache por `(serviço, prazo de pagamento)`; a regra financeira não muda, o resultado é idêntico.
- **Esforço:** baixo.

### P3 — `fetchAllRows` não tem teto e usa spread dentro do laço

`lib/supabase-pagination.ts` (26 linhas, usada em **293 pontos**) tem dois defeitos:

```ts
for (let from = 0; ; from += pageSize) {   // sem limite máximo: nunca desiste
  rows.push(...batch);                       // spread: quebra com lote grande
}
```

**Evidência (harness):**

```
   1.000 registros →   2 consultas sequenciais,   0 ms, heap +0,1 MB
  10.000 registros →  11 consultas sequenciais,   5 ms, heap +1,1 MB
 100.000 registros → 101 consultas sequenciais,  27 ms, heap +12,4 MB
 500.000 registros → 501 consultas sequenciais, 205 ms, heap +60 MB
```

Sem teto, 500 mil linhas viram **501 idas ao Supabase em série** — cada uma paga latência de rede em produção (não capturada no harness local), o que transforma isso em segundos. Além disso, `push(...batch)` estoura a pilha (`RangeError: Maximum call stack size exceeded`) com lote acima de ~130 mil itens no V8/Node 22; o laço `for` equivalente processa 500 mil em 39 ms sem risco.

- **Impacto:** alto e transversal (293 usos).
- **Risco de corrigir:** muito baixo. Adicionar teto configurável com **erro explícito** ao ultrapassar (nunca truncar em silêncio, conforme o `claude-access.md`) e trocar o spread por laço. Sem mudança de comportamento no caminho feliz.
- **Esforço:** baixo.

### P4 — `/financeiro/fluxo-de-caixa` trunca em silêncio e filtra data em JavaScript

`app/financeiro/fluxo-de-caixa/page.tsx`:

```ts
.neq("status","cancelled").order("due_date").limit(10000)   // sem filtro de data
...
.filter((entry) => !dateFrom || entry.effectiveDate >= dateFrom)   // filtra em JS, depois
```

Dois problemas distintos, um deles **financeiro, não de performance**:

1. **`.limit(10000)` trunca sem avisar.** Passando de 10 mil contas a pagar (ou a receber), o fluxo de caixa fica **incorreto** e ninguém é alertado. O `claude-access.md` proíbe truncamento silencioso de valores financeiros. Por isso este item sobe no ranking: é risco de correção do número, não só de velocidade.
2. **O período escolhido pelo usuário não vai ao banco.** A página sempre baixa até 20 mil registros com joins aninhados (`suppliers`, `clients`, `units`, `sales`), monta 20 mil objetos e mostra 50 (`PAGE_SIZE`). O filtro de data é aplicado em memória depois.
3. **Consulta duplicada de `payables`:** a página busca `payables` e, em paralelo, chama `loadProjectForecast`, que busca `payables` de novo no mesmo request.

- **Impacto:** altíssimo — correção financeira + desperdício grande de banda.
- **Risco de corrigir:** baixo a médio. Empurrar `dateFrom`/`dateTo` para a query e trocar o `.limit` fixo por erro explícito ou paginação server-side. Precisa validar que os totais permanecem idênticos.
- **Esforço:** baixo a médio.

### P5 — `loadProjectForecast` carrega tabelas inteiras sem recorte

`lib/forecast/server.ts`, `Promise.all` de 11 consultas (linha 284). Pontos concretos:

- **`engineering_services`** (linha 301) não filtra por obra — carrega o **catálogo inteiro de serviços da empresa**, embora só use os do orçamento corrente.
- **`payables`** (linha 382) não tem filtro de data nenhum: `.neq("status","cancelled")` e nada mais.
- **`progressMeasurements`** (linha 322) traz o histórico completo até `asOfDate` para depois manter **só a última medição por atividade** (`latestProgressByActivity`, linha 154). Caso clássico de `DISTINCT ON (activity_id)` no Postgres.
- **Itens de contrato, aditivos e itens de medição** também vêm completos para agregação no Node.

- **Impacto:** alto. É o carregador das três rotas do incidente.
- **Risco de corrigir:** parte baixa (recortar `services` por orçamento, selecionar menos colunas), parte média (mover agregações para SQL — depende de migration, fica para depois).
- **Esforço:** baixo para os recortes; médio/alto para as agregações SQL.

### P6 — `.find()` dentro de `.map()` em tabelas de execução (crescimento quadrático)

Padrão real em várias páginas de execução/suprimentos. Exemplos: `app/execucao/medicoes-por-etapas/page.tsx` (linha 106, `contractsResult.data.find(...)` por linha de medição); `app/execucao/contratacoes-servicos/page.tsx` (linha 163); `app/suprimentos/orcamentos-materiais/page.tsx` (linha 116); `app/pos-obra/garantias/page.tsx` (linhas 178 e 180).

**Evidência (harness — mesmo trabalho, `.find` em loop vs índice `Map`):**

```
   500 medições ×  100 contratos → .find:   7,8 ms | Map: 0,4 ms |  19×
 2.000 medições ×  500 contratos → .find:  23,3 ms | Map: 1,2 ms |  19×
10.000 medições × 2000 contratos → .find: 117,5 ms | Map: 4,8 ms |  24×
20.000 medições × 5000 contratos → .find: 487,8 ms | Map: 10,9 ms | 45×
```

O custo cresce quadraticamente; o índice `Map` resolve em tempo linear com resultado idêntico.

- **Impacto:** médio, cresce com o volume da obra.
- **Risco de corrigir:** muito baixo. Construir um `Map` por id antes do loop.
- **Esforço:** baixo, item a item.

### P7 — `app/layout.tsx` faz toda rota pagar por tudo

`app/layout.tsx` (95 linhas) importa **42 arquivos CSS** e monta **6 componentes cliente** em **todas as 69 rotas**.

**Evidência (medição de arquivos + build):**

- CSS importado globalmente: **263 KB** de fonte; o build emite **542 KB** de CSS estático. Há 72 arquivos CSS em `app/` (565 KB somados), a maioria específica de uma tela.
- `SefazNfeLauncher` (10 linhas) só serve à rota de notas eletrônicas, mas é montado nas outras 68.
- **O pior:** `TakeoffImportGlobal` importa a server action de levantamento, que importa `xlsx`. O build gera `app_engenharia_levantamento_import-actions_ts...js` com **320 KB** dentro dos chunks SSR, puxado pelo layout raiz. `xlsx` (7,3 MB no `node_modules`) e `exceljs` (23 MB) só são necessários em rotas de importação/exportação.

- **Impacto:** médio, mas transversal (todo o sistema).
- **Risco de corrigir:** baixo. Mover componentes para as rotas onde são usados, avaliar route groups e importar CSS por rota. `next.config.ts` já isola `exceljs` em `serverExternalPackages`.
- **Esforço:** médio (muitos arquivos, mas mudanças mecânicas).

### Nota — o que **não** precisa mudar

Para evitar retrabalho: `detectIntegrityAlerts` (`curve-calculations.mjs`, linha 472) **já** usa índices `Map` corretamente para agrupar por serviço. O `latestProgressByActivity` no server também já usa `Map`. O problema desses pontos é a **origem dos dados** (P5), não o algoritmo em memória. Não mexer neles.

---

## 5. Números atuais e metas

Metas expressas como propriedades a garantir, já que os números absolutos dependem do volume real (a confirmar na Etapa 2 com os dados do Flow/Alma).

| Métrica | Hoje (evidência) | Meta |
|---|---|---|
| Memória em `/curvas` e `/fluxo-de-caixa` | ~1,8 GB / erro 500 no incidente | Nenhuma rota crítica retorna 500 por memória; heap por request na casa de dezenas de MB |
| Sensibilidade a data inválida | 5 datas ruins = payload 3× maior | Janela de meses ancorada no cronograma real; datas fora do horizonte não inflam a matriz |
| Payload de serviços (forecast) | até 70 MB de JSON no cenário extremo | Matriz esparsa; só células não nulas trafegam |
| `fetchAllRows` | sem teto; 500 mil = 501 consultas; spread quebra >130 mil | Teto explícito com erro claro; sem spread; sem estouro de pilha |
| `/fluxo-de-caixa` | baixa até 20 mil registros, mostra 50; trunca em 10 mil sem avisar | Filtro de data no banco; sem truncamento silencioso; totais idênticos |
| `.find` em loop | 45× mais lento que `Map` em 20 mil linhas | Índices `Map`; tempo linear |
| CSS global | 542 KB emitidos, aplicados a toda rota | CSS carregado por rota |
| Bundle SSR do layout | inclui chunk `xlsx` de 320 KB | `xlsx`/`exceljs` só nas rotas de import/export |
| `npm test` / `lint` / `build` | 42/42 · 27 erros de lint · build OK | 42/42 mantido · lint limpo · build OK |

**Invariantes inegociáveis em toda otimização:** resultados financeiros idênticos antes/depois; sem dupla contagem; `company_id`, RLS e isolamento multiempresa preservados; motor financeiro único em `lib/forecast/` (sem duplicação nas páginas); sem aumentar limite de memória para mascarar problema; medição antes/depois em cada PR.

---

## 6. Ranking por impacto × risco × esforço

Ordenado por retorno sobre risco — primeiro o que tira o sistema da zona de erro 500 com o menor risco.

| Ordem | Problema | Impacto | Risco | Esforço |
|---|---|---|---|---|
| 1º | P3 — teto + fim do spread em `fetchAllRows` | Alto | Muito baixo | Baixo |
| 2º | P4 — truncamento e filtro de data no fluxo de caixa | Altíssimo | Baixo | Baixo/médio |
| 3º | P2 — cache de perfil no motor | Alto | Baixo | Baixo |
| 4º | P6 — `.find` → `Map` nas tabelas | Médio | Muito baixo | Baixo |
| 5º | P5 (parte leve) — recorte de `services` e colunas | Alto | Baixo | Baixo |
| 6º | P1 — matriz esparsa + janela de meses ancorada | Altíssimo | Médio | Médio |
| 7º | P7 — enxugar layout (CSS e componentes por rota) | Médio | Baixo | Médio |
| 8º | P5 (parte pesada) — agregações SQL | Alto | Médio | Alto (migration) |

Os dois primeiros não tocam em nenhuma regra financeira e já removem o sistema da zona de erro 500.

---

## 7. Divisão em PRs pequenos

Cada PR: mudança pequena, medição antes/depois no corpo do PR, `test` + `lint` + `build` verdes, sem deploy e sem migration aplicada.

1. **`perf: diagnóstico e instrumentação`** — este documento + cenários de carga versionados (10 mil atividades, 100 mil medições, 50 mil payables, datas inválidas, janela de 240 meses, várias empresas isoladas), conforme o `claude-access.md`. Sem mudança de comportamento.
2. **`perf: limites defensivos de paginação`** — P3. Teto configurável com erro explícito; troca do spread por laço. Base para todos os demais.
3. **`perf: corrigir truncamento e filtro de data no fluxo de caixa`** — P4. Primeiro item que corrige um número potencialmente errado.
4. **`perf: cache de perfil no motor de previsão`** — P2. Resultado idêntico, comprovado por teste; sem mudar regra.
5. **`perf: indices Map nas tabelas de execução`** — P6, uma página por commit.
6. **`perf: recortar payload do forecast`** — P5 leve (services por orçamento, colunas enxutas). Sem migration.
7. **`perf: compactar curvas e fluxo de caixa (matriz esparsa)`** — P1. O maior ganho e o de maior cuidado; entra depois de a instrumentação e os testes de carga estarem no lugar.
8. **`perf: lazy loading dos componentes e CSS globais`** — P7.
9. **`perf: indices e agregacoes SQL`** — P5 pesado. **Só depois de medido**, com `EXPLAIN (ANALYZE, BUFFERS)` documentado, query beneficiada, índice/RPC/view proposto, ganho esperado e risco de escrita/RLS. Migration proposta, **não aplicada** em produção.

---

## 8. Apêndice — lint atual

27 erros e 24 avisos. Não são bugs de performance, mas precisam ser resolvidos antes de qualquer PR ser marcada como pronta. Categorias principais:

- **`react-hooks` (render/renders/set-state-in-effect)** — maioria dos erros, concentrados em `components/searchable-select.tsx` e `components/global-searchable-select.tsx` (`setState` síncrono em efeito; valor de `useState` mutado direto). Vale corrigir junto do P7, já que são componentes de UI global.
- **`@next/next/no-img-element`** (4) — trocar `<img>` por `next/image`.
- **`@typescript-eslint/no-explicit-any`** (3) e **`no-unused-vars`** (vários, muitos com prefixo `_` em código de diagnóstico do `koper-worker`).

Sugestão: um PR de higiene de lint separado das otimizações, para não misturar mudança de comportamento com limpeza.

---

## 9. Próximo passo

Este diagnóstico é para aprovação. Aprovado o conteúdo e a ordem, o próximo commit é o **PR 1** (instrumentação + cenários de carga versionados), sem tocar em regra financeira nem em arquitetura. Antes do PR 7 (matriz esparsa), o ideal é rodar os cenários de carga com os volumes reais do Flow e do Alma para confirmar a prioridade — em especial **quantas datas inválidas existem hoje no banco**, que é o gatilho direto do incidente.
