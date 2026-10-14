-- Elos OS — Pré-Obra 9.5 · Governança de snapshots e produtividade histórica

begin;

-- Orçamento aprovado: campos que formam o snapshot técnico/financeiro não voltam a
-- ser editáveis. Permanecem permitidos: definição como base, metadados do base,
-- política de reajuste e arquivamento.
create or replace function public.guard_approved_engineering_budget_header()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' then
    if new.status not in ('approved', 'archived') then
      raise exception 'Orçamento aprovado é imutável. Crie uma nova revisão em vez de reabrir o snapshot.';
    end if;
    if new.company_id is distinct from old.company_id
       or new.project_id is distinct from old.project_id
       or new.code is distinct from old.code
       or new.name is distinct from old.name
       or new.version is distinct from old.version
       or new.reference_date is distinct from old.reference_date
       or new.area_m2 is distinct from old.area_m2
       or new.bdi_percentage is distinct from old.bdi_percentage
       or new.notes is distinct from old.notes
       or new.source_system is distinct from old.source_system
       or new.source_id is distinct from old.source_id then
      raise exception 'Orçamento aprovado é imutável. Crie uma nova revisão para alterar os dados da revisão.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_approved_engineering_budget_header_trigger on public.engineering_budgets;
create trigger guard_approved_engineering_budget_header_trigger
before update on public.engineering_budgets
for each row execute function public.guard_approved_engineering_budget_header();

-- Linha de base aprovada: o plano oficial não pode ser reaberto ou ter seus
-- parâmetros estruturais alterados. O arquivamento continua permitido.
create or replace function public.guard_approved_engineering_schedule_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'approved' then
    if new.status not in ('approved', 'archived') then
      raise exception 'Linha de base aprovada é imutável. Crie uma nova linha de base para replanejar.';
    end if;
    if new.company_id is distinct from old.company_id
       or new.project_id is distinct from old.project_id
       or new.budget_id is distinct from old.budget_id
       or new.code is distinct from old.code
       or new.name is distinct from old.name
       or new.version is distinct from old.version
       or new.start_date is distinct from old.start_date
       or new.work_on_saturday is distinct from old.work_on_saturday
       or new.notes is distinct from old.notes then
      raise exception 'Linha de base aprovada é imutável. Crie uma nova linha de base para alterar o planejamento.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_approved_engineering_schedule_baseline_trigger on public.engineering_schedule_baselines;
create trigger guard_approved_engineering_schedule_baseline_trigger
before update on public.engineering_schedule_baselines
for each row execute function public.guard_approved_engineering_schedule_baseline();

-- Produtividade histórica calculada apenas sobre dias realmente trabalháveis no
-- calendário da própria obra/linha de base.
create or replace view public.engineering_service_productivity_history
with (security_invoker = true)
as
with completed as (
  select
    a.company_id,
    a.project_id,
    a.service_id,
    a.team_count as planned_team_count,
    b.work_on_saturday,
    t.actual_start,
    t.actual_finish,
    t.actual_quantity,
    t.team_count as actual_team_count,
    (
      select count(*)::numeric
      from generate_series(t.actual_start, t.actual_finish, interval '1 day') day_value
      where public.engineering_schedule_is_workday(
        a.company_id,
        a.project_id,
        day_value::date,
        b.work_on_saturday
      )
    ) as workdays
  from public.engineering_schedule_activity_tracking t
  join public.engineering_schedule_activities a on a.id = t.activity_id
  join public.engineering_schedule_baselines b on b.id = a.baseline_id
  where a.service_id is not null
    and t.progress_percent = 100
    and t.actual_quantity > 0
    and t.actual_start is not null
    and t.actual_finish is not null
    and t.actual_finish >= t.actual_start
)
select
  company_id,
  service_id,
  count(*)::integer as sample_count,
  avg(actual_quantity / greatest(1, workdays) / greatest(1, coalesce(actual_team_count, planned_team_count, 1)))::numeric(18,6) as avg_productivity_per_team_day,
  min(actual_quantity / greatest(1, workdays) / greatest(1, coalesce(actual_team_count, planned_team_count, 1)))::numeric(18,6) as min_productivity_per_team_day,
  max(actual_quantity / greatest(1, workdays) / greatest(1, coalesce(actual_team_count, planned_team_count, 1)))::numeric(18,6) as max_productivity_per_team_day,
  max(actual_finish) as last_actual_finish
from completed
group by company_id, service_id;

grant select on public.engineering_service_productivity_history to authenticated;

commit;