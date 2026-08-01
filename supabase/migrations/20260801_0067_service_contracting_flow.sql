-- Elos OS — Contratação de serviços · solicitação, concorrência, aprovação e etapas de medição

begin;

create table if not exists public.execution_service_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid references public.engineering_budgets(id) on delete set null,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  schedule_activity_id uuid references public.engineering_schedule_activities(id) on delete set null,
  sequence_no integer not null,
  request_number text not null,
  title text not null,
  scope_summary text not null,
  service_code text not null,
  service_name text not null,
  unit_snapshot text not null,
  location_name text,
  requested_quantity numeric(18,6) not null,
  estimated_unit_price numeric(18,6) not null default 0,
  estimated_total numeric(18,2) not null default 0,
  desired_start date not null,
  desired_finish date not null,
  status text not null default 'draft' check (status in ('draft','quotation','analysis','approved','contracted','cancelled')),
  notes text,
  selected_supplier_id uuid references public.suppliers(id) on delete restrict,
  selected_proposal_id uuid,
  approved_total numeric(18,2),
  approval_justification text,
  requested_by uuid references auth.users(id),
  requester_name text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  contract_id uuid references public.execution_service_contracts(id) on delete set null,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, sequence_no),
  unique(project_id, request_number),
  constraint execution_service_request_dates_check check (desired_finish >= desired_start),
  constraint execution_service_request_values_check check (requested_quantity > 0 and estimated_unit_price >= 0 and estimated_total >= 0),
  constraint execution_service_request_approval_check check (
    status not in ('approved','contracted') or (selected_supplier_id is not null and approved_total is not null and approved_total > 0)
  )
);

create table if not exists public.execution_service_request_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid not null references public.execution_service_requests(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_name text not null,
  proposal_number text,
  proposal_date date,
  validity_date date,
  total_price numeric(18,2) not null,
  duration_days integer,
  payment_terms text,
  warranty_months integer not null default 0,
  technical_score numeric(8,2) not null default 0,
  commercial_score numeric(8,2) not null default 0,
  is_qualified boolean not null default true,
  is_selected boolean not null default false,
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(request_id, supplier_id),
  constraint execution_service_request_proposal_values_check check (
    total_price > 0 and coalesce(duration_days,0) >= 0 and warranty_months between 0 and 240 and
    technical_score between 0 and 100 and commercial_score between 0 and 100
  )
);

alter table public.execution_service_requests
  drop constraint if exists execution_service_requests_selected_proposal_id_fkey;
alter table public.execution_service_requests
  add constraint execution_service_requests_selected_proposal_id_fkey
  foreign key(selected_proposal_id) references public.execution_service_request_proposals(id) on delete restrict;

create table if not exists public.execution_service_request_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid not null references public.execution_service_requests(id) on delete cascade,
  contract_id uuid references public.execution_service_contracts(id) on delete cascade,
  contract_item_id uuid references public.execution_service_contract_items(id) on delete set null,
  stage_name text not null,
  weight_percent numeric(8,4) not null,
  contracted_quantity numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  total_value numeric(18,2) not null,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(request_id, stage_name),
  constraint execution_service_request_stage_values_check check (
    weight_percent > 0 and weight_percent <= 100 and contracted_quantity > 0 and unit_price >= 0 and total_value >= 0
  )
);

create table if not exists public.execution_service_request_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid not null references public.execution_service_requests(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

alter table public.execution_service_contracts
  add column if not exists service_request_id uuid references public.execution_service_requests(id) on delete set null;
alter table public.execution_service_contract_items
  add column if not exists source_service_request_id uuid references public.execution_service_requests(id) on delete set null,
  add column if not exists measurement_group_name text,
  add column if not exists measurement_stage_name text,
  add column if not exists measurement_stage_weight numeric(8,4);

create unique index if not exists execution_service_contracts_service_request_uq
  on public.execution_service_contracts(service_request_id) where service_request_id is not null;
create index if not exists execution_service_requests_project_status_idx on public.execution_service_requests(project_id,status,desired_start);
create index if not exists execution_service_request_proposals_request_idx on public.execution_service_request_proposals(request_id,total_price);
create index if not exists execution_service_request_stages_request_idx on public.execution_service_request_stages(request_id,sort_order);
create index if not exists execution_service_contract_items_stage_idx on public.execution_service_contract_items(contract_id,measurement_group_name,sort_order);

alter table public.execution_service_requests enable row level security;
alter table public.execution_service_request_proposals enable row level security;
alter table public.execution_service_request_stages enable row level security;
alter table public.execution_service_request_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['execution_service_requests','execution_service_request_proposals','execution_service_request_stages','execution_service_request_audit']
  loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''execution.contracts.view'') or public.has_company_permission(company_id,''execution.contracts.manage'') or public.has_company_permission(company_id,''execution.contracts.approve''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''execution.contracts.manage'') or public.has_company_permission(company_id,''execution.contracts.approve'')) with check (public.has_company_permission(company_id,''execution.contracts.manage'') or public.has_company_permission(company_id,''execution.contracts.approve''))',t,t);
  end loop;
