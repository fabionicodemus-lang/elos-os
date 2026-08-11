#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL não configurada."
  exit 1
fi
export PGSSLMODE="${PGSSLMODE:-require}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== AUDITORIA 2: CAMPOS PRESERVADOS NO PEDIDO/ITEM KOPER ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), staged as (
  select poi.id poi_id, item_stage.payload::jsonb item_payload, order_stage.payload::jsonb order_payload
  from base poi
  left join public.koper_staging_records item_stage
    on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item'
   and item_stage.koper_id=split_part(poi.source_id,':',1)
  left join public.koper_staging_records order_stage
    on order_stage.company_id=poi.company_id and order_stage.source='koper' and order_stage.entity='purchase_order'
   and order_stage.koper_id=item_stage.koper_parent_id
)
select
  count(*) legacy_total,
  count(*) filter (where nullif(item_payload->>'costCenterId','') is not null) item_cost_center_id,
  count(*) filter (where nullif(order_payload->>'costCenterId','') is not null) header_cost_center_id,
  count(*) filter (where nullif(item_payload->>'buildMonitoringId','') is not null) item_build_monitoring_id,
  count(*) filter (where nullif(order_payload->>'buildMonitoringId','') is not null) header_build_monitoring_id,
  count(*) filter (where nullif(item_payload->>'itemBudgetId','') is not null) item_budget_id,
  count(*) filter (where nullif(order_payload->>'itemBudgetId','') is not null) header_item_budget_id,
  count(*) filter (where order_payload is not null) header_stage_encontrado
from staged;

\echo '=== DE-PARA PELO costCenterId DO CABECALHO ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), budget_services as (
  select distinct bi.service_id from public.engineering_budget_items bi join public.engineering_budgets b on b.id=bi.budget_id join flow on flow.id=bi.project_id and flow.company_id=bi.company_id
  where bi.status='active' and bi.service_id is not null and b.status <> 'archived'
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), candidates as (
  select distinct poi.id poi_id, service.id service_id, service.source_id koper_service_id
  from base poi
  join public.koper_staging_records item_stage on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item' and item_stage.koper_id=split_part(poi.source_id,':',1)
  join public.koper_staging_records order_stage on order_stage.company_id=poi.company_id and order_stage.source='koper' and order_stage.entity='purchase_order' and order_stage.koper_id=item_stage.koper_parent_id
  join public.engineering_services service on service.company_id=poi.company_id and service.source_system='koper' and service.source_id=nullif(order_stage.payload::jsonb->>'costCenterId','')
  where service.id<>(select id from legacy)
)
select
  count(distinct poi_id) header_cost_center_resolvidos,
  count(distinct poi_id) filter (where service_id in (select service_id from budget_services)) header_resolvidos_no_orcamento,
  count(distinct service_id) servicos_distintos
from candidates;

\echo '=== TESTES COM buildMonitoringId / itemBudgetId CONTRA budget_item ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), staged as (
  select poi.id poi_id, poi.company_id, item_stage.payload::jsonb item_payload, order_stage.payload::jsonb order_payload
  from base poi
  left join public.koper_staging_records item_stage on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item' and item_stage.koper_id=split_part(poi.source_id,':',1)
  left join public.koper_staging_records order_stage on order_stage.company_id=poi.company_id and order_stage.source='koper' and order_stage.entity='purchase_order' and order_stage.koper_id=item_stage.koper_parent_id
), ids as (
  select poi_id, company_id, value_id, origin
  from staged
  cross join lateral (values
    (nullif(item_payload->>'buildMonitoringId',''), 'item.buildMonitoringId'),
    (nullif(order_payload->>'buildMonitoringId',''), 'header.buildMonitoringId'),
    (nullif(item_payload->>'itemBudgetId',''), 'item.itemBudgetId'),
    (nullif(order_payload->>'itemBudgetId',''), 'header.itemBudgetId')
  ) v(value_id,origin)
  where value_id is not null
), matches as (
  select distinct ids.poi_id, ids.origin, service.id service_id
  from ids
  join public.koper_staging_records bi on bi.company_id=ids.company_id and bi.source='koper' and bi.entity='budget_item'
    and (bi.koper_id=ids.value_id or nullif(bi.payload::jsonb->>'inputId','')=ids.value_id or nullif(bi.payload::jsonb->>'compositionId','')=ids.value_id)
  join public.engineering_services service on service.company_id=ids.company_id and service.source_system='koper' and service.source_id=nullif(bi.payload::jsonb->>'serviceId','')
  where service.id<>(select id from legacy)
)
select origin, count(distinct poi_id) itens_resolvidos, count(distinct service_id) servicos_distintos
from matches group by origin order by itens_resolvidos desc;

\echo '=== CHAVES MAIS FREQUENTES NO CABECALHO (nomes apenas) ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), headers as (
  select distinct order_stage.id, order_stage.payload::jsonb payload
  from public.procurement_purchase_order_items poi
  join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  join public.koper_staging_records item_stage on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item' and item_stage.koper_id=split_part(poi.source_id,':',1)
  join public.koper_staging_records order_stage on order_stage.company_id=poi.company_id and order_stage.source='koper' and order_stage.entity='purchase_order' and order_stage.koper_id=item_stage.koper_parent_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), keys as (
  select key, count(*) headers_com_chave
  from headers cross join lateral jsonb_object_keys(payload) key
  group by key
)
select key, headers_com_chave from keys
where lower(key) like '%cost%' or lower(key) like '%monitor%' or lower(key) like '%budget%' or lower(key) like '%service%'
order by headers_com_chave desc, key;
SQL

echo "Auditoria de cabeçalho concluída em modo somente leitura."
