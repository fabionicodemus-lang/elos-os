-- Elos OS — Banking: liquidações parciais, conexões e cobranças por provedor
-- Evolui o núcleo bancário sem acoplar o ERP a um banco específico.
begin;

-- Múltiplas baixas por título exigem remover a unicidade histórica por payable/receivable.
drop index if exists public.finance_bank_transactions_payable_unique_idx;
drop index if exists public.finance_bank_transactions_receivable_unique_idx;
create index if not exists finance_bank_transactions_payable_idx
  on public.finance_bank_transactions(payable_id, transaction_date desc)
  where payable_id is not null and status <> 'cancelled';
create index if not exists finance_bank_transactions_receivable_idx
  on public.finance_bank_transactions(receivable_id, transaction_date desc)
  where receivable_id is not null and status <> 'cancelled';

create table if not exists public.finance_bank_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete cascade,
  provider text not null check(provider in ('asaas','cnab','nexxera','other')),
  label text not null check(length(trim(label)) between 1 and 120),
  environment text not null default 'sandbox' check(environment in ('sandbox','production')),
  credential_ref text,
  provider_account_ref text,
  status text not null default 'active' check(status in ('active','inactive')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, provider, label)
);
create index if not exists finance_bank_connections_account_idx
  on public.finance_bank_connections(bank_account_id, status);

create table if not exists public.finance_collection_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  connection_id uuid not null references public.finance_bank_connections(id) on delete restrict,
  draft_id uuid references public.finance_collection_drafts(id) on delete set null,
  receivable_id uuid not null references public.receivables(id) on delete restrict,
  billing_type text not null check(billing_type in ('boleto','pix')),
  provider text not null,
  external_id text not null,
  external_reference text not null,
  status text not null default 'pending' check(status in ('pending','confirmed','received','overdue','cancelled','refunded','error')),
  amount numeric(18,2) not null check(amount > 0),
  net_amount numeric(18,2),
  fee_amount numeric(18,2) not null default 0 check(fee_amount >= 0),
  due_date date not null,
  paid_at date,
  invoice_url text,
  bank_slip_url text,
  pix_payload text,
  pix_expiration_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, external_id),
  unique(connection_id, external_reference)
);
create index if not exists finance_collection_charges_receivable_idx
  on public.finance_collection_charges(receivable_id, status, due_date);

create table if not exists public.finance_receivable_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  receivable_id uuid not null references public.receivables(id) on delete restrict,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  charge_id uuid references public.finance_collection_charges(id) on delete set null,
  receipt_transaction_id uuid not null references public.finance_bank_transactions(id) on delete restrict,
  fee_transaction_id uuid references public.finance_bank_transactions(id) on delete restrict,
  settlement_date date not null,
  gross_amount numeric(18,2) not null check(gross_amount > 0),
  fee_amount numeric(18,2) not null default 0 check(fee_amount >= 0),
  net_amount numeric(18,2) not null check(net_amount > 0),
  source text not null default 'manual' check(source in ('manual','asaas','cnab_return','bank_webhook','other')),
  external_reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check(abs((gross_amount - fee_amount) - net_amount) < 0.01)
);
create unique index if not exists finance_receivable_settlements_transaction_uq
  on public.finance_receivable_settlements(receipt_transaction_id);
create unique index if not exists finance_receivable_settlements_external_uq
  on public.finance_receivable_settlements(company_id, source, external_reference)
  where external_reference is not null;
create index if not exists finance_receivable_settlements_receivable_idx
  on public.finance_receivable_settlements(receivable_id, settlement_date);

create table if not exists public.finance_payable_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  payable_id uuid not null references public.payables(id) on delete restrict,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  transaction_id uuid not null references public.finance_bank_transactions(id) on delete restrict,
  settlement_date date not null,
  amount numeric(18,2) not null check(amount > 0),
  source text not null default 'manual' check(source in ('manual','cnab_return','bank_webhook','other')),
  external_reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists finance_payable_settlements_transaction_uq
  on public.finance_payable_settlements(transaction_id);
create unique index if not exists finance_payable_settlements_external_uq
  on public.finance_payable_settlements(company_id, source, external_reference)
  where external_reference is not null;
