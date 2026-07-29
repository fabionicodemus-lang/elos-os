-- Elos OS — Execução · Ordens de Serviço
-- Emissão, liberação, execução, aceite e encerramento das frentes contratadas.

begin;

create table if not exists public.execution_work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  sequence_no integer not null,
  work_order_number text not null,
  title text not null,
  scope_summary text not null,
  status text not null default 'draft' check (status in ('draft','released','in_progress','paused','pending_acceptance','finished','cancelled')),
  planned_start date not null,
  planned_finish date not null,
  actual_start date,
  actual_finish date,
  authorized_value numeric(18,2) not null default 0,
  executed_value numeric(18,2) not null default 0,
  accepted_value numeric(18,2) not null default 0,
  measured_value numeric(18,2) not null default 0,
  responsible_user_id uuid references auth.users(id),
  responsible_name text,
  supplier_contact_name text,
  supplier_contact_phone text,
  site_instructions text,
  safety_instructions text,
  quality_requirements text,
  notes text,
  released_by uuid references auth.users(id),
  released_at timestamptz,
  started_by uuid references auth.users(id),
  started_at timestamptz,
  paused_by uuid references auth.users(id),
  paused_at timestamptz,
  pause_reason text,
  acceptance_requested_by uuid references auth.users(id),
  acceptance_requested_at timestamptz,
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  acceptance_result text check (acceptance_result is null or acceptance_result in ('approved','approved_with_remarks','rejected')),
  acceptance_notes text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence_no),
  unique (project_id, work_order_number),
  constraint execution_work_order_dates_check check (planned_finish >= planned_start),
  constraint execution_work_order_values_check check (authorized_value >= 0 and executed_value >= 0 and accepted_value >= 0 and measured_value >= 0),
  constraint execution_work_order_cancel_check check (status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.execution_work_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_order_id uuid not null references public.execution_work_orders(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete restrict,
  contract_item_id uuid not null references public.execution_service_contract_items(id) on delete restrict,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  location_id uuid references public.engineering_takeoff_locations(id) on delete restrict,
  schedule_activity_id uuid references public.engineering_schedule_activities(id) on delete set null,
  service_code text not null,
  service_name text not null,
  location_name text,
  unit_snapshot text not null,
  authorized_quantity numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  authorized_value numeric(18,2) not null,
  executed_quantity numeric(18,6) not null default 0,
  executed_value numeric(18,2) not null default 0,
  accepted_quantity numeric(18,6) not null default 0,
  accepted_value numeric(18,2) not null default 0,
  measured_quantity numeric(18,6) not null default 0,
  measured_value numeric(18,2) not null default 0,
  planned_start date,
  planned_finish date,
  scope_notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint execution_work_order_item_values_check check (
    authorized_quantity > 0 and unit_price >= 0 and authorized_value >= 0 and
    executed_quantity >= 0 and accepted_quantity >= 0 and measured_quantity >= 0 and
    executed_value >= 0 and accepted_value >= 0 and measured_value >= 0 and
    executed_quantity <= authorized_quantity + 0.000001 and accepted_quantity <= executed_quantity + 0.000001 and measured_quantity <= accepted_quantity + 0.000001
  ),
  constraint execution_work_order_item_dates_check check (planned_finish is null or planned_start is null or planned_finish >= planned_start)
);

create table if not exists public.execution_work_order_prerequisites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_order_id uuid not null references public.execution_work_orders(id) on delete cascade,
  code text,
  title text not null,
  is_required boolean not null default true,
  is_completed boolean not null default false,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.execution_work_order_acceptances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_order_id uuid not null references public.execution_work_orders(id) on delete cascade,
  sequence_no integer not null,
  result text not null check (result in ('approved','approved_with_remarks','rejected')),
  quality_status text not null check (quality_status in ('passed','pending','waived')),
  quality_reference text,
  notes text,
  punch_list jsonb not null default '[]'::jsonb,
  accepted_by uuid not null references auth.users(id),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (work_order_id, sequence_no)
);

