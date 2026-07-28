-- Elos OS — Cronograma · Pesos físicos por serviço
-- Separa o andamento físico do simples peso financeiro das atividades.

begin;

create table if not exists public.engineering_schedule_service_weights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  physical_weight_percent numeric(9,4) not null,
  distribution_method text not null default 'quantity'
    check (distribution_method in ('quantity', 'cost', 'duration', 'equal')),
  source text not null default 'manual'
    check (source in ('manual', 'suggested_budget', 'suggested_duration')),
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (baseline_id, service_id),
  constraint schedule_service_weight_range_check
    check (physical_weight_percent between 0 and 100)
);

create index if not exists schedule_service_weights_project_baseline_idx
  on public.engineering_schedule_service_weights(project_id, baseline_id, service_id);

alter table public.engineering_schedule_service_weights enable row level security;

drop policy if exists schedule_service_weights_select on public.engineering_schedule_service_weights;
create policy schedule_service_weights_select
on public.engineering_schedule_service_weights
for select to authenticated
using (
  public.has_company_permission(company_id, 'execution.schedule.view')
  or public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists schedule_service_weights_insert on public.engineering_schedule_service_weights;
create policy schedule_service_weights_insert
on public.engineering_schedule_service_weights
for insert to authenticated
with check (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists schedule_service_weights_update on public.engineering_schedule_service_weights;
create policy schedule_service_weights_update
on public.engineering_schedule_service_weights
for update to authenticated
using (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
)
with check (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists schedule_service_weights_delete on public.engineering_schedule_service_weights;
create policy schedule_service_weights_delete
on public.engineering_schedule_service_weights
for delete to authenticated
using (
  public.has_company_permission(company_id, 'execution.schedule.manage')
  or public.has_company_permission(company_id, 'schedule.manage')
);

create or replace function public.save_schedule_service_weights(
  p_company_id uuid,
  p_project_id uuid,
  p_baseline_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  row_count integer := 0;
  total_weight numeric := 0;
  item_service_id uuid;
  item_weight numeric;
  item_method text;
  item_source text;
  expected_service_count integer;
  supplied_service_count integer;
begin
  if not public.has_company_permission(p_company_id, 'execution.schedule.manage')
     and not public.has_company_permission(p_company_id, 'schedule.manage') then
    raise exception 'Sem permissão para definir os pesos físicos do cronograma.';
  end if;

  if not exists (
    select 1
    from public.engineering_schedule_baselines baseline
    where baseline.id = p_baseline_id
      and baseline.company_id = p_company_id
      and baseline.project_id = p_project_id
      and baseline.status <> 'archived'
  ) then
    raise exception 'A linha de base informada não pertence ao empreendimento.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Informe os pesos físicos dos serviços.';
  end if;

  select count(distinct activity.service_id)
  into expected_service_count
  from public.engineering_schedule_activities activity
  where activity.company_id = p_company_id
    and activity.project_id = p_project_id
    and activity.baseline_id = p_baseline_id
    and activity.record_status = 'active'
    and activity.service_id is not null;

  select count(distinct (value->>'service_id'))
  into supplied_service_count
  from jsonb_array_elements(p_rows);

  if supplied_service_count <> expected_service_count then
    raise exception 'Todos os serviços ativos da linha de base precisam possuir um peso físico.';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    item_service_id := nullif(item->>'service_id', '')::uuid;
    item_weight := coalesce(nullif(item->>'physical_weight_percent', '')::numeric, 0);
    item_method := coalesce(nullif(item->>'distribution_method', ''), 'quantity');
    item_source := coalesce(nullif(item->>'source', ''), 'manual');

    if item_service_id is null or not exists (
      select 1
      from public.engineering_schedule_activities activity
      where activity.company_id = p_company_id
        and activity.project_id = p_project_id
        and activity.baseline_id = p_baseline_id
        and activity.service_id = item_service_id
        and activity.record_status = 'active'
    ) then
      raise exception 'Um dos serviços não pertence à linha de base selecionada.';
    end if;

    if item_weight < 0 or item_weight > 100 then
      raise exception 'Cada peso físico deve estar entre 0%% e 100%%.';
    end if;

    if item_method not in ('quantity', 'cost', 'duration', 'equal') then
      raise exception 'Método de distribuição inválido.';
    end if;

    if item_source not in ('manual', 'suggested_budget', 'suggested_duration') then
      item_source := 'manual';
    end if;

    total_weight := total_weight + item_weight;
  end loop;

  if abs(total_weight - 100) > 0.01 then
    raise exception 'A soma dos pesos físicos precisa ser exatamente 100%%. Soma atual: %%%.', round(total_weight, 4);
  end if;

  delete from public.engineering_schedule_service_weights weight_record
  where weight_record.company_id = p_company_id
    and weight_record.project_id = p_project_id
    and weight_record.baseline_id = p_baseline_id;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.engineering_schedule_service_weights (
      company_id,
      project_id,
      baseline_id,
      service_id,
      physical_weight_percent,
      distribution_method,
      source,
      notes,
      created_by,
      updated_by
    ) values (
      p_company_id,
      p_project_id,
      p_baseline_id,
      (item->>'service_id')::uuid,
      (item->>'physical_weight_percent')::numeric,
      coalesce(nullif(item->>'distribution_method', ''), 'quantity'),
      coalesce(nullif(item->>'source', ''), 'manual'),
      nullif(trim(coalesce(item->>'notes', '')), ''),
      auth.uid(),
      auth.uid()
    );

    row_count := row_count + 1;
  end loop;

  return row_count;
end;
$$;

grant select, insert, update, delete on public.engineering_schedule_service_weights to authenticated;
grant execute on function public.save_schedule_service_weights(uuid, uuid, uuid, jsonb) to authenticated;

commit;