create index if not exists finance_payable_settlements_payable_idx
  on public.finance_payable_settlements(payable_id, settlement_date);

create table if not exists public.finance_bank_webhook_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.finance_bank_connections(id) on delete cascade,
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  external_resource_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  unique(connection_id, external_event_id)
);
create index if not exists finance_bank_webhook_events_status_idx
  on public.finance_bank_webhook_events(connection_id, processed_at, created_at desc);

-- Estrutura para CNAB e cartões: o parser/gerador fica na aplicação, e o banco preserva evidência/histórico.
create table if not exists public.finance_cnab_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  connection_id uuid references public.finance_bank_connections(id) on delete set null,
  direction text not null check(direction in ('remittance','return')),
  layout text not null check(layout in ('240','400')),
  file_name text not null,
  file_hash text not null,
  status text not null default 'registered' check(status in ('registered','generated','imported','processed','error','cancelled')),
  record_count integer not null default 0,
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(bank_account_id, direction, file_hash)
);

create table if not exists public.finance_card_cycles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_account_id uuid not null references public.finance_bank_accounts(id) on delete restrict,
  instrument_id uuid not null references public.finance_bank_instruments(id) on delete restrict,
  reference_month date not null,
  closing_date date not null,
  due_date date not null,
  status text not null default 'open' check(status in ('open','closed','paid','cancelled')),
  total_amount numeric(18,2) not null default 0 check(total_amount >= 0),
  payable_id uuid references public.payables(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(instrument_id, reference_month)
);
create table if not exists public.finance_card_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cycle_id uuid not null references public.finance_card_cycles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,
  purchase_date date not null,
  description text not null,
  amount numeric(18,2) not null check(amount > 0),
  installment_number integer not null default 1 check(installment_number > 0),
  installment_total integer not null default 1 check(installment_total > 0),
  external_reference text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists finance_card_transactions_cycle_idx on public.finance_card_transactions(cycle_id, purchase_date);

-- RLS explícito e grants explícitos: necessário para a mudança de Data API do Supabase em 30/10/2026.
do $$ declare t text; begin
  foreach t in array array[
    'finance_bank_connections','finance_collection_charges','finance_receivable_settlements',
    'finance_payable_settlements','finance_bank_webhook_events','finance_cnab_files',
    'finance_card_cycles','finance_card_transactions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy bank_connections_read on public.finance_bank_connections for select to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.view') or public.has_company_permission(company_id,'finance.bank_accounts.manage'));
create policy bank_charges_read on public.finance_collection_charges for select to authenticated
using(public.has_company_permission(company_id,'receivables.view') or public.has_company_permission(company_id,'receivables.manage'));
create policy bank_receivable_settlements_read on public.finance_receivable_settlements for select to authenticated
using(public.has_company_permission(company_id,'receivables.view') or public.has_company_permission(company_id,'receivables.manage'));
create policy bank_payable_settlements_read on public.finance_payable_settlements for select to authenticated
using(public.has_company_permission(company_id,'payables.view') or public.has_company_permission(company_id,'payables.manage'));
create policy bank_webhooks_read on public.finance_bank_webhook_events for select to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.manage'));
create policy bank_cnab_read on public.finance_cnab_files for select to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.view') or public.has_company_permission(company_id,'finance.bank_accounts.manage'));
create policy bank_card_cycles_read on public.finance_card_cycles for select to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.view') or public.has_company_permission(company_id,'finance.bank_accounts.manage'));
create policy bank_card_transactions_read on public.finance_card_transactions for select to authenticated
using(public.has_company_permission(company_id,'finance.bank_accounts.view') or public.has_company_permission(company_id,'finance.bank_accounts.manage'));

