#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20260804_0078_budget_delete_dependencies.sql"

echo "Aplicando Supabase 0078: exclusão segura de orçamento e linha de base."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando a função atualizada..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  definition text;
begin
  if to_regprocedure('public.delete_engineering_budget(uuid,uuid,uuid)') is null then
    raise exception '0078: função delete_engineering_budget ausente';
  end if;

  select pg_get_functiondef('public.delete_engineering_budget(uuid,uuid,uuid)'::regprocedure)
  into definition;

  if position('engineering_schedule_progress_measurements' in definition) = 0 then
    raise exception '0078: proteção das medições físicas ausente';
  end if;
  if position('delete from public.engineering_schedule_baselines' in lower(definition)) = 0 then
    raise exception '0078: limpeza transacional da linha de base ausente';
  end if;
  if position('pg_constraint' in definition) = 0 then
    raise exception '0078: descoberta defensiva de dependências ausente';
  end if;
  if position('forecast_snapshots' in definition) = 0 then
    raise exception '0078: proteção dos snapshots ausente';
  end if;
end $$;
SQL

message="✅ Supabase 0078 aplicado e validado. Orçamentos com planejamento vazio podem ser excluídos; medições, contratos, solicitações e snapshots continuam protegidos."
echo "$message"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$message" >/dev/null
fi
