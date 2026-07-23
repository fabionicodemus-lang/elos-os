-- Elos OS — Comercial: unidades e vendas
-- Execute após 20260722_0002_suppliers_clients.sql.

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  tower text,
  floor integer,
  type text,
  private_area numeric(12,2),
  total_area numeric(12,2),
  bedrooms integer,
  suites integer,
  parking_spaces integer,
  list_price numeric(16,2),
  status text not null default 'available' check (status in ('available', 'reserved', 'sold', 'inactive')),
  registry text,
  notes text,
  source_system text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code),
  unique (company_id, source_system, source_id)
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  client_id uuid not null references public.clients(id),
  number text not null,
  source_code text,
  contract_number text,
  sale_date date not null,
  total_amount numeric(16,2) not null check (total_amount >= 0),
  commission_pct numeric(8,4) not null default 0,
  commission_amount numeric(16,2) not null default 0,
  broker_name text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  payment_plan_available boolean not null default false,
  notes text,
  source_system text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, source_id)
);

create index if not exists units_company_project_status_idx on public.units(company_id, project_id, status);
create index if not exists units_project_code_idx on public.units(project_id, code);
create index if not exists sales_company_project_date_idx on public.sales(company_id, project_id, sale_date desc);
create index if not exists sales_client_idx on public.sales(client_id);
create index if not exists sales_unit_idx on public.sales(unit_id);
create index if not exists sales_status_idx on public.sales(company_id, status);
create unique index if not exists sales_one_active_per_unit_idx on public.sales(unit_id) where status = 'active';

insert into public.permissions (key, module, action, description) values
  ('sales.view', 'commercial', 'view_sales', 'Visualizar vendas e unidades comercializadas'),
  ('sales.manage', 'commercial', 'manage_sales', 'Criar, editar e cancelar vendas')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select role.id, permission_key
from public.roles role
cross join lateral (
  select unnest(
    case
      when role.key in ('owner', 'admin', 'director', 'commercial') then
        array['sales.view', 'sales.manage']::text[]
      when role.key in ('finance', 'engineering', 'viewer') then
        array['sales.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.units enable row level security;
alter table public.sales enable row level security;

drop policy if exists units_select on public.units;
create policy units_select on public.units
for select using (
  public.has_company_permission(company_id, 'sales.view')
  or public.has_company_permission(company_id, 'sales.manage')
);

drop policy if exists units_insert on public.units;
create policy units_insert on public.units
for insert with check (public.has_company_permission(company_id, 'sales.manage'));

drop policy if exists units_update on public.units;
create policy units_update on public.units
for update using (public.has_company_permission(company_id, 'sales.manage'))
with check (public.has_company_permission(company_id, 'sales.manage'));

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
for select using (
  public.has_company_permission(company_id, 'sales.view')
  or public.has_company_permission(company_id, 'sales.manage')
);

drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales
for insert with check (public.has_company_permission(company_id, 'sales.manage'));

drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales
for update using (public.has_company_permission(company_id, 'sales.manage'))
with check (public.has_company_permission(company_id, 'sales.manage'));

create or replace function public.sales_summary(p_company_id uuid, p_project_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total_count', count(*),
    'active_count', count(*) filter (where status = 'active'),
    'cancelled_count', count(*) filter (where status = 'cancelled'),
    'total_amount', coalesce(sum(total_amount) filter (where status = 'active'), 0),
    'average_ticket', coalesce(avg(total_amount) filter (where status = 'active'), 0),
    'payment_plan_missing_count', count(*) filter (where status = 'active' and payment_plan_available = false)
  )
  from public.sales
  where company_id = p_company_id
    and (p_project_id is null or project_id = p_project_id)
    and (
      public.has_company_permission(company_id, 'sales.view')
      or public.has_company_permission(company_id, 'sales.manage')
    );
$$;

grant select, insert, update on public.units to authenticated;
grant select, insert, update on public.sales to authenticated;
grant execute on function public.sales_summary(uuid, uuid) to authenticated;
