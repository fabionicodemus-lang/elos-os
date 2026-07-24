-- Elos OS — Engenharia: preços e cotações dos insumos
-- Histórico comercial separado do cadastro técnico.

begin;

create table if not exists public.engineering_input_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  input_id uuid not null references public.engineering_inputs(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  price_date date not null default current_date,
  unit_price numeric(18,6) not null default 0 check (unit_price >= 0),
  freight_unit_cost numeric(18,6) not null default 0 check (freight_unit_cost >= 0),
  other_unit_cost numeric(18,6) not null default 0 check (other_unit_cost >= 0),
  discount_percentage numeric(9,4) not null default 0
    check (discount_percentage >= 0 and discount_percentage <= 100),
  final_unit_price numeric(18,6) generated always as (
    (unit_price * (1 - discount_percentage / 100.0))
    + freight_unit_cost
    + other_unit_cost
  ) stored,
  currency text not null default 'BRL',
  is_adopted boolean not null default false,
  source text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineering_input_prices_company_date_idx
  on public.engineering_input_prices(company_id, status, price_date desc);
create index if not exists engineering_input_prices_input_idx
  on public.engineering_input_prices(input_id, status, is_adopted, price_date desc);
create index if not exists engineering_input_prices_supplier_idx
  on public.engineering_input_prices(supplier_id, price_date desc)
  where supplier_id is not null;
create index if not exists engineering_input_prices_project_idx
  on public.engineering_input_prices(project_id, input_id, price_date desc)
  where project_id is not null;

-- Uma referência adotada por insumo no catálogo corporativo.
create unique index if not exists engineering_input_prices_adopted_corporate_uq
  on public.engineering_input_prices(company_id, input_id)
  where is_adopted = true and status = 'active' and project_id is null;

-- Uma referência adotada por insumo em cada obra.
create unique index if not exists engineering_input_prices_adopted_project_uq
  on public.engineering_input_prices(company_id, project_id, input_id)
  where is_adopted = true and status = 'active' and project_id is not null;

insert into public.permissions (key, module, action, description) values
  ('prices.view', 'engineering_input_prices', 'view', 'Visualizar preços e cotações dos insumos'),
  ('prices.manage', 'engineering_input_prices', 'manage', 'Criar, editar e adotar preços dos insumos')
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
      when role.key in ('owner', 'admin', 'director', 'engineering', 'procurement') then
        array['prices.view', 'prices.manage']::text[]
      when role.key in ('finance', 'viewer') then
        array['prices.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_input_prices enable row level security;

drop policy if exists engineering_input_prices_select on public.engineering_input_prices;
create policy engineering_input_prices_select on public.engineering_input_prices
for select using (
  public.has_company_permission(company_id, 'prices.view')
  or public.has_company_permission(company_id, 'prices.manage')
);

drop policy if exists engineering_input_prices_insert on public.engineering_input_prices;
create policy engineering_input_prices_insert on public.engineering_input_prices
for insert with check (
  public.has_company_permission(company_id, 'prices.manage')
);

drop policy if exists engineering_input_prices_update on public.engineering_input_prices;
create policy engineering_input_prices_update on public.engineering_input_prices
for update using (
  public.has_company_permission(company_id, 'prices.manage')
) with check (
  public.has_company_permission(company_id, 'prices.manage')
);

grant select, insert, update on public.engineering_input_prices to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'engineering_input_prices';