end $$;

create or replace function public.save_execution_service_request(
  p_company_id uuid,p_project_id uuid,p_request_id uuid,p_budget_id uuid,p_service_id uuid,p_location_id uuid,p_schedule_activity_id uuid,
  p_title text,p_scope_summary text,p_requested_quantity numeric,p_estimated_unit_price numeric,p_desired_start date,p_desired_finish date,p_notes text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  r public.execution_service_requests%rowtype; svc public.engineering_services%rowtype; seq integer; resolved_id uuid; requester text; location_snapshot text;
begin
  if not public.has_company_permission(p_company_id,'execution.contracts.manage') then raise exception 'Sem permissão para criar solicitações de serviços.'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_scope_summary,'')),'') is null then raise exception 'Informe o título e o escopo da solicitação.'; end if;
  if coalesce(p_requested_quantity,0)<=0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  if p_desired_start is null or p_desired_finish is null or p_desired_finish<p_desired_start then raise exception 'Revise as datas desejadas.'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then raise exception 'Obra inválida.'; end if;
  select * into svc from public.engineering_services where id=p_service_id and company_id=p_company_id and status='active';
  if svc.id is null then raise exception 'Selecione um serviço ativo.'; end if;
  if p_budget_id is not null and not exists(select 1 from public.engineering_budgets where id=p_budget_id and company_id=p_company_id and project_id=p_project_id and status='approved') then raise exception 'O orçamento informado não está aprovado.'; end if;
  if p_location_id is not null then
    select concat_ws(' · ',nullif(code,''),name) into location_snapshot from public.engineering_takeoff_locations where id=p_location_id and company_id=p_company_id and project_id=p_project_id and status='active';
    if location_snapshot is null then raise exception 'Local inválido.'; end if;
  end if;
  if p_schedule_activity_id is not null and not exists(select 1 from public.engineering_schedule_activities where id=p_schedule_activity_id and company_id=p_company_id and project_id=p_project_id and record_status='active') then raise exception 'Atividade do cronograma inválida.'; end if;
  select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into requester from public.profiles pr where pr.id=auth.uid();
  requester:=coalesce(requester,nullif(auth.jwt()->>'email',''),'Usuário');

  if p_request_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':service-requests'));
    select coalesce(max(sequence_no),0)+1 into seq from public.execution_service_requests where project_id=p_project_id;
    insert into public.execution_service_requests(
      company_id,project_id,budget_id,service_id,location_id,schedule_activity_id,sequence_no,request_number,title,scope_summary,
      service_code,service_name,unit_snapshot,location_name,requested_quantity,estimated_unit_price,estimated_total,desired_start,desired_finish,
      notes,requested_by,requester_name,created_by,updated_by
    ) values(
      p_company_id,p_project_id,p_budget_id,svc.id,p_location_id,p_schedule_activity_id,seq,'SS-'||lpad(seq::text,4,'0'),trim(p_title),trim(p_scope_summary),
      svc.code,svc.description,svc.unit,location_snapshot,p_requested_quantity,greatest(coalesce(p_estimated_unit_price,0),0),round(p_requested_quantity*greatest(coalesce(p_estimated_unit_price,0),0),2),p_desired_start,p_desired_finish,
      nullif(trim(coalesce(p_notes,'')),''),auth.uid(),requester,auth.uid(),auth.uid()
    ) returning id into resolved_id;
  else
    select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
    if r.id is null then raise exception 'Solicitação não encontrada.'; end if;
    if r.status<>'draft' then raise exception 'Somente solicitações em elaboração podem ser editadas.'; end if;
    resolved_id:=r.id;
    update public.execution_service_requests set
      budget_id=p_budget_id,service_id=svc.id,location_id=p_location_id,schedule_activity_id=p_schedule_activity_id,title=trim(p_title),scope_summary=trim(p_scope_summary),
      service_code=svc.code,service_name=svc.description,unit_snapshot=svc.unit,location_name=location_snapshot,requested_quantity=p_requested_quantity,
      estimated_unit_price=greatest(coalesce(p_estimated_unit_price,0),0),estimated_total=round(p_requested_quantity*greatest(coalesce(p_estimated_unit_price,0),0),2),
      desired_start=p_desired_start,desired_finish=p_desired_finish,notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now()
    where id=resolved_id;
  end if;
  insert into public.execution_service_request_audit(company_id,project_id,request_id,action,new_status,changed_by)
  values(p_company_id,p_project_id,resolved_id,case when p_request_id is null then 'created' else 'updated' end,'draft',auth.uid());
  return resolved_id;
