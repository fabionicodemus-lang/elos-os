-- Partial title balances and dated historical receipts. No source history posts
-- cash: only an explicit operational payment intent creates a bank transaction.
begin;

alter table public.payables
  add column if not exists installment_interest_amount numeric(16,2) not null default 0,
  add column if not exists correction_amount numeric(16,2) not null default 0,
  add column if not exists late_fee_amount numeric(16,2) not null default 0,
  add column if not exists other_accrual_amount numeric(16,2) not null default 0,
  add column if not exists discount_amount numeric(16,2) not null default 0;
alter table public.payables add column if not exists adjusted_amount numeric(16,2)
  generated always as (amount + installment_interest_amount + correction_amount + late_fee_amount + other_accrual_amount - discount_amount) stored;
alter table public.payables add constraint payables_adjustment_components_check
  check(installment_interest_amount>=0 and late_fee_amount>=0 and other_accrual_amount>=0 and discount_amount>=0 and adjusted_amount>=0);
comment on column public.payables.amount is 'Valor nominal original, preservado após pagamentos parciais.';
comment on column public.payables.adjusted_amount is 'Valor nominal mais componentes explícitos, antes de abater pagamentos líquidos.';

create or replace function public.finance_title_remaining(p_amount numeric,p_adjusted_amount numeric,p_paid_amount numeric,p_status text)
returns numeric language sql immutable security invoker set search_path='' as $$
  select case when p_status='open' then greatest(coalesce(p_adjusted_amount,p_amount,0)-coalesce(p_paid_amount,0),0) else 0 end;
$$;
revoke all on function public.finance_title_remaining(numeric,numeric,numeric,text) from public,anon;
grant execute on function public.finance_title_remaining(numeric,numeric,numeric,text) to authenticated;

-- A partial CUB receipt freezes its observed valuation until principal/index
-- amortization has explicit evidence. Revaluing the entire principal would also
-- correct already received principal. Cancellation must not hide paid history.
create or replace function public.finance_guard_partial_title() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and old.status='open' and new.status='cancelled' and coalesce(old.paid_amount,0)>0 then
    raise exception 'Título com baixa parcial exige tratamento do histórico antes do cancelamento.';
  end if;
  if tg_table_name='receivables' and new.status='open' and coalesce(new.paid_amount,0)>0 then
    new.correction_locked:=true;
  end if;
  return new;
end; $$;
create trigger finance_guard_partial_title before insert or update on public.receivables
  for each row execute function public.finance_guard_partial_title();
create trigger finance_guard_partial_title before insert or update on public.payables
  for each row execute function public.finance_guard_partial_title();

-- Multiple effective transactions may belong to one title; source/intention
-- identity remains unique and protects replay. Keep indexed lookups by title.
drop index if exists public.finance_bank_transactions_receivable_unique_idx;
drop index if exists public.finance_bank_transactions_payable_unique_idx;
create index if not exists finance_bank_transactions_receivable_events_idx
  on public.finance_bank_transactions(company_id,receivable_id,transaction_date) where receivable_id is not null;
create index if not exists finance_bank_transactions_payable_events_idx
  on public.finance_bank_transactions(company_id,payable_id,transaction_date) where payable_id is not null;

