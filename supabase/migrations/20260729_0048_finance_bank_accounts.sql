-- Elos OS — Financeiro · Contas Bancárias
-- Contas por empresa/SPE, saldos, movimentações, transferências, conciliação e integração com baixas.

begin;

create table if not exists public.finance_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legal_entity_id uuid references public.legal_entities(id) on delete restrict,
  label text not null,
  bank_code text,
  bank_name text not null,
  agency text,
  account_number text not null,
  account_digit text,
  account_type text not null default 'checking' check(account_type in ('checking','savings','payment','investment','cash')),
  currency_code text not null default 'BRL' check(length(currency_code)=3),
  pix_key text,
  opening_balance numeric(18,2) not null default 0,
  opening_balance_date date not null default current_date,
  allow_negative boolean not null default false,
  is_default boolean not null default false,
  status text not null default 'active' check(status in ('active','inactive')),
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_bank_account_label_check check(nullif(trim(label),'') is not null),
  constraint finance_bank_account_bank_check check(nullif(trim(bank_name),'') is not null),
  constraint finance_bank_account_number_check check(nullif(trim(account_number),'') is not null)
);

create unique index if not exists finance_bank_accounts_identity_unique_idx
  on public.finance_bank_accounts(
    company_id,
    coalesce(legal_entity_id,'00000000-0000-0000-0000-000000000000'::uuid),
    lower(bank_name),lower(coalesce(agency,'')),lower(account_number),lower(coalesce(account_digit,''))
  ) where status='active';
create unique index if not exists finance_bank_accounts_default_unique_idx
  on public.finance_bank_accounts(company_id) where is_default=true and status='active';
create index if not exists finance_bank_accounts_company_status_idx
  on public.finance_bank_accounts(company_id,status,label);
create index if not exists finance_bank_accounts_legal_entity_idx
  on public.finance_bank_accounts(company_id,legal_entity_id,status);

create table if not exists public.finance_bank_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,
  from_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  to_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  transfer_date date not null,
  amount numeric(18,2) not null,
  description text,
  status text not null default 'posted' check(status in ('posted','cancelled')),
  debit_transaction_id uuid,
  credit_transaction_id uuid,
  created_by uuid references auth.users(id),
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_bank_transfer_accounts_check check(from_account_id<>to_account_id),
  constraint finance_bank_transfer_amount_check check(amount>0),
  constraint finance_bank_transfer_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.finance_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,
  legal_entity_id uuid references public.legal_entities(id) on delete restrict,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  transaction_date date not null,
  competence_date date,
  direction text not null check(direction in ('credit','debit')),
  transaction_type text not null check(transaction_type in ('opening','receipt','payment','transfer','fee','tax','interest','adjustment','refund','other')),
  description text not null,
  document text,
  counterparty text,
  amount numeric(18,2) not null,
  status text not null default 'posted' check(status in ('posted','reconciled','cancelled')),
  reconciliation_date date,
  reconciliation_reference text,
  payable_id uuid references public.payables(id) on delete restrict,
  receivable_id uuid references public.receivables(id) on delete restrict,
  transfer_id uuid references public.finance_bank_transfers(id) on delete restrict,
  source_system text,
  source_id text,
  notes text,
  created_by uuid references auth.users(id),
  reconciled_by uuid references auth.users(id),
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_bank_transaction_amount_check check(amount>0),
  constraint finance_bank_transaction_description_check check(nullif(trim(description),'') is not null),
  constraint finance_bank_transaction_reconciliation_check check(status<>'reconciled' or reconciliation_date is not null),
  constraint finance_bank_transaction_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null),
  constraint finance_bank_transaction_origin_check check(
    (payable_id is null or direction='debit') and
    (receivable_id is null or direction='credit') and
    (transfer_id is null or transaction_type='transfer')
  )
);

alter table public.finance_bank_transfers
  add constraint finance_bank_transfers_debit_transaction_fk
  foreign key(debit_transaction_id) references public.finance_bank_transactions(id) on delete restrict;
alter table public.finance_bank_transfers
  add constraint finance_bank_transfers_credit_transaction_fk
  foreign key(credit_transaction_id) references public.finance_bank_transactions(id) on delete restrict;

create unique index if not exists finance_bank_transactions_source_unique_idx
  on public.finance_bank_transactions(company_id,source_system,source_id)
  where source_system is not null and source_id is not null;
