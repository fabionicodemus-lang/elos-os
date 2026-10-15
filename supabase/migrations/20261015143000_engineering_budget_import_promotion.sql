-- Elos OS — revisão e promoção controlada do importador de orçamento
-- Resolve pendências sem alterar o catálogo e promove o lote inteiro em uma única transação.

begin;

alter table public.engineering_budget_import_rows
  add column if not exists resolution_action text not null default 'unresolved'
    check (resolution_action in ('unresolved', 'auto', 'reuse', 'create', 'created', 'ignored')),
  add column if not exists canonical_category text
    check (canonical_category is null or canonical_category in ('material', 'labor', 'equipment', 'service', 'freight', 'other')),
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid references auth.users(id),
  add column if not exists resolved_at timestamptz;

alter table public.engineering_budget_import_batches
  add column if not exists promoted_budget_id uuid references public.engineering_budgets(id) on delete set null,
  add column if not exists promoted_by uuid references auth.users(id),
  add column if not exists promoted_at timestamptz;

update public.engineering_budget_import_rows
set resolution_action = case
  when entity_kind = 'group' then 'ignored'
  when target_entity_id is not null then 'auto'
  else 'unresolved'
end
where resolution_action = 'unresolved';

create or replace function public.prepare_engineering_budget_import_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resolution_action = 'unresolved' then
    if new.entity_kind = 'group' then
      new.resolution_action := 'ignored';
    elsif new.target_entity_id is not null then
      new.resolution_action := 'auto';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_engineering_budget_import_row() from public, anon, authenticated;

drop trigger if exists engineering_budget_import_row_prepare on public.engineering_budget_import_rows;
create trigger engineering_budget_import_row_prepare
before insert on public.engineering_budget_import_rows
for each row execute function public.prepare_engineering_budget_import_row();

create or replace function public.refresh_engineering_budget_import_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending integer;
  v_status text;
begin
  select count(*)::integer
  into v_pending
  from public.engineering_budget_import_rows
  where batch_id = p_batch_id
    and entity_kind in ('service', 'input')
    and resolution_action = 'unresolved';

  select status into v_status
  from public.engineering_budget_import_batches
  where id = p_batch_id;

  if v_status is null or v_status in ('promoted', 'cancelled', 'failed') then
    return;
  end if;

  update public.engineering_budget_import_batches
  set status = case when v_pending = 0 then 'ready' else 'review' end,
      updated_at = now()
  where id = p_batch_id;
end;
$$;

revoke all on function public.refresh_engineering_budget_import_batch(uuid) from public, anon;
grant execute on function public.refresh_engineering_budget_import_batch(uuid) to authenticated, service_role;

