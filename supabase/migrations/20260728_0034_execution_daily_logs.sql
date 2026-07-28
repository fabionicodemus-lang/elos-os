-- Elos OS — Execução · Diário de Obras
-- Registro oficial diário, versionado e integrado ao cronograma, fornecedores e locais da obra.

begin;

create table if not exists public.execution_daily_log_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workdays smallint[] not null default array[1,2,3,4,5,6]::smallint[],
  default_shift text not null default 'day' check (default_shift in ('day','night')),
  day_end time not null default '18:00',
  auto_create boolean not null default true,
  allow_complementary boolean not null default false,
  required_photo_count integer not null default 1 check (required_photo_count between 0 and 20),
  retroactive_days integer not null default 30 check (retroactive_days between 0 and 3650),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.execution_daily_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  root_log_id uuid references public.execution_daily_logs(id) on delete restrict,
  reopened_from_id uuid references public.execution_daily_logs(id) on delete restrict,
  log_date date not null,
  shift text not null default 'day' check (shift in ('day','night')),
  diary_type text not null default 'principal' check (diary_type in ('principal','complementary')),
  log_number text not null,
  version integer not null default 1 check (version > 0),
  is_current boolean not null default true,
  status text not null default 'pending' check (status in ('pending','in_progress','awaiting_approval','approved','approved_with_reservations','reopened','cancelled')),
  work_start time,
  work_end time,
  general_notes text,
  no_occurrences boolean not null default false,
  no_safety_events boolean not null default false,
  confirmed_by_filler boolean not null default false,
  completion_percent numeric(5,2) not null default 0 check (completion_percent between 0 and 100),
  responsible_user_id uuid not null references auth.users(id),
  responsible_name text not null,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_notes text,
  reopened_by uuid references auth.users(id),
  reopened_at timestamptz,
  reopened_reason text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, log_number, version)
);

create unique index if not exists execution_daily_logs_current_unique
  on public.execution_daily_logs(project_id, log_date, shift, diary_type)
  where is_current = true and status <> 'cancelled';
create index if not exists execution_daily_logs_calendar_idx
  on public.execution_daily_logs(project_id, log_date, is_current, status);

create table if not exists public.execution_daily_log_weather (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  daily_log_id uuid not null references public.execution_daily_logs(id) on delete cascade,
  period text not null check (period in ('morning','afternoon','night')),
  condition text not null check (condition in ('sunny','partly_cloudy','cloudy','rain','storm','windy','fog')),
  temperature_c numeric(5,2),
  rain_mm numeric(10,2) not null default 0 check (rain_mm >= 0),
  stopped_hours numeric(8,2) not null default 0 check (stopped_hours >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_log_id, period)
);

