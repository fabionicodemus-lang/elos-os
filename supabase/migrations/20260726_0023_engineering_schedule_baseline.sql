-- Elos OS — Engenharia: cronograma físico e linha de base
-- Planejamento por serviço, local, produtividade, equipes e predecessoras.

begin;

create table if not exists public.engineering_schedule_baselines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete restrict,
  code text not null,
  name text not null,
  version text not null default 'LB-00',
  start_date date not null,
  work_on_saturday boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'archived')),
  notes text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code, version)
);

create table if not exists public.engineering_schedule_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade,
  service_id uuid references public.engineering_services(id) on delete set null,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  code text not null,
  name text not null,
  unit_snapshot text not null default 'un',
  quantity_snapshot numeric(18,6) not null default 0 check (quantity_snapshot >= 0),
  productivity_per_team_day numeric(18,6) not null default 1 check (productivity_per_team_day > 0),
  team_count numeric(12,4) not null default 1 check (team_count > 0),
  duration_days integer not null default 1 check (duration_days > 0),
  planned_start date not null,
  planned_finish date not null,
  planned_cost numeric(18,2) not null default 0 check (planned_cost >= 0),
  sort_order integer not null default 0,
  planning_status text not null default 'draft' check (planning_status in ('draft', 'reviewed', 'approved')),
  source text not null default 'manual' check (source in ('manual', 'takeoff')),
  notes text,
  record_status text not null default 'active' check (record_status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (baseline_id, code)
);

create table if not exists public.engineering_schedule_dependencies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade,
  predecessor_id uuid not null references public.engineering_schedule_activities(id) on delete cascade,
  successor_id uuid not null references public.engineering_schedule_activities(id) on delete cascade,
  relation_type text not null default 'FS' check (relation_type in ('FS', 'SS', 'FF', 'SF')),
  lag_days integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (baseline_id, predecessor_id, successor_id),
  check (predecessor_id <> successor_id)
);

create index if not exists engineering_schedule_baselines_project_idx
  on public.engineering_schedule_baselines(project_id, status, updated_at desc);
create index if not exists engineering_schedule_activities_baseline_idx
  on public.engineering_schedule_activities(baseline_id, record_status, planned_start, sort_order);
create index if not exists engineering_schedule_activities_service_location_idx
  on public.engineering_schedule_activities(service_id, location_id)
  where record_status = 'active';
create index if not exists engineering_schedule_dependencies_successor_idx
  on public.engineering_schedule_dependencies(successor_id, relation_type);

insert into public.permissions (key, module, action, description) values
  ('schedule.view', 'engineering_schedule', 'view', 'Visualizar cronograma físico e linha de base'),
  ('schedule.manage', 'engineering_schedule', 'manage', 'Criar e editar cronograma físico e linha de base')
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
        array['schedule.view', 'schedule.manage']::text[]
      when role.key in ('finance', 'viewer', 'procurement') then
        array['schedule.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_schedule_baselines enable row level security;
alter table public.engineering_schedule_activities enable row level security;
alter table public.engineering_schedule_dependencies enable row level security;

drop policy if exists engineering_schedule_baselines_select on public.engineering_schedule_baselines;
create policy engineering_schedule_baselines_select on public.engineering_schedule_baselines
for select using (
  public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists engineering_schedule_baselines_insert on public.engineering_schedule_baselines;
create policy engineering_schedule_baselines_insert on public.engineering_schedule_baselines
for insert with check (public.has_company_permission(company_id, 'schedule.manage'));

drop policy if exists engineering_schedule_baselines_update on public.engineering_schedule_baselines;
create policy engineering_schedule_baselines_update on public.engineering_schedule_baselines
for update using (public.has_company_permission(company_id, 'schedule.manage'))
with check (public.has_company_permission(company_id, 'schedule.manage'));

drop policy if exists engineering_schedule_activities_select on public.engineering_schedule_activities;
create policy engineering_schedule_activities_select on public.engineering_schedule_activities
for select using (
  public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists engineering_schedule_activities_insert on public.engineering_schedule_activities;
create policy engineering_schedule_activities_insert on public.engineering_schedule_activities
for insert with check (public.has_company_permission(company_id, 'schedule.manage'));

drop policy if exists engineering_schedule_activities_update on public.engineering_schedule_activities;
create policy engineering_schedule_activities_update on public.engineering_schedule_activities
for update using (public.has_company_permission(company_id, 'schedule.manage'))
with check (public.has_company_permission(company_id, 'schedule.manage'));

drop policy if exists engineering_schedule_dependencies_select on public.engineering_schedule_dependencies;
create policy engineering_schedule_dependencies_select on public.engineering_schedule_dependencies
for select using (
  public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists engineering_schedule_dependencies_insert on public.engineering_schedule_dependencies;
create policy engineering_schedule_dependencies_insert on public.engineering_schedule_dependencies
for insert with check (public.has_company_permission(company_id, 'schedule.manage'));

drop policy if exists engineering_schedule_dependencies_update on public.engineering_schedule_dependencies;
create policy engineering_schedule_dependencies_update on public.engineering_schedule_dependencies
for update using (public.has_company_permission(company_id, 'schedule.manage'))
with check (public.has_company_permission(company_id, 'schedule.manage'));

drop policy if exists engineering_schedule_dependencies_delete on public.engineering_schedule_dependencies;
create policy engineering_schedule_dependencies_delete on public.engineering_schedule_dependencies
for delete using (public.has_company_permission(company_id, 'schedule.manage'));

grant select, insert, update on public.engineering_schedule_baselines to authenticated;
grant select, insert, update on public.engineering_schedule_activities to authenticated;
grant select, insert, update, delete on public.engineering_schedule_dependencies to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'engineering_schedule_baselines',
    'engineering_schedule_activities',
    'engineering_schedule_dependencies'
  )
order by table_name;
