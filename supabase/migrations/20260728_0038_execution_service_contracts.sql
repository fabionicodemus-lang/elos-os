-- Elos OS — Execução · Contratos de Serviços
-- Contratos vinculados a fornecedores, serviços, locais, orçamento e cronograma da obra.

begin;

create table if not exists public.execution_service_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  budget_id uuid references public.engineering_budgets(id) on delete restrict,
  sequence_no integer not null,
  contract_number text not null,
  title text not null,
  scope_summary text not null,
  status text not null default 'draft' check (status in ('draft','active','suspended','finished','cancelled')),
  signed_date date,
  start_date date not null,
  end_date date not null,
  original_value numeric(18,2) not null default 0,
  amendments_value numeric(18,2) not null default 0,
  current_value numeric(18,2) not null default 0,
  measured_value numeric(18,2) not null default 0,
  retained_value numeric(18,2) not null default 0,
  invoiced_value numeric(18,2) not null default 0,
  paid_value numeric(18,2) not null default 0,
  retention_percent numeric(8,4) not null default 0 check (retention_percent between 0 and 100),
  guarantee_percent numeric(8,4) not null default 0 check (guarantee_percent between 0 and 100),
  guarantee_months integer not null default 0 check (guarantee_months between 0 and 240),
  payment_days integer not null default 15 check (payment_days between 0 and 365),
  adjustment_index text,
  adjustment_base_date date,
  contact_name text,
  contact_phone text,
  contact_email text,
  notes text,
  responsible_user_id uuid references auth.users(id),
  responsible_name text,
  activated_by uuid references auth.users(id),
  activated_at timestamptz,
  finished_by uuid references auth.users(id),
  finished_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence_no),
  unique (project_id, contract_number),
  constraint execution_service_contract_dates_check check (end_date >= start_date),
  constraint execution_service_contract_values_check check (
    original_value >= 0 and current_value >= 0 and measured_value >= 0 and retained_value >= 0 and invoiced_value >= 0 and paid_value >= 0
  ),
  constraint execution_service_contract_cancel_check check (
    status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null
  )
);

create table if not exists public.execution_service_contract_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  location_id uuid references public.engineering_takeoff_locations(id) on delete restrict,
  schedule_activity_id uuid references public.engineering_schedule_activities(id) on delete set null,
  service_code text not null,
  service_name text not null,
  location_name text,
  unit_snapshot text not null,
  contracted_quantity numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  total_value numeric(18,2) not null,
  measured_quantity numeric(18,6) not null default 0,
  measured_value numeric(18,2) not null default 0,
  planned_start date,
  planned_finish date,
  scope_notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint execution_service_contract_item_values_check check (
    contracted_quantity > 0 and unit_price >= 0 and total_value >= 0 and measured_quantity >= 0 and measured_value >= 0
  ),
  constraint execution_service_contract_item_dates_check check (planned_finish is null or planned_start is null or planned_finish >= planned_start)
);

create table if not exists public.execution_service_contract_amendments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete restrict,
  sequence_no integer not null,
  amendment_number text not null,
  amendment_type text not null check (amendment_type in ('addition','suppression','time','mixed')),
  description text not null,
  value_change numeric(18,2) not null default 0,
  previous_end_date date,
  new_end_date date,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  justification text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (contract_id, sequence_no),
  unique (contract_id, amendment_number),
  constraint execution_service_amendment_date_check check (new_end_date is null or previous_end_date is null or new_end_date >= previous_end_date)
);

