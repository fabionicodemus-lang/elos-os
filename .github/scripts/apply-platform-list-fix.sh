#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?Configure a secret SUPABASE_DB_URL antes de executar.}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

# Aplica somente a função corrigida; não cria, modifica nem apaga empresas.
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261018013500_platform_environment_listing_type_fix.sql

# Testa a função autenticada usando um administrador já existente, em transação
# sem alterações persistentes. Divulga apenas contagem, nunca dados de clientes.
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regprocedure('public.platform_list_environments()') is null then
    raise exception 'Função de listagem ausente depois da migration.';
  end if;
  if not exists(select 1 from public.platform_admins where status='active') then
    raise exception 'Nenhum administrador global ativo para validação.';
  end if;
end $$;

begin;
select set_config('request.jwt.claim.sub', (
  select user_id::text
  from public.platform_admins
  where status='active'
  order by created_at asc
  limit 1
), true);
set local role authenticated;
select count(*) as environments_listed from public.platform_list_environments();
rollback;
SQL
