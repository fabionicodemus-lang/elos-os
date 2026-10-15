#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20261015143000_engineering_budget_import_promotion.sql"
echo "Aplicando revisão e promoção do importador de orçamento..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regprocedure('public.resolve_engineering_budget_import_entity(uuid,uuid,uuid,text,uuid,text,text)') is null then
    raise exception '0098: resolvedor do importador ausente.';
  end if;
  if to_regprocedure('public.promote_engineering_budget_import(uuid,uuid,text,text,text)') is null then
    raise exception '0098: promotor do importador ausente.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'engineering_budget_import_rows' and column_name = 'resolution_action'
  ) then
    raise exception '0098: resolution_action ausente.';
  end if;
end $$;
SQL

echo "Revisão e promoção do importador aplicadas e validadas."
