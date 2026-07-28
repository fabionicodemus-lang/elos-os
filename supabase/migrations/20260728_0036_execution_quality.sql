-- Elos OS — Execução · Qualidade
-- Checklists versionados, vistorias, não conformidades, bloqueios e reinspeções.

begin;

create table if not exists public.quality_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  responsible_engineer_user_id uuid references auth.users(id),
  first_inspection_weight numeric(6,3) not null default 85 check (first_inspection_weight between 0 and 100),
  on_time_correction_weight numeric(6,3) not null default 10 check (on_time_correction_weight between 0 and 100),
  non_recurrence_weight numeric(6,3) not null default 5 check (non_recurrence_weight between 0 and 100),
  critical_due_hours integer not null default 24 check (critical_due_hours > 0),
  serious_due_days integer not null default 3 check (serious_due_days > 0),
  light_due_days integer not null default 7 check (light_due_days > 0),
  auto_sync boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id),
  constraint quality_settings_weights_check check (abs(first_inspection_weight + on_time_correction_weight + non_recurrence_weight - 100) <= 0.01)
);

create table if not exists public.quality_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  service_id uuid references public.engineering_services(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  criticality text not null default 'medium' check (criticality in ('low','medium','high','critical')),
  service_weight numeric(9,4) not null default 1 check (service_weight > 0),
  inspection_unit text not null default 'local',
  periodicity text not null default 'per_activity',
  sampling_rule text,
  evidence_rule text,
  has_blocking_gate boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  current_version_id uuid,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists public.quality_checklist_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_id uuid not null references public.quality_checklist_templates(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null default 'published' check (status in ('draft','published','retired')),
  change_notes text,
  effective_from date not null default current_date,
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(template_id, version_no)
);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='quality_templates_current_version_fk') then
    alter table public.quality_checklist_templates
      add constraint quality_templates_current_version_fk foreign key(current_version_id)
      references public.quality_checklist_versions(id) on delete set null;
  end if;
end $$;

create table if not exists public.quality_checklist_criteria (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version_id uuid not null references public.quality_checklist_versions(id) on delete cascade,
  group_name text not null default 'Verificação',
  code text not null,
  description text not null,
  verification_method text,
  acceptance_criterion text,
  verification_moment text,
  weight integer not null default 1 check (weight between 1 and 5),
  failure_severity text not null default 'light' check (failure_severity in ('light','serious','critical')),
  is_blocking boolean not null default false,
  requires_photo boolean not null default false,
  requires_measurement boolean not null default false,
  measurement_unit text,
  allow_reservation boolean not null default true,
  is_required boolean not null default true,
  guidance text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(version_id, code)
);

create table if not exists public.quality_inspection_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  template_id uuid not null references public.quality_checklist_templates(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  event_type text not null default 'scheduled_start' check (event_type in ('scheduled_start','actual_start','activity_completion','location_advance','prototype','pre_hide','test','successor_release','manual')),
  stage_name text not null,
  due_offset_days integer not null default 0,
  location_scope text not null default 'activity_location' check (location_scope in ('activity_location','project','manual')),
  only_first_location boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, template_id, service_id, event_type, stage_name)
);

create table if not exists public.quality_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  template_id uuid not null references public.quality_checklist_templates(id) on delete restrict,
  checklist_version_id uuid not null references public.quality_checklist_versions(id) on delete restrict,
  rule_id uuid references public.quality_inspection_rules(id) on delete set null,
  schedule_activity_id uuid references public.engineering_schedule_activities(id) on delete set null,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  stage_name text not null,
  tower text,
  unit_name text,
  environment_name text,
  executor_team text,
  responsible_engineer_user_id uuid not null references auth.users(id),
  inspection_number text not null,
  origin text not null default 'manual',
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','in_progress','approved','approved_with_reservations','nonconforming','blocked','awaiting_reinspection','closed','cancelled')),
  completion_percent numeric(6,2) not null default 0 check (completion_percent between 0 and 100),
  current_score numeric(6,2) check (current_score is null or current_score between 0 and 100),
  first_inspection_score numeric(6,2) check (first_inspection_score is null or first_inspection_score between 0 and 100),
  release_status text not null default 'pending' check (release_status in ('pending','released','blocked','exception')),
  general_notes text,
  executor_confirmed boolean not null default false,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancellation_reason text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, inspection_number)
);

create unique index if not exists quality_inspections_logical_unique
on public.quality_inspections(
  project_id, service_id, stage_name,
  coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(schedule_activity_id, '00000000-0000-0000-0000-000000000000'::uuid),
  checklist_version_id
) where status <> 'cancelled';

create index if not exists quality_inspections_project_status_idx on public.quality_inspections(project_id,status,due_date);
create index if not exists quality_inspections_responsible_idx on public.quality_inspections(responsible_engineer_user_id,status,due_date);
create index if not exists quality_inspections_location_idx on public.quality_inspections(project_id,location_id,service_id);

