-- Isolated candidate: evidence, future versions and explicit coverage. No production backfill.
begin;
insert into public.permissions(key,module,action,description) values ('cashflow.manage','finance','manage_cashflow','Registrar versões financeiras documentadas') on conflict(key) do nothing;
create table public.finance_cash_openings (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
 legal_entity_id uuid not null,bank_account_id uuid not null references public.finance_bank_accounts(id),
 opening_date date not null,opening_amount numeric(18,2) not null,restricted_amount numeric(18,2) not null check(restricted_amount>=0),
 evidence text not null,reason text not null,command_id uuid not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id),unique(company_id,command_id)
);
create table public.finance_cash_scenarios (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
 legal_entity_id uuid not null,baseline_id uuid,parent_id uuid references public.finance_cash_scenarios(id),
 cutoff date not null,completion_date date not null,minimum_cash numeric(18,2),command_id uuid not null,
 reason text not null,evidence text not null,request jsonb not null,source_snapshot jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(completion_date>=cutoff),check(minimum_cash>=0),unique(company_id,command_id),foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id)
);
create unique index cash_scenario_original on public.finance_cash_scenarios(company_id,legal_entity_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000')) where parent_id is null;
create unique index cash_scenario_successor on public.finance_cash_scenarios(parent_id) where parent_id is not null;
create table public.finance_cash_scenario_rows (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),
 scenario_id uuid not null references public.finance_cash_scenarios(id),scope_key text not null,category text not null,
 amount_cents bigint not null check(amount_cents>=0 and amount_cents<=9007199254740991),expected_date date,
 title_id uuid,title_type text,activity_id uuid,payment_lag_days integer check(payment_lag_days between 0 and 365),source_kind text not null,source_id uuid,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(scenario_id,scope_key),check(category in('R','AR','C','P','AR_FUTURE','REVENUE','AF','FINANCING_IN','FINANCING_OUT'))
);
create table public.finance_cash_coverage_links (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid references public.projects(id),legal_entity_id uuid not null,
 scenario_id uuid not null references public.finance_cash_scenarios(id),scope_project_id uuid references public.projects(id),scope_key text not null,title_type text not null check(title_type in('AP','AR')),title_id uuid not null,amount_cents bigint not null check(amount_cents>0),
 command_id uuid not null,evidence text not null,reason text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(company_id,command_id),unique(company_id,title_type,title_id),foreign key(company_id,legal_entity_id) references public.legal_entities(company_id,id)
);
do $$declare t text;begin
 foreach t in array array['finance_cash_openings','finance_cash_scenarios','finance_cash_scenario_rows','finance_cash_coverage_links'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  if t='finance_cash_scenario_rows' then
   execute format('create policy cash_read on public.%I for select to authenticated using(exists(select 1 from public.finance_cash_scenarios s where s.id=scenario_id and s.company_id=finance_cash_scenario_rows.company_id))',t);
  else
   execute format('create policy cash_read on public.%I for select to authenticated using(public.has_company_permission(company_id,''cashflow.view'') and public.finance_entity_scope(company_id,legal_entity_id,false))',t);
  end if;
  execute format('create trigger cash_immutable before update or delete on public.%I for each row execute function finance_private.immutable_audit()',t);
 end loop;
end $$;
create policy scenario_source_permissions on public.finance_cash_scenarios as restrictive for select to authenticated using(public.has_company_permission(company_id,'payables.view') and public.has_company_permission(company_id,'receivables.view') and public.has_company_permission(company_id,'finance.bank_accounts.view'));
create policy opening_bank_permission on public.finance_cash_openings as restrictive for select to authenticated using(public.has_company_permission(company_id,'finance.bank_accounts.view'));
create policy coverage_title_permission on public.finance_cash_coverage_links as restrictive for select to authenticated using(public.has_company_permission(company_id,case title_type when 'AP' then 'payables.view' else 'receivables.view' end));
create function public.validate_cash_opening(p_account uuid,p_command uuid,p_restricted numeric,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.finance_bank_accounts; prior public.finance_cash_openings;v_id uuid;begin
 a:=finance_private.account(p_account,'finance.bank_accounts.reconcile');
 if a.legal_entity_id is null or p_command is null or p_restricted is null or p_restricted<0 or p_restricted='NaN'::numeric or p_restricted<>round(p_restricted,2) or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Saldo inicial exige titular, evidência e restrição explícita.';end if;
 select * into prior from public.finance_cash_openings where company_id=a.company_id and command_id=p_command;
 if prior.id is not null then
  if prior.bank_account_id<>p_account or prior.opening_date<>a.opening_balance_date or prior.opening_amount<>a.opening_balance or prior.restricted_amount<>p_restricted or prior.evidence<>p_evidence or prior.reason<>p_reason then raise exception 'Comando reutilizado.';end if;return prior.id;
 end if;
 insert into public.finance_cash_openings(company_id,legal_entity_id,bank_account_id,opening_date,opening_amount,restricted_amount,evidence,reason,command_id,created_by)
 values(a.company_id,a.legal_entity_id,a.id,a.opening_balance_date,a.opening_balance,p_restricted,p_evidence,p_reason,p_command,auth.uid()) returning finance_cash_openings.id into v_id;return v_id;
end $$;
create function public.save_cash_scenario(p_company uuid,p_entity uuid,p_project uuid,p_parent uuid,p_command uuid,p_cutoff date,p_completion date,p_minimum numeric,p_baseline uuid,p_rows jsonb,p_evidence text,p_reason text,p_change_kind text default 'reschedule')
returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.finance_cash_scenarios;parent public.finance_cash_scenarios;request jsonb;v_id uuid;r jsonb;v_title jsonb;entity uuid;begin
 if not coalesce(public.has_company_permission(p_company,'cashflow.manage'),false) or not public.has_company_permission(p_company,'payables.view') or not public.has_company_permission(p_company,'receivables.view') or not public.has_company_permission(p_company,'finance.bank_accounts.view') or not public.finance_entity_scope(p_company,p_entity,true) or not exists(select 1 from public.legal_entities where id=p_entity and company_id=p_company) then raise exception 'Sem permissão no cenário.';end if;
 if p_project is not null and not exists(select 1 from public.projects where id=p_project and company_id=p_company and legal_entity_id=p_entity) then raise exception 'Obra incompatível.';end if;
 if p_change_kind not in('reschedule','coverage') or p_change_kind is null or p_command is null or p_cutoff is null or p_completion is null or p_completion<p_cutoff or p_minimum<0 or p_minimum='NaN'::numeric or p_minimum<>round(p_minimum,2) or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Cenário exige datas, valores exatos, evidência e motivo.';end if;
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
   old.scope_key is null or fresh.scope_key is null or old.amount_cents<>fresh.amount_cents or old.title_id is distinct from fresh.title_id or old.title_type is distinct from fresh.title_type or old.activity_id is distinct from fresh.activity_id or old.payment_lag_days is distinct from fresh.payment_lag_days or
   not ((old.category=fresh.category and old.source_kind=fresh.source_kind and old.source_id is not distinct from fresh.source_id) or (p_change_kind='coverage' and old.category='P' and fresh.category='C' and fresh.source_kind='contract'))
  )
 ) then raise exception 'Reprogramação preserva valores e fontes; mudança de estimativa exige revisão própria.';end if;
 return v_id;
