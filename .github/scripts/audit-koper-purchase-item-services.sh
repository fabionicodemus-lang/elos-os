#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL não configurada."
  exit 1
fi
export PGSSLMODE="${PGSSLMODE:-require}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== AUDITORIA 3: SERVICES PRESERVADO NOS ITENS DE PEDIDO KOPER ==='
with flow as (
  select id, company_id
  from public.projects
  where name ilike '%Flow%' and status <> 'archived'
  order by created_at
  limit 1
), legacy as (
  select s.id
  from public.engineering_services s
  join flow on flow.company_id=s.company_id
  where s.code='KOPER-SR-LEGACY'
  order by s.updated_at desc nulls last
  limit 1
), base as (
  select poi.*
  from public.procurement_purchase_order_items poi
  join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), staged as (
  select poi.id poi_id, item_stage.koper_id order_product_id, item_stage.payload::jsonb payload
  from base poi
  left join public.koper_staging_records item_stage
    on item_stage.company_id=poi.company_id
   and item_stage.source='koper'
   and item_stage.entity='purchase_order_item'
   and item_stage.koper_id=split_part(poi.source_id,':',1)
)
select
  count(*) legacy_total,
  count(*) filter (where payload is not null) staging_encontrado,
  count(*) filter (where payload ? 'services') com_chave_services,
  count(*) filter (where jsonb_typeof(payload->'services')='array') services_array,
  count(*) filter (where jsonb_typeof(payload->'services')='array' and jsonb_array_length(payload->'services')>0) services_array_nao_vazio,
  count(*) filter (where jsonb_typeof(payload->'requests')='array' and jsonb_array_length(payload->'requests')>0) requests_array_nao_vazio
from staged;

\echo '=== CHAVES DOS OBJETOS products[].services (nomes apenas) ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), staged as (
  select item_stage.payload::jsonb payload
  from base poi
  join public.koper_staging_records item_stage
    on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item'
   and item_stage.koper_id=split_part(poi.source_id,':',1)
), service_objects as (
  select svc.value service_payload
  from staged
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'services')='array' then payload->'services' else '[]'::jsonb end
  ) svc(value)
  where jsonb_typeof(svc.value)='object'
)
select key, count(*) ocorrencias
from service_objects
cross join lateral jsonb_object_keys(service_payload) key
group by key
order by ocorrencias desc, key;

\echo '=== AMOSTRA TECNICA DE products[].services (sem dados pessoais/comerciais) ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), staged as (
  select item_stage.koper_id order_product_id, item_stage.payload::jsonb payload
  from base poi
  join public.koper_staging_records item_stage
    on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item'
   and item_stage.koper_id=split_part(poi.source_id,':',1)
), service_objects as (
  select staged.order_product_id, svc.ordinality service_index, svc.value service_payload
  from staged
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'services')='array' then payload->'services' else '[]'::jsonb end
  ) with ordinality svc(value, ordinality)
  where jsonb_typeof(svc.value)='object'
), technical as (
  select order_product_id, service_index,
    coalesce(jsonb_object_agg(entry.key, entry.value) filter (
      where lower(entry.key) ~ '(id|service|monitor|budget|input|amount|quantity|cost|center)'
    ), '{}'::jsonb) technical_payload
  from service_objects
  cross join lateral jsonb_each(service_payload) entry(key,value)
  group by order_product_id, service_index
)
select order_product_id, service_index, technical_payload
from technical
where technical_payload <> '{}'::jsonb
order by order_product_id::bigint nulls last, service_index
limit 20;

\echo '=== TESTE DE-PARA DIRETO: IDs EM services CONTRA engineering_services.source_id ==='
with flow as (
  select id, company_id from public.projects where name ilike '%Flow%' and status <> 'archived' order by created_at limit 1
), legacy as (
  select s.id from public.engineering_services s join flow on flow.company_id=s.company_id where s.code='KOPER-SR-LEGACY' order by s.updated_at desc nulls last limit 1
), budget_services as (
  select distinct bi.service_id
  from public.engineering_budget_items bi
  join public.engineering_budgets b on b.id=bi.budget_id
  join flow on flow.id=bi.project_id and flow.company_id=bi.company_id
  where bi.status='active' and bi.service_id is not null and b.status <> 'archived'
), base as (
  select poi.* from public.procurement_purchase_order_items poi join flow on flow.id=poi.project_id and flow.company_id=poi.company_id
  where poi.source_system='koper' and poi.cost_center_service_id=(select id from legacy)
), staged as (
  select poi.id poi_id, poi.company_id, item_stage.payload::jsonb payload
  from base poi
  join public.koper_staging_records item_stage
    on item_stage.company_id=poi.company_id and item_stage.source='koper' and item_stage.entity='purchase_order_item'
   and item_stage.koper_id=split_part(poi.source_id,':',1)
), candidate_ids as (
  select staged.poi_id, staged.company_id, entry.value #>> '{}' candidate_id, entry.key origin_key
  from staged
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'services')='array' then payload->'services' else '[]'::jsonb end
  ) svc(value)
  cross join lateral jsonb_each(svc.value) entry(key,value)
  where jsonb_typeof(svc.value)='object'
    and jsonb_typeof(entry.value) in ('string','number')
    and lower(entry.key) ~ '(service.*id|^serviceid$|costcenterid)'
), matches as (
  select distinct c.poi_id, s.id service_id, c.origin_key
  from candidate_ids c
  join public.engineering_services s
    on s.company_id=c.company_id and s.source_system='koper' and s.source_id=c.candidate_id
  where s.id<>(select id from legacy)
)
select
  count(distinct poi_id) itens_resolvidos_direto,
  count(distinct poi_id) filter (where service_id in (select service_id from budget_services)) resolvidos_presentes_no_orcamento,
  count(distinct service_id) servicos_distintos,
  string_agg(distinct origin_key, ', ' order by origin_key) chaves_que_resolveram
from matches;
SQL

echo "Auditoria de services dos itens de pedido concluída em modo somente leitura."
