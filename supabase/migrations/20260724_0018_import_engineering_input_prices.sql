-- Elos OS — Engenharia: importação em lote de preços e cotações
-- Recebe as linhas já validadas pelo servidor e grava tudo em uma única transação.

begin;

create or replace function public.import_engineering_input_prices(
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
  adopted_count integer := 0;
  row_input_id uuid;
  row_supplier_id uuid;
  row_project_id uuid;
  row_is_adopted boolean;
begin
  if not public.has_company_permission(p_company_id, 'prices.manage') then
    raise exception 'Sem permissão para importar preços e cotações.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'O conteúdo da importação deve ser uma lista de cotações.';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'Nenhuma cotação válida foi enviada.';
  end if;

  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'A importação permite no máximo 2.000 cotações por arquivo.';
  end if;

  for imported_row in
    select value from jsonb_array_elements(p_rows)
  loop
    row_input_id := (imported_row ->> 'input_id')::uuid;
    row_supplier_id := nullif(imported_row ->> 'supplier_id', '')::uuid;
    row_project_id := nullif(imported_row ->> 'project_id', '')::uuid;
    row_is_adopted := coalesce((imported_row ->> 'is_adopted')::boolean, false);

    if not exists (
      select 1
      from public.engineering_inputs input
      where input.id = row_input_id
        and input.company_id = p_company_id
        and input.status = 'active'
    ) then
      raise exception 'Insumo inválido ou inativo na importação.';
    end if;

    if row_supplier_id is not null and not exists (
      select 1
      from public.suppliers supplier
      where supplier.id = row_supplier_id
        and supplier.company_id = p_company_id
        and supplier.status = 'active'
    ) then
      raise exception 'Fornecedor inválido ou inativo na importação.';
    end if;

    if row_project_id is not null and not exists (
      select 1
      from public.projects project
      where project.id = row_project_id
        and project.company_id = p_company_id
        and project.status <> 'archived'
    ) then
      raise exception 'Obra inválida ou arquivada na importação.';
    end if;

    if row_is_adopted then
      update public.engineering_input_prices price
      set is_adopted = false,
          updated_at = now()
      where price.company_id = p_company_id
        and price.input_id = row_input_id
        and price.status = 'active'
        and price.is_adopted = true
        and (
          (row_project_id is null and price.project_id is null)
          or price.project_id = row_project_id
        );
    end if;

    insert into public.engineering_input_prices (
      company_id,
      project_id,
      input_id,
      supplier_id,
      price_date,
      unit_price,
      freight_unit_cost,
      other_unit_cost,
      discount_percentage,
      currency,
      is_adopted,
      source,
      notes,
      status,
      created_by
    ) values (
      p_company_id,
      row_project_id,
      row_input_id,
      row_supplier_id,
      (imported_row ->> 'price_date')::date,
      (imported_row ->> 'unit_price')::numeric,
      coalesce((imported_row ->> 'freight_unit_cost')::numeric, 0),
      coalesce((imported_row ->> 'other_unit_cost')::numeric, 0),
      coalesce((imported_row ->> 'discount_percentage')::numeric, 0),
      'BRL',
      row_is_adopted,
      nullif(imported_row ->> 'source', ''),
      nullif(imported_row ->> 'notes', ''),
      'active',
      auth.uid()
    );

    imported_count := imported_count + 1;
    if row_is_adopted then adopted_count := adopted_count + 1; end if;
  end loop;

  return jsonb_build_object(
    'imported_count', imported_count,
    'adopted_count', adopted_count
  );
end;
$$;

grant execute on function public.import_engineering_input_prices(uuid, jsonb) to authenticated;

commit;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'import_engineering_input_prices';
