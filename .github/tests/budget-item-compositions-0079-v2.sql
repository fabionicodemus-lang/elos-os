\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000001'::uuid
$$;
create table public.companies (id uuid primary key);
create table public.projects (id uuid primary key, company_id uuid not null references public.companies(id));
create or replace function public.has_company_permission(uuid, text)
returns boolean language sql stable as $$ select true $$;

create table public.engineering_budgets (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  status text not null
);
create table public.engineering_services (
  id uuid primary key,
  company_id uuid not null references public.companies(id)
);
create table public.engineering_inputs (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  category text not null,
  status text not null
);
create table public.engineering_budget_items (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  budget_id uuid not null references public.engineering_budgets(id),
  service_id uuid references public.engineering_services(id),
  material_unit_cost numeric(18,6) not null default 0,
  labor_unit_cost numeric(18,6) not null default 0,
  equipment_unit_cost numeric(18,6) not null default 0,
  other_unit_cost numeric(18,6) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.engineering_service_compositions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  service_id uuid not null references public.engineering_services(id),
  status text not null
);
create table public.engineering_service_composition_items (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  composition_id uuid not null references public.engineering_service_compositions(id),
  input_id uuid not null references public.engineering_inputs(id),
  coefficient numeric(18,8) not null,
  waste_percentage numeric(9,4) not null default 0,
  effective_coefficient numeric(18,8) generated always as (
    coefficient * (1 + waste_percentage / 100.0)
  ) stored,
  sort_order integer not null default 0,
  notes text,
  status text not null
);
create table public.engineering_input_prices (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  input_id uuid not null references public.engineering_inputs(id),
  final_unit_price numeric(18,6) not null,
  price_date date not null,
  is_adopted boolean not null,
  status text not null,
  created_at timestamptz not null default now()
);

insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.companies values
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
insert into public.projects values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);
insert into public.engineering_budgets values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'approved'
);
insert into public.engineering_services values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);
insert into public.engineering_inputs values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'material', 'active'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'material', 'active');
insert into public.engineering_budget_items (
  id, company_id, project_id, budget_id, service_id,
  material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost,
  created_by
) values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  99, 0, 0, 0,
  '00000000-0000-0000-0000-000000000001'
);
insert into public.engineering_service_compositions values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'active'
);
insert into public.engineering_service_composition_items (
  id, company_id, composition_id, input_id,
  coefficient, waste_percentage, sort_order, notes, status
) values (
  '80000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  2, 10, 1, 'Base técnica', 'active'
);
insert into public.engineering_input_prices (
  id, company_id, project_id, input_id, final_unit_price,
  price_date, is_adopted, status
) values (
  '90000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  5, current_date, true, 'active'
);

\i supabase/migrations/20260804_0079_budget_item_compositions.sql

do $$
declare
  target_composition_id uuid;
  target_snapshot_item_id uuid;
  current_cost numeric;
begin
  select header.id into target_composition_id
  from public.engineering_budget_item_compositions header
  where header.budget_item_id = '60000000-0000-0000-0000-000000000001';

  if target_composition_id is null then
    raise exception 'Snapshot do item não foi criado';
  end if;

  select snapshot.id into target_snapshot_item_id
  from public.engineering_budget_item_composition_items snapshot
  where snapshot.composition_id = target_composition_id
    and snapshot.input_id = '50000000-0000-0000-0000-000000000001';

  if target_snapshot_item_id is null then
    raise exception 'Insumo da composição-base não foi copiado';
  end if;

  if not exists (
    select 1
    from public.engineering_budget_item_composition_items snapshot
    where snapshot.id = target_snapshot_item_id
      and snapshot.unit_price = 5
      and snapshot.coefficient = 2
      and snapshot.waste_percentage = 10
  ) then
    raise exception 'Snapshot não preservou coeficiente, perda e preço';
  end if;

  select material_unit_cost into current_cost
  from public.engineering_budget_items
  where id = '60000000-0000-0000-0000-000000000001';
  if current_cost <> 99 then
    raise exception 'A criação do snapshot alterou o orçamento existente';
  end if;

  perform public.save_engineering_budget_composition_item(
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    target_snapshot_item_id,
    '50000000-0000-0000-0000-000000000001',
    3, 10, 6, 1, 'Preço específico da revisão'
  );

  select material_unit_cost into current_cost
  from public.engineering_budget_items
  where id = '60000000-0000-0000-0000-000000000001';
  if current_cost <> 19.8 then
    raise exception 'Custo não recalculado: %', current_cost;
  end if;

  if not exists (
    select 1
    from public.engineering_service_composition_items
    where id = '80000000-0000-0000-0000-000000000001'
      and coefficient = 2
      and waste_percentage = 10
  ) then
    raise exception 'A composição corporativa foi alterada';
  end if;

  perform public.remove_engineering_budget_composition_item(
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    target_snapshot_item_id
  );

  select material_unit_cost into current_cost
  from public.engineering_budget_items
  where id = '60000000-0000-0000-0000-000000000001';
  if current_cost <> 0 then
    raise exception 'A exclusão não recalculou o custo';
  end if;

  begin
    perform public.save_engineering_budget_composition_item(
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      null,
      '50000000-0000-0000-0000-000000000002',
      1, 0, 1, 1, null
    );
    raise exception 'Insumo de outra empresa deveria ser bloqueado';
  exception when others then
    if position('Insumo não localizado' in sqlerrm) = 0 then raise; end if;
  end;
end;
$$;

insert into public.engineering_budget_items (
  id, company_id, project_id, budget_id, service_id,
  material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost,
  created_by
) values (
  '60000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  50, 0, 0, 0,
  '00000000-0000-0000-0000-000000000001'
);

do $$
begin
  if not exists (
    select 1
    from public.engineering_budget_item_compositions
    where budget_item_id = '60000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'O trigger não criou snapshot para novo item';
  end if;
end;
$$;

select 'budget-item-compositions-0079-ok' as result;
