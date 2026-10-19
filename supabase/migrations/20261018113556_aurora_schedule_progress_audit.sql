begin;
alter table public.engineering_schedule_progress_measurements
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;
create table if not exists public.engineering_schedule_progress_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  measurement_id uuid not null references public.engineering_schedule_progress_measurements(id),
  action text not null,
  previous_value jsonb,
  new_value jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.engineering_schedule_progress_audit enable row level security;
drop policy if exists progress_audit_read on public.engineering_schedule_progress_audit;
create policy progress_audit_read on public.engineering_schedule_progress_audit for select to authenticated
using(public.has_company_permission(company_id,'execution.schedule.view') or public.has_company_permission(company_id,'execution.schedule.manage') or public.has_company_permission(company_id,'schedule.view') or public.has_company_permission(company_id,'schedule.manage'));
revoke all on public.engineering_schedule_progress_audit from public,anon,authenticated;
grant select on public.engineering_schedule_progress_audit to authenticated;
create index if not exists progress_audit_measurement_idx on public.engineering_schedule_progress_audit(measurement_id,created_at);

-- Definer is confined to the trigger: inserts an immutable audit entry and rebuilds
-- tracking for the same authorized activity. It cannot be called as an RPC.
create or replace function public.audit_execution_schedule_progress()
returns trigger language plpgsql security definer set search_path=public as $$
declare a public.engineering_schedule_activities%rowtype; m public.engineering_schedule_progress_measurements%rowtype;
begin
  if auth.uid() is null or not (public.has_company_permission(new.company_id,'execution.schedule.manage') or public.has_company_permission(new.company_id,'schedule.manage')) then raise exception 'Sem permissão para alterar medições.'; end if;
  select * into a from public.engineering_schedule_activities where id=new.activity_id and company_id=new.company_id and project_id=new.project_id and baseline_id=new.baseline_id for update;
  if a.id is null then raise exception 'Atividade não pertence ao contexto da medição.'; end if;
  if tg_op='UPDATE' then
    if (new.company_id,new.project_id,new.activity_id,new.baseline_id,new.measurement_date) is distinct from (old.company_id,old.project_id,old.activity_id,old.baseline_id,old.measurement_date) then raise exception 'A identidade da medição não pode ser alterada.'; end if;
    if new.voided_at is not null and nullif(trim(new.void_reason),'') is null then raise exception 'Informe o motivo da anulação.'; end if;
    if new.voided_at is null and nullif(trim(new.notes),'') is null then raise exception 'Informe a justificativa da retificação nas observações.'; end if;
  end if;
  insert into public.engineering_schedule_progress_audit(company_id,project_id,measurement_id,action,previous_value,new_value,created_by)
  values(new.company_id,new.project_id,new.id,case when new.voided_at is not null then 'voided' when tg_op='UPDATE' then 'corrected' else 'created' end,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new),auth.uid());
  select * into m from public.engineering_schedule_progress_measurements where activity_id=new.activity_id and voided_at is null order by measurement_date desc,created_at desc,id desc limit 1;
  insert into public.engineering_schedule_activity_tracking(company_id,project_id,baseline_id,activity_id,current_start,current_finish,actual_start,actual_finish,progress_percent,actual_quantity,actual_cost,team_count,last_measurement_date,notes,updated_by)
  values(new.company_id,new.project_id,new.baseline_id,new.activity_id,coalesce(m.current_start,a.planned_start),coalesce(m.current_finish,a.planned_finish),m.actual_start,m.actual_finish,coalesce(m.progress_percent,0),coalesce(m.actual_quantity,0),coalesce(m.actual_cost,0),m.team_count,m.measurement_date,m.notes,auth.uid())
  on conflict(activity_id) do update set current_start=excluded.current_start,current_finish=excluded.current_finish,actual_start=excluded.actual_start,actual_finish=excluded.actual_finish,progress_percent=excluded.progress_percent,actual_quantity=excluded.actual_quantity,actual_cost=excluded.actual_cost,team_count=excluded.team_count,last_measurement_date=excluded.last_measurement_date,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=now();
  return new;
end; $$;
revoke all on function public.audit_execution_schedule_progress() from public,anon,authenticated;
drop trigger if exists execution_progress_audit on public.engineering_schedule_progress_measurements;
create trigger execution_progress_audit after insert or update on public.engineering_schedule_progress_measurements for each row execute function public.audit_execution_schedule_progress();

create or replace function public.void_execution_schedule_progress(p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_reason text)
returns void language plpgsql security invoker set search_path=public as $$
declare m public.engineering_schedule_progress_measurements%rowtype;
begin
  if not (public.has_company_permission(p_company_id,'execution.schedule.manage') or public.has_company_permission(p_company_id,'schedule.manage')) then raise exception 'Sem permissão para anular medições.'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Informe o motivo da anulação.'; end if;
  select * into m from public.engineering_schedule_progress_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id;
  if m.id is null then raise exception 'Medição não encontrada.'; end if;
  -- Serialize with recordExecutionProgress using the same activity lock order.
  perform 1 from public.engineering_schedule_activities where id=m.activity_id for update;
  update public.engineering_schedule_progress_measurements set voided_at=now(),void_reason=trim(p_reason),updated_at=now() where id=m.id and voided_at is null;
end; $$;
revoke all on function public.void_execution_schedule_progress(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.void_execution_schedule_progress(uuid,uuid,uuid,text) to authenticated;

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
    and activity.record_status = 'active' for update;

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
    voided_at = null,
    void_reason = null,
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

  select id into tracking_id from public.engineering_schedule_activity_tracking where activity_id=p_activity_id;

  return tracking_id;
end;
$$;


commit;
