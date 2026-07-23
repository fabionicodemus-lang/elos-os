-- Elos OS — Planos de pagamento e contas a receber
-- Execute após 20260723_0004_flow_sales.sql.

create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  unit_id uuid not null references public.units(id),
  category text not null check (category in ('entry', 'monthly', 'reinforcement', 'keys', 'post_keys', 'other')),
  description text not null,
  sequence_number integer not null default 1 check (sequence_number > 0),
  sequence_total integer not null default 1 check (sequence_total > 0),
  due_date date not null,
  amount numeric(16,2) not null check (amount >= 0),
  adjustment_index text,
  interest_rate_monthly numeric(8,4),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  paid_at date,
  paid_amount numeric(16,2),
  paid_account_name text,
  notes text,
  source_system text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, source_id)
);

create index if not exists receivables_company_project_due_idx
  on public.receivables(company_id, project_id, due_date);
create index if not exists receivables_sale_due_idx
  on public.receivables(sale_id, due_date);
create index if not exists receivables_client_idx
  on public.receivables(client_id);
create index if not exists receivables_status_idx
  on public.receivables(company_id, status);

insert into public.permissions (key, module, action, description) values
  ('receivables.view', 'commercial', 'view_receivables', 'Visualizar planos de pagamento e contas a receber'),
  ('receivables.manage', 'commercial', 'manage_receivables', 'Criar planos, baixar e cancelar contas a receber')
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
      when role.key in ('owner', 'admin', 'director', 'commercial', 'finance') then
        array['receivables.view', 'receivables.manage']::text[]
      when role.key in ('engineering', 'viewer') then
        array['receivables.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.receivables enable row level security;

drop policy if exists receivables_select on public.receivables;
create policy receivables_select on public.receivables
for select using (
  public.has_company_permission(company_id, 'receivables.view')
  or public.has_company_permission(company_id, 'receivables.manage')
);

drop policy if exists receivables_insert on public.receivables;
create policy receivables_insert on public.receivables
for insert with check (
  public.has_company_permission(company_id, 'receivables.manage')
);

drop policy if exists receivables_update on public.receivables;
create policy receivables_update on public.receivables
for update using (
  public.has_company_permission(company_id, 'receivables.manage')
) with check (
  public.has_company_permission(company_id, 'receivables.manage')
);

create or replace function public.refresh_sale_payment_plan_flag(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sales sale
     set payment_plan_available = exists (
       select 1
       from public.receivables receivable
       where receivable.sale_id = target_sale_id
         and receivable.status <> 'cancelled'
     ),
     updated_at = now()
   where sale.id = target_sale_id;
end;
$$;

create or replace function public.sync_sale_payment_plan_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_sale_payment_plan_flag(old.sale_id);
    return old;
  end if;

  perform public.refresh_sale_payment_plan_flag(new.sale_id);

  if tg_op = 'UPDATE' and old.sale_id is distinct from new.sale_id then
    perform public.refresh_sale_payment_plan_flag(old.sale_id);
  end if;

  return new;
end;
$$;

drop trigger if exists receivables_sync_sale_flag on public.receivables;
create trigger receivables_sync_sale_flag
after insert or update or delete on public.receivables
for each row execute function public.sync_sale_payment_plan_flag();

create or replace function public.receivables_summary(
  p_company_id uuid,
  p_project_id uuid default null,
  p_sale_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with sale_totals as (
    select
      coalesce(sum(sale.total_amount) filter (where sale.status = 'active'), 0) as contracted_amount,
      count(*) filter (where sale.status = 'active') as active_sales
    from public.sales sale
    where sale.company_id = p_company_id
      and (p_project_id is null or sale.project_id = p_project_id)
      and (p_sale_id is null or sale.id = p_sale_id)
      and (
        public.has_company_permission(sale.company_id, 'receivables.view')
        or public.has_company_permission(sale.company_id, 'receivables.manage')
      )
  ),
  receivable_totals as (
    select
      count(*) filter (where receivable.status <> 'cancelled') as total_count,
      count(*) filter (where receivable.status = 'open') as open_count,
      count(*) filter (where receivable.status = 'paid') as paid_count,
      count(*) filter (where receivable.status = 'open' and receivable.due_date < current_date) as overdue_count,
      coalesce(sum(receivable.amount) filter (where receivable.status <> 'cancelled'), 0) as planned_amount,
      coalesce(sum(receivable.amount) filter (where receivable.status = 'open'), 0) as open_amount,
      coalesce(sum(coalesce(receivable.paid_amount, receivable.amount)) filter (where receivable.status = 'paid'), 0) as paid_amount
    from public.receivables receivable
    where receivable.company_id = p_company_id
      and (p_project_id is null or receivable.project_id = p_project_id)
      and (p_sale_id is null or receivable.sale_id = p_sale_id)
      and (
        public.has_company_permission(receivable.company_id, 'receivables.view')
        or public.has_company_permission(receivable.company_id, 'receivables.manage')
      )
  )
  select jsonb_build_object(
    'contracted_amount', sale_totals.contracted_amount,
    'active_sales', sale_totals.active_sales,
    'total_count', receivable_totals.total_count,
    'open_count', receivable_totals.open_count,
    'paid_count', receivable_totals.paid_count,
    'overdue_count', receivable_totals.overdue_count,
    'planned_amount', receivable_totals.planned_amount,
    'open_amount', receivable_totals.open_amount,
    'paid_amount', receivable_totals.paid_amount,
    'unplanned_amount', greatest(sale_totals.contracted_amount - receivable_totals.planned_amount, 0)
  )
  from sale_totals cross join receivable_totals;
$$;

grant select, insert, update on public.receivables to authenticated;
grant execute on function public.receivables_summary(uuid, uuid, uuid) to authenticated;