end; $$;

create or replace function public.open_execution_service_competition(p_company_id uuid,p_project_id uuid,p_request_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare r public.execution_service_requests%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.contracts.manage') then raise exception 'Sem permissão para abrir o mapa de concorrência.'; end if;
  select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
  if r.id is null or r.status<>'draft' then raise exception 'A solicitação não está disponível para cotação.'; end if;
  update public.execution_service_requests set status='quotation',updated_by=auth.uid(),updated_at=now() where id=r.id;
  insert into public.execution_service_request_audit(company_id,project_id,request_id,action,previous_status,new_status,changed_by)
  values(p_company_id,p_project_id,r.id,'competition_opened','draft','quotation',auth.uid());
  return 'quotation';
end; $$;

create or replace function public.save_execution_service_proposal(
  p_company_id uuid,p_project_id uuid,p_request_id uuid,p_supplier_id uuid,p_proposal_number text,p_proposal_date date,p_validity_date date,
  p_total_price numeric,p_duration_days integer,p_payment_terms text,p_warranty_months integer,p_technical_score numeric,p_commercial_score numeric,
  p_is_qualified boolean,p_notes text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare r public.execution_service_requests%rowtype; supplier_snapshot text; proposal_id uuid; begin
  if not public.has_company_permission(p_company_id,'execution.contracts.manage') then raise exception 'Sem permissão para registrar propostas.'; end if;
  select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
  if r.id is null or r.status not in ('quotation','analysis') then raise exception 'O mapa de concorrência não está aberto.'; end if;
  if coalesce(p_total_price,0)<=0 then raise exception 'Informe o valor total da proposta.'; end if;
  select coalesce(nullif(trim(trade_name),''),legal_name) into supplier_snapshot from public.suppliers where id=p_supplier_id and company_id=p_company_id and status='active';
  if supplier_snapshot is null then raise exception 'Selecione um fornecedor ativo.'; end if;
  insert into public.execution_service_request_proposals(
    company_id,project_id,request_id,supplier_id,supplier_name,proposal_number,proposal_date,validity_date,total_price,duration_days,payment_terms,
    warranty_months,technical_score,commercial_score,is_qualified,notes,created_by,updated_by
  ) values(
    p_company_id,p_project_id,r.id,p_supplier_id,supplier_snapshot,nullif(trim(coalesce(p_proposal_number,'')),''),p_proposal_date,p_validity_date,p_total_price,
    nullif(greatest(coalesce(p_duration_days,0),0),0),nullif(trim(coalesce(p_payment_terms,'')),''),greatest(coalesce(p_warranty_months,0),0),
    least(100,greatest(coalesce(p_technical_score,0),0)),least(100,greatest(coalesce(p_commercial_score,0),0)),coalesce(p_is_qualified,true),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()
  ) on conflict(request_id,supplier_id) do update set
    supplier_name=excluded.supplier_name,proposal_number=excluded.proposal_number,proposal_date=excluded.proposal_date,validity_date=excluded.validity_date,
    total_price=excluded.total_price,duration_days=excluded.duration_days,payment_terms=excluded.payment_terms,warranty_months=excluded.warranty_months,
    technical_score=excluded.technical_score,commercial_score=excluded.commercial_score,is_qualified=excluded.is_qualified,notes=excluded.notes,updated_by=auth.uid(),updated_at=now()
  returning id into proposal_id;
  update public.execution_service_requests set status='analysis',updated_by=auth.uid(),updated_at=now() where id=r.id and status='quotation';
  insert into public.execution_service_request_audit(company_id,project_id,request_id,action,previous_status,new_status,details,changed_by)
  values(p_company_id,p_project_id,r.id,'proposal_saved',r.status,'analysis',jsonb_build_object('proposal_id',proposal_id,'supplier_id',p_supplier_id,'total_price',p_total_price),auth.uid());
  return proposal_id;
end; $$;

create or replace function public.approve_execution_service_competition(
  p_company_id uuid,p_project_id uuid,p_request_id uuid,p_proposal_id uuid,p_justification text
) returns text language plpgsql security definer set search_path=public as $$
declare r public.execution_service_requests%rowtype; p public.execution_service_request_proposals%rowtype; proposal_count integer; begin
  if not public.has_company_permission(p_company_id,'execution.contracts.approve') then raise exception 'Sem permissão para aprovar o mapa de concorrência.'; end if;
  select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
  if r.id is null or r.status not in ('quotation','analysis') then raise exception 'O mapa não está disponível para aprovação.'; end if;
  select * into p from public.execution_service_request_proposals where id=p_proposal_id and request_id=r.id and company_id=p_company_id and project_id=p_project_id;
  if p.id is null then raise exception 'Proposta não encontrada no mapa.'; end if;
  if not p.is_qualified then raise exception 'A proposta selecionada está desclassificada tecnicamente.'; end if;
  select count(*) into proposal_count from public.execution_service_request_proposals where request_id=r.id;
  if proposal_count<2 and nullif(trim(coalesce(p_justification,'')),'') is null then raise exception 'Com apenas uma proposta, informe a justificativa da contratação.'; end if;
  update public.execution_service_request_proposals set is_selected=(id=p.id),updated_by=auth.uid(),updated_at=now() where request_id=r.id;
  update public.execution_service_requests set
    status='approved',selected_supplier_id=p.supplier_id,selected_proposal_id=p.id,approved_total=p.total_price,
    approval_justification=nullif(trim(coalesce(p_justification,'')),''),approved_by=auth.uid(),approved_at=now(),updated_by=auth.uid(),updated_at=now()
  where id=r.id;
  insert into public.execution_service_request_audit(company_id,project_id,request_id,action,previous_status,new_status,reason,details,changed_by)
  values(p_company_id,p_project_id,r.id,'competition_approved',r.status,'approved',nullif(trim(coalesce(p_justification,'')),''),jsonb_build_object('proposal_id',p.id,'supplier_id',p.supplier_id,'approved_total',p.total_price,'proposal_count',proposal_count),auth.uid());
  return 'approved';
end; $$;

create or replace function public.create_execution_service_contract_from_request(
  p_company_id uuid,p_project_id uuid,p_request_id uuid,p_start_date date,p_end_date date,p_retention_percent numeric,p_guarantee_percent numeric,
  p_payment_days integer,p_adjustment_index text,p_stages jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  r public.execution_service_requests%rowtype; p public.execution_service_request_proposals%rowtype; stage jsonb; contract_id uuid; contract_seq integer;
  stage_name text; stage_weight numeric; total_weight numeric:=0; stage_count integer; stage_index integer:=0; stage_total numeric; remaining_total numeric;
  stage_unit_price numeric; contract_item_id uuid; location_snapshot text; responsible text;
begin
  if not public.has_company_permission(p_company_id,'execution.contracts.manage') then raise exception 'Sem permissão para formular o contrato.'; end if;
  select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
  if r.id is null or r.status<>'approved' then raise exception 'A solicitação precisa ter o mapa aprovado antes da formulação do contrato.'; end if;
  if r.contract_id is not null then return r.contract_id; end if;
  select * into p from public.execution_service_request_proposals where id=r.selected_proposal_id and request_id=r.id;
  if p.id is null then raise exception 'A proposta aprovada não foi encontrada.'; end if;
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Revise a vigência do contrato.'; end if;
  if jsonb_typeof(p_stages)<>'array' or jsonb_array_length(p_stages)=0 then raise exception 'Inclua pelo menos uma etapa de medição.'; end if;
  stage_count:=jsonb_array_length(p_stages);
  for stage in select value from jsonb_array_elements(p_stages) loop
    stage_name:=nullif(trim(coalesce(stage->>'name','')),'');
    stage_weight:=coalesce(nullif(stage->>'weight_percent','')::numeric,0);
    if stage_name is null then raise exception 'Todas as etapas precisam de nome.'; end if;
    if stage_weight<=0 then raise exception 'O peso da etapa % deve ser maior que zero.',stage_name; end if;
    total_weight:=total_weight+stage_weight;
  end loop;
  if abs(total_weight-100)>0.01 then raise exception 'A soma dos pesos das etapas deve ser 100%%. Soma atual: %%%.',round(total_weight,2); end if;
  if exists(select 1 from jsonb_array_elements(p_stages) a, jsonb_array_elements(p_stages) b where a.value<>b.value and lower(trim(a.value->>'name'))=lower(trim(b.value->>'name'))) then raise exception 'Não repita nomes de etapas.'; end if;

  select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into responsible from public.profiles pr where pr.id=auth.uid();
  responsible:=coalesce(responsible,nullif(auth.jwt()->>'email',''),'Usuário');
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contracts'));
  select coalesce(max(sequence_no),0)+1 into contract_seq from public.execution_service_contracts where project_id=p_project_id;
  insert into public.execution_service_contracts(
    company_id,project_id,supplier_id,budget_id,service_request_id,sequence_no,contract_number,title,scope_summary,status,start_date,end_date,
    retention_percent,guarantee_percent,guarantee_months,payment_days,adjustment_index,contact_name,contact_phone,contact_email,notes,
    responsible_user_id,responsible_name,created_by,updated_by
  ) values(
    p_company_id,p_project_id,p.supplier_id,r.budget_id,r.id,contract_seq,'CT-'||lpad(contract_seq::text,4,'0'),r.title,r.scope_summary,'draft',p_start_date,p_end_date,
    least(100,greatest(coalesce(p_retention_percent,0),0)),least(100,greatest(coalesce(p_guarantee_percent,0),0)),p.warranty_months,
    greatest(coalesce(p_payment_days,15),0),nullif(trim(coalesce(p_adjustment_index,'')),''),null,null,null,
    concat_ws(E'\n',r.notes,'Origem: '||r.request_number||' · Mapa aprovado. Condição de pagamento: '||coalesce(p.payment_terms,'não informada')),
    auth.uid(),responsible,auth.uid(),auth.uid()
  ) returning id into contract_id;

  delete from public.execution_service_request_stages where request_id=r.id;
  remaining_total:=p.total_price;
  for stage in select value from jsonb_array_elements(p_stages) loop
    stage_index:=stage_index+1;
    stage_name:=trim(stage->>'name');
    stage_weight:=(stage->>'weight_percent')::numeric;
    if stage_index=stage_count then stage_total:=remaining_total; else stage_total:=round(p.total_price*stage_weight/100,2); remaining_total:=remaining_total-stage_total; end if;
    stage_unit_price:=round(stage_total/r.requested_quantity,6);
    insert into public.execution_service_contract_items(
      company_id,project_id,contract_id,service_id,location_id,schedule_activity_id,service_code,service_name,location_name,unit_snapshot,
      contracted_quantity,unit_price,total_value,planned_start,planned_finish,scope_notes,sort_order,source_service_request_id,
      measurement_group_name,measurement_stage_name,measurement_stage_weight
    ) values(
      p_company_id,p_project_id,contract_id,r.service_id,r.location_id,r.schedule_activity_id,r.service_code,r.service_name||' · '||stage_name,r.location_name,r.unit_snapshot,
      r.requested_quantity,stage_unit_price,stage_total,r.desired_start,r.desired_finish,'Etapa de medição: '||stage_name||' · peso '||trim(to_char(stage_weight,'FM999990D00'))||'%',stage_index,r.id,
      r.service_name,stage_name,stage_weight
    ) returning id into contract_item_id;
    insert into public.execution_service_request_stages(
      company_id,project_id,request_id,contract_id,contract_item_id,stage_name,weight_percent,contracted_quantity,unit_price,total_value,sort_order,created_by
    ) values(p_company_id,p_project_id,r.id,contract_id,contract_item_id,stage_name,stage_weight,r.requested_quantity,stage_unit_price,stage_total,stage_index,auth.uid());
  end loop;
  perform public.refresh_execution_service_contract_value(contract_id);
  update public.execution_service_requests set status='contracted',contract_id=contract_id,updated_by=auth.uid(),updated_at=now() where id=r.id;
  insert into public.execution_service_request_audit(company_id,project_id,request_id,action,previous_status,new_status,details,changed_by)
  values(p_company_id,p_project_id,r.id,'contract_created','approved','contracted',jsonb_build_object('contract_id',contract_id,'stages',stage_count,'contract_value',p.total_price),auth.uid());
  return contract_id;
end; $$;

grant select,insert,update,delete on public.execution_service_requests,public.execution_service_request_proposals,public.execution_service_request_stages,public.execution_service_request_audit to authenticated;
grant execute on function public.save_execution_service_request(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,date,date,text) to authenticated;
grant execute on function public.open_execution_service_competition(uuid,uuid,uuid) to authenticated;
grant execute on function public.save_execution_service_proposal(uuid,uuid,uuid,uuid,text,date,date,numeric,integer,text,integer,numeric,numeric,boolean,text) to authenticated;
grant execute on function public.approve_execution_service_competition(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.create_execution_service_contract_from_request(uuid,uuid,uuid,date,date,numeric,numeric,integer,text,jsonb) to authenticated;

commit;