create table if not exists public.execution_work_order_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_order_id uuid not null references public.execution_work_orders(id) on delete cascade,
  document_type text not null default 'other' check (document_type in ('work_order','project','safety','evidence','acceptance','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (work_order_id, storage_path)
);

create table if not exists public.execution_work_order_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_order_id uuid not null references public.execution_work_orders(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

alter table public.execution_contract_measurement_items
  add column if not exists work_order_id uuid references public.execution_work_orders(id) on delete set null,
  add column if not exists work_order_item_id uuid references public.execution_work_order_items(id) on delete set null;

create index if not exists execution_work_orders_project_status_idx on public.execution_work_orders(project_id,status,planned_start,planned_finish);
create index if not exists execution_work_orders_contract_idx on public.execution_work_orders(contract_id,sequence_no);
create index if not exists execution_work_order_items_order_idx on public.execution_work_order_items(work_order_id,sort_order);
create index if not exists execution_work_order_items_contract_item_idx on public.execution_work_order_items(contract_item_id);
create index if not exists execution_work_order_prerequisites_idx on public.execution_work_order_prerequisites(work_order_id,sort_order);
create index if not exists execution_work_order_acceptances_idx on public.execution_work_order_acceptances(work_order_id,sequence_no);
create index if not exists execution_work_order_documents_idx on public.execution_work_order_documents(work_order_id,uploaded_at);
create index if not exists execution_measurement_items_work_order_idx on public.execution_contract_measurement_items(work_order_id,work_order_item_id);

insert into public.permissions (key,module,action,description) values
  ('execution.work_orders.view','execution_work_orders','view','Visualizar ordens de serviço da obra'),
  ('execution.work_orders.manage','execution_work_orders','manage','Criar e editar ordens de serviço em elaboração'),
  ('execution.work_orders.release','execution_work_orders','release','Liberar e iniciar ordens de serviço'),
  ('execution.work_orders.progress','execution_work_orders','progress','Atualizar execução e solicitar aceite'),
  ('execution.work_orders.accept','execution_work_orders','accept','Aceitar ou devolver ordens de serviço'),
  ('execution.work_orders.cancel','execution_work_orders','cancel','Cancelar ordens de serviço com justificativa')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.work_orders.view'),('execution.work_orders.manage'),('execution.work_orders.release'),('execution.work_orders.progress'),('execution.work_orders.accept'),('execution.work_orders.cancel')) p(permission_key)
where r.key in ('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.work_orders.view'),('execution.work_orders.manage'),('execution.work_orders.release'),('execution.work_orders.progress'),('execution.work_orders.accept')) p(permission_key)
where r.key in ('engineering')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.work_orders.view'),('execution.work_orders.progress')) p(permission_key)
where r.key in ('field')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'execution.work_orders.view',true from public.roles r
where r.key in ('procurement','finance','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.execution_work_orders enable row level security;
alter table public.execution_work_order_items enable row level security;
alter table public.execution_work_order_prerequisites enable row level security;
alter table public.execution_work_order_acceptances enable row level security;
alter table public.execution_work_order_documents enable row level security;
alter table public.execution_work_order_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['execution_work_orders','execution_work_order_items','execution_work_order_prerequisites','execution_work_order_acceptances','execution_work_order_documents','execution_work_order_audit']
  loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''execution.work_orders.view'') or public.has_company_permission(company_id,''execution.work_orders.manage'') or public.has_company_permission(company_id,''execution.work_orders.release'') or public.has_company_permission(company_id,''execution.work_orders.progress'') or public.has_company_permission(company_id,''execution.work_orders.accept''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''execution.work_orders.manage'') or public.has_company_permission(company_id,''execution.work_orders.release'') or public.has_company_permission(company_id,''execution.work_orders.progress'') or public.has_company_permission(company_id,''execution.work_orders.accept'')) with check (public.has_company_permission(company_id,''execution.work_orders.manage'') or public.has_company_permission(company_id,''execution.work_orders.release'') or public.has_company_permission(company_id,''execution.work_orders.progress'') or public.has_company_permission(company_id,''execution.work_orders.accept''))',t,t);
  end loop;
end $$;

