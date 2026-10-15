#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20261015190000_feasibility_sales_phase_units.sql"
echo "Aplicando metas de venda por número de unidades..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commercial_feasibility_sales_velocities'
      and column_name = 'target_units'
      and data_type = 'integer'
  ) then
    raise exception '0100: coluna target_units ausente ou com tipo incorreto.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'commercial_feasibility_sales_velocities_target_units_check'
      and conrelid = 'public.commercial_feasibility_sales_velocities'::regclass
  ) then
    raise exception '0100: constraint de target_units ausente.';
  end if;

  if exists (
    select 1
    from public.commercial_feasibility_sales_velocities
    where phase_key is not null
      and target_units is null
      and target_units_pct is not null
  ) then
    raise exception '0100: existem fases antigas com percentual definido e target_units sem backfill.';
  end if;
end $$;
SQL

echo "Metas por unidades aplicadas e validadas."