create table if not exists public.quality_inspection_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null references public.quality_inspections(id) on delete cascade,
  criterion_id uuid not null references public.quality_checklist_criteria(id) on delete restrict,
  group_name_snapshot text not null,
  code_snapshot text not null,
  description_snapshot text not null,
  verification_method_snapshot text,
  acceptance_criterion_snapshot text,
  weight_snapshot integer not null,
  failure_severity_snapshot text not null,
  is_blocking_snapshot boolean not null,
  requires_photo_snapshot boolean not null,
  requires_measurement_snapshot boolean not null,
  measurement_unit_snapshot text,
  allow_reservation_snapshot boolean not null,
  is_required_snapshot boolean not null,
  guidance_snapshot text,
  response text check (response is null or response in ('conforming','reservation','nonconforming','not_applicable')),
  measurement_value numeric(18,6),
  observation text,
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(inspection_id, criterion_id)
);

create table if not exists public.quality_nonconformities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null references public.quality_inspections(id) on delete restrict,
  inspection_item_id uuid not null references public.quality_inspection_items(id) on delete restrict,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  nc_number text not null,
  description text not null,
  severity text not null check (severity in ('light','serious','critical')),
  is_blocking boolean not null default false,
  responsible_user_id uuid references auth.users(id),
  responsible_team text,
  opened_at timestamptz not null default now(),
  due_at timestamptz not null,
  due_change_reason text,
  probable_cause text,
  corrective_action text,
  estimated_rework_cost numeric(18,2) not null default 0 check (estimated_rework_cost >= 0),
  correction_report text,
  correction_reported_at timestamptz,
  correction_reported_by uuid references auth.users(id),
  status text not null default 'open' check (status in ('open','in_correction','awaiting_reinspection','closed','overdue')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,nc_number),
  unique(inspection_item_id)
);

create index if not exists quality_nc_project_status_idx on public.quality_nonconformities(project_id,status,due_at);

create table if not exists public.quality_reinspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  nonconformity_id uuid not null references public.quality_nonconformities(id) on delete restrict,
  inspection_id uuid not null references public.quality_inspections(id) on delete restrict,
  sequence_no integer not null,
  result text not null check (result in ('approved','rejected')),
  notes text not null,
  reinspected_by uuid not null references auth.users(id),
  reinspected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(nonconformity_id,sequence_no)
);

create table if not exists public.quality_service_releases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid not null references public.quality_inspections(id) on delete restrict,
  schedule_activity_id uuid references public.engineering_schedule_activities(id) on delete set null,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  status text not null check (status in ('blocked','released','exception')),
  reason text,
  released_by uuid references auth.users(id),
  released_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists quality_releases_current_idx on public.quality_service_releases(project_id,service_id,location_id,created_at desc);

create table if not exists public.quality_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  inspection_id uuid references public.quality_inspections(id) on delete cascade,
  inspection_item_id uuid references public.quality_inspection_items(id) on delete cascade,
  nonconformity_id uuid references public.quality_nonconformities(id) on delete cascade,
  reinspection_id uuid references public.quality_reinspections(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  attachment_type text not null default 'evidence' check (attachment_type in ('evidence','nonconformity','correction','reinspection')),
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique(storage_path),
  constraint quality_attachment_parent_check check (
    inspection_id is not null or inspection_item_id is not null or nonconformity_id is not null or reinspection_id is not null
  )
);

