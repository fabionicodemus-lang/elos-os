-- Elos OS — Pré-Obra 9.5 · Reajuste mensal de orçamento e aditivos
-- O orçamento base continua histórico; o controle expõe separadamente o saldo nominal
-- e o saldo reajustado pelo índice escolhido (CUB, INCC, IPCA ou índice cadastrado).

begin;

alter table public.engineering_budgets
  add column if not exists adjustment_enabled boolean not null default false,
  add column if not exists correction_index_id uuid references public.correction_indices(id),
  add column if not exists correction_base_month date,
  add column if not exists correction_base_value numeric(18,6);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'engineering_budgets_correction_base_month_check') then
    alter table public.engineering_budgets
      add constraint engineering_budgets_correction_base_month_check
      check (correction_base_month is null or correction_base_month = date_trunc('month', correction_base_month)::date);
  end if;
end $$;
create index if not exists engineering_budgets_correction_idx
  on public.engineering_budgets(correction_index_id, correction_base_month)
  where adjustment_enabled = true;

create table if not exists public.engineering_budget_amendments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete cascade,
  code text not null,
  description text not null,
  approval_date date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  adjustment_enabled boolean not null default true,
  correction_index_id uuid references public.correction_indices(id),
  correction_base_month date,
  correction_base_value numeric(18,6),
  notes text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_id, code),
  check (correction_base_month is null or correction_base_month = date_trunc('month', correction_base_month)::date)
);

create table if not exists public.engineering_budget_amendment_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete cascade,
  amendment_id uuid not null references public.engineering_budget_amendments(id) on delete cascade,
  service_id uuid references public.engineering_services(id) on delete set null,
  budget_item_id uuid references public.engineering_budget_items(id) on delete set null,
  service_code_snapshot text,
  service_name_snapshot text not null,
  amount numeric(18,2) not null check (amount <> 0),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists engineering_budget_amendments_budget_idx
  on public.engineering_budget_amendments(company_id, project_id, budget_id, status, approval_date);
create index if not exists engineering_budget_amendment_items_service_idx
  on public.engineering_budget_amendment_items(budget_id, service_id, amendment_id);

alter table public.engineering_budget_amendments enable row level security;
alter table public.engineering_budget_amendment_items enable row level security;
drop policy if exists engineering_budget_amendments_select on public.engineering_budget_amendments;
create policy engineering_budget_amendments_select on public.engineering_budget_amendments
for select to authenticated using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);
drop policy if exists engineering_budget_amendments_write on public.engineering_budget_amendments;
create policy engineering_budget_amendments_write on public.engineering_budget_amendments
for all to authenticated using (public.has_company_permission(company_id, 'budgets.manage'))
with check (public.has_company_permission(company_id, 'budgets.manage'));
drop policy if exists engineering_budget_amendment_items_select on public.engineering_budget_amendment_items;
create policy engineering_budget_amendment_items_select on public.engineering_budget_amendment_items
for select to authenticated using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);
drop policy if exists engineering_budget_amendment_items_write on public.engineering_budget_amendment_items;
create policy engineering_budget_amendment_items_write on public.engineering_budget_amendment_items
for all to authenticated using (public.has_company_permission(company_id, 'budgets.manage'))
with check (public.has_company_permission(company_id, 'budgets.manage'));
grant select, insert, update, delete on public.engineering_budget_amendments to authenticated;
grant select, insert, update, delete on public.engineering_budget_amendment_items to authenticated;

-- Fator genérico para índice em número (CUB) ou percentual mensal (INCC/IPCA).
create or replace function public.engineering_correction_factor(
  p_company_id uuid,
  p_index_id uuid,
  p_base_month date,
  p_target_month date default current_date,
  p_base_value numeric default null
)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_type text;
  v_base_month date := date_trunc('month', p_base_month)::date;
  v_target_month date := date_trunc('month', coalesce(p_target_month, current_date))::date;
  v_base numeric := p_base_value;
  v_target numeric;
  v_factor numeric := 1;
begin
  if p_index_id is null or p_base_month is null then return 1; end if;
  select value_type into v_type
  from public.correction_indices
  where id = p_index_id and company_id = p_company_id and status = 'active';
  if v_type is null then return 1; end if;

  if v_type = 'index_number' then
    if v_base is null or v_base = 0 then
      select value into v_base from public.correction_index_values
      where company_id = p_company_id and correction_index_id = p_index_id
        and reference_month <= v_base_month
      order by reference_month desc limit 1;
    end if;
    select value into v_target from public.correction_index_values
    where company_id = p_company_id and correction_index_id = p_index_id
      and reference_month <= v_target_month
    order by reference_month desc limit 1;
    if coalesce(v_base, 0) = 0 or v_target is null then return 1; end if;
    return greatest(0, v_target / v_base);
  end if;

  select coalesce(exp(sum(ln(1 + value / 100.0))), 1)
    into v_factor
  from public.correction_index_values
  where company_id = p_company_id and correction_index_id = p_index_id
    and reference_month > v_base_month and reference_month <= v_target_month
    and value > -100;
  return greatest(0, coalesce(v_factor, 1));
end;
$$;
grant execute on function public.engineering_correction_factor(uuid, uuid, date, date, numeric) to authenticated;

create or replace function public.prepare_engineering_budget_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_index_company uuid;
begin
  if new.adjustment_enabled then
    if new.correction_index_id is null then
      raise exception 'Escolha o índice para reajustar o orçamento.';
    end if;
    select company_id into v_index_company from public.correction_indices where id = new.correction_index_id;
    if v_index_company is distinct from new.company_id then
      raise exception 'O índice de correção não pertence à empresa do orçamento.';
    end if;
    new.correction_base_month := coalesce(new.correction_base_month, date_trunc('month', new.reference_date)::date, date_trunc('month', current_date)::date);
    if new.correction_base_value is null or new.correction_base_value = 0 then
      select value into new.correction_base_value from public.correction_index_values
      where company_id = new.company_id and correction_index_id = new.correction_index_id
        and reference_month <= new.correction_base_month
      order by reference_month desc limit 1;
    end if;
  else
    new.correction_index_id := null;
    new.correction_base_month := null;
    new.correction_base_value := null;
  end if;
  return new;
