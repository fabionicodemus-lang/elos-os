-- Explicit same-owner transfer or documented interentity loan; no implicit credit in transit.
begin;
alter table public.finance_bank_transfers add column command_id uuid,add column request jsonb,add column nature text check(nature in('own','loan')),add column evidence text;
create unique index cash_transfer_command on public.finance_bank_transfers(company_id,command_id) where command_id is not null;
create function public.record_cash_transfer(p_company uuid,p_from uuid,p_to uuid,p_command uuid,p_debit date,p_credit date,p_amount numeric,p_fee numeric,p_nature text,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts;b public.finance_bank_accounts;old public.finance_bank_transfers;v_id uuid;debit uuid;credit uuid;req jsonb;begin
 if not coalesce(public.has_company_permission(p_company,'finance.bank_accounts.transfer'),false) then raise exception 'Sem permissão.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 -- deterministic account locks, shared ledger checks reused
 perform 1 from public.finance_bank_accounts where finance_bank_accounts.id in(p_from,p_to) order by finance_bank_accounts.id for update;
 a:=finance_private.account(p_from,'finance.bank_accounts.transfer');b:=finance_private.account(p_to,'finance.bank_accounts.transfer');
 if a.company_id<>p_company or b.company_id<>p_company or a.id=b.id or a.currency_code<>b.currency_code or a.legal_entity_id is null or b.legal_entity_id is null then raise exception 'Contas/moeda/titular incompatíveis.';end if;
 if p_nature is null or p_nature not in('own','loan') or p_nature='own' and a.legal_entity_id<>b.legal_entity_id or p_nature='loan' and a.legal_entity_id=b.legal_entity_id then raise exception 'Natureza não corresponde aos titulares.';end if;
 if p_command is null or p_debit is null or p_debit>(now() at time zone 'America/Sao_Paulo')::date or p_credit<p_debit or p_credit>(now() at time zone 'America/Sao_Paulo')::date or p_amount is null or p_fee is null or p_amount<=0 or p_fee<0 or p_amount='NaN'::numeric or p_fee='NaN'::numeric or round(p_amount,2)<>p_amount or round(p_fee,2)<>p_fee or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Transferência exige valores exatos, datas efetivas e documento.';end if;
 req:=jsonb_build_object('from',p_from,'to',p_to,'debit',p_debit,'credit',p_credit,'amount',p_amount,'fee',p_fee,'nature',p_nature,'evidence',p_evidence,'reason',p_reason);
 select * into old from public.finance_bank_transfers where company_id=p_company and command_id=p_command;
 if old.id is not null then if old.request<>req then raise exception 'Comando reutilizado.';end if;return old.id;end if;
 if p_debit<a.opening_balance_date or p_credit<b.opening_balance_date then raise exception 'Movimento anterior à abertura da conta.';end if;
 if p_debit<=a.closed_through or p_credit<=b.closed_through then raise exception 'Período encerrado.';end if;
 if not a.allow_negative and a.opening_balance+coalesce((select sum(case direction when 'credit' then amount else -amount end) from public.finance_bank_transactions where bank_account_id=a.id and status<>'cancelled' and transaction_date>=a.opening_balance_date and transaction_date<=p_debit),0)<p_amount+p_fee then raise exception 'Saldo insuficiente.';end if;
 insert into public.finance_bank_transfers(company_id,from_account_id,to_account_id,transfer_date,amount,description,command_id,request,nature,evidence,created_by)
 values(p_company,p_from,p_to,p_debit,p_amount,p_reason,p_command,req,p_nature,p_evidence,auth.uid()) returning finance_bank_transfers.id into v_id;
 insert into public.finance_bank_transactions(company_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,transfer_id,source_system,source_id,created_by)
 values(p_company,a.legal_entity_id,p_from,p_debit,'debit','transfer',p_reason,p_amount,v_id,'elos_cashflow',v_id::text||':debit',auth.uid()) returning finance_bank_transactions.id into debit;
 if p_fee>0 then insert into public.finance_bank_transactions(company_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,transfer_id,source_system,source_id,created_by)
 values(p_company,a.legal_entity_id,p_from,p_debit,'debit','fee',p_reason,p_fee,null,'elos_cashflow',v_id::text||':fee',auth.uid());end if;
 if p_credit is not null then
  insert into public.finance_bank_transactions(company_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,transfer_id,source_system,source_id,created_by)
  values(p_company,b.legal_entity_id,p_to,p_credit,'credit','transfer',p_reason,p_amount,v_id,'elos_cashflow',v_id::text||':credit',auth.uid()) returning finance_bank_transactions.id into credit;
 end if;
 update public.finance_bank_transfers set debit_transaction_id=debit,credit_transaction_id=credit where finance_bank_transfers.id=v_id;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) values(p_company,p_from,'cash_transfer_recorded',jsonb_build_object('transfer_id',v_id,'request',req),auth.uid());return v_id;
