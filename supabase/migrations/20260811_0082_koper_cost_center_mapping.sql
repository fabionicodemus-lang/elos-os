-- Elos OS — V0.72.6
-- De-para interno entre o centro de custo original do Koper e o serviço do Elos OS.
-- O código original permanece gravado em cost_center_code; somente o service_id é resolvido.

begin;

create table if not exists public.engineering_cost_center_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_system text not null default 'koper'
    check (source_system <> '' and source_system = lower(btrim(source_system))),
  source_code text not null
    check (source_code <> '' and source_code = lower(btrim(source_code))),
  source_name text,
  service_id uuid not null references public.engineering_services(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, source_system, source_code)
);

create index if not exists engineering_cost_center_mappings_service_idx
  on public.engineering_cost_center_mappings(company_id, project_id, service_id);

comment on table public.engineering_cost_center_mappings is
  'De-para interno. Mantém o código original do sistema de origem separado do código visível do item do orçamento.';
comment on column public.engineering_cost_center_mappings.source_code is
  'Código normalizado do centro de custo no sistema de origem. Não é o código exibido no orçamento.';

alter table public.engineering_cost_center_mappings enable row level security;
revoke all on public.engineering_cost_center_mappings from anon, authenticated;

create or replace function public.resolve_engineering_cost_center_service(
  p_company_id uuid,
  p_project_id uuid,
  p_source_system text,
  p_source_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text := coalesce(nullif(lower(btrim(p_source_system)), ''), 'koper');
  v_source_code text := lower(btrim(coalesce(p_source_code, '')));
  v_service_id uuid;
begin
  if p_company_id is null or p_project_id is null or v_source_code = '' then
    return null;
  end if;

  select mapping.service_id
    into v_service_id
  from public.engineering_cost_center_mappings mapping
  join public.engineering_services service
    on service.id = mapping.service_id
   and service.company_id = p_company_id
  where mapping.company_id = p_company_id
    and mapping.project_id = p_project_id
    and mapping.source_system = v_source_system
    and mapping.source_code = v_source_code
  limit 1;

  if v_service_id is not null then
    return v_service_id;
  end if;

  -- Alguns registros históricos não guardavam source_system. Nesses casos o código
  -- continua sendo suficiente, sempre respeitando empresa e empreendimento.
  select mapping.service_id
    into v_service_id
  from public.engineering_cost_center_mappings mapping
  join public.engineering_services service
    on service.id = mapping.service_id
   and service.company_id = p_company_id
  where mapping.company_id = p_company_id
    and mapping.project_id = p_project_id
    and mapping.source_code = v_source_code
  order by case when mapping.source_system = 'koper' then 0 else 1 end,
           mapping.updated_at desc
  limit 1;

  if v_service_id is not null then
    return v_service_id;
  end if;

  -- Fallback para o catálogo técnico importado: código ou ID original do Koper.
  select service.id
    into v_service_id
  from public.engineering_services service
  where service.company_id = p_company_id
    and (
      lower(btrim(service.code)) = v_source_code
      or lower(btrim(coalesce(service.source_id, ''))) = v_source_code
    )
  order by case when lower(btrim(coalesce(service.source_system, ''))) = 'koper' then 0 else 1 end,
           service.updated_at desc nulls last,
           service.id
  limit 1;

  return v_service_id;
end;
$$;

create or replace function public.remember_engineering_cost_center_mapping(
  p_company_id uuid,
  p_project_id uuid,
  p_source_system text,
  p_source_code text,
  p_source_name text,
  p_service_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text := coalesce(nullif(lower(btrim(p_source_system)), ''), 'koper');
  v_source_code text := lower(btrim(coalesce(p_source_code, '')));
begin
  if p_company_id is null
     or p_project_id is null
     or p_service_id is null
     or v_source_code = '' then
    return;
  end if;

  if not exists (
    select 1
    from public.engineering_services service
    where service.id = p_service_id
      and service.company_id = p_company_id
  ) then
    raise exception 'Serviço do de-para não pertence à empresa informada.';
  end if;

  insert into public.engineering_cost_center_mappings (
    company_id,
    project_id,
    source_system,
    source_code,
    source_name,
    service_id
  ) values (
    p_company_id,
    p_project_id,
    v_source_system,
    v_source_code,
    nullif(btrim(p_source_name), ''),
    p_service_id
  )
  on conflict (company_id, project_id, source_system, source_code)
  do update set
    source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
    service_id = excluded.service_id,
    updated_at = now();
end;
$$;

create or replace function public.resolve_engineering_cost_center_mapping_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text;
  v_source_code text;
  v_source_name text;
  v_service_id uuid;
begin
  v_source_system := coalesce(
    nullif(lower(btrim(to_jsonb(new) ->> 'source_system')), ''),
    'koper'
  );
  v_source_code := btrim(coalesce(to_jsonb(new) ->> 'cost_center_code', ''));
  v_source_name := nullif(btrim(to_jsonb(new) ->> 'cost_center_name'), '');
  v_service_id := nullif(to_jsonb(new) ->> 'cost_center_service_id', '')::uuid;

  if v_service_id is null and v_source_code <> '' then
    v_service_id := public.resolve_engineering_cost_center_service(
      new.company_id,
      new.project_id,
      v_source_system,
      v_source_code
    );

    if v_service_id is not null then
      new.cost_center_service_id := v_service_id;
    end if;
  end if;

  if new.cost_center_service_id is not null and v_source_code <> '' then
    perform public.remember_engineering_cost_center_mapping(
      new.company_id,
      new.project_id,
      v_source_system,
      v_source_code,
      v_source_name,
      new.cost_center_service_id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.resolve_engineering_cost_center_service(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.remember_engineering_cost_center_mapping(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.resolve_engineering_cost_center_mapping_trigger() from public, anon, authenticated;

-- 1) O próprio orçamento ensina o vínculo do serviço técnico usado naquele empreendimento.
insert into public.engineering_cost_center_mappings (
  company_id,
  project_id,
  source_system,
  source_code,
  source_name,
  service_id
)
select distinct
  item.company_id,
  item.project_id,
  'koper',
  lower(btrim(service.code)),
  service.description,
  service.id
from public.engineering_budget_items item
join public.engineering_services service
  on service.id = item.service_id
 and service.company_id = item.company_id
where item.service_id is not null
  and btrim(coalesce(service.code, '')) <> ''
on conflict (company_id, project_id, source_system, source_code)
do update set
  source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
  service_id = excluded.service_id,
  updated_at = now();

-- Também mantém o ID original do serviço Koper como alias interno quando disponível.
insert into public.engineering_cost_center_mappings (
  company_id,
  project_id,
  source_system,
  source_code,
  source_name,
  service_id
)
select distinct
  item.company_id,
  item.project_id,
  'koper',
  lower(btrim(service.source_id)),
  service.description,
  service.id
from public.engineering_budget_items item
join public.engineering_services service
  on service.id = item.service_id
 and service.company_id = item.company_id
where item.service_id is not null
  and btrim(coalesce(service.source_id, '')) <> ''
  and lower(btrim(coalesce(service.source_system, ''))) = 'koper'
on conflict (company_id, project_id, source_system, source_code)
do update set
  source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
  service_id = excluded.service_id,
  updated_at = now();

-- 2) Registros históricos que já tinham código + service_id são a fonte mais forte do de-para.
insert into public.engineering_cost_center_mappings (
  company_id,
  project_id,
  source_system,
  source_code,
  source_name,
  service_id
)
select distinct on (
  item.company_id,
  item.project_id,
  coalesce(nullif(lower(btrim(item.source_system)), ''), 'koper'),
  lower(btrim(item.cost_center_code))
)
  item.company_id,
  item.project_id,
  coalesce(nullif(lower(btrim(item.source_system)), ''), 'koper'),
  lower(btrim(item.cost_center_code)),
  item.cost_center_name,
  item.cost_center_service_id
from public.procurement_purchase_order_items item
where item.cost_center_service_id is not null
  and btrim(coalesce(item.cost_center_code, '')) <> ''
order by
  item.company_id,
  item.project_id,
  coalesce(nullif(lower(btrim(item.source_system)), ''), 'koper'),
  lower(btrim(item.cost_center_code)),
  item.id desc
on conflict (company_id, project_id, source_system, source_code)
do update set
  source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
  service_id = excluded.service_id,
  updated_at = now();

insert into public.engineering_cost_center_mappings (
  company_id,
  project_id,
  source_system,
  source_code,
  source_name,
  service_id
)
select distinct on (movement.company_id, movement.project_id, lower(btrim(movement.cost_center_code)))
  movement.company_id,
  movement.project_id,
  'koper',
  lower(btrim(movement.cost_center_code)),
  movement.cost_center_name,
  movement.cost_center_service_id
from public.procurement_inventory_movements movement
where movement.cost_center_service_id is not null
  and btrim(coalesce(movement.cost_center_code, '')) <> ''
order by movement.company_id, movement.project_id, lower(btrim(movement.cost_center_code)), movement.id desc
on conflict (company_id, project_id, source_system, source_code)
do update set
  source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
  service_id = excluded.service_id,
  updated_at = now();

insert into public.engineering_cost_center_mappings (
  company_id,
  project_id,
  source_system,
  source_code,
  source_name,
  service_id
)
select distinct on (item.company_id, item.project_id, lower(btrim(item.cost_center_code)))
  item.company_id,
  item.project_id,
  'koper',
  lower(btrim(item.cost_center_code)),
  item.cost_center_name,
  item.cost_center_service_id
from public.execution_material_request_items item
where item.cost_center_service_id is not null
  and btrim(coalesce(item.cost_center_code, '')) <> ''
order by item.company_id, item.project_id, lower(btrim(item.cost_center_code)), item.id desc
on conflict (company_id, project_id, source_system, source_code)
do update set
  source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
  service_id = excluded.service_id,
  updated_at = now();

-- 3) Recupera a apropriação dos históricos sem apagar ou trocar o código original do Koper.
update public.procurement_purchase_order_items item
set cost_center_service_id = public.resolve_engineering_cost_center_service(
  item.company_id,
  item.project_id,
  coalesce(nullif(item.source_system, ''), 'koper'),
  item.cost_center_code
)
where item.cost_center_service_id is null
  and btrim(coalesce(item.cost_center_code, '')) <> ''
  and public.resolve_engineering_cost_center_service(
    item.company_id,
    item.project_id,
    coalesce(nullif(item.source_system, ''), 'koper'),
    item.cost_center_code
  ) is not null;

update public.procurement_inventory_movements movement
set cost_center_service_id = public.resolve_engineering_cost_center_service(
  movement.company_id,
  movement.project_id,
  'koper',
  movement.cost_center_code
)
where movement.cost_center_service_id is null
  and btrim(coalesce(movement.cost_center_code, '')) <> ''
  and public.resolve_engineering_cost_center_service(
    movement.company_id,
    movement.project_id,
    'koper',
    movement.cost_center_code
  ) is not null;

update public.execution_material_request_items item
set cost_center_service_id = public.resolve_engineering_cost_center_service(
  item.company_id,
  item.project_id,
  'koper',
  item.cost_center_code
)
where item.cost_center_service_id is null
  and btrim(coalesce(item.cost_center_code, '')) <> ''
  and public.resolve_engineering_cost_center_service(
    item.company_id,
    item.project_id,
    'koper',
    item.cost_center_code
  ) is not null;

-- 4) Novos registros aprendem ou recuperam automaticamente o vínculo.
drop trigger if exists procurement_purchase_order_items_cost_center_mapping
  on public.procurement_purchase_order_items;
create trigger procurement_purchase_order_items_cost_center_mapping
before insert or update of cost_center_service_id, cost_center_code, cost_center_name, source_system
on public.procurement_purchase_order_items
for each row execute function public.resolve_engineering_cost_center_mapping_trigger();

drop trigger if exists procurement_inventory_movements_cost_center_mapping
  on public.procurement_inventory_movements;
create trigger procurement_inventory_movements_cost_center_mapping
before insert or update of cost_center_service_id, cost_center_code, cost_center_name
on public.procurement_inventory_movements
for each row execute function public.resolve_engineering_cost_center_mapping_trigger();

drop trigger if exists execution_material_request_items_cost_center_mapping
  on public.execution_material_request_items;
create trigger execution_material_request_items_cost_center_mapping
before insert or update of cost_center_service_id, cost_center_code, cost_center_name
on public.execution_material_request_items
for each row execute function public.resolve_engineering_cost_center_mapping_trigger();

commit;