create table if not exists public.execution_service_contract_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete cascade,
  amendment_id uuid references public.execution_service_contract_amendments(id) on delete cascade,
  document_type text not null default 'other' check (document_type in ('contract','proposal','insurance','certificate','amendment','termination','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (contract_id, storage_path)
);

create table if not exists public.execution_service_contract_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists execution_service_contracts_project_status_idx on public.execution_service_contracts(project_id,status,start_date,end_date);
create index if not exists execution_service_contracts_supplier_idx on public.execution_service_contracts(company_id,supplier_id,status);
create index if not exists execution_service_contract_items_contract_idx on public.execution_service_contract_items(contract_id,sort_order);
create index if not exists execution_service_contract_items_service_idx on public.execution_service_contract_items(project_id,service_id,location_id);
create index if not exists execution_service_contract_amendments_contract_idx on public.execution_service_contract_amendments(contract_id,sequence_no);
create index if not exists execution_service_contract_documents_contract_idx on public.execution_service_contract_documents(contract_id,uploaded_at);

insert into public.permissions (key,module,action,description) values
  ('execution.contracts.view','execution_contracts','view','Visualizar contratos de serviços da obra'),
  ('execution.contracts.manage','execution_contracts','manage','Criar e editar contratos em elaboração'),
  ('execution.contracts.approve','execution_contracts','approve','Ativar, suspender e concluir contratos'),
  ('execution.contracts.amend','execution_contracts','amend','Aprovar aditivos contratuais'),
  ('execution.contracts.cancel','execution_contracts','cancel','Cancelar contratos com justificativa')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.contracts.view'),('execution.contracts.manage'),('execution.contracts.approve'),('execution.contracts.amend'),('execution.contracts.cancel')) p(permission_key)
where r.key in ('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.contracts.view'),('execution.contracts.manage')) p(permission_key)
where r.key in ('engineering')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'execution.contracts.view',true from public.roles r
where r.key in ('field','procurement','finance','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.execution_service_contracts enable row level security;
alter table public.execution_service_contract_items enable row level security;
alter table public.execution_service_contract_amendments enable row level security;
alter table public.execution_service_contract_documents enable row level security;
alter table public.execution_service_contract_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['execution_service_contracts','execution_service_contract_items','execution_service_contract_amendments','execution_service_contract_documents','execution_service_contract_audit']
  loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''execution.contracts.view'') or public.has_company_permission(company_id,''execution.contracts.manage'') or public.has_company_permission(company_id,''execution.contracts.approve''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''execution.contracts.manage'') or public.has_company_permission(company_id,''execution.contracts.approve'') or public.has_company_permission(company_id,''execution.contracts.amend'')) with check (public.has_company_permission(company_id,''execution.contracts.manage'') or public.has_company_permission(company_id,''execution.contracts.approve'') or public.has_company_permission(company_id,''execution.contracts.amend''))',t,t);
  end loop;
end $$;

create or replace function public.refresh_execution_service_contract_value(p_contract_id uuid)
returns numeric
language plpgsql security definer set search_path=public as $$
declare total numeric; amendment_total numeric; begin
  select coalesce(sum(total_value),0) into total from public.execution_service_contract_items where contract_id=p_contract_id;
  select coalesce(sum(value_change),0) into amendment_total from public.execution_service_contract_amendments where contract_id=p_contract_id;
  update public.execution_service_contracts set original_value=total,amendments_value=amendment_total,current_value=greatest(0,total+amendment_total),updated_at=now() where id=p_contract_id;
  return greatest(0,total+amendment_total);
end; $$;

