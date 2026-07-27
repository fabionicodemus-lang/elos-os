-- Elos OS — Execução · Controle do Cronograma
-- Registra cronograma atual, avanço físico e histórico de medições sobre a linha de base aprovada.

begin;

create table if not exists public.engineering_schedule_activity_tracking (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade,
  activity_id uuid not null references public.engineering_schedule_activities(id) on delete cascade,
  current_start date not null,
  current_finish date not null,
  actual_start date,
  actual_finish date,
  progress_percent numeric(7,4) not null default 0,
  actual_quantity numeric(18,6) not null default 0,
  actual_cost numeric(18,2) not null default 0,
  team_count numeric(12,4),
  last_measurement_date date,
  notes text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id),
  constraint execution_tracking_progress_check check (progress_percent between 0 and 100),
  constraint execution_tracking_values_check check (
    actual_quantity >= 0
    and actual_cost >= 0
    and (team_count is null or team_count > 0)
    and current_finish >= current_start
    and (actual_finish is null or actual_start is null or actual_finish >= actual_start)
  )
);

create table if not exists public.engineering_schedule_progress_measurements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade,
  activity_id uuid not null references public.engineering_schedule_activities(id) on delete cascade,
  measurement_date date not null,
  progress_percent numeric(7,4) not null,
  actual_quantity numeric(18,6) not null default 0,
  actual_cost numeric(18,2) not null default 0,
  team_count numeric(12,4),
  current_start date not null,
  current_finish date not null,
  actual_start date,
  actual_finish date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, measurement_date),
  constraint execution_measurement_progress_check check (progress_percent between 0 and 100),
  constraint execution_measurement_values_check check (
    actual_quantity >= 0
    and actual_cost >= 0
    and (team_count is null or team_count > 0)
    and current_finish >= current_start
    and (actual_finish is null or actual_start is null or actual_finish >= actual_start)
  )
);

create index if not exists execution_tracking_project_baseline_idx
  on public.engineering_schedule_activity_tracking(project_id, baseline_id, last_measurement_date desc);

create index if not exists execution_measurements_activity_date_idx
  on public.engineering_schedule_progress_measurements(activity_id, measurement_date desc);

create index if not exists execution_measurements_project_date_idx
  on public.engineering_schedule_progress_measurements(project_id, measurement_date desc);

insert into public.permissions (key, module, action, description) values
  ('execution.schedule.view', 'execution_schedule', 'view', 'Visualizar controle e avanço do cronograma'),
  ('execution.schedule.manage', 'execution_schedule', 'manage', 'Registrar medições e reprogramar o cronograma atual')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, permission.permission_key, true
from public.roles role
cross join (values ('execution.schedule.view'), ('execution.schedule.manage')) as permission(permission_key)
where role.key in ('owner', 'admin', 'director', 'engineering', 'field')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, 'execution.schedule.view', true
from public.roles role
where role.key in ('finance', 'procurement', 'viewer')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

alter table public.engineering_schedule_activity_tracking enable row level security;
alter table public.engineering_schedule_progress_measurements enable row level security;