create table if not exists public.quality_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  inspection_id uuid references public.quality_inspections(id) on delete cascade,
  nonconformity_id uuid references public.quality_nonconformities(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.quality_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  checklist_version_id uuid references public.quality_checklist_versions(id) on delete set null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

insert into public.permissions(key,module,action,description) values
 ('execution.quality.view','execution_quality','view','Visualizar Qualidade na Execução'),
 ('execution.quality.fill','execution_quality','fill','Preencher vistorias de qualidade'),
 ('execution.quality.complete','execution_quality','complete','Concluir vistorias de qualidade'),
 ('execution.quality.nonconformity','execution_quality','nonconformity','Gerenciar não conformidades e correções'),
 ('execution.quality.reinspect','execution_quality','reinspect','Realizar reinspeções'),
 ('execution.quality.cancel','execution_quality','cancel','Cancelar vistorias com justificativa'),
 ('execution.quality.exception','execution_quality','exception','Liberar serviço por exceção'),
 ('execution.quality.templates','execution_quality','templates','Cadastrar e versionar modelos de checklist'),
 ('execution.quality.settings','execution_quality','settings','Alterar regras e configurações da qualidade'),
 ('execution.quality.indicators','execution_quality','indicators','Visualizar indicadores de qualidade')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join (values
 ('execution.quality.view'),('execution.quality.fill'),('execution.quality.complete'),('execution.quality.nonconformity'),
 ('execution.quality.reinspect'),('execution.quality.cancel'),('execution.quality.exception'),('execution.quality.templates'),
 ('execution.quality.settings'),('execution.quality.indicators')) p(permission_key)
where r.key in ('owner','admin','director','engineering')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join (values
 ('execution.quality.view'),('execution.quality.fill'),('execution.quality.nonconformity')) p(permission_key)
where r.key='field'
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join (values
 ('execution.quality.view'),('execution.quality.indicators')) p(permission_key)
where r.key in ('viewer','finance','procurement')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.quality_settings enable row level security;
alter table public.quality_checklist_templates enable row level security;
alter table public.quality_checklist_versions enable row level security;
alter table public.quality_checklist_criteria enable row level security;
alter table public.quality_inspection_rules enable row level security;
alter table public.quality_inspections enable row level security;
alter table public.quality_inspection_items enable row level security;
alter table public.quality_nonconformities enable row level security;
alter table public.quality_reinspections enable row level security;
alter table public.quality_service_releases enable row level security;
alter table public.quality_attachments enable row level security;
alter table public.quality_notifications enable row level security;
alter table public.quality_audit_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'quality_settings','quality_checklist_templates','quality_checklist_versions','quality_checklist_criteria',
    'quality_inspection_rules','quality_inspections','quality_inspection_items','quality_nonconformities',
    'quality_reinspections','quality_service_releases','quality_attachments','quality_notifications','quality_audit_logs'
  ] loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''execution.quality.view'') or public.has_company_permission(company_id,''execution.quality.fill'') or public.has_company_permission(company_id,''execution.quality.templates''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''execution.quality.fill'') or public.has_company_permission(company_id,''execution.quality.complete'') or public.has_company_permission(company_id,''execution.quality.nonconformity'') or public.has_company_permission(company_id,''execution.quality.templates'') or public.has_company_permission(company_id,''execution.quality.settings'')) with check (public.has_company_permission(company_id,''execution.quality.fill'') or public.has_company_permission(company_id,''execution.quality.complete'') or public.has_company_permission(company_id,''execution.quality.nonconformity'') or public.has_company_permission(company_id,''execution.quality.templates'') or public.has_company_permission(company_id,''execution.quality.settings''))',t,t);
  end loop;
end $$;

create or replace function public.quality_next_number(p_project_id uuid,p_prefix text,p_table text)
returns text language plpgsql security definer set search_path=public as $$
declare n integer; begin
  perform pg_advisory_xact_lock(hashtext(p_project_id::text||p_prefix));
  if p_table='inspection' then select count(*)+1 into n from public.quality_inspections where project_id=p_project_id;
  else select count(*)+1 into n from public.quality_nonconformities where project_id=p_project_id; end if;
  return p_prefix||'-'||lpad(n::text,5,'0');
end $$;

