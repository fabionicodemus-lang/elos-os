-- Elos OS — Pré-Obra 9.5
-- Governança de revisões, produtividade, calendário de obra e referências SINAPI versionadas.

begin;

-- -----------------------------------------------------------------------------
-- 1. Produtividade padrão por serviço
-- -----------------------------------------------------------------------------

alter table public.engineering_services
  add column if not exists default_productivity_per_team_day numeric(18,6),
  add column if not exists default_team_count numeric(12,4),
  add column if not exists productivity_notes text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'engineering_services_productivity_positive'
  ) then
    alter table public.engineering_services
      add constraint engineering_services_productivity_positive check (
        (default_productivity_per_team_day is null or default_productivity_per_team_day > 0)
        and (default_team_count is null or default_team_count > 0)
      );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Calendário real da obra
-- -----------------------------------------------------------------------------

create table if not exists public.engineering_schedule_calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  exception_date date not null,
  exception_type text not null check (exception_type in ('non_working', 'working')),
  name text not null,
  source text not null default 'manual',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, exception_date)
);
create index if not exists engineering_schedule_calendar_project_date_idx
  on public.engineering_schedule_calendar_exceptions(project_id, exception_date);

alter table public.engineering_schedule_calendar_exceptions enable row level security;
drop policy if exists engineering_schedule_calendar_select on public.engineering_schedule_calendar_exceptions;
create policy engineering_schedule_calendar_select on public.engineering_schedule_calendar_exceptions
for select to authenticated using (
  public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);
drop policy if exists engineering_schedule_calendar_write on public.engineering_schedule_calendar_exceptions;
create policy engineering_schedule_calendar_write on public.engineering_schedule_calendar_exceptions
for all to authenticated using (
  public.has_company_permission(company_id, 'schedule.manage')
) with check (
  public.has_company_permission(company_id, 'schedule.manage')
);
grant select, insert, update, delete on public.engineering_schedule_calendar_exceptions to authenticated;

create or replace function public.engineering_schedule_is_workday(
  p_company_id uuid,
  p_project_id uuid,
  p_date date,
  p_work_on_saturday boolean
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.engineering_schedule_calendar_exceptions e
      where e.company_id = p_company_id and e.project_id = p_project_id
        and e.exception_date = p_date and e.exception_type = 'working'
    ) then true
    when exists (
      select 1 from public.engineering_schedule_calendar_exceptions e
      where e.company_id = p_company_id and e.project_id = p_project_id
        and e.exception_date = p_date and e.exception_type = 'non_working'
    ) then false
    when extract(isodow from p_date) = 7 then false
    when extract(isodow from p_date) = 6 then coalesce(p_work_on_saturday, false)
    else true
  end;
$$;

grant execute on function public.engineering_schedule_is_workday(uuid, uuid, date, boolean) to authenticated;

create or replace function public.engineering_schedule_add_workdays(
  p_company_id uuid,
  p_project_id uuid,
  p_start date,
  p_duration integer,
  p_work_on_saturday boolean
)
returns date
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_date date := p_start;
  v_remaining integer := greatest(1, coalesce(p_duration, 1));
begin
  if p_start is null then return null; end if;
  while not public.engineering_schedule_is_workday(p_company_id, p_project_id, v_date, p_work_on_saturday) loop
    v_date := v_date + 1;
  end loop;
  v_remaining := v_remaining - 1;
  while v_remaining > 0 loop
    v_date := v_date + 1;
    if public.engineering_schedule_is_workday(p_company_id, p_project_id, v_date, p_work_on_saturday) then
      v_remaining := v_remaining - 1;
    end if;
  end loop;
  return v_date;
end;
$$;

grant execute on function public.engineering_schedule_add_workdays(uuid, uuid, date, integer, boolean) to authenticated;

-- Aplica produtividade padrão na geração automática e sempre calcula o término
-- usando o calendário real da obra. Em edição manual, produtividade/equipe não são
-- sobrescritas; apenas o término é coerente com início + duração.
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
  new.planned_finish := public.engineering_schedule_add_workdays(
    new.company_id, new.project_id, new.planned_start, new.duration_days, v_work_on_saturday
  );
  return new;
end;
$$;

