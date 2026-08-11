\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

create table public.companies (
  id uuid primary key
);

create table public.projects (
  id uuid primary key,
  company_id uuid not null references public.companies(id)
);

create table public.engineering_services (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  code text not null,
  description text not null,
  source_system text not null default 'elos_os',
  source_id text,
  updated_at timestamptz not null default now()
);

create table public.engineering_budget_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  service_id uuid references public.engineering_services(id)
);

create table public.procurement_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  cost_center_service_id uuid references public.engineering_services(id),
  cost_center_code text,
  cost_center_name text,
  source_system text,
  source_id text
);

create table public.procurement_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  cost_center_service_id uuid references public.engineering_services(id),
  cost_center_code text,
  cost_center_name text
);

create table public.execution_material_request_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  cost_center_service_id uuid references public.engineering_services(id),
  cost_center_code text,
  cost_center_name text
);

insert into public.companies (id) values
  ('00000000-0000-0000-0000-000000000001');

insert into public.projects (id, company_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');

insert into public.engineering_services (
  id, company_id, code, description, source_system, source_id
) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'KOP-001', 'Fundação profunda', 'koper', '9001'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'KOP-002', 'Estrutura', 'koper', '9002');

insert into public.engineering_budget_items (
  company_id, project_id, service_id
) values
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');

-- Históricos sem service_id: a migration deve recuperar a apropriação sem trocar o código.
insert into public.procurement_purchase_order_items (
  company_id, project_id, cost_center_code, cost_center_name, source_system
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'KOP-001',
  'Fundação Koper',
  'koper'
);

insert into public.procurement_inventory_movements (
  company_id, project_id, cost_center_code, cost_center_name
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'KOP-001',
  'Fundação Koper'
);

insert into public.execution_material_request_items (
  company_id, project_id, cost_center_code, cost_center_name
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '9002',
  'Estrutura pelo ID original'
);

-- Um vínculo histórico conhecido deve ensinar um alias adicional do Koper.
insert into public.procurement_purchase_order_items (
  company_id, project_id, cost_center_service_id, cost_center_code, cost_center_name, source_system
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'KOPER-ALIAS-FUND',
  'Alias histórico',
  'koper'
);

\ir ../../supabase/migrations/20260811_0082_koper_cost_center_mapping.sql

-- Histórico recuperado e código original preservado.
do $$
begin
  if not exists (
    select 1
    from public.procurement_purchase_order_items
    where cost_center_code = 'KOP-001'
      and cost_center_service_id = '20000000-0000-0000-0000-000000000001'
  ) then
    raise exception '0082: pedido histórico KOP-001 não foi apropriado.';
  end if;

  if not exists (
    select 1
    from public.procurement_inventory_movements
    where cost_center_code = 'KOP-001'
      and cost_center_service_id = '20000000-0000-0000-0000-000000000001'
  ) then
    raise exception '0082: movimento de estoque histórico não foi apropriado.';
  end if;

  if not exists (
    select 1
    from public.execution_material_request_items
    where cost_center_code = '9002'
      and cost_center_service_id = '20000000-0000-0000-0000-000000000002'
  ) then
    raise exception '0082: ID original do serviço Koper não foi resolvido.';
  end if;
end $$;

-- Novos registros sem service_id devem usar o de-para automaticamente.
insert into public.procurement_purchase_order_items (
  company_id, project_id, cost_center_code, cost_center_name, source_system
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'KOPER-ALIAS-FUND',
  'Novo pedido pelo alias',
  'koper'
);

do $$
begin
  if not exists (
    select 1
    from public.procurement_purchase_order_items
    where cost_center_code = 'KOPER-ALIAS-FUND'
      and cost_center_name = 'Novo pedido pelo alias'
      and cost_center_service_id = '20000000-0000-0000-0000-000000000001'
  ) then
    raise exception '0082: trigger não resolveu alias conhecido.';
  end if;
end $$;

-- O de-para é isolado por empreendimento.
insert into public.procurement_purchase_order_items (
  company_id, project_id, cost_center_service_id, cost_center_code, cost_center_name, source_system
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002',
  'KOPER-ALIAS-FUND',
  'Mesmo código em outra obra',
  'koper'
);

insert into public.procurement_purchase_order_items (
  company_id, project_id, cost_center_code, cost_center_name, source_system
) values (
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'KOPER-ALIAS-FUND',
  'Resolver na segunda obra',
  'koper'
);

do $$
begin
  if not exists (
    select 1
    from public.procurement_purchase_order_items
    where project_id = '10000000-0000-0000-0000-000000000002'
      and cost_center_name = 'Resolver na segunda obra'
      and cost_center_code = 'KOPER-ALIAS-FUND'
      and cost_center_service_id = '20000000-0000-0000-0000-000000000002'
  ) then
    raise exception '0082: de-para não respeitou o empreendimento.';
  end if;

  if exists (
    select 1
    from public.procurement_purchase_order_items
    where cost_center_name = 'Resolver na segunda obra'
      and cost_center_code <> 'KOPER-ALIAS-FUND'
  ) then
    raise exception '0082: código original do Koper foi alterado.';
  end if;
end $$;

select
  (select count(*) from public.engineering_cost_center_mappings) as mappings,
  (select count(*) from public.procurement_purchase_order_items where cost_center_service_id is not null) as purchase_items_allocated,
  (select count(*) from public.procurement_inventory_movements where cost_center_service_id is not null) as inventory_allocated,
  (select count(*) from public.execution_material_request_items where cost_center_service_id is not null) as request_items_allocated;
