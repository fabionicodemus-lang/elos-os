#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL não configurada."
  exit 1
fi

export PGSSLMODE="${PGSSLMODE:-require}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== AUDITORIA KOPER: itens de pedido e centro de custo ==='

with flow as (
  select id, company_id
  from public.projects
  where name ilike '%Flow%'
    and status <> 'archived'
  order by created_at
  limit 1
),
legacy as (
  select service.id
  from public.engineering_services service
  join flow on flow.company_id = service.company_id
  where service.code = 'KOPER-SR-LEGACY'
  order by service.updated_at desc nulls last
  limit 1
),
base as (
  select poi.*
  from public.procurement_purchase_order_items poi
  join flow on flow.id = poi.project_id and flow.company_id = poi.company_id
  where poi.source_system = 'koper'
)
select
  count(*) as koper_po_items,
  count(*) filter (where cost_center_service_id = (select id from legacy)) as itens_koper_sr_legacy,
  count(*) filter (where cost_center_code = 'KOPER-OC-LEGACY') as itens_koper_oc_legacy,
  count(*) filter (where cost_center_service_id is null) as sem_service_id
from base;

\echo '=== CANDIDATOS DE RECUPERACAO ==='
with flow as (
  select id, company_id
  from public.projects
  where name ilike '%Flow%'
    and status <> 'archived'
  order by created_at
  limit 1
),
legacy as (
  select service.id
  from public.engineering_services service
  join flow on flow.company_id = service.company_id
  where service.code = 'KOPER-SR-LEGACY'
  order by service.updated_at desc nulls last
  limit 1
),
budget_services as (
  select distinct item.service_id
  from public.engineering_budget_items item
  join public.engineering_budgets budget on budget.id = item.budget_id
  join flow on flow.id = item.project_id and flow.company_id = item.company_id
  where item.status = 'active'
    and item.service_id is not null
    and budget.status <> 'archived'
),
base as (
  select poi.*
  from public.procurement_purchase_order_items poi
  join flow on flow.id = poi.project_id and flow.company_id = poi.company_id
  where poi.source_system = 'koper'
    and poi.cost_center_service_id = (select id from legacy)
),
request_candidates as (
  select distinct
    poi.id as poi_id,
    mir.cost_center_service_id as service_id
  from base poi
  join public.execution_material_request_items mir on mir.id = poi.request_item_id
  where mir.cost_center_service_id is not null
    and mir.cost_center_service_id <> (select id from legacy)
),
purchase_candidates as (
  select distinct
    poi.id as poi_id,
    service.id as service_id
  from base poi
  join public.koper_staging_records stage
    on stage.company_id = poi.company_id
   and stage.source = 'koper'
   and stage.entity = 'purchase_order_item'
   and stage.koper_id = split_part(poi.source_id, ':', 1)
  join public.engineering_services service
    on service.company_id = poi.company_id
   and service.source_system = 'koper'
   and service.source_id = nullif(stage.payload::jsonb ->> 'costCenterId', '')
  where service.id <> (select id from legacy)
),
stock_links as (
  select
    poi.id as poi_id,
    nullif(link.value ->> 'itemMonitInputId', '') as item_monit_input_id,
    nullif(link.value ->> 'monitInputPchId', '') as monit_input_pch_id,
    case
      when (link.value ->> 'inputAmount') ~ '^-?[0-9]+([.,][0-9]+)?$'
        then replace(link.value ->> 'inputAmount', ',', '.')::numeric
      else null
    end as input_amount
  from base poi
  join public.koper_staging_records stock
    on stock.company_id = poi.company_id
   and stock.source = 'koper'
   and stock.entity = 'stock_request_item'
   and stock.koper_id = nullif(split_part(poi.source_id, ':', 2), '')
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(stock.payload::jsonb -> 'services') = 'array'
        then stock.payload::jsonb -> 'services'
      else '[]'::jsonb
    end
  ) as link(value)
),
stock_candidates_raw as (
  select distinct
    links.poi_id,
    service.id as service_id,
    links.input_amount
  from stock_links links
  join base poi on poi.id = links.poi_id
  join public.koper_staging_records budget_item
    on budget_item.company_id = poi.company_id
   and budget_item.source = 'koper'
   and budget_item.entity = 'budget_item'
   and (
        budget_item.koper_id = links.item_monit_input_id
     or budget_item.koper_id = links.monit_input_pch_id
     or nullif(budget_item.payload::jsonb ->> 'inputId', '') = links.item_monit_input_id
     or nullif(budget_item.payload::jsonb ->> 'inputId', '') = links.monit_input_pch_id
   )
  join public.engineering_services service
    on service.company_id = poi.company_id
   and service.source_system = 'koper'
   and service.source_id = nullif(budget_item.payload::jsonb ->> 'serviceId', '')
  where service.id <> (select id from legacy)
),
stock_per_item as (
  select
    poi_id,
    count(distinct service_id) as distinct_services,
    count(*) as candidate_links
  from stock_candidates_raw
  group by poi_id
),
all_resolved as (
  select poi_id from request_candidates
  union
  select poi_id from purchase_candidates
  union
  select poi_id from stock_per_item where distinct_services = 1
)
select
  (select count(*) from base) as legacy_total,
  (select count(distinct poi_id) from request_candidates) as via_request_item_real,
  (select count(distinct poi_id) from purchase_candidates) as via_purchase_cost_center_id,
  (select count(*) from stock_per_item where distinct_services = 1) as via_stock_chain_univoco,
  (select count(*) from stock_per_item where distinct_services > 1) as stock_chain_multiplos_servicos,
  (select count(*) from all_resolved) as recuperaveis_unicos_total,
  (select count(*) from base) - (select count(*) from all_resolved) as ainda_sem_resolucao,
  (select count(*) from all_resolved r where exists (select 1 from budget_services bs join (
      select poi_id, service_id from request_candidates
      union all select poi_id, service_id from purchase_candidates
      union all select raw.poi_id, raw.service_id from stock_candidates_raw raw join stock_per_item spi on spi.poi_id=raw.poi_id and spi.distinct_services=1
    ) c on c.poi_id=r.poi_id and c.service_id=bs.service_id)) as recuperaveis_presentes_em_orcamento;