create unique index if not exists finance_bank_transactions_payable_unique_idx
  on public.finance_bank_transactions(payable_id) where payable_id is not null and status<>'cancelled';
create unique index if not exists finance_bank_transactions_receivable_unique_idx
  on public.finance_bank_transactions(receivable_id) where receivable_id is not null and status<>'cancelled';
create index if not exists finance_bank_transactions_account_date_idx
  on public.finance_bank_transactions(bank_account_id,transaction_date desc,created_at desc);
create index if not exists finance_bank_transactions_project_idx
  on public.finance_bank_transactions(company_id,project_id,transaction_date desc);
create index if not exists finance_bank_transactions_reconciliation_idx
  on public.finance_bank_transactions(company_id,status,transaction_date desc);
create index if not exists finance_bank_transfers_company_date_idx
  on public.finance_bank_transfers(company_id,transfer_date desc);

alter table public.payables add column if not exists bank_account_id uuid references public.finance_bank_accounts(id) on delete restrict;
alter table public.payables add column if not exists bank_transaction_id uuid references public.finance_bank_transactions(id) on delete set null;
alter table public.receivables add column if not exists bank_account_id uuid references public.finance_bank_accounts(id) on delete restrict;
alter table public.receivables add column if not exists bank_transaction_id uuid references public.finance_bank_transactions(id) on delete set null;
create index if not exists payables_bank_account_idx on public.payables(company_id,bank_account_id,paid_at);
create index if not exists receivables_bank_account_idx on public.receivables(company_id,bank_account_id,paid_at);

insert into public.permissions(key,module,action,description) values
  ('finance.bank_accounts.view','finance_bank_accounts','view','Visualizar contas bancárias, saldos e extratos'),
  ('finance.bank_accounts.manage','finance_bank_accounts','manage','Cadastrar contas e lançar movimentações financeiras'),
  ('finance.bank_accounts.transfer','finance_bank_accounts','transfer','Transferir valores entre contas bancárias'),
  ('finance.bank_accounts.reconcile','finance_bank_accounts','reconcile','Conciliar e cancelar movimentações bancárias')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true
