-- Elos OS — Engenharia: composição específica por item do orçamento
-- Cada serviço da revisão recebe um snapshot próprio, independente do catálogo corporativo.

begin;

create table if not exists public.engineering_budget_item_compositions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete cascade,
  budget_item_id uuid not null references public.engineering_budget_items(id) on delete cascade,
  source_service_id uuid references public.engineering_services(id) on delete set null,
  source_composition_id uuid references public.engineering_service_compositions(id) on delete set null,
  is_customized boolean not null default false,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_item_id)
);

create table if not exists public.engineering_budget_item_composition_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  composition_id uuid not null references public.engineering_budget_item_compositions(id) on delete cascade,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  source_composition_item_id uuid references public.engineering_service_composition_items(id) on delete set null,
  coefficient numeric(18,8) not null default 1 check (coefficient > 0),
  waste_percentage numeric(9,4) not null default 0
    check (waste_percentage >= 0 and waste_percentage <= 1000),
  effective_coefficient numeric(18,8) generated always as (
    coefficient * (1 + waste_percentage / 100.0)
  ) stored,
  unit_price numeric(18,6) not null default 0 check (unit_price >= 0),
  price_source text not null default 'catalog_snapshot'
    check (price_source in ('catalog_snapshot', 'manual', 'koper', 'imported')),
  sort_order integer not null default 0,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (composition_id, input_id)
);

create index if not exists engineering_budget_item_compositions_budget_idx
  on public.engineering_budget_item_compositions(company_id, project_id, budget_id, status);
create index if not exists engineering_budget_item_composition_items_composition_idx
  on public.engineering_budget_item_composition_items(composition_id, status, sort_order, created_at);
create index if not exists engineering_budget_item_composition_items_input_idx
  on public.engineering_budget_item_composition_items(company_id, input_id, status);

create or replace function public.validate_engineering_budget_item_composition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  budget_item record;
begin
  select company_id, project_id, budget_id, service_id
  into budget_item
  from public.engineering_budget_items
  where id = new.budget_item_id;

  if not found then
    raise exception 'Item do orçamento não localizado.';
  end if;

  if new.company_id <> budget_item.company_id
     or new.project_id <> budget_item.project_id
     or new.budget_id <> budget_item.budget_id then
    raise exception 'A composição deve pertencer à mesma empresa, obra e revisão do item.';
  end if;

  if new.source_service_id is not null and budget_item.service_id is not null
     and new.source_service_id <> budget_item.service_id then
    raise exception 'O serviço de origem não corresponde ao item do orçamento.';
  end if;

  if new.source_composition_id is not null and not exists (
    select 1
    from public.engineering_service_compositions source_composition
    where source_composition.id = new.source_composition_id
      and source_composition.company_id = new.company_id
      and (
        new.source_service_id is null
        or source_composition.service_id = new.source_service_id
      )
  ) then
    raise exception 'A composição de origem não pertence à mesma empresa e serviço.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_engineering_budget_item_composition_trigger
  on public.engineering_budget_item_compositions;
create trigger validate_engineering_budget_item_composition_trigger
before insert or update on public.engineering_budget_item_compositions
for each row execute function public.validate_engineering_budget_item_composition();

create or replace function public.validate_engineering_budget_item_composition_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  header_company_id uuid;
begin
  select company_id
  into header_company_id
  from public.engineering_budget_item_compositions
  where id = new.composition_id;

  if header_company_id is null then
    raise exception 'Composição do orçamento não localizada.';
  end if;

  if new.company_id <> header_company_id then
    raise exception 'O insumo deve pertencer à mesma empresa da composição.';
  end if;

  if not exists (
    select 1
    from public.engineering_inputs input
    where input.id = new.input_id
      and input.company_id = new.company_id
  ) then
    raise exception 'O insumo não pertence à empresa da composição.';
  end if;

  if new.source_composition_item_id is not null and not exists (
    select 1
    from public.engineering_service_composition_items source_item
    where source_item.id = new.source_composition_item_id
      and source_item.company_id = new.company_id
      and source_item.input_id = new.input_id
  ) then
    raise exception 'O item de origem não corresponde ao insumo informado.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_engineering_budget_item_composition_item_trigger
  on public.engineering_budget_item_composition_items;