end $$;
create function public.complete_cash_transfer(p_transfer uuid,p_date date,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.finance_bank_transfers;a public.finance_bank_accounts;v_id uuid;begin
 select * into t from public.finance_bank_transfers where finance_bank_transfers.id=p_transfer;
 if t.id is null then raise exception 'Transferência indisponível.';end if;
 perform pg_advisory_xact_lock(hashtextextended(t.company_id::text,716));
 a:=finance_private.account(t.from_account_id,'finance.bank_accounts.transfer');a:=finance_private.account(t.to_account_id,'finance.bank_accounts.transfer');
 select * into t from public.finance_bank_transfers where finance_bank_transfers.id=p_transfer for update;
 if p_date<a.opening_balance_date then raise exception 'Crédito anterior à abertura da conta.';end if;
 if t.status<>'posted' or t.nature is null or p_date<t.transfer_date or p_date>(now() at time zone 'America/Sao_Paulo')::date or p_date is null or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Crédito exige data efetiva e prova.';end if;
 if t.credit_transaction_id is not null then
  if exists(select 1 from public.finance_bank_transactions where finance_bank_transactions.id=t.credit_transaction_id and transaction_date=p_date) and exists(select 1 from public.finance_bank_audit where event='cash_transfer_completed' and details->>'transfer_id'=t.id::text and details->>'evidence'=p_evidence and details->>'reason'=p_reason) then return t.credit_transaction_id;end if;raise exception 'Crédito já registrado com outra data.';
 end if;
 insert into public.finance_bank_transactions(company_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,transfer_id,source_system,source_id,created_by)
 values(t.company_id,a.legal_entity_id,a.id,p_date,'credit','transfer',p_reason,t.amount,t.id,'elos_cashflow',t.id::text||':credit',auth.uid()) returning finance_bank_transactions.id into v_id;
 update public.finance_bank_transfers set credit_transaction_id=v_id where finance_bank_transfers.id=t.id;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) values(t.company_id,a.id,'cash_transfer_completed',jsonb_build_object('transfer_id',t.id,'date',p_date,'evidence',p_evidence,'reason',p_reason),auth.uid());return v_id;
