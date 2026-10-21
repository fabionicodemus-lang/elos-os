-- T04–T08: extensão candidata, exercitada somente no PostgreSQL descartável.
-- Não ativa controles em empresas existentes e não faz backfill.
begin;
create schema if not exists finance_private;
revoke all on schema finance_private from public, anon;

create table public.finance_company_controls (
  company_id uuid primary key references public.companies(id),
  entity_scope_enabled boolean not null default false
);
create table public.finance_entity_permissions (
  company_id uuid not null references public.companies(id),
  legal_entity_id uuid not null,
  user_id uuid not null references auth.users(id),
  can_read boolean not null default false,
  can_write boolean not null default false check(not can_write or can_read),
  primary key(company_id,legal_entity_id,user_id),
  foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id)
);
alter table public.finance_company_controls enable row level security;
alter table public.finance_entity_permissions enable row level security;
revoke all on public.finance_company_controls,public.finance_entity_permissions from public,anon,authenticated;

-- Complementa a permissão existente, não a substitui. Sem opt-in, mantém a ACL atual.
create function public.finance_entity_scope(p_company uuid,p_entity uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.is_company_member(p_company) and (
   not exists(select 1 from public.finance_company_controls where company_id=p_company and entity_scope_enabled)
   or exists(select 1 from public.finance_entity_permissions where company_id=p_company
     and legal_entity_id=p_entity and user_id=auth.uid() and can_read and (not p_write or can_write)))
$$;
revoke all on function public.finance_entity_scope(uuid,uuid,boolean) from public,anon;
grant execute on function public.finance_entity_scope(uuid,uuid,boolean) to authenticated;

-- Relações sempre da mesma organização, inclusive em RPCs SECURITY DEFINER.
create function finance_private.check_title_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare entity uuid; prior_entity uuid; begin
 select legal_entity_id into entity from public.projects where id=new.project_id and company_id=new.company_id;
 if not found then raise exception 'Obra fora da organização.'; end if;
 if tg_table_name='payables' then
   if new.supplier_id is not null and not exists(select 1 from public.suppliers where id=new.supplier_id and company_id=new.company_id)
   then raise exception 'Fornecedor fora da organização.'; end if;
 else
   if not exists(select 1 from public.sales where id=new.sale_id and company_id=new.company_id and project_id=new.project_id and client_id=new.client_id and unit_id=new.unit_id)
   then raise exception 'Venda, cliente ou unidade incompatíveis.'; end if;
 end if;
 if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or new.source_system is distinct from old.source_system or new.source_id is distinct from old.source_id)
 then raise exception 'Identidade de origem imutável; requer reconciliação explícita.'; end if;
 if tg_op='UPDATE' and new.created_by is distinct from old.created_by then raise exception 'Autoria de origem imutável.'; end if;
 if tg_op='INSERT' and auth.uid() is not null then new.created_by:=auth.uid(); end if;
 if exists(select 1 from public.finance_company_controls where company_id=new.company_id and entity_scope_enabled) then
   if not public.finance_entity_scope(new.company_id,entity,true) then raise exception 'Entidade sem autorização de escrita.'; end if;
   if tg_op='UPDATE' then
     select legal_entity_id into prior_entity from public.projects where id=old.project_id;
     if not public.finance_entity_scope(old.company_id,prior_entity,true) then raise exception 'Origem sem autorização de escrita.'; end if;
   end if;
 end if;
 return new;
end $$;
create trigger finance_payable_scope before insert or update on public.payables for each row execute function finance_private.check_title_scope();
create trigger finance_receivable_scope before insert or update on public.receivables for each row execute function finance_private.check_title_scope();
alter table public.payables add constraint payable_finite check(amount<>'NaN'::numeric and (paid_amount is null or paid_amount<>'NaN'::numeric));
alter table public.receivables add constraint receivable_finite check(amount<>'NaN'::numeric and (paid_amount is null or paid_amount<>'NaN'::numeric));

create policy finance_payable_entity on public.payables as restrictive for all to authenticated
 using(public.finance_entity_scope(company_id,(select legal_entity_id from public.projects where id=project_id),false))
 with check(public.finance_entity_scope(company_id,(select legal_entity_id from public.projects where id=project_id),true));
