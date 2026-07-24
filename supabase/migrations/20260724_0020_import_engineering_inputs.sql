-- Elos OS — Engenharia: importação em lote do catálogo de insumos
-- Sincroniza códigos existentes e cadastra novos insumos em uma única transação.

begin;

create or replace function public.import_engineering_inputs(
  p_company_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  imported_row jsonb;
  imported_count integer := 0;
  inserted_count integer := 0;
  updated_count integer := 0;
  row_code text;
  row_description text;
  row_unit text;
  row_category text;
  row_family_code text;
  row_family_label text;
  row_brand_reference text;
  row_technical_specification text;
  row_source_system text;
  row_source_code text;
  row_source_id text;
  row_notes text;
  row_status text;
  already_exists boolean;
begin
  if not public.has_company_permission(p_company_id, 'inputs.manage') then
    raise exception 'Sem permissão para importar o catálogo de insumos.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'O conteúdo da importação deve ser uma lista de insumos.';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhum insumo válido foi enviado.';
  end if;

  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'A importação permite no máximo 5.000 insumos por arquivo.';
  end if;

  for imported_row in
    select value from jsonb_array_elements(p_rows)
  loop
    row_code := upper(btrim(imported_row ->> 'code'));
    row_description := btrim(imported_row ->> 'description');
    row_unit := btrim(imported_row ->> 'unit');
    row_category := btrim(imported_row ->> 'category');
    row_family_code := nullif(upper(btrim(imported_row ->> 'family_code')), '');
    row_family_label := nullif(btrim(imported_row ->> 'family_label'), '');
    row_brand_reference := nullif(btrim(imported_row ->> 'brand_reference'), '');
    row_technical_specification := nullif(btrim(imported_row ->> 'technical_specification'), '');
    row_source_system := coalesce(nullif(btrim(imported_row ->> 'source_system'), ''), 'elos_os');
    row_source_code := nullif(btrim(imported_row ->> 'source_code'), '');
    row_source_id := nullif(btrim(imported_row ->> 'source_id'), '');
    row_notes := nullif(btrim(imported_row ->> 'notes'), '');
    row_status := coalesce(nullif(btrim(imported_row ->> 'status'), ''), 'active');

    if row_code is null or row_code = '' then
      raise exception 'Existe um insumo sem código na importação.';
    end if;

    if row_description is null or row_description = '' then
      raise exception 'O insumo % está sem descrição.', row_code;
    end if;

    if row_unit is null or row_unit = '' then
      raise exception 'O insumo % está sem unidade.', row_code;
    end if;

    if row_category not in ('material', 'labor', 'equipment', 'service', 'freight', 'other') then
      raise exception 'Natureza inválida no insumo %.', row_code;
    end if;

    if row_status not in ('active', 'inactive') then
      raise exception 'Status inválido no insumo %.', row_code;
    end if;

    if row_source_id is not null and exists (
      select 1
      from public.engineering_inputs input
      where input.company_id = p_company_id
        and input.source_system = row_source_system
        and input.source_id = row_source_id
        and input.code <> row_code
    ) then
      raise exception 'O id_origem % já está vinculado a outro código.', row_source_id;
    end if;

    select exists (
      select 1
      from public.engineering_inputs input
      where input.company_id = p_company_id
        and input.code = row_code
    ) into already_exists;

    insert into public.engineering_inputs (
      company_id,
      code,
      description,
      unit,
      category,
      family_code,
      family_label,
      brand_reference,
      technical_specification,
      source_system,
      source_code,
      source_id,
      notes,
      status,
      created_by,
      updated_at
    ) values (
      p_company_id,
      row_code,
      row_description,
      row_unit,
      row_category,
      row_family_code,
      row_family_label,
      row_brand_reference,
      row_technical_specification,
      row_source_system,
      row_source_code,
      row_source_id,
      row_notes,
      row_status,
      auth.uid(),
      now()
    )
    on conflict (company_id, code) do update set
      description = excluded.description,
      unit = excluded.unit,
      category = excluded.category,
      family_code = excluded.family_code,
      family_label = excluded.family_label,
      brand_reference = excluded.brand_reference,
      technical_specification = excluded.technical_specification,
      source_system = excluded.source_system,
      source_code = excluded.source_code,
      source_id = coalesce(excluded.source_id, engineering_inputs.source_id),
      notes = excluded.notes,
      status = excluded.status,
      updated_at = now();

    imported_count := imported_count + 1;
    if already_exists then
      updated_count := updated_count + 1;
    else
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'imported_count', imported_count,
    'inserted_count', inserted_count,
    'updated_count', updated_count
  );
end;
$$;

grant execute on function public.import_engineering_inputs(uuid, jsonb) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'import_engineering_inputs';
