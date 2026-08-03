#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

APPLIED=()
SKIPPED=()

scalar() {
  psql "$SUPABASE_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "$1" | tr -d '[:space:]'
}

run_migration() {
  local number="$1"
  local file="$2"
  local state="$3"

  case "$state" in
    complete)
      echo "Supabase ${number}: já aplicada; mantendo estrutura atual."
      SKIPPED+=("${number}")
      ;;
    absent)
      echo "Supabase ${number}: aplicando ${file}."
      psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$file"
      APPLIED+=("${number}")
      ;;
    *)
      echo "Supabase ${number}: instalação parcial detectada. Interrompendo para não sobrescrever uma estrutura inconsistente." >&2
      exit 1
      ;;
  esac
}

state_0071="$(scalar "select case when
  to_regclass('public.execution_service_contract_amendment_items') is not null
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_contract_measurements' and column_name='over_contract_confirmed')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_contract_measurements' and column_name='reversal_reason')
  and exists(select 1 from public.permissions where key='execution.measurements.reverse')
then 'complete' when
  to_regclass('public.execution_service_contract_amendment_items') is null
  and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_contract_measurements' and column_name='over_contract_confirmed')
  and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_contract_measurements' and column_name='reversal_reason')
  and not exists(select 1 from public.permissions where key='execution.measurements.reverse')
then 'absent' else 'partial' end")"
run_migration "0071" "supabase/migrations/20260803_0071_execution_contract_commitments.sql" "$state_0071"

state_0072="$(scalar "select case when to_regprocedure('public.add_execution_service_contract_amendment_with_items(uuid,uuid,uuid,text,text,numeric,date,text,jsonb)') is not null then 'complete' else 'absent' end")"
run_migration "0072" "supabase/migrations/20260803_0072_execution_contract_workflows.sql" "$state_0072"

state_0073="$(scalar "select case when to_regprocedure('public.save_execution_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb,boolean)') is not null then 'complete' else 'absent' end")"
run_migration "0073" "supabase/migrations/20260803_0073_execution_contract_measurements_v2.sql" "$state_0073"

state_0074="$(scalar "select case when to_regprocedure('public.create_simple_execution_contract_measurement(uuid,uuid,uuid,date,numeric,numeric,boolean,text)') is not null then 'complete' else 'absent' end")"
run_migration "0074" "supabase/migrations/20260803_0074_execution_contract_simple_measurement.sql" "$state_0074"

# A 0075 contém apenas CREATE OR REPLACE FUNCTION, então pode completar com segurança
# um conjunto parcialmente existente de funções financeiras.
state_0075="$(scalar "with markers as (
  select count(*)::int present from (values
    (to_regprocedure('public.approve_execution_contract_measurement(uuid,uuid,uuid,text)') is not null),
    (to_regprocedure('public.reverse_execution_contract_measurement(uuid,uuid,uuid,text)') is not null),
    (to_regprocedure('public.sync_contract_measurement_from_payable()') is not null)
  ) v(ok) where ok
) select case when present=3 then 'complete' else 'absent' end from markers")"
run_migration "0075" "supabase/migrations/20260803_0075_execution_contract_finance.sql" "$state_0075"

state_0076="$(scalar "select case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='forecast_default_payment_days') then 'complete' else 'absent' end")"
run_migration "0076" "supabase/migrations/20260803_0076_project_forecast_settings.sql" "$state_0076"

state_0077="$(scalar "with markers as (
  select count(*)::int present from (values
    (to_regclass('public.forecast_snapshots') is not null),
    (to_regclass('public.forecast_snapshot_rows') is not null),
    (to_regprocedure('public.create_forecast_snapshot(uuid,uuid,uuid,uuid,date,date,text,numeric,numeric,numeric,numeric,numeric,numeric,integer,text,text,text,jsonb,jsonb)') is not null),
    (to_regprocedure('public.archive_forecast_snapshot(uuid)') is not null)
  ) v(ok) where ok
) select case when present=4 then 'complete' when present=0 then 'absent' else 'partial' end from markers")"
run_migration "0077" "supabase/migrations/20260803_0077_forecast_snapshots.sql" "$state_0077"

