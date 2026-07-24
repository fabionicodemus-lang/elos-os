-- Elos OS — Engenharia: cadastro de orçamentos
-- Execute após as migrations de multiempresa e cadastros.

begin;

create table if not exists public.engineering_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  name text not null,
  version text not null default 'R00',
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'review', 'approved', 'archived')),
  reference_date date,
  area_m2 numeric(18,4) not null default 0 check (area_m2 >= 0),
  bdi_percentage numeric(9,4) not null default 0 check (bdi_percentage >= 0),
  notes text,
  source_system text not null default 'elos_os',
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, code, version),
  unique (company_id, source_system, source_id)
);

create table if not exists public.engineering_budget_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete cascade,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, code)
);

create table if not exists public.engineering_budget_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete cascade,
  group_id uuid references public.engineering_budget_groups(id) on delete set null,
  code text,
  description text not null,
  unit text not null default 'un',
  quantity numeric(18,6) not null default 0 check (quantity >= 0),
  material_unit_cost numeric(18,6) not null default 0 check (material_unit_cost >= 0),
  labor_unit_cost numeric(18,6) not null default 0 check (labor_unit_cost >= 0),
  equipment_unit_cost numeric(18,6) not null default 0 check (equipment_unit_cost >= 0),
  other_unit_cost numeric(18,6) not null default 0 check (other_unit_cost >= 0),
  unit_direct_cost numeric(18,6) generated always as (
    material_unit_cost + labor_unit_cost + equipment_unit_cost + other_unit_cost
  ) stored,
  total_direct_cost numeric(18,6) generated always as (
    quantity * (material_unit_cost + labor_unit_cost + equipment_unit_cost + other_unit_cost)
  ) stored,
  sort_order integer not null default 0,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists engineering_budgets_company_project_idx
  on public.engineering_budgets(company_id, project_id, status, updated_at desc);
create index if not exists engineering_budget_groups_budget_idx
  on public.engineering_budget_groups(budget_id, status, sort_order, code);
create index if not exists engineering_budget_items_budget_idx
  on public.engineering_budget_items(budget_id, status, sort_order, description);
create index if not exists engineering_budget_items_group_idx
  on public.engineering_budget_items(group_id, status, sort_order);

insert into public.permissions (key, module, action, description) values
  ('budgets.view', 'engineering_budgets', 'view', 'Visualizar orçamentos de engenharia'),
  ('budgets.manage', 'engineering_budgets', 'manage', 'Criar e editar orçamentos de engenharia')
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
        array['budgets.view', 'budgets.manage']::text[]
      when role.key in ('finance', 'viewer') then
        array['budgets.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_budgets enable row level security;
alter table public.engineering_budget_groups enable row level security;
alter table public.engineering_budget_items enable row level security;

drop policy if exists engineering_budgets_select on public.engineering_budgets;
create policy engineering_budgets_select on public.engineering_budgets
for select using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budgets_insert on public.engineering_budgets;
create policy engineering_budgets_insert on public.engineering_budgets
for insert with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budgets_update on public.engineering_budgets;
create policy engineering_budgets_update on public.engineering_budgets
for update using (
  public.has_company_permission(company_id, 'budgets.manage')
) with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_groups_select on public.engineering_budget_groups;
create policy engineering_budget_groups_select on public.engineering_budget_groups
for select using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_groups_insert on public.engineering_budget_groups;
create policy engineering_budget_groups_insert on public.engineering_budget_groups
for insert with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_groups_update on public.engineering_budget_groups;
create policy engineering_budget_groups_update on public.engineering_budget_groups
for update using (
  public.has_company_permission(company_id, 'budgets.manage')
) with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_items_select on public.engineering_budget_items;
create policy engineering_budget_items_select on public.engineering_budget_items
for select using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_items_insert on public.engineering_budget_items;
create policy engineering_budget_items_insert on public.engineering_budget_items
for insert with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_items_update on public.engineering_budget_items;
create policy engineering_budget_items_update on public.engineering_budget_items
for update using (
  public.has_company_permission(company_id, 'budgets.manage')
) with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

grant select, insert, update on public.engineering_budgets to authenticated;
grant select, insert, update on public.engineering_budget_groups to authenticated;
grant select, insert, update on public.engineering_budget_items to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'engineering_budgets',
    'engineering_budget_groups',
    'engineering_budget_items'
  )
order by table_name;
