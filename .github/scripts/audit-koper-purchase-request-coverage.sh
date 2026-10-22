#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL não configurada."
  exit 1
fi
export PGSSLMODE="${PGSSLMODE:-require}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== AUDITORIA 4: COBERTURA PEDIDO -> SOLICITACAO KOPER ==='
with flow as (
  select id, company_id
  from public.projects
  where name ilike '%Flow%' and status <> 'archived'
  order by created_at limit 1
), legacy as (
  select s.id
  from public.engineering_services s
  join flow on flow.company_id=s.company_id
  where s.code='KOPER-SR-LEGACY'
  order by s.updated_at desc nulls last limit 1
), base as (
  select poi.*
  from public.procurement_purchase_order_items poi
  join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), purchase_stage as (
  select poi.id poi_id, poi.company_id, item_stage.koper_id order_product_id, item_stage.payload::jsonb payload
  from base poi
  join public.koper_staging_records item_stage
    on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item'
   and item_stage.koper_id=split_part(poi.source_id,':',1)
), links as (
  select
    poi_id,
    company_id,
    order_product_id,
    nullif(link.value->>'productRequestId','') product_request_id,
    nullif(link.value->>'requestId','') request_id
  from purchase_stage
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'requests')='array' then payload->'requests' else '[]'::jsonb end
  ) link(value)
), joined as (
  select
    links.*,
    stock_item.id stock_item_stage_id,
    stock_item.payload::jsonb stock_item_payload,
    stock_request.id stock_request_stage_id,
    stock_request.payload::jsonb stock_request_payload
  from links
  left join public.koper_staging_records stock_item
    on stock_item.company_id=links.company_id and stock_item.source='koper' and stock_item.entity='stock_request_item'
   and stock_item.koper_id=links.product_request_id
  left join public.koper_staging_records stock_request
    on stock_request.company_id=links.company_id and stock_request.source='koper' and stock_request.entity='stock_request'
   and stock_request.koper_id=links.request_id
)
select
  count(*) links_total,
  count(distinct product_request_id) product_requests_distintos,
  count(distinct request_id) requests_distintos,
  count(*) filter (where product_request_id is null) links_sem_product_request_id,
  count(*) filter (where request_id is null) links_sem_request_id,
  count(*) filter (where stock_item_stage_id is not null) links_com_stock_item_stage,
  count(distinct product_request_id) filter (where stock_item_stage_id is not null) product_requests_com_stock_item_stage,
  count(*) filter (where stock_request_stage_id is not null) links_com_stock_request_stage,
  count(distinct request_id) filter (where stock_request_stage_id is not null) requests_com_stock_request_stage,
  count(*) filter (
    where jsonb_typeof(stock_item_payload->'services')='array'
      and jsonb_array_length(stock_item_payload->'services')>0
  ) stock_items_com_services,
  count(*) filter (where stock_item_stage_id is null) links_sem_stock_item_stage
from joined;

\echo '=== STATUS DOS REQUESTS DE PEDIDOS LEGADOS QUE JA ESTAO NO STAGING ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), request_ids as (
  select distinct poi.company_id, nullif(link.value->>'requestId','') request_id
  from base poi
  join public.koper_staging_records item_stage
    on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item'
   and item_stage.koper_id=split_part(poi.source_id,':',1)
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(item_stage.payload::jsonb->'requests')='array' then item_stage.payload::jsonb->'requests' else '[]'::jsonb end
  ) link(value)
), staged_requests as (
  select sr.payload::jsonb payload
  from request_ids r
  join public.koper_staging_records sr
    on sr.company_id=r.company_id and sr.source='koper' and sr.entity='stock_request' and sr.koper_id=r.request_id
)
select coalesce(nullif(payload->>'status',''), '(ausente)') status, count(*) requests
from staged_requests
group by 1
order by requests desc, status;
SQL

echo "Auditoria de cobertura pedido -> solicitação concluída em modo somente leitura."
