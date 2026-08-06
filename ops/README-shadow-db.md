# Shadow database e tipos gerados

`types/database.ts` descreve o schema real do Elos OS e é **gerado**, nunca
editado à mão. A fonte é `supabase/migrations` aplicada do zero em um Postgres
descartável — o *shadow database*.

## Por que existe

Antes disto, as 682 consultas do `app/` não eram verificadas contra o banco:
cada arquivo redigitava à mão o formato das linhas que esperava. O `tsc` passava
porque conferia essa descrição escrita à mão, não o schema. Renomear uma coluna
quebrava em produção sem nenhum aviso no build.

## Como usar

```bash
npm run db:shadow      # recria o banco e aplica shim + migrations
npm run db:types       # regenera types/database.ts a partir dele
npm run db:types:check # falha se o arquivo estiver desatualizado
```

Conexão pelas variáveis padrão do PostgreSQL, com defaults `127.0.0.1:5432`,
usuário `postgres`, senha `shadow`.

**Ao adicionar uma migration, rode `npm run db:shadow && npm run db:types` e
commite o `types/database.ts` junto.** O workflow `database-types.yml` reprova o
PR se os dois estiverem fora de sincronia.

## Peças

| Arquivo | Papel |
| --- | --- |
| `supabase/shadow/00-supabase-shim.sql` | Recria o mínimo do ambiente Supabase que as migrations assumem: roles (`anon`, `authenticated`, `service_role`), schema `auth` com `auth.users` e `auth.uid()`, e schema `storage` com `buckets`, `objects` e `foldername`. |
| `ops/build-shadow-db.sh` | Recria o banco e aplica shim + migrations em ordem. |
| `ops/generate-database-types.mjs` | Gera os tipos via `@supabase/postgres-meta`. |
| `ops/check-database-types.sh` | Compara o arquivo commitado com o recém-gerado. |

## Duas decisões que não são óbvias

**A CLI do Supabase não é usada.** `supabase gen types typescript` exige Docker
mesmo recebendo `--db-url`, e não há Docker no CI nem no ambiente de
desenvolvimento remoto. O gerador chama `@supabase/postgres-meta` diretamente —
a mesma biblioteca que a CLI executa por baixo.

**Os argumentos de função são alargados para aceitar `null`.** O Postgres não
declara nulabilidade de parâmetro: toda função aceita `NULL` em qualquer
argumento, mas o gerador emite `p_x: string`. Trocar as chamadas por `undefined`
**não** seria equivalente — o PostgREST omite a chave e a função usa o `DEFAULT`,
em vez de gravar `NULL`. Por isso o pós-processamento em
`ops/generate-database-types.mjs` acrescenta `| null` aos argumentos de RPC.
Isso afeta apenas `Functions.*.Args`; `Row`, `Insert` e `Update` ficam intactos.

## A migration 0062 é pulada

`20260731_0062_bossa_homologation_project.sql` não cria schema: provisiona a obra
HOM-001 dentro de uma empresa Bossa que só existe no ambiente real. Em um banco
vazio ela falha por definição, então o script a ignora explicitamente.

## Nota sobre a migration 0048

`20260729_0048_finance_bank_accounts.sql` estava no repositório em um estado que
**não aplicava** — o `on conflict(company_id,source_system,source_id)` não repetia
o predicado do índice parcial correspondente, e o Postgres recusa a inferência.
O workflow `apply-supabase-0048.yml` reescrevia o arquivo antes de aplicar, então
a produção recebeu uma versão que nunca esteve versionada.

O arquivo foi alinhado ao que a produção efetivamente recebeu (`on conflict do
nothing`). Vale como alerta: **se o CI precisa corrigir uma migration para
aplicá-la, o repositório deixou de descrever o banco.**
