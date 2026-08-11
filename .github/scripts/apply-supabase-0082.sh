#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL não configurada."
  exit 1
fi

export PGSSLMODE="${PGSSLMODE:-require}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260811_0082_koper_cost_center_mapping.sql

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.engineering_cost_center_mappings') is null then
    raise exception '0082: tabela engineering_cost_center_mappings não existe.';
  end if;

  if exists (
    select 1
    from public.engineering_cost_center_mappings mapping
    join public.engineering_services service on service.id = mapping.service_id
    join public.projects project on project.id = mapping.project_id
    where service.company_id <> mapping.company_id
       or project.company_id <> mapping.company_id
  ) then
    raise exception '0082: existe de-para cruzando empresa/empreendimento.';
  end if;

  if exists (
    select 1
    from public.procurement_purchase_order_items item
    join public.engineering_cost_center_mappings mapping
      on mapping.company_id = item.company_id
     and mapping.project_id = item.project_id
     and mapping.source_code = lower(btrim(item.cost_center_code))
    where item.cost_center_service_id is null
      and btrim(coalesce(item.cost_center_code, '')) <> ''
  ) then
    raise exception '0082: pedido com de-para conhecido continua sem apropriação.';
  end if;

  if exists (
    select 1
    from public.procurement_inventory_movements movement
    join public.engineering_cost_center_mappings mapping
      on mapping.company_id = movement.company_id
     and mapping.project_id = movement.project_id
     and mapping.source_code = lower(btrim(movement.cost_center_code))
    where movement.cost_center_service_id is null
      and btrim(coalesce(movement.cost_center_code, '')) <> ''
  ) then
    raise exception '0082: movimento de estoque com de-para conhecido continua sem apropriação.';
  end if;
end $$;

select
  count(*) as de_para_total,
  count(*) filter (where source_system = 'koper') as de_para_koper
from public.engineering_cost_center_mappings;

select
  count(*) filter (where cost_center_service_id is not null) as pedidos_apropriados,
  count(*) filter (where cost_center_service_id is null and btrim(coalesce(cost_center_code, '')) <> '') as pedidos_com_codigo_sem_servico
from public.procurement_purchase_order_items;

\echo '--- Códigos Koper ainda sem vínculo (agrupados) ---'
select
  project.code as obra,
  item.cost_center_code as codigo_koper,
  max(item.cost_center_name) as nome_koper,
  coalesce(nullif(lower(btrim(item.source_system)), ''), 'koper') as origem,
  count(*) as itens
from public.procurement_purchase_order_items item
join public.projects project on project.id = item.project_id
where item.cost_center_service_id is null
  and btrim(coalesce(item.cost_center_code, '')) <> ''
group by project.code, item.project_id, item.cost_center_code, coalesce(nullif(lower(btrim(item.source_system)), ''), 'koper')
order by count(*) desc, project.code, item.cost_center_code
limit 80;

\echo '--- Possíveis correspondências exatas pelo nome do centro de custo ---'
with unresolved as (
  select distinct
    item.company_id,
    item.project_id,
    item.cost_center_code,
    item.cost_center_name,
    lower(regexp_replace(btrim(coalesce(item.cost_center_name, '')), '[^[:alnum:]]+', '', 'g')) as normalized_name
  from public.procurement_purchase_order_items item
  where item.cost_center_service_id is null
    and btrim(coalesce(item.cost_center_code, '')) <> ''
    and btrim(coalesce(item.cost_center_name, '')) <> ''
), candidates as (
  select
    unresolved.*,
    service.id as candidate_service_id,
    service.code as candidate_service_code,
    service.description as candidate_service_name,
    count(*) over (partition by unresolved.project_id, unresolved.cost_center_code) as candidate_count
  from unresolved
  join public.engineering_services service
    on service.company_id = unresolved.company_id
   and lower(regexp_replace(btrim(service.description), '[^[:alnum:]]+', '', 'g')) = unresolved.normalized_name
)
select
  project.code as obra,
  candidates.cost_center_code as codigo_koper,
  candidates.cost_center_name as nome_koper,
  candidates.candidate_service_code,
  candidates.candidate_service_name,
  candidates.candidate_count
from candidates
join public.projects project on project.id = candidates.project_id
order by project.code, candidates.cost_center_code
limit 100;

\echo '--- Possíveis correspondências pelo código atual do item do orçamento ---'
select distinct
  project.code as obra,
  po.cost_center_code as codigo_koper,
  po.cost_center_name as nome_koper,
  budget_item.code as codigo_orcamento,
  budget_item.description as servico_orcamento,
  service.code as codigo_servico_interno
from public.procurement_purchase_order_items po
join public.projects project on project.id = po.project_id
join public.engineering_budget_items budget_item
  on budget_item.company_id = po.company_id
 and budget_item.project_id = po.project_id
 and lower(btrim(coalesce(budget_item.code, ''))) = lower(btrim(po.cost_center_code))
left join public.engineering_services service on service.id = budget_item.service_id
where po.cost_center_service_id is null
  and btrim(coalesce(po.cost_center_code, '')) <> ''
order by project.code, po.cost_center_code
limit 100;
SQL

echo "Supabase 0082 aplicado e validado: código Koper preservado e vínculo interno recuperado."
