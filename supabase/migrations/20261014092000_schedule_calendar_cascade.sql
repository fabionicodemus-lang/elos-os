-- Elos OS — Pré-Obra 9.5 · Consistência do calendário na rede lógica
-- Garante que qualquer alteração persistida respeite feriados/recessos e as
-- dependências FS/SS/FF/SF, mesmo quando a UI calcular apenas uma prévia.

begin;

create or replace function public.engineering_schedule_shift_workdays(
  p_company_id uuid,
  p_project_id uuid,
  p_date date,
  p_shift integer,
  p_work_on_saturday boolean
)
returns date
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date date := p_date;
  v_remaining integer := abs(coalesce(p_shift, 0));
  v_step integer := case when coalesce(p_shift, 0) < 0 then -1 else 1 end;
begin
  if p_date is null then return null; end if;
  if p_shift >= 0 then
    while not public.engineering_schedule_is_workday(p_company_id, p_project_id, v_date, p_work_on_saturday) loop
      v_date := v_date + 1;
    end loop;
  else
    while not public.engineering_schedule_is_workday(p_company_id, p_project_id, v_date, p_work_on_saturday) loop
      v_date := v_date - 1;
    end loop;
  end if;
  while v_remaining > 0 loop
    v_date := v_date + v_step;
    if public.engineering_schedule_is_workday(p_company_id, p_project_id, v_date, p_work_on_saturday) then
      v_remaining := v_remaining - 1;
    end if;
  end loop;
  return v_date;
end;
$$;
grant execute on function public.engineering_schedule_shift_workdays(uuid, uuid, date, integer, boolean) to authenticated;

create or replace function public.apply_engineering_schedule_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_on_saturday boolean := false;
  v_default_productivity numeric;
  v_default_teams numeric;
begin
  select coalesce(work_on_saturday, false)
    into v_work_on_saturday
  from public.engineering_schedule_baselines
  where id = new.baseline_id and company_id = new.company_id and project_id = new.project_id;

  if tg_op = 'INSERT' and new.source = 'takeoff' and new.service_id is not null then
    select default_productivity_per_team_day, default_team_count
      into v_default_productivity, v_default_teams
    from public.engineering_services
    where id = new.service_id and company_id = new.company_id;

    if coalesce(v_default_productivity, 0) > 0 then
      new.productivity_per_team_day := v_default_productivity;
      new.team_count := coalesce(nullif(v_default_teams, 0), 1);
      if coalesce(new.quantity_snapshot, 0) > 0 then
        new.duration_days := greatest(1, ceil(new.quantity_snapshot / (new.productivity_per_team_day * new.team_count))::integer);
      end if;
    end if;
  end if;

  new.duration_days := greatest(1, coalesce(new.duration_days, 1));
  new.planned_start := public.engineering_schedule_shift_workdays(
    new.company_id, new.project_id, new.planned_start, 0, v_work_on_saturday
  );
  new.planned_finish := public.engineering_schedule_add_workdays(
    new.company_id, new.project_id, new.planned_start, new.duration_days, v_work_on_saturday
  );
  return new;
end;
$$;

create or replace function public.engineering_schedule_dependency_required_start(
  p_company_id uuid,
  p_project_id uuid,
  p_relation text,
  p_pred_start date,
  p_pred_finish date,
  p_lag integer,
  p_successor_duration integer,
  p_work_on_saturday boolean
)
returns date
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_lag integer := coalesce(p_lag, 0);
  v_duration integer := greatest(1, coalesce(p_successor_duration, 1));
  v_finish date;
begin
  case upper(coalesce(p_relation, 'FS'))
    when 'SS' then
      return public.engineering_schedule_shift_workdays(p_company_id, p_project_id, p_pred_start, v_lag, p_work_on_saturday);
    when 'FF' then
      v_finish := public.engineering_schedule_shift_workdays(p_company_id, p_project_id, p_pred_finish, v_lag, p_work_on_saturday);
      return public.engineering_schedule_shift_workdays(p_company_id, p_project_id, v_finish, -(v_duration - 1), p_work_on_saturday);
    when 'SF' then
      v_finish := public.engineering_schedule_shift_workdays(p_company_id, p_project_id, p_pred_start, v_lag, p_work_on_saturday);
      return public.engineering_schedule_shift_workdays(p_company_id, p_project_id, v_finish, -(v_duration - 1), p_work_on_saturday);
    else
      return public.engineering_schedule_shift_workdays(p_company_id, p_project_id, p_pred_finish, v_lag + 1, p_work_on_saturday);
  end case;
end;
$$;
grant execute on function public.engineering_schedule_dependency_required_start(uuid, uuid, text, date, date, integer, integer, boolean) to authenticated;

create or replace function public.recalculate_engineering_schedule_successors(
  p_company_id uuid,
  p_project_id uuid,
  p_baseline_id uuid,
  p_anchor_activity_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saturday boolean := false;
  v_row record;
  v_required date;
  v_count integer := 0;
begin
  select coalesce(work_on_saturday, false) into v_saturday
  from public.engineering_schedule_baselines
  where id = p_baseline_id and company_id = p_company_id and project_id = p_project_id;

  for v_row in
    with recursive descendants(id, depth, path) as (
      select d.successor_id, 1, array[p_anchor_activity_id, d.successor_id]::uuid[]
      from public.engineering_schedule_dependencies d
      where d.baseline_id = p_baseline_id and d.predecessor_id = p_anchor_activity_id
      union all
      select d.successor_id, descendants.depth + 1, descendants.path || d.successor_id
      from descendants
      join public.engineering_schedule_dependencies d on d.predecessor_id = descendants.id and d.baseline_id = p_baseline_id
      where not d.successor_id = any(descendants.path) and descendants.depth < 500
    )
    select a.id, a.planned_start, a.duration_days, min(depth) as depth
    from descendants
    join public.engineering_schedule_activities a on a.id = descendants.id
    where a.company_id = p_company_id and a.project_id = p_project_id and a.baseline_id = p_baseline_id and a.record_status = 'active'
    group by a.id, a.planned_start, a.duration_days
    order by min(depth), a.id
  loop
    select max(public.engineering_schedule_dependency_required_start(
      p_company_id,
      p_project_id,
      d.relation_type,
      pred.planned_start,
      pred.planned_finish,
      d.lag_days,
      v_row.duration_days,
      v_saturday
    ))
    into v_required
    from public.engineering_schedule_dependencies d
    join public.engineering_schedule_activities pred on pred.id = d.predecessor_id
    where d.baseline_id = p_baseline_id
      and d.successor_id = v_row.id
      and pred.record_status = 'active';

    if v_required is not null and v_required > v_row.planned_start then
      update public.engineering_schedule_activities
      set planned_start = v_required,
          updated_at = now()
      where id = v_row.id and company_id = p_company_id and project_id = p_project_id and baseline_id = p_baseline_id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
grant execute on function public.recalculate_engineering_schedule_successors(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.cascade_engineering_schedule_after_date_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A própria função atualiza descendentes. Evita disparar uma cascata aninhada
  -- para cada sucessora atualizada durante a mesma propagação.
  if pg_trigger_depth() > 1 then return new; end if;
  perform public.recalculate_engineering_schedule_successors(new.company_id, new.project_id, new.baseline_id, new.id);
  return new;
end;
$$;

drop trigger if exists cascade_engineering_schedule_after_date_change_trigger on public.engineering_schedule_activities;
create trigger cascade_engineering_schedule_after_date_change_trigger
after insert or update of planned_start, planned_finish, duration_days
on public.engineering_schedule_activities
for each row execute function public.cascade_engineering_schedule_after_date_change();

commit;