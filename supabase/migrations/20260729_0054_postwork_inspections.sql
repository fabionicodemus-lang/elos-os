-- Elos OS — Pós-Obra · Vistorias e Chamados
-- Checklists de entrega, pendências, reinspeção, aceite e termo de recebimento.

begin;

create table if not exists public.postwork_inspection_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  counter_year integer not null,
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key(company_id,project_id,counter_year)
);

create table if not exists public.postwork_inspection_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  inspection_type text not null default 'unit_delivery' check (inspection_type in ('unit_pre_delivery','unit_delivery','common_area')),
  version integer not null default 1 check (version > 0),
  instructions text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,project_id,name,version)
);

create table if not exists public.postwork_inspection_template_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  template_id uuid not null references public.postwork_inspection_templates(id) on delete cascade,
  environment text not null,
  code text,
  title text not null,
  criterion text,
  is_mandatory boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.postwork_unit_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  template_id uuid references public.postwork_inspection_templates(id) on delete set null,
  sequence_no integer not null,
  number text not null,
  inspection_type text not null default 'unit_delivery' check (inspection_type in ('unit_pre_delivery','unit_delivery','reinspection')),
  status text not null default 'draft' check (status in ('draft','scheduled','in_progress','pending_corrections','ready_for_reinspection','approved','delivered','cancelled')),
  scheduled_at timestamptz,
  inspector_name text,
  customer_attendee_name text,
  customer_attendee_document text,
  contact_phone text,
  access_notes text,
  general_notes text,
  correction_notes text,
  delivery_notes text,
  started_at timestamptz,
  completed_at timestamptz,
  approved_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  accepted_by_name text,
  accepted_by_document text,
  accepted_at timestamptz,
  customer_rating integer check (customer_rating is null or customer_rating between 1 and 5),
  keys_delivered integer not null default 0 check (keys_delivered >= 0),
  tags_delivered integer not null default 0 check (tags_delivered >= 0),
  water_meter_reading text,
  energy_meter_reading text,
  gas_meter_reading text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,sequence_no),
  unique(company_id,project_id,number),
  check (status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.postwork_unit_inspection_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null references public.postwork_unit_inspections(id) on delete cascade,
  template_item_id uuid references public.postwork_inspection_template_items(id) on delete set null,
  environment text not null,
  code text,
  title text not null,
  criterion text,
  is_mandatory boolean not null default true,
  result text not null default 'pending' check (result in ('pending','conform','nonconform','not_applicable')),
  notes text,
  correction_status text not null default 'none' check (correction_status in ('none','open','corrected','verified','transferred')),
  correction_due_date date,
  correction_responsible_name text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  correction_notes text,
  corrected_at timestamptz,
  corrected_by uuid references auth.users(id),
  verification_notes text,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  assistance_ticket_id uuid references public.postwork_assistance_tickets(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (result = 'nonconform' and correction_status in ('open','corrected','verified','transferred'))
    or (result <> 'nonconform' and correction_status = 'none')
  )
);