create or replace function public.finance_apply_title_payment(
  p_company_id uuid,p_project_id uuid,p_title_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric,p_request_id uuid,p_kind text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  r public.receivables%rowtype; p public.payables%rowtype; a public.finance_bank_accounts%rowtype;
  existing public.finance_bank_transactions%rowtype; target_project public.projects%rowtype;
  v_original numeric; v_adjusted numeric; v_paid numeric; v_remaining numeric; v_total numeric;
  v_description text; v_document text; v_party text; v_source text; v_id uuid; v_closed_through date;
begin
  if auth.uid() is null or p_kind not in ('receivable','payable') or not coalesce(public.has_company_permission(p_company_id,case when p_kind='receivable' then 'receivables.manage' else 'payables.manage' end),false) then
    raise exception 'Sem permissão para registrar a baixa.';
  end if;
  if p_request_id is null or p_paid_at is null or p_paid_amount is null or p_paid_amount::text in ('NaN','Infinity','-Infinity') or p_paid_amount<=0 or p_paid_amount<>round(p_paid_amount,2) then
    raise exception 'Informe intenção, data e valor positivo em centavos.';
  end if;
  -- The native contract authorizes settlement through its title permission;
  -- account-view permission is not additionally required. Recheck the current
  -- tenant/project/account/SPE relation before returning even a prior intent.
  select * into target_project from public.projects where id=p_project_id and company_id=p_company_id;
  select * into a from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id;
  if target_project.id is null or a.id is null or (a.legal_entity_id is not null and a.legal_entity_id is distinct from target_project.legal_entity_id) then
    raise exception 'Obra ou conta indisponível nesta empresa/SPE.';
  end if;
  v_source:='title-payment:'||p_request_id::text;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||'|'||v_source,0));
  select * into existing from public.finance_bank_transactions
    where company_id=p_company_id and source_system='elos_os' and source_id=v_source;
  if found then
    if existing.project_id is distinct from p_project_id or existing.bank_account_id is distinct from p_account_id
      or existing.transaction_date is distinct from p_paid_at or existing.amount is distinct from p_paid_amount
      or existing.created_by is distinct from auth.uid() or existing.status='cancelled'
      or (p_kind='receivable' and (existing.receivable_id is distinct from p_title_id or existing.direction<>'credit'))
      or (p_kind='payable' and (existing.payable_id is distinct from p_title_id or existing.direction<>'debit')) then
      raise exception 'A intenção já foi utilizada com outros dados ou cancelada.';
    end if;
    return existing.id;
  end if;

  if p_kind='receivable' then
    select * into r from public.receivables where id=p_title_id and company_id=p_company_id and project_id=p_project_id and status='open' for update;
    if not found then raise exception 'Parcela não disponível para recebimento.'; end if;
    v_original:=r.amount; v_adjusted:=r.adjusted_amount; v_paid:=coalesce(r.paid_amount,0);
    v_description:=coalesce(r.description,'Recebimento de parcela'); v_document:=r.sequence_number::text||'/'||r.sequence_total::text;
    select name into v_party from public.clients where id=r.client_id and company_id=p_company_id;
  else
    select * into p from public.payables where id=p_title_id and company_id=p_company_id and project_id=p_project_id and status='open' for update;
    if not found then raise exception 'Conta não disponível para pagamento.'; end if;
    v_original:=p.amount; v_adjusted:=p.adjusted_amount; v_paid:=coalesce(p.paid_amount,0);
    v_description:=coalesce(p.document,'Pagamento de conta'); v_document:=p.document;
    select coalesce(trade_name,legal_name) into v_party from public.suppliers where id=p.supplier_id and company_id=p_company_id;
    v_party:=coalesce(v_party,p.beneficiary_name);
  end if;
  v_remaining:=public.finance_title_remaining(v_original,v_adjusted,v_paid,'open');
  if p_paid_amount>v_remaining then raise exception 'Valor da baixa excede o saldo de %.',v_remaining; end if;
  select * into a from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id and status='active' for update;
  if not found then raise exception 'Conta bancária inválida ou inativa.'; end if;
  select * into target_project from public.projects where id=p_project_id and company_id=p_company_id;
  if not found or (a.legal_entity_id is not null and a.legal_entity_id is distinct from target_project.legal_entity_id) then raise exception 'Conta bancária pertence a outra empresa/SPE.'; end if;
  -- The optional bank-operations module adds this field. Older installations
  -- have no closed-period feature; preserve that existing behavior.
  v_closed_through:=nullif(to_jsonb(a)->>'closed_through','')::date;
  if v_closed_through is not null and p_paid_at<=v_closed_through then raise exception 'Período bancário encerrado.'; end if;
  if p_kind='payable' and not a.allow_negative and public.finance_bank_account_balance(a.id,p_paid_at)<p_paid_amount then raise exception 'Saldo bancário insuficiente.'; end if;
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
    description,document,counterparty,amount,status,receivable_id,payable_id,source_system,source_id,created_by
  ) values(
    p_company_id,p_project_id,a.legal_entity_id,a.id,p_paid_at,case when p_kind='receivable' then r.due_date else p.due_date end,
    case when p_kind='receivable' then 'credit' else 'debit' end,case when p_kind='receivable' then 'receipt' else 'payment' end,
    v_description,v_document,v_party,p_paid_amount,'posted',case when p_kind='receivable' then p_title_id end,case when p_kind='payable' then p_title_id end,
    'elos_os',v_source,auth.uid()
  ) returning id into v_id;
  v_total:=v_paid+p_paid_amount;
  if p_kind='receivable' then
    update public.receivables set status=case when p_paid_amount=v_remaining then 'paid' else 'open' end,
      paid_amount=v_total,paid_at=greatest(paid_at,p_paid_at),paid_account_name=a.label,bank_account_id=a.id,bank_transaction_id=v_id,
      correction_locked=true,updated_at=now() where id=p_title_id;
  else
    update public.payables set status=case when p_paid_amount=v_remaining then 'paid' else 'open' end,
      paid_amount=v_total,paid_at=greatest(paid_at,p_paid_at),paid_account_name=a.label,bank_account_id=a.id,bank_transaction_id=v_id,updated_at=now() where id=p_title_id;
  end if;
  return v_id;