create policy finance_receivable_entity on public.receivables as restrictive for all to authenticated
 using(public.finance_entity_scope(company_id,(select legal_entity_id from public.projects where id=project_id),false))
 with check(public.finance_entity_scope(company_id,(select legal_entity_id from public.projects where id=project_id),true));
create policy finance_account_entity on public.finance_bank_accounts as restrictive for all to authenticated
 using(public.finance_entity_scope(company_id,legal_entity_id,false)) with check(public.finance_entity_scope(company_id,legal_entity_id,true));
create policy finance_transaction_entity on public.finance_bank_transactions as restrictive for all to authenticated
 using(public.finance_entity_scope(company_id,legal_entity_id,false)) with check(public.finance_entity_scope(company_id,legal_entity_id,true));
alter function public.payables_summary(uuid,uuid) security invoker;
alter function public.finance_bank_accounts_summary(uuid,uuid) security invoker;

create or replace function finance_private.account(p_account uuid,p_permission text) returns public.finance_bank_accounts
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; begin
 if auth.uid() is null then raise exception 'Autenticação necessária.'; end if;
 select * into a from public.finance_bank_accounts where id=p_account for update;
 if a.id is null or not coalesce(public.has_company_permission(a.company_id,p_permission),false)
   or not public.finance_entity_scope(a.company_id,a.legal_entity_id,p_permission<>'finance.bank_accounts.view')
 then raise exception 'Conta indisponível ou sem permissão.'; end if;
 if a.status<>'active' then raise exception 'Conta inativa.'; end if;
 return a;
end $$;
create function finance_private.check_account_scope() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'Organização da conta imutável.'; end if;
 if new.legal_entity_id is not null and not exists(select 1 from public.legal_entities where id=new.legal_entity_id and company_id=new.company_id)
 then raise exception 'Titular de outra organização.'; end if;
 if exists(select 1 from public.finance_company_controls where company_id=new.company_id and entity_scope_enabled) then
   if not public.finance_entity_scope(new.company_id,new.legal_entity_id,true) then raise exception 'Titular sem autorização.'; end if;
   if tg_op='UPDATE' and not public.finance_entity_scope(old.company_id,old.legal_entity_id,true) then raise exception 'Titular original sem autorização.'; end if;
 end if;
 return new;
end $$;
create trigger finance_account_scope before insert or update on public.finance_bank_accounts for each row execute function finance_private.check_account_scope();
do $$declare t text;begin
 foreach t in array array['finance_bank_imports','finance_statement_entries','finance_bank_audit','finance_bank_documents','finance_bank_instruments','finance_collection_drafts'] loop
   execute format('create policy finance_account_read on public.%I as restrictive for select to authenticated using(exists(select 1 from public.finance_bank_accounts a where a.id=bank_account_id and public.finance_entity_scope(a.company_id,a.legal_entity_id,false)))',t);
 end loop;
end $$;
create policy finance_link_read on public.finance_reconciliation_links as restrictive for select to authenticated
 using(exists(select 1 from public.finance_statement_entries e where e.id=entry_id));
create policy finance_transfer_entity on public.finance_bank_transfers as restrictive for all to authenticated
 using(exists(select 1 from public.finance_bank_accounts a where a.id=from_account_id) and exists(select 1 from public.finance_bank_accounts a where a.id=to_account_id))
 with check(exists(select 1 from public.finance_bank_accounts a where a.id=from_account_id and public.finance_entity_scope(a.company_id,a.legal_entity_id,true)) and exists(select 1 from public.finance_bank_accounts a where a.id=to_account_id and public.finance_entity_scope(a.company_id,a.legal_entity_id,true)));
create policy finance_document_upload_scope on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'bank-documents' or exists(select 1 from public.finance_bank_accounts a where a.company_id::text=(storage.foldername(name))[1] and a.id::text=(storage.foldername(name))[2] and public.finance_entity_scope(a.company_id,a.legal_entity_id,true)));