end;
$$;
drop trigger if exists prepare_engineering_budget_adjustment_trigger on public.engineering_budgets;
create trigger prepare_engineering_budget_adjustment_trigger
before insert or update of adjustment_enabled, correction_index_id, correction_base_month, reference_date
on public.engineering_budgets
for each row execute function public.prepare_engineering_budget_adjustment();

create or replace function public.validate_engineering_budget_amendment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget record;
  v_index_company uuid;
begin
  select company_id, project_id, adjustment_enabled, correction_index_id, correction_base_month, correction_base_value
    into v_budget
  from public.engineering_budgets where id = new.budget_id;
  if v_budget.company_id is null then raise exception 'Orçamento não localizado.'; end if;
  if new.company_id <> v_budget.company_id or new.project_id <> v_budget.project_id then
    raise exception 'O aditivo deve pertencer à mesma empresa e obra do orçamento.';
  end if;
  if new.status = 'approved' then
    new.approval_date := coalesce(new.approval_date, current_date);
    new.approved_at := coalesce(new.approved_at, now());
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.correction_index_id := coalesce(new.correction_index_id, v_budget.correction_index_id);
    new.adjustment_enabled := coalesce(new.adjustment_enabled, v_budget.adjustment_enabled);
    if new.adjustment_enabled and new.correction_index_id is null then
      raise exception 'O aditivo reajustado precisa de um índice de correção.';
    end if;
    if new.adjustment_enabled then
      select company_id into v_index_company from public.correction_indices where id = new.correction_index_id;
      if v_index_company is distinct from new.company_id then raise exception 'Índice de correção inválido para o aditivo.'; end if;
      new.correction_base_month := coalesce(new.correction_base_month, date_trunc('month', new.approval_date)::date);
      if new.correction_base_value is null or new.correction_base_value = 0 then
        select value into new.correction_base_value from public.correction_index_values
        where company_id = new.company_id and correction_index_id = new.correction_index_id
          and reference_month <= new.correction_base_month
        order by reference_month desc limit 1;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists validate_engineering_budget_amendment_trigger on public.engineering_budget_amendments;
create trigger validate_engineering_budget_amendment_trigger
before insert or update on public.engineering_budget_amendments
for each row execute function public.validate_engineering_budget_amendment();

create or replace function public.validate_engineering_budget_amendment_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_header record;
begin
  select company_id, project_id, budget_id, status into v_header
  from public.engineering_budget_amendments where id = coalesce(new.amendment_id, old.amendment_id);
  if v_header.company_id is null then raise exception 'Aditivo não localizado.'; end if;
  if tg_op <> 'DELETE' and (new.company_id <> v_header.company_id or new.project_id <> v_header.project_id or new.budget_id <> v_header.budget_id) then
    raise exception 'Item do aditivo fora do contexto do orçamento.';
  end if;
  if v_header.status = 'approved' then
    raise exception 'Aditivo aprovado é imutável. Cancele-o e crie outro se houver necessidade de correção.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists validate_engineering_budget_amendment_item_trigger on public.engineering_budget_amendment_items;
create trigger validate_engineering_budget_amendment_item_trigger
before insert or update or delete on public.engineering_budget_amendment_items
for each row execute function public.validate_engineering_budget_amendment_item();

create or replace function public.guard_engineering_budget_amendment_after_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' then
    if new.status = 'cancelled' then return new; end if;
    if row(new.code, new.description, new.approval_date, new.adjustment_enabled, new.correction_index_id, new.correction_base_month, new.correction_base_value, new.notes)
       is distinct from
       row(old.code, old.description, old.approval_date, old.adjustment_enabled, old.correction_index_id, old.correction_base_month, old.correction_base_value, old.notes) then
      raise exception 'Aditivo aprovado é imutável. Apenas o cancelamento é permitido.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_engineering_budget_amendment_after_approval_trigger on public.engineering_budget_amendments;
create trigger guard_engineering_budget_amendment_after_approval_trigger
before update on public.engineering_budget_amendments
for each row execute function public.guard_engineering_budget_amendment_after_approval();

-- Memória atual dos aditivos com fator de correção na data corrente.
create or replace view public.engineering_budget_amendments_current
with (security_invoker = true)
as
select
  a.id,
  a.company_id,
  a.project_id,
  a.budget_id,
  a.code,
  a.description,
  a.approval_date,
  a.status,
  a.adjustment_enabled,
  a.correction_index_id,
  idx.code as correction_index_code,
  a.correction_base_month,
  a.correction_base_value,
  case when a.adjustment_enabled then public.engineering_correction_factor(a.company_id, a.correction_index_id, a.correction_base_month, current_date, a.correction_base_value) else 1 end as correction_factor,
  coalesce(sum(i.amount), 0)::numeric(18,2) as nominal_amount,
  (coalesce(sum(i.amount), 0) * case when a.adjustment_enabled then public.engineering_correction_factor(a.company_id, a.correction_index_id, a.correction_base_month, current_date, a.correction_base_value) else 1 end)::numeric(18,2) as current_amount
from public.engineering_budget_amendments a
left join public.engineering_budget_amendment_items i on i.amendment_id = a.id
left join public.correction_indices idx on idx.id = a.correction_index_id
group by a.id, idx.code;
grant select on public.engineering_budget_amendments_current to authenticated;

commit;