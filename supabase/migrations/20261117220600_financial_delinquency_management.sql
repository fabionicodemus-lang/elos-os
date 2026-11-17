-- Gestão de inadimplências: visão por construtora/empreendimento e carteira por cliente.
-- Somente leitura. O saldo sempre desconta recebimentos parciais de títulos abertos.

begin;

create index if not exists receivables_delinquency_company_due_idx
  on public.receivables (company_id, due_date, client_id)
  where status = 'open';

create index if not exists receivables_delinquency_client_due_idx
  on public.receivables (company_id, client_id, due_date, id)
  where status = 'open';

create or replace function public.finance_delinquency_overview(
  p_company_id uuid,
  p_project_id uuid default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := left(btrim(coalesce(p_search, '')), 80);
  v_tax_search text := regexp_replace(left(btrim(coalesce(p_search, '')), 80), '[^0-9]', '', 'g');
  v_result jsonb;
begin
  if p_company_id is null
     or auth.uid() is null
     or not coalesce(public.has_company_permission(p_company_id, 'receivables.view'), false) then
    raise exception 'Sem permissão para consultar inadimplências.' using errcode = '42501';
  end if;

  with eligible as materialized (
    select
      r.client_id,
      r.project_id,
      r.due_date,
      greatest(coalesce(nullif(r.adjusted_amount, 0), r.amount) - coalesce(r.paid_amount, 0), 0)::numeric(16,2) as balance
    from public.receivables r
    where r.company_id = p_company_id
      and (p_project_id is null or r.project_id = p_project_id)
      and r.status = 'open'
  ),
  open_items as materialized (
    select * from eligible where balance > 0
  ),
  client_totals as (
    select
      r.client_id,
      coalesce(nullif(btrim(c.name), ''), 'Cliente ' || left(r.client_id::text, 8)) as client_name,
      c.tax_id,
      string_agg(distinct coalesce(nullif(p.code, ''), p.name), ', ') as projects,
      count(distinct r.project_id) as project_count,
      count(*) as open_installments,
      sum(r.balance) as open_amount,
      count(*) filter (where r.due_date < v_today) as overdue_installments,
      coalesce(sum(r.balance) filter (where r.due_date < v_today), 0) as overdue_amount,
      min(r.due_date) filter (where r.due_date < v_today) as oldest_due_date
    from open_items r
    left join public.clients c on c.id = r.client_id and c.company_id = p_company_id
    left join public.projects p on p.id = r.project_id and p.company_id = p_company_id
    group by r.client_id, c.name, c.tax_id
  ),
  debtors as (
    select
      t.*,
      (v_today - t.oldest_due_date) as max_days_overdue
    from client_totals t
    where t.overdue_installments > 0
  ),
  matched as (
    select * from debtors t
    where v_search = ''
       or strpos(lower(t.client_name), lower(v_search)) > 0
       or (v_tax_search <> '' and strpos(regexp_replace(coalesce(t.tax_id, ''), '[^0-9]', '', 'g'), v_tax_search) > 0)
  ),
  page_rows as (
    select * from matched
    order by overdue_amount desc, oldest_due_date, client_name, client_id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'as_of_date', v_today,
    'open_amount', coalesce((select sum(balance) from open_items), 0),
    'open_installments', (select count(*) from open_items),
    'overdue_amount', coalesce((select sum(balance) from open_items where due_date < v_today), 0),
    'overdue_installments', (select count(*) from open_items where due_date < v_today),
    'debtor_count', (select count(*) from debtors),
    'matched_debtor_count', (select count(*) from matched),
    'aging_1_30', coalesce((select sum(balance) from open_items where v_today - due_date between 1 and 30), 0),
    'aging_31_60', coalesce((select sum(balance) from open_items where v_today - due_date between 31 and 60), 0),
    'aging_61_90', coalesce((select sum(balance) from open_items where v_today - due_date between 61 and 90), 0),
    'aging_91_plus', coalesce((select sum(balance) from open_items where v_today - due_date >= 91), 0),
    'debtors', coalesce((select jsonb_agg(to_jsonb(p) order by p.overdue_amount desc, p.oldest_due_date, p.client_name, p.client_id) from page_rows p), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.finance_delinquency_installments(
  p_company_id uuid,
  p_client_id uuid,
  p_project_id uuid default null,
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_limit integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if p_company_id is null
     or p_client_id is null
     or auth.uid() is null
     or not coalesce(public.has_company_permission(p_company_id, 'receivables.view'), false) then
    raise exception 'Sem permissão para consultar as parcelas.' using errcode = '42501';
  end if;

  with eligible as materialized (
    select
      r.id,
      r.client_id,
      r.project_id,
      r.sale_id,
      r.unit_id,
      r.category,
      r.description,
      r.sequence_number,
      r.sequence_total,
      r.due_date,
      r.amount,
      coalesce(nullif(r.adjusted_amount, 0), r.amount) as adjusted_amount,
      coalesce(r.paid_amount, 0) as paid_amount,
      greatest(coalesce(nullif(r.adjusted_amount, 0), r.amount) - coalesce(r.paid_amount, 0), 0)::numeric(16,2) as balance,
      p.name as project_name,
      p.code as project_code,
      u.code as unit_code,
      s.number as sale_number
    from public.receivables r
    left join public.projects p on p.id = r.project_id and p.company_id = p_company_id
    left join public.units u on u.id = r.unit_id and u.company_id = p_company_id
    left join public.sales s on s.id = r.sale_id and s.company_id = p_company_id
    where r.company_id = p_company_id
      and r.client_id = p_client_id
      and (p_project_id is null or r.project_id = p_project_id)
      and r.status = 'open'
  ),
  open_items as materialized (
    select * from eligible where balance > 0
  ),
  page_rows as (
    select
      r.*,
      (r.due_date < v_today) as is_overdue,
      greatest(v_today - r.due_date, 0) as days_overdue
    from open_items r
    order by (r.due_date >= v_today), r.due_date, r.id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'client_id', p_client_id,
    'client_name', coalesce((select nullif(btrim(c.name), '') from public.clients c where c.id = p_client_id and c.company_id = p_company_id), 'Cliente ' || left(p_client_id::text, 8)),
    'as_of_date', v_today,
    'open_amount', coalesce((select sum(balance) from open_items), 0),
    'open_installments', (select count(*) from open_items),
    'overdue_amount', coalesce((select sum(balance) from open_items where due_date < v_today), 0),
    'overdue_installments', (select count(*) from open_items where due_date < v_today),
    'installments', coalesce((select jsonb_agg(to_jsonb(p) order by p.is_overdue desc, p.due_date, p.id) from page_rows p), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.finance_delinquency_overview(uuid, uuid, text, integer, integer) from public, anon;
revoke all on function public.finance_delinquency_installments(uuid, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.finance_delinquency_overview(uuid, uuid, text, integer, integer) to authenticated;
grant execute on function public.finance_delinquency_installments(uuid, uuid, uuid, integer, integer) to authenticated;

commit;