end $$;
create function public.link_cash_coverage(p_company uuid,p_entity uuid,p_project uuid,p_scope text,p_scenario uuid,p_type text,p_title uuid,p_command uuid,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_title jsonb;entity uuid;scope_project uuid;capacity bigint;prior public.finance_cash_coverage_links;v_id uuid;begin
 if not coalesce(public.has_company_permission(p_company,'cashflow.manage'),false) then raise exception 'Sem permissão.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,716));v_title:=finance_private.title(p_company,p_type,p_title);
 select legal_entity_id into entity from public.projects where projects.id=(v_title->>'project_id')::uuid;entity:=coalesce((v_title->>'legal_entity_id')::uuid,entity);
 if entity<>p_entity or (v_title->>'project_id')::uuid is distinct from p_project or p_command is null or length(btrim(coalesce(p_evidence,'')))<5 or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Vínculo exige escopo e evidência.';end if;
 select s.project_id,r.amount_cents into scope_project,capacity from public.finance_cash_scenario_rows r join public.finance_cash_scenarios s on s.id=r.scenario_id where s.id=p_scenario and s.company_id=p_company and s.legal_entity_id=p_entity and (s.project_id is null or s.project_id is not distinct from p_project) and r.scope_key=p_scope and ((p_type='AP' and r.category in('P','C','FINANCING_OUT')) or (p_type='AR' and r.category in('AR_FUTURE','FINANCING_IN')));
 if capacity is null then raise exception 'Escopo financeiro não identificado.';end if;
 select * into prior from public.finance_cash_coverage_links where company_id=p_company and (command_id=p_command or title_type=p_type and title_id=p_title);
 if prior.id is not null then if prior.command_id<>p_command or prior.scope_key<>p_scope or prior.scenario_id<>p_scenario or prior.title_id<>p_title or prior.evidence<>p_evidence or prior.reason<>p_reason then raise exception 'Vínculo duplicado ou comando diferente.';end if;return prior.id;end if;
 if coalesce((select sum(amount_cents) from public.finance_cash_coverage_links where company_id=p_company and legal_entity_id=p_entity and scope_key=p_scope and scope_project_id is not distinct from scope_project),0)+(case p_type when 'AR' then coalesce((v_title->>'adjusted_amount')::numeric,(v_title->>'amount')::numeric) else (v_title->>'amount')::numeric end)*100>capacity then raise exception 'Vínculo excede cobertura.';end if;
 insert into public.finance_cash_coverage_links(company_id,project_id,legal_entity_id,scenario_id,scope_project_id,scope_key,title_type,title_id,amount_cents,command_id,evidence,reason,created_by)
 values(p_company,p_project,p_entity,p_scenario,scope_project,p_scope,p_type,p_title,(case p_type when 'AR' then coalesce((v_title->>'adjusted_amount')::numeric,(v_title->>'amount')::numeric) else (v_title->>'amount')::numeric end)*100,p_command,p_evidence,p_reason,auth.uid()) returning finance_cash_coverage_links.id into v_id;return v_id;
end $$;
revoke all on function public.validate_cash_opening(uuid,uuid,numeric,text,text),public.save_cash_scenario(uuid,uuid,uuid,uuid,uuid,date,date,numeric,uuid,jsonb,text,text,text),public.link_cash_coverage(uuid,uuid,uuid,text,uuid,text,uuid,uuid,text,text) from public,anon;
grant execute on function public.validate_cash_opening(uuid,uuid,numeric,text,text),public.save_cash_scenario(uuid,uuid,uuid,uuid,uuid,date,date,numeric,uuid,jsonb,text,text,text),public.link_cash_coverage(uuid,uuid,uuid,text,uuid,text,uuid,uuid,text,text) to authenticated;
create function public.reprogram_cash_schedule(p_company uuid,p_parent uuid,p_command uuid,p_cutoff date,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.finance_cash_scenarios;rows jsonb;begin
 select * into s from public.finance_cash_scenarios where id=p_parent and company_id=p_company;
 if s.id is null or not coalesce(public.has_company_permission(p_company,'cashflow.manage'),false) or not public.finance_entity_scope(p_company,s.legal_entity_id,true) then raise exception 'Versão indisponível.';end if;
 if s.baseline_id is null then raise exception 'Sem vínculo de cronograma físico.';end if;
 select jsonb_agg(jsonb_build_object('scope_key',r.scope_key,'category',r.category,'amount_cents',r.amount_cents,'title_id',r.title_id,'title_type',r.title_type,'source_kind',r.source_kind,'source_id',r.source_id,'activity_id',r.activity_id,'payment_lag_days',r.payment_lag_days,'expected_date',case when r.category in('C','P') and r.activity_id is not null and a.planned_finish>=p_cutoff then a.planned_finish+r.payment_lag_days else r.expected_date end)) into rows
 from public.finance_cash_scenario_rows r left join public.engineering_schedule_activities a on a.id=r.activity_id and a.company_id=p_company and a.project_id=s.project_id and a.baseline_id=s.baseline_id where r.scenario_id=s.id;
 return public.save_cash_scenario(p_company,s.legal_entity_id,s.project_id,s.id,p_command,p_cutoff,s.completion_date,s.minimum_cash,s.baseline_id,rows,p_evidence,p_reason);
end $$;
revoke all on function public.reprogram_cash_schedule(uuid,uuid,uuid,date,text,text) from public,anon;
grant execute on function public.reprogram_cash_schedule(uuid,uuid,uuid,date,text,text) to authenticated;
create function public.convert_cash_scope_to_contract(p_company uuid,p_parent uuid,p_command uuid,p_scope text,p_contract uuid,p_evidence text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.finance_cash_scenarios;rows jsonb;begin
 select * into s from public.finance_cash_scenarios where id=p_parent and company_id=p_company;
 if s.id is null or not coalesce(public.has_company_permission(p_company,'cashflow.manage'),false) or not public.finance_entity_scope(p_company,s.legal_entity_id,true) then raise exception 'Versão indisponível.';end if;
 if not exists(select 1 from public.finance_cash_scenario_rows where scenario_id=s.id and scope_key=p_scope and category='P') then raise exception 'Previsão sem cobertura não identificada.';end if;
 select jsonb_agg(jsonb_build_object('scope_key',r.scope_key,'category',case when r.scope_key=p_scope then 'C' else r.category end,'amount_cents',r.amount_cents,'title_id',r.title_id,'title_type',r.title_type,'source_kind',case when r.scope_key=p_scope then 'contract' else r.source_kind end,'source_id',case when r.scope_key=p_scope then p_contract else r.source_id end,'activity_id',r.activity_id,'payment_lag_days',r.payment_lag_days,'expected_date',r.expected_date)) into rows from public.finance_cash_scenario_rows r where r.scenario_id=s.id;
 return public.save_cash_scenario(p_company,s.legal_entity_id,s.project_id,s.id,p_command,s.cutoff,s.completion_date,s.minimum_cash,s.baseline_id,rows,p_evidence,p_reason,'coverage');
end $$;
revoke all on function public.convert_cash_scope_to_contract(uuid,uuid,uuid,text,uuid,text,text) from public,anon;
grant execute on function public.convert_cash_scope_to_contract(uuid,uuid,uuid,text,uuid,text,text) to authenticated;
commit;