drop policy if exists execution_schedule_tracking_select on public.engineering_schedule_activity_tracking;
create policy execution_schedule_tracking_select on public.engineering_schedule_activity_tracking
for select to authenticated using (
  public.has_company_permission(company_id, 'execution.schedule.view')
  or public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists execution_schedule_tracking_insert on public.engineering_schedule_activity_tracking;
create policy execution_schedule_tracking_insert on public.engineering_schedule_activity_tracking
for insert to authenticated with check (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists execution_schedule_tracking_update on public.engineering_schedule_activity_tracking;
create policy execution_schedule_tracking_update on public.engineering_schedule_activity_tracking
for update to authenticated using (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
) with check (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists execution_schedule_measurements_select on public.engineering_schedule_progress_measurements;
create policy execution_schedule_measurements_select on public.engineering_schedule_progress_measurements
for select to authenticated using (
  public.has_company_permission(company_id, 'execution.schedule.view')
  or public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists execution_schedule_measurements_insert on public.engineering_schedule_progress_measurements;
create policy execution_schedule_measurements_insert on public.engineering_schedule_progress_measurements
for insert to authenticated with check (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists execution_schedule_measurements_update on public.engineering_schedule_progress_measurements;
create policy execution_schedule_measurements_update on public.engineering_schedule_progress_measurements
for update to authenticated using (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
) with check (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
);

create or replace function public.record_execution_schedule_progress(
  p_company_id uuid,
  p_project_id uuid,
  p_baseline_id uuid,
  p_activity_id uuid,
  p_measurement_date date,
  p_progress_percent numeric,
  p_actual_quantity numeric,
  p_actual_cost numeric,
  p_team_count numeric,
  p_current_start date,
  p_current_finish date,
  p_actual_start date,
  p_actual_finish date,
  p_notes text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  activity_record public.engineering_schedule_activities%rowtype;
  baseline_record public.engineering_schedule_baselines%rowtype;
  tracking_id uuid;
  resolved_actual_start date;
  resolved_actual_finish date;
begin
  if not public.has_company_permission(p_company_id, 'execution.schedule.manage')
     and not public.has_company_permission(p_company_id, 'schedule.manage') then
    raise exception 'Sem permissão para registrar o avanço do cronograma.';
  end if;

  select * into baseline_record
  from public.engineering_schedule_baselines baseline
  where baseline.id = p_baseline_id
    and baseline.company_id = p_company_id
    and baseline.project_id = p_project_id;

  if baseline_record.id is null then
    raise exception 'A linha de base informada não pertence ao empreendimento.';
  end if;

  if baseline_record.status <> 'approved' then
    raise exception 'A execução exige uma linha de base aprovada.';
  end if;

  select * into activity_record
  from public.engineering_schedule_activities activity
  where activity.id = p_activity_id
    and activity.company_id = p_company_id
    and activity.project_id = p_project_id
    and activity.baseline_id = p_baseline_id
    and activity.record_status = 'active';

  if activity_record.id is null then
    raise exception 'Atividade não encontrada na linha de base selecionada.';
  end if;

  if p_measurement_date is null or p_current_start is null or p_current_finish is null then
    raise exception 'Informe a data da medição e as datas atuais da atividade.';
  end if;

  if p_progress_percent < 0 or p_progress_percent > 100 then
    raise exception 'O avanço deve estar entre 0%% e 100%%.';
  end if;

  if p_current_finish < p_current_start then
    raise exception 'O término atual não pode ser anterior ao início atual.';
  end if;

  if coalesce(p_actual_quantity, 0) < 0 or coalesce(p_actual_cost, 0) < 0 then
    raise exception 'Quantidade e custo realizados não podem ser negativos.';
  end if;

  resolved_actual_start := case
    when p_progress_percent > 0 then coalesce(p_actual_start, (
      select tracking.actual_start
      from public.engineering_schedule_activity_tracking tracking
      where tracking.activity_id = p_activity_id
    ), p_measurement_date)
    else p_actual_start
  end;

  resolved_actual_finish := case
    when p_progress_percent = 100 then coalesce(p_actual_finish, p_measurement_date)
    else p_actual_finish
  end;

  insert into public.engineering_schedule_progress_measurements (
    company_id, project_id, baseline_id, activity_id, measurement_date,
    progress_percent, actual_quantity, actual_cost, team_count,
    current_start, current_finish, actual_start, actual_finish,
    notes, created_by
  ) values (
    p_company_id, p_project_id, p_baseline_id, p_activity_id, p_measurement_date,
    p_progress_percent, coalesce(p_actual_quantity, 0), coalesce(p_actual_cost, 0), p_team_count,
    p_current_start, p_current_finish, resolved_actual_start, resolved_actual_finish,
    nullif(trim(coalesce(p_notes, '')), ''), auth.uid()
  )
  on conflict (activity_id, measurement_date) do update set
    progress_percent = excluded.progress_percent,
    actual_quantity = excluded.actual_quantity,
    actual_cost = excluded.actual_cost,
    team_count = excluded.team_count,
    current_start = excluded.current_start,
    current_finish = excluded.current_finish,
    actual_start = excluded.actual_start,
    actual_finish = excluded.actual_finish,
    notes = excluded.notes,
    updated_at = now();

  insert into public.engineering_schedule_activity_tracking (
    company_id, project_id, baseline_id, activity_id,
    current_start, current_finish, actual_start, actual_finish,
    progress_percent, actual_quantity, actual_cost, team_count,
    last_measurement_date, notes, updated_by
  ) values (
    p_company_id, p_project_id, p_baseline_id, p_activity_id,
    p_current_start, p_current_finish, resolved_actual_start, resolved_actual_finish,
    p_progress_percent, coalesce(p_actual_quantity, 0), coalesce(p_actual_cost, 0), p_team_count,
    p_measurement_date, nullif(trim(coalesce(p_notes, '')), ''), auth.uid()
  )
  on conflict (activity_id) do update set
    current_start = excluded.current_start,
    current_finish = excluded.current_finish,
    actual_start = excluded.actual_start,
    actual_finish = excluded.actual_finish,
    progress_percent = excluded.progress_percent,
    actual_quantity = excluded.actual_quantity,
    actual_cost = excluded.actual_cost,
    team_count = excluded.team_count,
    last_measurement_date = excluded.last_measurement_date,
    notes = excluded.notes,
    updated_by = auth.uid(),
    updated_at = now()
  returning id into tracking_id;

  return tracking_id;
end;
$$;

grant select, insert, update on public.engineering_schedule_activity_tracking to authenticated;
grant select, insert, update on public.engineering_schedule_progress_measurements to authenticated;
grant execute on function public.record_execution_schedule_progress(
  uuid, uuid, uuid, uuid, date, numeric, numeric, numeric, numeric,
  date, date, date, date, text
) to authenticated;

commit;