create or replace function public.save_execution_service_contract(
  p_company_id uuid,p_project_id uuid,p_contract_id uuid,p_supplier_id uuid,p_budget_id uuid,
  p_title text,p_scope_summary text,p_start_date date,p_end_date date,p_signed_date date,
  p_retention_percent numeric,p_guarantee_percent numeric,p_guarantee_months integer,p_payment_days integer,
  p_adjustment_index text,p_adjustment_base_date date,p_contact_name text,p_contact_phone text,p_contact_email text,p_notes text,p_items jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  c public.execution_service_contracts%rowtype; item jsonb; svc public.engineering_services%rowtype; loc_name text; activity public.engineering_schedule_activities%rowtype;
  seq integer; resolved_id uuid; responsible text; n integer:=0; qty numeric; price numeric; has_budget_services boolean;
begin
  if not public.has_company_permission(p_company_id,'execution.contracts.manage') then raise exception 'Sem permissão para criar ou editar contratos.'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_scope_summary,'')),'') is null then raise exception 'Informe o título e o escopo do contrato.'; end if;
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date then raise exception 'Revise a vigência do contrato.'; end if;
  if not exists(select 1 from public.projects p where p.id=p_project_id and p.company_id=p_company_id and p.status<>'archived') then raise exception 'Obra inválida.'; end if;
  if not exists(select 1 from public.suppliers s where s.id=p_supplier_id and s.company_id=p_company_id and s.status='active') then raise exception 'Selecione um fornecedor ativo.'; end if;
  if p_budget_id is not null and not exists(select 1 from public.engineering_budgets b where b.id=p_budget_id and b.company_id=p_company_id and b.project_id=p_project_id and b.status='approved') then raise exception 'O orçamento informado não está aprovado.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Inclua pelo menos um serviço no contrato.'; end if;

  select exists(select 1 from public.engineering_takeoffs t where t.company_id=p_company_id and t.project_id=p_project_id and t.budget_id=p_budget_id and t.record_status='active') into has_budget_services;
  select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into responsible from public.profiles pr where pr.id=auth.uid();
  responsible:=coalesce(responsible,nullif(auth.jwt()->>'email',''),'Usuário');

  if p_contract_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contracts'));
    select coalesce(max(sequence_no),0)+1 into seq from public.execution_service_contracts where project_id=p_project_id;
    insert into public.execution_service_contracts(company_id,project_id,supplier_id,budget_id,sequence_no,contract_number,title,scope_summary,start_date,end_date,signed_date,retention_percent,guarantee_percent,guarantee_months,payment_days,adjustment_index,adjustment_base_date,contact_name,contact_phone,contact_email,notes,responsible_user_id,responsible_name,created_by,updated_by)
    values(p_company_id,p_project_id,p_supplier_id,p_budget_id,seq,'CT-'||lpad(seq::text,4,'0'),trim(p_title),trim(p_scope_summary),p_start_date,p_end_date,p_signed_date,coalesce(p_retention_percent,0),coalesce(p_guarantee_percent,0),coalesce(p_guarantee_months,0),coalesce(p_payment_days,15),nullif(trim(coalesce(p_adjustment_index,'')),''),p_adjustment_base_date,nullif(trim(coalesce(p_contact_name,'')),''),nullif(trim(coalesce(p_contact_phone,'')),''),nullif(trim(coalesce(p_contact_email,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),responsible,auth.uid(),auth.uid()) returning id into resolved_id;
  else
    select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id for update;
    if c.id is null then raise exception 'Contrato não encontrado.'; end if;
    if c.status<>'draft' then raise exception 'Somente contratos em elaboração podem ser editados.'; end if;
    resolved_id:=c.id;
    update public.execution_service_contracts set supplier_id=p_supplier_id,budget_id=p_budget_id,title=trim(p_title),scope_summary=trim(p_scope_summary),start_date=p_start_date,end_date=p_end_date,signed_date=p_signed_date,retention_percent=coalesce(p_retention_percent,0),guarantee_percent=coalesce(p_guarantee_percent,0),guarantee_months=coalesce(p_guarantee_months,0),payment_days=coalesce(p_payment_days,15),adjustment_index=nullif(trim(coalesce(p_adjustment_index,'')),''),adjustment_base_date=p_adjustment_base_date,contact_name=nullif(trim(coalesce(p_contact_name,'')),''),contact_phone=nullif(trim(coalesce(p_contact_phone,'')),''),contact_email=nullif(trim(coalesce(p_contact_email,'')),''),notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=resolved_id;
    delete from public.execution_service_contract_items where contract_id=resolved_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    n:=n+1; qty:=nullif(item->>'quantity','')::numeric; price:=coalesce(nullif(item->>'unit_price','')::numeric,0); activity:=null; loc_name:=null;
    if qty is null or qty<=0 then raise exception 'Informe uma quantidade maior que zero em todos os serviços.'; end if;
    select * into svc from public.engineering_services s where s.id=nullif(item->>'service_id','')::uuid and s.company_id=p_company_id and s.status='active';
    if svc.id is null then raise exception 'Um dos serviços não está ativo.'; end if;
    if has_budget_services and not exists(select 1 from public.engineering_takeoffs t where t.company_id=p_company_id and t.project_id=p_project_id and t.budget_id=p_budget_id and t.service_id=svc.id and t.record_status='active') then raise exception 'O serviço % não pertence ao orçamento aprovado.',svc.code; end if;
    if nullif(item->>'location_id','') is not null then select coalesce(l.code||' · ','')||l.name into loc_name from public.engineering_takeoff_locations l where l.id=(item->>'location_id')::uuid and l.company_id=p_company_id and l.project_id=p_project_id and l.status='active'; end if;
    if nullif(item->>'schedule_activity_id','') is not null then select * into activity from public.engineering_schedule_activities a where a.id=(item->>'schedule_activity_id')::uuid and a.company_id=p_company_id and a.project_id=p_project_id and a.service_id=svc.id and a.record_status='active'; end if;
    insert into public.execution_service_contract_items(company_id,project_id,contract_id,service_id,location_id,schedule_activity_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,unit_price,total_value,planned_start,planned_finish,scope_notes,sort_order)
    values(p_company_id,p_project_id,resolved_id,svc.id,nullif(item->>'location_id','')::uuid,activity.id,svc.code,svc.description,loc_name,svc.unit,qty,price,round(qty*price,2),coalesce(nullif(item->>'planned_start','')::date,activity.planned_start),coalesce(nullif(item->>'planned_finish','')::date,activity.planned_finish),nullif(trim(coalesce(item->>'notes','')),''),n);
  end loop;
  perform public.refresh_execution_service_contract_value(resolved_id);
  insert into public.execution_service_contract_audit(company_id,project_id,contract_id,action,new_status,changed_by) values(p_company_id,p_project_id,resolved_id,case when p_contract_id is null then 'created' else 'updated' end,'draft',auth.uid());
  return resolved_id;
end; $$;

create or replace function public.activate_execution_service_contract(p_company_id uuid,p_project_id uuid,p_contract_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare c public.execution_service_contracts%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.contracts.approve') then raise exception 'Sem permissão para ativar contratos.'; end if;
  select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id for update;
  if c.id is null or c.status<>'draft' then raise exception 'Contrato não disponível para ativação.'; end if;
  perform public.refresh_execution_service_contract_value(c.id);
  select * into c from public.execution_service_contracts where id=c.id;
  if c.current_value<=0 or not exists(select 1 from public.execution_service_contract_items where contract_id=c.id) then raise exception 'O contrato precisa possuir escopo e valor maior que zero.'; end if;
  if not exists(select 1 from public.suppliers s where s.id=c.supplier_id and s.company_id=p_company_id and s.status='active') then raise exception 'O fornecedor do contrato não está ativo.'; end if;
  update public.execution_service_contracts set status='active',activated_by=auth.uid(),activated_at=now(),updated_by=auth.uid(),updated_at=now() where id=c.id;
  insert into public.execution_service_contract_audit(company_id,project_id,contract_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,c.id,'activated','draft','active',auth.uid()); return 'active';
end; $$;

create or replace function public.change_execution_service_contract_status(p_company_id uuid,p_project_id uuid,p_contract_id uuid,p_action text,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare c public.execution_service_contracts%rowtype; next_status text; begin
  select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id for update;
  if c.id is null then raise exception 'Contrato não encontrado.'; end if;
  if p_action='suspend' then
    if not public.has_company_permission(p_company_id,'execution.contracts.approve') or c.status<>'active' then raise exception 'Contrato não disponível para suspensão.'; end if; next_status:='suspended';
  elsif p_action='resume' then
    if not public.has_company_permission(p_company_id,'execution.contracts.approve') or c.status<>'suspended' then raise exception 'Contrato não disponível para retomada.'; end if; next_status:='active';
  elsif p_action='finish' then
    if not public.has_company_permission(p_company_id,'execution.contracts.approve') or c.status not in ('active','suspended') then raise exception 'Contrato não disponível para conclusão.'; end if; next_status:='finished';
  elsif p_action='cancel' then
    if not public.has_company_permission(p_company_id,'execution.contracts.cancel') or c.status in ('finished','cancelled') then raise exception 'Contrato não disponível para cancelamento.'; end if;
    if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if; next_status:='cancelled';
  else raise exception 'Ação contratual inválida.'; end if;
  update public.execution_service_contracts set status=next_status,finished_by=case when next_status='finished' then auth.uid() else finished_by end,finished_at=case when next_status='finished' then now() else finished_at end,cancelled_by=case when next_status='cancelled' then auth.uid() else cancelled_by end,cancelled_at=case when next_status='cancelled' then now() else cancelled_at end,cancellation_reason=case when next_status='cancelled' then trim(p_reason) else cancellation_reason end,updated_by=auth.uid(),updated_at=now() where id=c.id;
  insert into public.execution_service_contract_audit(company_id,project_id,contract_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,c.id,p_action,c.status,next_status,nullif(trim(coalesce(p_reason,'')),''),auth.uid()); return next_status;
end; $$;

create or replace function public.add_execution_service_contract_amendment(p_company_id uuid,p_project_id uuid,p_contract_id uuid,p_type text,p_description text,p_value_change numeric,p_new_end_date date,p_justification text)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.execution_service_contracts%rowtype; seq integer; new_id uuid; begin
  if not public.has_company_permission(p_company_id,'execution.contracts.amend') then raise exception 'Aditivos exigem permissão de gerente, diretor ou administrador.'; end if;
  select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id for update;
  if c.id is null or c.status not in ('active','suspended') then raise exception 'Somente contratos ativos ou suspensos podem receber aditivos.'; end if;
  if p_type not in ('addition','suppression','time','mixed') then raise exception 'Tipo de aditivo inválido.'; end if;
  if nullif(trim(coalesce(p_description,'')),'') is null or nullif(trim(coalesce(p_justification,'')),'') is null then raise exception 'Descrição e justificativa são obrigatórias.'; end if;
  if p_type in ('time','mixed') and (p_new_end_date is null or p_new_end_date<c.end_date) then raise exception 'Informe uma nova data final igual ou posterior à vigência atual.'; end if;
  if p_type in ('addition','suppression','mixed') and coalesce(p_value_change,0)=0 then raise exception 'Informe a alteração de valor do aditivo.'; end if;
  if p_type='addition' and p_value_change<0 then raise exception 'Acréscimo deve ter valor positivo.'; end if;
  if p_type='suppression' and p_value_change>0 then raise exception 'Supressão deve ter valor negativo.'; end if;
  select coalesce(max(sequence_no),0)+1 into seq from public.execution_service_contract_amendments where contract_id=c.id;
  insert into public.execution_service_contract_amendments(company_id,project_id,contract_id,sequence_no,amendment_number,amendment_type,description,value_change,previous_end_date,new_end_date,approved_by,justification,created_by)
  values(p_company_id,p_project_id,c.id,seq,'AD-'||lpad(seq::text,2,'0'),p_type,trim(p_description),coalesce(p_value_change,0),c.end_date,p_new_end_date,auth.uid(),trim(p_justification),auth.uid()) returning id into new_id;
  if p_new_end_date is not null then update public.execution_service_contracts set end_date=p_new_end_date,updated_by=auth.uid(),updated_at=now() where id=c.id; end if;
  perform public.refresh_execution_service_contract_value(c.id);
  insert into public.execution_service_contract_audit(company_id,project_id,contract_id,action,previous_status,new_status,reason,details,changed_by) values(p_company_id,p_project_id,c.id,'amendment',c.status,c.status,p_justification,jsonb_build_object('amendment_id',new_id,'value_change',coalesce(p_value_change,0),'new_end_date',p_new_end_date),auth.uid()); return new_id;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('service-contract-documents','service-contract-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists service_contract_documents_select on storage.objects;
create policy service_contract_documents_select on storage.objects for select to authenticated using(bucket_id='service-contract-documents' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists service_contract_documents_insert on storage.objects;
create policy service_contract_documents_insert on storage.objects for insert to authenticated with check(bucket_id='service-contract-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.contracts.manage'));
drop policy if exists service_contract_documents_delete on storage.objects;
create policy service_contract_documents_delete on storage.objects for delete to authenticated using(bucket_id='service-contract-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.contracts.manage'));

grant select,insert,update,delete on public.execution_service_contracts,public.execution_service_contract_items,public.execution_service_contract_amendments,public.execution_service_contract_documents,public.execution_service_contract_audit to authenticated;
grant execute on function public.refresh_execution_service_contract_value(uuid) to authenticated;
grant execute on function public.save_execution_service_contract(uuid,uuid,uuid,uuid,uuid,text,text,date,date,date,numeric,numeric,integer,integer,text,date,text,text,text,text,jsonb) to authenticated;
grant execute on function public.activate_execution_service_contract(uuid,uuid,uuid) to authenticated;
grant execute on function public.change_execution_service_contract_status(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.add_execution_service_contract_amendment(uuid,uuid,uuid,text,text,numeric,date,text) to authenticated;

commit;