from public.roles r
cross join(values
  ('finance.bank_accounts.view'),('finance.bank_accounts.manage'),('finance.bank_accounts.transfer'),('finance.bank_accounts.reconcile')
)p(permission_key)
where r.key in('owner','admin','director','finance')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'finance.bank_accounts.view',true from public.roles r
where r.key in('engineering','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.finance_bank_accounts enable row level security;
alter table public.finance_bank_transactions enable row level security;
alter table public.finance_bank_transfers enable row level security;

drop policy if exists finance_bank_accounts_select on public.finance_bank_accounts;
create policy finance_bank_accounts_select on public.finance_bank_accounts for select to authenticated
using(
  public.has_company_permission(company_id,'finance.bank_accounts.view') or
  public.has_company_permission(company_id,'finance.bank_accounts.manage')
);
drop policy if exists finance_bank_accounts_write on public.finance_bank_accounts;
create policy finance_bank_accounts_write on public.finance_bank_accounts for all to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.manage'))
with check(public.has_company_permission(company_id,'finance.bank_accounts.manage'));

drop policy if exists finance_bank_transactions_select on public.finance_bank_transactions;
create policy finance_bank_transactions_select on public.finance_bank_transactions for select to authenticated
using(
  public.has_company_permission(company_id,'finance.bank_accounts.view') or
  public.has_company_permission(company_id,'finance.bank_accounts.manage') or
  public.has_company_permission(company_id,'finance.bank_accounts.reconcile')
);
drop policy if exists finance_bank_transactions_write on public.finance_bank_transactions;
create policy finance_bank_transactions_write on public.finance_bank_transactions for all to authenticated
using(
  public.has_company_permission(company_id,'finance.bank_accounts.manage') or
  public.has_company_permission(company_id,'finance.bank_accounts.reconcile')
)
with check(
  public.has_company_permission(company_id,'finance.bank_accounts.manage') or
  public.has_company_permission(company_id,'finance.bank_accounts.reconcile')
);

drop policy if exists finance_bank_transfers_select on public.finance_bank_transfers;
create policy finance_bank_transfers_select on public.finance_bank_transfers for select to authenticated
using(
  public.has_company_permission(company_id,'finance.bank_accounts.view') or
  public.has_company_permission(company_id,'finance.bank_accounts.transfer')
);
drop policy if exists finance_bank_transfers_write on public.finance_bank_transfers;
create policy finance_bank_transfers_write on public.finance_bank_transfers for all to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.transfer'))
with check(public.has_company_permission(company_id,'finance.bank_accounts.transfer'));

create or replace function public.finance_bank_account_balance(p_account_id uuid,p_until_date date default null)
returns numeric language sql stable security definer set search_path=public as $$
  select round(
    a.opening_balance + coalesce(sum(
      case
        when t.direction='credit' then t.amount
        when t.direction='debit' then -t.amount
        else 0
      end
    ) filter(where t.status in('posted','reconciled') and (p_until_date is null or t.transaction_date<=p_until_date)),0),2
  )
  from public.finance_bank_accounts a
  left join public.finance_bank_transactions t on t.bank_account_id=a.id
  where a.id=p_account_id
  group by a.id,a.opening_balance;
$$;

create or replace function public.finance_bank_accounts_summary(p_company_id uuid,p_project_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb; begin
  if not (
    public.has_company_permission(p_company_id,'finance.bank_accounts.view') or
    public.has_company_permission(p_company_id,'finance.bank_accounts.manage')
  ) then raise exception 'Sem permissão para visualizar as contas bancárias.'; end if;

  select jsonb_build_object(
    'account_count',count(*),
    'active_count',count(*) filter(where status='active'),
    'total_balance',coalesce(sum(public.finance_bank_account_balance(id,null)),0),
    'default_account_count',count(*) filter(where is_default=true and status='active'),
    'unreconciled_count',(
      select count(*) from public.finance_bank_transactions t
      where t.company_id=p_company_id and t.status='posted'
        and (p_project_id is null or t.project_id is null or t.project_id=p_project_id)
    )
  ) into v_result
  from public.finance_bank_accounts where company_id=p_company_id;
  return v_result;
end; $$;

create or replace function public.save_finance_bank_account(
  p_company_id uuid,p_account_id uuid,p_legal_entity_id uuid,p_label text,p_bank_code text,p_bank_name text,
  p_agency text,p_account_number text,p_account_digit text,p_account_type text,p_pix_key text,
  p_opening_balance numeric,p_opening_balance_date date,p_allow_negative boolean,p_is_default boolean,p_status text,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_existing public.finance_bank_accounts%rowtype; begin
  if not public.has_company_permission(p_company_id,'finance.bank_accounts.manage') then raise exception 'Sem permissão para gerenciar contas bancárias.'; end if;
  if p_account_type not in('checking','savings','payment','investment','cash') then raise exception 'Tipo de conta inválido.'; end if;
  if p_status not in('active','inactive') then raise exception 'Status da conta inválido.'; end if;
  if nullif(trim(coalesce(p_label,'')),'') is null or nullif(trim(coalesce(p_bank_name,'')),'') is null or nullif(trim(coalesce(p_account_number,'')),'') is null then
    raise exception 'Informe nome da conta, banco e número.';
  end if;
  if p_legal_entity_id is not null and not exists(
    select 1 from public.legal_entities where id=p_legal_entity_id and company_id=p_company_id and status='active'
  ) then raise exception 'Empresa/SPE inválida ou inativa.'; end if;

  if coalesce(p_is_default,false) and p_status='active' then
    update public.finance_bank_accounts set is_default=false,updated_by=auth.uid(),updated_at=now()
    where company_id=p_company_id and is_default=true and (p_account_id is null or id<>p_account_id);
  end if;

  if p_account_id is null then
    insert into public.finance_bank_accounts(
      company_id,legal_entity_id,label,bank_code,bank_name,agency,account_number,account_digit,account_type,pix_key,
      opening_balance,opening_balance_date,allow_negative,is_default,status,notes,created_by,updated_by
    ) values(
      p_company_id,p_legal_entity_id,trim(p_label),nullif(trim(coalesce(p_bank_code,'')),''),trim(p_bank_name),
      nullif(trim(coalesce(p_agency,'')),''),trim(p_account_number),nullif(trim(coalesce(p_account_digit,'')),''),p_account_type,
      nullif(trim(coalesce(p_pix_key,'')),''),coalesce(p_opening_balance,0),coalesce(p_opening_balance_date,current_date),
      coalesce(p_allow_negative,false),coalesce(p_is_default,false) and p_status='active',p_status,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()
    ) returning id into v_id;
  else
    select * into v_existing from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id for update;
    if v_existing.id is null then raise exception 'Conta bancária não encontrada.'; end if;
    if exists(select 1 from public.finance_bank_transactions where bank_account_id=p_account_id) and (
      coalesce(p_opening_balance,0)<>v_existing.opening_balance or coalesce(p_opening_balance_date,current_date)<>v_existing.opening_balance_date
    ) then raise exception 'O saldo inicial não pode ser alterado depois que a conta possui movimentações.'; end if;
    if p_status='inactive' and v_existing.is_default then p_is_default:=false; end if;
    update public.finance_bank_accounts set
      legal_entity_id=p_legal_entity_id,label=trim(p_label),bank_code=nullif(trim(coalesce(p_bank_code,'')),''),bank_name=trim(p_bank_name),
      agency=nullif(trim(coalesce(p_agency,'')),''),account_number=trim(p_account_number),account_digit=nullif(trim(coalesce(p_account_digit,'')),''),
      account_type=p_account_type,pix_key=nullif(trim(coalesce(p_pix_key,'')),''),opening_balance=coalesce(p_opening_balance,0),
      opening_balance_date=coalesce(p_opening_balance_date,current_date),allow_negative=coalesce(p_allow_negative,false),
      is_default=coalesce(p_is_default,false) and p_status='active',status=p_status,notes=nullif(trim(coalesce(p_notes,'')),''),
      updated_by=auth.uid(),updated_at=now()
    where id=p_account_id returning id into v_id;
  end if;
  return v_id;
end; $$;

create or replace function public.post_finance_bank_transaction(
  p_company_id uuid,p_project_id uuid,p_account_id uuid,p_transaction_date date,p_competence_date date,
  p_direction text,p_transaction_type text,p_description text,p_document text,p_counterparty text,p_amount numeric,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_account public.finance_bank_accounts%rowtype; v_project public.projects%rowtype; v_balance numeric; v_id uuid; begin
  if not public.has_company_permission(p_company_id,'finance.bank_accounts.manage') then raise exception 'Sem permissão para lançar movimentações.'; end if;
  if p_direction not in('credit','debit') then raise exception 'Natureza da movimentação inválida.'; end if;
  if p_transaction_type not in('receipt','payment','fee','tax','interest','adjustment','refund','other') then raise exception 'Tipo de movimentação inválido.'; end if;
  if p_transaction_date is null or coalesce(p_amount,0)<=0 or nullif(trim(coalesce(p_description,'')),'') is null then
    raise exception 'Informe data, descrição e valor válido.';
  end if;
  select * into v_account from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id and status='active' for update;
  if v_account.id is null then raise exception 'Conta bancária inválida ou inativa.'; end if;
  if p_project_id is not null then
    select * into v_project from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived';
    if v_project.id is null then raise exception 'Empreendimento inválido.'; end if;
    if v_account.legal_entity_id is not null and v_project.legal_entity_id is distinct from v_account.legal_entity_id then
      raise exception 'A conta bancária pertence a outra empresa/SPE.';
    end if;
  end if;
  if p_direction='debit' and not v_account.allow_negative then
    v_balance:=public.finance_bank_account_balance(v_account.id,p_transaction_date);
    if v_balance-coalesce(p_amount,0)<-0.005 then raise exception 'Saldo insuficiente na conta bancária.'; end if;
  end if;
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
    description,document,counterparty,amount,status,source_system,source_id,notes,created_by
  ) values(
    p_company_id,p_project_id,v_account.legal_entity_id,v_account.id,p_transaction_date,p_competence_date,p_direction,p_transaction_type,
    trim(p_description),nullif(trim(coalesce(p_document,'')),''),nullif(trim(coalesce(p_counterparty,'')),''),round(p_amount,2),'posted',
    'elos_os','manual-bank:'||gen_random_uuid()::text,nullif(trim(coalesce(p_notes,'')),''),auth.uid()
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.transfer_finance_bank_accounts(
  p_company_id uuid,p_project_id uuid,p_from_account_id uuid,p_to_account_id uuid,p_transfer_date date,p_amount numeric,p_description text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_from public.finance_bank_accounts%rowtype; v_to public.finance_bank_accounts%rowtype; v_transfer_id uuid; v_debit_id uuid; v_credit_id uuid; v_balance numeric; begin
  if not public.has_company_permission(p_company_id,'finance.bank_accounts.transfer') then raise exception 'Sem permissão para transferir entre contas.'; end if;
  if p_from_account_id=p_to_account_id then raise exception 'Selecione contas diferentes.'; end if;
  if p_transfer_date is null or coalesce(p_amount,0)<=0 then raise exception 'Informe data e valor válido.'; end if;
  select * into v_from from public.finance_bank_accounts where id=p_from_account_id and company_id=p_company_id and status='active' for update;
  select * into v_to from public.finance_bank_accounts where id=p_to_account_id and company_id=p_company_id and status='active' for update;
  if v_from.id is null or v_to.id is null then raise exception 'Uma das contas está inválida ou inativa.'; end if;
  if v_from.legal_entity_id is distinct from v_to.legal_entity_id then raise exception 'Transferências diretas exigem contas da mesma empresa/SPE.'; end if;
  if not v_from.allow_negative then
    v_balance:=public.finance_bank_account_balance(v_from.id,p_transfer_date);
    if v_balance-coalesce(p_amount,0)<-0.005 then raise exception 'Saldo insuficiente na conta de origem.'; end if;
  end if;
  insert into public.finance_bank_transfers(company_id,project_id,from_account_id,to_account_id,transfer_date,amount,description,status,created_by)
  values(p_company_id,p_project_id,v_from.id,v_to.id,p_transfer_date,round(p_amount,2),nullif(trim(coalesce(p_description,'')),''),'posted',auth.uid())
  returning id into v_transfer_id;
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,counterparty,amount,status,transfer_id,source_system,source_id,created_by
  ) values(
    p_company_id,p_project_id,v_from.legal_entity_id,v_from.id,p_transfer_date,'debit','transfer',coalesce(nullif(trim(coalesce(p_description,'')),''),'Transferência entre contas'),v_to.label,round(p_amount,2),'posted',v_transfer_id,'elos_os','bank-transfer:'||v_transfer_id::text||':debit',auth.uid()
  ) returning id into v_debit_id;
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,counterparty,amount,status,transfer_id,source_system,source_id,created_by
  ) values(
    p_company_id,p_project_id,v_to.legal_entity_id,v_to.id,p_transfer_date,'credit','transfer',coalesce(nullif(trim(coalesce(p_description,'')),''),'Transferência entre contas'),v_from.label,round(p_amount,2),'posted',v_transfer_id,'elos_os','bank-transfer:'||v_transfer_id::text||':credit',auth.uid()
  ) returning id into v_credit_id;
  update public.finance_bank_transfers set debit_transaction_id=v_debit_id,credit_transaction_id=v_credit_id,updated_at=now() where id=v_transfer_id;
  return v_transfer_id;
end; $$;

create or replace function public.reconcile_finance_bank_transaction(
  p_company_id uuid,p_transaction_id uuid,p_reconciliation_date date,p_reference text
) returns text language plpgsql security definer set search_path=public as $$
begin
  if not public.has_company_permission(p_company_id,'finance.bank_accounts.reconcile') then raise exception 'Sem permissão para conciliar movimentações.'; end if;
  update public.finance_bank_transactions set
    status='reconciled',reconciliation_date=coalesce(p_reconciliation_date,current_date),
    reconciliation_reference=nullif(trim(coalesce(p_reference,'')),''),reconciled_by=auth.uid(),updated_at=now()
  where id=p_transaction_id and company_id=p_company_id and status='posted';
  if not found then raise exception 'Movimentação não disponível para conciliação.'; end if;
  return 'reconciled';
end; $$;

create or replace function public.cancel_finance_bank_transaction(
  p_company_id uuid,p_transaction_id uuid,p_reason text
) returns text language plpgsql security definer set search_path=public as $$
declare v_transaction public.finance_bank_transactions%rowtype; v_pair record; begin
  if not public.has_company_permission(p_company_id,'finance.bank_accounts.reconcile') then raise exception 'Sem permissão para cancelar movimentações.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into v_transaction from public.finance_bank_transactions where id=p_transaction_id and company_id=p_company_id for update;
  if v_transaction.id is null or v_transaction.status='cancelled' then raise exception 'Movimentação não disponível.'; end if;
  if v_transaction.payable_id is not null or v_transaction.receivable_id is not null then
    raise exception 'Estorne a baixa no módulo de origem para cancelar esta movimentação.';
  end if;
  if v_transaction.transfer_id is not null then
    update public.finance_bank_transactions set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
    where transfer_id=v_transaction.transfer_id and company_id=p_company_id and status<>'cancelled';
    update public.finance_bank_transfers set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
    where id=v_transaction.transfer_id and company_id=p_company_id;
  else
    update public.finance_bank_transactions set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now()
    where id=v_transaction.id;
  end if;
  return 'cancelled';
end; $$;

create or replace function public.pay_finance_payable(
  p_company_id uuid,p_project_id uuid,p_payable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_payable public.payables%rowtype; v_account public.finance_bank_accounts%rowtype; v_project public.projects%rowtype; v_supplier_name text; v_balance numeric; v_transaction_id uuid; begin
  if not public.has_company_permission(p_company_id,'payables.manage') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  if p_paid_at is null or coalesce(p_paid_amount,0)<=0 then raise exception 'Informe data e valor pagos.'; end if;
  select * into v_payable from public.payables where id=p_payable_id and company_id=p_company_id and project_id=p_project_id and status='open' for update;
  if v_payable.id is null then raise exception 'Conta a pagar não disponível para baixa.'; end if;
  select * into v_account from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id and status='active' for update;
  if v_account.id is null then raise exception 'Conta bancária inválida ou inativa.'; end if;
  select * into v_project from public.projects where id=p_project_id and company_id=p_company_id;
  if v_account.legal_entity_id is not null and v_project.legal_entity_id is distinct from v_account.legal_entity_id then raise exception 'A conta bancária pertence a outra empresa/SPE.'; end if;
  if not v_account.allow_negative then
    v_balance:=public.finance_bank_account_balance(v_account.id,p_paid_at);
    if v_balance-coalesce(p_paid_amount,0)<-0.005 then raise exception 'Saldo insuficiente na conta bancária.'; end if;
  end if;
  select coalesce(trade_name,legal_name) into v_supplier_name from public.suppliers where id=v_payable.supplier_id;
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
    description,document,counterparty,amount,status,payable_id,source_system,source_id,created_by
  ) values(
    p_company_id,p_project_id,v_account.legal_entity_id,v_account.id,p_paid_at,v_payable.due_date,'debit','payment',
    coalesce(v_payable.document,'Pagamento de conta'),v_payable.document,v_supplier_name,round(p_paid_amount,2),'posted',v_payable.id,'elos_os','payable:'||v_payable.id::text,auth.uid()
  ) returning id into v_transaction_id;
  update public.payables set
    status='paid',paid_at=p_paid_at,paid_amount=round(p_paid_amount,2),paid_account_name=v_account.label,
    bank_account_id=v_account.id,bank_transaction_id=v_transaction_id,updated_at=now()
  where id=v_payable.id;
  return v_transaction_id;
end; $$;

create or replace function public.receive_finance_receivable(
  p_company_id uuid,p_project_id uuid,p_receivable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_receivable public.receivables%rowtype; v_account public.finance_bank_accounts%rowtype; v_project public.projects%rowtype; v_client_name text; v_transaction_id uuid; begin
  if not public.has_company_permission(p_company_id,'receivables.manage') then raise exception 'Sem permissão para registrar recebimentos.'; end if;
  if p_paid_at is null or coalesce(p_paid_amount,0)<=0 then raise exception 'Informe data e valor recebidos.'; end if;
  select * into v_receivable from public.receivables where id=p_receivable_id and company_id=p_company_id and project_id=p_project_id and status='open' for update;
  if v_receivable.id is null then raise exception 'Conta a receber não disponível para baixa.'; end if;
  select * into v_account from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id and status='active' for update;
  if v_account.id is null then raise exception 'Conta bancária inválida ou inativa.'; end if;
  select * into v_project from public.projects where id=p_project_id and company_id=p_company_id;
  if v_account.legal_entity_id is not null and v_project.legal_entity_id is distinct from v_account.legal_entity_id then raise exception 'A conta bancária pertence a outra empresa/SPE.'; end if;
  select name into v_client_name from public.clients where id=v_receivable.client_id;
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
    description,document,counterparty,amount,status,receivable_id,source_system,source_id,created_by
  ) values(
    p_company_id,p_project_id,v_account.legal_entity_id,v_account.id,p_paid_at,v_receivable.due_date,'credit','receipt',
    coalesce(v_receivable.description,'Recebimento de parcela'),v_receivable.sequence_number::text||'/'||v_receivable.sequence_total::text,v_client_name,
    round(p_paid_amount,2),'posted',v_receivable.id,'elos_os','receivable:'||v_receivable.id::text,auth.uid()
  ) returning id into v_transaction_id;
  update public.receivables set
    status='paid',paid_at=p_paid_at,paid_amount=round(p_paid_amount,2),paid_account_name=v_account.label,
    bank_account_id=v_account.id,bank_transaction_id=v_transaction_id,correction_locked=true,updated_at=now()
  where id=v_receivable.id;
  return v_transaction_id;
end; $$;

update public.payables p set bank_account_id=a.id
from public.finance_bank_accounts a
where p.company_id=a.company_id and p.status='paid' and p.bank_account_id is null
  and lower(trim(coalesce(p.paid_account_name,'')))=lower(trim(a.label));
update public.receivables r set bank_account_id=a.id
from public.finance_bank_accounts a
where r.company_id=a.company_id and r.status='paid' and r.bank_account_id is null
  and lower(trim(coalesce(r.paid_account_name,'')))=lower(trim(a.label));

insert into public.finance_bank_transactions(
  company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
  description,document,counterparty,amount,status,payable_id,source_system,source_id,created_by
)
select p.company_id,p.project_id,a.legal_entity_id,p.bank_account_id,p.paid_at,p.due_date,'debit','payment',
  coalesce(p.document,'Pagamento de conta'),p.document,coalesce(s.trade_name,s.legal_name),coalesce(p.paid_amount,p.amount),'posted',p.id,'elos_os','payable:'||p.id::text,p.created_by
from public.payables p
join public.finance_bank_accounts a on a.id=p.bank_account_id
left join public.suppliers s on s.id=p.supplier_id
where p.status='paid' and p.paid_at is not null and p.bank_account_id is not null
on conflict(company_id,source_system,source_id) do nothing;

insert into public.finance_bank_transactions(
  company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
  description,document,counterparty,amount,status,receivable_id,source_system,source_id,created_by
)
select r.company_id,r.project_id,a.legal_entity_id,r.bank_account_id,r.paid_at,r.due_date,'credit','receipt',
  coalesce(r.description,'Recebimento de parcela'),r.sequence_number::text||'/'||r.sequence_total::text,c.name,coalesce(r.paid_amount,r.adjusted_amount,r.amount),'posted',r.id,'elos_os','receivable:'||r.id::text,r.created_by
from public.receivables r
join public.finance_bank_accounts a on a.id=r.bank_account_id
left join public.clients c on c.id=r.client_id
where r.status='paid' and r.paid_at is not null and r.bank_account_id is not null
on conflict(company_id,source_system,source_id) do nothing;

update public.payables p set bank_transaction_id=t.id
from public.finance_bank_transactions t where t.payable_id=p.id and p.bank_transaction_id is null and t.status<>'cancelled';
update public.receivables r set bank_transaction_id=t.id
from public.finance_bank_transactions t where t.receivable_id=r.id and r.bank_transaction_id is null and t.status<>'cancelled';

grant select,insert,update on public.finance_bank_accounts,public.finance_bank_transactions,public.finance_bank_transfers to authenticated;
grant execute on function public.finance_bank_account_balance(uuid,date) to authenticated;
grant execute on function public.finance_bank_accounts_summary(uuid,uuid) to authenticated;
grant execute on function public.save_finance_bank_account(uuid,uuid,uuid,text,text,text,text,text,text,text,text,numeric,date,boolean,boolean,text,text) to authenticated;
grant execute on function public.post_finance_bank_transaction(uuid,uuid,uuid,date,date,text,text,text,text,text,numeric,text) to authenticated;
grant execute on function public.transfer_finance_bank_accounts(uuid,uuid,uuid,uuid,date,numeric,text) to authenticated;
grant execute on function public.reconcile_finance_bank_transaction(uuid,uuid,date,text) to authenticated;
grant execute on function public.cancel_finance_bank_transaction(uuid,uuid,text) to authenticated;
grant execute on function public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) to authenticated;
grant execute on function public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric) to authenticated;

commit;
