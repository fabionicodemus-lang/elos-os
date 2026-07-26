-- Elos OS — Engenharia: importação em lote do levantamento de quantitativos
-- Cria/atualiza locais e grava memórias na revisão selecionada em uma única transação.

begin;

create or replace function public.import_engineering_takeoffs(
  p_company_id uuid,
  p_project_id uuid,
  p_budget_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  imported_row jsonb;
  row_location_id uuid;
  row_parent_id uuid;
  location_count integer := 0;
  memory_count integer := 0;
  seen_locations text[] := array[]::text[];
begin
  if not public.has_company_permission(p_company_id, 'takeoffs.manage') then
    raise exception 'Sem permissão para importar o levantamento.';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id
      and company_id = p_company_id
      and status <> 'archived'
  ) then
    raise exception 'A obra selecionada não está disponível.';
  end if;

  if not exists (
    select 1 from public.engineering_budgets
    where id = p_budget_id
      and company_id = p_company_id
      and project_id = p_project_id
      and status <> 'archived'
  ) then
    raise exception 'A revisão selecionada não está disponível.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma memória válida foi enviada.';
  end if;

  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'A importação permite no máximo 5.000 memórias por arquivo.';
  end if;

  -- Primeiro cria ou atualiza todos os locais, ainda sem a hierarquia.
  for imported_row in select value from jsonb_array_elements(p_rows)
  loop
    if not ((imported_row ->> 'location_code') = any(seen_locations)) then
      insert into public.engineering_takeoff_locations (
        company_id,
        project_id,
        code,
        name,
        location_type,
        repetitions,
        sort_order,
        notes,
        status,
        created_by,
        updated_at
      ) values (
        p_company_id,
        p_project_id,
        imported_row ->> 'location_code',
        imported_row ->> 'location_name',
        imported_row ->> 'location_type',
        (imported_row ->> 'location_repetitions')::numeric,
        coalesce((imported_row ->> 'location_sort_order')::integer, 0),
        nullif(imported_row ->> 'location_notes', ''),
        'active',
        auth.uid(),
        now()
      )
      on conflict (project_id, code) do update set
        name = excluded.name,
        location_type = excluded.location_type,
        repetitions = excluded.repetitions,
        sort_order = excluded.sort_order,
        notes = coalesce(excluded.notes, engineering_takeoff_locations.notes),
        status = 'active',
        updated_at = now();

      seen_locations := array_append(seen_locations, imported_row ->> 'location_code');
      location_count := location_count + 1;
    end if;
  end loop;

  -- Depois aplica a hierarquia, pois todos os locais do arquivo já existem.
  for imported_row in select value from jsonb_array_elements(p_rows)
  loop
    if nullif(imported_row ->> 'parent_location_code', '') is not null then
      select id into row_parent_id
      from public.engineering_takeoff_locations
      where company_id = p_company_id
        and project_id = p_project_id
        and code = imported_row ->> 'parent_location_code'
      limit 1;

      if row_parent_id is null then
        raise exception 'Local superior % não encontrado.', imported_row ->> 'parent_location_code';
      end if;

      update public.engineering_takeoff_locations
      set parent_id = row_parent_id,
          updated_at = now()
      where company_id = p_company_id
        and project_id = p_project_id
        and code = imported_row ->> 'location_code';
    end if;
  end loop;

  -- Por fim grava cada memória de cálculo.
  for imported_row in select value from jsonb_array_elements(p_rows)
  loop
    select id into row_location_id
    from public.engineering_takeoff_locations
    where company_id = p_company_id
      and project_id = p_project_id
      and code = imported_row ->> 'location_code'
    limit 1;

    if row_location_id is null then
      raise exception 'Local % não encontrado após a sincronização.', imported_row ->> 'location_code';
    end if;

    if not exists (
      select 1 from public.engineering_services
      where id = (imported_row ->> 'service_id')::uuid
        and company_id = p_company_id
        and status = 'active'
    ) then
      raise exception 'Serviço inválido ou inativo na importação.';
    end if;

    insert into public.engineering_takeoffs (
      company_id,
      project_id,
      budget_id,
      location_id,
      service_id,
      method,
      element_count,
      dimension_a,
      dimension_b,
      dimension_c,
      adjustment,
      location_repetitions_snapshot,
      repetition_override,
      repetition_reason,
      quantity_per_location,
      total_quantity,
      formula,
      unit_snapshot,
      source_reference,
      project_revision,
      description,
      status,
      record_status,
      created_by
    ) values (
      p_company_id,
      p_project_id,
      p_budget_id,
      row_location_id,
      (imported_row ->> 'service_id')::uuid,
      imported_row ->> 'method',
      coalesce((imported_row ->> 'element_count')::numeric, 1),
      nullif(imported_row ->> 'dimension_a', '')::numeric,
      nullif(imported_row ->> 'dimension_b', '')::numeric,
      nullif(imported_row ->> 'dimension_c', '')::numeric,
      coalesce((imported_row ->> 'adjustment')::numeric, 0),
      (imported_row ->> 'location_repetitions')::numeric,
      null,
      null,
      (imported_row ->> 'quantity_per_location')::numeric,
      (imported_row ->> 'total_quantity')::numeric,
      imported_row ->> 'formula',
      imported_row ->> 'unit_snapshot',
      nullif(imported_row ->> 'source_reference', ''),
      nullif(imported_row ->> 'project_revision', ''),
      nullif(imported_row ->> 'description', ''),
      imported_row ->> 'status',
      'active',
      auth.uid()
    );

    memory_count := memory_count + 1;
  end loop;

  return jsonb_build_object(
    'locations_processed', location_count,
    'memories_imported', memory_count
  );
end;
$$;

grant execute on function public.import_engineering_takeoffs(uuid, uuid, uuid, jsonb) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'import_engineering_takeoffs';
