-- Elos OS — V0.70.0 · Contratações de Serviços e Medições por Etapas
-- Solicitação → concorrência → aprovação → contrato → etapas mensuráveis.

begin;

insert into public.permissions(key,module,action,description) values
 ('execution.contract_procurement.view','execution_contract_procurement','view','Visualizar solicitações, concorrências e etapas contratuais'),
 ('execution.contract_procurement.manage','execution_contract_procurement','manage','Criar solicitações, mapas e propostas de serviços'),
 ('execution.contract_procurement.approve','execution_contract_procurement','approve','Aprovar solicitações e mapas de concorrência'),
 ('execution.contract_procurement.contract','execution_contract_procurement','contract','Gerar contratos e configurar etapas de medição')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values
 ('execution.contract_procurement.view'),('execution.contract_procurement.manage'),('execution.contract_procurement.approve'),('execution.contract_procurement.contract'))p(permission_key)
where r.key in('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values
 ('execution.contract_procurement.view'),('execution.contract_procurement.manage'),('execution.contract_procurement.approve'),('execution.contract_procurement.contract'))p(permission_key)
where r.key='engineering'
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'execution.contract_procurement.view',true from public.roles r
where r.key in('field','procurement','finance','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

create table if not exists public.execution_service_requests (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 budget_id uuid references public.engineering_budgets(id) on delete restrict,
 sequence_no integer not null,
 request_number text not null,
 title text not null,
 scope_summary text not null,
 status text not null default 'draft' check(status in('draft','submitted','approved','competition','contracted','cancelled')),
 needed_start date,
 needed_finish date,
 requester_user_id uuid references auth.users(id),
 requester_name text,
 notes text,
 submitted_by uuid references auth.users(id),
 submitted_at timestamptz,
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 approval_notes text,
 cancelled_by uuid references auth.users(id),
 cancelled_at timestamptz,
 cancellation_reason text,
 created_by uuid not null references auth.users(id),
 updated_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(project_id,sequence_no),
 unique(project_id,request_number),
 constraint execution_service_request_dates_check check(needed_finish is null or needed_start is null or needed_finish>=needed_start),
 constraint execution_service_request_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.execution_service_request_items (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 request_id uuid not null references public.execution_service_requests(id) on delete cascade,
 service_id uuid not null references public.engineering_services(id) on delete restrict,
 location_id uuid references public.engineering_takeoff_locations(id) on delete restrict,
 schedule_activity_id uuid references public.engineering_schedule_activities(id) on delete set null,
 service_code text not null,
 service_name text not null,
 location_name text,
 unit_snapshot text not null,
 requested_quantity numeric(18,6) not null,
 estimated_unit_price numeric(18,6) not null default 0,
 estimated_total numeric(18,2) not null default 0,
 scope_notes text,
 measurement_notes text,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint execution_service_request_item_values_check check(requested_quantity>0 and estimated_unit_price>=0 and estimated_total>=0)
);

create table if not exists public.execution_service_competitions (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 request_id uuid not null references public.execution_service_requests(id) on delete restrict,
 sequence_no integer not null,
 competition_number text not null,
 title text not null,
 status text not null default 'collecting' check(status in('collecting','analysis','approved','cancelled')),
 response_deadline date,
 award_criteria text not null default 'Melhor combinação de preço, prazo, capacidade técnica e condições comerciais',
 notes text,
 winner_offer_id uuid,
 winner_supplier_id uuid references public.suppliers(id) on delete restrict,
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 approval_notes text,
 generated_contract_id uuid references public.execution_service_contracts(id) on delete set null,
 cancelled_by uuid references auth.users(id),
 cancelled_at timestamptz,
 cancellation_reason text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(project_id,sequence_no),
 unique(project_id,competition_number),
 unique(request_id),
 constraint execution_service_competition_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.execution_service_competition_offers (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 competition_id uuid not null references public.execution_service_competitions(id) on delete cascade,
 supplier_id uuid not null references public.suppliers(id) on delete restrict,
 status text not null default 'responded' check(status in('invited','responded','disqualified','winner')),
 proposal_number text,
 proposal_date date,
 validity_date date,
 payment_days integer not null default 15 check(payment_days between 0 and 365),
 proposed_start date,
 proposed_finish date,
 total_amount numeric(18,2) not null default 0,
 technical_score numeric(8,2),
 commercial_score numeric(8,2),
 notes text,
 received_by uuid references auth.users(id),
 received_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(competition_id,supplier_id),
 constraint execution_service_offer_dates_check check(proposed_finish is null or proposed_start is null or proposed_finish>=proposed_start),
 constraint execution_service_offer_values_check check(total_amount>=0 and (technical_score is null or technical_score between 0 and 100) and (commercial_score is null or commercial_score between 0 and 100))
);

create table if not exists public.execution_service_competition_offer_items (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 offer_id uuid not null references public.execution_service_competition_offers(id) on delete cascade,
 request_item_id uuid not null references public.execution_service_request_items(id) on delete restrict,
 offered_quantity numeric(18,6) not null,
 unit_price numeric(18,6) not null,
 total_amount numeric(18,2) not null,
 meets_specification boolean not null default true,
 notes text,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(offer_id,request_item_id),
 constraint execution_service_offer_item_values_check check(offered_quantity>0 and unit_price>=0 and total_amount>=0)
);

alter table public.execution_service_competitions
 drop constraint if exists execution_service_competitions_winner_offer_id_fkey;
alter table public.execution_service_competitions
 add constraint execution_service_competitions_winner_offer_id_fkey foreign key(winner_offer_id) references public.execution_service_competition_offers(id) on delete restrict;

alter table public.execution_service_contracts add column if not exists source_request_id uuid references public.execution_service_requests(id) on delete restrict;
alter table public.execution_service_contracts add column if not exists source_competition_id uuid references public.execution_service_competitions(id) on delete restrict;
create unique index if not exists execution_service_contracts_competition_unique on public.execution_service_contracts(source_competition_id) where source_competition_id is not null;

create table if not exists public.execution_service_contract_stages (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 contract_id uuid not null references public.execution_service_contracts(id) on delete cascade,
 contract_item_id uuid not null references public.execution_service_contract_items(id) on delete cascade,
 service_id uuid not null references public.engineering_services(id) on delete restrict,
 location_id uuid references public.engineering_takeoff_locations(id) on delete restrict,
 stage_code text not null,
 stage_name text not null,
 description text,
 measurement_mode text not null default 'quantity' check(measurement_mode in('quantity','percent')),
 weight_percent numeric(9,4) not null check(weight_percent>0 and weight_percent<=100),
 unit_snapshot text not null,
 contracted_quantity numeric(18,6) not null,
 unit_price numeric(18,6) not null,
 total_value numeric(18,2) not null,
 opening_measured_quantity numeric(18,6) not null default 0,
 opening_measured_value numeric(18,2) not null default 0,
 measured_quantity numeric(18,6) not null default 0,
 measured_value numeric(18,2) not null default 0,
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(contract_item_id,stage_code),
 constraint execution_service_contract_stage_values_check check(
  contracted_quantity>0 and unit_price>=0 and total_value>=0 and opening_measured_quantity>=0 and opening_measured_value>=0 and measured_quantity>=0 and measured_value>=0
 )
);

alter table public.execution_contract_measurement_items add column if not exists contract_stage_id uuid references public.execution_service_contract_stages(id) on delete restrict;
alter table public.execution_contract_measurement_items drop constraint if exists execution_contract_measurement_items_measurement_id_contract_item_id_key;
create unique index if not exists execution_contract_measurement_items_legacy_unique
 on public.execution_contract_measurement_items(measurement_id,contract_item_id) where contract_stage_id is null;
create unique index if not exists execution_contract_measurement_items_stage_unique
 on public.execution_contract_measurement_items(measurement_id,contract_stage_id) where contract_stage_id is not null;
create index if not exists execution_contract_measurement_items_stage_idx on public.execution_contract_measurement_items(contract_stage_id);

create index if not exists execution_service_requests_project_idx on public.execution_service_requests(project_id,status,created_at desc);
create index if not exists execution_service_request_items_request_idx on public.execution_service_request_items(request_id,sort_order);
create index if not exists execution_service_competitions_project_idx on public.execution_service_competitions(project_id,status,created_at desc);
create index if not exists execution_service_offers_competition_idx on public.execution_service_competition_offers(competition_id,status,total_amount);
create index if not exists execution_service_offer_items_offer_idx on public.execution_service_competition_offer_items(offer_id,sort_order);
create index if not exists execution_service_contract_stages_contract_idx on public.execution_service_contract_stages(contract_id,contract_item_id,sort_order);

alter table public.execution_service_requests enable row level security;
alter table public.execution_service_request_items enable row level security;
alter table public.execution_service_competitions enable row level security;
alter table public.execution_service_competition_offers enable row level security;
alter table public.execution_service_competition_offer_items enable row level security;
alter table public.execution_service_contract_stages enable row level security;

do $$ declare t text; begin
 foreach t in array array['execution_service_requests','execution_service_request_items','execution_service_competitions','execution_service_competition_offers','execution_service_competition_offer_items','execution_service_contract_stages'] loop
  execute format('drop policy if exists %I_select on public.%I',t,t);
  execute format('create policy %I_select on public.%I for select to authenticated using(public.has_company_permission(company_id,''execution.contract_procurement.view'') or public.has_company_permission(company_id,''execution.contracts.view'') or public.has_company_permission(company_id,''execution.measurements.view''))',t,t);
  execute format('drop policy if exists %I_write on public.%I',t,t);
  execute format('create policy %I_write on public.%I for all to authenticated using(public.has_company_permission(company_id,''execution.contract_procurement.manage'') or public.has_company_permission(company_id,''execution.contract_procurement.approve'') or public.has_company_permission(company_id,''execution.contract_procurement.contract'')) with check(public.has_company_permission(company_id,''execution.contract_procurement.manage'') or public.has_company_permission(company_id,''execution.contract_procurement.approve'') or public.has_company_permission(company_id,''execution.contract_procurement.contract''))',t,t);
 end loop;
end $$;

create or replace function public.save_execution_service_request(
 p_company_id uuid,p_project_id uuid,p_request_id uuid,p_budget_id uuid,p_title text,p_scope_summary text,
 p_needed_start date,p_needed_finish date,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare r public.execution_service_requests%rowtype; item jsonb; svc public.engineering_services%rowtype; activity public.engineering_schedule_activities%rowtype;
 resolved uuid; seq integer; n integer:=0; qty numeric; price numeric; loc_name text; requester text;
begin
 if not public.has_company_permission(p_company_id,'execution.contract_procurement.manage') then raise exception 'Sem permissão para criar solicitações de serviços.'; end if;
 if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_scope_summary,'')),'') is null then raise exception 'Informe título e escopo da solicitação.'; end if;
 if p_needed_finish is not null and p_needed_start is not null and p_needed_finish<p_needed_start then raise exception 'Revise o período necessário.'; end if;
 if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then raise exception 'Obra inválida.'; end if;
 if p_budget_id is not null and not exists(select 1 from public.engineering_budgets where id=p_budget_id and company_id=p_company_id and project_id=p_project_id and status='approved') then raise exception 'Orçamento inválido ou não aprovado.'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Inclua pelo menos um serviço.'; end if;
 select coalesce(nullif(trim(full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into requester from public.profiles where id=auth.uid();
 requester:=coalesce(requester,nullif(auth.jwt()->>'email',''),'Usuário');
 if p_request_id is null then
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':service-requests'));
  select coalesce(max(sequence_no),0)+1 into seq from public.execution_service_requests where project_id=p_project_id;
  insert into public.execution_service_requests(company_id,project_id,budget_id,sequence_no,request_number,title,scope_summary,needed_start,needed_finish,requester_user_id,requester_name,notes,created_by,updated_by)
  values(p_company_id,p_project_id,p_budget_id,seq,'SS-'||lpad(seq::text,4,'0'),trim(p_title),trim(p_scope_summary),p_needed_start,p_needed_finish,auth.uid(),requester,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()) returning id into resolved;
 else
  select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
  if r.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if r.status not in('draft','submitted') then raise exception 'A solicitação não pode mais ser editada.'; end if;
  resolved:=r.id;
  update public.execution_service_requests set budget_id=p_budget_id,title=trim(p_title),scope_summary=trim(p_scope_summary),needed_start=p_needed_start,needed_finish=p_needed_finish,notes=nullif(trim(coalesce(p_notes,'')),''),status='draft',submitted_by=null,submitted_at=null,updated_by=auth.uid(),updated_at=now() where id=resolved;
  delete from public.execution_service_request_items where request_id=resolved;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into svc from public.engineering_services where id=nullif(item->>'service_id','')::uuid and company_id=p_company_id and status='active';
  if svc.id is null then raise exception 'Serviço inválido na solicitação.'; end if;
  activity.id:=null;
  if nullif(item->>'schedule_activity_id','') is not null then
   select * into activity from public.engineering_schedule_activities where id=(item->>'schedule_activity_id')::uuid and company_id=p_company_id and project_id=p_project_id and record_status='active';
   if activity.id is null then raise exception 'Atividade do cronograma inválida.'; end if;
  end if;
  loc_name:=null;
  if nullif(item->>'location_id','') is not null then
   select concat_ws(' · ',code,name) into loc_name from public.engineering_takeoff_locations where id=(item->>'location_id')::uuid and company_id=p_company_id and project_id=p_project_id and status='active';
   if loc_name is null then raise exception 'Local inválido.'; end if;
  end if;
  qty:=coalesce(nullif(item->>'quantity','')::numeric,0); price:=greatest(coalesce(nullif(item->>'estimated_unit_price','')::numeric,0),0);
  if qty<=0 then raise exception 'A quantidade solicitada deve ser maior que zero.'; end if;
  n:=n+1;
  insert into public.execution_service_request_items(company_id,project_id,request_id,service_id,location_id,schedule_activity_id,service_code,service_name,location_name,unit_snapshot,requested_quantity,estimated_unit_price,estimated_total,scope_notes,measurement_notes,sort_order)
  values(p_company_id,p_project_id,resolved,svc.id,nullif(item->>'location_id','')::uuid,activity.id,svc.code,svc.description,loc_name,svc.unit,qty,price,round(qty*price,2),nullif(trim(coalesce(item->>'scope_notes','')),''),nullif(trim(coalesce(item->>'measurement_notes','')),''),n);
 end loop;
 return resolved;
end $$;

create or replace function public.change_execution_service_request_status(
 p_company_id uuid,p_project_id uuid,p_request_id uuid,p_action text,p_notes text
) returns text language plpgsql security definer set search_path=public as $$
declare r public.execution_service_requests%rowtype; next_status text;
begin
 select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
 if r.id is null then raise exception 'Solicitação não encontrada.'; end if;
 if p_action='submit' then
  if not public.has_company_permission(p_company_id,'execution.contract_procurement.manage') or r.status<>'draft' then raise exception 'Solicitação não disponível para envio.'; end if;
  if not exists(select 1 from public.execution_service_request_items where request_id=r.id) then raise exception 'Inclua serviços antes de enviar.'; end if;
  next_status:='submitted'; update public.execution_service_requests set status=next_status,submitted_by=auth.uid(),submitted_at=now(),updated_by=auth.uid(),updated_at=now() where id=r.id;
 elsif p_action='approve' then
  if not public.has_company_permission(p_company_id,'execution.contract_procurement.approve') or r.status<>'submitted' then raise exception 'Solicitação não disponível para aprovação.'; end if;
  next_status:='approved'; update public.execution_service_requests set status=next_status,approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=r.id;
 elsif p_action='cancel' then
  if not public.has_company_permission(p_company_id,'execution.contract_procurement.approve') then raise exception 'Sem permissão para cancelar.'; end if;
  if r.status in('competition','contracted') then raise exception 'A solicitação já possui concorrência ou contrato.'; end if;
  if nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  next_status:='cancelled'; update public.execution_service_requests set status=next_status,cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_notes),updated_by=auth.uid(),updated_at=now() where id=r.id;
 else raise exception 'Ação inválida.'; end if;
 return next_status;
end $$;

create or replace function public.start_execution_service_competition(
 p_company_id uuid,p_project_id uuid,p_request_id uuid,p_response_deadline date,p_award_criteria text,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare r public.execution_service_requests%rowtype; resolved uuid; seq integer;
begin
 if not public.has_company_permission(p_company_id,'execution.contract_procurement.manage') then raise exception 'Sem permissão para abrir concorrência.'; end if;
 select * into r from public.execution_service_requests where id=p_request_id and company_id=p_company_id and project_id=p_project_id for update;
 if r.id is null or r.status<>'approved' then raise exception 'A solicitação precisa estar aprovada.'; end if;
 if exists(select 1 from public.execution_service_competitions where request_id=r.id) then select id into resolved from public.execution_service_competitions where request_id=r.id; return resolved; end if;
 perform pg_advisory_xact_lock(hashtext(p_project_id::text||':service-competitions'));
 select coalesce(max(sequence_no),0)+1 into seq from public.execution_service_competitions where project_id=p_project_id;
 insert into public.execution_service_competitions(company_id,project_id,request_id,sequence_no,competition_number,title,response_deadline,award_criteria,notes,created_by)
 values(p_company_id,p_project_id,r.id,seq,'MC-'||lpad(seq::text,4,'0'),'Mapa · '||r.title,p_response_deadline,coalesce(nullif(trim(p_award_criteria),''),'Melhor combinação de preço, prazo, capacidade técnica e condições comerciais'),nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into resolved;
 update public.execution_service_requests set status='competition',updated_by=auth.uid(),updated_at=now() where id=r.id;
 return resolved;
end $$;

create or replace function public.save_execution_service_competition_offer(
 p_company_id uuid,p_project_id uuid,p_competition_id uuid,p_offer_id uuid,p_supplier_id uuid,p_proposal_number text,p_proposal_date date,p_validity_date date,
 p_payment_days integer,p_proposed_start date,p_proposed_finish date,p_technical_score numeric,p_commercial_score numeric,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.execution_service_competitions%rowtype; offer public.execution_service_competition_offers%rowtype; item jsonb; req_item public.execution_service_request_items%rowtype;
 resolved uuid; n integer:=0; qty numeric; price numeric; total numeric:=0;
begin
 if not public.has_company_permission(p_company_id,'execution.contract_procurement.manage') then raise exception 'Sem permissão para registrar propostas.'; end if;
 select * into c from public.execution_service_competitions where id=p_competition_id and company_id=p_company_id and project_id=p_project_id for update;
 if c.id is null or c.status not in('collecting','analysis') then raise exception 'Mapa não disponível para propostas.'; end if;
 if not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id and status='active') then raise exception 'Fornecedor inválido.'; end if;
 if p_proposed_finish is not null and p_proposed_start is not null and p_proposed_finish<p_proposed_start then raise exception 'Revise o prazo proposto.'; end if;
 if jsonb_typeof(p_items)<>'array' then raise exception 'Itens da proposta inválidos.'; end if;
 if p_offer_id is null then
  insert into public.execution_service_competition_offers(company_id,project_id,competition_id,supplier_id,status,proposal_number,proposal_date,validity_date,payment_days,proposed_start,proposed_finish,technical_score,commercial_score,notes,received_by)
  values(p_company_id,p_project_id,c.id,p_supplier_id,'responded',nullif(trim(coalesce(p_proposal_number,'')),''),p_proposal_date,p_validity_date,coalesce(p_payment_days,15),p_proposed_start,p_proposed_finish,p_technical_score,p_commercial_score,nullif(trim(coalesce(p_notes,'')),''),auth.uid()) returning id into resolved;
 else
  select * into offer from public.execution_service_competition_offers where id=p_offer_id and competition_id=c.id and company_id=p_company_id and project_id=p_project_id for update;
  if offer.id is null or offer.status in('winner','disqualified') then raise exception 'Proposta não disponível para edição.'; end if;
  resolved:=offer.id;
  update public.execution_service_competition_offers set supplier_id=p_supplier_id,status='responded',proposal_number=nullif(trim(coalesce(p_proposal_number,'')),''),proposal_date=p_proposal_date,validity_date=p_validity_date,payment_days=coalesce(p_payment_days,15),proposed_start=p_proposed_start,proposed_finish=p_proposed_finish,technical_score=p_technical_score,commercial_score=p_commercial_score,notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now() where id=resolved;
  delete from public.execution_service_competition_offer_items where offer_id=resolved;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into req_item from public.execution_service_request_items where id=nullif(item->>'request_item_id','')::uuid and request_id=c.request_id and company_id=p_company_id and project_id=p_project_id;
  if req_item.id is null then raise exception 'Item da solicitação inválido.'; end if;
  qty:=coalesce(nullif(item->>'quantity','')::numeric,req_item.requested_quantity); price:=greatest(coalesce(nullif(item->>'unit_price','')::numeric,0),0);
  if qty<=0 then raise exception 'Quantidade inválida na proposta.'; end if;
  n:=n+1; total:=total+round(qty*price,2);
  insert into public.execution_service_competition_offer_items(company_id,project_id,offer_id,request_item_id,offered_quantity,unit_price,total_amount,meets_specification,notes,sort_order)
  values(p_company_id,p_project_id,resolved,req_item.id,qty,price,round(qty*price,2),coalesce((item->>'meets_specification')::boolean,true),nullif(trim(coalesce(item->>'notes','')),''),n);
 end loop;
 if n<>(select count(*) from public.execution_service_request_items where request_id=c.request_id) then raise exception 'A proposta precisa conter todos os itens da solicitação.'; end if;
 update public.execution_service_competition_offers set total_amount=round(total,2),updated_at=now() where id=resolved;
 update public.execution_service_competitions set status='analysis',updated_at=now() where id=c.id;
 return resolved;
end $$;

create or replace function public.approve_execution_service_competition(
 p_company_id uuid,p_project_id uuid,p_competition_id uuid,p_winner_offer_id uuid,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.execution_service_competitions%rowtype; offer public.execution_service_competition_offers%rowtype; expected integer; actual integer;
begin
 if not public.has_company_permission(p_company_id,'execution.contract_procurement.approve') then raise exception 'Sem permissão para aprovar o mapa.'; end if;
 select * into c from public.execution_service_competitions where id=p_competition_id and company_id=p_company_id and project_id=p_project_id for update;
 if c.id is null or c.status not in('collecting','analysis') then raise exception 'Mapa não disponível para aprovação.'; end if;
 select * into offer from public.execution_service_competition_offers where id=p_winner_offer_id and competition_id=c.id and status='responded' for update;
 if offer.id is null then raise exception 'Selecione uma proposta válida.'; end if;
 select count(*) into expected from public.execution_service_request_items where request_id=c.request_id;
 select count(*) into actual from public.execution_service_competition_offer_items where offer_id=offer.id and meets_specification=true;
 if actual<>expected then raise exception 'A proposta vencedora precisa atender tecnicamente todos os itens.'; end if;
 update public.execution_service_competition_offers set status=case when id=offer.id then 'winner' else status end,updated_at=now() where competition_id=c.id;
 update public.execution_service_competitions set status='approved',winner_offer_id=offer.id,winner_supplier_id=offer.supplier_id,approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now() where id=c.id;
 return offer.id;
end $$;

create or replace function public.generate_execution_service_contract_from_competition(
 p_company_id uuid,p_project_id uuid,p_competition_id uuid,p_title text,p_scope_summary text,p_start_date date,p_end_date date,p_signed_date date,
 p_retention_percent numeric,p_guarantee_percent numeric,p_guarantee_months integer,p_payment_days integer,p_adjustment_index text,p_adjustment_base_date date,
 p_contact_name text,p_contact_phone text,p_contact_email text,p_notes text,p_stages jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.execution_service_competitions%rowtype; r public.execution_service_requests%rowtype; offer public.execution_service_competition_offers%rowtype;
 oi record; resolved uuid; contract_item uuid; seq integer; item_stages jsonb; stage jsonb; stage_count integer; stage_index integer; weight_sum numeric; allocated numeric; stage_total numeric; stage_qty numeric; stage_unit text; stage_price numeric; mode text; responsible text;
begin
 if not public.has_company_permission(p_company_id,'execution.contract_procurement.contract') then raise exception 'Sem permissão para gerar contratos.'; end if;
 select * into c from public.execution_service_competitions where id=p_competition_id and company_id=p_company_id and project_id=p_project_id for update;
 if c.id is null or c.status<>'approved' or c.winner_offer_id is null then raise exception 'O mapa precisa estar aprovado com fornecedor vencedor.'; end if;
 if c.generated_contract_id is not null then return c.generated_contract_id; end if;
 select * into r from public.execution_service_requests where id=c.request_id for update;
 select * into offer from public.execution_service_competition_offers where id=c.winner_offer_id and status='winner';
 if r.id is null or offer.id is null then raise exception 'Origem da contratação não encontrada.'; end if;
 if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_scope_summary,'')),'') is null then raise exception 'Informe título e escopo do contrato.'; end if;
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Revise a vigência do contrato.'; end if;
 if jsonb_typeof(p_stages)<>'array' then raise exception 'Etapas de medição inválidas.'; end if;
 perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contracts'));
 select coalesce(max(sequence_no),0)+1 into seq from public.execution_service_contracts where project_id=p_project_id;
 select coalesce(nullif(trim(full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into responsible from public.profiles where id=auth.uid();
 responsible:=coalesce(responsible,nullif(auth.jwt()->>'email',''),'Usuário');
 insert into public.execution_service_contracts(company_id,project_id,supplier_id,budget_id,source_request_id,source_competition_id,sequence_no,contract_number,title,scope_summary,status,signed_date,start_date,end_date,retention_percent,guarantee_percent,guarantee_months,payment_days,adjustment_index,adjustment_base_date,contact_name,contact_phone,contact_email,notes,responsible_user_id,responsible_name,created_by,updated_by)
 values(p_company_id,p_project_id,offer.supplier_id,r.budget_id,r.id,c.id,seq,'CT-'||lpad(seq::text,4,'0'),trim(p_title),trim(p_scope_summary),'draft',p_signed_date,p_start_date,p_end_date,coalesce(p_retention_percent,0),coalesce(p_guarantee_percent,0),coalesce(p_guarantee_months,0),coalesce(p_payment_days,offer.payment_days),nullif(trim(coalesce(p_adjustment_index,'')),''),p_adjustment_base_date,nullif(trim(coalesce(p_contact_name,'')),''),nullif(trim(coalesce(p_contact_phone,'')),''),nullif(trim(coalesce(p_contact_email,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),responsible,auth.uid(),auth.uid()) returning id into resolved;
 for oi in
  select ri.*,ofi.offered_quantity,ofi.unit_price,ofi.total_amount from public.execution_service_request_items ri
  join public.execution_service_competition_offer_items ofi on ofi.request_item_id=ri.id and ofi.offer_id=offer.id
  where ri.request_id=r.id order by ri.sort_order
 loop
  insert into public.execution_service_contract_items(company_id,project_id,contract_id,service_id,location_id,schedule_activity_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,unit_price,total_value,planned_start,planned_finish,scope_notes,sort_order)
  values(p_company_id,p_project_id,resolved,oi.service_id,oi.location_id,oi.schedule_activity_id,oi.service_code,oi.service_name,oi.location_name,oi.unit_snapshot,oi.offered_quantity,oi.unit_price,oi.total_amount,p_start_date,p_end_date,concat_ws(E'\n',oi.scope_notes,oi.measurement_notes),oi.sort_order) returning id into contract_item;
  select value->'stages' into item_stages from jsonb_array_elements(p_stages) where value->>'request_item_id'=oi.id::text limit 1;
  if item_stages is null or jsonb_typeof(item_stages)<>'array' or jsonb_array_length(item_stages)=0 then raise exception 'Defina as etapas de medição para %.',oi.service_name; end if;
  select coalesce(sum((value->>'weight_percent')::numeric),0) into weight_sum from jsonb_array_elements(item_stages);
  if abs(weight_sum-100)>.001 then raise exception 'As etapas de % devem totalizar 100%%. Total informado: %%%.',oi.service_name,weight_sum; end if;
  allocated:=0; stage_count:=jsonb_array_length(item_stages); stage_index:=0;
  for stage in select value from jsonb_array_elements(item_stages) loop
   stage_index:=stage_index+1; mode:=coalesce(nullif(stage->>'measurement_mode',''),'quantity');
   if mode not in('quantity','percent') then raise exception 'Modo de medição inválido.'; end if;
   if stage_index=stage_count then stage_total:=round(oi.total_amount-allocated,2); else stage_total:=round(oi.total_amount*((stage->>'weight_percent')::numeric)/100,2); allocated:=allocated+stage_total; end if;
   if mode='percent' then stage_qty:=100; stage_unit:='%'; stage_price:=stage_total/100; else stage_qty:=oi.offered_quantity; stage_unit:=oi.unit_snapshot; stage_price:=case when oi.offered_quantity>0 then stage_total/oi.offered_quantity else 0 end; end if;
   insert into public.execution_service_contract_stages(company_id,project_id,contract_id,contract_item_id,service_id,location_id,stage_code,stage_name,description,measurement_mode,weight_percent,unit_snapshot,contracted_quantity,unit_price,total_value,sort_order)
   values(p_company_id,p_project_id,resolved,contract_item,oi.service_id,oi.location_id,coalesce(nullif(trim(stage->>'code'),''),'ET-'||lpad(stage_index::text,2,'0')),trim(stage->>'name'),nullif(trim(coalesce(stage->>'description','')),''),mode,(stage->>'weight_percent')::numeric,stage_unit,stage_qty,stage_price,stage_total,stage_index);
  end loop;
 end loop;
 perform public.refresh_execution_service_contract_value(resolved);
 update public.execution_service_competitions set generated_contract_id=resolved,updated_at=now() where id=c.id;
 update public.execution_service_requests set status='contracted',updated_by=auth.uid(),updated_at=now() where id=r.id;
 return resolved;
end $$;

create or replace function public.save_execution_service_contract_stages(
 p_company_id uuid,p_project_id uuid,p_contract_id uuid,p_stages jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare c public.execution_service_contracts%rowtype; ci public.execution_service_contract_items%rowtype; item_block jsonb; stage jsonb; stage_count integer; stage_index integer; weight_sum numeric; allocated numeric; stage_total numeric; stage_qty numeric; stage_unit text; stage_price numeric; mode text;
begin
 if not public.has_company_permission(p_company_id,'execution.contract_procurement.contract') then raise exception 'Sem permissão para alterar etapas.'; end if;
 select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id for update;
 if c.id is null or c.status<>'draft' then raise exception 'Somente contratos em elaboração permitem alterar etapas.'; end if;
 if exists(select 1 from public.execution_contract_measurements where contract_id=c.id and status<>'cancelled') then raise exception 'O contrato já possui medições.'; end if;
 if jsonb_typeof(p_stages)<>'array' then raise exception 'Etapas inválidas.'; end if;
 for ci in select * from public.execution_service_contract_items where contract_id=c.id order by sort_order loop
  select value into item_block from jsonb_array_elements(p_stages) where value->>'contract_item_id'=ci.id::text limit 1;
  if item_block is null or jsonb_typeof(item_block->'stages')<>'array' or jsonb_array_length(item_block->'stages')=0 then raise exception 'Defina etapas para %.',ci.service_name; end if;
  select coalesce(sum((value->>'weight_percent')::numeric),0) into weight_sum from jsonb_array_elements(item_block->'stages');
  if abs(weight_sum-100)>.001 then raise exception 'As etapas de % devem totalizar 100%%.',ci.service_name; end if;
  delete from public.execution_service_contract_stages where contract_item_id=ci.id;
  allocated:=0; stage_count:=jsonb_array_length(item_block->'stages'); stage_index:=0;
  for stage in select value from jsonb_array_elements(item_block->'stages') loop
   stage_index:=stage_index+1; mode:=coalesce(nullif(stage->>'measurement_mode',''),'quantity');
   if stage_index=stage_count then stage_total:=round(ci.total_value-allocated,2); else stage_total:=round(ci.total_value*((stage->>'weight_percent')::numeric)/100,2); allocated:=allocated+stage_total; end if;
   if mode='percent' then stage_qty:=100; stage_unit:='%'; stage_price:=stage_total/100; else stage_qty:=ci.contracted_quantity; stage_unit:=ci.unit_snapshot; stage_price:=case when ci.contracted_quantity>0 then stage_total/ci.contracted_quantity else 0 end; end if;
   insert into public.execution_service_contract_stages(company_id,project_id,contract_id,contract_item_id,service_id,location_id,stage_code,stage_name,description,measurement_mode,weight_percent,unit_snapshot,contracted_quantity,unit_price,total_value,sort_order)
   values(p_company_id,p_project_id,c.id,ci.id,ci.service_id,ci.location_id,coalesce(nullif(trim(stage->>'code'),''),'ET-'||lpad(stage_index::text,2,'0')),trim(stage->>'name'),nullif(trim(coalesce(stage->>'description','')),''),mode,(stage->>'weight_percent')::numeric,stage_unit,stage_qty,stage_price,stage_total,stage_index);
  end loop;
 end loop;
 return c.id;
end $$;

create or replace function public.validate_execution_contract_stages_before_activation()
returns trigger language plpgsql security definer set search_path=public as $$
declare invalid_count integer;
begin
 if new.status='active' and old.status is distinct from 'active' then
  select count(*) into invalid_count from public.execution_service_contract_items ci
  where ci.contract_id=new.id and (
   not exists(select 1 from public.execution_service_contract_stages s where s.contract_item_id=ci.id)
   or abs(coalesce((select sum(s.weight_percent) from public.execution_service_contract_stages s where s.contract_item_id=ci.id),0)-100)>.001
   or abs(coalesce((select sum(s.total_value) from public.execution_service_contract_stages s where s.contract_item_id=ci.id),0)-ci.total_value)>.01
  );
  if invalid_count>0 then raise exception 'Revise as etapas: cada serviço deve possuir etapas que fechem 100%% e o valor contratado.'; end if;
 end if;
 return new;
end $$;
drop trigger if exists execution_contract_validate_stages on public.execution_service_contracts;
create trigger execution_contract_validate_stages before update of status on public.execution_service_contracts for each row execute function public.validate_execution_contract_stages_before_activation();

create or replace function public.block_direct_execution_contract_insert()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.source_competition_id is null then raise exception 'Inicie o contrato pela Solicitação de Serviços e pelo Mapa de Concorrência.'; end if;
 return new;
end $$;
drop trigger if exists execution_contract_require_competition on public.execution_service_contracts;
create trigger execution_contract_require_competition before insert on public.execution_service_contracts for each row execute function public.block_direct_execution_contract_insert();

create or replace function public.save_execution_stage_contract_measurement(
 p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_contract_id uuid,p_period_start date,p_period_end date,
 p_tax_withholding numeric,p_advance_deduction numeric,p_other_discount numeric,p_notes text,p_contractor_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare m public.execution_contract_measurements%rowtype; c public.execution_service_contracts%rowtype; s public.execution_service_contract_stages%rowtype; ci public.execution_service_contract_items%rowtype;
 item jsonb; resolved uuid; seq integer; n integer:=0; current_qty numeric; previous_qty numeric; current_amount numeric; gross numeric:=0; contractual_retention numeric; guarantee_retention numeric; deductions numeric; net numeric; requester text;
begin
 if not public.has_company_permission(p_company_id,'execution.measurements.manage') then raise exception 'Sem permissão para criar medições.'; end if;
 select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id and status in('active','suspended');
 if c.id is null then raise exception 'Selecione um contrato ativo ou suspenso.'; end if;
 if p_period_start is null or p_period_end is null or p_period_end<p_period_start or p_period_start<c.start_date or p_period_end>c.end_date then raise exception 'Revise o período da medição.'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Informe pelo menos uma etapa medida.'; end if;
 select coalesce(nullif(trim(full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into requester from public.profiles where id=auth.uid(); requester:=coalesce(requester,nullif(auth.jwt()->>'email',''),'Usuário');
 if p_measurement_id is null then
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contract-measurements'));
  select coalesce(max(sequence_no),0)+1 into seq from public.execution_contract_measurements where project_id=p_project_id;
  insert into public.execution_contract_measurements(company_id,project_id,contract_id,supplier_id,sequence_no,measurement_number,period_start,period_end,status,requester_user_id,requester_name,created_by,updated_by)
  values(p_company_id,p_project_id,c.id,c.supplier_id,seq,'MED-'||lpad(seq::text,4,'0'),p_period_start,p_period_end,'draft',auth.uid(),requester,auth.uid(),auth.uid()) returning id into resolved;
 else
  select * into m from public.execution_contract_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id for update;
  if m.id is null or m.status not in('draft','rejected') or m.contract_id<>c.id then raise exception 'Medição não disponível para edição.'; end if;
  resolved:=m.id; delete from public.execution_contract_measurement_items where measurement_id=resolved;
  update public.execution_contract_measurements set period_start=p_period_start,period_end=p_period_end,status='draft',rejection_reason=null,rejected_by=null,rejected_at=null,updated_by=auth.uid(),updated_at=now() where id=resolved;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  select * into s from public.execution_service_contract_stages where id=nullif(item->>'stage_id','')::uuid and contract_id=c.id and company_id=p_company_id and project_id=p_project_id;
  if s.id is null then raise exception 'Etapa contratual inválida.'; end if;
  select * into ci from public.execution_service_contract_items where id=s.contract_item_id;
  select s.opening_measured_quantity+coalesce(sum(mi.current_quantity),0) into previous_qty
   from public.execution_service_contract_stages sx left join public.execution_contract_measurement_items mi on mi.contract_stage_id=sx.id
   left join public.execution_contract_measurements mm on mm.id=mi.measurement_id and mm.status in('approved','invoiced','paid')
   where sx.id=s.id group by sx.opening_measured_quantity;
  current_qty:=coalesce(nullif(item->>'current_quantity','')::numeric,0);
  if current_qty<=0 or previous_qty+current_qty>s.contracted_quantity+.000001 then raise exception 'Quantidade inválida para a etapa %.',s.stage_name; end if;
  current_amount:=round(current_qty*s.unit_price,2); gross:=gross+current_amount; n:=n+1;
  insert into public.execution_contract_measurement_items(company_id,project_id,measurement_id,contract_id,contract_item_id,contract_stage_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,previous_approved_quantity,current_quantity,accumulated_quantity,unit_price,previous_approved_amount,current_amount,accumulated_amount,progress_percent,notes,sort_order)
  values(p_company_id,p_project_id,resolved,c.id,ci.id,s.id,s.service_id,s.location_id,ci.service_code||' · '||s.stage_code,ci.service_name||' · '||s.stage_name,ci.location_name,s.unit_snapshot,s.contracted_quantity,previous_qty,current_qty,previous_qty+current_qty,s.unit_price,round(previous_qty*s.unit_price,2),current_amount,round((previous_qty+current_qty)*s.unit_price,2),round(100*(previous_qty+current_qty)/s.contracted_quantity,4),nullif(trim(coalesce(item->>'notes','')),''),n);
 end loop;
 contractual_retention:=round(gross*c.retention_percent/100,2); guarantee_retention:=round(gross*c.guarantee_percent/100,2);
 deductions:=contractual_retention+guarantee_retention+greatest(coalesce(p_tax_withholding,0),0)+greatest(coalesce(p_advance_deduction,0),0)+greatest(coalesce(p_other_discount,0),0);
 if deductions>gross+.01 then raise exception 'As retenções e descontos não podem superar o valor bruto.'; end if; net:=round(gross-deductions,2);
 update public.execution_contract_measurements set gross_amount=round(gross,2),contractual_retention_percent=c.retention_percent,contractual_retention_amount=contractual_retention,guarantee_retention_percent=c.guarantee_percent,guarantee_retention_amount=guarantee_retention,tax_withholding_amount=greatest(coalesce(p_tax_withholding,0),0),advance_deduction_amount=greatest(coalesce(p_advance_deduction,0),0),other_discount_amount=greatest(coalesce(p_other_discount,0),0),total_deductions=round(deductions,2),net_amount=net,notes=nullif(trim(coalesce(p_notes,'')),''),contractor_notes=nullif(trim(coalesce(p_contractor_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=resolved;
 return resolved;
end $$;

create or replace function public.refresh_execution_service_contract_measurements(p_contract_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.execution_service_contract_stages s set
  measured_quantity=s.opening_measured_quantity+coalesce(x.quantity,0),
  measured_value=s.opening_measured_value+coalesce(x.amount,0),updated_at=now()
 from (
  select s0.id stage_id,coalesce(sum(mi.current_quantity) filter(where m.status in('approved','invoiced','paid')),0) quantity,
   coalesce(sum(mi.current_amount) filter(where m.status in('approved','invoiced','paid')),0) amount
  from public.execution_service_contract_stages s0
  left join public.execution_contract_measurement_items mi on mi.contract_stage_id=s0.id
  left join public.execution_contract_measurements m on m.id=mi.measurement_id
  where s0.contract_id=p_contract_id group by s0.id
 ) x where s.id=x.stage_id;

 update public.execution_service_contract_items ci set measured_quantity=coalesce(x.quantity,0),measured_value=coalesce(x.amount,0),updated_at=now()
 from (
  select mi.contract_item_id,sum(mi.current_quantity) quantity,sum(mi.current_amount) amount
  from public.execution_contract_measurement_items mi join public.execution_contract_measurements m on m.id=mi.measurement_id
  where mi.contract_id=p_contract_id and m.status in('approved','invoiced','paid') group by mi.contract_item_id
 ) x where ci.id=x.contract_item_id;
 update public.execution_service_contract_items ci set measured_quantity=0,measured_value=0,updated_at=now()
 where ci.contract_id=p_contract_id and not exists(select 1 from public.execution_contract_measurement_items mi join public.execution_contract_measurements m on m.id=mi.measurement_id where mi.contract_item_id=ci.id and m.status in('approved','invoiced','paid'));

 update public.execution_service_contracts c set measured_value=coalesce(x.measured,0),retained_value=coalesce(x.retained,0),invoiced_value=coalesce(x.invoiced,0),paid_value=coalesce(x.paid,0),updated_at=now()
 from (
  select p_contract_id contract_id,coalesce(sum(gross_amount) filter(where status in('approved','invoiced','paid')),0) measured,
   coalesce(sum(contractual_retention_amount+guarantee_retention_amount) filter(where status in('approved','invoiced','paid')),0) retained,
   coalesce(sum(net_amount) filter(where status in('invoiced','paid')),0) invoiced,coalesce(sum(paid_amount) filter(where status='paid'),0) paid
  from public.execution_contract_measurements where contract_id=p_contract_id
 ) x where c.id=x.contract_id;
end $$;

-- Compatibilidade: contratos existentes recebem uma única etapa de 100%.
insert into public.execution_service_contract_stages(company_id,project_id,contract_id,contract_item_id,service_id,location_id,stage_code,stage_name,description,measurement_mode,weight_percent,unit_snapshot,contracted_quantity,unit_price,total_value,opening_measured_quantity,opening_measured_value,measured_quantity,measured_value,sort_order)
select ci.company_id,ci.project_id,ci.contract_id,ci.id,ci.service_id,ci.location_id,'ET-01','Serviço completo','Etapa automática criada para preservar contratos anteriores.','quantity',100,ci.unit_snapshot,ci.contracted_quantity,ci.unit_price,ci.total_value,ci.measured_quantity,ci.measured_value,ci.measured_quantity,ci.measured_value,1
from public.execution_service_contract_items ci
where not exists(select 1 from public.execution_service_contract_stages s where s.contract_item_id=ci.id);

grant select,insert,update,delete on public.execution_service_requests,public.execution_service_request_items,public.execution_service_competitions,public.execution_service_competition_offers,public.execution_service_competition_offer_items,public.execution_service_contract_stages to authenticated;
grant execute on function public.save_execution_service_request(uuid,uuid,uuid,uuid,text,text,date,date,text,jsonb) to authenticated;
grant execute on function public.change_execution_service_request_status(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.start_execution_service_competition(uuid,uuid,uuid,date,text,text) to authenticated;
grant execute on function public.save_execution_service_competition_offer(uuid,uuid,uuid,uuid,uuid,text,date,date,integer,date,date,numeric,numeric,text,jsonb) to authenticated;
grant execute on function public.approve_execution_service_competition(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.generate_execution_service_contract_from_competition(uuid,uuid,uuid,text,text,date,date,date,numeric,numeric,integer,integer,text,date,text,text,text,text,jsonb) to authenticated;
grant execute on function public.save_execution_service_contract_stages(uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.save_execution_stage_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb) to authenticated;
grant select on public.execution_service_contract_stages to authenticated;

commit;
