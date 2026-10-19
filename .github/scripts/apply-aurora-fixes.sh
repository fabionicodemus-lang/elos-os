#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
# Use the repository's existing database target. Never apply the entire legacy
# migration chain, nor log the connection string.
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if to_regclass('public.commercial_feasibility_sales_velocities') is null
     or to_regclass('public.engineering_schedule_progress_measurements') is null then
    raise exception 'O banco configurado não contém os módulos esperados do Elos OS.';
  end if;
end $$;
SQL
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261018113325_aurora_feasibility_daily_integrity.sql
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261018113556_aurora_schedule_progress_audit.sql
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if to_regprocedure('public.execution_daily_log_requirements(uuid)') is null
     or to_regprocedure('public.void_execution_schedule_progress(uuid,uuid,uuid,text)') is null then
    raise exception 'Funções corretivas não foram instaladas.';
  end if;
  if not exists(select 1 from pg_class where oid='public.engineering_schedule_progress_audit'::regclass and relrowsecurity) then
    raise exception 'Auditoria precisa manter RLS ativo.';
  end if;
end $$;
SQL