end; $$;
revoke all on function public.finance_apply_title_payment(uuid,uuid,uuid,uuid,date,numeric,uuid,text) from public,anon,authenticated;

-- Seven-argument operations use a stable intent ID supplied by the form. The
-- old signatures remain full-settlement-only so legacy callers cannot duplicate
-- a partial payment without a retry identity.
create or replace function public.receive_finance_receivable(p_company_id uuid,p_project_id uuid,p_receivable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric,p_request_id uuid)
returns uuid language sql security definer set search_path='' as $$
  select public.finance_apply_title_payment(p_company_id,p_project_id,p_receivable_id,p_account_id,p_paid_at,p_paid_amount,p_request_id,'receivable');
$$;
create or replace function public.pay_finance_payable(p_company_id uuid,p_project_id uuid,p_payable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric,p_request_id uuid)
returns uuid language sql security definer set search_path='' as $$
  select public.finance_apply_title_payment(p_company_id,p_project_id,p_payable_id,p_account_id,p_paid_at,p_paid_amount,p_request_id,'payable');
$$;
create or replace function public.receive_finance_receivable(p_company_id uuid,p_project_id uuid,p_receivable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare remaining numeric;
begin
  if auth.uid() is null or not coalesce(public.has_company_permission(p_company_id,'receivables.manage'),false) then raise exception 'Sem permissão para registrar recebimentos.'; end if;
  select public.finance_title_remaining(amount,adjusted_amount,paid_amount,status) into remaining from public.receivables
    where id=p_receivable_id and company_id=p_company_id and project_id=p_project_id and status='open' for update;
  if remaining is null or p_paid_amount is distinct from remaining or remaining<=0 then raise exception 'Para baixa parcial, use o fluxo com identificação da intenção. Quitação deve corresponder ao saldo.'; end if;
  return public.finance_apply_title_payment(p_company_id,p_project_id,p_receivable_id,p_account_id,p_paid_at,p_paid_amount,gen_random_uuid(),'receivable');
end; $$;
create or replace function public.pay_finance_payable(p_company_id uuid,p_project_id uuid,p_payable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare remaining numeric;
begin
  if auth.uid() is null or not coalesce(public.has_company_permission(p_company_id,'payables.manage'),false) then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  select public.finance_title_remaining(amount,adjusted_amount,paid_amount,status) into remaining from public.payables
    where id=p_payable_id and company_id=p_company_id and project_id=p_project_id and status='open' for update;
  if remaining is null or p_paid_amount is distinct from remaining or remaining<=0 then raise exception 'Para baixa parcial, use o fluxo com identificação da intenção. Quitação deve corresponder ao saldo.'; end if;
  return public.finance_apply_title_payment(p_company_id,p_project_id,p_payable_id,p_account_id,p_paid_at,p_paid_amount,gen_random_uuid(),'payable');
end; $$;
revoke all on function public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric,uuid),public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric,uuid),
  public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric),public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) from public,anon;
grant execute on function public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric,uuid),public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric,uuid),
  public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric),public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) to authenticated;


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
    'open_amount', coalesce(sum(public.finance_title_remaining(amount,adjusted_amount,paid_amount,status)),0),
    'paid_amount', coalesce(sum(coalesce(paid_amount,case when status='paid' then adjusted_amount else 0 end)),0),
    'adjusted_amount',coalesce(sum(adjusted_amount) filter (where status<>'cancelled'),0),
    'partial_count',count(*) filter(where status='open' and coalesce(paid_amount,0)>0)
  ) into result
  from public.payables
  where company_id = p_company_id
    and (p_project_id is null or project_id = p_project_id);

  return result;
