#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL não configurada."
  exit 1
fi
export PGSSLMODE="${PGSSLMODE:-require}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== AUDITORIA 6: SEMANTICA DOS IDs DE ALOCACAO KOPER ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), allocations as (
  select distinct
    poi.company_id,
    nullif(link.value->>'itemMonitInputId','') item_monit_input_id,
    nullif(link.value->>'monitInputPchId','') monit_input_pch_id
  from base poi
  join public.koper_staging_records sr
    on sr.company_id=poi.company_id and sr.source='koper' and sr.entity='stock_request_item'
   and sr.koper_id=nullif(split_part(poi.source_id,':',2),'')
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(sr.payload::jsonb->'services')='array' then sr.payload::jsonb->'services' else '[]'::jsonb end
  ) link(value)
), budget_scalars as (
  select bi.company_id, bi.koper_id budget_koper_id, e.key, e.value #>> '{}' scalar_value
  from public.koper_staging_records bi
  cross join lateral jsonb_each(bi.payload::jsonb) e(key,value)
  join flow on flow.company_id=bi.company_id
  where bi.source='koper' and bi.entity='budget_item'
    and jsonb_typeof(e.value) in ('string','number','boolean')
), matches as (
  select 'itemMonitInputId' origin, bs.key budget_field, count(*) matches, count(distinct a.item_monit_input_id) distinct_allocation_ids,
         count(distinct bs.budget_koper_id) distinct_budget_rows
  from allocations a join budget_scalars bs on bs.company_id=a.company_id and bs.scalar_value=a.item_monit_input_id
  where a.item_monit_input_id is not null
  group by bs.key
  union all
  select 'monitInputPchId' origin, bs.key budget_field, count(*) matches, count(distinct a.monit_input_pch_id),
         count(distinct bs.budget_koper_id)
  from allocations a join budget_scalars bs on bs.company_id=a.company_id and bs.scalar_value=a.monit_input_pch_id
  where a.monit_input_pch_id is not null
  group by bs.key
)
select * from matches
where matches > 0
order by origin, distinct_allocation_ids desc, matches desc, budget_field;

\echo '=== COBERTURA EXATA POR CAMPO CANDIDATO + serviceId ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), allocations as (
  select poi.id poi_id, poi.company_id,
    nullif(link.value->>'itemMonitInputId','') item_monit_input_id,
    nullif(link.value->>'monitInputPchId','') monit_input_pch_id
  from base poi
  join public.koper_staging_records sr
    on sr.company_id=poi.company_id and sr.source='koper' and sr.entity='stock_request_item'
   and sr.koper_id=nullif(split_part(poi.source_id,':',2),'')
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(sr.payload::jsonb->'services')='array' then sr.payload::jsonb->'services' else '[]'::jsonb end
  ) link(value)
), candidates as (
  select a.poi_id, 'itemMonitInputId' origin, e.key budget_field,
         nullif(bi.payload::jsonb->>'serviceId','') service_id
  from allocations a
  join public.koper_staging_records bi on bi.company_id=a.company_id and bi.source='koper' and bi.entity='budget_item'
  cross join lateral jsonb_each(bi.payload::jsonb) e(key,value)
  where a.item_monit_input_id is not null
    and jsonb_typeof(e.value) in ('string','number')
    and e.value #>> '{}' = a.item_monit_input_id
    and nullif(bi.payload::jsonb->>'serviceId','') is not null
  union all
  select a.poi_id, 'monitInputPchId', e.key,
         nullif(bi.payload::jsonb->>'serviceId','')
  from allocations a
  join public.koper_staging_records bi on bi.company_id=a.company_id and bi.source='koper' and bi.entity='budget_item'
  cross join lateral jsonb_each(bi.payload::jsonb) e(key,value)
  where a.monit_input_pch_id is not null
    and jsonb_typeof(e.value) in ('string','number')
    and e.value #>> '{}' = a.monit_input_pch_id
    and nullif(bi.payload::jsonb->>'serviceId','') is not null
), grouped as (
  select origin,budget_field,poi_id,count(distinct service_id) services
  from candidates group by origin,budget_field,poi_id
)
select origin,budget_field,
       count(*) itens_com_match,
       count(*) filter(where services=1) itens_univocos,
       count(*) filter(where services>1) itens_ambiguos,
       max(services) max_servicos_por_item
from grouped
group by origin,budget_field
order by itens_univocos desc, itens_com_match desc, origin,budget_field;

\echo '=== CHAVES E EXEMPLOS DO budget_item ==='
with flow as (
 select company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), rows as (
 select bi.koper_id, bi.payload::jsonb payload
 from public.koper_staging_records bi join flow on flow.company_id=bi.company_id
 where bi.source='koper' and bi.entity='budget_item'
)
select key, count(*) ocorrencias
from rows cross join lateral jsonb_object_keys(payload) key
group by key order by ocorrencias desc,key;
SQL

echo "Auditoria semântica concluída em modo somente leitura."
