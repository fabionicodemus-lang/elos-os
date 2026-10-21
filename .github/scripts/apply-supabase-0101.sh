#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
MIGRATION="supabase/migrations/20261021024500_elos_ia_schedule_update.sql"
echo "Aplicando ação revisável de atualização de cronograma por IA..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"
echo "Validando permissão e executor do cronograma..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if public.ai_action_required_permission('execution_schedule_update') <> 'execution.schedule.manage'
    then raise exception '0101: permissão incorreta'; end if;
  if to_regprocedure('public.ai_execute_schedule_action_proposal(uuid)') is null
    then raise exception '0101: executor de cronograma ausente'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.ai_action_proposals'::regclass
      and pg_get_constraintdef(oid) like '%execution_schedule_update%')
    then raise exception '0101: tipo da ação não liberado'; end if;
end $$;
SQL
echo "Atualização de cronograma por Elos IA ativada no banco."