drop trigger if exists engineering_schedule_defaults_trigger on public.engineering_schedule_activities;
create trigger engineering_schedule_defaults_trigger
before insert or update of planned_start, duration_days, quantity_snapshot, productivity_per_team_day, team_count, service_id
on public.engineering_schedule_activities
for each row execute function public.apply_engineering_schedule_defaults();

create or replace view public.engineering_service_productivity_history
with (security_invoker = true)
as
select
  a.company_id,
  a.service_id,
  count(*)::integer as sample_count,
  avg(
    t.actual_quantity
    / greatest(1, (t.actual_finish - t.actual_start + 1))
    / greatest(1, coalesce(t.team_count, a.team_count, 1))
  )::numeric(18,6) as avg_productivity_per_team_day,
  min(
    t.actual_quantity
    / greatest(1, (t.actual_finish - t.actual_start + 1))
    / greatest(1, coalesce(t.team_count, a.team_count, 1))
  )::numeric(18,6) as min_productivity_per_team_day,
  max(
    t.actual_quantity
    / greatest(1, (t.actual_finish - t.actual_start + 1))
    / greatest(1, coalesce(t.team_count, a.team_count, 1))
  )::numeric(18,6) as max_productivity_per_team_day,
  max(t.actual_finish) as last_actual_finish
from public.engineering_schedule_activity_tracking t
join public.engineering_schedule_activities a on a.id = t.activity_id
where a.service_id is not null
  and t.progress_percent = 100
  and t.actual_quantity > 0
  and t.actual_start is not null
  and t.actual_finish is not null
  and t.actual_finish >= t.actual_start
group by a.company_id, a.service_id;

grant select on public.engineering_service_productivity_history to authenticated;