\echo '=== DISTRIBUICAO DA CADEIA STOCK_REQUEST -> BUDGET_ITEM -> SERVICE ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select service.id from public.engineering_services service join flow on flow.company_id=service.company_id where service.code='KOPER-SR-LEGACY' order by service.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), links as (
  select poi.id poi_id, poi.source_id,
         nullif(link.value->>'itemMonitInputId','') item_monit_input_id,
         nullif(link.value->>'monitInputPchId','') monit_input_pch_id,
         case when (link.value->>'inputAmount') ~ '^-?[0-9]+([.,][0-9]+)?$' then replace(link.value->>'inputAmount',',','.')::numeric else null end input_amount
  from base poi
  join public.koper_staging_records stock on stock.company_id=poi.company_id and stock.source='koper' and stock.entity='stock_request_item'
       and stock.koper_id=nullif(split_part(poi.source_id,':',2),'')
  cross join lateral jsonb_array_elements(case when jsonb_typeof(stock.payload::jsonb->'services')='array' then stock.payload::jsonb->'services' else '[]'::jsonb end) link(value)
), candidates as (
  select distinct links.poi_id, service.id service_id, service.source_id koper_service_id, service.code service_code, links.input_amount
  from links
  join base poi on poi.id=links.poi_id
  join public.koper_staging_records bi on bi.company_id=poi.company_id and bi.source='koper' and bi.entity='budget_item'
   and (bi.koper_id=links.item_monit_input_id or bi.koper_id=links.monit_input_pch_id or nullif(bi.payload::jsonb->>'inputId','')=links.item_monit_input_id or nullif(bi.payload::jsonb->>'inputId','')=links.monit_input_pch_id)
  join public.engineering_services service on service.company_id=poi.company_id and service.source_system='koper' and service.source_id=nullif(bi.payload::jsonb->>'serviceId','')
  where service.id<>(select id from legacy)
), grouped as (
  select poi_id, count(distinct service_id) distinct_services, sum(coalesce(input_amount,0)) total_link_amount
  from candidates group by poi_id
)
select distinct_services, count(*) as itens, min(total_link_amount) as menor_soma_links, max(total_link_amount) as maior_soma_links
from grouped
group by distinct_services
order by distinct_services;

\echo '=== 3 EXEMPLOS DE CADEIA UNIVOCA (IDs técnicos, sem dados pessoais) ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select service.id from public.engineering_services service join flow on flow.company_id=service.company_id where service.code='KOPER-SR-LEGACY' order by service.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), candidates as (
  select distinct poi.id poi_id, split_part(poi.source_id,':',1) order_product_id,
    split_part(poi.source_id,':',2) product_request_id,
    service.source_id koper_service_id, service.code current_service_code
  from base poi
  join public.koper_staging_records stock on stock.company_id=poi.company_id and stock.source='koper' and stock.entity='stock_request_item' and stock.koper_id=nullif(split_part(poi.source_id,':',2),'')
  cross join lateral jsonb_array_elements(case when jsonb_typeof(stock.payload::jsonb->'services')='array' then stock.payload::jsonb->'services' else '[]'::jsonb end) link(value)
  join public.koper_staging_records bi on bi.company_id=poi.company_id and bi.source='koper' and bi.entity='budget_item' and (
       bi.koper_id=nullif(link.value->>'itemMonitInputId','') or bi.koper_id=nullif(link.value->>'monitInputPchId','')
       or nullif(bi.payload::jsonb->>'inputId','')=nullif(link.value->>'itemMonitInputId','')
       or nullif(bi.payload::jsonb->>'inputId','')=nullif(link.value->>'monitInputPchId',''))
  join public.engineering_services service on service.company_id=poi.company_id and service.source_system='koper' and service.source_id=nullif(bi.payload::jsonb->>'serviceId','')
  where service.id<>(select id from legacy)
), univocal as (
  select poi_id from candidates group by poi_id having count(distinct koper_service_id)=1
)
select c.poi_id, c.order_product_id, c.product_request_id, min(c.koper_service_id) koper_service_id, min(c.current_service_code) internal_service_code
from candidates c join univocal u on u.poi_id=c.poi_id
group by c.poi_id,c.order_product_id,c.product_request_id
order by c.poi_id
limit 3;

SQL

echo "Auditoria concluída em modo somente leitura."
