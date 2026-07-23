-- Elos OS — Correção automática de parcelas pelo CUB-SC
-- Regra:
--   mês da venda = mês 0
--   meses 0, 1, 2 e 3 = sem reajuste
--   mês 4 em diante = nominal × índice aplicável / índice do mês da venda
--   se o índice do vencimento ainda não existir, usa o último índice disponível
--   parcelas recebidas ficam travadas com os valores históricos efetivamente recebidos

begin;

alter table public.sales
  add column if not exists correction_start_month integer not null default 4;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_correction_start_month_check'
  ) then
    alter table public.sales
      add constraint sales_correction_start_month_check
      check (correction_start_month between 0 and 60);
  end if;
end;
$$;

alter table public.receivables
  add column if not exists correction_locked boolean not null default false,
  add column if not exists correction_reference_month date,
  add column if not exists correction_reference_value numeric(18,6),
  add column if not exists installment_interest_amount numeric(16,2) not null default 0,
  add column if not exists correction_amount numeric(16,2) not null default 0,
  add column if not exists late_fee_amount numeric(16,2) not null default 0,
  add column if not exists other_accrual_amount numeric(16,2) not null default 0,
  add column if not exists discount_amount numeric(16,2) not null default 0,
  add column if not exists adjusted_amount numeric(16,2) not null default 0;

create or replace function public.receivable_month_distance(
  p_base_month date,
  p_target_month date
)
returns integer
language sql
immutable
as $$
  select
    ((extract(year from p_target_month)::integer - extract(year from p_base_month)::integer) * 12)
    + (extract(month from p_target_month)::integer - extract(month from p_base_month)::integer);
$$;

create or replace function public.set_receivable_automatic_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_date_value date;
  correction_start_value integer;
  index_code_value text;
  index_type_value text;
  base_month_value date;
  due_month_value date;
  months_after_sale integer;
  target_month_value date;
  target_index_value numeric(18,6);
  cumulative_factor numeric;
begin
  new.amount := coalesce(new.amount, 0);
  new.installment_interest_amount := coalesce(new.installment_interest_amount, 0);
  new.correction_amount := coalesce(new.correction_amount, 0);
  new.late_fee_amount := coalesce(new.late_fee_amount, 0);
  new.other_accrual_amount := coalesce(new.other_accrual_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);

  if new.correction_locked or new.status <> 'open' then
    if new.adjusted_amount is null or new.adjusted_amount = 0 then
      new.adjusted_amount := round(
        new.amount
        + new.installment_interest_amount
        + new.correction_amount
        + new.late_fee_amount
        + new.other_accrual_amount
        - new.discount_amount,
        2
      );
    end if;
    return new;
  end if;

  if new.correction_index_id is null then
    new.adjustment_index := null;
    new.correction_base_month := null;
    new.correction_base_value := null;
    new.correction_reference_month := null;
    new.correction_reference_value := null;
    new.correction_amount := 0;
    new.adjusted_amount := round(
      new.amount
      + new.installment_interest_amount
      + new.late_fee_amount
      + new.other_accrual_amount
      - new.discount_amount,
      2
    );
    return new;
  end if;

  select sale.sale_date, sale.correction_start_month
  into sale_date_value, correction_start_value
  from public.sales sale
  where sale.id = new.sale_id;

  select correction_index.code, correction_index.value_type
  into index_code_value, index_type_value
  from public.correction_indices correction_index
  where correction_index.id = new.correction_index_id
    and correction_index.company_id = new.company_id;

  if sale_date_value is null or index_code_value is null then
    new.correction_amount := 0;
    new.adjusted_amount := round(
      new.amount
      + new.installment_interest_amount
      + new.late_fee_amount
      + new.other_accrual_amount
      - new.discount_amount,
      2
    );
    return new;
  end if;

  base_month_value := date_trunc('month', sale_date_value)::date;
  due_month_value := date_trunc('month', new.due_date)::date;
  months_after_sale := public.receivable_month_distance(base_month_value, due_month_value);

  new.adjustment_index := index_code_value;
  new.correction_base_month := base_month_value;

  select index_value.value
  into new.correction_base_value
  from public.correction_index_values index_value
  where index_value.company_id = new.company_id
    and index_value.correction_index_id = new.correction_index_id
    and index_value.reference_month <= base_month_value
  order by index_value.reference_month desc
  limit 1;

  if months_after_sale < coalesce(correction_start_value, 4) then
    new.correction_reference_month := base_month_value;
    new.correction_reference_value := new.correction_base_value;
    new.correction_amount := 0;
    new.adjusted_amount := round(
      new.amount
      + new.installment_interest_amount
      + new.late_fee_amount
      + new.other_accrual_amount
      - new.discount_amount,
      2
    );
    return new;
  end if;

  select index_value.reference_month, index_value.value
  into target_month_value, target_index_value
  from public.correction_index_values index_value
  where index_value.company_id = new.company_id
    and index_value.correction_index_id = new.correction_index_id
    and index_value.reference_month <= due_month_value
  order by index_value.reference_month desc
  limit 1;

  new.correction_reference_month := target_month_value;
  new.correction_reference_value := target_index_value;

  if new.correction_base_value is null
     or new.correction_base_value = 0
     or target_index_value is null then
    new.correction_amount := 0;
  elsif index_type_value = 'index_number' then
    new.correction_amount := round(
      new.amount * ((target_index_value / new.correction_base_value) - 1),
      2
    );
  else
    select coalesce(exp(sum(ln(1 + (index_value.value / 100.0)))), 1)
    into cumulative_factor
    from public.correction_index_values index_value
    where index_value.company_id = new.company_id
      and index_value.correction_index_id = new.correction_index_id
      and index_value.reference_month > base_month_value
      and index_value.reference_month <= target_month_value
      and index_value.value > -100;

    new.correction_amount := round(
      new.amount * (coalesce(cumulative_factor, 1) - 1),
      2
    );
  end if;

  new.adjusted_amount := round(
    new.amount
    + new.installment_interest_amount
    + new.correction_amount
    + new.late_fee_amount
    + new.other_accrual_amount
    - new.discount_amount,
    2
  );

  return new;