create trigger validate_engineering_budget_item_composition_item_trigger
before insert or update on public.engineering_budget_item_composition_items
for each row execute function public.validate_engineering_budget_item_composition_item();

create or replace function public.create_engineering_budget_item_composition_snapshot(
  p_budget_item_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  budget_item record;
  source_composition_id uuid;
  target_composition_id uuid;
begin
  select id, company_id, project_id, budget_id, service_id
  into budget_item
  from public.engineering_budget_items
  where id = p_budget_item_id;

  if not found then
    raise exception 'Item do orçamento não localizado.';
  end if;

  select id
  into target_composition_id
  from public.engineering_budget_item_compositions
  where budget_item_id = p_budget_item_id;

  if target_composition_id is not null then
    return target_composition_id;
  end if;

  if budget_item.service_id is not null then
    select id
    into source_composition_id
    from public.engineering_service_compositions
    where company_id = budget_item.company_id
      and service_id = budget_item.service_id
      and status = 'active'
    limit 1;
  end if;

  insert into public.engineering_budget_item_compositions (
    company_id,
    project_id,
    budget_id,
    budget_item_id,
    source_service_id,
    source_composition_id,
    is_customized,
    status,
    created_by
  ) values (
    budget_item.company_id,
    budget_item.project_id,
    budget_item.budget_id,
    budget_item.id,
    budget_item.service_id,
    source_composition_id,
    false,
    'active',
    p_created_by
  )
  on conflict (budget_item_id) do nothing
  returning id into target_composition_id;

  if target_composition_id is null then
    select id
    into target_composition_id
    from public.engineering_budget_item_compositions
    where budget_item_id = p_budget_item_id;
  end if;

  if source_composition_id is not null then
    insert into public.engineering_budget_item_composition_items (
      company_id,
      composition_id,
      input_id,
      source_composition_item_id,
      coefficient,
      waste_percentage,
      unit_price,
      price_source,
      sort_order,
      notes,
      status,
      created_by
    )
    select
      budget_item.company_id,
      target_composition_id,
      source_item.input_id,
      source_item.id,
      source_item.coefficient,
      source_item.waste_percentage,
      coalesce(
        (
          select price.final_unit_price
          from public.engineering_input_prices price
          where price.company_id = budget_item.company_id
            and price.input_id = source_item.input_id
            and price.project_id = budget_item.project_id
            and price.status = 'active'
            and price.is_adopted = true
          order by price.price_date desc, price.created_at desc
          limit 1
        ),
        (
          select price.final_unit_price
          from public.engineering_input_prices price
          where price.company_id = budget_item.company_id
            and price.input_id = source_item.input_id
            and price.project_id is null
            and price.status = 'active'
            and price.is_adopted = true
          order by price.price_date desc, price.created_at desc
          limit 1
        ),
        0
      ),
      'catalog_snapshot',
      source_item.sort_order,
      source_item.notes,
      source_item.status,
      p_created_by
    from public.engineering_service_composition_items source_item
    where source_item.company_id = budget_item.company_id
      and source_item.composition_id = source_composition_id
    on conflict (composition_id, input_id) do nothing;
  end if;

  return target_composition_id;
end;
$$;

create or replace function public.recalculate_engineering_budget_item_from_composition(
  p_composition_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_budget_item_id uuid;
  material_cost numeric(18,6);
  labor_cost numeric(18,6);
  equipment_cost numeric(18,6);
  other_cost numeric(18,6);
begin
  select budget_item_id
  into target_budget_item_id
  from public.engineering_budget_item_compositions
  where id = p_composition_id;

  if target_budget_item_id is null then
    raise exception 'Composição do orçamento não localizada.';
  end if;

  select
    coalesce(sum(case when input.category = 'material'
      then item.effective_coefficient * item.unit_price else 0 end), 0),
    coalesce(sum(case when input.category = 'labor'
      then item.effective_coefficient * item.unit_price else 0 end), 0),
    coalesce(sum(case when input.category = 'equipment'
      then item.effective_coefficient * item.unit_price else 0 end), 0),
    coalesce(sum(case when input.category not in ('material', 'labor', 'equipment')
      then item.effective_coefficient * item.unit_price else 0 end), 0)
  into material_cost, labor_cost, equipment_cost, other_cost
  from public.engineering_budget_item_composition_items item
  join public.engineering_inputs input on input.id = item.input_id
  where item.composition_id = p_composition_id
    and item.status = 'active';

  update public.engineering_budget_items
  set
    material_unit_cost = round(material_cost, 6),
    labor_unit_cost = round(labor_cost, 6),
    equipment_unit_cost = round(equipment_cost, 6),
    other_unit_cost = round(other_cost, 6),
    updated_at = now()
  where id = target_budget_item_id;
end;
$$;

create or replace function public.ensure_engineering_budget_item_composition(
  p_company_id uuid,
  p_budget_id uuid,
  p_budget_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Sem permissão para editar composições do orçamento.';
  end if;

  if not exists (
    select 1
    from public.engineering_budget_items item
    join public.engineering_budgets budget on budget.id = item.budget_id
    where item.id = p_budget_item_id
      and item.company_id = p_company_id
      and item.budget_id = p_budget_id
      and budget.company_id = p_company_id
      and budget.status <> 'archived'
  ) then
    raise exception 'Item do orçamento não localizado ou revisão arquivada.';
  end if;

  target_id := public.create_engineering_budget_item_composition_snapshot(
    p_budget_item_id,
    auth.uid()
  );

  return target_id;
end;
$$;

create or replace function public.save_engineering_budget_composition_item(
  p_company_id uuid,
  p_budget_id uuid,
  p_budget_item_id uuid,
  p_item_id uuid,
  p_input_id uuid,
  p_coefficient numeric,
  p_waste_percentage numeric,
  p_unit_price numeric,
  p_sort_order integer,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_composition_id uuid;
  saved_item_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Sem permissão para editar composições do orçamento.';
  end if;

  if p_coefficient is null or p_coefficient <= 0 then
    raise exception 'O coeficiente deve ser maior que zero.';
  end if;
  if p_waste_percentage is null or p_waste_percentage < 0 or p_waste_percentage > 1000 then
    raise exception 'A perda deve estar entre 0 e 1000%.';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'O preço unitário não pode ser negativo.';
  end if;

  if not exists (
    select 1
    from public.engineering_inputs input
    where input.id = p_input_id
      and input.company_id = p_company_id
      and input.status = 'active'
  ) then
    raise exception 'Insumo não localizado ou inativo.';
  end if;

  target_composition_id := public.ensure_engineering_budget_item_composition(
    p_company_id,
    p_budget_id,
    p_budget_item_id
  );

  if p_item_id is null then
    insert into public.engineering_budget_item_composition_items (
      company_id,
      composition_id,
      input_id,
      coefficient,
      waste_percentage,
      unit_price,
      price_source,
      sort_order,
      notes,
      status,
      created_by,
      updated_at
    ) values (
      p_company_id,
      target_composition_id,
      p_input_id,
      p_coefficient,
      p_waste_percentage,
      p_unit_price,
      'manual',
      coalesce(p_sort_order, 0),
      nullif(trim(coalesce(p_notes, '')), ''),
      'active',
      auth.uid(),
      now()
    )
    on conflict (composition_id, input_id) do update set
      coefficient = excluded.coefficient,
      waste_percentage = excluded.waste_percentage,
      unit_price = excluded.unit_price,
      price_source = 'manual',
      sort_order = excluded.sort_order,
      notes = excluded.notes,
      status = 'active',
      updated_at = now()
    returning id into saved_item_id;
  else
    update public.engineering_budget_item_composition_items
    set
      input_id = p_input_id,
      coefficient = p_coefficient,
      waste_percentage = p_waste_percentage,
      unit_price = p_unit_price,
      price_source = 'manual',
      sort_order = coalesce(p_sort_order, 0),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      status = 'active',
      updated_at = now()
    where id = p_item_id
      and composition_id = target_composition_id
      and company_id = p_company_id
    returning id into saved_item_id;

    if saved_item_id is null then
      raise exception 'Item da composição não localizado.';
    end if;
  end if;

  update public.engineering_budget_item_compositions
  set is_customized = true, updated_at = now()
  where id = target_composition_id;

  perform public.recalculate_engineering_budget_item_from_composition(target_composition_id);
  return saved_item_id;
exception
  when unique_violation then
    raise exception 'Este insumo já faz parte da composição. Edite o item existente.';
end;
$$;

create or replace function public.remove_engineering_budget_composition_item(
  p_company_id uuid,
  p_budget_id uuid,
  p_budget_item_id uuid,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_composition_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Sem permissão para editar composições do orçamento.';
  end if;

  target_composition_id := public.ensure_engineering_budget_item_composition(
    p_company_id,
    p_budget_id,
    p_budget_item_id
  );

  update public.engineering_budget_item_composition_items
  set status = 'inactive', updated_at = now()
  where id = p_item_id
    and composition_id = target_composition_id
    and company_id = p_company_id
    and status = 'active';

  if not found then
    raise exception 'Item da composição não localizado.';
  end if;

  update public.engineering_budget_item_compositions
  set is_customized = true, updated_at = now()
  where id = target_composition_id;

  perform public.recalculate_engineering_budget_item_from_composition(target_composition_id);
end;
$$;

create or replace function public.initialize_engineering_budget_item_composition_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_engineering_budget_item_composition_snapshot(new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists initialize_engineering_budget_item_composition_after_insert
  on public.engineering_budget_items;
create trigger initialize_engineering_budget_item_composition_after_insert
after insert on public.engineering_budget_items
for each row execute function public.initialize_engineering_budget_item_composition_trigger();

-- Cria snapshots para todos os itens existentes sem alterar os custos já gravados.
do $$
declare
  existing_item record;
begin
  for existing_item in
    select id, created_by
    from public.engineering_budget_items
  loop
    perform public.create_engineering_budget_item_composition_snapshot(
      existing_item.id,
      existing_item.created_by
    );
  end loop;
end;
$$;

alter table public.engineering_budget_item_compositions enable row level security;
alter table public.engineering_budget_item_composition_items enable row level security;

drop policy if exists engineering_budget_item_compositions_select
  on public.engineering_budget_item_compositions;
create policy engineering_budget_item_compositions_select
on public.engineering_budget_item_compositions
for select using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_item_compositions_insert
  on public.engineering_budget_item_compositions;
create policy engineering_budget_item_compositions_insert
on public.engineering_budget_item_compositions
for insert with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_item_compositions_update
  on public.engineering_budget_item_compositions;
create policy engineering_budget_item_compositions_update
on public.engineering_budget_item_compositions
for update using (
  public.has_company_permission(company_id, 'budgets.manage')
) with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_item_composition_items_select
  on public.engineering_budget_item_composition_items;
create policy engineering_budget_item_composition_items_select
on public.engineering_budget_item_composition_items
for select using (
  public.has_company_permission(company_id, 'budgets.view')
  or public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_item_composition_items_insert
  on public.engineering_budget_item_composition_items;
create policy engineering_budget_item_composition_items_insert
on public.engineering_budget_item_composition_items
for insert with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

drop policy if exists engineering_budget_item_composition_items_update
  on public.engineering_budget_item_composition_items;
create policy engineering_budget_item_composition_items_update
on public.engineering_budget_item_composition_items
for update using (
  public.has_company_permission(company_id, 'budgets.manage')
) with check (
  public.has_company_permission(company_id, 'budgets.manage')
);

grant select, insert, update on public.engineering_budget_item_compositions to authenticated;
grant select, insert, update on public.engineering_budget_item_composition_items to authenticated;

revoke all on function public.create_engineering_budget_item_composition_snapshot(uuid, uuid)
  from public, authenticated;
revoke all on function public.recalculate_engineering_budget_item_from_composition(uuid)
  from public, authenticated;
grant execute on function public.ensure_engineering_budget_item_composition(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.save_engineering_budget_composition_item(
  uuid, uuid, uuid, uuid, uuid, numeric, numeric, numeric, integer, text
) to authenticated;
grant execute on function public.remove_engineering_budget_composition_item(
  uuid, uuid, uuid, uuid
) to authenticated;

commit;
