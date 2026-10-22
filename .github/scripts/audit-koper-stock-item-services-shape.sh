#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL não configurada."
  exit 1
fi
export PGSSLMODE="${PGSSLMODE:-require}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== AUDITORIA 5: ESTRUTURA services DO stock_request_item ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), stock as (
  select distinct sr.koper_id product_request_id, sr.payload::jsonb payload
  from base poi
  join public.koper_staging_records sr
    on sr.company_id=poi.company_id and sr.source='koper' and sr.entity='stock_request_item'
   and sr.koper_id=nullif(split_part(poi.source_id,':',2),'')
), service_objects as (
  select product_request_id, svc.ordinality service_index, svc.value service_payload
  from stock
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'services')='array' then payload->'services' else '[]'::jsonb end
  ) with ordinality svc(value, ordinality)
  where jsonb_typeof(svc.value)='object'
)
select key, count(*) ocorrencias
from service_objects
cross join lateral jsonb_object_keys(service_payload) key
group by key
order by ocorrencias desc, key;

\echo '=== 20 AMOSTRAS TECNICAS services DO stock_request_item ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), stock as (
  select distinct sr.koper_id product_request_id, sr.payload::jsonb payload
  from base poi
  join public.koper_staging_records sr
    on sr.company_id=poi.company_id and sr.source='koper' and sr.entity='stock_request_item'
   and sr.koper_id=nullif(split_part(poi.source_id,':',2),'')
), service_objects as (
  select product_request_id, svc.ordinality service_index, svc.value service_payload
  from stock
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'services')='array' then payload->'services' else '[]'::jsonb end
  ) with ordinality svc(value, ordinality)
  where jsonb_typeof(svc.value)='object'
), technical as (
  select product_request_id, service_index,
    coalesce(jsonb_object_agg(e.key,e.value) filter (
      where lower(e.key) ~ '(id|service|monitor|budget|input|amount|quantity|cost|center|stage|item)'
    ), '{}'::jsonb) technical_payload
  from service_objects
  cross join lateral jsonb_each(service_payload) e(key,value)
  group by product_request_id, service_index
)
select product_request_id, service_index, technical_payload
from technical
where technical_payload <> '{}'::jsonb
order by product_request_id::bigint nulls last, service_index
limit 20;

\echo '=== COBERTURA DOS IDs DE services CONTRA budget_item E engineering_services ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), objects as (
  select poi.id poi_id, poi.company_id, svc.value service_payload
  from base poi
  join public.koper_staging_records sr
    on sr.company_id=poi.company_id and sr.source='koper' and sr.entity='stock_request_item'
   and sr.koper_id=nullif(split_part(poi.source_id,':',2),'')
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(sr.payload::jsonb->'services')='array' then sr.payload::jsonb->'services' else '[]'::jsonb end
  ) svc(value)
  where jsonb_typeof(svc.value)='object'
), ids as (
  select objects.poi_id, objects.company_id, e.key origin_key, e.value #>> '{}' candidate_id
  from objects cross join lateral jsonb_each(service_payload) e(key,value)
  where jsonb_typeof(e.value) in ('string','number')
    and lower(e.key) ~ '(id|service|monitor|budget|input|item)'
), direct_service as (
  select distinct ids.poi_id, ids.origin_key, s.id service_id
  from ids join public.engineering_services s
    on s.company_id=ids.company_id and s.source_system='koper' and s.source_id=ids.candidate_id
  where s.id<>(select id from legacy)
), via_budget as (
  select distinct ids.poi_id, ids.origin_key, s.id service_id
  from ids
  join public.koper_staging_records bi
    on bi.company_id=ids.company_id and bi.source='koper' and bi.entity='budget_item'
   and (
        bi.koper_id=ids.candidate_id
     or nullif(bi.payload::jsonb->>'inputId','')=ids.candidate_id
     or nullif(bi.payload::jsonb->>'compositionId','')=ids.candidate_id
     or nullif(bi.payload::jsonb->>'itemMonitInputId','')=ids.candidate_id
     or nullif(bi.payload::jsonb->>'monitInputPchId','')=ids.candidate_id
   )
  join public.engineering_services s
    on s.company_id=ids.company_id and s.source_system='koper' and s.source_id=nullif(bi.payload::jsonb->>'serviceId','')
  where s.id<>(select id from legacy)
), unioned as (
  select 'direct_service' method, * from direct_service
  union all
  select 'via_budget' method, * from via_budget
)
select method, origin_key, count(distinct poi_id) itens_resolvidos, count(distinct service_id) servicos_distintos
from unioned
group by method,origin_key
order by itens_resolvidos desc, method, origin_key;
SQL

echo "Auditoria da estrutura services das solicitações concluída em modo somente leitura."