create table if not exists public.postwork_inspection_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null references public.postwork_unit_inspections(id) on delete cascade,
  inspection_item_id uuid references public.postwork_unit_inspection_items(id) on delete set null,
  document_type text not null default 'evidence' check (document_type in ('schedule','inspection','nonconformity','correction','reinspection','handover','term','evidence','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique(inspection_id,storage_path)
);

create table if not exists public.postwork_inspection_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null references public.postwork_unit_inspections(id) on delete cascade,
  inspection_item_id uuid references public.postwork_unit_inspection_items(id) on delete set null,
  action text not null,
  previous_status text,
  new_status text,
  notes text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists postwork_inspection_templates_company_idx on public.postwork_inspection_templates(company_id,project_id,status,name);
create index if not exists postwork_inspection_template_items_idx on public.postwork_inspection_template_items(template_id,sort_order);
create index if not exists postwork_unit_inspections_project_idx on public.postwork_unit_inspections(project_id,status,scheduled_at desc);
create index if not exists postwork_unit_inspections_unit_idx on public.postwork_unit_inspections(unit_id,created_at desc);
create index if not exists postwork_unit_inspection_items_idx on public.postwork_unit_inspection_items(inspection_id,environment,sort_order);
create index if not exists postwork_unit_inspection_open_issues_idx on public.postwork_unit_inspection_items(project_id,correction_status,correction_due_date) where result='nonconform';
create index if not exists postwork_inspection_documents_idx on public.postwork_inspection_documents(inspection_id,uploaded_at desc);
create index if not exists postwork_inspection_audit_idx on public.postwork_inspection_audit(inspection_id,changed_at desc);

insert into public.permissions(key,module,action,description) values
  ('postwork.inspections.view','postwork_inspections','view','Visualizar vistorias de entrega e pendências'),
  ('postwork.inspections.manage','postwork_inspections','manage','Criar modelos, agendar e editar vistorias'),
  ('postwork.inspections.fill','postwork_inspections','fill','Preencher checklists e concluir vistorias'),
  ('postwork.inspections.correct','postwork_inspections','correct','Registrar correções e reinspeções'),
  ('postwork.inspections.deliver','postwork_inspections','deliver','Aprovar vistoria e formalizar entrega da unidade')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values
  ('postwork.inspections.view'),('postwork.inspections.manage'),('postwork.inspections.fill'),
  ('postwork.inspections.correct'),('postwork.inspections.deliver')
) p(permission_key)
where r.key in ('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values
  ('postwork.inspections.view'),('postwork.inspections.manage'),('postwork.inspections.fill'),('postwork.inspections.correct')
) p(permission_key)
where r.key in ('engineering','field')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'postwork.inspections.view',true from public.roles r
where r.key in ('commercial','finance','procurement','viewer')
on conflict(role_id,permission_key) do update set allowed=true;

alter table public.postwork_inspection_counters enable row level security;
alter table public.postwork_inspection_templates enable row level security;
alter table public.postwork_inspection_template_items enable row level security;
alter table public.postwork_unit_inspections enable row level security;
alter table public.postwork_unit_inspection_items enable row level security;
alter table public.postwork_inspection_documents enable row level security;
alter table public.postwork_inspection_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'postwork_inspection_templates','postwork_inspection_template_items','postwork_unit_inspections',
    'postwork_unit_inspection_items','postwork_inspection_documents','postwork_inspection_audit'
  ] loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''postwork.inspections.view'') or public.has_company_permission(company_id,''postwork.inspections.manage'') or public.has_company_permission(company_id,''postwork.inspections.fill'') or public.has_company_permission(company_id,''postwork.inspections.correct'') or public.has_company_permission(company_id,''postwork.inspections.deliver''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''postwork.inspections.manage'') or public.has_company_permission(company_id,''postwork.inspections.fill'') or public.has_company_permission(company_id,''postwork.inspections.correct'') or public.has_company_permission(company_id,''postwork.inspections.deliver'')) with check (public.has_company_permission(company_id,''postwork.inspections.manage'') or public.has_company_permission(company_id,''postwork.inspections.fill'') or public.has_company_permission(company_id,''postwork.inspections.correct'') or public.has_company_permission(company_id,''postwork.inspections.deliver''))',t,t);
  end loop;
end $$;

drop policy if exists postwork_inspection_counters_select on public.postwork_inspection_counters;

create or replace function public.postwork_next_inspection_number(p_company_id uuid,p_project_id uuid,p_reference_date date default current_date)
returns table(sequence_no integer,number text)
language plpgsql security definer set search_path=public as $$
declare v_year integer:=extract(year from coalesce(p_reference_date,current_date))::integer; v_number integer;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.manage') then raise exception 'Sem permissão para criar vistorias.'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then raise exception 'Empreendimento inválido.'; end if;
  insert into public.postwork_inspection_counters(company_id,project_id,counter_year,last_number)
  values(p_company_id,p_project_id,v_year,1)
  on conflict(company_id,project_id,counter_year) do update set last_number=public.postwork_inspection_counters.last_number+1,updated_at=now()
  returning last_number into v_number;
  sequence_no:=v_year*100000+v_number;
  number:=format('VIS-%s-%s',v_year,lpad(v_number::text,4,'0'));
  return next;
end; $$;

