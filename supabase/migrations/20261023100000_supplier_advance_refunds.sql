-- CT10 only. Candidate for isolated development; no backfill or production execution.
begin;
create table public.finance_supplier_refund_rights (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id),legal_entity_id uuid not null,
 supplier_id uuid not null references public.suppliers(id),currency_code text not null default 'BRL' check(currency_code='BRL'),contract_id uuid not null unique references public.execution_service_contracts(id),
 payable_id uuid not null unique references public.payables(id),advance_line_id uuid not null unique references public.finance_settlement_lines(id),
 amount numeric(16,2) not null check(amount>0 and amount*100<=9007199254740991),effective_date date not null,expected_refund_date date,
 command_id uuid not null,request jsonb not null,contract_before jsonb not null,title_before jsonb not null,
 no_execution_evidence text not null check(length(btrim(no_execution_evidence))>=5),
 refund_evidence text not null check(length(btrim(refund_evidence))>=5),reason text not null check(length(btrim(reason))>=5),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id),unique(company_id,command_id)
);
create table public.finance_supplier_refund_receipts (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id),legal_entity_id uuid not null,
 right_id uuid not null references public.finance_supplier_refund_rights(id),bank_account_id uuid not null references public.finance_bank_accounts(id),
 bank_transaction_id uuid not null unique references public.finance_bank_transactions(id),amount numeric(16,2) not null check(amount>0 and amount*100<=9007199254740991),
 effective_date date not null,external_id text not null check(length(btrim(external_id))>=3),command_id uuid not null,request jsonb not null,
 evidence text not null check(length(btrim(evidence))>=5),reason text not null check(length(btrim(reason))>=5),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id),unique(company_id,command_id),unique(company_id,bank_account_id,external_id)
);
do $$declare t text;begin
 foreach t in array array['finance_supplier_refund_rights','finance_supplier_refund_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy refund_read on public.%I for select to authenticated using(public.has_company_permission(company_id,''payables.view'') and public.finance_entity_scope(company_id,legal_entity_id,false))',t);
  execute format('create trigger refund_history before update or delete on public.%I for each row execute function finance_private.immutable_audit()',t);
 end loop;
end $$;

