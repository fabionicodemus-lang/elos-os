-- Etapa12 / CT18: explicit evidence linking a future adjustment to its constituted charge.
-- Additive candidate only. No production execution, backfill or inferred legacy links.
begin;
create table public.finance_cash_adjustment_realizations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 project_id uuid not null references public.projects(id),
 legal_entity_id uuid not null,
 forecast_row_id uuid not null unique references public.finance_cash_scenario_rows(id),
 scenario_id uuid not null references public.finance_cash_scenarios(id),
 root_scenario_id uuid not null references public.finance_cash_scenarios(id),scope_key text not null,
 charge_id uuid not null unique references public.finance_title_charges(id),
 title_type text not null check(title_type in('AP','AR')),title_id uuid not null,
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=9007199254740991),
 effective_date date not null,command_id uuid not null,
 evidence text not null check(length(btrim(evidence))>=5),reason text not null check(length(btrim(reason))>=5),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id),unique(company_id,command_id),
 unique(root_scenario_id,scope_key)
);
alter table public.finance_cash_adjustment_realizations enable row level security;
revoke all on public.finance_cash_adjustment_realizations from public,anon,authenticated;
grant select on public.finance_cash_adjustment_realizations to authenticated;
create policy cash_adjustment_realizations_read on public.finance_cash_adjustment_realizations for select to authenticated using(
 public.has_company_permission(company_id,'cashflow.view') and public.finance_entity_scope(company_id,legal_entity_id,false)
 and public.has_company_permission(company_id,case title_type when 'AP' then 'payables.view' else 'receivables.view' end)
);
create trigger cash_adjustment_realizations_immutable before update or delete on public.finance_cash_adjustment_realizations
 for each row execute function finance_private.immutable_audit();