create or replace function public.save_postwork_inspection_template(
  p_company_id uuid,p_project_id uuid,p_template_id uuid,p_name text,p_inspection_type text,p_instructions text,p_items jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_template public.postwork_inspection_templates%rowtype; v_item jsonb; v_order integer:=0;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.manage') then raise exception 'Sem permissão para gerenciar modelos.'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Informe o nome do modelo.'; end if;
  if p_inspection_type not in ('unit_pre_delivery','unit_delivery','common_area') then raise exception 'Tipo de modelo inválido.'; end if;
  if p_project_id is not null and not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id) then raise exception 'Empreendimento inválido.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'Inclua ao menos um item no checklist.'; end if;

  if p_template_id is null then
    insert into public.postwork_inspection_templates(company_id,project_id,name,inspection_type,instructions,created_by,updated_by)
    values(p_company_id,p_project_id,trim(p_name),p_inspection_type,nullif(trim(coalesce(p_instructions,'')),''),auth.uid(),auth.uid()) returning * into v_template;
  else
    select * into v_template from public.postwork_inspection_templates where id=p_template_id and company_id=p_company_id for update;
    if v_template.id is null then raise exception 'Modelo não localizado.'; end if;
    update public.postwork_inspection_templates set name=trim(p_name),inspection_type=p_inspection_type,instructions=nullif(trim(coalesce(p_instructions,'')),''),updated_by=auth.uid(),updated_at=now() where id=v_template.id returning * into v_template;
    delete from public.postwork_inspection_template_items where template_id=v_template.id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_order:=v_order+1;
    if nullif(trim(coalesce(v_item->>'environment','')),'') is null or nullif(trim(coalesce(v_item->>'title','')),'') is null then raise exception 'Todo item precisa de ambiente e descrição.'; end if;
    insert into public.postwork_inspection_template_items(company_id,project_id,template_id,environment,code,title,criterion,is_mandatory,sort_order)
    values(p_company_id,p_project_id,v_template.id,trim(v_item->>'environment'),nullif(trim(coalesce(v_item->>'code','')),''),trim(v_item->>'title'),nullif(trim(coalesce(v_item->>'criterion','')),''),coalesce((v_item->>'is_mandatory')::boolean,true),v_order);
  end loop;
  return v_template.id;
end; $$;

create or replace function public.create_postwork_unit_inspection(
  p_company_id uuid,p_project_id uuid,p_unit_id uuid,p_client_id uuid,p_template_id uuid,p_inspection_type text,
  p_scheduled_at timestamptz,p_inspector_name text,p_customer_attendee_name text,p_contact_phone text,p_access_notes text,p_general_notes text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_unit public.units%rowtype; v_template public.postwork_inspection_templates%rowtype; v_sale_id uuid; v_sequence integer; v_number text; v_inspection_id uuid;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.manage') then raise exception 'Sem permissão para criar vistorias.'; end if;
  if p_inspection_type not in ('unit_pre_delivery','unit_delivery','reinspection') then raise exception 'Tipo de vistoria inválido.'; end if;
  select * into v_unit from public.units where id=p_unit_id and company_id=p_company_id and project_id=p_project_id and status<>'inactive';
  if v_unit.id is null then raise exception 'Unidade inválida.'; end if;
  select * into v_template from public.postwork_inspection_templates where id=p_template_id and company_id=p_company_id and status='active' and (project_id is null or project_id=p_project_id);
  if v_template.id is null then raise exception 'Modelo de checklist inválido.'; end if;
  if p_client_id is not null and not exists(select 1 from public.clients where id=p_client_id and company_id=p_company_id) then raise exception 'Cliente inválido.'; end if;
  select id into v_sale_id from public.sales where company_id=p_company_id and project_id=p_project_id and unit_id=p_unit_id and status='active' and (p_client_id is null or client_id=p_client_id) order by sale_date desc limit 1;
  select n.sequence_no,n.number into v_sequence,v_number from public.postwork_next_inspection_number(p_company_id,p_project_id,coalesce(p_scheduled_at::date,current_date)) n;

  insert into public.postwork_unit_inspections(company_id,project_id,unit_id,client_id,sale_id,template_id,sequence_no,number,inspection_type,status,scheduled_at,inspector_name,customer_attendee_name,contact_phone,access_notes,general_notes,created_by,updated_by)
  values(p_company_id,p_project_id,p_unit_id,p_client_id,v_sale_id,p_template_id,v_sequence,v_number,p_inspection_type,case when p_scheduled_at is null then 'draft' else 'scheduled' end,p_scheduled_at,nullif(trim(coalesce(p_inspector_name,'')),''),nullif(trim(coalesce(p_customer_attendee_name,'')),''),nullif(trim(coalesce(p_contact_phone,'')),''),nullif(trim(coalesce(p_access_notes,'')),''),nullif(trim(coalesce(p_general_notes,'')),''),auth.uid(),auth.uid()) returning id into v_inspection_id;

  insert into public.postwork_unit_inspection_items(company_id,project_id,inspection_id,template_item_id,environment,code,title,criterion,is_mandatory,sort_order)
  select p_company_id,p_project_id,v_inspection_id,i.id,i.environment,i.code,i.title,i.criterion,i.is_mandatory,i.sort_order from public.postwork_inspection_template_items i where i.template_id=p_template_id order by i.sort_order;

  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,action,new_status,notes,details,changed_by)
  values(p_company_id,p_project_id,v_inspection_id,'created',case when p_scheduled_at is null then 'draft' else 'scheduled' end,'Vistoria criada.',jsonb_build_object('number',v_number,'unit_id',p_unit_id,'template_id',p_template_id),auth.uid());
  return v_inspection_id;