echo "Validando a cadeia 0071–0077 no Supabase..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.execution_service_contract_amendment_items') is null then
    raise exception '0071: tabela de alocação dos aditivos ausente';
  end if;
  if not exists(select 1 from pg_class where oid='public.execution_service_contract_amendment_items'::regclass and relrowsecurity) then
    raise exception '0071: RLS da alocação dos aditivos não está habilitado';
  end if;
  if not exists(select 1 from public.permissions where key='execution.measurements.reverse') then
    raise exception '0071: permissão de estorno ausente';
  end if;
  if to_regprocedure('public.add_execution_service_contract_amendment_with_items(uuid,uuid,uuid,text,text,numeric,date,text,jsonb)') is null then
    raise exception '0072: RPC de aditivo com itens ausente';
  end if;
  if to_regprocedure('public.save_execution_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb,boolean)') is null then
    raise exception '0073: RPC de medição com confirmação de estouro ausente';
  end if;
  if to_regprocedure('public.create_simple_execution_contract_measurement(uuid,uuid,uuid,date,numeric,numeric,boolean,text)') is null then
    raise exception '0074: RPC de medição mensal simples ausente';
  end if;
  if to_regprocedure('public.approve_execution_contract_measurement(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.reverse_execution_contract_measurement(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.sync_contract_measurement_from_payable()') is null then
    raise exception '0075: fluxo financeiro das medições incompleto';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='forecast_default_payment_days') then
    raise exception '0076: prazo padrão da previsão ausente';
  end if;
  if to_regclass('public.forecast_snapshots') is null or to_regclass('public.forecast_snapshot_rows') is null then
    raise exception '0077: tabelas de snapshots ausentes';
  end if;
  if not exists(select 1 from pg_class where oid='public.forecast_snapshots'::regclass and relrowsecurity)
     or not exists(select 1 from pg_class where oid='public.forecast_snapshot_rows'::regclass and relrowsecurity) then
    raise exception '0077: RLS dos snapshots não está habilitado';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.forecast_snapshots'::regclass and tgname='forecast_snapshots_protect_immutability' and not tgisinternal)
     or not exists(select 1 from pg_trigger where tgrelid='public.forecast_snapshot_rows'::regclass and tgname='forecast_snapshot_rows_protect_immutability' and not tgisinternal) then
    raise exception '0077: proteção de imutabilidade incompleta';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='forecast_snapshots' and policyname='forecast_snapshots_select')
     or not exists(select 1 from pg_policies where schemaname='public' and tablename='forecast_snapshot_rows' and policyname='forecast_snapshot_rows_select') then
    raise exception '0077: políticas de leitura dos snapshots ausentes';
  end if;
  if to_regprocedure('public.create_forecast_snapshot(uuid,uuid,uuid,uuid,date,date,text,numeric,numeric,numeric,numeric,numeric,numeric,integer,text,text,text,jsonb,jsonb)') is null
     or to_regprocedure('public.archive_forecast_snapshot(uuid)') is null then
    raise exception '0077: RPCs dos snapshots ausentes';
  end if;
end $$;

select
  (select count(*) from public.forecast_snapshots) as snapshots_existentes,
  (select count(*) from public.forecast_snapshot_rows) as linhas_existentes;
SQL

applied_text="nenhuma (já estavam aplicadas)"
skipped_text="nenhuma"
if ((${#APPLIED[@]})); then applied_text="$(IFS=', '; echo "${APPLIED[*]}")"; fi
if ((${#SKIPPED[@]})); then skipped_text="$(IFS=', '; echo "${SKIPPED[*]}")"; fi

message="✅ Supabase 0071–0077 aplicado e validado. Aplicadas nesta execução: ${applied_text}. Já existentes e preservadas: ${skipped_text}. Contratos, motor unificado e snapshots estão com as estruturas e políticas esperadas."
echo "$message"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$message" >/dev/null
fi