create function finance_private.check_bank_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; begin
 select * into a from public.finance_bank_accounts where id=new.bank_account_id;
 if a.id is null or new.company_id is distinct from a.company_id or new.legal_entity_id is distinct from a.legal_entity_id
 then raise exception 'Titular ou organização bancária incompatível.'; end if;
 if new.project_id is not null and not exists(select 1 from public.projects where id=new.project_id and company_id=new.company_id and (a.legal_entity_id is null or legal_entity_id=a.legal_entity_id))
 then raise exception 'Obra incompatível com a conta.'; end if;
 if new.payable_id is not null and not exists(select 1 from public.payables where id=new.payable_id and company_id=new.company_id and project_id=new.project_id)
 then raise exception 'Título incompatível com movimento.'; end if;
 if new.receivable_id is not null and not exists(select 1 from public.receivables where id=new.receivable_id and company_id=new.company_id and project_id=new.project_id)
 then raise exception 'Recebível incompatível com movimento.'; end if;
 if exists(select 1 from public.finance_company_controls where company_id=new.company_id and entity_scope_enabled)
   and not public.finance_entity_scope(new.company_id,a.legal_entity_id,true) then raise exception 'Conta sem autorização de escrita.'; end if;
 return new;
end $$;
create trigger finance_bank_scope before insert or update on public.finance_bank_transactions for each row execute function finance_private.check_bank_scope();

create or replace function public.finance_bank_account_balance(p_account_id uuid,p_until_date date default null)
returns numeric language plpgsql stable security definer set search_path='' as $$
declare a public.finance_bank_accounts; value numeric; begin
 select * into a from public.finance_bank_accounts where id=p_account_id;
 if a.id is null then return null; end if;
 if not (public.has_company_permission(a.company_id,'finance.bank_accounts.view') or public.has_company_permission(a.company_id,'finance.bank_accounts.manage') or public.has_company_permission(a.company_id,'finance.bank_accounts.reconcile'))
   or not public.finance_entity_scope(a.company_id,a.legal_entity_id,false) then raise exception 'Conta indisponível ou sem permissão.'; end if;
 if p_until_date is not null and p_until_date<a.opening_balance_date then return 0; end if;
 select coalesce(sum(case when direction='credit' then amount else -amount end),0) into value from public.finance_bank_transactions
 where bank_account_id=a.id and status in('posted','reconciled') and (p_until_date is null or transaction_date<=p_until_date);
 return round(a.opening_balance+value,2);
end $$;

alter table public.payables add column finance_version bigint not null default 0;
alter table public.receivables add column finance_version bigint not null default 0;
create table public.finance_title_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id),
  legal_entity_id uuid references public.legal_entities(id),
  title_id uuid not null, title_type text not null check(title_type in('payables','receivables')),
  version bigint not null, previous_value jsonb, new_value jsonb not null,
  actor_id uuid references auth.users(id), reason text,
  effective_date date, recorded_at timestamptz not null default clock_timestamp(),
  unique(title_type,title_id,version)
);
alter table public.finance_title_audit enable row level security;
revoke all on public.finance_title_audit from public,anon,authenticated;
grant select on public.finance_title_audit to authenticated;
create policy finance_audit_read on public.finance_title_audit for select to authenticated using(
 public.finance_entity_scope(company_id,legal_entity_id,false) and
 public.has_company_permission(company_id,case title_type when 'payables' then 'payables.view' else 'receivables.view' end));
create function finance_private.immutable_audit() returns trigger language plpgsql set search_path='' as $$
 begin raise exception 'Histórico imutável.'; end $$;
create trigger finance_audit_immutable before update or delete on public.finance_title_audit for each row execute function finance_private.immutable_audit();
create function finance_private.version_title() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_value jsonb; begin
 if tg_op='UPDATE' then
   before_value:=to_jsonb(old);
   if (to_jsonb(new)-'updated_at'-'finance_version')=(before_value-'updated_at'-'finance_version') then new.finance_version:=old.finance_version; return new; end if;
   new.finance_version:=old.finance_version+1;
 else new.finance_version:=1; end if;
 return new;
