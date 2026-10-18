#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
# Apply only the already-versioned missing integration migration, not the legacy chain.
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if to_regclass('public.execution_material_request_items') is null
     or to_regclass('public.procurement_inventory_reservations') is null then
    raise exception 'O banco configurado não contém os módulos esperados do Elos OS.';
  end if;
end $$;
SQL
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261014070000_procurement_request_stock_intelligence.sql
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='execution_material_request_items' and column_name='stock_fulfilled_quantity') then
    raise exception 'Coluna de atendimento por estoque ausente.';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='fulfill_execution_material_request_from_stock') then
    raise exception 'Função de atendimento por estoque ausente.';
  end if;
  if exists (select 1 from pg_class where oid in ('public.execution_material_request_items'::regclass, 'public.procurement_inventory_reservations'::regclass) and not relrowsecurity) then
    raise exception 'RLS deve permanecer ativo nos módulos de suprimentos.';
  end if;
end $$;
notify pgrst, 'reload schema';
SQL
