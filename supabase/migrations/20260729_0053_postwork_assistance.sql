-- Elos OS — Pós-Obra · Assistências Técnicas
-- Chamados, garantia, vistorias, execução, aceite e evidências.

begin;

create table if not exists public.postwork_assistance_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  counter_year integer not null,
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key(company_id, project_id, counter_year)
);

create table if not exists public.postwork_assistance_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  number text not null,
  opened_at date not null default current_date,
  channel text not null default 'internal' check (channel in ('internal','phone','whatsapp','email','portal','in_person','other')),
  scope_type text not null default 'unit' check (scope_type in ('unit','common_area')),
  category text not null check (category in ('waterproofing','hydraulic','electrical','finishes','frames','painting','flooring','equipment','structure','gas','common_area','other')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  title text not null,
  description text not null,
  location_detail text,
  status text not null default 'open' check (status in ('open','triage','inspection_scheduled','awaiting_supplier','approved','in_progress','awaiting_acceptance','resolved','rejected','cancelled')),
  warranty_claimed boolean not null default true,
  warranty_status text not null default 'pending' check (warranty_status in ('pending','covered','not_covered','courtesy','not_applicable')),
  warranty_reason text,
  sla_due_at timestamptz,
  scheduled_at timestamptz,
  responsible_user_id uuid references auth.users(id),
  responsible_name text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  contact_name text,
  contact_phone text,
  contact_email text,
  access_notes text,
  diagnosis text,
  execution_notes text,
  resolution_notes text,
  supplier_cost numeric(16,2) not null default 0 check (supplier_cost >= 0),
  material_cost numeric(16,2) not null default 0 check (material_cost >= 0),
  customer_charge numeric(16,2) not null default 0 check (customer_charge >= 0),
  resolved_at timestamptz,
  accepted_at timestamptz,
  accepted_by_name text,
  customer_rating integer check (customer_rating is null or customer_rating between 1 and 5),
  rejection_reason text,
  cancellation_reason text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, project_id, number),
  check (
    (scope_type = 'unit' and unit_id is not null)
    or (scope_type = 'common_area' and nullif(trim(coalesce(location_detail,'')),'') is not null)
  ),
  check (status <> 'rejected' or nullif(trim(coalesce(rejection_reason,'')),'') is not null),
  check (status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.postwork_assistance_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ticket_id uuid not null references public.postwork_assistance_tickets(id) on delete cascade,
  visit_type text not null default 'inspection' check (visit_type in ('inspection','execution','return','acceptance')),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','completed','no_access','rescheduled','cancelled')),
  technician_name text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  diagnosis text,
  service_performed text,
  materials_used text,
  requires_return boolean not null default false,
  return_recommendation text,
  notes text,
  completed_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create table if not exists public.postwork_assistance_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ticket_id uuid not null references public.postwork_assistance_tickets(id) on delete cascade,
  visit_id uuid references public.postwork_assistance_visits(id) on delete set null,
  document_type text not null default 'evidence' check (document_type in ('opening','inspection','execution','acceptance','invoice','evidence','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique(ticket_id, storage_path)
);

create table if not exists public.postwork_assistance_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ticket_id uuid not null references public.postwork_assistance_tickets(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  notes text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists postwork_assistance_tickets_project_status_idx on public.postwork_assistance_tickets(project_id,status,opened_at desc);
create index if not exists postwork_assistance_tickets_unit_idx on public.postwork_assistance_tickets(unit_id,opened_at desc) where unit_id is not null;
create index if not exists postwork_assistance_tickets_client_idx on public.postwork_assistance_tickets(client_id,opened_at desc) where client_id is not null;
create index if not exists postwork_assistance_tickets_sla_idx on public.postwork_assistance_tickets(company_id,status,sla_due_at) where sla_due_at is not null;
create index if not exists postwork_assistance_visits_ticket_idx on public.postwork_assistance_visits(ticket_id,scheduled_at desc);
create index if not exists postwork_assistance_documents_ticket_idx on public.postwork_assistance_documents(ticket_id,uploaded_at desc);
create index if not exists postwork_assistance_audit_ticket_idx on public.postwork_assistance_audit(ticket_id,changed_at desc);

insert into public.permissions(key,module,action,description) values
  ('postwork.assistance.view','postwork_assistance','view','Visualizar chamados e assistências técnicas'),
  ('postwork.assistance.manage','postwork_assistance','manage','Abrir, editar e classificar chamados técnicos'),
  ('postwork.assistance.inspect','postwork_assistance','inspect','Agendar e registrar vistorias técnicas'),
  ('postwork.assistance.execute','postwork_assistance','execute','Aprovar garantia, executar e registrar custos'),
  ('postwork.assistance.close','postwork_assistance','close','Aceitar, rejeitar, cancelar e encerrar assistências')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values
  ('postwork.assistance.view'),('postwork.assistance.manage'),('postwork.assistance.inspect'),
  ('postwork.assistance.execute'),('postwork.assistance.close')
) p(permission_key)
where r.key in ('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values
  ('postwork.assistance.view'),('postwork.assistance.manage'),('postwork.assistance.inspect'),('postwork.assistance.execute')
) p(permission_key)
where r.key in ('engineering','field')
on conflict(role_id,permission_key) do update set allowed=true;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'postwork.assistance.view',true from public.roles r
where r.key in ('commercial','finance','procurement','viewer')
on conflict(role_id,permission_key) do update set allowed=true;

alter table public.postwork_assistance_counters enable row level security;
alter table public.postwork_assistance_tickets enable row level security;
alter table public.postwork_assistance_visits enable row level security;
alter table public.postwork_assistance_documents enable row level security;
alter table public.postwork_assistance_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['postwork_assistance_tickets','postwork_assistance_visits','postwork_assistance_documents','postwork_assistance_audit'] loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''postwork.assistance.view'') or public.has_company_permission(company_id,''postwork.assistance.manage'') or public.has_company_permission(company_id,''postwork.assistance.inspect'') or public.has_company_permission(company_id,''postwork.assistance.execute'') or public.has_company_permission(company_id,''postwork.assistance.close''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''postwork.assistance.manage'') or public.has_company_permission(company_id,''postwork.assistance.inspect'') or public.has_company_permission(company_id,''postwork.assistance.execute'') or public.has_company_permission(company_id,''postwork.assistance.close'')) with check (public.has_company_permission(company_id,''postwork.assistance.manage'') or public.has_company_permission(company_id,''postwork.assistance.inspect'') or public.has_company_permission(company_id,''postwork.assistance.execute'') or public.has_company_permission(company_id,''postwork.assistance.close''))',t,t);
  end loop;
