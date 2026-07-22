-- Elos OS — Contas a pagar
-- Execute após 20260722_0002_suppliers_clients.sql.

create table if not exists public.payables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  document text,
  fiscal_class text,
  payment_method text,
  due_date date not null,
  amount numeric(16,2) not null check (amount >= 0),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  installment_label text,
  notes text,
  paid_at date,
  paid_amount numeric(16,2) check (paid_amount is null or paid_amount >= 0),
  paid_account_name text,
  origin text not null default 'manual',
  source_system text,
  source_id text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_system, source_id)
);

create index if not exists payables_company_project_due_idx
  on public.payables(company_id, project_id, due_date);
create index if not exists payables_company_status_idx
  on public.payables(company_id, status);
create index if not exists payables_supplier_idx
  on public.payables(supplier_id);
create index if not exists payables_source_idx
  on public.payables(company_id, source_system, source_id);

insert into public.permissions (key, module, action, description) values
  ('payables.view', 'financial', 'view_payables', 'Visualizar contas a pagar'),
  ('payables.manage', 'financial', 'manage_payables', 'Criar, editar, pagar e cancelar contas a pagar')
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
      when role.key in ('owner', 'admin', 'director', 'finance') then
        array['payables.view', 'payables.manage']::text[]
      when role.key in ('engineering', 'viewer') then
        array['payables.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.payables enable row level security;

drop policy if exists payables_select on public.payables;
create policy payables_select on public.payables
for select using (
  public.has_company_permission(company_id, 'payables.view')
  or public.has_company_permission(company_id, 'payables.manage')
);

drop policy if exists payables_insert on public.payables;
create policy payables_insert on public.payables
for insert with check (
  public.has_company_permission(company_id, 'payables.manage')
  and public.is_company_member(company_id)
);

drop policy if exists payables_update on public.payables;
create policy payables_update on public.payables
for update using (
  public.has_company_permission(company_id, 'payables.manage')
) with check (
  public.has_company_permission(company_id, 'payables.manage')
);

create or replace function public.payables_summary(
  p_company_id uuid,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not (
    public.has_company_permission(p_company_id, 'payables.view')
    or public.has_company_permission(p_company_id, 'payables.manage')
  ) then
    raise exception 'Você não possui acesso às contas a pagar desta empresa.';
  end if;

  select jsonb_build_object(
    'total_count', count(*),
    'open_count', count(*) filter (where status = 'open'),
    'paid_count', count(*) filter (where status = 'paid'),
    'cancelled_count', count(*) filter (where status = 'cancelled'),
    'total_amount', coalesce(sum(amount) filter (where status <> 'cancelled'), 0),
    'open_amount', coalesce(sum(amount) filter (where status = 'open'), 0),
    'paid_amount', coalesce(sum(coalesce(paid_amount, amount)) filter (where status = 'paid'), 0)
  ) into result
  from public.payables
  where company_id = p_company_id
    and (p_project_id is null or project_id = p_project_id);

  return result;
end;
$$;

-- Contas financeiras não possuem exclusão física pela aplicação.
grant select, insert, update on public.payables to authenticated;
grant execute on function public.payables_summary(uuid, uuid) to authenticated;