end;
$$;

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
      count(*) filter (where sale.status = 'active') as active_sales,
      coalesce(sum(sale.total_amount) filter (where sale.status = 'active'), 0) as registered_sale_amount
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
      count(*) filter(where receivable.status='open' and coalesce(receivable.paid_amount,0)>0) as partial_count,
      count(*) filter (
        where receivable.status = 'open'
          and receivable.due_date < current_date
      ) as overdue_count,
      coalesce(sum(receivable.amount) filter (
        where receivable.status <> 'cancelled'
      ), 0) as base_amount,
      coalesce(sum(receivable.adjusted_amount) filter (
        where receivable.status <> 'cancelled'
      ), 0) as updated_amount,
      coalesce(sum(receivable.correction_amount) filter (
        where receivable.status <> 'cancelled'
      ), 0) as correction_amount,
      coalesce(sum(public.finance_title_remaining(receivable.amount,receivable.adjusted_amount,receivable.paid_amount,receivable.status)),0) as open_amount,
      coalesce(sum(coalesce(receivable.paid_amount,case when receivable.status='paid' then receivable.adjusted_amount else 0 end)), 0) as paid_amount,
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
    'base_amount', receivable_totals.base_amount,
    'updated_amount', receivable_totals.updated_amount,
    'correction_amount', receivable_totals.correction_amount,
    'open_amount', receivable_totals.open_amount,
    'paid_amount', receivable_totals.paid_amount,
    'open_correction_amount', receivable_totals.open_correction_amount,
    'total_count', receivable_totals.total_count,
    'open_count', receivable_totals.open_count,
    'paid_count', receivable_totals.paid_count,
    'partial_count',receivable_totals.partial_count,
    'overdue_count', receivable_totals.overdue_count,
    'active_sales', sale_totals.active_sales,
    'registered_sale_amount', sale_totals.registered_sale_amount,

    -- Chaves antigas preservadas para compatibilidade com telas anteriores.
    'contracted_amount', receivable_totals.base_amount,
    'planned_amount', receivable_totals.base_amount,
    'unplanned_amount', greatest(
      sale_totals.registered_sale_amount - receivable_totals.base_amount,
      0
    )
  )
  from sale_totals cross join receivable_totals;
$$;

-- Read only a dated/minimized history, using title/report permissions rather
-- than exposing raw import snapshots or unrelated bank-account transactions.
create or replace function public.finance_title_payment_events(
  p_company_id uuid,p_project_id uuid default null,p_title_kind text default null,p_title_ids uuid[] default null
) returns table(event_id text,title_kind text,title_id uuid,project_id uuid,occurred_on date,amount numeric,kind text,medium text,account_name text,source_system text,history_dates_complete boolean)
language plpgsql stable security definer set search_path='' as $$
declare can_receivable boolean; can_payable boolean; can_reports boolean;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória.'; end if;
  if p_title_kind is not null and p_title_kind not in ('receivable','payable') then raise exception 'Tipo de título inválido.'; end if;
  if cardinality(p_title_ids)>10000 then raise exception 'Consulte até 10.000 títulos por chamada.'; end if;
  can_reports:=coalesce(public.has_company_permission(p_company_id,'cashflow.view'),false) or coalesce(public.has_company_permission(p_company_id,'reports.view'),false);
  can_receivable:=can_reports or coalesce(public.has_company_permission(p_company_id,'receivables.view'),false) or coalesce(public.has_company_permission(p_company_id,'receivables.manage'),false);
  can_payable:=can_reports or coalesce(public.has_company_permission(p_company_id,'payables.view'),false) or coalesce(public.has_company_permission(p_company_id,'payables.manage'),false);
  if not can_receivable and not can_payable then raise exception 'Sem permissão para consultar o histórico financeiro.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects p where p.id=p_project_id and p.company_id=p_company_id) then raise exception 'Obra não pertence à empresa.'; end if;
  return query
  with titles as (
    select 'receivable'::text k,r.id,r.company_id,r.project_id,r.status,r.paid_at,
      coalesce(r.paid_amount,case when r.status='paid' then coalesce(r.adjusted_amount,r.amount) else 0 end) paid,r.paid_account_name
    from public.receivables r where can_receivable and (p_title_kind is null or p_title_kind='receivable') and r.company_id=p_company_id
      and (p_project_id is null or r.project_id=p_project_id) and (p_title_ids is null or r.id=any(p_title_ids))
    union all
    select 'payable',p.id,p.company_id,p.project_id,p.status,p.paid_at,
      coalesce(p.paid_amount,case when p.status='paid' then p.adjusted_amount else 0 end),p.paid_account_name
    from public.payables p where can_payable and (p_title_kind is null or p_title_kind='payable') and p.company_id=p_company_id
      and (p_project_id is null or p.project_id=p_project_id) and (p_title_ids is null or p.id=any(p_title_ids))
  ), source_history as (
    select 'eobra:'||e.id::text eid,t.k,t.id tid,t.project_id pid,e.occurred_on d,
      case when e.kind='reversal' then -e.amount when e.kind='voided_payment' then 0 else e.amount end value,e.kind event_kind,e.medium event_medium,
      coalesce(a.details->>'label',a.details->>'name') account_label,'eobra'::text origin,e.kind<>'voided_payment' dates_complete
    from titles t join public.eobra_source_events e on e.company_id=t.company_id and e.project_id=t.project_id
      and ((t.k='receivable' and e.receivable_id=t.id) or (t.k='payable' and e.payable_id=t.id))
    left join public.eobra_source_accounts a on a.id=e.account_id and a.company_id=t.company_id
    where e.entity='settlement' and e.posting_policy='historical_source_only' and e.kind in ('payment','reversal','voided_payment')
  ), bank_history as (
    select 'bank:'||b.id::text,t.k,t.id,t.project_id,b.transaction_date,b.amount,'payment'::text,'bank'::text,a.label,'elos_os'::text,true
    from titles t join public.finance_bank_transactions b on b.company_id=t.company_id and b.project_id=t.project_id
      and ((t.k='receivable' and b.receivable_id=t.id) or (t.k='payable' and b.payable_id=t.id))
    join public.finance_bank_accounts a on a.id=b.bank_account_id and a.company_id=t.company_id
    where b.status<>'cancelled' and not exists(select 1 from public.eobra_source_events e
      where e.company_id=t.company_id and e.entity='settlement' and e.bank_transaction_id=b.id)
  ), actual_history as (select * from source_history union all select * from bank_history), legacy_history as (
    select 'legacy:'||t.k||':'||t.id::text,t.k,t.id,t.project_id,t.paid_at,t.paid,'payment'::text,'unknown'::text,t.paid_account_name,'legacy_snapshot'::text,true
    from titles t where t.status='paid' and t.paid>0 and t.paid_at is not null
      and not exists(select 1 from actual_history h where h.k=t.k and h.tid=t.id)
  )
  select h.* from (select * from actual_history union all select * from legacy_history) h
  order by h.k,h.tid,h.d,h.eid;
