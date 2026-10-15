begin;

alter table public.commercial_feasibility_sales_velocities
  add column if not exists target_units integer;

alter table public.commercial_feasibility_sales_velocities
  drop constraint if exists commercial_feasibility_sales_velocities_target_units_check;

alter table public.commercial_feasibility_sales_velocities
  add constraint commercial_feasibility_sales_velocities_target_units_check
  check (target_units is null or target_units >= 0);

with available as (
  select
    company_id,
    study_id,
    greatest(0, sum(greatest(coalesce(quantity,0) - coalesce(barter_units,0), 0)))::integer as available_units
  from public.commercial_feasibility_unit_types
  group by company_id, study_id
), ranked as (
  select
    v.id,
    a.available_units,
    sum(coalesce(v.target_units_pct,0)) over (
      partition by v.company_id, v.study_id
      order by v.sort_order, v.id
      rows between unbounded preceding and current row
    ) as cumulative_pct,
    sum(coalesce(v.target_units_pct,0)) over (
      partition by v.company_id, v.study_id
      order by v.sort_order, v.id
      rows between unbounded preceding and 1 preceding
    ) as previous_pct
  from public.commercial_feasibility_sales_velocities v
  join available a
    on a.company_id = v.company_id
   and a.study_id = v.study_id
  where v.phase_key is not null
    and v.target_units is null
)
update public.commercial_feasibility_sales_velocities v
set target_units = greatest(
  0,
  round(r.available_units * coalesce(r.cumulative_pct,0) / 100.0)::integer
  - round(r.available_units * coalesce(r.previous_pct,0) / 100.0)::integer
)
from ranked r
where r.id = v.id;

comment on column public.commercial_feasibility_sales_velocities.target_units is
  'Primary sales target for the phase, in commercializable units. target_units_pct is kept synchronized for compatibility and reporting.';

commit;
