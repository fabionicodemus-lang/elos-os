#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0067_service_contracting_flow.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0067a_service_contracting_activation.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.execution_service_requests') is null then raise exception 'Solicitações de serviços não criadas'; end if;
  if to_regclass('public.execution_service_request_proposals') is null then raise exception 'Mapa de propostas não criado'; end if;
  if to_regclass('public.execution_service_request_stages') is null then raise exception 'Etapas de medição não criadas'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_service_contracts' and column_name='service_request_id') then raise exception 'Vínculo solicitação contrato não criado'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_service_contract_items' and column_name='measurement_stage_name') then raise exception 'Etapa de medição não vinculada ao item do contrato'; end if;
  if to_regprocedure('public.save_execution_service_request(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,date,date,text)') is null then raise exception 'Função de solicitação não criada'; end if;
  if to_regprocedure('public.approve_execution_service_competition(uuid,uuid,uuid,uuid,text)') is null then raise exception 'Função de aprovação do mapa não criada'; end if;
  if to_regprocedure('public.create_execution_service_contract_from_request(uuid,uuid,uuid,date,date,numeric,numeric,integer,text,jsonb)') is null then raise exception 'Função de formulação do contrato não criada'; end if;
  if to_regprocedure('public.activate_service_contract_from_approved_request()') is null then raise exception 'Proteção de ativação das etapas não criada'; end if;
  if not exists(select 1 from pg_trigger where tgname='activate_service_contract_from_approved_request_trigger' and not tgisinternal) then raise exception 'Trigger de ativação automática não criado'; end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migrations 0067 e 0067a aplicadas e validadas. Solicitação de serviços, mapa de concorrência, aprovação do fornecedor e etapas de medição estão ativos.' >/dev/null
fi