end $$;

-- Contador acessado somente pela função security definer.
drop policy if exists postwork_assistance_counters_select on public.postwork_assistance_counters;

create or replace function public.postwork_next_assistance_number(p_company_id uuid,p_project_id uuid,p_opened_at date default current_date)
returns text
language plpgsql security definer set search_path=public as $$
declare v_year integer:=extract(year from coalesce(p_opened_at,current_date))::integer; v_number integer;
begin
  if not public.has_company_permission(p_company_id,'postwork.assistance.manage') then raise exception 'Sem permissão para abrir chamados técnicos.'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then raise exception 'Empreendimento inválido.'; end if;
  insert into public.postwork_assistance_counters(company_id,project_id,counter_year,last_number)
  values(p_company_id,p_project_id,v_year,1)
  on conflict(company_id,project_id,counter_year) do update set last_number=public.postwork_assistance_counters.last_number+1,updated_at=now()
  returning last_number into v_number;
  return format('AST-%s-%s',v_year,lpad(v_number::text,4,'0'));
end; $$;

create or replace function public.postwork_assistance_summary(p_company_id uuid,p_project_id uuid default null)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object(
    'total_count',count(*),
    'open_count',count(*) filter(where status in ('open','triage','inspection_scheduled','awaiting_supplier','approved','in_progress','awaiting_acceptance')),
    'urgent_count',count(*) filter(where priority='urgent' and status not in ('resolved','rejected','cancelled')),
    'overdue_count',count(*) filter(where sla_due_at<now() and status not in ('resolved','rejected','cancelled')),
    'scheduled_count',count(*) filter(where status='inspection_scheduled'),
    'in_progress_count',count(*) filter(where status in ('approved','in_progress','awaiting_acceptance')),
    'resolved_count',count(*) filter(where status='resolved'),
    'covered_count',count(*) filter(where warranty_status='covered'),
    'supplier_cost',coalesce(sum(supplier_cost) filter(where status<>'cancelled'),0),
    'material_cost',coalesce(sum(material_cost) filter(where status<>'cancelled'),0),
    'customer_charge',coalesce(sum(customer_charge) filter(where status<>'cancelled'),0),
    'average_rating',round(avg(customer_rating) filter(where customer_rating is not null),2)
  )
  from public.postwork_assistance_tickets
  where company_id=p_company_id
    and (p_project_id is null or project_id=p_project_id)
    and (public.has_company_permission(company_id,'postwork.assistance.view') or public.has_company_permission(company_id,'postwork.assistance.manage'));
$$;