-- Função interna: aplica recebimento parcial/total e separa tarifa do valor recebido.
create or replace function finance_private.apply_receivable_settlement(
  p_company_id uuid,p_receivable_id uuid,p_account_id uuid,p_date date,p_gross numeric,p_fee numeric,
  p_source text,p_external_reference text,p_charge_id uuid,p_actor uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  r public.receivables; a public.finance_bank_accounts; already numeric; target numeric; remaining numeric;
  net numeric; receipt_tx uuid; fee_tx uuid; sid uuid;
begin
  if p_date is null or coalesce(p_gross,0)<=0 or coalesce(p_fee,0)<0 or p_fee>=p_gross then raise exception 'Liquidação inválida.'; end if;
  select * into r from public.receivables where id=p_receivable_id and company_id=p_company_id for update;
  if r.id is null or r.status='cancelled' then raise exception 'Conta a receber indisponível.'; end if;
  select * into a from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id and status='active' for update;
  if a.id is null then raise exception 'Conta bancária inválida ou inativa.'; end if;
  if a.closed_through is not null and p_date<=a.closed_through then raise exception 'Período bancário encerrado.'; end if;
  if a.legal_entity_id is not null and exists(select 1 from public.projects p where p.id=r.project_id and p.legal_entity_id is distinct from a.legal_entity_id) then raise exception 'A conta pertence a outra SPE.'; end if;
  target:=coalesce(r.adjusted_amount,r.amount);
  select coalesce(sum(gross_amount),0) into already from public.finance_receivable_settlements where receivable_id=r.id;
  remaining:=greatest(target-already,0);
  if p_gross>remaining+0.005 then raise exception 'Valor recebido excede o saldo da parcela.'; end if;
  if p_external_reference is not null and exists(select 1 from public.finance_receivable_settlements where company_id=p_company_id and source=p_source and external_reference=p_external_reference) then
    select id into sid from public.finance_receivable_settlements where company_id=p_company_id and source=p_source and external_reference=p_external_reference;
    return sid;
  end if;
  net:=round(p_gross-p_fee,2);
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
    description,amount,status,receivable_id,source_system,source_id,created_by
  ) values(
    p_company_id,r.project_id,a.legal_entity_id,a.id,p_date,r.due_date,'credit','receipt',r.description,net,'posted',r.id,
    p_source,coalesce(p_external_reference,'manual:'||gen_random_uuid()::text)||':receipt',p_actor
  ) returning id into receipt_tx;
  if p_fee>0 then
    insert into public.finance_bank_transactions(
      company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
      description,amount,status,source_system,source_id,created_by
    ) values(
      p_company_id,r.project_id,a.legal_entity_id,a.id,p_date,r.due_date,'debit','fee','Tarifa de recebimento · '||r.description,
      round(p_fee,2),'posted',p_source,coalesce(p_external_reference,'manual:'||gen_random_uuid()::text)||':fee',p_actor
    ) returning id into fee_tx;
  end if;
  insert into public.finance_receivable_settlements(
    company_id,project_id,receivable_id,bank_account_id,charge_id,receipt_transaction_id,fee_transaction_id,
    settlement_date,gross_amount,fee_amount,net_amount,source,external_reference,created_by
  ) values(
    p_company_id,r.project_id,r.id,a.id,p_charge_id,receipt_tx,fee_tx,p_date,round(p_gross,2),round(p_fee,2),net,p_source,p_external_reference,p_actor
  ) returning id into sid;
  already:=already+round(p_gross,2);
  update public.receivables set
    paid_amount=already,
    status=case when already>=target-0.005 then 'paid' else 'open' end,
    paid_at=case when already>=target-0.005 then p_date else null end,
    paid_account_name=a.label,bank_account_id=a.id,bank_transaction_id=receipt_tx,updated_at=now()
  where id=r.id;
  return sid;
end $$;