create function public.realize_cash_adjustment(p_company uuid,p_forecast uuid,p_type text,p_title uuid,
 p_command uuid,p_amount numeric,p_date date,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.finance_cash_scenario_rows;s public.finance_cash_scenarios;
 prior public.finance_cash_adjustment_realizations;t jsonb;entity uuid;charge uuid;v_id uuid;root_id uuid;
begin
 if auth.uid() is null or not coalesce(public.has_company_permission(p_company,'cashflow.manage'),false)
 then raise exception 'Sem permissão no ajuste.';end if;
 if p_command is null or p_forecast is null or p_date is null or p_amount is null or p_amount='NaN'::numeric
 or p_amount<=0 or p_amount<>round(p_amount,2) or length(btrim(coalesce(p_evidence,'')))<5
 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Constituição exige valor exato, data, comando, evidência e motivo.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 t:=finance_private.title(p_company,p_type,p_title);
 select legal_entity_id into entity from public.projects where id=(t->>'project_id')::uuid;
 entity:=coalesce((t->>'legal_entity_id')::uuid,entity);
 select * into r from public.finance_cash_scenario_rows where id=p_forecast and company_id=p_company;
 select * into s from public.finance_cash_scenarios where id=r.scenario_id and company_id=p_company;
 if r.id is null or s.id is null or r.category<>'AF' or p_type<>'AP' or s.legal_entity_id<>entity
 or not coalesce(public.finance_entity_scope(p_company,entity,true),false)
 or s.project_id is not null and s.project_id is distinct from (t->>'project_id')::uuid
 or r.title_id is not null and (r.title_id<>p_title or r.title_type is distinct from p_type)
 or p_date<s.cutoff or r.amount_cents<>p_amount*100
 then raise exception 'Ajuste e encargo exigem mesma entidade, obra, título e valor integral documentado.';end if;
 with recursive lineage as (
  select id,parent_id from public.finance_cash_scenarios where id=s.id
  union all select a.id,a.parent_id from public.finance_cash_scenarios a join lineage l on a.id=l.parent_id
 ) select id into root_id from lineage where parent_id is null;
 select * into prior from public.finance_cash_adjustment_realizations
 where company_id=p_company and (command_id=p_command or root_scenario_id=root_id and scope_key=r.scope_key);
 if prior.id is not null then
  if prior.forecast_row_id<>p_forecast or prior.title_type<>p_type or prior.title_id<>p_title or prior.command_id<>p_command
  or prior.amount_cents<>p_amount*100 or prior.effective_date<>p_date or prior.evidence<>p_evidence or prior.reason<>p_reason
  then raise exception 'Ajuste já constituído ou comando reutilizado.';end if;
  return prior.id;
 end if;
 -- A charge already created under this command must not be silently reinterpreted.
 if exists(select 1 from public.finance_title_charges where company_id=p_company and command_id=p_command)
 then raise exception 'Comando já utilizado por encargo sem este vínculo.';end if;
 charge:=public.add_finance_title_interest(p_company,p_type,p_title,p_command,p_amount,p_date,p_reason);
 insert into public.finance_cash_adjustment_realizations(company_id,project_id,legal_entity_id,forecast_row_id,
 scenario_id,root_scenario_id,scope_key,charge_id,title_type,title_id,amount_cents,effective_date,command_id,evidence,reason,created_by)
 values(p_company,(t->>'project_id')::uuid,entity,r.id,s.id,root_id,r.scope_key,charge,p_type,p_title,p_amount*100,
 p_date,p_command,p_evidence,p_reason,auth.uid()) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.realize_cash_adjustment(uuid,uuid,text,uuid,uuid,numeric,date,text,text) from public,anon;
grant execute on function public.realize_cash_adjustment(uuid,uuid,text,uuid,uuid,numeric,date,text,text) to authenticated;

-- Preserve the exact known link set in every new snapshot. Old snapshots are immutable.
create function finance_private.snapshot_cash_adjustment_realizations() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.source_snapshot:=new.source_snapshot||jsonb_build_object('adjustment_realizations',(
  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from public.finance_cash_adjustment_realizations a
  where a.company_id=new.company_id and a.legal_entity_id=new.legal_entity_id
  and (new.project_id is null or a.project_id=new.project_id)
  and exists(with recursive lineage as (
   select new.parent_id id union all
   select s.parent_id from public.finance_cash_scenarios s join lineage l on s.id=l.id
  ) select 1 from lineage where id=a.scenario_id)
 ));
 return new;
end $$;
create trigger cash_scenario_snapshot_adjustment_realizations before insert on public.finance_cash_scenarios
 for each row execute function finance_private.snapshot_cash_adjustment_realizations();
-- Preserve the prior version RPC; permit only additive, documented AF revisions.
create or replace function public.save_cash_scenario(p_company uuid,p_entity uuid,p_project uuid,p_parent uuid,p_command uuid,p_cutoff date,p_completion date,p_minimum numeric,p_baseline uuid,p_rows jsonb,p_evidence text,p_reason text,p_change_kind text default 'reschedule')
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.finance_cash_scenarios;parent public.finance_cash_scenarios;request jsonb;v_id uuid;r jsonb;v_title jsonb;entity uuid;begin
 if not coalesce(public.has_company_permission(p_company,'cashflow.manage'),false) or not public.has_company_permission(p_company,'payables.view') or not public.has_company_permission(p_company,'receivables.view') or not public.has_company_permission(p_company,'finance.bank_accounts.view') or not public.finance_entity_scope(p_company,p_entity,true) or not exists(select 1 from public.legal_entities where id=p_entity and company_id=p_company) then raise exception 'Sem permissão no cenário.';end if;
 if p_project is not null and not exists(select 1 from public.projects where id=p_project and company_id=p_company and legal_entity_id=p_entity) then raise exception 'Obra incompatível.';end if;
 if p_change_kind not in('reschedule','coverage','adjustment') or p_change_kind is null or p_command is null or p_cutoff is null or p_completion is null or p_completion<p_cutoff or p_minimum<0 or p_minimum='NaN'::numeric or p_minimum<>round(p_minimum,2) or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Cenário exige datas, valores exatos, evidência e motivo.';end if;
 if p_baseline is not null and not exists(select 1 from public.engineering_schedule_baselines b where b.id=p_baseline and b.company_id=p_company and b.project_id=p_project) then raise exception 'Cronograma físico fora do escopo.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));
 request:=jsonb_build_object('entity',p_entity,'project',p_project,'parent',p_parent,'cutoff',p_cutoff,'completion',p_completion,'minimum',p_minimum,'baseline',p_baseline,'rows',p_rows,'evidence',p_evidence,'reason',p_reason,'change_kind',p_change_kind);
 select * into prior from public.finance_cash_scenarios where company_id=p_company and command_id=p_command;
 if prior.id is not null then if prior.request<>request then raise exception 'Comando reutilizado.';end if;return prior.id;end if;
 if p_parent is not null then
  select * into parent from public.finance_cash_scenarios where id=p_parent and company_id=p_company;
  if parent.id is null or parent.legal_entity_id<>p_entity or parent.project_id is distinct from p_project or p_cutoff<parent.cutoff or exists(select 1 from public.finance_cash_scenarios where parent_id=p_parent) then raise exception 'Versão base obsoleta ou incompatível.';end if;
 end if;
 insert into public.finance_cash_scenarios(company_id,project_id,legal_entity_id,baseline_id,parent_id,cutoff,completion_date,minimum_cash,command_id,reason,evidence,request,source_snapshot,created_by)
 values(p_company,p_project,p_entity,p_baseline,p_parent,p_cutoff,p_completion,p_minimum,p_command,p_reason,p_evidence,request,jsonb_build_object(
 'physical_activities',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'company_id',a.company_id,'project_id',a.project_id,'baseline_id',a.baseline_id,'planned_finish',a.planned_finish)),'[]') from public.engineering_schedule_activities a where a.company_id=p_company and a.baseline_id=p_baseline and a.project_id=p_project),
 'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'company_id',c.company_id,'project_id',c.project_id,'status',c.status,'current_value',c.current_value)),'[]') from public.execution_service_contracts c join public.projects p on p.id=c.project_id where c.company_id=p_company and p.legal_entity_id=p_entity and (p_project is null or c.project_id=p_project)),
 'native_invoices',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'company_id',i.company_id,'project_id',i.project_id,'contract_id',i.contract_id,'measurement_id',i.measurement_id)),'[]') from public.finance_manual_invoices i join public.projects p on p.id=i.project_id where i.company_id=p_company and p.legal_entity_id=p_entity and i.status='approved'),
 'native_installments',(select coalesce(jsonb_agg(jsonb_build_object('invoice_id',i.invoice_id,'payable_id',i.payable_id)),'[]') from public.finance_manual_invoice_installments i join public.projects p on p.id=i.project_id where i.company_id=p_company and p.legal_entity_id=p_entity),
 'native_measurements',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'contract_id',m.contract_id,'payable_id',m.payable_id)),'[]') from public.execution_contract_measurements m join public.projects p on p.id=m.project_id where m.company_id=p_company and p.legal_entity_id=p_entity and m.status in('approved','invoiced','paid')),
 'audits',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.finance_title_audit a where a.company_id=p_company and a.legal_entity_id=p_entity),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.finance_settlement_events e where e.company_id=p_company and e.legal_entity_id=p_entity),
 'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.finance_settlement_lines l join public.finance_settlement_events e on e.id=l.event_id where l.company_id=p_company and e.legal_entity_id=p_entity),
 'charges',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.finance_title_charges c where c.company_id=p_company and (c.project_id=p_project or p_project is null and exists(select 1 from public.projects p where p.id=c.project_id and p.legal_entity_id=p_entity))),
 'cash',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.finance_settlement_cash_rows c join public.finance_settlement_events e on e.id=c.event_id where c.company_id=p_company and e.legal_entity_id=p_entity),
 'accounts',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.finance_bank_accounts a where a.company_id=p_company and a.legal_entity_id=p_entity),
 'movements',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.finance_bank_transactions m where m.company_id=p_company and m.legal_entity_id=p_entity),
 'links',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.finance_reconciliation_links l join public.finance_bank_transactions m on m.id=l.transaction_id where l.company_id=p_company and m.legal_entity_id=p_entity),
 'entries',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.finance_statement_entries e join public.finance_bank_accounts a on a.id=e.bank_account_id where e.company_id=p_company and a.legal_entity_id=p_entity),
 'transfers',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.finance_bank_transfers t join public.finance_bank_accounts a on a.id=t.from_account_id join public.finance_bank_accounts b on b.id=t.to_account_id where t.company_id=p_company and a.legal_entity_id=p_entity and b.legal_entity_id=p_entity),
 'openings',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from public.finance_cash_openings o where o.company_id=p_company and o.legal_entity_id=p_entity),
 'payables',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.payables t left join public.projects p on p.id=t.project_id where t.company_id=p_company and coalesce(t.legal_entity_id,p.legal_entity_id)=p_entity and (p_project is null or t.project_id=p_project)),
 'receivables',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.receivables t join public.projects p on p.id=t.project_id where t.company_id=p_company and p.legal_entity_id=p_entity and (p_project is null or t.project_id=p_project)),
 'coverage',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from public.finance_cash_coverage_links l where l.company_id=p_company and l.legal_entity_id=p_entity and (p_project is null or l.project_id=p_project))
 ),auth.uid()) returning finance_cash_scenarios.id into v_id;
 for r in select value from jsonb_array_elements(p_rows) loop
  if nullif(btrim(r->>'scope_key'),'') is null or not coalesce(r->>'amount_cents' ~ '^\d+$',false) or (r->>'amount_cents')::numeric>9007199254740991 or r->>'source_kind' not in('documented_estimate','contract','title','financing') then raise exception 'Linha financeira inválida.';end if;
  if (r->>'expected_date')::date<p_cutoff and not exists(select 1 from public.finance_cash_scenario_rows old where old.scenario_id=p_parent and old.scope_key=r->>'scope_key' and old.expected_date=(r->>'expected_date')::date) then raise exception 'Reprogramação só altera previsão futura; sem sobrescrever realizado.';end if;
  if r->>'category' in('R','AR') then
   v_title:=finance_private.title(p_company,case r->>'category' when 'R' then 'AP' else 'AR' end,(r->>'title_id')::uuid);
   select legal_entity_id into entity from public.projects where projects.id=(v_title->>'project_id')::uuid;entity:=coalesce((v_title->>'legal_entity_id')::uuid,entity);
   if entity<>p_entity or p_project is not null and (v_title->>'project_id')::uuid is distinct from p_project or r->>'source_kind'<>'title' then raise exception 'Título de outro escopo.';end if;
   if r->>'category'='R' and (r->>'expected_date')::date is distinct from (v_title->>'due_date')::date then raise exception 'Cronograma não altera vencimento de obrigação; exige renegociação própria.';end if;
   if p_parent is null and (r->>'amount_cents')::numeric<>(v_title->>'finance_open_amount')::numeric*100 then raise exception 'Saldo de título deve vir do núcleo.';end if;
  elsif r->>'category'='AF' and p_change_kind='adjustment' then
   v_title:=finance_private.title(p_company,r->>'title_type',(r->>'title_id')::uuid);
   select legal_entity_id into entity from public.projects where id=(v_title->>'project_id')::uuid;
   entity:=coalesce((v_title->>'legal_entity_id')::uuid,entity);
   if r->>'title_type' is distinct from 'AP' or r->>'source_kind' is distinct from 'title'
    or (r->>'source_id')::uuid is distinct from (v_title->>'id')::uuid or entity<>p_entity
    or p_project is not null and (v_title->>'project_id')::uuid is distinct from p_project
   then raise exception 'Novo AF exige título e fonte do mesmo escopo.';end if;
  elsif r->>'category'='C' then
   if r->>'source_kind'<>'contract' or not exists(select 1 from public.execution_service_contracts c where c.id=(r->>'source_id')::uuid and c.company_id=p_company and (p_project is null or c.project_id=p_project) and c.status='active' and exists(select 1 from public.projects pr where pr.id=c.project_id and pr.legal_entity_id=p_entity)) then raise exception 'Compromisso exige contrato firme do escopo.';end if;
  end if;
  if r->>'activity_id' is not null and (r->>'category' not in('C','P') or p_baseline is null or r->>'payment_lag_days' is null or not exists(select 1 from public.engineering_schedule_activities a where a.id=(r->>'activity_id')::uuid and a.baseline_id=p_baseline and a.company_id=p_company and a.project_id=p_project)) then raise exception 'Atividade e prazo financeiro exigem cronograma do mesmo escopo.';end if;
  insert into public.finance_cash_scenario_rows(company_id,project_id,scenario_id,scope_key,category,amount_cents,expected_date,title_id,title_type,activity_id,payment_lag_days,source_kind,source_id,created_by)
  values(p_company,p_project,v_id,r->>'scope_key',r->>'category',(r->>'amount_cents')::bigint,(r->>'expected_date')::date,(r->>'title_id')::uuid,r->>'title_type',(r->>'activity_id')::uuid,(r->>'payment_lag_days')::integer,r->>'source_kind',(r->>'source_id')::uuid,auth.uid());
 end loop;
 if exists(select 1 from public.finance_cash_scenario_rows r join public.execution_service_contracts c on c.id=r.source_id where r.scenario_id=v_id and r.category='C' group by c.id,c.current_value having sum(r.amount_cents)>c.current_value*100) then raise exception 'Cobertura superior ao contrato firme.';end if;
 if p_parent is not null and exists(
  select 1 from (select * from public.finance_cash_scenario_rows where scenario_id=p_parent) old full join (select * from public.finance_cash_scenario_rows where scenario_id=v_id) fresh on old.scope_key=fresh.scope_key
  where (
   fresh.scope_key is null or (old.scope_key is null and
    (p_change_kind<>'adjustment' or fresh.category<>'AF' or fresh.source_kind<>'title' or fresh.title_id is null or fresh.title_type is distinct from 'AP'))
   or old.scope_key is not null and (old.amount_cents<>fresh.amount_cents or old.title_id is distinct from fresh.title_id or old.title_type is distinct from fresh.title_type or old.activity_id is distinct from fresh.activity_id or old.payment_lag_days is distinct from fresh.payment_lag_days or
   not ((old.category=fresh.category and old.source_kind=fresh.source_kind and old.source_id is not distinct from fresh.source_id) or (p_change_kind='coverage' and old.category='P' and fresh.category='C' and fresh.source_kind='contract')))
  )
 ) then raise exception 'Reprogramação preserva valores e fontes; mudança de estimativa exige revisão própria.';end if;
 return v_id;
end $$;
commit;
