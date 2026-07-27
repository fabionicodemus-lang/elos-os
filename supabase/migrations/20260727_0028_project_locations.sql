-- Elos OS — Empreendimentos · Locais e pavimentos
-- Reutiliza a estrutura técnica dos levantamentos como cadastro único da obra.

begin;

-- O cadastro de locais passa a ser acessível também pelas permissões do módulo Empreendimentos.
drop policy if exists engineering_takeoff_locations_select on public.engineering_takeoff_locations;
create policy engineering_takeoff_locations_select on public.engineering_takeoff_locations
for select using (
  public.has_company_permission(company_id, 'projects.view')
  or public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'takeoffs.view')
  or public.has_company_permission(company_id, 'takeoffs.manage')
);

drop policy if exists engineering_takeoff_locations_insert on public.engineering_takeoff_locations;
create policy engineering_takeoff_locations_insert on public.engineering_takeoff_locations
for insert with check (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'takeoffs.manage')
);

drop policy if exists engineering_takeoff_locations_update on public.engineering_takeoff_locations;
create policy engineering_takeoff_locations_update on public.engineering_takeoff_locations
for update using (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'takeoffs.manage')
) with check (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'takeoffs.manage')
);

-- Mantém as memórias sem override sincronizadas quando o multiplicador oficial muda.
create or replace function public.sync_takeoffs_from_location_multiplier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  repetition_label text;
begin
  if new.repetitions is distinct from old.repetitions then
    repetition_label := trim(trailing '.' from trim(trailing '0' from new.repetitions::text));

    update public.engineering_takeoffs
    set
      location_repetitions_snapshot = new.repetitions,
      total_quantity = quantity_per_location * new.repetitions,
      formula = regexp_replace(formula, '^[^×]*×', repetition_label || ' ×'),
      updated_at = now()
    where location_id = new.id
      and repetition_override is null
      and record_status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists engineering_location_multiplier_sync on public.engineering_takeoff_locations;
create trigger engineering_location_multiplier_sync
after update of repetitions on public.engineering_takeoff_locations
for each row
execute function public.sync_takeoffs_from_location_multiplier();

-- O total de pavimentos da ficha do empreendimento acompanha a estrutura ativa.
create or replace function public.sync_project_floor_count_from_locations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_project_id uuid;
begin
  target_project_id := coalesce(new.project_id, old.project_id);

  update public.projects
  set
    total_floors = coalesce((
      select round(sum(location.repetitions))::integer
      from public.engineering_takeoff_locations location
      where location.project_id = target_project_id
        and location.location_type = 'floor'
        and location.status = 'active'
    ), 0),
    updated_at = now()
  where id = target_project_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists engineering_location_floor_count_sync on public.engineering_takeoff_locations;
create trigger engineering_location_floor_count_sync
after insert or update of repetitions, location_type, status or delete
on public.engineering_takeoff_locations
for each row
execute function public.sync_project_floor_count_from_locations();

-- Importação transacional de uma estrutura colada em lote.
create or replace function public.import_project_locations(
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
  item_name text;
  item_type text;
  item_parent_code text;
  item_repetitions numeric;
  item_sort_order integer;
  item_status text;
  parent_location_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'projects.manage')
     and not public.has_company_permission(p_company_id, 'takeoffs.manage') then
    raise exception 'Sem permissão para importar a estrutura da obra.';
  end if;

  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and project.company_id = p_company_id
  ) then
    raise exception 'O empreendimento informado não pertence à empresa.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Informe pelo menos um local para importar.';
  end if;

  -- Primeira passagem: cria ou atualiza todos os locais sem dependência do superior.
  for item in select value from jsonb_array_elements(p_rows)
  loop
    item_code := upper(trim(coalesce(item->>'code', '')));
    item_name := trim(coalesce(item->>'name', ''));
    item_type := coalesce(nullif(item->>'location_type', ''), 'floor');
    item_repetitions := coalesce((item->>'repetitions')::numeric, 1);
    item_sort_order := coalesce((item->>'sort_order')::integer, 0);
    item_status := coalesce(nullif(item->>'status', ''), 'active');

    if item_code = '' or item_name = '' then
      raise exception 'Todos os locais precisam de código e nome.';
    end if;

    if item_type not in ('enterprise', 'tower', 'floor', 'unit', 'room', 'sector', 'external', 'other') then
      raise exception 'Tipo inválido no local %.', item_code;
    end if;

    if item_repetitions <= 0 then
      raise exception 'As repetições do local % precisam ser maiores que zero.', item_code;
    end if;

    if item_status not in ('active', 'inactive') then
      raise exception 'Status inválido no local %.', item_code;
    end if;

    insert into public.engineering_takeoff_locations (
      company_id,
      project_id,
      parent_id,
      code,
      name,
      location_type,
      repetitions,
      sort_order,
      notes,
      status,
      created_by
    ) values (
      p_company_id,
      p_project_id,
      null,
      item_code,
      item_name,
      item_type,
      item_repetitions,
      item_sort_order,
      nullif(trim(coalesce(item->>'notes', '')), ''),
      item_status,
      auth.uid()
    )
    on conflict (project_id, code) do update set
      name = excluded.name,
      location_type = excluded.location_type,
      repetitions = excluded.repetitions,
      sort_order = excluded.sort_order,
      notes = excluded.notes,
      status = excluded.status,
      updated_at = now();

    imported_count := imported_count + 1;
  end loop;

  -- Segunda passagem: resolve os vínculos hierárquicos pelos códigos importados.
  for item in select value from jsonb_array_elements(p_rows)
  loop
    item_code := upper(trim(coalesce(item->>'code', '')));
    item_parent_code := upper(trim(coalesce(item->>'parent_code', '')));
    parent_location_id := null;

    if item_parent_code <> '' then
      if item_parent_code = item_code then
        raise exception 'O local % não pode ser superior de si mesmo.', item_code;
      end if;

      select location.id into parent_location_id
      from public.engineering_takeoff_locations location
      where location.project_id = p_project_id
        and upper(location.code) = item_parent_code
      limit 1;

      if parent_location_id is null then
        raise exception 'Local superior % não encontrado para %.', item_parent_code, item_code;
      end if;
    end if;

    update public.engineering_takeoff_locations
    set parent_id = parent_location_id,
        updated_at = now()
    where project_id = p_project_id
      and upper(code) = item_code;
  end loop;

  return imported_count;
end;
$$;

grant execute on function public.import_project_locations(uuid, uuid, jsonb) to authenticated;

-- Recalcula os empreendimentos já existentes após instalar a migration.
update public.projects project
set total_floors = coalesce((
  select round(sum(location.repetitions))::integer
  from public.engineering_takeoff_locations location
  where location.project_id = project.id
    and location.location_type = 'floor'
    and location.status = 'active'
), 0);

commit;