create or replace function finance_private.apply_payable_settlement(
  p_company_id uuid,p_payable_id uuid,p_account_id uuid,p_date date,p_amount numeric,
  p_source text,p_external_reference text,p_actor uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  p public.payables; a public.finance_bank_accounts; already numeric; remaining numeric; bal numeric; tx uuid; sid uuid;
begin
  if p_date is null or coalesce(p_amount,0)<=0 then raise exception 'Liquidação inválida.'; end if;
  select * into p from public.payables where id=p_payable_id and company_id=p_company_id for update;
  if p.id is null or p.status='cancelled' then raise exception 'Conta a pagar indisponível.'; end if;
  select * into a from public.finance_bank_accounts where id=p_account_id and company_id=p_company_id and status='active' for update;
  if a.id is null then raise exception 'Conta bancária inválida ou inativa.'; end if;
  if a.closed_through is not null and p_date<=a.closed_through then raise exception 'Período bancário encerrado.'; end if;
  if a.legal_entity_id is not null and exists(select 1 from public.projects pr where pr.id=p.project_id and pr.legal_entity_id is distinct from a.legal_entity_id) then raise exception 'A conta pertence a outra SPE.'; end if;
  select coalesce(sum(amount),0) into already from public.finance_payable_settlements where payable_id=p.id;
  remaining:=greatest(p.amount-already,0);
  if p_amount>remaining+0.005 then raise exception 'Valor pago excede o saldo do título.'; end if;
  if p_external_reference is not null and exists(select 1 from public.finance_payable_settlements where company_id=p_company_id and source=p_source and external_reference=p_external_reference) then
    select id into sid from public.finance_payable_settlements where company_id=p_company_id and source=p_source and external_reference=p_external_reference;
    return sid;
  end if;
  if not a.allow_negative then
    bal:=public.finance_bank_account_balance(a.id,p_date);
    if bal-p_amount < -0.005 then raise exception 'Saldo insuficiente na conta bancária.'; end if;
  end if;
  insert into public.finance_bank_transactions(
    company_id,project_id,legal_entity_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,
    description,document,amount,status,payable_id,source_system,source_id,created_by
  ) values(
    p_company_id,p.project_id,a.legal_entity_id,a.id,p_date,p.due_date,'debit','payment',coalesce(p.document,'Pagamento de conta'),p.document,
    round(p_amount,2),'posted',p.id,p_source,coalesce(p_external_reference,'manual:'||gen_random_uuid()::text)||':payment',p_actor
  ) returning id into tx;
  insert into public.finance_payable_settlements(company_id,project_id,payable_id,bank_account_id,transaction_id,settlement_date,amount,source,external_reference,created_by)
  values(p_company_id,p.project_id,p.id,a.id,tx,p_date,round(p_amount,2),p_source,p_external_reference,p_actor) returning id into sid;
  already:=already+round(p_amount,2);
  update public.payables set
    paid_amount=already,status=case when already>=p.amount-0.005 then 'paid' else 'open' end,
    paid_at=case when already>=p.amount-0.005 then p_date else null end,
    paid_account_name=a.label,bank_account_id=a.id,bank_transaction_id=tx,updated_at=now()
  where id=p.id;
  return sid;
end $$;

-- Mantém assinaturas antigas, mas agora aceita baixas parciais.
create or replace function public.receive_finance_receivable(
  p_company_id uuid,p_project_id uuid,p_receivable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric
) returns uuid language plpgsql security invoker set search_path='' as $$
declare sid uuid; tx uuid; begin
  if not public.has_company_permission(p_company_id,'receivables.manage') then raise exception 'Sem permissão para registrar recebimentos.'; end if;
  if not exists(select 1 from public.receivables where id=p_receivable_id and company_id=p_company_id and project_id=p_project_id) then raise exception 'Parcela inválida.'; end if;
  sid:=finance_private.apply_receivable_settlement(p_company_id,p_receivable_id,p_account_id,p_paid_at,p_paid_amount,0,'manual',null,null,auth.uid());
  select receipt_transaction_id into tx from public.finance_receivable_settlements where id=sid;
  return tx;
end $$;

create or replace function public.pay_finance_payable(
  p_company_id uuid,p_project_id uuid,p_payable_id uuid,p_account_id uuid,p_paid_at date,p_paid_amount numeric
) returns uuid language plpgsql security invoker set search_path='' as $$
declare sid uuid; tx uuid; begin
  if not public.has_company_permission(p_company_id,'payables.manage') then raise exception 'Sem permissão para registrar pagamentos.'; end if;
  if not exists(select 1 from public.payables where id=p_payable_id and company_id=p_company_id and project_id=p_project_id) then raise exception 'Título inválido.'; end if;
  sid:=finance_private.apply_payable_settlement(p_company_id,p_payable_id,p_account_id,p_paid_at,p_paid_amount,'manual',null,auth.uid());
  select transaction_id into tx from public.finance_payable_settlements where id=sid;
  return tx;
end $$;

create or replace function public.bank_save_connection(
  p_account uuid,p_connection uuid,p_provider text,p_label text,p_environment text,p_credential_ref text,p_provider_account_ref text,p_status text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare a public.finance_bank_accounts; id uuid; begin
  select * into a from public.finance_bank_accounts where finance_bank_accounts.id=p_account;
  if a.id is null or not public.has_company_permission(a.company_id,'finance.bank_accounts.manage') then raise exception 'Conta indisponível.'; end if;
  if p_provider not in ('asaas','cnab','nexxera','other') or p_environment not in ('sandbox','production') or p_status not in ('active','inactive') then raise exception 'Configuração inválida.'; end if;
  if p_connection is null then
    insert into public.finance_bank_connections(company_id,bank_account_id,provider,label,environment,credential_ref,provider_account_ref,status,created_by,updated_by)
    values(a.company_id,a.id,p_provider,trim(p_label),p_environment,nullif(trim(coalesce(p_credential_ref,'')),''),nullif(trim(coalesce(p_provider_account_ref,'')),''),p_status,auth.uid(),auth.uid()) returning finance_bank_connections.id into id;
  else
    update public.finance_bank_connections set provider=p_provider,label=trim(p_label),environment=p_environment,credential_ref=nullif(trim(coalesce(p_credential_ref,'')),''),provider_account_ref=nullif(trim(coalesce(p_provider_account_ref,'')),''),status=p_status,updated_by=auth.uid(),updated_at=now()
    where finance_bank_connections.id=p_connection and company_id=a.company_id and bank_account_id=a.id returning finance_bank_connections.id into id;
    if id is null then raise exception 'Conexão não encontrada.'; end if;
  end if;
  return id;
end $$;

create or replace function public.bank_register_provider_charge(
  p_connection uuid,p_draft uuid,p_external_id text,p_external_reference text,p_billing_type text,
  p_invoice_url text,p_bank_slip_url text,p_pix_payload text,p_pix_expiration_at timestamptz,p_payload jsonb
) returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.finance_bank_connections; d public.finance_collection_drafts; id uuid; begin
  select * into c from public.finance_bank_connections where finance_bank_connections.id=p_connection and status='active';
  if c.id is null or not public.has_company_permission(c.company_id,'receivables.manage') then raise exception 'Conexão indisponível.'; end if;
  select * into d from public.finance_collection_drafts where finance_collection_drafts.id=p_draft and company_id=c.company_id and bank_account_id=c.bank_account_id and status='draft' for update;
  if d.id is null then raise exception 'Rascunho indisponível.'; end if;
  insert into public.finance_collection_charges(company_id,project_id,bank_account_id,connection_id,draft_id,receivable_id,billing_type,provider,external_id,external_reference,status,amount,due_date,invoice_url,bank_slip_url,pix_payload,pix_expiration_at,provider_payload,created_by)
  values(c.company_id,d.project_id,c.bank_account_id,c.id,d.id,d.receivable_id,p_billing_type,c.provider,p_external_id,p_external_reference,'pending',d.amount,d.due_date,p_invoice_url,p_bank_slip_url,p_pix_payload,p_pix_expiration_at,coalesce(p_payload,'{}'::jsonb),auth.uid())
  on conflict(connection_id,external_id) do update set invoice_url=excluded.invoice_url,bank_slip_url=excluded.bank_slip_url,pix_payload=excluded.pix_payload,pix_expiration_at=excluded.pix_expiration_at,provider_payload=excluded.provider_payload,updated_at=now()
  returning finance_collection_charges.id into id;
  update public.finance_collection_drafts set status='cancelled',updated_at=now() where finance_collection_drafts.id=d.id;
  return id;
end $$;

-- Webhook normalizado: somente o backend com service_role pode executar.
create or replace function public.bank_apply_provider_event(
  p_connection uuid,p_event_id text,p_event_type text,p_external_resource_id text,p_status text,
  p_gross numeric,p_net numeric,p_paid_date date,p_payload jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare c public.finance_bank_connections; ch public.finance_collection_charges; event_row uuid; fee numeric; sid uuid; begin
  select * into c from public.finance_bank_connections where id=p_connection and status='active';
  if c.id is null then raise exception 'Conexão inválida.'; end if;
  insert into public.finance_bank_webhook_events(company_id,connection_id,provider,external_event_id,event_type,external_resource_id,payload)
  values(c.company_id,c.id,c.provider,p_event_id,p_event_type,p_external_resource_id,coalesce(p_payload,'{}'::jsonb))
  on conflict(connection_id,external_event_id) do nothing returning id into event_row;
  if event_row is null then return 'duplicate'; end if;
  select * into ch from public.finance_collection_charges where connection_id=c.id and external_id=p_external_resource_id for update;
  if ch.id is null then
    update public.finance_bank_webhook_events set processed_at=now(),processing_error='Cobrança não localizada.' where id=event_row;
    return 'charge_not_found';
  end if;
  update public.finance_collection_charges set status=case
    when p_status in ('confirmed','received','overdue','cancelled','refunded','error') then p_status else status end,
    provider_payload=coalesce(p_payload,'{}'::jsonb),updated_at=now() where id=ch.id;
  if p_status='received' then
    fee:=greatest(round(coalesce(p_gross,ch.amount)-coalesce(p_net,p_gross,ch.amount),2),0);
    sid:=finance_private.apply_receivable_settlement(ch.company_id,ch.receivable_id,ch.bank_account_id,coalesce(p_paid_date,current_date),coalesce(p_gross,ch.amount),fee,
      case when c.provider='asaas' then 'asaas' else 'bank_webhook' end,ch.external_id,ch.id,null);
    update public.finance_collection_charges set paid_at=coalesce(p_paid_date,current_date),net_amount=coalesce(p_net,p_gross,ch.amount),fee_amount=fee,status='received',updated_at=now() where id=ch.id;
  end if;
  update public.finance_bank_webhook_events set processed_at=now() where id=event_row;
  return 'processed';
exception when others then
  if event_row is not null then update public.finance_bank_webhook_events set processed_at=now(),processing_error=sqlerrm where id=event_row; end if;
  raise;
end $$;

-- Visões de saldo residual para UI/IA.
create or replace view public.finance_receivable_balances with (security_invoker=true) as
select r.*, greatest(coalesce(r.adjusted_amount,r.amount)-coalesce(s.paid,0),0)::numeric(18,2) remaining_amount,
       coalesce(s.paid,0)::numeric(18,2) settled_amount
from public.receivables r
left join (select receivable_id,sum(gross_amount) paid from public.finance_receivable_settlements group by receivable_id) s on s.receivable_id=r.id;
grant select on public.finance_receivable_balances to authenticated;

create or replace view public.finance_payable_balances with (security_invoker=true) as
select p.*, greatest(p.amount-coalesce(s.paid,0),0)::numeric(18,2) remaining_amount,
       coalesce(s.paid,0)::numeric(18,2) settled_amount
from public.payables p
left join (select payable_id,sum(amount) paid from public.finance_payable_settlements group by payable_id) s on s.payable_id=p.id;
grant select on public.finance_payable_balances to authenticated;

revoke all on function public.bank_save_connection(uuid,uuid,text,text,text,text,text,text),
  public.bank_register_provider_charge(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb),
  public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric),
  public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) from public,anon;
grant execute on function public.bank_save_connection(uuid,uuid,text,text,text,text,text,text),
  public.bank_register_provider_charge(uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb),
  public.receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric),
  public.pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) to authenticated;

revoke all on function public.bank_apply_provider_event(uuid,text,text,text,text,numeric,numeric,date,jsonb) from public,anon,authenticated;
grant execute on function public.bank_apply_provider_event(uuid,text,text,text,text,numeric,numeric,date,jsonb) to service_role;

revoke all on function finance_private.apply_receivable_settlement(uuid,uuid,uuid,date,numeric,numeric,text,text,uuid,uuid),
  finance_private.apply_payable_settlement(uuid,uuid,uuid,date,numeric,text,text,uuid) from public,anon,authenticated;

commit;
