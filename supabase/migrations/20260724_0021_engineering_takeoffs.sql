-- Elos OS — Engenharia: levantamento de quantitativos
-- Memórias rastreáveis por revisão, serviço e local da obra.

begin;

create table if not exists public.engineering_takeoff_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  code text not null,
  name text not null,
  location_type text not null default 'floor'
    check (location_type in ('enterprise', 'tower', 'floor', 'unit', 'room', 'sector', 'external', 'other')),
  repetitions numeric(18,4) not null default 1 check (repetitions > 0),
  sort_order integer not null default 0,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

create table if not exists public.engineering_takeoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete cascade,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  method text not null default 'area'
    check (method in ('unit', 'count', 'length', 'area', 'volume', 'weight', 'custom')),
  element_count numeric(18,6) not null default 1 check (element_count >= 0),
  dimension_a numeric(18,6),
  dimension_b numeric(18,6),
  dimension_c numeric(18,6),
  adjustment numeric(18,6) not null default 0,
  location_repetitions_snapshot numeric(18,6) not null default 1 check (location_repetitions_snapshot > 0),
  repetition_override numeric(18,6) check (repetition_override is null or repetition_override > 0),
  repetition_reason text,
  quantity_per_location numeric(18,6) not null default 0,
  total_quantity numeric(18,6) not null default 0,
  formula text not null,
  unit_snapshot text not null,
  source_reference text,
  project_revision text,
  description text,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved')),
  record_status text not null default 'active' check (record_status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineering_takeoff_locations_project_idx
  on public.engineering_takeoff_locations(project_id, status, sort_order, code);
create index if not exists engineering_takeoff_locations_parent_idx
  on public.engineering_takeoff_locations(parent_id)
  where parent_id is not null;
create index if not exists engineering_takeoffs_budget_idx
  on public.engineering_takeoffs(budget_id, record_status, status, updated_at desc);
create index if not exists engineering_takeoffs_project_service_idx
  on public.engineering_takeoffs(project_id, service_id, record_status);
create index if not exists engineering_takeoffs_location_idx
  on public.engineering_takeoffs(location_id, record_status)
  where location_id is not null;

insert into public.permissions (key, module, action, description) values
  ('takeoffs.view', 'engineering_takeoffs', 'view', 'Visualizar levantamentos e memórias de cálculo'),
  ('takeoffs.manage', 'engineering_takeoffs', 'manage', 'Criar e editar levantamentos e memórias de cálculo')
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
        array['takeoffs.view', 'takeoffs.manage']::text[]
      when role.key in ('finance', 'viewer', 'procurement') then
        array['takeoffs.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_takeoff_locations enable row level security;
alter table public.engineering_takeoffs enable row level security;

drop policy if exists engineering_takeoff_locations_select on public.engineering_takeoff_locations;
create policy engineering_takeoff_locations_select on public.engineering_takeoff_locations
for select using (
  public.has_company_permission(company_id, 'takeoffs.view')
  or public.has_company_permission(company_id, 'takeoffs.manage')
);

drop policy if exists engineering_takeoff_locations_insert on public.engineering_takeoff_locations;
create policy engineering_takeoff_locations_insert on public.engineering_takeoff_locations
for insert with check (
  public.has_company_permission(company_id, 'takeoffs.manage')
);

drop policy if exists engineering_takeoff_locations_update on public.engineering_takeoff_locations;
create policy engineering_takeoff_locations_update on public.engineering_takeoff_locations
for update using (
  public.has_company_permission(company_id, 'takeoffs.manage')
) with check (
  public.has_company_permission(company_id, 'takeoffs.manage')
);

drop policy if exists engineering_takeoffs_select on public.engineering_takeoffs;
create policy engineering_takeoffs_select on public.engineering_takeoffs
for select using (
  public.has_company_permission(company_id, 'takeoffs.view')
  or public.has_company_permission(company_id, 'takeoffs.manage')
);

drop policy if exists engineering_takeoffs_insert on public.engineering_takeoffs;
create policy engineering_takeoffs_insert on public.engineering_takeoffs
for insert with check (
  public.has_company_permission(company_id, 'takeoffs.manage')
);

drop policy if exists engineering_takeoffs_update on public.engineering_takeoffs;
create policy engineering_takeoffs_update on public.engineering_takeoffs
for update using (
  public.has_company_permission(company_id, 'takeoffs.manage')
) with check (
  public.has_company_permission(company_id, 'takeoffs.manage')
);

grant select, insert, update on public.engineering_takeoff_locations to authenticated;
grant select, insert, update on public.engineering_takeoffs to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('engineering_takeoff_locations', 'engineering_takeoffs')
order by table_name;