end; $$;

create or replace function public.start_postwork_unit_inspection(p_company_id uuid,p_project_id uuid,p_inspection_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare v_old text;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.fill') then raise exception 'Sem permissão para iniciar a vistoria.'; end if;
  select status into v_old from public.postwork_unit_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_old not in ('draft','scheduled','ready_for_reinspection') then raise exception 'Vistoria não disponível para início.'; end if;
  update public.postwork_unit_inspections set status='in_progress',started_at=coalesce(started_at,now()),updated_by=auth.uid(),updated_at=now() where id=p_inspection_id;
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,p_inspection_id,'started',v_old,'in_progress',auth.uid());
  return 'in_progress';
end; $$;

create or replace function public.complete_postwork_unit_inspection(p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_items jsonb,p_general_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare v_inspection public.postwork_unit_inspections%rowtype; v_item jsonb; v_row public.postwork_unit_inspection_items%rowtype; v_result text; v_status text;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.fill') then raise exception 'Sem permissão para concluir a vistoria.'; end if;
  select * into v_inspection from public.postwork_unit_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_inspection.id is null or v_inspection.status<>'in_progress' then raise exception 'Vistoria não está em preenchimento.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Itens do checklist inválidos.'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_row from public.postwork_unit_inspection_items where id=nullif(v_item->>'item_id','')::uuid and inspection_id=p_inspection_id for update;
    if v_row.id is null then raise exception 'Item do checklist inválido.'; end if;
    v_result:=coalesce(v_item->>'result','pending');
    if v_result not in ('pending','conform','nonconform','not_applicable') then raise exception 'Resultado de checklist inválido.'; end if;
    update public.postwork_unit_inspection_items set
      result=v_result,
      notes=nullif(trim(coalesce(v_item->>'notes','')),''),
      correction_status=case when v_result='nonconform' then 'open' else 'none' end,
      correction_due_date=case when v_result='nonconform' then nullif(v_item->>'correction_due_date','')::date else null end,
      correction_responsible_name=case when v_result='nonconform' then nullif(trim(coalesce(v_item->>'correction_responsible_name','')),'') else null end,
      supplier_id=case when v_result='nonconform' then nullif(v_item->>'supplier_id','')::uuid else null end,
      corrected_at=null,corrected_by=null,verified_at=null,verified_by=null,assistance_ticket_id=null,updated_at=now()
    where id=v_row.id;
  end loop;

  if exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and is_mandatory and result='pending') then raise exception 'Responda todos os itens obrigatórios.'; end if;
  v_status:=case when exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform') then 'pending_corrections' else 'approved' end;
  update public.postwork_unit_inspections set status=v_status,general_notes=coalesce(nullif(trim(coalesce(p_general_notes,'')),''),general_notes),completed_at=now(),approved_at=case when v_status='approved' then now() else null end,updated_by=auth.uid(),updated_at=now() where id=p_inspection_id;
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,action,previous_status,new_status,notes,details,changed_by)
  values(p_company_id,p_project_id,p_inspection_id,'completed',v_inspection.status,v_status,nullif(trim(coalesce(p_general_notes,'')),''),jsonb_build_object('nonconformities',(select count(*) from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform')),auth.uid());
  return v_status;
end; $$;

create or replace function public.mark_postwork_inspection_item_corrected(
  p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_item_id uuid,p_correction_notes text,p_responsible_name text,p_supplier_id uuid
) returns text language plpgsql security definer set search_path=public as $$
declare v_item public.postwork_unit_inspection_items%rowtype; v_status text;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.correct') then raise exception 'Sem permissão para registrar correções.'; end if;
  select * into v_item from public.postwork_unit_inspection_items where id=p_item_id and inspection_id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_item.id is null or v_item.result<>'nonconform' or v_item.correction_status not in ('open','corrected') then raise exception 'Pendência não disponível para correção.'; end if;
  if nullif(trim(coalesce(p_correction_notes,'')),'') is null then raise exception 'Descreva a correção executada.'; end if;
  if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=p_company_id) then raise exception 'Fornecedor inválido.'; end if;
  update public.postwork_unit_inspection_items set correction_status='corrected',correction_notes=trim(p_correction_notes),correction_responsible_name=coalesce(nullif(trim(coalesce(p_responsible_name,'')),''),correction_responsible_name),supplier_id=coalesce(p_supplier_id,supplier_id),corrected_at=now(),corrected_by=auth.uid(),updated_at=now() where id=p_item_id;
  v_status:=case when exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform' and correction_status='open') then 'pending_corrections' else 'ready_for_reinspection' end;
  update public.postwork_unit_inspections set status=v_status,updated_by=auth.uid(),updated_at=now() where id=p_inspection_id and status in ('pending_corrections','ready_for_reinspection');
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,inspection_item_id,action,new_status,notes,changed_by) values(p_company_id,p_project_id,p_inspection_id,p_item_id,'correction_recorded',v_status,trim(p_correction_notes),auth.uid());
  return v_status;
end; $$;

create or replace function public.verify_postwork_inspection_item(
  p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_item_id uuid,p_verification_result text,p_notes text
) returns text language plpgsql security definer set search_path=public as $$
declare v_item public.postwork_unit_inspection_items%rowtype; v_status text;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.correct') then raise exception 'Sem permissão para reinspecionar pendências.'; end if;
  select * into v_item from public.postwork_unit_inspection_items where id=p_item_id and inspection_id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_item.id is null or v_item.result<>'nonconform' or v_item.correction_status<>'corrected' then raise exception 'Pendência não está pronta para verificação.'; end if;
  if p_verification_result not in ('verified','rejected') then raise exception 'Resultado da reinspeção inválido.'; end if;
  if p_verification_result='rejected' and nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Descreva o motivo da reprovação.'; end if;
  update public.postwork_unit_inspection_items set correction_status=case when p_verification_result='verified' then 'verified' else 'open' end,verification_notes=nullif(trim(coalesce(p_notes,'')),''),verified_at=case when p_verification_result='verified' then now() else null end,verified_by=case when p_verification_result='verified' then auth.uid() else null end,updated_at=now() where id=p_item_id;
  v_status:=case when exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform' and correction_status not in ('verified','transferred')) then 'pending_corrections' else 'approved' end;
  update public.postwork_unit_inspections set status=v_status,approved_at=case when v_status='approved' then now() else approved_at end,updated_by=auth.uid(),updated_at=now() where id=p_inspection_id;
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,inspection_item_id,action,new_status,notes,details,changed_by) values(p_company_id,p_project_id,p_inspection_id,p_item_id,'reinspection',v_status,nullif(trim(coalesce(p_notes,'')),''),jsonb_build_object('result',p_verification_result),auth.uid());
  return v_status;