end $$;
revoke all on function public.record_cash_transfer(uuid,uuid,uuid,uuid,date,date,numeric,numeric,text,text,text),public.complete_cash_transfer(uuid,date,text,text) from public,anon;
grant execute on function public.record_cash_transfer(uuid,uuid,uuid,uuid,date,date,numeric,numeric,text,text,text),public.complete_cash_transfer(uuid,date,text,text) to authenticated;
-- Canonical bank facts cannot be erased through the legacy cancellation UI.
alter table public.finance_bank_transfers add column reversal_of uuid references public.finance_bank_transfers(id);
create unique index cash_transfer_single_reversal on public.finance_bank_transfers(reversal_of) where reversal_of is not null;
create function finance_private.protect_cash_transfer() returns trigger language plpgsql set search_path='' as $$begin
 if old.command_id is null then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'Transferência rastreável exige evento inverso, sem exclusão.';end if;
 if current_user in('authenticated','anon') or
 (to_jsonb(new)-array['debit_transaction_id','credit_transaction_id','reversal_of','updated_at']) is distinct from (to_jsonb(old)-array['debit_transaction_id','credit_transaction_id','reversal_of','updated_at']) or
 old.debit_transaction_id is not null and new.debit_transaction_id is distinct from old.debit_transaction_id or
 old.credit_transaction_id is not null and new.credit_transaction_id is distinct from old.credit_transaction_id or
 old.reversal_of is not null and new.reversal_of is distinct from old.reversal_of then raise exception 'Transferência rastreável exige evento inverso; preservar original.';end if;
 if new.reversal_of is not null and not exists(select 1 from public.finance_bank_transfers o where o.id=new.reversal_of and o.company_id=new.company_id and o.from_account_id=new.to_account_id and o.to_account_id=new.from_account_id and o.amount=new.amount and o.credit_transaction_id is not null) then raise exception 'Evento inverso incompatível.';end if;
 return new;
end $$;
create trigger cash_transfer_history before update or delete on public.finance_bank_transfers for each row execute function finance_private.protect_cash_transfer();
create function finance_private.protect_cash_bank_fact() returns trigger language plpgsql set search_path='' as $$begin
 if old.source_system not in('elos_cashflow','elos_settlement') or old.source_system is null then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'Movimento financeiro rastreável não pode ser excluído.';end if;
 if current_user in('authenticated','anon') or (to_jsonb(new)-array['status','reconciliation_date','reconciliation_reference','reconciled_by','updated_at']) is distinct from (to_jsonb(old)-array['status','reconciliation_date','reconciliation_reference','reconciled_by','updated_at']) or new.status='cancelled' then raise exception 'Movimento financeiro exige estorno/devolução em evento separado.';end if;
 return new;
end $$;
create trigger cash_bank_fact_history before update or delete on public.finance_bank_transactions for each row execute function finance_private.protect_cash_bank_fact();
create function public.reverse_cash_transfer(p_original uuid,p_command uuid,p_debit date,p_credit date,p_fee numeric,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare o public.finance_bank_transfers;r uuid;begin
 select * into o from public.finance_bank_transfers where id=p_original;
 if o.id is null then raise exception 'Transferência indisponível.';end if;
 if not coalesce(public.has_company_permission(o.company_id,'finance.bank_accounts.transfer'),false) then raise exception 'Transferência indisponível.';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.company_id::text,716));
 perform finance_private.account(o.from_account_id,'finance.bank_accounts.transfer');perform finance_private.account(o.to_account_id,'finance.bank_accounts.transfer');
 if o.credit_transaction_id is null then raise exception 'Transferência em trânsito exige apuração da devolução; não inventar outra ponta.';end if;
 if p_debit<o.transfer_date then raise exception 'Evento inverso anterior ao original.';end if;
 r:=public.record_cash_transfer(o.company_id,o.to_account_id,o.from_account_id,p_command,p_debit,p_credit,o.amount,p_fee,o.nature,p_evidence,p_reason);
 update public.finance_bank_transfers set reversal_of=o.id where id=r;
 insert into public.finance_bank_audit(company_id,bank_account_id,event,details,created_by) select o.company_id,o.from_account_id,'cash_transfer_reversal',jsonb_build_object('original',o.id,'reversal',r,'reason',p_reason,'evidence',p_evidence),auth.uid() where not exists(select 1 from public.finance_bank_audit where event='cash_transfer_reversal' and details->>'reversal'=r::text);
 return r;
end $$;
revoke all on function finance_private.protect_cash_transfer(),finance_private.protect_cash_bank_fact() from public,anon,authenticated;
revoke all on function public.reverse_cash_transfer(uuid,uuid,date,date,numeric,text,text) from public,anon;
grant execute on function public.reverse_cash_transfer(uuid,uuid,date,date,numeric,text,text) to authenticated;

commit;
