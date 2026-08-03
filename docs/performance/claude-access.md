# Acesso do Claude ao Elos OS — auditoria de performance

## Repositório e branch

- Repositório: `fabionicodemus-lang/elos-os`
- URL: `https://github.com/fabionicodemus-lang/elos-os`
- Branch base: `main`
- Branch exclusiva de trabalho: `claude/performance-optimization`
- Produção: `https://elos-os.vercel.app`
- Stack: Next.js 16, React 19, TypeScript, Supabase/PostgreSQL e Vercel.

O repositório é público, portanto o Claude consegue ler todo o código sem convite. Para criar commits e pull requests, ele deve usar a integração GitHub autenticada com a conta `fabionicodemus-lang`.

## Como acessar

```bash
git clone https://github.com/fabionicodemus-lang/elos-os.git
cd elos-os
git fetch origin
git checkout claude/performance-optimization
npm ci
npm test
npm run build
```

No Claude Code ou Cowork, também é possível informar diretamente:

```text
Repositório: fabionicodemus-lang/elos-os
Branch de trabalho: claude/performance-optimization
Leia primeiro docs/performance/claude-access.md
```

## Objetivo

Deixar o Elos OS mais rápido, enxuto e previsível, reduzindo:

- uso de memória no servidor;
- tempo de resposta das páginas;
- registros carregados do Supabase;
- serialização de objetos grandes;
- quantidade de elementos renderizados;
- tamanho do JavaScript e dos componentes globais;
- duplicação e complexidade desnecessária.

Preservar integralmente:

- regras financeiras;
- realizado, comprometido e a comprometer;
- regra anti-dupla-contagem;
- contratos, medições e payables;
- `company_id` e RLS;
- isolamento entre empresas;
- dados existentes.

## Regras obrigatórias

1. Nunca trabalhar diretamente na `main`.
2. Nunca fazer deploy manual.
3. Nunca aplicar migration no Supabase de produção.
4. Nunca alterar ou excluir dados reais sem autorização explícita.
5. Abrir PR para cada conjunto pequeno de mudanças.
6. Não aumentar limite de memória para esconder problema de arquitetura.
7. Não duplicar o motor financeiro dentro de páginas.
8. Manter o motor compartilhado em `lib/forecast/`.
9. Toda otimização deve apresentar medição antes/depois.
10. Rodar testes, lint e build antes de marcar uma PR como pronta.

## Incidente recente

As rotas `/engenharia/curvas` e `/financeiro/fluxo-de-caixa` chegaram a consumir aproximadamente 1,8 GB no processo Node e retornar erro 500.

Proteções iniciais já aplicadas:

- distribuição por mês em vez de expansão dia a dia;
- janela defensiva para datas extremas;
- redução da renderização pesada da tela de Curvas;
- versão visual no sistema para conferir o deployment.

Essas correções não substituem uma auditoria geral. O mesmo padrão pode existir em outras páginas.

## Arquivos prioritários

### Motor e carregamento da previsão

- `lib/forecast/server.ts`
- `lib/forecast/engine.mjs`
- `lib/supabase-pagination.ts`

Investigar:

- várias consultas grandes em `Promise.all`;
- paginação sem limite máximo;
- tabelas inteiras carregadas para agregação no Node;
- ausência de filtro temporal;
- arrays e Maps duplicando o mesmo conjunto de dados;
- spreads dentro de loops;
- consultas que poderiam retornar apenas totais agrupados.

Não truncar silenciosamente valores financeiros. Quando uma fonte exceder limite seguro, usar agregação correta no banco ou retornar erro explícito.

### Páginas críticas

- `app/engenharia/curvas/page.tsx`
- `app/engenharia/previsao-financeira/page.tsx`
- `app/engenharia/previsao-financeira/historico/page.tsx`
- `app/financeiro/fluxo-de-caixa/page.tsx`
- páginas de aprovações;
- contratos e medições.

Investigar:

- tabelas com milhares de linhas;
- SVG com um elemento por registro;
- objetos grandes enviados para componentes cliente;
- consultas repetidas no mesmo request;
- falta de paginação, virtualização ou carregamento sob demanda;
- `.find()` repetido dentro de loops em vez de índices `Map`.

### Layout e bundle global

- `app/layout.tsx`
- componentes globais;
- imports globais de CSS;
- ExcelJS e XLSX;
- SEFAZ, importadores e detalhes analíticos.

Recursos específicos não devem ser carregados em todas as páginas. Avaliar route groups, dynamic imports e componentes montados apenas onde são usados.

### Banco e índices

Revisar queries e migrations para identificar:

- filtros sem índice composto por `company_id`, `project_id`, status e data;
- ordenações sem índice;
- consultas N+1;
- seleção de colunas não utilizadas;
- agregações feitas no Node que deveriam ser executadas no PostgreSQL.

Antes de propor migration, documentar:

- query beneficiada;
- índice/RPC/view proposto;
- `EXPLAIN (ANALYZE, BUFFERS)` em ambiente seguro;
- ganho esperado;
- risco de escrita e de RLS.

Não aplicar a migration em produção.

## Plano de trabalho

### Etapa 1 — apenas diagnóstico

1. Rodar testes e build atuais.
2. Mapear as 10 rotas mais pesadas.
3. Medir tempo, memória, quantidade de queries e registros carregados.
4. Criar `docs/performance/00-diagnostico.md`.
5. Classificar cada problema por impacto, risco e esforço.
6. Não criar migrations nem alterar arquitetura nesta etapa.

### Etapa 2 — ganhos rápidos e seguros

- remover colunas e consultas desnecessárias;
- colocar limites defensivos explícitos;
- trocar processamento quadrático por linear;
- trocar buscas repetidas por Maps;
- paginar tabelas;
- reduzir dados serializados;
- carregar componentes pesados somente nas rotas necessárias.

### Etapa 3 — reduzir o payload financeiro

Propor agregações SQL/RPC/views para contratos, medições e payables quando houver ganho comprovado. O motor puro continua sendo a única regra de composição das três camadas.

### Etapa 4 — PRs pequenos

Sugestão de sequência:

1. `perf: diagnóstico e instrumentação`
2. `perf: limites defensivos de paginação`
3. `perf: reduzir payload do forecast`
4. `perf: compactar curvas e fluxo de caixa`
5. `perf: lazy loading dos componentes globais`
6. `perf: índices e agregações SQL`

## Testes obrigatórios

```bash
npm ci
npm test
npm run lint
npm run build
```

Adicionar cenários de carga sem usar dados de produção:

- 10.000 atividades;
- 100.000 medições de progresso;
- 50.000 payables;
- datas inválidas e extremas;
- janela de 240 meses;
- várias empresas com isolamento total;
- verificação de que a memória não cresce de forma quadrática.

## Critérios de aceite

- nenhuma rota crítica retorna 500 por memória;
- resultados financeiros idênticos antes e depois;
- nenhuma dupla contagem;
- nenhuma quebra de RLS;
- redução mensurável de memória e tempo;
- documentação com números antes/depois;
- testes, lint e build aprovados;
- PR sem deploy e sem migration aplicada.

## Primeira instrução ao Claude

Faça somente o diagnóstico inicial. Leia o código, execute os testes, identifique os maiores consumidores de memória e consultas mais caras, e produza `docs/performance/00-diagnostico.md` com uma ordem de correção baseada em impacto, risco e esforço. Não faça migrations nem mudanças amplas no primeiro commit.