end;
$$;

drop trigger if exists receivables_automatic_correction on public.receivables;
create trigger receivables_automatic_correction
before insert or update on public.receivables
for each row execute function public.set_receivable_automatic_correction();

create or replace function public.refresh_receivables_after_index_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company_id uuid;
  target_index_id uuid;
begin
  if tg_op = 'DELETE' then
    target_company_id := old.company_id;
    target_index_id := old.correction_index_id;
  else
    target_company_id := new.company_id;
    target_index_id := new.correction_index_id;
  end if;

  update public.receivables
  set updated_at = now()
  where company_id = target_company_id
    and correction_index_id = target_index_id
    and status = 'open'
    and correction_locked = false;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists correction_values_refresh_receivables
  on public.correction_index_values;
create trigger correction_values_refresh_receivables
after insert or update or delete on public.correction_index_values
for each row execute function public.refresh_receivables_after_index_change();

create or replace function public.refresh_receivables_after_sale_date_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.sale_date is distinct from new.sale_date
     or old.correction_start_month is distinct from new.correction_start_month then
    update public.receivables
    set updated_at = now()
    where sale_id = new.id
      and status = 'open'
      and correction_locked = false;
  end if;

  return new;
end;
$$;

drop trigger if exists sales_refresh_receivable_correction on public.sales;
create trigger sales_refresh_receivable_correction
after update of sale_date, correction_start_month on public.sales
for each row execute function public.refresh_receivables_after_sale_date_change();

with cub as (
  select correction_index.id, correction_index.company_id
  from public.correction_indices correction_index
  where correction_index.code = 'CUB-SC'
)
update public.receivables receivable
set correction_index_id = cub.id,
    adjustment_index = 'CUB-SC',
    correction_locked = (receivable.status = 'paid'),
    updated_at = now()
from cub
where receivable.company_id = cub.company_id
  and receivable.source_system = 'koper_flow_receivables';

update public.receivables receivable
set correction_base_month = date_trunc('month', sale.sale_date)::date,
    correction_base_value = (
      select index_value.value
      from public.correction_index_values index_value
      where index_value.company_id = receivable.company_id
        and index_value.correction_index_id = receivable.correction_index_id
        and index_value.reference_month <= date_trunc('month', sale.sale_date)::date
      order by index_value.reference_month desc
      limit 1
    ),
    correction_reference_month = (
      select index_value.reference_month
      from public.correction_index_values index_value
      where index_value.company_id = receivable.company_id
        and index_value.correction_index_id = receivable.correction_index_id
        and index_value.reference_month <= date_trunc('month', receivable.due_date)::date
      order by index_value.reference_month desc
      limit 1
    ),
    correction_reference_value = (
      select index_value.value
      from public.correction_index_values index_value
      where index_value.company_id = receivable.company_id
        and index_value.correction_index_id = receivable.correction_index_id
        and index_value.reference_month <= date_trunc('month', receivable.due_date)::date
      order by index_value.reference_month desc
      limit 1
    ),
    adjustment_index = 'CUB-SC',
    correction_locked = true,
    updated_at = now()
from public.sales sale
where receivable.sale_id = sale.id
  and receivable.source_system = 'koper_flow_receivables'
  and receivable.status = 'paid';

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
      count(*) filter (
        where receivable.status = 'open'
          and receivable.due_date < current_date
      ) as overdue_count,
      coalesce(sum(receivable.amount) filter (
        where receivable.status <> 'cancelled'
      ), 0) as planned_amount,
      coalesce(sum(receivable.adjusted_amount) filter (
        where receivable.status = 'open'
      ), 0) as open_amount,
      coalesce(sum(coalesce(receivable.paid_amount, receivable.adjusted_amount)) filter (
        where receivable.status = 'paid'
      ), 0) as paid_amount,
      coalesce(sum(receivable.correction_amount) filter (
        where receivable.status = 'open'
      ), 0) as open_correction_amount
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
    'open_correction_amount', receivable_totals.open_correction_amount,
    'unplanned_amount', greatest(
      sale_totals.contracted_amount - receivable_totals.planned_amount,
      0
    )
  )
  from sale_totals cross join receivable_totals;
$$;

grant execute on function public.receivables_summary(uuid, uuid, uuid)
  to authenticated;

commit;

select
  sale.sale_date,
  sale.correction_start_month,
  unit.code as unidade,
  receivable.category,
  receivable.sequence_number,
  receivable.sequence_total,
  receivable.due_date,
  receivable.amount as nominal,
  receivable.correction_base_month,
  receivable.correction_base_value,
  receivable.correction_reference_month,
  receivable.correction_reference_value,
  receivable.correction_amount,
  receivable.adjusted_amount,
  receivable.status,
  receivable.correction_locked
from public.receivables receivable
join public.sales sale on sale.id = receivable.sale_id
join public.units unit on unit.id = receivable.unit_id
where receivable.source_system = 'koper_flow_receivables'
  and unit.code = '801'
order by receivable.due_date, receivable.source_id;