end $$;
create function finance_private.audit_title() returns trigger
language plpgsql security definer set search_path='' as $$
declare entity uuid; reason text; before_value jsonb; effective date; begin
 if tg_op='UPDATE' then
   if new.finance_version=old.finance_version then return new; end if;
   before_value:=to_jsonb(old);
 end if;
 reason:=nullif(btrim(current_setting('finance.reason',true)),'');
 if tg_op='INSERT' then reason:=coalesce(reason,'Criação do título');
 elsif new.bank_transaction_id is not null and new.bank_transaction_id is distinct from old.bank_transaction_id then
   reason:=coalesce(reason,'Baixa vinculada ao movimento '||new.bank_transaction_id);
 end if;
 if exists(select 1 from public.finance_company_controls where company_id=new.company_id and entity_scope_enabled)
   and (reason is null or auth.uid() is null) then raise exception 'Alteração exige autoria e motivo.'; end if;
 effective:=nullif(current_setting('finance.effective_date',true),'')::date;
 select legal_entity_id into entity from public.projects where id=new.project_id;
 insert into public.finance_title_audit(company_id,legal_entity_id,title_id,title_type,version,previous_value,new_value,actor_id,reason,effective_date)
 values(new.company_id,entity,new.id,tg_table_name,new.finance_version,before_value,to_jsonb(new),auth.uid(),reason,effective);
 return new;
end $$;
create trigger finance_title_version before insert or update on public.payables for each row execute function finance_private.version_title();
create trigger finance_title_version before insert or update on public.receivables for each row execute function finance_private.version_title();
create trigger finance_title_audit after insert or update on public.payables for each row execute function finance_private.audit_title();
create trigger finance_title_audit after insert or update on public.receivables for each row execute function finance_private.audit_title();

create table public.finance_title_commands (
 company_id uuid not null references public.companies(id), command_id uuid not null, request jsonb not null,
 result_id uuid not null, actor_id uuid not null references auth.users(id), primary key(company_id,command_id)
);
alter table public.finance_title_commands enable row level security;
revoke all on public.finance_title_commands from public,anon,authenticated;
create function public.revise_finance_payable(p_company uuid,p_title uuid,p_command uuid,p_expected_version bigint,p_amount numeric,p_due date,p_effective date,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.payables; prior public.finance_title_commands; entity uuid; request_value jsonb; begin
 if auth.uid() is null or not public.has_company_permission(p_company,'payables.manage') then raise exception 'Sem permissão.'; end if;
 if p_command is null or p_effective is null or p_expected_version is null or nullif(btrim(p_reason),'') is null
   or p_amount is null or p_amount<0 or p_amount='NaN'::numeric or round(p_amount,2)<>p_amount or p_due is null
 then raise exception 'Revisão exige valor exato, datas, versão, comando e motivo.'; end if;
 select * into t from public.payables where id=p_title and company_id=p_company for update;
 select legal_entity_id into entity from public.projects where id=t.project_id;
 if t.id is null or not public.finance_entity_scope(p_company,entity,true) then raise exception 'Título indisponível.'; end if;
 request_value:=jsonb_build_object('title',p_title,'amount',p_amount,'due',p_due,'effective',p_effective,'reason',p_reason,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||p_command::text,0));
 select * into prior from public.finance_title_commands where company_id=p_company and command_id=p_command;
 if found then
   if prior.request<>request_value then raise exception 'Comando reutilizado com conteúdo diferente.'; end if;
   return prior.result_id;
 end if;
 if t.status<>'open' or t.finance_version<>p_expected_version then raise exception 'Versão obsoleta ou título indisponível.'; end if;
 perform set_config('finance.reason',p_reason,true);perform set_config('finance.effective_date',p_effective::text,true);
 update public.payables set amount=p_amount,due_date=p_due,updated_at=clock_timestamp() where id=p_title;
 insert into public.finance_title_commands values(p_company,p_command,request_value,p_title,auth.uid());
 return p_title;
end $$;
revoke all on function public.revise_finance_payable(uuid,uuid,uuid,bigint,numeric,date,date,text) from public,anon;
grant execute on function public.revise_finance_payable(uuid,uuid,uuid,bigint,numeric,date,date,text) to authenticated;

create function public.finance_payable_at(p_title uuid,p_t date,p_k timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
 select new_value from public.finance_title_audit where title_type='payables' and title_id=p_title
 and effective_date<=p_t and recorded_at<=p_k order by version desc limit 1
$$;
revoke all on function public.finance_payable_at(uuid,date,timestamptz) from public,anon;
grant execute on function public.finance_payable_at(uuid,date,timestamptz) to authenticated;
commit;