end; $$;

create or replace function public.transfer_postwork_inspection_item_to_assistance(
  p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_item_id uuid,p_priority text,p_due_at timestamptz
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_inspection public.postwork_unit_inspections%rowtype; v_item public.postwork_unit_inspection_items%rowtype; v_ticket_id uuid; v_number text; v_client public.clients%rowtype;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.correct') or not public.has_company_permission(p_company_id,'postwork.assistance.manage') then raise exception 'Sem permissão para transferir a pendência.'; end if;
  if p_priority not in ('low','normal','high','urgent') then raise exception 'Prioridade inválida.'; end if;
  select * into v_inspection from public.postwork_unit_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  select * into v_item from public.postwork_unit_inspection_items where id=p_item_id and inspection_id=p_inspection_id for update;
  if v_inspection.id is null or v_item.id is null or v_item.result<>'nonconform' or v_item.correction_status in ('verified','transferred') then raise exception 'Pendência não disponível para transferência.'; end if;
  select * into v_client from public.clients where id=v_inspection.client_id;
  v_number:=public.postwork_next_assistance_number(p_company_id,p_project_id,current_date);
  insert into public.postwork_assistance_tickets(company_id,project_id,unit_id,client_id,sale_id,number,opened_at,channel,scope_type,category,priority,title,description,location_detail,status,warranty_claimed,warranty_status,sla_due_at,contact_name,contact_phone,diagnosis,created_by,updated_by)
  values(p_company_id,p_project_id,v_inspection.unit_id,v_inspection.client_id,v_inspection.sale_id,v_number,current_date,'internal','unit','finishes',p_priority,concat('Pendência da ',v_inspection.number,' · ',v_item.environment,' · ',v_item.title),concat('Não conformidade identificada na vistoria ',v_inspection.number,'.\nAmbiente: ',v_item.environment,'.\nItem: ',v_item.title,'.\nCritério: ',coalesce(v_item.criterion,'não informado'),'.\nObservação: ',coalesce(v_item.notes,'não informada'),'.'),v_item.environment,'open',true,'pending',coalesce(p_due_at,now()+interval '7 days'),coalesce(v_inspection.customer_attendee_name,v_client.name),coalesce(v_inspection.contact_phone,null),coalesce(v_item.notes,v_item.title),auth.uid(),auth.uid()) returning id into v_ticket_id;
  update public.postwork_unit_inspection_items set correction_status='transferred',assistance_ticket_id=v_ticket_id,updated_at=now() where id=v_item.id;
  update public.postwork_unit_inspections set status=case when exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform' and correction_status not in ('verified','transferred')) then status else 'approved' end,approved_at=case when not exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and result='nonconform' and correction_status not in ('verified','transferred')) then now() else approved_at end,updated_by=auth.uid(),updated_at=now() where id=p_inspection_id;
  insert into public.postwork_assistance_audit(company_id,project_id,ticket_id,action,new_status,notes,details,changed_by) values(p_company_id,p_project_id,v_ticket_id,'opened','open','Gerado a partir de pendência de vistoria.',jsonb_build_object('inspection_id',p_inspection_id,'inspection_item_id',p_item_id),auth.uid());
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,inspection_item_id,action,notes,details,changed_by) values(p_company_id,p_project_id,p_inspection_id,p_item_id,'transferred_to_assistance','Pendência transferida para Assistência Técnica.',jsonb_build_object('ticket_id',v_ticket_id,'ticket_number',v_number),auth.uid());
  return v_ticket_id;
