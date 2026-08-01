#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0067_service_contract_procurement.sql
if [[ -f supabase/migrations/20260801_0067a_service_contract_procurement_fix.sql ]]; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260801_0067a_service_contract_procurement_fix.sql
fi

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.execution_service_requests') is null then raise exception 'Solicitações de serviços não criadas'; end if;
  if to_regclass('public.execution_service_request_items') is null then raise exception 'Itens das solicitações não criados'; end if;
  if to_regclass('public.execution_service_competitions') is null then raise exception 'Mapas de concorrência não criados'; end if;
  if to_regclass('public.execution_service_competition_offers') is null then raise exception 'Propostas de serviços não criadas'; end if;
  if to_regclass('public.execution_service_contract_stages') is null then raise exception 'Etapas contratuais não criadas'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_service_contracts' and column_name='source_competition_id') then raise exception 'Origem da concorrência ausente no contrato'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='execution_contract_measurement_items' and column_name='contract_stage_id') then raise exception 'Vínculo da etapa ausente na medição'; end if;
  if to_regprocedure('public.save_execution_service_request(uuid,uuid,uuid,uuid,text,text,date,date,text,jsonb)') is null then raise exception 'RPC da solicitação ausente'; end if;
  if to_regprocedure('public.approve_execution_service_competition(uuid,uuid,uuid,uuid,text)') is null then raise exception 'RPC de aprovação do mapa ausente'; end if;
  if to_regprocedure('public.generate_execution_service_contract_from_competition(uuid,uuid,uuid,text,text,date,date,date,numeric,numeric,integer,integer,text,date,text,text,text,text,jsonb)') is null then raise exception 'RPC de geração do contrato ausente'; end if;
  if to_regprocedure('public.save_execution_stage_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb)') is null then raise exception 'RPC da medição por etapas ausente'; end if;
  if exists(
    select 1 from public.execution_service_contract_items ci
    where not exists(select 1 from public.execution_service_contract_stages s where s.contract_item_id=ci.id)
  ) then raise exception 'Existe item contratual sem etapa'; end if;
  if exists(
    select 1 from public.execution_service_contract_items ci
    join (
      select contract_item_id,sum(weight_percent) weight,sum(total_value) stage_value
      from public.execution_service_contract_stages group by contract_item_id
    ) s on s.contract_item_id=ci.id
    where abs(s.weight-100)>.001 or abs(s.stage_value-ci.total_value)>.01
  ) then raise exception 'Etapas não fecham 100%% ou valor do serviço'; end if;
  if exists(
    select 1 from public.execution_service_contract_stages
    where measured_quantity>contracted_quantity+.000001 or measured_value>total_value+.01
  ) then raise exception 'Etapa medida acima do contratado'; end if;
  if not exists(select 1 from pg_trigger where tgname='execution_contract_require_competition' and not tgisinternal) then raise exception 'Bloqueio da criação direta não instalado'; end if;
  if not exists(select 1 from pg_trigger where tgname='execution_contract_validate_stages' and not tgisinternal) then raise exception 'Validação das etapas na ativação não instalada'; end if;
end $$;

begin;
do $$
declare v_contract uuid;
begin
  select id into v_contract from public.execution_service_contracts limit 1;
  if v_contract is not null then perform public.refresh_execution_service_contract_measurements(v_contract); end if;
end $$;
rollback;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Supabase 0068 aplicado e validado. Solicitação de serviços, mapa de concorrência, fornecedor vencedor, geração de contrato e medições por etapas estão ativos.' >/dev/null
fi
