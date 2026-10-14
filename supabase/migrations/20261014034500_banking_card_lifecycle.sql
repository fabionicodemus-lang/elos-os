-- Elos OS — Banking: ciclo completo de cartões corporativos
begin;

alter table public.finance_bank_instruments add column if not exists card_limit numeric(18,2);
alter table public.finance_bank_instruments add column if not exists closing_day integer;
alter table public.finance_bank_instruments add column if not exists card_due_day integer;
do $$ begin
  alter table public.finance_bank_instruments add constraint finance_bank_instruments_card_limit_check check(card_limit is null or card_limit>0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.finance_bank_instruments add constraint finance_bank_instruments_closing_day_check check(closing_day is null or closing_day between 1 and 28);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.finance_bank_instruments add constraint finance_bank_instruments_card_due_day_check check(card_due_day is null or card_due_day between 1 and 28);
exception when duplicate_object then null; end $$;

alter table public.finance_card_transactions add column if not exists purchase_group uuid default gen_random_uuid();
alter table public.finance_card_transactions add column if not exists status text not null default 'active';
alter table public.finance_card_transactions add column if not exists cancelled_at timestamptz;
alter table public.finance_card_transactions add column if not exists cancelled_by uuid references auth.users(id);
alter table public.finance_card_transactions add column if not exists cancellation_reason text;
do $$ begin
  alter table public.finance_card_transactions add constraint finance_card_transactions_status_check check(status in ('active','cancelled'));
exception when duplicate_object then null; end $$;

create table if not exists public.finance_card_cycle_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cycle_id uuid not null references public.finance_card_cycles(id) on delete restrict,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  transaction_id uuid not null references public.finance_bank_transactions(id) on delete restrict,
  settlement_date date not null,
  amount numeric(18,2) not null check(amount>0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(transaction_id)
);
alter table public.finance_card_cycle_settlements enable row level security;
revoke all on public.finance_card_cycle_settlements from anon,authenticated;
grant select on public.finance_card_cycle_settlements to authenticated;
create policy card_cycle_settlements_read on public.finance_card_cycle_settlements for select to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.view') or public.has_company_permission(company_id,'finance.bank_accounts.manage'));

create or replace function finance_private.card_month_day(p_month date,p_day integer) returns date
language sql immutable set search_path='' as $$
  select (date_trunc('month',p_month)::date + (least(p_day,extract(day from (date_trunc('month',p_month)+interval '1 month - 1 day'))::integer)-1))::date
$$;

create or replace function finance_private.card_cycle_for_month(p_instrument public.finance_bank_instruments,p_month date) returns uuid
language plpgsql security definer set search_path='' as $$
declare id uuid; close_date date; due_date date; begin
  if p_instrument.kind<>'card' or p_instrument.closing_day is null or p_instrument.card_due_day is null then raise exception 'Configure fechamento e vencimento do cartão.'; end if;
  close_date:=finance_private.card_month_day(p_month,p_instrument.closing_day);
  due_date:=finance_private.card_month_day(case when p_instrument.card_due_day>p_instrument.closing_day then p_month else (p_month+interval '1 month')::date end,p_instrument.card_due_day);
  select c.id into id from public.finance_card_cycles c where c.instrument_id=p_instrument.id and c.reference_month=date_trunc('month',p_month)::date;
  if id is null then
    insert into public.finance_card_cycles(company_id,bank_account_id,instrument_id,reference_month,closing_date,due_date,created_by)
    values(p_instrument.company_id,p_instrument.bank_account_id,p_instrument.id,date_trunc('month',p_month)::date,close_date,due_date,auth.uid()) returning finance_card_cycles.id into id;
  end if;
  return id;
end $$;

create or replace function finance_private.recalculate_card_cycle(p_cycle uuid) returns void
language plpgsql security definer set search_path='' as $$
declare total numeric; begin
  select coalesce(sum(amount) filter(where status='active'),0) into total from public.finance_card_transactions where cycle_id=p_cycle;
  update public.finance_card_cycles set total_amount=round(total,2),updated_at=now() where id=p_cycle and status<>'paid';
end $$;

create or replace function public.bank_save_card_settings(p_instrument uuid,p_limit numeric,p_closing_day integer,p_due_day integer) returns void
language plpgsql security invoker set search_path='' as $$
declare i public.finance_bank_instruments; begin
  select * into i from public.finance_bank_instruments where id=p_instrument;
  if i.id is null or i.kind<>'card' or not public.has_company_permission(i.company_id,'finance.bank_accounts.manage') then raise exception 'Cartão indisponível.'; end if;
  if p_limit is not null and p_limit<=0 then raise exception 'Limite inválido.'; end if;
  if p_closing_day not between 1 and 28 or p_due_day not between 1 and 28 then raise exception 'Informe dias entre 1 e 28.'; end if;
  update public.finance_bank_instruments set card_limit=p_limit,closing_day=p_closing_day,card_due_day=p_due_day,updated_at=now() where id=i.id;
end $$;

create or replace function public.bank_post_card_purchase(
  p_instrument uuid,p_project uuid,p_purchase_date date,p_description text,p_total numeric,p_installments integer,p_external_reference text
) returns uuid
language plpgsql security invoker set search_path='' as $$
declare i public.finance_bank_instruments; base_month date; cycle uuid; group_id uuid:=gen_random_uuid(); n integer; installment numeric; allocated numeric:=0; value numeric; begin
  select * into i from public.finance_bank_instruments where id=p_instrument and kind='card' and status='active';
  if i.id is null or not public.has_company_permission(i.company_id,'finance.bank_accounts.manage') then raise exception 'Cartão indisponível.'; end if;
  if p_purchase_date is null or coalesce(p_total,0)<=0 or p_installments not between 1 and 48 or length(trim(coalesce(p_description,'')))<2 then raise exception 'Compra inválida.'; end if;
  if p_project is not null and not exists(select 1 from public.projects where id=p_project and company_id=i.company_id and status<>'archived') then raise exception 'Obra inválida.'; end if;
  if nullif(trim(coalesce(p_external_reference,'')),'') is not null and exists(select 1 from public.finance_card_transactions where company_id=i.company_id and external_reference=p_external_reference) then
    select purchase_group into group_id from public.finance_card_transactions where company_id=i.company_id and external_reference=p_external_reference limit 1;
    return group_id;
  end if;
  base_month:=date_trunc('month',case when extract(day from p_purchase_date)::integer<=i.closing_day then p_purchase_date else (p_purchase_date+interval '1 month')::date end)::date;
  installment:=round(p_total/p_installments,2);
  for n in 1..p_installments loop
    value:=case when n=p_installments then round(p_total-allocated,2) else installment end;
    allocated:=allocated+value;
    cycle:=finance_private.card_cycle_for_month(i,(base_month+make_interval(months=>n-1))::date);
    if exists(select 1 from public.finance_card_cycles where id=cycle and status<>'open') then raise exception 'A fatura de uma das parcelas já está fechada.'; end if;
    insert into public.finance_card_transactions(company_id,cycle_id,project_id,purchase_date,description,amount,installment_number,installment_total,external_reference,purchase_group,created_by)
    values(i.company_id,cycle,p_project,p_purchase_date,trim(p_description),value,n,p_installments,nullif(trim(coalesce(p_external_reference,'')),''),group_id,auth.uid());
    perform finance_private.recalculate_card_cycle(cycle);
  end loop;
  return group_id;
end $$;

create or replace function public.bank_cancel_card_purchase(p_purchase_group uuid,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
declare company uuid; begin
  select company_id into company from public.finance_card_transactions where purchase_group=p_purchase_group limit 1;
  if company is null or not public.has_company_permission(company,'finance.bank_accounts.manage') then raise exception 'Compra indisponível.'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo.'; end if;
  if exists(select 1 from public.finance_card_transactions t join public.finance_card_cycles c on c.id=t.cycle_id where t.purchase_group=p_purchase_group and t.status='active' and c.status<>'open') then raise exception 'Não é possível cancelar compra com fatura fechada.'; end if;
  update public.finance_card_transactions set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=trim(p_reason) where purchase_group=p_purchase_group and status='active';
  perform finance_private.recalculate_card_cycle(cycle_id) from (select distinct cycle_id from public.finance_card_transactions where purchase_group=p_purchase_group) x;
end $$;

create or replace function public.bank_close_card_cycle(p_cycle uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.finance_card_cycles; begin
  select * into c from public.finance_card_cycles where id=p_cycle for update;
  if c.id is null or not public.has_company_permission(c.company_id,'finance.bank_accounts.manage') then raise exception 'Fatura indisponível.'; end if;
  if c.status<>'open' then raise exception 'Fatura não está aberta.'; end if;
  perform finance_private.recalculate_card_cycle(c.id);
  update public.finance_card_cycles set status='closed',updated_at=now() where id=c.id;
end $$;

create or replace function public.bank_pay_card_cycle(p_cycle uuid,p_account uuid,p_date date,p_amount numeric) returns uuid
language plpgsql security invoker set search_path='' as $$
declare c public.finance_card_cycles; i public.finance_bank_instruments; a public.finance_bank_accounts; already numeric; remaining numeric; bal numeric; tx uuid; sid uuid; begin
  select * into c from public.finance_card_cycles where id=p_cycle for update;
  if c.id is null or not public.has_company_permission(c.company_id,'finance.bank_accounts.manage') then raise exception 'Fatura indisponível.'; end if;
  if c.status not in ('closed','paid') then raise exception 'Feche a fatura antes do pagamento.'; end if;
  select * into i from public.finance_bank_instruments where id=c.instrument_id;
  select * into a from public.finance_bank_accounts where id=p_account and company_id=c.company_id and status='active' for update;
  if a.id is null then raise exception 'Conta bancária inválida.'; end if;
  if a.closed_through is not null and p_date<=a.closed_through then raise exception 'Período bancário encerrado.'; end if;
  select coalesce(sum(amount),0) into already from public.finance_card_cycle_settlements where cycle_id=c.id;
  remaining:=greatest(c.total_amount-already,0);
  if coalesce(p_amount,0)<=0 or p_amount>remaining+0.005 then raise exception 'Valor de pagamento inválido.'; end if;
  if not a.allow_negative then
    bal:=public.finance_bank_account_balance(a.id,p_date);
    if bal-p_amount < -0.005 then raise exception 'Saldo insuficiente.'; end if;
  end if;
  insert into public.finance_bank_transactions(company_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,description,counterparty,amount,status,source_system,source_id,created_by)
  values(c.company_id,a.legal_entity_id,a.id,p_date,c.due_date,'debit','payment','Pagamento de cartão · '||i.label,i.label,round(p_amount,2),'posted','elos_os','card-cycle:'||c.id::text||':'||gen_random_uuid()::text,auth.uid()) returning id into tx;
  insert into public.finance_card_cycle_settlements(company_id,cycle_id,bank_account_id,transaction_id,settlement_date,amount,created_by)
  values(c.company_id,c.id,a.id,tx,p_date,round(p_amount,2),auth.uid()) returning id into sid;
  already:=already+round(p_amount,2);
  update public.finance_card_cycles set status=case when already>=total_amount-0.005 then 'paid' else 'closed' end,updated_at=now() where id=c.id;
  return sid;
end $$;

create or replace view public.finance_card_cycle_balances with (security_invoker=true) as
select c.*,coalesce(s.paid_amount,0)::numeric(18,2) paid_amount,greatest(c.total_amount-coalesce(s.paid_amount,0),0)::numeric(18,2) remaining_amount
from public.finance_card_cycles c
left join(select cycle_id,sum(amount) paid_amount from public.finance_card_cycle_settlements group by cycle_id)s on s.cycle_id=c.id;
grant select on public.finance_card_cycle_balances to authenticated;

revoke all on function public.bank_save_card_settings(uuid,numeric,integer,integer),public.bank_post_card_purchase(uuid,uuid,date,text,numeric,integer,text),public.bank_cancel_card_purchase(uuid,text),public.bank_close_card_cycle(uuid),public.bank_pay_card_cycle(uuid,uuid,date,numeric) from public,anon;
grant execute on function public.bank_save_card_settings(uuid,numeric,integer,integer),public.bank_post_card_purchase(uuid,uuid,date,text,numeric,integer,text),public.bank_cancel_card_purchase(uuid,text),public.bank_close_card_cycle(uuid),public.bank_pay_card_cycle(uuid,uuid,date,numeric) to authenticated;

commit;