create or replace function public.refresh_execution_work_order_values(p_work_order_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
begin
  update public.execution_work_orders wo
  set authorized_value=coalesce(x.authorized,0),
      executed_value=coalesce(x.executed,0),
      accepted_value=coalesce(x.accepted,0),
      measured_value=coalesce(x.measured,0),
      updated_at=now()
  from (
    select p_work_order_id id,
      coalesce(sum(authorized_value),0) authorized,
      coalesce(sum(executed_value),0) executed,
      coalesce(sum(accepted_value),0) accepted,
      coalesce(sum(measured_value),0) measured
    from public.execution_work_order_items where work_order_id=p_work_order_id
  ) x where wo.id=x.id;
end; $$;

create or replace function public.save_execution_work_order(
  p_company_id uuid,p_project_id uuid,p_work_order_id uuid,p_contract_id uuid,
  p_title text,p_scope_summary text,p_planned_start date,p_planned_finish date,
  p_supplier_contact_name text,p_supplier_contact_phone text,p_site_instructions text,p_safety_instructions text,
  p_quality_requirements text,p_notes text,p_items jsonb,p_prerequisites jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  wo public.execution_work_orders%rowtype; c public.execution_service_contracts%rowtype; ci public.execution_service_contract_items%rowtype;
  item jsonb; prerequisite jsonb; resolved_id uuid; seq integer; n integer:=0; pseq integer:=0; qty numeric; already_authorized numeric; responsible text;
begin
  if not public.has_company_permission(p_company_id,'execution.work_orders.manage') then raise exception 'Sem permissão para criar ou editar ordens de serviço.'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null or nullif(trim(coalesce(p_scope_summary,'')),'') is null then raise exception 'Informe o título e o escopo da ordem de serviço.'; end if;
  if p_planned_start is null or p_planned_finish is null or p_planned_finish<p_planned_start then raise exception 'Revise o período previsto da ordem de serviço.'; end if;
  select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id and status='active';
  if c.id is null then raise exception 'Selecione um contrato ativo da obra.'; end if;
  if p_planned_start<c.start_date or p_planned_finish>c.end_date then raise exception 'A ordem de serviço deve estar dentro da vigência do contrato.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Inclua pelo menos um item contratado na ordem de serviço.'; end if;
  select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into responsible from public.profiles pr where pr.id=auth.uid();
  responsible:=coalesce(responsible,nullif(auth.jwt()->>'email',''),'Usuário');

  if p_work_order_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':work-orders'));
    select coalesce(max(sequence_no),0)+1 into seq from public.execution_work_orders where project_id=p_project_id;
    insert into public.execution_work_orders(company_id,project_id,contract_id,supplier_id,sequence_no,work_order_number,title,scope_summary,planned_start,planned_finish,responsible_user_id,responsible_name,supplier_contact_name,supplier_contact_phone,site_instructions,safety_instructions,quality_requirements,notes,created_by,updated_by)
    values(p_company_id,p_project_id,c.id,c.supplier_id,seq,'OS-'||lpad(seq::text,4,'0'),trim(p_title),trim(p_scope_summary),p_planned_start,p_planned_finish,auth.uid(),responsible,nullif(trim(coalesce(p_supplier_contact_name,'')),''),nullif(trim(coalesce(p_supplier_contact_phone,'')),''),nullif(trim(coalesce(p_site_instructions,'')),''),nullif(trim(coalesce(p_safety_instructions,'')),''),nullif(trim(coalesce(p_quality_requirements,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()) returning id into resolved_id;
  else
    select * into wo from public.execution_work_orders where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
    if wo.id is null then raise exception 'Ordem de serviço não encontrada.'; end if;
    if wo.status<>'draft' then raise exception 'Somente ordens em elaboração podem ser editadas.'; end if;
    if wo.contract_id<>p_contract_id then raise exception 'O contrato da ordem de serviço não pode ser alterado.'; end if;
    resolved_id:=wo.id;
    update public.execution_work_orders set title=trim(p_title),scope_summary=trim(p_scope_summary),planned_start=p_planned_start,planned_finish=p_planned_finish,supplier_contact_name=nullif(trim(coalesce(p_supplier_contact_name,'')),''),supplier_contact_phone=nullif(trim(coalesce(p_supplier_contact_phone,'')),''),site_instructions=nullif(trim(coalesce(p_site_instructions,'')),''),safety_instructions=nullif(trim(coalesce(p_safety_instructions,'')),''),quality_requirements=nullif(trim(coalesce(p_quality_requirements,'')),''),notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=resolved_id;
    delete from public.execution_work_order_items where work_order_id=resolved_id;
    delete from public.execution_work_order_prerequisites where work_order_id=resolved_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    qty:=coalesce(nullif(item->>'authorized_quantity','')::numeric,0);
    if qty<=0 then continue; end if;
    select * into ci from public.execution_service_contract_items where id=nullif(item->>'contract_item_id','')::uuid and contract_id=c.id and company_id=p_company_id and project_id=p_project_id;
    if ci.id is null then raise exception 'Um dos itens não pertence ao contrato selecionado.'; end if;
    select coalesce(sum(woi.authorized_quantity),0) into already_authorized
    from public.execution_work_order_items woi join public.execution_work_orders existing on existing.id=woi.work_order_id
    where woi.contract_item_id=ci.id and existing.status<>'cancelled' and existing.id<>resolved_id;
    if already_authorized+qty>ci.contracted_quantity+0.000001 then raise exception 'A quantidade autorizada do item % ultrapassa o contratado. Disponível: % %.',ci.service_code,round(ci.contracted_quantity-already_authorized,6),ci.unit_snapshot; end if;
    n:=n+1;
    insert into public.execution_work_order_items(company_id,project_id,work_order_id,contract_id,contract_item_id,service_id,location_id,schedule_activity_id,service_code,service_name,location_name,unit_snapshot,authorized_quantity,unit_price,authorized_value,planned_start,planned_finish,scope_notes,sort_order)
    values(p_company_id,p_project_id,resolved_id,c.id,ci.id,ci.service_id,ci.location_id,ci.schedule_activity_id,ci.service_code,ci.service_name,ci.location_name,ci.unit_snapshot,qty,ci.unit_price,round(qty*ci.unit_price,2),coalesce(nullif(item->>'planned_start','')::date,p_planned_start),coalesce(nullif(item->>'planned_finish','')::date,p_planned_finish),nullif(trim(coalesce(item->>'notes','')),''),n);
  end loop;
  if n=0 then raise exception 'Informe ao menos uma quantidade autorizada maior que zero.'; end if;

  if jsonb_typeof(p_prerequisites)='array' then
    for prerequisite in select value from jsonb_array_elements(p_prerequisites) loop
      if nullif(trim(coalesce(prerequisite->>'title','')),'') is null then continue; end if;
      pseq:=pseq+1;
      insert into public.execution_work_order_prerequisites(company_id,project_id,work_order_id,code,title,is_required,is_completed,completed_by,completed_at,notes,sort_order)
      values(p_company_id,p_project_id,resolved_id,nullif(trim(coalesce(prerequisite->>'code','')),''),trim(prerequisite->>'title'),coalesce((prerequisite->>'is_required')::boolean,true),coalesce((prerequisite->>'is_completed')::boolean,false),case when coalesce((prerequisite->>'is_completed')::boolean,false) then auth.uid() else null end,case when coalesce((prerequisite->>'is_completed')::boolean,false) then now() else null end,nullif(trim(coalesce(prerequisite->>'notes','')),''),pseq);
    end loop;
  end if;
  perform public.refresh_execution_work_order_values(resolved_id);
  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,new_status,changed_by) values(p_company_id,p_project_id,resolved_id,case when p_work_order_id is null then 'created' else 'updated' end,'draft',auth.uid());
  return resolved_id;
end; $$;

create or replace function public.release_execution_work_order(p_company_id uuid,p_project_id uuid,p_work_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare wo public.execution_work_orders%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.work_orders.release') then raise exception 'Sem permissão para liberar ordens de serviço.'; end if;
  select * into wo from public.execution_work_orders where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if wo.id is null or wo.status<>'draft' then raise exception 'Ordem de serviço não disponível para liberação.'; end if;
  if exists(select 1 from public.execution_work_order_prerequisites where work_order_id=wo.id and is_required and not is_completed) then raise exception 'Conclua todos os pré-requisitos obrigatórios antes da liberação.'; end if;
  if wo.authorized_value<=0 or not exists(select 1 from public.execution_work_order_items where work_order_id=wo.id) then raise exception 'A ordem precisa possuir escopo e valor autorizado.'; end if;
  update public.execution_work_orders set status='released',released_by=auth.uid(),released_at=now(),updated_by=auth.uid(),updated_at=now() where id=wo.id;
  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,wo.id,'released','draft','released',auth.uid());
  return 'released';
end; $$;

create or replace function public.change_execution_work_order_status(p_company_id uuid,p_project_id uuid,p_work_order_id uuid,p_action text,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare wo public.execution_work_orders%rowtype; next_status text; begin
  select * into wo from public.execution_work_orders where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if wo.id is null then raise exception 'Ordem de serviço não encontrada.'; end if;
  if p_action='start' then
    if not public.has_company_permission(p_company_id,'execution.work_orders.release') or wo.status<>'released' then raise exception 'Ordem não disponível para início.'; end if;
    next_status:='in_progress';
    update public.execution_work_orders set status=next_status,actual_start=coalesce(actual_start,current_date),started_by=coalesce(started_by,auth.uid()),started_at=coalesce(started_at,now()),updated_by=auth.uid(),updated_at=now() where id=wo.id;
  elsif p_action='pause' then
    if not public.has_company_permission(p_company_id,'execution.work_orders.progress') or wo.status<>'in_progress' then raise exception 'Ordem não disponível para pausa.'; end if;
    if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da pausa.'; end if;
    next_status:='paused';
    update public.execution_work_orders set status=next_status,paused_by=auth.uid(),paused_at=now(),pause_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=wo.id;
  elsif p_action='resume' then
    if not public.has_company_permission(p_company_id,'execution.work_orders.progress') or wo.status<>'paused' then raise exception 'Ordem não disponível para retomada.'; end if;
    next_status:='in_progress';
    update public.execution_work_orders set status=next_status,paused_by=null,paused_at=null,pause_reason=null,updated_by=auth.uid(),updated_at=now() where id=wo.id;
  elsif p_action='request_acceptance' then
    if not public.has_company_permission(p_company_id,'execution.work_orders.progress') or wo.status not in ('in_progress','paused') then raise exception 'Ordem não disponível para aceite.'; end if;
    if exists(select 1 from public.execution_work_order_items where work_order_id=wo.id and executed_quantity+0.000001<authorized_quantity) then raise exception 'Conclua as quantidades autorizadas antes de solicitar o aceite.'; end if;
    next_status:='pending_acceptance';
    update public.execution_work_orders set status=next_status,acceptance_requested_by=auth.uid(),acceptance_requested_at=now(),updated_by=auth.uid(),updated_at=now() where id=wo.id;
  elsif p_action='cancel' then
    if not public.has_company_permission(p_company_id,'execution.work_orders.cancel') or wo.status in ('pending_acceptance','finished','cancelled') then raise exception 'Ordem não disponível para cancelamento.'; end if;
    if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
    if wo.measured_value>0 then raise exception 'A ordem possui medição vinculada e não pode ser cancelada.'; end if;
    next_status:='cancelled';
    update public.execution_work_orders set status=next_status,cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=wo.id;
  else raise exception 'Ação inválida para a ordem de serviço.'; end if;
  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,wo.id,p_action,wo.status,next_status,nullif(trim(coalesce(p_reason,'')),''),auth.uid());
  return next_status;
end; $$;

create or replace function public.update_execution_work_order_progress(p_company_id uuid,p_project_id uuid,p_work_order_id uuid,p_items jsonb,p_notes text)
returns numeric language plpgsql security definer set search_path=public as $$
declare wo public.execution_work_orders%rowtype; item jsonb; woi public.execution_work_order_items%rowtype; qty numeric; begin
  if not public.has_company_permission(p_company_id,'execution.work_orders.progress') then raise exception 'Sem permissão para atualizar a execução.'; end if;
  select * into wo from public.execution_work_orders where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if wo.id is null or wo.status not in ('released','in_progress','paused') then raise exception 'Ordem não disponível para atualização.'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception 'Itens de execução inválidos.'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    select * into woi from public.execution_work_order_items where id=nullif(item->>'work_order_item_id','')::uuid and work_order_id=wo.id for update;
    if woi.id is null then raise exception 'Um dos itens não pertence à ordem de serviço.'; end if;
    qty:=coalesce(nullif(item->>'executed_quantity','')::numeric,0);
    if qty<0 or qty>woi.authorized_quantity+0.000001 then raise exception 'A execução do item % deve ficar entre zero e a quantidade autorizada.',woi.service_code; end if;
    update public.execution_work_order_items set executed_quantity=qty,executed_value=round(qty*unit_price,2),updated_at=now() where id=woi.id;
  end loop;
  if wo.status='released' and exists(select 1 from public.execution_work_order_items where work_order_id=wo.id and executed_quantity>0) then
    update public.execution_work_orders set status='in_progress',actual_start=coalesce(actual_start,current_date),started_by=coalesce(started_by,auth.uid()),started_at=coalesce(started_at,now()),notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_by=auth.uid(),updated_at=now() where id=wo.id;
  else
    update public.execution_work_orders set notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_by=auth.uid(),updated_at=now() where id=wo.id;
  end if;
  perform public.refresh_execution_work_order_values(wo.id);
  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,previous_status,new_status,reason,details,changed_by)
  select p_company_id,p_project_id,wo.id,'progress_updated',wo.status,status,nullif(trim(coalesce(p_notes,'')),''),jsonb_build_object('executed_value',executed_value),auth.uid() from public.execution_work_orders where id=wo.id;
  return (select executed_value from public.execution_work_orders where id=wo.id);
end; $$;

create or replace function public.accept_execution_work_order(p_company_id uuid,p_project_id uuid,p_work_order_id uuid,p_result text,p_quality_status text,p_quality_reference text,p_notes text,p_punch_list jsonb)
returns text language plpgsql security definer set search_path=public as $$
declare wo public.execution_work_orders%rowtype; seq integer; begin
  if not public.has_company_permission(p_company_id,'execution.work_orders.accept') then raise exception 'Sem permissão para realizar o aceite.'; end if;
  select * into wo from public.execution_work_orders where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if wo.id is null or wo.status<>'pending_acceptance' then raise exception 'Ordem não disponível para aceite.'; end if;
  if p_result not in ('approved','approved_with_remarks','rejected') then raise exception 'Resultado de aceite inválido.'; end if;
  if p_quality_status not in ('passed','pending','waived') then raise exception 'Situação da qualidade inválida.'; end if;
  if p_result in ('approved','approved_with_remarks') and p_quality_status='pending' then raise exception 'A qualidade deve estar aprovada ou formalmente dispensada para encerrar a ordem.'; end if;
  if p_result in ('rejected','approved_with_remarks') and nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Informe as observações do aceite.'; end if;
  select coalesce(max(sequence_no),0)+1 into seq from public.execution_work_order_acceptances where work_order_id=wo.id;
  insert into public.execution_work_order_acceptances(company_id,project_id,work_order_id,sequence_no,result,quality_status,quality_reference,notes,punch_list,accepted_by)
  values(p_company_id,p_project_id,wo.id,seq,p_result,p_quality_status,nullif(trim(coalesce(p_quality_reference,'')),''),nullif(trim(coalesce(p_notes,'')),''),coalesce(p_punch_list,'[]'::jsonb),auth.uid());
  if p_result='rejected' then
    update public.execution_work_orders set status='in_progress',acceptance_result='rejected',acceptance_notes=trim(p_notes),acceptance_requested_by=null,acceptance_requested_at=null,updated_by=auth.uid(),updated_at=now() where id=wo.id;
  else
    update public.execution_work_order_items set accepted_quantity=executed_quantity,accepted_value=executed_value,updated_at=now() where work_order_id=wo.id;
    update public.execution_work_orders set status='finished',actual_finish=current_date,accepted_by=auth.uid(),accepted_at=now(),acceptance_result=p_result,acceptance_notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=wo.id;
    perform public.refresh_execution_work_order_values(wo.id);
  end if;
  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,previous_status,new_status,reason,details,changed_by)
  values(p_company_id,p_project_id,wo.id,'acceptance',wo.status,case when p_result='rejected' then 'in_progress' else 'finished' end,nullif(trim(coalesce(p_notes,'')),''),jsonb_build_object('result',p_result,'quality_status',p_quality_status,'quality_reference',p_quality_reference),auth.uid());
  return case when p_result='rejected' then 'in_progress' else 'finished' end;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('work-order-documents','work-order-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists work_order_documents_select on storage.objects;
create policy work_order_documents_select on storage.objects for select to authenticated using(bucket_id='work-order-documents' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists work_order_documents_insert on storage.objects;
create policy work_order_documents_insert on storage.objects for insert to authenticated with check(bucket_id='work-order-documents' and (public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.work_orders.manage') or public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.work_orders.progress')));
drop policy if exists work_order_documents_delete on storage.objects;
create policy work_order_documents_delete on storage.objects for delete to authenticated using(bucket_id='work-order-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.work_orders.manage'));

grant select,insert,update,delete on public.execution_work_orders,public.execution_work_order_items,public.execution_work_order_prerequisites,public.execution_work_order_acceptances,public.execution_work_order_documents,public.execution_work_order_audit to authenticated;
grant execute on function public.refresh_execution_work_order_values(uuid) to authenticated;
grant execute on function public.save_execution_work_order(uuid,uuid,uuid,uuid,text,text,date,date,text,text,text,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.release_execution_work_order(uuid,uuid,uuid) to authenticated;
grant execute on function public.change_execution_work_order_status(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.update_execution_work_order_progress(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.accept_execution_work_order(uuid,uuid,uuid,text,text,text,text,jsonb) to authenticated;

commit;
