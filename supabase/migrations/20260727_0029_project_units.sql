-- Elos OS — Empreendimentos · Unidades privativas
-- Amplia a tabela de unidades já utilizada pelo módulo Comercial.

begin;

alter table public.units
  add column if not exists floor_location_id uuid references public.engineering_takeoff_locations(id) on delete set null,
  add column if not exists position text,
  add column if not exists common_area numeric(12,2),
  add column if not exists uncovered_private_area numeric(12,2),
  add column if not exists fractional_share numeric(14,10),
  add column if not exists parking_description text;

alter table public.units
  drop constraint if exists units_nonnegative_details_check;

alter table public.units
  add constraint units_nonnegative_details_check
  check (
    private_area is null or private_area >= 0
  ) and (
    total_area is null or total_area >= 0
  ) and (
    common_area is null or common_area >= 0
  ) and (
    uncovered_private_area is null or uncovered_private_area >= 0
  ) and (
    fractional_share is null or fractional_share >= 0
  ) and (
    bedrooms is null or bedrooms >= 0
  ) and (
    suites is null or suites >= 0
  ) and (
    parking_spaces is null or parking_spaces >= 0
  ) and (
    list_price is null or list_price >= 0
  );

create index if not exists units_floor_location_idx
  on public.units(project_id, floor_location_id)
  where floor_location_id is not null;

create index if not exists units_project_floor_status_idx
  on public.units(project_id, floor, status, code);

-- O mesmo cadastro passa a ser acessível pelos módulos Empreendimentos e Comercial.
drop policy if exists units_select on public.units;
create policy units_select on public.units
for select using (
  public.has_company_permission(company_id, 'projects.view')
  or public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'sales.view')
  or public.has_company_permission(company_id, 'sales.manage')
);

drop policy if exists units_insert on public.units;
create policy units_insert on public.units
for insert with check (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'sales.manage')
);

drop policy if exists units_update on public.units;
create policy units_update on public.units
for update using (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'sales.manage')
) with check (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'sales.manage')
);

-- Mantém o total de unidades da ficha do empreendimento sincronizado.
create or replace function public.sync_project_unit_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_project_id uuid;
begin
  if tg_op = 'DELETE' then
    target_project_id := old.project_id;
  else
    target_project_id := new.project_id;
  end if;

  update public.projects
  set
    total_units = (
      select count(*)::integer
      from public.units unit_record
      where unit_record.project_id = target_project_id
        and unit_record.status <> 'inactive'
    ),
    updated_at = now()
  where id = target_project_id;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists units_project_count_sync on public.units;
create trigger units_project_count_sync
after insert or update of status, project_id or delete
on public.units
for each row
execute function public.sync_project_unit_count();

-- Importação transacional por conteúdo colado do Excel ou CSV.
create or replace function public.import_project_units(
  p_company_id uuid,
  p_project_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  imported_count integer := 0;
  item_code text;
  item_status text;
  item_location_code text;
  resolved_location_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'projects.manage')
     and not public.has_company_permission(p_company_id, 'sales.manage') then
    raise exception 'Sem permissão para importar unidades.';
  end if;

  if not exists (
    select 1
    from public.projects project
    where project.id = p_project_id
      and project.company_id = p_company_id
  ) then
    raise exception 'O empreendimento informado não pertence à empresa.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Informe pelo menos uma unidade para importar.';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    item_code := upper(trim(coalesce(item->>'code', '')));
    item_status := coalesce(nullif(item->>'status', ''), 'available');
    item_location_code := upper(trim(coalesce(item->>'floor_location_code', '')));
    resolved_location_id := null;

    if item_code = '' then
      raise exception 'Todas as unidades precisam de código.';
    end if;

    if item_status not in ('available', 'reserved', 'sold', 'inactive') then
      raise exception 'Status inválido na unidade %.', item_code;
    end if;

    if item_location_code <> '' then
      select location.id into resolved_location_id
      from public.engineering_takeoff_locations location
      where location.company_id = p_company_id
        and location.project_id = p_project_id
        and upper(location.code) = item_location_code
        and location.status = 'active'
      limit 1;

      if resolved_location_id is null then
        raise exception 'Local ou pavimento % não encontrado para a unidade %.', item_location_code, item_code;
      end if;
    end if;

    insert into public.units (
      company_id,
      project_id,
      code,
      tower,
      floor,
      type,
      position,
      floor_location_id,
      private_area,
      uncovered_private_area,
      common_area,
      total_area,
      fractional_share,
      bedrooms,
      suites,
      parking_spaces,
      parking_description,
      list_price,
      status,
      registry,
      notes,
      created_by
    ) values (
      p_company_id,
      p_project_id,
      item_code,
      nullif(trim(coalesce(item->>'tower', '')), ''),
      nullif(item->>'floor', '')::integer,
      nullif(trim(coalesce(item->>'type', '')), ''),
      nullif(trim(coalesce(item->>'position', '')), ''),
      resolved_location_id,
      nullif(item->>'private_area', '')::numeric,
      nullif(item->>'uncovered_private_area', '')::numeric,
      nullif(item->>'common_area', '')::numeric,
      nullif(item->>'total_area', '')::numeric,
      nullif(item->>'fractional_share', '')::numeric,
      nullif(item->>'bedrooms', '')::integer,
      nullif(item->>'suites', '')::integer,
      nullif(item->>'parking_spaces', '')::integer,
      nullif(trim(coalesce(item->>'parking_description', '')), ''),
      nullif(item->>'list_price', '')::numeric,
      item_status,
      nullif(trim(coalesce(item->>'registry', '')), ''),
      nullif(trim(coalesce(item->>'notes', '')), ''),
      auth.uid()
    )
    on conflict (project_id, code) do update set
      tower = excluded.tower,
      floor = excluded.floor,
      type = excluded.type,
      position = excluded.position,
      floor_location_id = excluded.floor_location_id,
      private_area = excluded.private_area,
      uncovered_private_area = excluded.uncovered_private_area,
      common_area = excluded.common_area,
      total_area = excluded.total_area,
      fractional_share = excluded.fractional_share,
      bedrooms = excluded.bedrooms,
      suites = excluded.suites,
      parking_spaces = excluded.parking_spaces,
      parking_description = excluded.parking_description,
      list_price = excluded.list_price,
      status = case
        when exists (
          select 1 from public.sales sale
          where sale.unit_id = units.id
            and sale.status = 'active'
        ) then 'sold'
        else excluded.status
      end,
      registry = excluded.registry,
      notes = excluded.notes,
      updated_at = now();

    imported_count := imported_count + 1;
  end loop;

  return imported_count;
end;
$$;

grant execute on function public.import_project_units(uuid, uuid, jsonb) to authenticated;

update public.projects project
set total_units = (
  select count(*)::integer
  from public.units unit_record
  where unit_record.project_id = project.id
    and unit_record.status <> 'inactive'
);

commit;
