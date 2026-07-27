-- Elos OS — Engenharia: planejamento de suprimentos
-- Necessidades de materiais e equipamentos vinculadas à linha de base.

begin;

create table if not exists public.engineering_supply_plan_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  code text not null,
  name text not null,
  unit_snapshot text not null default 'un',
  category_snapshot text not null default 'material',
  required_quantity numeric(18,6) not null default 0 check (required_quantity >= 0),
  available_stock numeric(18,6) not null default 0 check (available_stock >= 0),
  purchase_quantity numeric(18,6) not null default 0 check (purchase_quantity >= 0),
  planned_unit_cost numeric(18,6) not null default 0 check (planned_unit_cost >= 0),
  planned_total_cost numeric(18,2) generated always as (
    purchase_quantity * planned_unit_cost
  ) stored,
  first_use_date date not null,
  quotation_lead_days integer not null default 20 check (quotation_lead_days >= 0),
  purchasing_lead_days integer not null default 10 check (purchasing_lead_days >= 0),
  delivery_lead_days integer not null default 20 check (delivery_lead_days >= 0),
  safety_days integer not null default 7 check (safety_days >= 0),
  quotation_start date not null,
  order_deadline date not null,
  delivery_deadline date not null,
  status text not null default 'planned'
    check (status in ('planned', 'quotation', 'approval', 'ordered', 'partial', 'delivered', 'canceled')),
  responsible text,
  notes text,
  record_status text not null default 'active' check (record_status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (baseline_id, input_id),
  unique (baseline_id, code)
);

create index if not exists engineering_supply_plan_project_idx
  on public.engineering_supply_plan_items(project_id, record_status, order_deadline);
create index if not exists engineering_supply_plan_baseline_idx
  on public.engineering_supply_plan_items(baseline_id, status, first_use_date);
create index if not exists engineering_supply_plan_supplier_idx
  on public.engineering_supply_plan_items(supplier_id)
  where supplier_id is not null;
create index if not exists engineering_supply_plan_input_idx
  on public.engineering_supply_plan_items(input_id, baseline_id);

insert into public.permissions (key, module, action, description) values
  ('supply_plan.view', 'engineering_supply_plan', 'view', 'Visualizar planejamento de suprimentos'),
  ('supply_plan.manage', 'engineering_supply_plan', 'manage', 'Gerar e editar planejamento de suprimentos')
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
        array['supply_plan.view', 'supply_plan.manage']::text[]
      when role.key in ('finance', 'viewer') then
        array['supply_plan.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.engineering_supply_plan_items enable row level security;

drop policy if exists engineering_supply_plan_items_select on public.engineering_supply_plan_items;
create policy engineering_supply_plan_items_select on public.engineering_supply_plan_items
for select using (
  public.has_company_permission(company_id, 'supply_plan.view')
  or public.has_company_permission(company_id, 'supply_plan.manage')
);

drop policy if exists engineering_supply_plan_items_insert on public.engineering_supply_plan_items;
create policy engineering_supply_plan_items_insert on public.engineering_supply_plan_items
for insert with check (public.has_company_permission(company_id, 'supply_plan.manage'));

drop policy if exists engineering_supply_plan_items_update on public.engineering_supply_plan_items;
create policy engineering_supply_plan_items_update on public.engineering_supply_plan_items
for update using (public.has_company_permission(company_id, 'supply_plan.manage'))
with check (public.has_company_permission(company_id, 'supply_plan.manage'));

grant select, insert, update on public.engineering_supply_plan_items to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'engineering_supply_plan_items';