create or replace function public.apply_service_productivity_to_baseline(
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
  v_count integer;
begin
  if not public.has_company_permission(p_company_id, 'schedule.manage') then
    raise exception 'Sem permissão para atualizar o planejamento.';
  end if;
  select status into v_status from public.engineering_schedule_baselines
  where id = p_baseline_id and company_id = p_company_id and project_id = p_project_id;
  if v_status is null then raise exception 'Linha de base não localizada.'; end if;
  if v_status = 'approved' then raise exception 'A linha de base aprovada é imutável. Crie uma nova revisão.'; end if;
  if v_status = 'archived' then raise exception 'Linha de base arquivada.'; end if;

  update public.engineering_schedule_activities a
  set productivity_per_team_day = s.default_productivity_per_team_day,
      team_count = coalesce(s.default_team_count, 1),
      duration_days = greatest(1, ceil(a.quantity_snapshot / (s.default_productivity_per_team_day * coalesce(s.default_team_count, 1)))::integer),
      updated_at = now()
  from public.engineering_services s
  where a.baseline_id = p_baseline_id
    and a.company_id = p_company_id
    and a.project_id = p_project_id
    and a.record_status = 'active'
    and a.service_id = s.id
    and s.company_id = p_company_id
    and s.default_productivity_per_team_day is not null
    and s.default_productivity_per_team_day > 0;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.apply_service_productivity_to_baseline(uuid, uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Orçamento aprovado e linha de base aprovada são snapshots imutáveis
-- -----------------------------------------------------------------------------

create or replace function public.guard_approved_budget_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget_id uuid;
  v_status text;
begin
  v_budget_id := coalesce(new.budget_id, old.budget_id);
  select status into v_status from public.engineering_budgets where id = v_budget_id;
  if v_status = 'approved' then
    raise exception 'Orçamento aprovado é imutável. Crie uma nova revisão para alterar escopo, quantidade ou custo.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_approved_budget_groups on public.engineering_budget_groups;
create trigger guard_approved_budget_groups before insert or update or delete on public.engineering_budget_groups
for each row execute function public.guard_approved_budget_child();
drop trigger if exists guard_approved_budget_items on public.engineering_budget_items;
create trigger guard_approved_budget_items before insert or update or delete on public.engineering_budget_items
for each row execute function public.guard_approved_budget_child();
drop trigger if exists guard_approved_budget_compositions on public.engineering_budget_item_compositions;
create trigger guard_approved_budget_compositions before insert or update or delete on public.engineering_budget_item_compositions
for each row execute function public.guard_approved_budget_child();

create or replace function public.guard_approved_budget_composition_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget_id uuid;
  v_status text;
  v_composition_id uuid := coalesce(new.composition_id, old.composition_id);
begin
  select c.budget_id into v_budget_id from public.engineering_budget_item_compositions c where c.id = v_composition_id;
  select status into v_status from public.engineering_budgets where id = v_budget_id;
  if v_status = 'approved' then
    raise exception 'Orçamento aprovado é imutável. Crie uma nova revisão para alterar a composição.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists guard_approved_budget_composition_items on public.engineering_budget_item_composition_items;
create trigger guard_approved_budget_composition_items before insert or update or delete on public.engineering_budget_item_composition_items
for each row execute function public.guard_approved_budget_composition_item();

create or replace function public.guard_approved_schedule_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baseline_id uuid := coalesce(new.baseline_id, old.baseline_id);
  v_status text;
begin
  select status into v_status from public.engineering_schedule_baselines where id = v_baseline_id;
  if v_status = 'approved' then
    raise exception 'Linha de base aprovada é imutável. Replaneje em uma nova linha de base; a execução deve usar o cronograma atual.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists guard_approved_schedule_activities on public.engineering_schedule_activities;
create trigger guard_approved_schedule_activities before insert or update or delete on public.engineering_schedule_activities
for each row execute function public.guard_approved_schedule_child();
drop trigger if exists guard_approved_schedule_dependencies on public.engineering_schedule_dependencies;
create trigger guard_approved_schedule_dependencies before insert or update or delete on public.engineering_schedule_dependencies
for each row execute function public.guard_approved_schedule_child();

-- Clona o snapshot aprovado, incluindo EAP, itens e composições específicas.
create or replace function public.clone_engineering_budget_revision(
  p_company_id uuid,
  p_budget_id uuid,
  p_new_version text,
  p_new_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.engineering_budgets%rowtype;
  v_new_budget_id uuid;
  v_group record;
  v_item record;
  v_comp record;
  v_new_group_id uuid;
  v_new_item_id uuid;
  v_new_comp_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Sem permissão para criar revisão de orçamento.';
  end if;
  if nullif(trim(coalesce(p_new_version, '')), '') is null then
    raise exception 'Informe a identificação da nova revisão.';
  end if;
  select * into v_source from public.engineering_budgets
  where id = p_budget_id and company_id = p_company_id;
  if v_source.id is null then raise exception 'Orçamento não localizado.'; end if;
  if v_source.status <> 'approved' then
    raise exception 'Somente uma revisão aprovada pode ser clonada como novo snapshot.';
  end if;

  insert into public.engineering_budgets (
    company_id, project_id, code, name, version, status, reference_date, area_m2,
    bdi_percentage, notes, source_system, source_id, created_by
  ) values (
    v_source.company_id, v_source.project_id, v_source.code,
    coalesce(nullif(trim(p_new_name), ''), v_source.name), upper(trim(p_new_version)),
    'draft', v_source.reference_date, v_source.area_m2, v_source.bdi_percentage,
    concat('Nova revisão criada a partir de ', v_source.code, ' · ', v_source.version, '. ', coalesce(v_source.notes, '')),
    'elos_os', null, auth.uid()
  ) returning id into v_new_budget_id;

  for v_group in select * from public.engineering_budget_groups where budget_id = v_source.id order by sort_order, code loop
    insert into public.engineering_budget_groups (
      company_id, project_id, budget_id, code, name, sort_order, notes, status, created_by
    ) values (
      v_group.company_id, v_group.project_id, v_new_budget_id, v_group.code, v_group.name,
      v_group.sort_order, v_group.notes, v_group.status, auth.uid()
    );
  end loop;

  for v_item in select * from public.engineering_budget_items where budget_id = v_source.id order by sort_order, description loop
    v_new_group_id := null;
    if v_item.group_id is not null then
      select ng.id into v_new_group_id
      from public.engineering_budget_groups og
      join public.engineering_budget_groups ng on ng.budget_id = v_new_budget_id and ng.code = og.code
      where og.id = v_item.group_id;
    end if;

    insert into public.engineering_budget_items (
      company_id, project_id, budget_id, group_id, service_id, code, description, unit,
      quantity, material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost,
      sort_order, notes, status, created_by
    ) values (
      v_item.company_id, v_item.project_id, v_new_budget_id, v_new_group_id, v_item.service_id,
      v_item.code, v_item.description, v_item.unit, v_item.quantity, v_item.material_unit_cost,
      v_item.labor_unit_cost, v_item.equipment_unit_cost, v_item.other_unit_cost,
      v_item.sort_order, v_item.notes, v_item.status, auth.uid()
    ) returning id into v_new_item_id;

    for v_comp in select * from public.engineering_budget_item_compositions where budget_item_id = v_item.id loop
      insert into public.engineering_budget_item_compositions (
        company_id, project_id, budget_id, budget_item_id, source_service_id,
        source_composition_id, is_customized, notes, status, created_by
      ) values (
        v_comp.company_id, v_comp.project_id, v_new_budget_id, v_new_item_id,
        v_comp.source_service_id, v_comp.source_composition_id, v_comp.is_customized,
        v_comp.notes, v_comp.status, auth.uid()
      ) returning id into v_new_comp_id;

      insert into public.engineering_budget_item_composition_items (
        company_id, composition_id, input_id, source_composition_item_id, coefficient,
        waste_percentage, unit_price, price_source, sort_order, notes, status, created_by
      )
      select company_id, v_new_comp_id, input_id, source_composition_item_id, coefficient,
        waste_percentage, unit_price, price_source, sort_order, notes, status, auth.uid()
      from public.engineering_budget_item_composition_items
      where composition_id = v_comp.id;
    end loop;
  end loop;

  return v_new_budget_id;
end;
$$;

grant execute on function public.clone_engineering_budget_revision(uuid, uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Curva ABC derivada do snapshot do orçamento
-- -----------------------------------------------------------------------------

create or replace view public.engineering_budget_abc_services
with (security_invoker = true)
as
select
  i.company_id,
  i.project_id,
  i.budget_id,
  i.id as budget_item_id,
  i.service_id,
  i.group_id,
  i.code,
  i.description,
  i.unit,
  i.quantity,
  i.unit_direct_cost,
  i.total_direct_cost
from public.engineering_budget_items i
where i.status = 'active';

grant select on public.engineering_budget_abc_services to authenticated;

create or replace view public.engineering_budget_abc_inputs
with (security_invoker = true)
as
select
  c.company_id,
  c.project_id,
  c.budget_id,
  ci.input_id,
  inp.code,
  inp.description,
  inp.unit,
  inp.category,
  sum(bi.quantity * ci.effective_coefficient)::numeric(24,6) as planned_quantity,
  case when sum(bi.quantity * ci.effective_coefficient) > 0
    then (sum(bi.quantity * ci.effective_coefficient * ci.unit_price) / sum(bi.quantity * ci.effective_coefficient))::numeric(18,6)
    else 0 end as weighted_unit_price,
  sum(bi.quantity * ci.effective_coefficient * ci.unit_price)::numeric(24,6) as total_cost
from public.engineering_budget_item_compositions c
join public.engineering_budget_items bi on bi.id = c.budget_item_id and bi.status = 'active'
join public.engineering_budget_item_composition_items ci on ci.composition_id = c.id and ci.status = 'active'
join public.engineering_inputs inp on inp.id = ci.input_id
group by c.company_id, c.project_id, c.budget_id, ci.input_id, inp.code, inp.description, inp.unit, inp.category;

grant select on public.engineering_budget_abc_inputs to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Biblioteca SINAPI versionada por empresa
-- -----------------------------------------------------------------------------

create table if not exists public.engineering_reference_catalogs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null default 'SINAPI',
  competence text not null check (competence ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  burden_type text not null default 'NAO_INFORMADO' check (burden_type in ('DESONERADO', 'NAO_DESONERADO', 'NAO_INFORMADO')),
  prices_status text not null default 'unknown' check (prices_status in ('available', 'partial', 'zeroed', 'unknown')),
  source_file text,
  source_url text,
  notes text,
  imported_by uuid,
  imported_at timestamptz not null default now(),
  unique (company_id, source, competence, state_code, burden_type)
);

create table if not exists public.engineering_reference_inputs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  catalog_id uuid not null references public.engineering_reference_catalogs(id) on delete cascade,
  source_code text not null,
  description text not null,
  unit text not null default 'un',
  category text,
  unit_price numeric(18,6) not null default 0 check (unit_price >= 0),
  has_price boolean generated always as (unit_price > 0) stored,
  raw_data jsonb not null default '{}'::jsonb,
  unique (catalog_id, source_code)
);

create table if not exists public.engineering_reference_compositions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  catalog_id uuid not null references public.engineering_reference_catalogs(id) on delete cascade,
  source_code text not null,
  description text not null,
  unit text not null default 'un',
  total_cost numeric(18,6) not null default 0 check (total_cost >= 0),
  has_cost boolean generated always as (total_cost > 0) stored,
  raw_data jsonb not null default '{}'::jsonb,
  unique (catalog_id, source_code)
);

create table if not exists public.engineering_reference_composition_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  composition_id uuid not null references public.engineering_reference_compositions(id) on delete cascade,
  item_type text not null default 'input' check (item_type in ('input', 'composition')),
  item_code text not null,
  description text,
  unit text,
  coefficient numeric(18,8) not null default 1 check (coefficient >= 0),
  unit_price numeric(18,6) not null default 0 check (unit_price >= 0),
  subtotal numeric(18,6) not null default 0 check (subtotal >= 0),
  sort_order integer not null default 0
);

create index if not exists engineering_reference_catalogs_company_idx
  on public.engineering_reference_catalogs(company_id, source, competence desc, state_code);
create index if not exists engineering_reference_inputs_search_idx
  on public.engineering_reference_inputs(catalog_id, source_code, description);
create index if not exists engineering_reference_compositions_search_idx
  on public.engineering_reference_compositions(catalog_id, source_code, description);

alter table public.engineering_reference_catalogs enable row level security;
alter table public.engineering_reference_inputs enable row level security;
alter table public.engineering_reference_compositions enable row level security;
alter table public.engineering_reference_composition_items enable row level security;

create policy engineering_reference_catalogs_select on public.engineering_reference_catalogs
for select to authenticated using (
  public.has_company_permission(company_id, 'inputs.view')
  or public.has_company_permission(company_id, 'inputs.manage')
);
create policy engineering_reference_catalogs_write on public.engineering_reference_catalogs
for all to authenticated using (public.has_company_permission(company_id, 'inputs.manage'))
with check (public.has_company_permission(company_id, 'inputs.manage'));
create policy engineering_reference_inputs_select on public.engineering_reference_inputs
for select to authenticated using (
  public.has_company_permission(company_id, 'inputs.view')
  or public.has_company_permission(company_id, 'inputs.manage')
);
create policy engineering_reference_inputs_write on public.engineering_reference_inputs
for all to authenticated using (public.has_company_permission(company_id, 'inputs.manage'))
with check (public.has_company_permission(company_id, 'inputs.manage'));
create policy engineering_reference_compositions_select on public.engineering_reference_compositions
for select to authenticated using (
  public.has_company_permission(company_id, 'services.view')
  or public.has_company_permission(company_id, 'services.manage')
);
create policy engineering_reference_compositions_write on public.engineering_reference_compositions
for all to authenticated using (public.has_company_permission(company_id, 'services.manage'))
with check (public.has_company_permission(company_id, 'services.manage'));
create policy engineering_reference_composition_items_select on public.engineering_reference_composition_items
for select to authenticated using (
  public.has_company_permission(company_id, 'services.view')
  or public.has_company_permission(company_id, 'services.manage')
);
create policy engineering_reference_composition_items_write on public.engineering_reference_composition_items
for all to authenticated using (public.has_company_permission(company_id, 'services.manage'))
with check (public.has_company_permission(company_id, 'services.manage'));

grant select, insert, update, delete on public.engineering_reference_catalogs to authenticated;
grant select, insert, update, delete on public.engineering_reference_inputs to authenticated;
grant select, insert, update, delete on public.engineering_reference_compositions to authenticated;
grant select, insert, update, delete on public.engineering_reference_composition_items to authenticated;

commit;