create table if not exists public.execution_daily_log_workforce (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  daily_log_id uuid not null references public.execution_daily_logs(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  company_name text not null,
  role_name text not null,
  worker_count integer not null check (worker_count > 0),
  work_start time,
  work_end time,
  break_hours numeric(8,2) not null default 1 check (break_hours >= 0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.execution_daily_log_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  daily_log_id uuid not null references public.execution_daily_logs(id) on delete cascade,
  schedule_activity_id uuid references public.engineering_schedule_activities(id) on delete set null,
  service_id uuid references public.engineering_services(id) on delete set null,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  service_code text not null,
  service_name text not null,
  location_name text,
  unit_snapshot text,
  planned_quantity numeric(18,6),
  executed_quantity numeric(18,6),
  progress_percent numeric(5,2) check (progress_percent is null or progress_percent between 0 and 100),
  notes text,
  source text not null default 'manual' check (source in ('manual','schedule')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.execution_daily_log_occurrences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  daily_log_id uuid not null references public.execution_daily_logs(id) on delete cascade,
  occurrence_type text not null check (occurrence_type in ('general','delay','interference','inspection','visit','material','equipment','quality','incident','accident','stoppage')),
  impact text not null default 'low' check (impact in ('low','medium','high','critical')),
  title text not null,
  description text not null,
  action_taken text,
  status text not null default 'open' check (status in ('open','monitoring','resolved')),
  affects_schedule boolean not null default false,
  is_safety_event boolean not null default false,
  is_critical boolean not null default false,
  occurred_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.execution_daily_log_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  daily_log_id uuid not null references public.execution_daily_logs(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  service_row_id uuid references public.execution_daily_log_services(id) on delete set null,
  location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  occurrence_id uuid references public.execution_daily_log_occurrences(id) on delete set null,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (daily_log_id, storage_path)
);

create table if not exists public.execution_daily_log_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  daily_log_id uuid not null references public.execution_daily_logs(id) on delete cascade,
  action text not null,
  reason text,
  previous_status text,
  new_status text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

create index if not exists execution_daily_log_workforce_log_idx on public.execution_daily_log_workforce(daily_log_id, sort_order);
create index if not exists execution_daily_log_services_log_idx on public.execution_daily_log_services(daily_log_id, sort_order);
create index if not exists execution_daily_log_occurrences_log_idx on public.execution_daily_log_occurrences(daily_log_id, created_at);
create index if not exists execution_daily_log_photos_log_idx on public.execution_daily_log_photos(daily_log_id, uploaded_at);

insert into public.permissions (key, module, action, description) values
  ('execution.daily_logs.view', 'execution_daily_logs', 'view', 'Visualizar o Diário de Obras'),
  ('execution.daily_logs.manage', 'execution_daily_logs', 'manage', 'Criar e preencher o Diário de Obras'),
  ('execution.daily_logs.submit', 'execution_daily_logs', 'submit', 'Enviar diários para aprovação'),
  ('execution.daily_logs.approve', 'execution_daily_logs', 'approve', 'Aprovar ou devolver diários'),
  ('execution.daily_logs.reopen', 'execution_daily_logs', 'reopen', 'Reabrir diário aprovado preservando a versão'),
  ('execution.daily_logs.settings', 'execution_daily_logs', 'settings', 'Alterar configurações do Diário de Obras')
on conflict (key) do update set module = excluded.module, action = excluded.action, description = excluded.description;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, permission.permission_key, true
from public.roles role
cross join (values
  ('execution.daily_logs.view'),('execution.daily_logs.manage'),('execution.daily_logs.submit'),
  ('execution.daily_logs.approve'),('execution.daily_logs.reopen'),('execution.daily_logs.settings')
) permission(permission_key)
where role.key in ('owner','admin','director','engineering')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, permission.permission_key, true
from public.roles role
cross join (values ('execution.daily_logs.view'),('execution.daily_logs.manage'),('execution.daily_logs.submit')) permission(permission_key)
where role.key = 'field'
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, 'execution.daily_logs.view', true
from public.roles role
where role.key in ('viewer','procurement','finance')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

alter table public.execution_daily_log_settings enable row level security;
alter table public.execution_daily_logs enable row level security;
alter table public.execution_daily_log_weather enable row level security;
alter table public.execution_daily_log_workforce enable row level security;
alter table public.execution_daily_log_services enable row level security;
alter table public.execution_daily_log_occurrences enable row level security;
alter table public.execution_daily_log_photos enable row level security;
alter table public.execution_daily_log_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['execution_daily_log_settings','execution_daily_logs','execution_daily_log_weather','execution_daily_log_workforce','execution_daily_log_services','execution_daily_log_occurrences','execution_daily_log_photos','execution_daily_log_audit']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id, ''execution.daily_logs.view'') or public.has_company_permission(company_id, ''execution.daily_logs.manage'') or public.has_company_permission(company_id, ''execution.daily_logs.approve''))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id, ''execution.daily_logs.manage'') or public.has_company_permission(company_id, ''execution.daily_logs.approve'')) with check (public.has_company_permission(company_id, ''execution.daily_logs.manage'') or public.has_company_permission(company_id, ''execution.daily_logs.approve''))', t, t);
  end loop;
end $$;

