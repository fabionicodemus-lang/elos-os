#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20261015184500_feasibility_sales_plan.sql"
echo "Aplicando plano de vendas em fases da viabilidade..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_missing text;
begin
  select string_agg(required.column_name, ', ' order by required.column_name)
    into v_missing
  from (
    values
      ('phase_key'),
      ('target_units_pct'),
      ('price_appreciation_pct'),
      ('entry_pct'),
      ('monthly_pct'),
      ('keys_pct'),
      ('monthly_installments')
  ) as required(column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'commercial_feasibility_sales_velocities'
      and c.column_name = required.column_name
  );

  if v_missing is not null then
    raise exception '0099: colunas ausentes em commercial_feasibility_sales_velocities: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'commercial_feasibility_sales_velocities'
      and indexname = 'feasibility_sales_phase_key_uq'
  ) then
    raise exception '0099: índice feasibility_sales_phase_key_uq ausente.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'feasibility_sales_velocity_start_uq'
      and conrelid = 'public.commercial_feasibility_sales_velocities'::regclass
  ) then
    raise exception '0099: constraint legado feasibility_sales_velocity_start_uq ainda existe.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'feasibility_sales_phase_key_check'
      and conrelid = 'public.commercial_feasibility_sales_velocities'::regclass
  ) then
    raise exception '0099: constraint feasibility_sales_phase_key_check ausente.';
  end if;
end $$;
SQL

echo "Plano de vendas em fases aplicado e validado."
