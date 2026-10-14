-- Bank evidence is separate from the internal ledger. No external bank payments.
begin;
create schema if not exists finance_private;
revoke all on schema finance_private from public, anon;
grant usage on schema finance_private to authenticated;

create table public.finance_bank_imports (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 file_name text not null, file_hash text not null, entry_count integer not null default 0,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(bank_account_id,file_hash)
);
create table public.finance_statement_entries (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 import_id uuid not null references public.finance_bank_imports(id), fit_id text not null,
 transaction_date date not null, amount numeric(18,2) not null check(amount<>0), description text not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(bank_account_id,fit_id)
);
create index on public.finance_statement_entries(company_id,bank_account_id,transaction_date,id);
create table public.finance_reconciliation_links (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), entry_id uuid not null references public.finance_statement_entries(id),
 transaction_id uuid not null references public.finance_bank_transactions(id), amount numeric(18,2) not null check(amount>0),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 reversed_at timestamptz, reversed_by uuid references auth.users(id), reversal_reason text
);
create index on public.finance_reconciliation_links(entry_id) where reversed_at is null;
create index on public.finance_reconciliation_links(transaction_id) where reversed_at is null;
create table public.finance_bank_groups (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), name text not null check(length(trim(name)) between 1 and 100),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(company_id,name)
);
alter table public.finance_bank_accounts add column bank_group_id uuid references public.finance_bank_groups(id);
alter table public.finance_bank_accounts add column closed_through date;
create table public.finance_bank_audit (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 event text not null, details jsonb not null default '{}', created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.finance_bank_audit(company_id,bank_account_id,created_at desc);
create table public.finance_bank_documents (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 transaction_id uuid references public.finance_bank_transactions(id), file_name text not null, storage_path text not null unique,
 kind text not null check(kind in ('statement','receipt')), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.finance_bank_instruments (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 kind text not null check(kind in ('card','cheque')), label text not null, last_four text,
 amount numeric(18,2) check(amount>0), due_date date, status text not null default 'active' check(status in ('active','cancelled','settled')),
 transaction_id uuid references public.finance_bank_transactions(id),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(last_four is null or last_four ~ '^\d{4}$')
);
create table public.finance_collection_drafts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 project_id uuid references public.projects(id), bank_account_id uuid not null references public.finance_bank_accounts(id),
 receivable_id uuid not null references public.receivables(id), amount numeric(18,2) not null check(amount>0), due_date date not null,
 fine_percent numeric(6,3) not null default 0 check(fine_percent between 0 and 100),
 monthly_interest_percent numeric(6,3) not null default 0 check(monthly_interest_percent between 0 and 100),
 instructions text, status text not null default 'draft' check(status in ('draft','cancelled')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index on public.finance_collection_drafts(receivable_id) where status='draft';

-- All new writes go through checked, atomic functions. Clients get read-only RLS.
do $$ declare t text; begin
 foreach t in array array['finance_bank_imports','finance_statement_entries','finance_reconciliation_links','finance_bank_groups','finance_bank_audit','finance_bank_documents','finance_bank_instruments','finance_collection_drafts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy bank_read on public.%I for select to authenticated using (public.has_company_permission(company_id,''finance.bank_accounts.view''))',t);
 end loop;
end $$;

create function finance_private.account(p_account uuid,p_permission text) returns public.finance_bank_accounts
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; begin
 if auth.uid() is null then raise exception 'Autenticação necessária.'; end if;
 select * into a from public.finance_bank_accounts where id=p_account for update;
 if a.id is null or not coalesce(public.has_company_permission(a.company_id,p_permission),false) then raise exception 'Conta indisponível ou sem permissão.'; end if;
 if a.status<>'active' then raise exception 'Conta inativa.'; end if;
 return a;
end $$;

-- Trigger protects the OLD and NEW dates, including old RPCs and API writes.
create function finance_private.protect_closed_ledger() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; begin
 if TG_OP<>'INSERT' then
 select * into a from public.finance_bank_accounts where id=old.bank_account_id for update;
 if old.transaction_date<=a.closed_through then raise exception 'Período bancário encerrado.'; end if;
 end if;
 if TG_OP<>'DELETE' then
 select * into a from public.finance_bank_accounts where id=new.bank_account_id for update;
 if new.company_id<>a.company_id then raise exception 'Empresa da conta inválida.'; end if;
 if new.transaction_date<=a.closed_through then raise exception 'Período bancário encerrado.'; end if;
 if TG_OP='UPDATE' and exists(select 1 from public.finance_reconciliation_links where transaction_id=old.id and reversed_at is null)
 and (new.amount<>old.amount or new.direction<>old.direction or new.bank_account_id<>old.bank_account_id or new.transaction_date<>old.transaction_date or new.status='cancelled') then
 raise exception 'Desfaça os vínculos de conciliação antes de alterar o lançamento.'; end if;
 if TG_OP='UPDATE' and new.status='reconciled' and exists(select 1 from public.finance_reconciliation_links where transaction_id=old.id and reversed_at is null) and new.amount<>(select sum(amount) from public.finance_reconciliation_links where transaction_id=old.id and reversed_at is null) then raise exception 'Conciliação parcial não pode ser marcada como completa.'; end if;
 return new; end if;
 if exists(select 1 from public.finance_reconciliation_links where transaction_id=old.id) then raise exception 'Lançamento possui histórico de conciliação.'; end if;
 return old;
end $$;
create trigger bank_closed_guard before insert or update or delete on public.finance_bank_transactions for each row execute function finance_private.protect_closed_ledger();

-- Prevent a normal table UPDATE from bypassing the checked settings RPC.
create function finance_private.protect_bank_settings() returns trigger language plpgsql set search_path='' as $$
begin
 if old.closed_through is not null and (new.opening_balance is distinct from old.opening_balance or new.opening_balance_date is distinct from old.opening_balance_date) then raise exception 'Reabra o período antes de alterar o saldo inicial.'; end if;
 if current_user in ('authenticated','anon') and (new.closed_through is distinct from old.closed_through or new.bank_group_id is distinct from old.bank_group_id) then
 raise exception 'Use o formulário de organização e fechamento.'; end if;
 return new;
end $$;
create trigger bank_settings_guard before update on public.finance_bank_accounts for each row execute function finance_private.protect_bank_settings();

create function finance_private.import_ofx(p_account uuid,p_name text,p_hash text,p_bank text,p_number text,p_entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; imp uuid; row jsonb; prev public.finance_statement_entries; added integer:=0; begin
 a:=finance_private.account(p_account,'finance.bank_accounts.manage');
 if coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' or length(coalesce(p_name,'')) not between 1 and 255 or coalesce(jsonb_typeof(p_entries),'')<>'array' or jsonb_array_length(p_entries) not between 1 and 10000 then raise exception 'Importação inválida.'; end if;
 if nullif(regexp_replace(coalesce(p_number,''),'[^0-9]','','g'),'') is null then raise exception 'Conta ausente no OFX.'; end if;
 if a.currency_code<>'BRL' then raise exception 'A conta deve estar em BRL.'; end if;
 if regexp_replace(p_number,'[^0-9]','','g') not in (regexp_replace(a.account_number,'[^0-9]','','g'),regexp_replace(a.account_number||coalesce(a.account_digit,''),'[^0-9]','','g')) then raise exception 'A conta do OFX difere da conta selecionada.'; end if;
 if nullif(a.bank_code,'') is not null and lpad(coalesce(p_bank,''),3,'0')<>lpad(a.bank_code,3,'0') then raise exception 'Banco do OFX difere da conta selecionada.'; end if;
 select id into imp from public.finance_bank_imports where bank_account_id=p_account and file_hash=p_hash;
 if imp is not null then return jsonb_build_object('inserted',0,'duplicate_file',true); end if;
 insert into public.finance_bank_imports(company_id,bank_account_id,file_name,file_hash,created_by) values(a.company_id,a.id,p_name,p_hash,auth.uid()) returning id into imp;
 for row in select value from jsonb_array_elements(p_entries) loop
 if nullif(row->>'fit_id','') is null or length(row->>'fit_id')>200 or coalesce(row->>'amount','') !~ '^-?[0-9]+(\.[0-9]{1,2})?$' or (row->>'amount')::numeric=0 or coalesce(row->>'transaction_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or length(coalesce(row->>'description','')) not between 1 and 1000 then raise exception 'Movimento inválido.'; end if;
 select * into prev from public.finance_statement_entries where bank_account_id=a.id and fit_id=row->>'fit_id';
 if prev.id is not null then
 if prev.amount<>(row->>'amount')::numeric or prev.transaction_date<>(row->>'transaction_date')::date or prev.description<>row->>'description' then raise exception 'FITID já importado com dados divergentes: %',row->>'fit_id'; end if;
 else
 if (row->>'transaction_date')::date<=a.closed_through then raise exception 'Reabra o período antes de importar novos movimentos.'; end if;
 insert into public.finance_statement_entries(company_id,bank_account_id,import_id,fit_id,transaction_date,amount,description,created_by)
 values(a.company_id,a.id,imp,row->>'fit_id',(row->>'transaction_date')::date,(row->>'amount')::numeric,row->>'description',auth.uid()); added:=added+1;
 end if;
 end loop;
 update public.finance_bank_imports set entry_count=added where id=imp;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) values(a.company_id,a.id,'ofx_import',jsonb_build_object('import_id',imp,'inserted',added),auth.uid());
 return jsonb_build_object('inserted',added,'duplicate_file',false);
end $$;

create function finance_private.link_entry(p_entry uuid,p_transaction uuid,p_amount numeric) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.finance_statement_entries; a public.finance_bank_accounts; t public.finance_bank_transactions; used_e numeric; used_t numeric; lid uuid; begin
 select * into e from public.finance_statement_entries where id=p_entry;
 a:=finance_private.account(e.bank_account_id,'finance.bank_accounts.reconcile');
 select * into e from public.finance_statement_entries where id=p_entry for update;
 select * into t from public.finance_bank_transactions where id=p_transaction for update;
 if t.id is null or t.bank_account_id<>a.id or t.company_id<>a.company_id or t.status='cancelled' then raise exception 'Lançamento incompatível com esta conta.'; end if;
 if e.transaction_date<=a.closed_through or t.transaction_date<=a.closed_through then raise exception 'Período encerrado.'; end if;
 if (e.amount>0)<>(t.direction='credit') then raise exception 'Entrada e saída incompatíveis.'; end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or round(p_amount,2)<>p_amount then raise exception 'Valor inválido.'; end if;
 select coalesce(sum(amount),0) into used_e from public.finance_reconciliation_links where entry_id=e.id and reversed_at is null;
 select coalesce(sum(amount),0) into used_t from public.finance_reconciliation_links where transaction_id=t.id and reversed_at is null;
 if p_amount>abs(e.amount)-used_e or p_amount>t.amount-used_t then raise exception 'Valor excede o saldo ainda não conciliado.'; end if;
 insert into public.finance_reconciliation_links(company_id,project_id,entry_id,transaction_id,amount,created_by) values(a.company_id,t.project_id,e.id,t.id,p_amount,auth.uid()) returning id into lid;
 update public.finance_bank_transactions set status=case when used_t+p_amount=amount then 'reconciled' else 'posted' end,
 reconciliation_date=case when used_t+p_amount=amount then e.transaction_date else null end,reconciliation_reference='Extrato OFX · '||e.fit_id,reconciled_by=auth.uid(),updated_at=now() where id=t.id;
 insert into public.finance_bank_audit(company_id,project_id,bank_account_id,event,details,created_by) values(a.company_id,t.project_id,a.id,'reconciliation_link',jsonb_build_object('link_id',lid,'amount',p_amount),auth.uid());
 return lid;
end $$;
create function finance_private.reverse_link(p_link uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare l public.finance_reconciliation_links; e public.finance_statement_entries; a public.finance_bank_accounts; t public.finance_bank_transactions; begin
 select * into l from public.finance_reconciliation_links where id=p_link;
 select * into e from public.finance_statement_entries where id=l.entry_id;
 a:=finance_private.account(e.bank_account_id,'finance.bank_accounts.reconcile');
 select * into l from public.finance_reconciliation_links where id=p_link for update;
 select * into t from public.finance_bank_transactions where id=l.transaction_id for update;
 if l.reversed_at is not null or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe um motivo válido para um vínculo ativo.'; end if;
 if e.transaction_date<=a.closed_through or t.transaction_date<=a.closed_through then raise exception 'Reabra o período antes de desfazer a conciliação.'; end if;
 update public.finance_reconciliation_links set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=p_reason,updated_at=now() where id=l.id;
 update public.finance_bank_transactions set status='posted',reconciliation_date=null,reconciliation_reference=null,reconciled_by=null,updated_at=now() where id=t.id;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) values(a.company_id,a.id,'reconciliation_reversed',jsonb_build_object('link_id',l.id,'reason',p_reason),auth.uid());
end $$;

create function finance_private.bank_settings(p_account uuid,p_group text,p_close date,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; gid uuid; begin
 a:=finance_private.account(p_account,'finance.bank_accounts.manage');
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo da alteração.'; end if;
 if p_close>current_date then raise exception 'Não é possível encerrar uma data futura.'; end if;
 if p_close is not null and (a.closed_through is null or p_close>a.closed_through) then
 if exists(select 1 from public.finance_statement_entries e where e.bank_account_id=a.id and e.transaction_date<=p_close and abs(e.amount)<>(select coalesce(sum(l.amount),0) from public.finance_reconciliation_links l where l.entry_id=e.id and l.reversed_at is null))
 or exists(select 1 from public.finance_bank_transactions t where t.bank_account_id=a.id and t.transaction_date<=p_close and t.status<>'cancelled' and t.amount<>(select coalesce(sum(l.amount),0) from public.finance_reconciliation_links l where l.transaction_id=t.id and l.reversed_at is null)) then raise exception 'Existem movimentos sem conciliação comprovada no período.'; end if;
 end if;
 if nullif(trim(p_group),'') is not null then
 insert into public.finance_bank_groups(company_id,name,created_by) values(a.company_id,trim(p_group),auth.uid()) on conflict(company_id,name) do update set updated_at=now() returning id into gid;
 end if;
 update public.finance_bank_accounts set bank_group_id=gid,closed_through=p_close,updated_by=auth.uid(),updated_at=now() where id=a.id;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) values(a.company_id,a.id,'settings',jsonb_build_object('old_closed',a.closed_through,'closed',p_close,'group',p_group,'reason',p_reason),auth.uid());
end $$;

-- Running balance is computed before pagination, for deterministic date/time/id order.
create view public.finance_bank_ledger with (security_invoker=true) as
select t.*, a.opening_balance+sum(case when t.status='cancelled' then 0 when t.direction='credit' then t.amount else -t.amount end)
over(partition by t.bank_account_id order by t.transaction_date,t.created_at,t.id rows unbounded preceding) as running_balance
from public.finance_bank_transactions t join public.finance_bank_accounts a on a.id=t.bank_account_id;
grant select on public.finance_bank_ledger to authenticated;

create function public.bank_import_ofx(p_account uuid,p_name text,p_hash text,p_bank text,p_number text,p_entries jsonb) returns jsonb language sql security invoker set search_path='' as $$ select finance_private.import_ofx(p_account,p_name,p_hash,p_bank,p_number,p_entries) $$;
create function public.bank_link_entry(p_entry uuid,p_transaction uuid,p_amount numeric) returns uuid language sql security invoker set search_path='' as $$ select finance_private.link_entry(p_entry,p_transaction,p_amount) $$;
create function public.bank_reverse_link(p_link uuid,p_reason text) returns void language sql security invoker set search_path='' as $$ select finance_private.reverse_link(p_link,p_reason) $$;
create function public.bank_save_settings(p_account uuid,p_group text,p_close date,p_reason text) returns void language sql security invoker set search_path='' as $$ select finance_private.bank_settings(p_account,p_group,p_close,p_reason) $$;

create function finance_private.save_document(p_account uuid,p_transaction uuid,p_name text,p_path text,p_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; id uuid; project uuid; begin
 a:=finance_private.account(p_account,'finance.bank_accounts.manage');
 if p_path not like a.company_id::text||'/'||a.id::text||'/%' or p_path like '%..%' or length(p_name)>255 then raise exception 'Arquivo inválido.'; end if;
 if p_transaction is not null then
 select project_id into project from public.finance_bank_transactions where finance_bank_transactions.id=p_transaction and bank_account_id=a.id;
 if not found then raise exception 'Lançamento inválido.'; end if;
 end if;
 if not exists(select 1 from storage.objects where bucket_id='bank-documents' and name=p_path) then raise exception 'Arquivo não enviado.'; end if;
 insert into public.finance_bank_documents(company_id,project_id,bank_account_id,transaction_id,file_name,storage_path,kind,created_by)
 values(a.company_id,project,a.id,p_transaction,p_name,p_path,p_kind,auth.uid()) returning finance_bank_documents.id into id;
 return id;
end $$;
create function finance_private.save_instrument(p_account uuid,p_kind text,p_label text,p_last_four text,p_amount numeric,p_due date) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; id uuid; begin
 a:=finance_private.account(p_account,'finance.bank_accounts.manage');
 if length(trim(coalesce(p_label,''))) not between 1 and 120 then raise exception 'Identificação inválida.'; end if;
 if p_amount is not null and (p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or round(p_amount,2)<>p_amount) then raise exception 'Valor inválido.'; end if;
 if p_kind='cheque' and (p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or round(p_amount,2)<>p_amount or p_due is null) then raise exception 'Informe valor e data do cheque.'; end if;
 insert into public.finance_bank_instruments(company_id,bank_account_id,kind,label,last_four,amount,due_date,created_by)
 values(a.company_id,a.id,p_kind,trim(p_label),nullif(p_last_four,''),p_amount,p_due,auth.uid()) returning finance_bank_instruments.id into id;
 return id;
end $$;
create function finance_private.change_instrument(p_id uuid,p_cancel boolean,p_date date,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; i public.finance_bank_instruments; t uuid; begin
 select * into i from public.finance_bank_instruments where id=p_id;
 a:=finance_private.account(i.bank_account_id,'finance.bank_accounts.manage');
 select * into i from public.finance_bank_instruments where id=p_id for update;
 if i.status<>'active' or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Instrumento indisponível ou motivo inválido.'; end if;
 if p_cancel is null then raise exception 'Ação inválida.'; end if;
 if not p_cancel then
 if i.kind<>'cheque' then raise exception 'Somente cheques podem ser compensados.'; end if;
 t:=public.post_finance_bank_transaction(a.company_id,null,a.id,p_date,p_date,'debit','payment','Compensação de cheque: '||i.label,i.label,null,i.amount,p_reason);
 end if;
 update public.finance_bank_instruments set status=case when p_cancel then 'cancelled' else 'settled' end,transaction_id=t,updated_at=now() where id=i.id;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) values(a.company_id,a.id,'instrument_status',jsonb_build_object('instrument_id',i.id,'cancelled',p_cancel,'reason',p_reason),auth.uid());
end $$;
create function finance_private.draft_collection(p_account uuid,p_receivable uuid,p_fine numeric,p_interest numeric,p_instructions text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; r public.receivables; id uuid; legal uuid; begin
 a:=finance_private.account(p_account,'receivables.manage');
 select * into r from public.receivables where receivables.id=p_receivable and company_id=a.company_id and status='open' for update;
 if r.id is null then raise exception 'Parcela indisponível.'; end if;
 select legal_entity_id into legal from public.projects where projects.id=r.project_id;
 if a.legal_entity_id is not null and a.legal_entity_id is distinct from legal then raise exception 'Conta pertence a outra SPE.'; end if;
 insert into public.finance_collection_drafts(company_id,project_id,bank_account_id,receivable_id,amount,due_date,fine_percent,monthly_interest_percent,instructions,created_by)
 values(a.company_id,r.project_id,a.id,r.id,coalesce(r.adjusted_amount,r.amount),r.due_date,p_fine,p_interest,p_instructions,auth.uid()) returning finance_collection_drafts.id into id;
 return id;
end $$;
create function public.bank_save_document(p_account uuid,p_transaction uuid,p_name text,p_path text,p_kind text) returns uuid language sql security invoker set search_path='' as $$ select finance_private.save_document(p_account,p_transaction,p_name,p_path,p_kind) $$;
create function public.bank_save_instrument(p_account uuid,p_kind text,p_label text,p_last_four text,p_amount numeric,p_due date) returns uuid language sql security invoker set search_path='' as $$ select finance_private.save_instrument(p_account,p_kind,p_label,p_last_four,p_amount,p_due) $$;
create function public.bank_change_instrument(p_id uuid,p_cancel boolean,p_date date,p_reason text) returns void language sql security invoker set search_path='' as $$ select finance_private.change_instrument(p_id,p_cancel,p_date,p_reason) $$;
create function public.bank_draft_collection(p_account uuid,p_receivable uuid,p_fine numeric,p_interest numeric,p_instructions text) returns uuid language sql security invoker set search_path='' as $$ select finance_private.draft_collection(p_account,p_receivable,p_fine,p_interest,p_instructions) $$;
revoke all on function public.bank_save_document(uuid,uuid,text,text,text), public.bank_save_instrument(uuid,text,text,text,numeric,date),public.bank_change_instrument(uuid,boolean,date,text),public.bank_draft_collection(uuid,uuid,numeric,numeric,text) from public,anon;
grant execute on function public.bank_save_document(uuid,uuid,text,text,text), public.bank_save_instrument(uuid,text,text,text,numeric,date),public.bank_change_instrument(uuid,boolean,date,text),public.bank_draft_collection(uuid,uuid,numeric,numeric,text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('bank-documents','bank-documents',false,4000000,array['application/pdf']) on conflict(id) do nothing;
create policy bank_document_read on storage.objects for select to authenticated using(bucket_id='bank-documents' and exists(select 1 from public.finance_bank_accounts a where a.company_id::text=(storage.foldername(name))[1] and a.id::text=(storage.foldername(name))[2] and public.has_company_permission(a.company_id,'finance.bank_accounts.view')));
create policy bank_document_upload on storage.objects for insert to authenticated with check(bucket_id='bank-documents' and exists(select 1 from public.finance_bank_accounts a where a.company_id::text=(storage.foldername(name))[1] and a.id::text=(storage.foldername(name))[2] and public.has_company_permission(a.company_id,'finance.bank_accounts.manage')));


create function finance_private.post_difference(p_entry uuid,p_type text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.finance_statement_entries; a public.finance_bank_accounts; remaining numeric; t uuid; begin
 select * into e from public.finance_statement_entries where id=p_entry;
 a:=finance_private.account(e.bank_account_id,'finance.bank_accounts.manage');
 if not coalesce(public.has_company_permission(a.company_id,'finance.bank_accounts.reconcile'),false) then raise exception 'Sem permissão para conciliar.'; end if;
 if coalesce(p_type,'') not in ('fee','interest','adjustment') or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe tipo e justificativa da diferença.'; end if;
 select abs(e.amount)-coalesce(sum(amount),0) into remaining from public.finance_reconciliation_links where entry_id=e.id and reversed_at is null;
 if remaining<=0 then raise exception 'Movimento já conciliado.'; end if;
 t:=public.post_finance_bank_transaction(a.company_id,null,a.id,e.transaction_date,e.transaction_date,case when e.amount>0 then 'credit' else 'debit' end,p_type,e.description,e.fit_id,null,remaining,p_reason);
 perform finance_private.link_entry(e.id,t,remaining);
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) values(a.company_id,a.id,'statement_difference',jsonb_build_object('entry_id',e.id,'transaction_id',t,'amount',remaining,'reason',p_reason),auth.uid());
 return t;
end $$;
create function public.bank_post_difference(p_entry uuid,p_type text,p_reason text) returns uuid language sql security invoker set search_path='' as $$ select finance_private.post_difference(p_entry,p_type,p_reason) $$;
revoke all on function public.bank_post_difference(uuid,text,text) from public,anon;
grant execute on function public.bank_post_difference(uuid,text,text) to authenticated;


-- Aggregate before pagination; expose only rows visible through the source RLS.
create view public.finance_statement_balances with (security_invoker=true) as
select e.*,abs(e.amount)-coalesce(l.linked_amount,0) remaining_amount
from public.finance_statement_entries e left join
(select entry_id,sum(amount) linked_amount from public.finance_reconciliation_links where reversed_at is null group by entry_id) l on l.entry_id=e.id;
grant select on public.finance_statement_balances to authenticated;
create view public.finance_bank_reconciliation_candidates with (security_invoker=true) as
select t.*, t.amount-coalesce(l.linked_amount,0) as remaining_amount
from public.finance_bank_transactions t left join
(select transaction_id,sum(amount) linked_amount from public.finance_reconciliation_links where reversed_at is null group by transaction_id) l on l.transaction_id=t.id
where t.status<>'cancelled';
grant select on public.finance_bank_reconciliation_candidates to authenticated;
create view public.finance_bank_group_balances with (security_invoker=true) as
select a.id,a.company_id,a.bank_group_id,a.opening_balance+coalesce(sum(case when t.status='cancelled' then 0 when t.direction='credit' then t.amount else -t.amount end),0) balance
from public.finance_bank_accounts a left join public.finance_bank_transactions t on t.bank_account_id=a.id
where a.status='active' group by a.id;
grant select on public.finance_bank_group_balances to authenticated;

create function finance_private.cancel_collection(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare d public.finance_collection_drafts; a public.finance_bank_accounts; begin
 select * into d from public.finance_collection_drafts where id=p_id;
 a:=finance_private.account(d.bank_account_id,'receivables.manage');
 select * into d from public.finance_collection_drafts where id=p_id for update;
 if d.status<>'draft' or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Rascunho indisponível ou motivo inválido.'; end if;
 update public.finance_collection_drafts set status='cancelled',updated_at=now() where id=d.id;
 insert into public.finance_bank_audit(company_id,project_id,bank_account_id,event,details,created_by) values(a.company_id,d.project_id,a.id,'collection_cancelled',jsonb_build_object('draft_id',d.id,'reason',p_reason),auth.uid());
end $$;
create function public.bank_cancel_collection(p_id uuid,p_reason text) returns void language sql security invoker set search_path='' as $$ select finance_private.cancel_collection(p_id,p_reason) $$;
revoke all on function public.bank_cancel_collection(uuid,text) from public,anon;
grant execute on function public.bank_cancel_collection(uuid,text) to authenticated;
-- Only unlinked uploads may be removed, e.g. after a failed metadata write.
create policy bank_document_cleanup on storage.objects for delete to authenticated using(bucket_id='bank-documents'
 and not exists(select 1 from public.finance_bank_documents d where d.storage_path=storage.objects.name)
 and exists(select 1 from public.finance_bank_accounts a where a.company_id::text=(storage.foldername(name))[1] and a.id::text=(storage.foldername(name))[2] and public.has_company_permission(a.company_id,'finance.bank_accounts.manage')));

revoke all on all functions in schema finance_private from public,anon;
grant execute on all functions in schema finance_private to authenticated;
revoke all on function finance_private.account(uuid,text),finance_private.protect_closed_ledger(),finance_private.protect_bank_settings() from authenticated;
revoke all on function public.bank_import_ofx(uuid,text,text,text,text,jsonb),public.bank_link_entry(uuid,uuid,numeric),public.bank_reverse_link(uuid,text),public.bank_save_settings(uuid,text,date,text) from public,anon;
grant execute on function public.bank_import_ofx(uuid,text,text,text,text,jsonb),public.bank_link_entry(uuid,uuid,numeric),public.bank_reverse_link(uuid,text),public.bank_save_settings(uuid,text,date,text) to authenticated;
commit;