create or replace function public.refresh_execution_daily_log_completion(p_log_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.execution_daily_logs%rowtype;
  required_photos integer := 1;
  completed integer := 0;
  total integer := 8;
  percent numeric;
  has_data boolean;
begin
  select * into d from public.execution_daily_logs where id = p_log_id for update;
  if d.id is null then raise exception 'Diário não encontrado.'; end if;

  select coalesce(s.required_photo_count,1) into required_photos
  from public.execution_daily_log_settings s where s.project_id = d.project_id;
  required_photos := coalesce(required_photos,1);

  if d.work_start is not null and d.work_end is not null and nullif(trim(coalesce(d.general_notes,'')),'') is not null then completed := completed + 1; end if;
  if exists(select 1 from public.execution_daily_log_weather w where w.daily_log_id = d.id) then completed := completed + 1; end if;
  if exists(select 1 from public.execution_daily_log_workforce w where w.daily_log_id = d.id and w.worker_count > 0) then completed := completed + 1; end if;
  if exists(select 1 from public.execution_daily_log_services s where s.daily_log_id = d.id) then completed := completed + 1; end if;
  if d.no_occurrences or exists(select 1 from public.execution_daily_log_occurrences o where o.daily_log_id = d.id and not o.is_safety_event) then completed := completed + 1; end if;
  if d.no_safety_events or exists(select 1 from public.execution_daily_log_occurrences o where o.daily_log_id = d.id and o.is_safety_event) then completed := completed + 1; end if;
  if required_photos = 0 or (select count(*) from public.execution_daily_log_photos p where p.daily_log_id = d.id) >= required_photos then completed := completed + 1; end if;
  if d.confirmed_by_filler then completed := completed + 1; end if;

  percent := round(completed::numeric / total::numeric * 100, 2);
  has_data := completed > 0;

  update public.execution_daily_logs
  set completion_percent = percent,
      status = case
        when status in ('approved','approved_with_reservations','awaiting_approval','cancelled') then status
        when status = 'reopened' then 'reopened'
        when has_data then 'in_progress'
        else 'pending'
      end,
      updated_at = now()
  where id = d.id;
  return percent;
end;
$$;

create or replace function public.create_execution_daily_log(
  p_company_id uuid, p_project_id uuid, p_log_date date, p_shift text,
  p_diary_type text default 'principal', p_copy_previous boolean default false
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  existing_id uuid;
  new_id uuid;
  previous_id uuid;
  responsible text;
  number_text text;
begin
  if not public.has_company_permission(p_company_id,'execution.daily_logs.manage') then raise exception 'Sem permissão para criar o diário.'; end if;
  if p_shift not in ('day','night') or p_diary_type not in ('principal','complementary') then raise exception 'Turno ou tipo de diário inválido.'; end if;
  if p_diary_type = 'complementary' and not coalesce((select allow_complementary from public.execution_daily_log_settings where project_id=p_project_id),false) then raise exception 'Diários complementares não estão habilitados para esta obra.'; end if;

  select id into existing_id from public.execution_daily_logs
  where company_id=p_company_id and project_id=p_project_id and log_date=p_log_date and shift=p_shift and diary_type=p_diary_type and is_current and status<>'cancelled';
  if existing_id is not null then return existing_id; end if;

  select coalesce(nullif(trim(p.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into responsible
  from public.profiles p where p.id=auth.uid();
  responsible := coalesce(responsible,nullif(auth.jwt()->>'email',''),'Usuário');
  number_text := 'RDO-'||to_char(p_log_date,'YYYYMMDD')||'-'||case when p_shift='day' then 'D' else 'N' end||'-'||case when p_diary_type='principal' then 'P' else 'C' end;

  insert into public.execution_daily_logs(company_id,project_id,log_date,shift,diary_type,log_number,responsible_user_id,responsible_name,created_by,updated_by)
  values(p_company_id,p_project_id,p_log_date,p_shift,p_diary_type,number_text,auth.uid(),responsible,auth.uid(),auth.uid()) returning id into new_id;
  update public.execution_daily_logs set root_log_id=new_id where id=new_id;

  if p_copy_previous then
    select id into previous_id from public.execution_daily_logs
    where company_id=p_company_id and project_id=p_project_id and log_date<p_log_date and is_current and diary_type='principal' and status<>'cancelled'
    order by log_date desc limit 1;
    if previous_id is not null then
      insert into public.execution_daily_log_workforce(company_id,project_id,daily_log_id,supplier_id,company_name,role_name,worker_count,work_start,work_end,break_hours,notes,sort_order)
      select company_id,project_id,new_id,supplier_id,company_name,role_name,worker_count,work_start,work_end,break_hours,notes,sort_order from public.execution_daily_log_workforce where daily_log_id=previous_id;
      insert into public.execution_daily_log_services(company_id,project_id,daily_log_id,schedule_activity_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,planned_quantity,executed_quantity,progress_percent,notes,source,sort_order)
      select company_id,project_id,new_id,schedule_activity_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,planned_quantity,null,null,null,source,sort_order from public.execution_daily_log_services where daily_log_id=previous_id;
    end if;
  end if;

  insert into public.execution_daily_log_audit(company_id,project_id,daily_log_id,action,new_status,changed_by)
  values(p_company_id,p_project_id,new_id,'created','pending',auth.uid());
  perform public.refresh_execution_daily_log_completion(new_id);
  return new_id;
end;
$$;

create or replace function public.save_execution_daily_log(
  p_company_id uuid, p_project_id uuid, p_log_id uuid,
  p_work_start time, p_work_end time, p_general_notes text,
  p_no_occurrences boolean, p_no_safety_events boolean, p_confirmed boolean,
  p_weather jsonb, p_workforce jsonb, p_services jsonb, p_occurrences jsonb
) returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  d public.execution_daily_logs%rowtype;
  item jsonb;
  n integer := 0;
  supplier_name text;
  act public.engineering_schedule_activities%rowtype;
  occurrence_id uuid;
begin
  if not public.has_company_permission(p_company_id,'execution.daily_logs.manage') then raise exception 'Sem permissão para preencher o diário.'; end if;
  select * into d from public.execution_daily_logs where id=p_log_id and company_id=p_company_id and project_id=p_project_id and is_current for update;
  if d.id is null then raise exception 'Diário não encontrado.'; end if;
  if d.status not in ('pending','in_progress','reopened') then raise exception 'Este diário está bloqueado para edição.'; end if;
  if p_work_start is not null and p_work_end is not null and p_work_end<=p_work_start then raise exception 'O fim da jornada deve ser posterior ao início.'; end if;

  update public.execution_daily_logs set work_start=p_work_start,work_end=p_work_end,general_notes=nullif(trim(coalesce(p_general_notes,'')),''),no_occurrences=coalesce(p_no_occurrences,false),no_safety_events=coalesce(p_no_safety_events,false),confirmed_by_filler=coalesce(p_confirmed,false),updated_by=auth.uid(),updated_at=now() where id=d.id;

  delete from public.execution_daily_log_weather where daily_log_id=d.id;
  for item in select value from jsonb_array_elements(coalesce(p_weather,'[]'::jsonb)) loop
    if nullif(item->>'condition','') is not null then
      insert into public.execution_daily_log_weather(company_id,project_id,daily_log_id,period,condition,temperature_c,rain_mm,stopped_hours,notes)
      values(p_company_id,p_project_id,d.id,item->>'period',item->>'condition',nullif(item->>'temperature_c','')::numeric,coalesce(nullif(item->>'rain_mm','')::numeric,0),coalesce(nullif(item->>'stopped_hours','')::numeric,0),nullif(trim(coalesce(item->>'notes','')),''));
    end if;
  end loop;

  delete from public.execution_daily_log_workforce where daily_log_id=d.id;
  n:=0;
  for item in select value from jsonb_array_elements(coalesce(p_workforce,'[]'::jsonb)) loop
    if coalesce(nullif(item->>'worker_count','')::integer,0)>0 then
      n:=n+1;
      supplier_name:=null;
      if nullif(item->>'supplier_id','') is not null then select coalesce(trade_name,legal_name) into supplier_name from public.suppliers where id=(item->>'supplier_id')::uuid and company_id=p_company_id; end if;
      supplier_name:=coalesce(supplier_name,nullif(trim(coalesce(item->>'company_name','')),''),'Equipe interna');
      insert into public.execution_daily_log_workforce(company_id,project_id,daily_log_id,supplier_id,company_name,role_name,worker_count,work_start,work_end,break_hours,notes,sort_order)
      values(p_company_id,p_project_id,d.id,nullif(item->>'supplier_id','')::uuid,supplier_name,coalesce(nullif(trim(item->>'role_name'),''),'Equipe'),(item->>'worker_count')::integer,nullif(item->>'work_start','')::time,nullif(item->>'work_end','')::time,coalesce(nullif(item->>'break_hours','')::numeric,1),nullif(trim(coalesce(item->>'notes','')),''),n);
    end if;
  end loop;

  delete from public.execution_daily_log_services where daily_log_id=d.id;
  n:=0;
  for item in select value from jsonb_array_elements(coalesce(p_services,'[]'::jsonb)) loop
    if nullif(item->>'schedule_activity_id','') is not null or nullif(trim(coalesce(item->>'service_name','')),'') is not null then
      n:=n+1; act:=null;
      if nullif(item->>'schedule_activity_id','') is not null then select * into act from public.engineering_schedule_activities where id=(item->>'schedule_activity_id')::uuid and company_id=p_company_id and project_id=p_project_id; end if;
      insert into public.execution_daily_log_services(company_id,project_id,daily_log_id,schedule_activity_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,planned_quantity,executed_quantity,progress_percent,notes,source,sort_order)
      values(p_company_id,p_project_id,d.id,act.id,coalesce(act.service_id,nullif(item->>'service_id','')::uuid),coalesce(act.location_id,nullif(item->>'location_id','')::uuid),coalesce(act.code,nullif(trim(item->>'service_code'),''),'MANUAL'),coalesce(act.name,nullif(trim(item->>'service_name'),''),'Serviço'),nullif(trim(coalesce(item->>'location_name','')),''),coalesce(act.unit_snapshot,nullif(item->>'unit_snapshot','')),coalesce(act.quantity_snapshot,nullif(item->>'planned_quantity','')::numeric),nullif(item->>'executed_quantity','')::numeric,nullif(item->>'progress_percent','')::numeric,nullif(trim(coalesce(item->>'notes','')),''),case when act.id is null then 'manual' else 'schedule' end,n);
    end if;
  end loop;

  delete from public.execution_daily_log_occurrences where daily_log_id=d.id and not is_critical;
  for item in select value from jsonb_array_elements(coalesce(p_occurrences,'[]'::jsonb)) loop
    occurrence_id:=nullif(item->>'id','')::uuid;
    if occurrence_id is not null and exists(select 1 from public.execution_daily_log_occurrences where id=occurrence_id and daily_log_id=d.id and is_critical) then
      update public.execution_daily_log_occurrences set title=coalesce(nullif(trim(item->>'title'),''),title),description=coalesce(nullif(trim(item->>'description'),''),description),action_taken=nullif(trim(coalesce(item->>'action_taken','')),''),status=coalesce(nullif(item->>'status',''),status),affects_schedule=coalesce((item->>'affects_schedule')::boolean,false),updated_at=now() where id=occurrence_id;
    elsif nullif(trim(coalesce(item->>'title','')),'') is not null and nullif(trim(coalesce(item->>'description','')),'') is not null then
      insert into public.execution_daily_log_occurrences(company_id,project_id,daily_log_id,occurrence_type,impact,title,description,action_taken,status,affects_schedule,is_safety_event,is_critical,occurred_at,created_by)
      values(p_company_id,p_project_id,d.id,coalesce(nullif(item->>'occurrence_type',''),'general'),coalesce(nullif(item->>'impact',''),'low'),trim(item->>'title'),trim(item->>'description'),nullif(trim(coalesce(item->>'action_taken','')),''),coalesce(nullif(item->>'status',''),'open'),coalesce((item->>'affects_schedule')::boolean,false),coalesce((item->>'is_safety_event')::boolean,false),coalesce((item->>'impact') in ('high','critical') or (item->>'occurrence_type') in ('incident','accident','stoppage'),false),coalesce(nullif(item->>'occurred_at','')::timestamptz,now()),auth.uid());
    end if;
  end loop;

  insert into public.execution_daily_log_audit(company_id,project_id,daily_log_id,action,previous_status,new_status,changed_by)
  values(p_company_id,p_project_id,d.id,'saved',d.status,d.status,auth.uid());
  return public.refresh_execution_daily_log_completion(d.id);
end;
$$;

create or replace function public.submit_execution_daily_log(p_company_id uuid,p_project_id uuid,p_log_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare p numeric; old_status text;
begin
  if not public.has_company_permission(p_company_id,'execution.daily_logs.submit') then raise exception 'Sem permissão para enviar o diário.'; end if;
  p:=public.refresh_execution_daily_log_completion(p_log_id);
  if p<100 then raise exception 'Complete todas as seções obrigatórias antes de enviar para aprovação. Preenchimento atual: %%%.',p; end if;
  select status into old_status from public.execution_daily_logs where id=p_log_id and company_id=p_company_id and project_id=p_project_id and is_current for update;
  if old_status not in ('in_progress','reopened') then raise exception 'O diário não está disponível para envio.'; end if;
  update public.execution_daily_logs set status='awaiting_approval',submitted_by=auth.uid(),submitted_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_log_id;
  insert into public.execution_daily_log_audit(company_id,project_id,daily_log_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,p_log_id,'submitted',old_status,'awaiting_approval',auth.uid());
  return 'awaiting_approval';
end; $$;

create or replace function public.approve_execution_daily_log(p_company_id uuid,p_project_id uuid,p_log_id uuid,p_notes text,p_with_reservations boolean default false)
returns text language plpgsql security definer set search_path=public as $$
declare next_status text; begin
  if not public.has_company_permission(p_company_id,'execution.daily_logs.approve') then raise exception 'Sem permissão para aprovar o diário.'; end if;
  next_status:=case when p_with_reservations then 'approved_with_reservations' else 'approved' end;
  update public.execution_daily_logs set status=next_status,approval_notes=nullif(trim(coalesce(p_notes,'')),''),approved_by=auth.uid(),approved_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_log_id and company_id=p_company_id and project_id=p_project_id and status='awaiting_approval' and is_current;
  if not found then raise exception 'O diário não está aguardando aprovação.'; end if;
  insert into public.execution_daily_log_audit(company_id,project_id,daily_log_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,p_log_id,'approved','awaiting_approval',next_status,p_notes,auth.uid());
  return next_status;
end; $$;

create or replace function public.return_execution_daily_log(p_company_id uuid,p_project_id uuid,p_log_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$ begin
  if not public.has_company_permission(p_company_id,'execution.daily_logs.approve') then raise exception 'Sem permissão para devolver o diário.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da devolução.'; end if;
  update public.execution_daily_logs set status='in_progress',approval_notes=trim(p_reason),submitted_by=null,submitted_at=null,updated_by=auth.uid(),updated_at=now() where id=p_log_id and company_id=p_company_id and project_id=p_project_id and status='awaiting_approval' and is_current;
  if not found then raise exception 'O diário não está aguardando aprovação.'; end if;
  insert into public.execution_daily_log_audit(company_id,project_id,daily_log_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,p_log_id,'returned','awaiting_approval','in_progress',p_reason,auth.uid()); return 'in_progress';
end; $$;

create or replace function public.reopen_execution_daily_log(p_company_id uuid,p_project_id uuid,p_log_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare old public.execution_daily_logs%rowtype; new_id uuid; begin
  if not public.has_company_permission(p_company_id,'execution.daily_logs.reopen') then raise exception 'Sem permissão para reabrir o diário.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe a justificativa da reabertura.'; end if;
  select * into old from public.execution_daily_logs where id=p_log_id and company_id=p_company_id and project_id=p_project_id and status in ('approved','approved_with_reservations') and is_current for update;
  if old.id is null then raise exception 'Somente a versão aprovada atual pode ser reaberta.'; end if;
  update public.execution_daily_logs set is_current=false where id=old.id;
  insert into public.execution_daily_logs(company_id,project_id,root_log_id,reopened_from_id,log_date,shift,diary_type,log_number,version,is_current,status,work_start,work_end,general_notes,no_occurrences,no_safety_events,confirmed_by_filler,completion_percent,responsible_user_id,responsible_name,reopened_by,reopened_at,reopened_reason,created_by,updated_by)
  values(old.company_id,old.project_id,coalesce(old.root_log_id,old.id),old.id,old.log_date,old.shift,old.diary_type,old.log_number,old.version+1,true,'reopened',old.work_start,old.work_end,old.general_notes,old.no_occurrences,old.no_safety_events,false,old.completion_percent,old.responsible_user_id,old.responsible_name,auth.uid(),now(),trim(p_reason),auth.uid(),auth.uid()) returning id into new_id;
  insert into public.execution_daily_log_weather(company_id,project_id,daily_log_id,period,condition,temperature_c,rain_mm,stopped_hours,notes) select company_id,project_id,new_id,period,condition,temperature_c,rain_mm,stopped_hours,notes from public.execution_daily_log_weather where daily_log_id=old.id;
  insert into public.execution_daily_log_workforce(company_id,project_id,daily_log_id,supplier_id,company_name,role_name,worker_count,work_start,work_end,break_hours,notes,sort_order) select company_id,project_id,new_id,supplier_id,company_name,role_name,worker_count,work_start,work_end,break_hours,notes,sort_order from public.execution_daily_log_workforce where daily_log_id=old.id;
  insert into public.execution_daily_log_services(company_id,project_id,daily_log_id,schedule_activity_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,planned_quantity,executed_quantity,progress_percent,notes,source,sort_order) select company_id,project_id,new_id,schedule_activity_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,planned_quantity,executed_quantity,progress_percent,notes,source,sort_order from public.execution_daily_log_services where daily_log_id=old.id;
  insert into public.execution_daily_log_occurrences(company_id,project_id,daily_log_id,occurrence_type,impact,title,description,action_taken,status,affects_schedule,is_safety_event,is_critical,occurred_at,created_by) select company_id,project_id,new_id,occurrence_type,impact,title,description,action_taken,status,affects_schedule,is_safety_event,is_critical,occurred_at,created_by from public.execution_daily_log_occurrences where daily_log_id=old.id;
  insert into public.execution_daily_log_photos(company_id,project_id,daily_log_id,storage_path,file_name,mime_type,file_size,caption,service_row_id,location_id,occurrence_id,uploaded_by,uploaded_at) select company_id,project_id,new_id,storage_path,file_name,mime_type,file_size,caption,null,location_id,null,uploaded_by,uploaded_at from public.execution_daily_log_photos where daily_log_id=old.id;
  insert into public.execution_daily_log_audit(company_id,project_id,daily_log_id,action,previous_status,new_status,reason,changed_by,details) values(p_company_id,p_project_id,new_id,'reopened',old.status,'reopened',p_reason,auth.uid(),jsonb_build_object('previous_log_id',old.id,'previous_version',old.version));
  return new_id;
end; $$;

create or replace function public.cancel_execution_daily_log(p_company_id uuid,p_project_id uuid,p_log_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$ declare old_status text; begin
  if not public.has_company_permission(p_company_id,'execution.daily_logs.approve') then raise exception 'Sem permissão para cancelar o diário.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select status into old_status from public.execution_daily_logs where id=p_log_id and company_id=p_company_id and project_id=p_project_id and is_current for update;
  if old_status in ('approved','approved_with_reservations','cancelled') or old_status is null then raise exception 'Este diário não pode ser cancelado.'; end if;
  update public.execution_daily_logs set status='cancelled',cancellation_reason=trim(p_reason),cancelled_by=auth.uid(),cancelled_at=now(),updated_by=auth.uid(),updated_at=now() where id=p_log_id;
  insert into public.execution_daily_log_audit(company_id,project_id,daily_log_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,p_log_id,'cancelled',old_status,'cancelled',p_reason,auth.uid()); return 'cancelled';
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('daily-log-photos','daily-log-photos',false,15728640,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists daily_log_photos_select on storage.objects;
create policy daily_log_photos_select on storage.objects for select to authenticated using (
  bucket_id='daily-log-photos' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1])
);
drop policy if exists daily_log_photos_insert on storage.objects;
create policy daily_log_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id='daily-log-photos' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.daily_logs.manage')
);
drop policy if exists daily_log_photos_delete on storage.objects;
create policy daily_log_photos_delete on storage.objects for delete to authenticated using (
  bucket_id='daily-log-photos' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.daily_logs.manage')
);

grant select,insert,update,delete on public.execution_daily_log_settings,public.execution_daily_logs,public.execution_daily_log_weather,public.execution_daily_log_workforce,public.execution_daily_log_services,public.execution_daily_log_occurrences,public.execution_daily_log_photos,public.execution_daily_log_audit to authenticated;
grant execute on function public.refresh_execution_daily_log_completion(uuid) to authenticated;
grant execute on function public.create_execution_daily_log(uuid,uuid,date,text,text,boolean) to authenticated;
grant execute on function public.save_execution_daily_log(uuid,uuid,uuid,time,time,text,boolean,boolean,boolean,jsonb,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.submit_execution_daily_log(uuid,uuid,uuid) to authenticated;
grant execute on function public.approve_execution_daily_log(uuid,uuid,uuid,text,boolean) to authenticated;
grant execute on function public.return_execution_daily_log(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reopen_execution_daily_log(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.cancel_execution_daily_log(uuid,uuid,uuid,text) to authenticated;

commit;