create or replace function public.resolve_engineering_budget_import_entity(
  p_company_id uuid,
  p_batch_id uuid,
  p_row_id uuid,
  p_action text,
  p_target_id uuid default null,
  p_category text default null,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.engineering_budget_import_rows%rowtype;
  v_batch public.engineering_budget_import_batches%rowtype;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_label text;
  v_count integer;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Sem permissão para revisar importações de orçamento.';
  end if;

  select * into v_batch
  from public.engineering_budget_import_batches
  where id = p_batch_id and company_id = p_company_id
  for update;

  if not found then raise exception 'Lote de importação não localizado.'; end if;
  if v_batch.status in ('promoted', 'cancelled', 'failed') then
    raise exception 'Este lote não pode mais ser alterado.';
  end if;

  select * into v_row
  from public.engineering_budget_import_rows
  where id = p_row_id and batch_id = p_batch_id and company_id = p_company_id;

  if not found then raise exception 'Pendência de importação não localizada.'; end if;
  if v_row.entity_kind not in ('service', 'input') then raise exception 'Somente serviços e insumos podem ser resolvidos.'; end if;
  if v_action not in ('reuse', 'create') then raise exception 'Ação de resolução inválida.'; end if;

  if v_action = 'reuse' then
    if p_target_id is null then raise exception 'Selecione o cadastro do Elos que será reutilizado.'; end if;
    if v_row.entity_kind = 'service' then
      select service.code || ' · ' || service.description into v_label
      from public.engineering_services service
      where service.id = p_target_id and service.company_id = p_company_id and service.status = 'active';
    else
      select input.code || ' · ' || input.description into v_label
      from public.engineering_inputs input
      where input.id = p_target_id and input.company_id = p_company_id and input.status = 'active';
    end if;
    if v_label is null then raise exception 'Cadastro de destino não localizado ou inativo.'; end if;
  else
    if v_row.entity_kind = 'input' and coalesce(p_category, '') not in ('material', 'labor', 'equipment', 'service', 'freight', 'other') then
      raise exception 'Informe a categoria do novo insumo.';
    end if;
    v_label := 'Criar novo cadastro Elos na promoção';
  end if;

  update public.engineering_budget_import_rows target
  set target_entity_type = case when v_row.entity_kind = 'service' then 'engineering_service' else 'engineering_input' end,
      target_entity_id = case when v_action = 'reuse' then p_target_id else null end,
      target_label = v_label,
      match_status = case when v_action = 'reuse' then 'mapped' else 'new' end,
      match_method = case when v_action = 'reuse' then 'manual_review' else 'manual_create' end,
      confidence = case when v_action = 'reuse' then 100 else null end,
      resolution_action = v_action,
      canonical_category = case when v_row.entity_kind = 'input' and v_action = 'create' then p_category else null end,
      resolution_note = nullif(btrim(coalesce(p_note, '')), ''),
      resolved_by = auth.uid(),
      resolved_at = now(),
      updated_at = now()
  where target.batch_id = p_batch_id
    and target.company_id = p_company_id
    and target.entity_kind = v_row.entity_kind
    and coalesce(public.integration_normalize_key(target.external_code), '') = coalesce(public.integration_normalize_key(v_row.external_code), '')
    and coalesce(public.integration_name_unit_key(target.external_name, target.external_unit), '') = coalesce(public.integration_name_unit_key(v_row.external_name, v_row.external_unit), '');

  get diagnostics v_count = row_count;
  perform public.refresh_engineering_budget_import_batch(p_batch_id);
  return v_count;
end;
$$;

revoke all on function public.resolve_engineering_budget_import_entity(uuid, uuid, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.resolve_engineering_budget_import_entity(uuid, uuid, uuid, text, uuid, text, text) to authenticated;

create or replace function public.budget_import_confirm_mapping(
  p_company_id uuid,
  p_project_id uuid,
  p_source_system text,
  p_source_entity_type text,
  p_external_code text,
  p_external_name text,
  p_external_unit text,
  p_target_entity_type text,
  p_target_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_scope text;
  v_scope_id uuid;
  v_kind text;
begin
  foreach v_kind in array array['code'::text, 'name_unit'::text]
  loop
    v_key := case
      when v_kind = 'code' then public.integration_normalize_key(p_external_code)
      else public.integration_name_unit_key(p_external_name, p_external_unit)
    end;
    if v_key is null then continue; end if;

    if exists (
      select 1 from public.integration_mappings mapping
      where mapping.company_id = p_company_id
        and mapping.source_system = public.integration_normalize_key(p_source_system)
        and mapping.source_entity_type = public.integration_normalize_key(p_source_entity_type)
        and mapping.scope = 'company'
        and mapping.scope_id = p_company_id
        and mapping.key_kind = v_kind
        and mapping.external_key = v_key
        and mapping.status = 'confirmed'
        and mapping.target_entity_id <> p_target_entity_id
    ) then
      v_scope := 'project';
      v_scope_id := p_project_id;
    else
      v_scope := 'company';
      v_scope_id := p_company_id;
    end if;

    insert into public.integration_mappings (
      company_id, project_id, source_system, source_entity_type, scope, scope_id,
      key_kind, external_key, external_code, external_name, external_unit,
      target_entity_type, target_entity_id, status, confidence, match_method,
      confirmed_by, confirmed_at, metadata, created_by, updated_at
    ) values (
      p_company_id,
      case when v_scope = 'project' then p_project_id else null end,
      public.integration_normalize_key(p_source_system), public.integration_normalize_key(p_source_entity_type),
      v_scope, v_scope_id, v_kind, v_key,
      nullif(btrim(p_external_code), ''), nullif(btrim(p_external_name), ''), nullif(btrim(p_external_unit), ''),
      public.integration_normalize_key(p_target_entity_type), p_target_entity_id,
      'confirmed', 100, 'budget_import_review', auth.uid(), now(),
      jsonb_build_object('origin', 'budget_import'), auth.uid(), now()
    )
    on conflict (company_id, source_system, source_entity_type, scope, scope_id, key_kind, external_key)
    do update set
      external_code = coalesce(excluded.external_code, integration_mappings.external_code),
      external_name = coalesce(excluded.external_name, integration_mappings.external_name),
      external_unit = coalesce(excluded.external_unit, integration_mappings.external_unit),
      target_entity_type = excluded.target_entity_type,
      target_entity_id = excluded.target_entity_id,
      status = 'confirmed', confidence = 100, match_method = 'budget_import_review',
      confirmed_by = auth.uid(), confirmed_at = now(),
      metadata = integration_mappings.metadata || excluded.metadata,
      updated_at = now();
  end loop;
end;
$$;

revoke all on function public.budget_import_confirm_mapping(uuid, uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.promote_engineering_budget_import(
  p_company_id uuid,
  p_batch_id uuid,
  p_budget_code text,
  p_budget_name text,
  p_budget_version text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.engineering_budget_import_batches%rowtype;
  v_entity record;
  v_group record;
  v_service record;
  v_input record;
  v_target_id uuid;
  v_budget_id uuid;
  v_group_id uuid;
  v_item_id uuid;
  v_composition_id uuid;
  v_unit_cost numeric(18,8);
  v_canonical_total numeric(18,6);
  v_difference numeric(18,6);
  v_code text;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Sem permissão para promover orçamento.';
  end if;
  if nullif(btrim(p_budget_code), '') is null or nullif(btrim(p_budget_name), '') is null or nullif(btrim(p_budget_version), '') is null then
    raise exception 'Código, nome e versão do orçamento são obrigatórios.';
  end if;

  select * into v_batch
  from public.engineering_budget_import_batches
  where id = p_batch_id and company_id = p_company_id
  for update;

  if not found then raise exception 'Lote não localizado.'; end if;
  perform public.refresh_engineering_budget_import_batch(p_batch_id);
  select * into v_batch from public.engineering_budget_import_batches where id = p_batch_id for update;
  if v_batch.status <> 'ready' then raise exception 'Resolva todas as pendências antes de promover o orçamento.'; end if;
  if v_batch.promoted_budget_id is not null then return v_batch.promoted_budget_id; end if;

  if exists (
    select 1 from public.engineering_budgets budget
    where budget.company_id = p_company_id and budget.project_id = v_batch.project_id
      and upper(budget.code) = upper(btrim(p_budget_code)) and upper(budget.version) = upper(btrim(p_budget_version))
  ) then
    raise exception 'Já existe orçamento com este código e versão nesta obra.';
  end if;

  -- Cria somente agora os cadastros que foram explicitamente marcados como novos.
  for v_entity in
    select distinct on (
      entity_kind,
      coalesce(public.integration_normalize_key(external_code), ''),
      coalesce(public.integration_name_unit_key(external_name, external_unit), '')
    ) *
    from public.engineering_budget_import_rows
    where batch_id = p_batch_id
      and entity_kind in ('service', 'input')
      and resolution_action = 'create'
    order by entity_kind,
      coalesce(public.integration_normalize_key(external_code), ''),
      coalesce(public.integration_name_unit_key(external_name, external_unit), ''),
      source_row
  loop
    if v_entity.entity_kind = 'service' then
      v_code := 'SRV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      insert into public.engineering_services (
        company_id, code, description, unit, group_code, default_method, status,
        source_system, source_id, notes, created_by
      ) values (
        p_company_id, v_code, coalesce(nullif(btrim(v_entity.external_name), ''), 'Serviço importado'),
        coalesce(nullif(btrim(v_entity.external_unit), ''), 'un'), v_entity.source_group_code, 'unit', 'active',
        'elos_os', 'budget-import:' || p_batch_id::text || ':service:' || v_entity.id::text,
        'Criado pela promoção controlada do orçamento ' || v_batch.file_name, auth.uid()
      ) returning id into v_target_id;
    else
      v_code := 'INS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      insert into public.engineering_inputs (
        company_id, code, description, unit, category, source_system, source_id, notes, status, created_by
      ) values (
        p_company_id, v_code, coalesce(nullif(btrim(v_entity.external_name), ''), 'Insumo importado'),
        coalesce(nullif(btrim(v_entity.external_unit), ''), 'un'), coalesce(v_entity.canonical_category, 'other'),
        'elos_os', 'budget-import:' || p_batch_id::text || ':input:' || v_entity.id::text,
        'Criado pela promoção controlada do orçamento ' || v_batch.file_name, 'active', auth.uid()
      ) returning id into v_target_id;
    end if;

    update public.engineering_budget_import_rows target
    set target_entity_type = case when v_entity.entity_kind = 'service' then 'engineering_service' else 'engineering_input' end,
        target_entity_id = v_target_id,
        target_label = v_code || ' · ' || coalesce(v_entity.external_name, ''),
        resolution_action = 'created', resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
    where target.batch_id = p_batch_id
      and target.entity_kind = v_entity.entity_kind
      and coalesce(public.integration_normalize_key(target.external_code), '') = coalesce(public.integration_normalize_key(v_entity.external_code), '')
      and coalesce(public.integration_name_unit_key(target.external_name, target.external_unit), '') = coalesce(public.integration_name_unit_key(v_entity.external_name, v_entity.external_unit), '');
  end loop;

  if exists (
    select 1 from public.engineering_budget_import_rows row
    where row.batch_id = p_batch_id and row.entity_kind in ('service', 'input') and row.target_entity_id is null
  ) then
    raise exception 'Há linhas sem cadastro Elos após a resolução.';
  end if;

  -- Confirma o aprendizado no Mapa de Integrações.
  for v_entity in
    select distinct entity_kind, external_code, external_name, external_unit, target_entity_id
    from public.engineering_budget_import_rows
    where batch_id = p_batch_id and entity_kind in ('service', 'input') and target_entity_id is not null
  loop
    perform public.budget_import_confirm_mapping(
      p_company_id, v_batch.project_id, v_batch.catalog_namespace,
      case when v_entity.entity_kind = 'service' then 'service' else 'input' end,
      v_entity.external_code, v_entity.external_name, v_entity.external_unit,
      case when v_entity.entity_kind = 'service' then 'engineering_service' else 'engineering_input' end,
      v_entity.target_entity_id
    );
  end loop;

  insert into public.engineering_budgets (
    company_id, project_id, code, name, version, status, reference_date, area_m2,
    bdi_percentage, notes, source_system, source_id, created_by
  ) values (
    p_company_id, v_batch.project_id, upper(btrim(p_budget_code)), btrim(p_budget_name), upper(btrim(p_budget_version)),
    'review', v_batch.source_reference_date, coalesce(v_batch.source_area_m2, 0), 0,
    'Importado de ' || v_batch.file_name || '. Origem interna: ' || coalesce(v_batch.source_budget_code, '—') || ' / ' || coalesce(v_batch.source_version, '—') || '.',
    'budget_import', 'batch:' || p_batch_id::text, auth.uid()
  ) returning id into v_budget_id;

  for v_group in
    select * from public.engineering_budget_import_rows
    where batch_id = p_batch_id and entity_kind = 'group'
    order by sort_order, source_row
  loop
    insert into public.engineering_budget_groups (
      company_id, project_id, budget_id, code, name, sort_order, notes, status, created_by
    ) values (
      p_company_id, v_batch.project_id, v_budget_id,
      coalesce(nullif(btrim(v_group.external_code), ''), 'G' || v_group.sort_order::text),
      coalesce(nullif(btrim(v_group.external_name), ''), 'Grupo importado'),
      v_group.sort_order, 'Origem: ' || v_batch.file_name || ', linha ' || v_group.source_row::text,
      'active', auth.uid()
    ) on conflict (budget_id, code) do nothing;
  end loop;

  for v_service in
    select * from public.engineering_budget_import_rows
    where batch_id = p_batch_id and entity_kind = 'service'
    order by sort_order, source_row
  loop
    select id into v_group_id
    from public.engineering_budget_groups
    where budget_id = v_budget_id and code = v_service.source_group_code
    limit 1;

    v_unit_cost := case
      when coalesce(v_service.quantity, 0) > 0 and v_service.total_cost is not null
        then v_service.total_cost / v_service.quantity
      else coalesce(v_service.unit_cost, 0)
    end;

    insert into public.engineering_budget_items (
      company_id, project_id, budget_id, group_id, service_id, code, description, unit,
      quantity, material_unit_cost, labor_unit_cost, equipment_unit_cost, other_unit_cost,
      sort_order, notes, status, created_by
    ) values (
      p_company_id, v_batch.project_id, v_budget_id, v_group_id, v_service.target_entity_id,
      v_service.external_code, coalesce(v_service.external_name, 'Serviço importado'), coalesce(v_service.external_unit, 'un'),
      greatest(coalesce(v_service.quantity, 0), 0), 0, 0, 0, greatest(coalesce(v_unit_cost, 0), 0),
      v_service.sort_order, 'Origem: ' || v_batch.file_name || ', linha ' || v_service.source_row::text,
      'active', auth.uid()
    ) returning id into v_item_id;

    insert into public.engineering_budget_item_compositions (
      company_id, project_id, budget_id, budget_item_id, source_service_id,
      source_composition_id, is_customized, notes, status, created_by
    ) values (
      p_company_id, v_batch.project_id, v_budget_id, v_item_id, v_service.target_entity_id,
      null, true, 'Snapshot importado diretamente de ' || v_batch.file_name, 'active', auth.uid()
    ) returning id into v_composition_id;

    for v_input in
      select * from public.engineering_budget_import_rows
      where batch_id = p_batch_id and entity_kind = 'input'
        and coalesce(public.integration_normalize_key(source_service_code), '') = coalesce(public.integration_normalize_key(v_service.external_code), '')
      order by source_row
    loop
      if coalesce(v_input.coefficient, 0) <= 0 or v_input.target_entity_id is null then continue; end if;

      insert into public.engineering_budget_item_composition_items (
        company_id, composition_id, input_id, source_composition_item_id,
        coefficient, waste_percentage, unit_price, price_source,
        sort_order, notes, status, created_by
      ) values (
        p_company_id, v_composition_id, v_input.target_entity_id, null,
        v_input.coefficient, 0, greatest(coalesce(v_input.unit_cost, 0), 0), 'imported',
        v_input.sort_order, 'Origem linha ' || v_input.source_row::text, 'active', auth.uid()
      )
      on conflict (composition_id, input_id) do update set
        unit_price = case
          when engineering_budget_item_composition_items.coefficient + excluded.coefficient > 0 then
            ((engineering_budget_item_composition_items.coefficient * engineering_budget_item_composition_items.unit_price)
              + (excluded.coefficient * excluded.unit_price))
            / (engineering_budget_item_composition_items.coefficient + excluded.coefficient)
          else excluded.unit_price
        end,
        coefficient = engineering_budget_item_composition_items.coefficient + excluded.coefficient,
        price_source = 'imported',
        updated_at = now();
    end loop;
  end loop;

  select coalesce(sum(item.total_direct_cost), 0)
  into v_canonical_total
  from public.engineering_budget_items item
  where item.budget_id = v_budget_id and item.status = 'active';

  v_difference := round(v_canonical_total - coalesce(v_batch.source_total, v_canonical_total), 6);

  update public.engineering_budget_import_batches
  set status = 'promoted', promoted_budget_id = v_budget_id, promoted_by = auth.uid(), promoted_at = now(),
      metadata = metadata || jsonb_build_object(
        'promotion', jsonb_build_object(
          'canonical_total', v_canonical_total,
          'source_total', v_batch.source_total,
          'difference', v_difference,
          'budget_id', v_budget_id
        )
      ),
      updated_at = now()
  where id = p_batch_id;

  return v_budget_id;
end;
$$;

revoke all on function public.promote_engineering_budget_import(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.promote_engineering_budget_import(uuid, uuid, text, text, text) to authenticated;

commit;