end; $$;

create or replace function public.deliver_postwork_unit_inspection(
  p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_accepted_by_name text,p_accepted_by_document text,p_delivery_notes text,
  p_keys integer,p_tags integer,p_water text,p_energy text,p_gas text,p_rating integer
) returns text language plpgsql security definer set search_path=public as $$
declare v_inspection public.postwork_unit_inspections%rowtype;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.deliver') then raise exception 'Sem permissão para formalizar a entrega.'; end if;
  select * into v_inspection from public.postwork_unit_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_inspection.id is null or v_inspection.status<>'approved' then raise exception 'A vistoria precisa estar aprovada antes da entrega.'; end if;
  if nullif(trim(coalesce(p_accepted_by_name,'')),'') is null then raise exception 'Informe quem recebeu a unidade.'; end if;
  if coalesce(p_keys,0)<0 or coalesce(p_tags,0)<0 then raise exception 'Quantidades de chaves e tags inválidas.'; end if;
  if p_rating is not null and (p_rating<1 or p_rating>5) then raise exception 'Avaliação inválida.'; end if;
  if exists(select 1 from public.postwork_unit_inspection_items where inspection_id=p_inspection_id and (result='pending' or (result='nonconform' and correction_status not in ('verified','transferred')))) then raise exception 'Existem itens pendentes sem solução ou transferência formal.'; end if;
  update public.postwork_unit_inspections set status='delivered',delivered_at=now(),accepted_at=now(),accepted_by_name=trim(p_accepted_by_name),accepted_by_document=nullif(trim(coalesce(p_accepted_by_document,'')),''),delivery_notes=nullif(trim(coalesce(p_delivery_notes,'')),''),keys_delivered=coalesce(p_keys,0),tags_delivered=coalesce(p_tags,0),water_meter_reading=nullif(trim(coalesce(p_water,'')),''),energy_meter_reading=nullif(trim(coalesce(p_energy,'')),''),gas_meter_reading=nullif(trim(coalesce(p_gas,'')),''),customer_rating=p_rating,updated_by=auth.uid(),updated_at=now() where id=p_inspection_id;
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,action,previous_status,new_status,notes,details,changed_by)
  values(p_company_id,p_project_id,p_inspection_id,'delivered',v_inspection.status,'delivered',nullif(trim(coalesce(p_delivery_notes,'')),''),jsonb_build_object('accepted_by',trim(p_accepted_by_name),'keys',coalesce(p_keys,0),'tags',coalesce(p_tags,0),'rating',p_rating),auth.uid());
  return 'delivered';