end; $$;
revoke all on function public.finance_title_payment_events(uuid,uuid,text,uuid[]) from public,anon;
grant execute on function public.finance_title_payment_events(uuid,uuid,text,uuid[]) to authenticated;

-- Update collection drafting only where its optional module is already fully
-- installed. This migration must not introduce that module or a dangling RPC.
do $optional_collections$ begin
  if to_regprocedure('finance_private.draft_collection(uuid,uuid,numeric,numeric,text)') is not null
    and to_regprocedure('finance_private.account(uuid,text)') is not null
    and to_regclass('public.finance_collection_drafts') is not null then
    execute $definition$
create or replace function finance_private.draft_collection(p_account uuid,p_receivable uuid,p_fine numeric,p_interest numeric,p_instructions text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; r public.receivables; id uuid; legal uuid; remaining numeric;
begin
  a:=finance_private.account(p_account,'receivables.manage');
  select * into r from public.receivables where receivables.id=p_receivable and company_id=a.company_id and status='open' for update;
  if r.id is null then raise exception 'Parcela indisponível.'; end if;
  select legal_entity_id into legal from public.projects where projects.id=r.project_id;
  if a.legal_entity_id is not null and a.legal_entity_id is distinct from legal then raise exception 'Conta pertence a outra SPE.'; end if;
  remaining:=public.finance_title_remaining(r.amount,r.adjusted_amount,r.paid_amount,r.status);
  if remaining<=0 then raise exception 'Parcela sem saldo exigível.'; end if;
  insert into public.finance_collection_drafts(company_id,project_id,bank_account_id,receivable_id,amount,due_date,fine_percent,monthly_interest_percent,instructions,created_by)
  values(a.company_id,r.project_id,a.id,r.id,remaining,r.due_date,p_fine,p_interest,p_instructions,auth.uid()) returning finance_collection_drafts.id into id;
  return id;
end; $$;
    $definition$;
  end if;
end; $optional_collections$;

-- Enabled with the matched remaining-balance readers and dated history loader.
create or replace function public.eobra_snapshot_partial_supported() returns boolean language sql immutable security invoker set search_path='' as $$select true$$;
create or replace function public.eobra_snapshot_payable_adjustments_supported() returns boolean language sql immutable security invoker set search_path='' as $$select true$$;
revoke all on function public.eobra_snapshot_partial_supported(),public.eobra_snapshot_payable_adjustments_supported() from public,anon;
grant execute on function public.eobra_snapshot_partial_supported(),public.eobra_snapshot_payable_adjustments_supported() to authenticated;

commit;
