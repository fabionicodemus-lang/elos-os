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
SQL

echo "Supabase 0082 aplicado e validado: código Koper preservado e vínculo interno recuperado."