end; $$;

create or replace function public.cancel_postwork_unit_inspection(p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare v_old text;
begin
  if not public.has_company_permission(p_company_id,'postwork.inspections.manage') then raise exception 'Sem permissão para cancelar a vistoria.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select status into v_old from public.postwork_unit_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_old is null or v_old in ('delivered','cancelled') then raise exception 'Vistoria não disponível para cancelamento.'; end if;
  update public.postwork_unit_inspections set status='cancelled',cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=p_inspection_id;
  insert into public.postwork_inspection_audit(company_id,project_id,inspection_id,action,previous_status,new_status,notes,changed_by) values(p_company_id,p_project_id,p_inspection_id,'cancelled',v_old,'cancelled',trim(p_reason),auth.uid());
  return 'cancelled';
end; $$;

create or replace function public.postwork_inspections_summary(p_company_id uuid,p_project_id uuid default null)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'total_count',count(*),
    'scheduled_count',count(*) filter(where status='scheduled'),
    'in_progress_count',count(*) filter(where status='in_progress'),
    'pending_corrections_count',count(*) filter(where status in ('pending_corrections','ready_for_reinspection')),
    'approved_count',count(*) filter(where status='approved'),
    'delivered_count',count(*) filter(where status='delivered'),
    'open_issue_count',(select count(*) from public.postwork_unit_inspection_items i where i.company_id=p_company_id and (p_project_id is null or i.project_id=p_project_id) and i.result='nonconform' and i.correction_status in ('open','corrected')),
    'overdue_issue_count',(select count(*) from public.postwork_unit_inspection_items i where i.company_id=p_company_id and (p_project_id is null or i.project_id=p_project_id) and i.result='nonconform' and i.correction_status in ('open','corrected') and i.correction_due_date<current_date),
    'average_rating',round(avg(customer_rating) filter(where customer_rating is not null),2)
  ) from public.postwork_unit_inspections where company_id=p_company_id and (p_project_id is null or project_id=p_project_id);
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('postwork-inspections','postwork-inspections',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists postwork_inspections_storage_select on storage.objects;
create policy postwork_inspections_storage_select on storage.objects for select to authenticated using(bucket_id='postwork-inspections' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists postwork_inspections_storage_insert on storage.objects;
create policy postwork_inspections_storage_insert on storage.objects for insert to authenticated with check(bucket_id='postwork-inspections' and (public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.inspections.fill') or public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.inspections.correct') or public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.inspections.deliver')));
drop policy if exists postwork_inspections_storage_delete on storage.objects;
create policy postwork_inspections_storage_delete on storage.objects for delete to authenticated using(bucket_id='postwork-inspections' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.inspections.manage'));

grant select,insert,update,delete on public.postwork_inspection_templates,public.postwork_inspection_template_items,public.postwork_unit_inspections,public.postwork_unit_inspection_items,public.postwork_inspection_documents,public.postwork_inspection_audit to authenticated;
grant execute on function public.postwork_next_inspection_number(uuid,uuid,date) to authenticated;
grant execute on function public.save_postwork_inspection_template(uuid,uuid,uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.create_postwork_unit_inspection(uuid,uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text,text) to authenticated;
grant execute on function public.start_postwork_unit_inspection(uuid,uuid,uuid) to authenticated;
grant execute on function public.complete_postwork_unit_inspection(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.mark_postwork_inspection_item_corrected(uuid,uuid,uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.verify_postwork_inspection_item(uuid,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.transfer_postwork_inspection_item_to_assistance(uuid,uuid,uuid,uuid,text,timestamptz) to authenticated;
grant execute on function public.deliver_postwork_unit_inspection(uuid,uuid,uuid,text,text,text,integer,integer,text,text,text,integer) to authenticated;
grant execute on function public.cancel_postwork_unit_inspection(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.postwork_inspections_summary(uuid,uuid) to authenticated;

commit;