create or replace function public.postwork_set_assistance_status(
  p_company_id uuid,p_ticket_id uuid,p_status text,p_notes text default null,
  p_warranty_status text default null,p_warranty_reason text default null,p_user_id uuid default null
)
returns text language plpgsql security definer set search_path=public as $$
declare t public.postwork_assistance_tickets%rowtype; permission_key text; allowed boolean:=false;
begin
  if p_status not in ('open','triage','inspection_scheduled','awaiting_supplier','approved','in_progress','awaiting_acceptance','resolved','rejected','cancelled') then raise exception 'Situação inválida.'; end if;
  select * into t from public.postwork_assistance_tickets where id=p_ticket_id and company_id=p_company_id for update;
  if t.id is null then raise exception 'Chamado não encontrado.'; end if;
  permission_key:=case
    when p_status in ('open','triage','awaiting_supplier') then 'postwork.assistance.manage'
    when p_status='inspection_scheduled' then 'postwork.assistance.inspect'
    when p_status in ('approved','in_progress','awaiting_acceptance') then 'postwork.assistance.execute'
    else 'postwork.assistance.close' end;
  allowed:=public.has_company_permission(p_company_id,permission_key);
  if not allowed then raise exception 'Sem permissão para esta etapa do chamado.'; end if;
  if t.status in ('resolved','rejected','cancelled') and p_status not in ('triage','in_progress') then raise exception 'O chamado encerrado só pode ser reaberto para triagem ou execução.'; end if;
  if p_status='approved' and coalesce(p_warranty_status,t.warranty_status)='pending' then raise exception 'Defina a análise de garantia antes de aprovar.'; end if;
  if p_status='rejected' and nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Informe o motivo da rejeição.'; end if;
  if p_status='cancelled' and nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  if p_status='resolved' and nullif(trim(coalesce(p_notes,t.resolution_notes,'')),'') is null then raise exception 'Informe a solução executada antes de encerrar.'; end if;

  update public.postwork_assistance_tickets set
    status=p_status,
    warranty_status=coalesce(nullif(p_warranty_status,''),warranty_status),
    warranty_reason=coalesce(nullif(trim(coalesce(p_warranty_reason,'')),''),warranty_reason),
    diagnosis=case when p_status in ('triage','approved','rejected') then coalesce(nullif(trim(coalesce(p_notes,'')),''),diagnosis) else diagnosis end,
    execution_notes=case when p_status in ('in_progress','awaiting_acceptance') then coalesce(nullif(trim(coalesce(p_notes,'')),''),execution_notes) else execution_notes end,
    resolution_notes=case when p_status='resolved' then trim(p_notes) else resolution_notes end,
    rejection_reason=case when p_status='rejected' then trim(p_notes) else null end,
    cancellation_reason=case when p_status='cancelled' then trim(p_notes) else null end,
    resolved_at=case when p_status='resolved' then now() when p_status in ('triage','in_progress') then null else resolved_at end,
    accepted_at=case when p_status='resolved' then now() when p_status in ('triage','in_progress') then null else accepted_at end,
    updated_by=coalesce(p_user_id,auth.uid()),updated_at=now()
  where id=t.id;

  insert into public.postwork_assistance_audit(company_id,project_id,ticket_id,action,previous_status,new_status,notes,details,changed_by)
  values(t.company_id,t.project_id,t.id,'status_changed',t.status,p_status,nullif(trim(coalesce(p_notes,'')),''),jsonb_build_object('warranty_status',coalesce(nullif(p_warranty_status,''),t.warranty_status),'warranty_reason',p_warranty_reason),coalesce(p_user_id,auth.uid()));
  return p_status;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('postwork-assistance','postwork-assistance',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists postwork_assistance_storage_select on storage.objects;
create policy postwork_assistance_storage_select on storage.objects for select to authenticated using(bucket_id='postwork-assistance' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists postwork_assistance_storage_insert on storage.objects;
create policy postwork_assistance_storage_insert on storage.objects for insert to authenticated with check(bucket_id='postwork-assistance' and (public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.assistance.manage') or public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.assistance.inspect') or public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.assistance.execute')));
drop policy if exists postwork_assistance_storage_delete on storage.objects;
create policy postwork_assistance_storage_delete on storage.objects for delete to authenticated using(bucket_id='postwork-assistance' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'postwork.assistance.manage'));

grant select,insert,update,delete on public.postwork_assistance_tickets,public.postwork_assistance_visits,public.postwork_assistance_documents,public.postwork_assistance_audit to authenticated;
grant execute on function public.postwork_next_assistance_number(uuid,uuid,date) to authenticated;
grant execute on function public.postwork_assistance_summary(uuid,uuid) to authenticated;
grant execute on function public.postwork_set_assistance_status(uuid,uuid,text,text,text,text,uuid) to authenticated;

commit;
