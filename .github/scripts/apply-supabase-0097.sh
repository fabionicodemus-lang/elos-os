#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20261015133000_engineering_budget_import_staging.sql"
echo "Aplicando staging do importador de orçamento..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.engineering_budget_import_batches') is null then
    raise exception '0097: engineering_budget_import_batches ausente.';
  end if;
  if to_regclass('public.engineering_budget_import_rows') is null then
    raise exception '0097: engineering_budget_import_rows ausente.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'engineering_budget_groups'
      and column_name = 'parent_group_id'
  ) then
    raise exception '0097: parent_group_id ausente em engineering_budget_groups.';
  end if;
end $$;
SQL

echo "Staging do importador de orçamento aplicado e validado."
