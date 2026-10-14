-- Elos OS — Pré-Obra 9.5 · Integridade da rede de planejamento
-- Mudanças de calendário/dependência afetam somente linhas de base em elaboração.
-- Linhas aprovadas continuam snapshots históricos imutáveis.

begin;

create or replace function public.recalculate_engineering_schedule_baseline_calendar(
  p_company_id uuid,
  p_project_id uuid,
  p_baseline_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_saturday boolean;
  v_row record;
  v_count integer := 0;
begin
  select status, work_on_saturday into v_status, v_saturday
  from public.engineering_schedule_baselines
  where id = p_baseline_id and company_id = p_company_id and project_id = p_project_id;
  if v_status is null or v_status in ('approved', 'archived') then return 0; end if;

  for v_row in
    select id, planned_start, duration_days
    from public.engineering_schedule_activities
    where company_id = p_company_id and project_id = p_project_id
      and baseline_id = p_baseline_id and record_status = 'active'
    order by planned_start, sort_order, code
  loop
    update public.engineering_schedule_activities
    set planned_start = public.engineering_schedule_shift_workdays(
          p_company_id, p_project_id, v_row.planned_start, 0, v_saturday
        ),
        updated_at = now()
    where id = v_row.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
grant execute on function public.recalculate_engineering_schedule_baseline_calendar(uuid, uuid, uuid) to authenticated;

create or replace function public.recalculate_planning_baselines_after_calendar_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(new.company_id, old.company_id);
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_baseline record;
begin
  for v_baseline in
    select id
    from public.engineering_schedule_baselines
    where company_id = v_company_id and project_id = v_project_id
      and status in ('draft', 'review')
  loop
    perform public.recalculate_engineering_schedule_baseline_calendar(v_company_id, v_project_id, v_baseline.id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists recalculate_planning_baselines_after_calendar_change_trigger on public.engineering_schedule_calendar_exceptions;
create trigger recalculate_planning_baselines_after_calendar_change_trigger
after insert or update or delete on public.engineering_schedule_calendar_exceptions
for each row execute function public.recalculate_planning_baselines_after_calendar_change();

create or replace function public.recalculate_schedule_after_dependency_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid := coalesce(new.company_id, old.company_id);
  v_project_id uuid := coalesce(new.project_id, old.project_id);
  v_baseline_id uuid := coalesce(new.baseline_id, old.baseline_id);
  v_predecessor_id uuid := coalesce(new.predecessor_id, old.predecessor_id);
  v_status text;
begin
  select status into v_status from public.engineering_schedule_baselines
  where id = v_baseline_id and company_id = v_company_id and project_id = v_project_id;
  if v_status in ('draft', 'review') then
    perform public.recalculate_engineering_schedule_successors(v_company_id, v_project_id, v_baseline_id, v_predecessor_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists recalculate_schedule_after_dependency_change_trigger on public.engineering_schedule_dependencies;
create trigger recalculate_schedule_after_dependency_change_trigger
after insert or update or delete on public.engineering_schedule_dependencies
for each row execute function public.recalculate_schedule_after_dependency_change();

-- Aprovação da linha de base também é validada no banco: todas as atividades
-- ativas devem estar aprovadas e a rede não pode conter ciclo.
create or replace function public.validate_engineering_schedule_baseline_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_sorted integer;
begin
  if new.status = 'approved' and old.status <> 'approved' then
    if exists (
      select 1 from public.engineering_schedule_activities a
      where a.baseline_id = new.id and a.record_status = 'active' and a.planning_status <> 'approved'
    ) then
      raise exception 'Aprove todas as atividades antes de oficializar a linha de base.';
    end if;

    select count(*) into v_total
    from public.engineering_schedule_activities a
    where a.baseline_id = new.id and a.record_status = 'active';

    with recursive topo(id) as (
      select a.id
      from public.engineering_schedule_activities a
      where a.baseline_id = new.id and a.record_status = 'active'
        and not exists (
          select 1 from public.engineering_schedule_dependencies d
          join public.engineering_schedule_activities p on p.id = d.predecessor_id and p.record_status = 'active'
          where d.baseline_id = new.id and d.successor_id = a.id
        )
      union
      select d.successor_id
      from topo t
      join public.engineering_schedule_dependencies d on d.predecessor_id = t.id and d.baseline_id = new.id
      join public.engineering_schedule_activities s on s.id = d.successor_id and s.record_status = 'active'
    )
    select count(distinct id) into v_sorted from topo;

    if coalesce(v_sorted, 0) <> coalesce(v_total, 0) then
      raise exception 'A rede do cronograma possui dependência circular. Corrija o ciclo antes de aprovar.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_engineering_schedule_baseline_approval_trigger on public.engineering_schedule_baselines;
create trigger validate_engineering_schedule_baseline_approval_trigger
before update of status on public.engineering_schedule_baselines
for each row execute function public.validate_engineering_schedule_baseline_approval();

commit;