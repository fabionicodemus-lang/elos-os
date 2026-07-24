-- Elos OS — Engenharia: catálogo técnico de serviços
-- Base única da incorporadora para composições, levantamentos e orçamentos.

begin;

create table if not exists public.engineering_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  description text not null,
  unit text not null default 'un',
  group_code text,
  default_method text not null default 'unit'
    check (default_method in ('unit', 'count', 'length', 'area', 'volume', 'weight', 'custom')),
  takeoff_rule text,
  measurement_rule text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'elos_os',
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, source_system, source_id)
);

create index if not exists engineering_services_company_status_idx
  on public.engineering_services(company_id, status, group_code, code);
create index if not exists engineering_services_description_idx
  on public.engineering_services(company_id, description);

alter table public.engineering_budget_items
  add column if not exists service_id uuid references public.engineering_services(id) on delete set null;

create index if not exists engineering_budget_items_service_idx
  on public.engineering_budget_items(service_id)
  where service_id is not null;

insert into public.permissions (key, module, action, description) values
  ('services.view', 'engineering_services', 'view', 'Visualizar o catálogo técnico de serviços'),
  ('services.manage', 'engineering_services', 'manage', 'Criar e editar o catálogo técnico de serviços')
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
      when role.key in ('owner', 'admin', 'director', 'engineering') then
        array['services.view', 'services.manage']::text[]
      when role.key in ('finance', 'viewer') then
        array['services.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_services enable row level security;

drop policy if exists engineering_services_select on public.engineering_services;
create policy engineering_services_select on public.engineering_services
for select using (
  public.has_company_permission(company_id, 'services.view')
  or public.has_company_permission(company_id, 'services.manage')
);

drop policy if exists engineering_services_insert on public.engineering_services;
create policy engineering_services_insert on public.engineering_services
for insert with check (
  public.has_company_permission(company_id, 'services.manage')
);

drop policy if exists engineering_services_update on public.engineering_services;
create policy engineering_services_update on public.engineering_services
for update using (
  public.has_company_permission(company_id, 'services.manage')
) with check (
  public.has_company_permission(company_id, 'services.manage')
);

grant select, insert, update on public.engineering_services to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'engineering_services';