create or replace function public.quality_populate_inspection_items(p_inspection_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare n integer; begin
  insert into public.quality_inspection_items(
    company_id,project_id,inspection_id,criterion_id,group_name_snapshot,code_snapshot,description_snapshot,
    verification_method_snapshot,acceptance_criterion_snapshot,weight_snapshot,failure_severity_snapshot,is_blocking_snapshot,
    requires_photo_snapshot,requires_measurement_snapshot,measurement_unit_snapshot,allow_reservation_snapshot,
    is_required_snapshot,guidance_snapshot,sort_order)
  select i.company_id,i.project_id,i.id,c.id,c.group_name,c.code,c.description,c.verification_method,c.acceptance_criterion,
    c.weight,c.failure_severity,c.is_blocking,c.requires_photo,c.requires_measurement,c.measurement_unit,
    c.allow_reservation,c.is_required,c.guidance,c.sort_order
  from public.quality_inspections i join public.quality_checklist_criteria c on c.version_id=i.checklist_version_id
  where i.id=p_inspection_id
  on conflict(inspection_id,criterion_id) do nothing;
  get diagnostics n=row_count; return n;
end $$;

create or replace function public.refresh_quality_inspection(p_inspection_id uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare i public.quality_inspections%rowtype; total_required integer; complete_required integer; score_num numeric;score_den numeric; percent numeric; score numeric; begin
  select * into i from public.quality_inspections where id=p_inspection_id for update;
  if i.id is null then raise exception 'Vistoria não encontrada.'; end if;

  select count(*),count(*) filter(where
    (not item.is_required_snapshot) or (
      item.response is not null
      and (not item.requires_measurement_snapshot or item.measurement_value is not null)
      and (item.response not in ('reservation','nonconforming') or nullif(trim(coalesce(item.observation,'')),'') is not null)
      and (not item.requires_photo_snapshot or exists(select 1 from public.quality_attachments a where a.inspection_item_id=item.id))
    )
  ),
  sum(case item.response when 'conforming' then 100*item.weight_snapshot when 'reservation' then 70*item.weight_snapshot when 'nonconforming' then 0 else 0 end) filter(where item.response is not null and item.response<>'not_applicable'),
  sum(item.weight_snapshot) filter(where item.response is not null and item.response<>'not_applicable')
  into total_required,complete_required,score_num,score_den
  from public.quality_inspection_items item where item.inspection_id=i.id and item.is_required_snapshot;

  percent:=case when total_required=0 then 0 else round(complete_required::numeric/total_required*100,2) end;
  score:=case when coalesce(score_den,0)=0 then null else round(score_num/score_den,2) end;
  update public.quality_inspections set completion_percent=percent,current_score=score,
    status=case when status in ('approved','approved_with_reservations','nonconforming','blocked','awaiting_reinspection','closed','cancelled') then status when percent=0 then 'pending' else 'in_progress' end,
    started_at=case when percent>0 then coalesce(started_at,now()) else started_at end,updated_at=now()
  where id=i.id;
  return percent;
end $$;

create or replace function public.save_quality_template(
  p_company_id uuid,p_template_id uuid,p_service_id uuid,p_code text,p_name text,p_description text,
  p_criticality text,p_service_weight numeric,p_inspection_unit text,p_periodicity text,p_sampling_rule text,
  p_evidence_rule text,p_has_blocking_gate boolean,p_change_notes text,p_criteria jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare template_id uuid;version_id uuid;version_no integer;item jsonb;idx integer:=0; begin
  if not public.has_company_permission(p_company_id,'execution.quality.templates') then raise exception 'Sem permissão para cadastrar modelos.'; end if;
  if nullif(trim(p_code),'') is null or nullif(trim(p_name),'') is null then raise exception 'Informe código e nome do modelo.'; end if;
  if jsonb_typeof(p_criteria)<>'array' or jsonb_array_length(p_criteria)=0 then raise exception 'Cadastre pelo menos um critério.'; end if;

  if p_template_id is null then
    insert into public.quality_checklist_templates(company_id,service_id,code,name,description,criticality,service_weight,inspection_unit,periodicity,sampling_rule,evidence_rule,has_blocking_gate,created_by,updated_by)
    values(p_company_id,p_service_id,upper(trim(p_code)),trim(p_name),nullif(trim(coalesce(p_description,'')),''),p_criticality,coalesce(p_service_weight,1),coalesce(nullif(trim(p_inspection_unit),''),'local'),coalesce(nullif(trim(p_periodicity),''),'per_activity'),nullif(trim(coalesce(p_sampling_rule,'')),''),nullif(trim(coalesce(p_evidence_rule,'')),''),coalesce(p_has_blocking_gate,false),auth.uid(),auth.uid()) returning id into template_id;
  else
    select id into template_id from public.quality_checklist_templates where id=p_template_id and company_id=p_company_id for update;
    if template_id is null then raise exception 'Modelo não encontrado.'; end if;
    update public.quality_checklist_templates set service_id=p_service_id,code=upper(trim(p_code)),name=trim(p_name),description=nullif(trim(coalesce(p_description,'')),''),criticality=p_criticality,service_weight=coalesce(p_service_weight,1),inspection_unit=coalesce(nullif(trim(p_inspection_unit),''),'local'),periodicity=coalesce(nullif(trim(p_periodicity),''),'per_activity'),sampling_rule=nullif(trim(coalesce(p_sampling_rule,'')),''),evidence_rule=nullif(trim(coalesce(p_evidence_rule,'')),''),has_blocking_gate=coalesce(p_has_blocking_gate,false),updated_by=auth.uid(),updated_at=now() where id=template_id;
  end if;

  select coalesce(max(v.version_no),0)+1 into version_no from public.quality_checklist_versions v where v.template_id=template_id;
  update public.quality_checklist_versions set status='retired' where template_id=template_id and status='published';
  insert into public.quality_checklist_versions(company_id,template_id,version_no,status,change_notes,published_by,published_at,created_by)
  values(p_company_id,template_id,version_no,'published',nullif(trim(coalesce(p_change_notes,'')),''),auth.uid(),now(),auth.uid()) returning id into version_id;

  for item in select value from jsonb_array_elements(p_criteria) loop
    idx:=idx+1;
    insert into public.quality_checklist_criteria(company_id,version_id,group_name,code,description,verification_method,acceptance_criterion,verification_moment,weight,failure_severity,is_blocking,requires_photo,requires_measurement,measurement_unit,allow_reservation,is_required,guidance,sort_order)
    values(p_company_id,version_id,coalesce(nullif(trim(item->>'group_name'),''),'Verificação'),coalesce(nullif(upper(trim(item->>'code')),''),'C'||lpad(idx::text,3,'0')),trim(item->>'description'),nullif(trim(coalesce(item->>'verification_method','')),''),nullif(trim(coalesce(item->>'acceptance_criterion','')),''),nullif(trim(coalesce(item->>'verification_moment','')),''),coalesce(nullif(item->>'weight','')::integer,1),coalesce(nullif(item->>'failure_severity',''),'light'),coalesce((item->>'is_blocking')::boolean,false),coalesce((item->>'requires_photo')::boolean,false),coalesce((item->>'requires_measurement')::boolean,false),nullif(trim(coalesce(item->>'measurement_unit','')),''),coalesce((item->>'allow_reservation')::boolean,true),coalesce((item->>'is_required')::boolean,true),nullif(trim(coalesce(item->>'guidance','')),''),idx);
  end loop;
  update public.quality_checklist_templates set current_version_id=version_id,updated_at=now() where id=template_id;
  insert into public.quality_audit_logs(company_id,entity_type,entity_id,action,new_value,checklist_version_id,changed_by) values(p_company_id,'template',template_id,'published_version',jsonb_build_object('version',version_no),version_id,auth.uid());
  return template_id;
end $$;

create or replace function public.sync_quality_inspections(p_company_id uuid,p_project_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare r record;inspection_id uuid;responsible uuid;created_count integer:=0;due date; begin
  if not public.has_company_permission(p_company_id,'execution.quality.fill') and not public.has_company_permission(p_company_id,'execution.quality.settings') then raise exception 'Sem permissão para sincronizar vistorias.'; end if;
  select responsible_engineer_user_id into responsible from public.quality_settings where project_id=p_project_id and company_id=p_company_id;
  responsible:=coalesce(responsible,auth.uid());
  if responsible is null then raise exception 'Configure o engenheiro responsável pela obra.'; end if;

  for r in
    select rule.*,t.current_version_id,a.id activity_id,a.location_id,a.planned_start,a.name activity_name
    from public.quality_inspection_rules rule
    join public.quality_checklist_templates t on t.id=rule.template_id and t.status='active' and t.current_version_id is not null
    join public.engineering_schedule_activities a on a.company_id=p_company_id and a.project_id=p_project_id and a.service_id=rule.service_id and a.record_status='active'
    where rule.company_id=p_company_id and rule.active and (rule.project_id is null or rule.project_id=p_project_id)
      and (not rule.only_first_location or a.planned_start=(select min(a2.planned_start) from public.engineering_schedule_activities a2 where a2.company_id=p_company_id and a2.project_id=p_project_id and a2.service_id=rule.service_id and a2.record_status='active'))
  loop
    due:=r.planned_start + r.due_offset_days;
    begin
      insert into public.quality_inspections(company_id,project_id,template_id,checklist_version_id,rule_id,schedule_activity_id,service_id,location_id,stage_name,responsible_engineer_user_id,inspection_number,origin,due_date,created_by,updated_by)
      values(p_company_id,p_project_id,r.template_id,r.current_version_id,r.id,r.activity_id,r.service_id,case when r.location_scope='activity_location' then r.location_id else null end,r.stage_name,responsible,public.quality_next_number(p_project_id,'VIS','inspection'),'Cronograma · '||r.event_type,due,auth.uid(),auth.uid()) returning id into inspection_id;
      perform public.quality_populate_inspection_items(inspection_id);
      insert into public.quality_notifications(company_id,project_id,user_id,inspection_id,notification_type,title,message) values(p_company_id,p_project_id,responsible,inspection_id,'inspection_created','Nova vistoria de qualidade',r.stage_name||' · '||r.activity_name);
      created_count:=created_count+1;
    exception when unique_violation then null; end;
  end loop;
  return created_count;
end $$;

create or replace function public.create_manual_quality_inspection(
  p_company_id uuid,p_project_id uuid,p_template_id uuid,p_schedule_activity_id uuid,p_location_id uuid,
  p_stage_name text,p_supplier_id uuid,p_executor_team text,p_due_date date,p_tower text,p_unit_name text,p_environment_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare t public.quality_checklist_templates%rowtype;a public.engineering_schedule_activities%rowtype;responsible uuid;inspection_id uuid; begin
  if not public.has_company_permission(p_company_id,'execution.quality.fill') then raise exception 'Sem permissão para criar vistorias.'; end if;
  select * into t from public.quality_checklist_templates where id=p_template_id and company_id=p_company_id and status='active';
  if t.id is null or t.current_version_id is null then raise exception 'Selecione um modelo publicado.'; end if;
  if p_schedule_activity_id is not null then select * into a from public.engineering_schedule_activities where id=p_schedule_activity_id and company_id=p_company_id and project_id=p_project_id; end if;
  select responsible_engineer_user_id into responsible from public.quality_settings where project_id=p_project_id and company_id=p_company_id;
  responsible:=coalesce(responsible,auth.uid());
  insert into public.quality_inspections(company_id,project_id,template_id,checklist_version_id,schedule_activity_id,service_id,location_id,supplier_id,stage_name,tower,unit_name,environment_name,executor_team,responsible_engineer_user_id,inspection_number,origin,due_date,created_by,updated_by)
  values(p_company_id,p_project_id,t.id,t.current_version_id,a.id,coalesce(a.service_id,t.service_id),coalesce(p_location_id,a.location_id),p_supplier_id,trim(p_stage_name),nullif(trim(coalesce(p_tower,'')),''),nullif(trim(coalesce(p_unit_name,'')),''),nullif(trim(coalesce(p_environment_name,'')),''),nullif(trim(coalesce(p_executor_team,'')),''),responsible,public.quality_next_number(p_project_id,'VIS','inspection'),'Criação manual',p_due_date,auth.uid(),auth.uid()) returning id into inspection_id;
  perform public.quality_populate_inspection_items(inspection_id);
  return inspection_id;
end $$;

create or replace function public.save_quality_inspection(
  p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_supplier_id uuid,p_executor_team text,p_general_notes text,p_executor_confirmed boolean,p_answers jsonb)
returns numeric language plpgsql security definer set search_path=public as $$
declare i public.quality_inspections%rowtype;answer jsonb;item public.quality_inspection_items%rowtype;settings public.quality_settings%rowtype;due timestamptz;severity text; begin
  if not public.has_company_permission(p_company_id,'execution.quality.fill') then raise exception 'Sem permissão para preencher vistorias.'; end if;
  select * into i from public.quality_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if i.id is null then raise exception 'Vistoria não encontrada.'; end if;
  if i.status not in ('pending','in_progress') then raise exception 'Esta vistoria está bloqueada para edição.'; end if;
  select * into settings from public.quality_settings where project_id=p_project_id;
  update public.quality_inspections set supplier_id=p_supplier_id,executor_team=nullif(trim(coalesce(p_executor_team,'')),''),general_notes=nullif(trim(coalesce(p_general_notes,'')),''),executor_confirmed=coalesce(p_executor_confirmed,false),updated_by=auth.uid(),updated_at=now() where id=i.id;

  for answer in select value from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) loop
    select * into item from public.quality_inspection_items where id=(answer->>'item_id')::uuid and inspection_id=i.id for update;
    if item.id is null then continue; end if;
    if answer->>'response'='reservation' and (not item.allow_reservation_snapshot or item.failure_severity_snapshot='critical') then raise exception 'O critério % não permite ressalva.',item.code_snapshot; end if;
    update public.quality_inspection_items set response=nullif(answer->>'response',''),measurement_value=nullif(answer->>'measurement_value','')::numeric,observation=nullif(trim(coalesce(answer->>'observation','')),''),answered_by=auth.uid(),answered_at=case when nullif(answer->>'response','') is null then null else now() end,updated_at=now() where id=item.id;
    if answer->>'response'='nonconforming' then
      severity:=item.failure_severity_snapshot;
      due:=case severity when 'critical' then now()+make_interval(hours=>coalesce(settings.critical_due_hours,24)) when 'serious' then now()+make_interval(days=>coalesce(settings.serious_due_days,3)) else now()+make_interval(days=>coalesce(settings.light_due_days,7)) end;
      insert into public.quality_nonconformities(company_id,project_id,inspection_id,inspection_item_id,service_id,location_id,supplier_id,nc_number,description,severity,is_blocking,responsible_team,due_at,status,created_by,updated_by)
      values(p_company_id,p_project_id,i.id,item.id,i.service_id,i.location_id,p_supplier_id,public.quality_next_number(p_project_id,'NC','nc'),coalesce(nullif(trim(answer->>'observation'),''),'Não conformidade no critério: '||item.description_snapshot),severity,item.is_blocking_snapshot or severity='critical',nullif(trim(coalesce(p_executor_team,'')),''),due,'open',auth.uid(),auth.uid())
      on conflict(inspection_item_id) do update set description=excluded.description,severity=excluded.severity,is_blocking=excluded.is_blocking,supplier_id=excluded.supplier_id,responsible_team=excluded.responsible_team,updated_by=auth.uid(),updated_at=now();
    end if;
  end loop;
  return public.refresh_quality_inspection(i.id);
end $$;

create or replace function public.complete_quality_inspection(p_company_id uuid,p_project_id uuid,p_inspection_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare i public.quality_inspections%rowtype;percent numeric;has_critical boolean;has_nc boolean;has_reservation boolean;next_status text;release text; begin
  if not public.has_company_permission(p_company_id,'execution.quality.complete') then raise exception 'Sem permissão para concluir vistorias.'; end if;
  percent:=public.refresh_quality_inspection(p_inspection_id);
  select * into i from public.quality_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if percent<100 then raise exception 'Preencha todos os critérios obrigatórios, medições, observações e fotos. Progresso atual: %%%.',percent; end if;
  if not i.executor_confirmed then raise exception 'Confirme a equipe executora e a conclusão do preenchimento.'; end if;
  if exists(select 1 from public.quality_inspection_items where inspection_id=i.id and response='nonconforming' and not exists(select 1 from public.quality_nonconformities n where n.inspection_item_id=quality_inspection_items.id)) then raise exception 'Todo item não conforme precisa possuir uma não conformidade aberta.'; end if;
  select exists(select 1 from public.quality_nonconformities where inspection_id=i.id and status<>'closed' and (severity='critical' or is_blocking)),exists(select 1 from public.quality_nonconformities where inspection_id=i.id and status<>'closed'),exists(select 1 from public.quality_inspection_items where inspection_id=i.id and response='reservation') into has_critical,has_nc,has_reservation;
  next_status:=case when has_critical then 'blocked' when has_nc then 'nonconforming' when has_reservation then 'approved_with_reservations' else 'approved' end;
  release:=case when has_critical then 'blocked' else 'released' end;
  update public.quality_inspections set status=next_status,release_status=release,first_inspection_score=coalesce(first_inspection_score,current_score),completed_at=now(),completed_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=i.id;
  insert into public.quality_service_releases(company_id,project_id,inspection_id,schedule_activity_id,service_id,location_id,status,reason,released_by,released_at,created_by) values(p_company_id,p_project_id,i.id,i.schedule_activity_id,i.service_id,i.location_id,release,case when has_critical then 'Não conformidade crítica ou bloqueante' else 'Vistoria concluída' end,auth.uid(),case when release='released' then now() else null end,auth.uid());
  insert into public.quality_audit_logs(company_id,project_id,entity_type,entity_id,action,new_value,checklist_version_id,changed_by) values(p_company_id,p_project_id,'inspection',i.id,'completed',jsonb_build_object('status',next_status,'score',i.current_score,'release',release),i.checklist_version_id,auth.uid());
  return next_status;
end $$;

create or replace function public.report_quality_correction(p_company_id uuid,p_project_id uuid,p_nonconformity_id uuid,p_probable_cause text,p_corrective_action text,p_correction_report text,p_estimated_cost numeric)
returns text language plpgsql security definer set search_path=public as $$
declare n public.quality_nonconformities%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.quality.nonconformity') then raise exception 'Sem permissão para informar correções.'; end if;
  select * into n from public.quality_nonconformities where id=p_nonconformity_id and company_id=p_company_id and project_id=p_project_id for update;
  if n.id is null or n.status='closed' then raise exception 'Não conformidade indisponível.'; end if;
  if nullif(trim(coalesce(p_corrective_action,'')),'') is null or nullif(trim(coalesce(p_correction_report,'')),'') is null then raise exception 'Informe a ação corretiva e a evidência textual da correção.'; end if;
  update public.quality_nonconformities set probable_cause=nullif(trim(coalesce(p_probable_cause,'')),''),corrective_action=trim(p_corrective_action),correction_report=trim(p_correction_report),estimated_rework_cost=coalesce(p_estimated_cost,0),correction_reported_at=now(),correction_reported_by=auth.uid(),status='awaiting_reinspection',updated_by=auth.uid(),updated_at=now() where id=n.id;
  update public.quality_inspections set status='awaiting_reinspection',updated_at=now() where id=n.inspection_id;
  return 'awaiting_reinspection';
end $$;

create or replace function public.reinspect_quality_nonconformity(p_company_id uuid,p_project_id uuid,p_nonconformity_id uuid,p_approved boolean,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare n public.quality_nonconformities%rowtype;seq integer;remaining integer;new_status text; begin
  if not public.has_company_permission(p_company_id,'execution.quality.reinspect') then raise exception 'Sem permissão para realizar reinspeções.'; end if;
  if nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Registre o resultado da reinspeção.'; end if;
  select * into n from public.quality_nonconformities where id=p_nonconformity_id and company_id=p_company_id and project_id=p_project_id and status='awaiting_reinspection' for update;
  if n.id is null then raise exception 'A não conformidade não está aguardando reinspeção.'; end if;
  select coalesce(max(sequence_no),0)+1 into seq from public.quality_reinspections where nonconformity_id=n.id;
  insert into public.quality_reinspections(company_id,project_id,nonconformity_id,inspection_id,sequence_no,result,notes,reinspected_by) values(p_company_id,p_project_id,n.id,n.inspection_id,seq,case when p_approved then 'approved' else 'rejected' end,trim(p_notes),auth.uid());
  if p_approved then update public.quality_nonconformities set status='closed',closed_at=now(),closed_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=n.id;
  else update public.quality_nonconformities set status='in_correction',correction_reported_at=null,correction_reported_by=null,updated_by=auth.uid(),updated_at=now() where id=n.id; end if;
  select count(*) into remaining from public.quality_nonconformities where inspection_id=n.inspection_id and status<>'closed';
  if remaining=0 then
    update public.quality_inspections set status='closed',release_status='released',updated_by=auth.uid(),updated_at=now() where id=n.inspection_id;
    insert into public.quality_service_releases(company_id,project_id,inspection_id,schedule_activity_id,service_id,location_id,status,reason,released_by,released_at,created_by) select company_id,project_id,id,schedule_activity_id,service_id,location_id,'released','Correções reinspecionadas e aprovadas',auth.uid(),now(),auth.uid() from public.quality_inspections where id=n.inspection_id;
    new_status:='closed';
  elsif p_approved then new_status:='awaiting_reinspection'; else new_status:='in_correction'; end if;
  return new_status;
end $$;

create or replace function public.exception_release_quality_inspection(p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare i public.quality_inspections%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.quality.exception') then raise exception 'Sem permissão para liberação excepcional.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe a justificativa da liberação excepcional.'; end if;
  select * into i from public.quality_inspections where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id for update;
  if i.id is null or i.release_status<>'blocked' then raise exception 'A vistoria não está bloqueada.'; end if;
  update public.quality_inspections set release_status='exception',updated_by=auth.uid(),updated_at=now() where id=i.id;
  insert into public.quality_service_releases(company_id,project_id,inspection_id,schedule_activity_id,service_id,location_id,status,reason,released_by,released_at,created_by) values(p_company_id,p_project_id,i.id,i.schedule_activity_id,i.service_id,i.location_id,'exception',trim(p_reason),auth.uid(),now(),auth.uid());
  insert into public.quality_audit_logs(company_id,project_id,entity_type,entity_id,action,reason,new_value,checklist_version_id,changed_by) values(p_company_id,p_project_id,'inspection',i.id,'exception_release',trim(p_reason),jsonb_build_object('release_status','exception'),i.checklist_version_id,auth.uid());
  return 'exception';
end $$;

create or replace function public.cancel_quality_inspection(p_company_id uuid,p_project_id uuid,p_inspection_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$ begin
  if not public.has_company_permission(p_company_id,'execution.quality.cancel') then raise exception 'Sem permissão para cancelar vistorias.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe a justificativa.'; end if;
  update public.quality_inspections set status='cancelled',cancellation_reason=trim(p_reason),cancelled_at=now(),cancelled_by=auth.uid(),updated_by=auth.uid(),updated_at=now() where id=p_inspection_id and company_id=p_company_id and project_id=p_project_id and status in ('pending','in_progress');
  if not found then raise exception 'Somente vistorias pendentes ou em preenchimento podem ser canceladas.'; end if;
  return 'cancelled';
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quality-evidence','quality-evidence',false,15728640,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists quality_evidence_select on storage.objects;
create policy quality_evidence_select on storage.objects for select to authenticated using(bucket_id='quality-evidence' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists quality_evidence_insert on storage.objects;
create policy quality_evidence_insert on storage.objects for insert to authenticated with check(bucket_id='quality-evidence' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.quality.fill'));
drop policy if exists quality_evidence_delete on storage.objects;
create policy quality_evidence_delete on storage.objects for delete to authenticated using(bucket_id='quality-evidence' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.quality.fill'));

grant select,insert,update,delete on public.quality_settings,public.quality_checklist_templates,public.quality_checklist_versions,public.quality_checklist_criteria,public.quality_inspection_rules,public.quality_inspections,public.quality_inspection_items,public.quality_nonconformities,public.quality_reinspections,public.quality_service_releases,public.quality_attachments,public.quality_notifications,public.quality_audit_logs to authenticated;
grant execute on function public.quality_next_number(uuid,text,text) to authenticated;
grant execute on function public.quality_populate_inspection_items(uuid) to authenticated;
grant execute on function public.refresh_quality_inspection(uuid) to authenticated;
grant execute on function public.save_quality_template(uuid,uuid,uuid,text,text,text,text,numeric,text,text,text,text,boolean,text,jsonb) to authenticated;
grant execute on function public.sync_quality_inspections(uuid,uuid) to authenticated;
grant execute on function public.create_manual_quality_inspection(uuid,uuid,uuid,uuid,uuid,text,uuid,text,date,text,text,text) to authenticated;
grant execute on function public.save_quality_inspection(uuid,uuid,uuid,uuid,text,text,boolean,jsonb) to authenticated;
grant execute on function public.complete_quality_inspection(uuid,uuid,uuid) to authenticated;
grant execute on function public.report_quality_correction(uuid,uuid,uuid,text,text,text,numeric) to authenticated;
grant execute on function public.reinspect_quality_nonconformity(uuid,uuid,uuid,boolean,text) to authenticated;
grant execute on function public.exception_release_quality_inspection(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.cancel_quality_inspection(uuid,uuid,uuid,text) to authenticated;

commit;