-- One paid advance, whole scope, before execution. Other cancellation types retain their existing workflow.
create function public.cancel_supplier_advance_contract(p_company uuid,p_contract uuid,p_advance_line uuid,p_command uuid,p_date date,p_no_execution_evidence text,p_refund_evidence text,p_reason text,p_expected_refund_date date default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare c jsonb;t jsonb;l public.finance_settlement_lines;e public.finance_settlement_events;
 prior public.finance_supplier_refund_rights;req jsonb;v_id uuid;entity uuid;paid_confirmed numeric;a public.finance_bank_accounts;begin
 if auth.uid() is null or not coalesce(public.has_company_permission(p_company,'payables.manage'),false)
  or not coalesce(public.has_company_permission(p_company,'execution.contracts.cancel'),false) then raise exception 'Sem permissão para cancelamento financeiro.';end if;
 if p_command is null or p_date is null or p_date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date
  or length(btrim(coalesce(p_no_execution_evidence,'')))<5 or length(btrim(coalesce(p_refund_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5
  or p_expected_refund_date<p_date then raise exception 'Cancelamento exige data, comando e provas de não execução e restituição.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 select to_jsonb(x) into c from public.execution_service_contracts x where x.id=p_contract and x.company_id=p_company for update;
 select legal_entity_id into entity from public.projects where id=(c->>'project_id')::uuid and company_id=p_company;
 if c is null or not coalesce(public.finance_entity_scope(p_company,entity,true),false) then raise exception 'Contrato indisponível.';end if;
 req:=jsonb_build_object('contract',p_contract,'advance_line',p_advance_line,'date',p_date,'no_execution',p_no_execution_evidence,'refund',p_refund_evidence,'reason',p_reason,'expected_refund_date',p_expected_refund_date);
 select * into prior from public.finance_supplier_refund_rights where company_id=p_company and command_id=p_command;
 if prior.id is not null then if prior.request<>req then raise exception 'Comando reutilizado com conteúdo diferente.';end if;return prior.id;end if;
 if exists(select 1 from public.finance_supplier_refund_receipts where company_id=p_company and command_id=p_command)
  or exists(select 1 from public.finance_settlement_events where company_id=p_company and command_id=p_command)
  or exists(select 1 from public.finance_title_charges where company_id=p_company and command_id=p_command) then raise exception 'Comando já utilizado.';end if;
 if c->>'status' not in('active','suspended') or c->>'supplier_id' is null or coalesce((c->>'measured_value')::numeric,-1)<>0
  or coalesce((c->>'invoiced_value')::numeric,-1)<>0 then raise exception 'CT10 exige contrato sem execução ou faturamento; informação ausente não é zero.';end if;
 if exists(select 1 from public.execution_contract_measurements m where m.contract_id=p_contract and m.company_id=p_company and m.status not in('draft','rejected','cancelled','reversed'))
  or exists(select 1 from public.finance_manual_invoices i where i.contract_id=p_contract and i.company_id=p_company and i.status='approved') then raise exception 'Há execução/documento constituído; exige análise econômica própria.';end if;
 select * into l from public.finance_settlement_lines where id=p_advance_line and company_id=p_company for update;
 t:=finance_private.title(p_company,'AP',l.title_id);
 select * into e from public.finance_settlement_events where id=l.event_id and company_id=p_company;
 if l.id is null or l.title_type<>'AP' or l.credit_class is distinct from 'supplier_advance' or l.scope_ref is distinct from p_contract::text
  or l.project_id is distinct from (c->>'project_id')::uuid or t->>'supplier_id' is distinct from c->>'supplier_id'
  or t->>'status' is distinct from 'paid' or (t->>'finance_open_amount')::numeric<>0 or (t->>'finance_cash_pending')::numeric<>0
  or l.principal<=0 or l.principal<>(c->>'current_value')::numeric or l.principal<>(t->>'amount')::numeric
  or l.interest+l.fee+l.excess_credit+l.discount+l.noncash<>0
  or e.kind is distinct from 'payment' or e.legal_entity_id is distinct from entity or e.effective_date>p_date
  or (select count(*) from public.finance_settlement_lines where event_id=e.id)<>1
  or exists(select 1 from public.finance_settlement_events where reversal_of=e.id)
  or exists(select 1 from public.finance_settlement_lines x join public.finance_settlement_events z on z.id=x.event_id where x.advance_source=l.id and z.kind<>'reversal' and not exists(select 1 from public.finance_settlement_events r where r.reversal_of=z.id))
  or exists(select 1 from public.finance_settlement_lines x join public.finance_settlement_events z on z.id=x.event_id where x.scope_ref=p_contract::text and x.company_id=p_company and x.id<>l.id and z.kind<>'reversal' and not exists(select 1 from public.finance_settlement_events r where r.reversal_of=z.id))
 then raise exception 'Adiantamento/escopo incompatível ou já aplicado; CT10 não presume vínculos.';end if;
 a:=finance_private.account(e.bank_account_id,'finance.bank_accounts.view');
 if a.company_id<>p_company or a.legal_entity_id<>entity or a.currency_code<>'BRL' or p_date<=a.closed_through then raise exception 'Conta/período incompatível com cancelamento.';end if;
 select coalesce(sum(k.amount),0) into paid_confirmed from public.finance_reconciliation_links k
 join public.finance_statement_entries s on s.id=k.entry_id join public.finance_bank_transactions b on b.id=k.transaction_id
 where b.id=e.bank_transaction_id and b.company_id=p_company and b.bank_account_id=a.id and b.direction='debit' and b.amount=l.principal and b.status<>'cancelled'
 and s.bank_account_id=a.id and s.amount<0 and s.transaction_date<=p_date and k.reversed_at is null;
 if paid_confirmed<>l.principal then raise exception 'Adiantamento exige desembolso integral comprovado no extrato.';end if;
 insert into public.finance_supplier_refund_rights(company_id,project_id,legal_entity_id,supplier_id,contract_id,payable_id,advance_line_id,amount,effective_date,expected_refund_date,command_id,request,contract_before,title_before,no_execution_evidence,refund_evidence,reason,created_by)
 values(p_company,(c->>'project_id')::uuid,entity,(c->>'supplier_id')::uuid,p_contract,l.title_id,l.id,l.principal,p_date,p_expected_refund_date,p_command,req,jsonb_build_object('id',c->'id','company_id',c->'company_id','project_id',c->'project_id','supplier_id',c->'supplier_id','status',c->'status','current_value',c->'current_value','measured_value',c->'measured_value','invoiced_value',c->'invoiced_value'),t,p_no_execution_evidence,p_refund_evidence,p_reason,auth.uid()) returning id into v_id;
 perform public.change_execution_service_contract_status(p_company,(c->>'project_id')::uuid,p_contract,'cancel',p_reason);
 -- Original title and payment remain paid/immutable. No reversal and no bank movement on cancellation.
 return v_id;
end $$;

create function public.receive_supplier_refund(p_company uuid,p_right uuid,p_account uuid,p_command uuid,p_date date,p_amount numeric,p_external_id text,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.finance_supplier_refund_rights;prior public.finance_supplier_refund_receipts;a public.finance_bank_accounts;req jsonb;remaining numeric;tx uuid;v_id uuid;begin
 p_external_id:=btrim(p_external_id);
 if auth.uid() is null or not coalesce(public.has_company_permission(p_company,'payables.manage'),false) then raise exception 'Sem permissão financeira.';end if;
 if p_command is null or p_date is null or p_date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date
  or p_amount is null or p_amount='NaN'::numeric or p_amount<=0 or p_amount<>round(p_amount,2)
  or length(btrim(coalesce(p_external_id,'')))<3 or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Restituição exige valor exato, data, identidade e documento.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 select * into r from public.finance_supplier_refund_rights where id=p_right and company_id=p_company for update;
 if r.id is null or not coalesce(public.finance_entity_scope(p_company,r.legal_entity_id,true),false) then raise exception 'Direito indisponível.';end if;
 a:=finance_private.account(p_account,'finance.bank_accounts.view');
 if a.company_id<>p_company or a.legal_entity_id<>r.legal_entity_id or a.currency_code<>'BRL' or p_date<r.effective_date or p_date<a.opening_balance_date or p_date<=a.closed_through then raise exception 'Conta/titular/período incompatível com restituição.';end if;
 req:=jsonb_build_object('right',p_right,'account',p_account,'date',p_date,'amount',p_amount,'external_id',p_external_id,'evidence',p_evidence,'reason',p_reason);
 select * into prior from public.finance_supplier_refund_receipts where company_id=p_company and command_id=p_command;
 if prior.id is not null then if prior.request<>req then raise exception 'Comando ou evento de origem reutilizado com conteúdo diferente.';end if;return prior.id;end if;
 if exists(select 1 from public.finance_supplier_refund_rights where company_id=p_company and command_id=p_command)
  or exists(select 1 from public.finance_settlement_events where company_id=p_company and command_id=p_command)
  or exists(select 1 from public.finance_title_charges where company_id=p_company and command_id=p_command) then raise exception 'Comando já utilizado.';end if;
 select * into prior from public.finance_supplier_refund_receipts where company_id=p_company and bank_account_id=p_account and external_id=p_external_id;
 if prior.id is not null then if prior.request<>req then raise exception 'Evento de origem reutilizado com conteúdo diferente.';end if;return prior.id;end if;
 select r.amount-coalesce(sum(amount),0) into remaining from public.finance_supplier_refund_receipts where right_id=r.id;
 if p_amount>remaining then raise exception 'Restituição superior ao direito em aberto.';end if;
 insert into public.finance_bank_transactions(company_id,project_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,status,source_system,source_id,created_by)
 values(p_company,r.project_id,r.legal_entity_id,a.id,p_date,'credit','refund',p_reason,p_amount,'posted','elos_settlement','supplier-refund:'||p_command::text,auth.uid()) returning id into tx;
 insert into public.finance_supplier_refund_receipts(company_id,project_id,legal_entity_id,right_id,bank_account_id,bank_transaction_id,amount,effective_date,external_id,command_id,request,evidence,reason,created_by)
 values(p_company,r.project_id,r.legal_entity_id,r.id,a.id,tx,p_amount,p_date,p_external_id,p_command,req,p_evidence,p_reason,auth.uid()) returning id into v_id;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by)
 values(p_company,a.id,'supplier_refund_received',jsonb_build_object('right_id',r.id,'receipt_id',v_id,'bank_transaction_id',tx,'amount',p_amount,'evidence',p_evidence,'reason',p_reason),auth.uid());
 return v_id;
end $$;

-- Converted credits cannot be applied or reversed as though the original price were still due.
create function finance_private.guard_converted_supplier_advance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name in('finance_settlement_events','finance_title_charges') then
  if exists(select 1 from public.finance_supplier_refund_rights where company_id=new.company_id and command_id=new.command_id) or exists(select 1 from public.finance_supplier_refund_receipts where company_id=new.company_id and command_id=new.command_id) then raise exception 'Comando já utilizado em restituição.';end if;
  if tg_table_name='finance_settlement_events' then
  if new.reversal_of is not null and exists(select 1 from public.finance_supplier_refund_rights r join public.finance_settlement_lines l on l.id=r.advance_line_id where l.event_id=new.reversal_of)
   then raise exception 'Adiantamento convertido em restituição: não reabrir título por estorno.';end if;
  end if;
 else
  if new.advance_source is not null and exists(select 1 from public.finance_supplier_refund_rights where advance_line_id=new.advance_source) then raise exception 'Crédito convertido em restituição; aplicação bloqueada.';end if;
  if new.credit_class='supplier_advance' then
   perform 1 from public.execution_service_contracts c where c.id::text=new.scope_ref and c.company_id=new.company_id for update;
   if exists(select 1 from public.execution_service_contracts c where c.id::text=new.scope_ref and c.company_id=new.company_id and c.status='cancelled') then raise exception 'Contrato cancelado não recebe novo adiantamento.';end if;
  end if;
 end if;
 return new;
end $$;
create trigger refund_no_settlement_reversal before insert on public.finance_settlement_events for each row execute function finance_private.guard_converted_supplier_advance();
create trigger refund_no_charge_command_reuse before insert on public.finance_title_charges for each row execute function finance_private.guard_converted_supplier_advance();
create trigger refund_no_advance_reuse before insert on public.finance_settlement_lines for each row execute function finance_private.guard_converted_supplier_advance();
create function finance_private.guard_supplier_refund_contract() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.finance_supplier_refund_rights where contract_id=old.id) then
  if new.status is distinct from 'cancelled' or new.project_id is distinct from old.project_id or new.company_id is distinct from old.company_id
   or (to_jsonb(new)->>'supplier_id') is distinct from (to_jsonb(old)->>'supplier_id') or new.current_value is distinct from old.current_value
   or (to_jsonb(new)->>'measured_value') is distinct from (to_jsonb(old)->>'measured_value') or (to_jsonb(new)->>'invoiced_value') is distinct from (to_jsonb(old)->>'invoiced_value') then raise exception 'Cancelamento com restituição preserva identidade, preço original e não execução.';end if;
 elsif new.status='cancelled' and old.status<>'cancelled' and exists(select 1 from public.finance_settlement_lines l join public.finance_settlement_events e on e.id=l.event_id where l.company_id=old.company_id and l.scope_ref=old.id::text and l.credit_class='supplier_advance' and e.kind='payment' and not exists(select 1 from public.finance_settlement_events z where z.reversal_of=e.id)) then
  raise exception 'Adiantamento pago exige cancelamento financeiro documentado com direito de restituição.';
 end if;
 return new;
end $$;
create trigger refund_contract_guard before update on public.execution_service_contracts for each row execute function finance_private.guard_supplier_refund_contract();
create function finance_private.guard_refund_execution() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.finance_supplier_refund_rights where contract_id=new.contract_id) then raise exception 'Escopo cancelado sem execução e com restituição; novo fato exige análise própria.';end if;return new;
end $$;
create trigger refund_measurement_guard before insert or update on public.execution_contract_measurements for each row when(new.status in('approved','invoiced','paid')) execute function finance_private.guard_refund_execution();
create trigger refund_invoice_guard before insert or update on public.finance_manual_invoices for each row when(new.status='approved') execute function finance_private.guard_refund_execution();

-- New versions freeze the same refund facts; existing immutable versions remain untouched.
create function finance_private.snapshot_supplier_refunds() returns trigger language plpgsql security definer set search_path='' as $$begin
 new.source_snapshot:=new.source_snapshot||jsonb_build_object(
  'supplier_refund_rights',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.finance_supplier_refund_rights r where r.company_id=new.company_id and r.legal_entity_id=new.legal_entity_id and (new.project_id is null or r.project_id=new.project_id)),
  'supplier_refund_receipts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.finance_supplier_refund_receipts r where r.company_id=new.company_id and r.legal_entity_id=new.legal_entity_id and (new.project_id is null or r.project_id=new.project_id)));
 return new;
end $$;
create trigger supplier_refund_snapshot before insert on public.finance_cash_scenarios for each row execute function finance_private.snapshot_supplier_refunds();
revoke all on function public.cancel_supplier_advance_contract(uuid,uuid,uuid,uuid,date,text,text,text,date),public.receive_supplier_refund(uuid,uuid,uuid,uuid,date,numeric,text,text,text) from public,anon;
grant execute on function public.cancel_supplier_advance_contract(uuid,uuid,uuid,uuid,date,text,text,text,date),public.receive_supplier_refund(uuid,uuid,uuid,uuid,date,numeric,text,text,text) to authenticated;
revoke all on function finance_private.guard_converted_supplier_advance(),finance_private.guard_supplier_refund_contract(),finance_private.guard_refund_execution(),finance_private.snapshot_supplier_refunds() from public,anon,authenticated;
commit;
