-- Elos OS — Engenharia · Serviços integrados às composições
-- Unifica a gestão visual, remove mão de obra direta e aplica mão de obra empreitada.

begin;

-- As permissões antigas de composição passam a alimentar o módulo único de Serviços.
insert into public.role_permissions(role_id, permission_key, allowed)
select role_id, 'services.view', true
from public.role_permissions
where permission_key = 'compositions.view' and allowed = true
on conflict(role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions(role_id, permission_key, allowed)
select role_id, 'services.manage', true
from public.role_permissions
where permission_key = 'compositions.manage' and allowed = true
on conflict(role_id, permission_key) do update set allowed = excluded.allowed;

-- A estrutura física das composições é preservada como parte interna do cadastro de Serviços.
drop policy if exists engineering_service_compositions_select on public.engineering_service_compositions;
create policy engineering_service_compositions_select on public.engineering_service_compositions
for select using (
  public.has_company_permission(company_id, 'services.view')
  or public.has_company_permission(company_id, 'services.manage')
);

drop policy if exists engineering_service_compositions_insert on public.engineering_service_compositions;
create policy engineering_service_compositions_insert on public.engineering_service_compositions
for insert with check (
  public.has_company_permission(company_id, 'services.manage')
);

drop policy if exists engineering_service_compositions_update on public.engineering_service_compositions;
create policy engineering_service_compositions_update on public.engineering_service_compositions
for update using (
  public.has_company_permission(company_id, 'services.manage')
) with check (
  public.has_company_permission(company_id, 'services.manage')
);

drop policy if exists engineering_service_composition_items_select on public.engineering_service_composition_items;
create policy engineering_service_composition_items_select on public.engineering_service_composition_items
for select using (
  public.has_company_permission(company_id, 'services.view')
  or public.has_company_permission(company_id, 'services.manage')
);

drop policy if exists engineering_service_composition_items_insert on public.engineering_service_composition_items;
create policy engineering_service_composition_items_insert on public.engineering_service_composition_items
for insert with check (
  public.has_company_permission(company_id, 'services.manage')
);

drop policy if exists engineering_service_composition_items_update on public.engineering_service_composition_items;
create policy engineering_service_composition_items_update on public.engineering_service_composition_items
for update using (
  public.has_company_permission(company_id, 'services.manage')
) with check (
  public.has_company_permission(company_id, 'services.manage')
);

create or replace function public.engineering_normalize_text(p_value text)
returns text
language sql
immutable
as $$
  select translate(
    lower(coalesce(p_value, '')),
    'áàâãäéèêëíìîïóòôõöúùûüç',
    'aaaaaeeeeiiiiooooouuuuc'
  );
$$;

create or replace function public.engineering_service_excludes_outsourced_labor(
  p_description text,
  p_group_code text
)
returns boolean
language sql
immutable
as $$
  select public.engineering_normalize_text(coalesce(p_group_code, '') || ' ' || coalesce(p_description, ''))
    ~ '(estrutura|estrutural|fundacao|estaca|concreto|armacao|forma|laje|viga|pilar|instalac|eletric|hidraul|sanitar|esgoto|agua fria|agua quente|gas|incendio|spda|climatiz|elevador|automacao|telecom|cftv|esquadr|aluminio|vidro|serralher|porta|janela)';
$$;

create or replace function public.engineering_outsourced_labor_label(
  p_description text,
  p_group_code text
)
returns text
language plpgsql
immutable
as $$
declare
  v_text text := public.engineering_normalize_text(coalesce(p_group_code, '') || ' ' || coalesce(p_description, ''));
begin
  if v_text ~ '(alvenaria|tijolo|bloco ceram|bloco celular|bloco de concreto)' then
    return 'Mão de Obra Empreitada - Assentamento de alvenaria';
  elsif v_text ~ '(fachada)' and v_text ~ '(ceram|porcelanato|pastilha|revest)' then
    return 'Mão de Obra Empreitada - Revestimento de fachada';
  elsif v_text ~ '(porcelanato|ceramica|azulejo|pastilha|revestimento ceram|piso ceram)' then
    return 'Mão de Obra Empreitada - Assentamento de revestimentos cerâmicos';
  elsif v_text ~ '(chapisco|reboco|emboco|revestimento argamassado)' then
    return 'Mão de Obra Empreitada - Revestimento argamassado';
  elsif v_text ~ '(contrapiso|regularizacao de piso)' then
    return 'Mão de Obra Empreitada - Execução de contrapiso';
  elsif v_text ~ '(impermeabil)' then
    return 'Mão de Obra Empreitada - Impermeabilização';
  elsif v_text ~ '(pintura|massa corrida|textura|selador)' then
    return 'Mão de Obra Empreitada - Pintura';
  elsif v_text ~ '(gesso|drywall|forro)' then
    return 'Mão de Obra Empreitada - Gesso e drywall';
  elsif v_text ~ '(vinilic|laminado)' then
    return 'Mão de Obra Empreitada - Instalação de piso vinílico e laminado';
  elsif v_text ~ '(rodape)' then
    return 'Mão de Obra Empreitada - Instalação de rodapé';
  elsif v_text ~ '(cobertura|telha|telhado)' then
    return 'Mão de Obra Empreitada - Execução de cobertura';
  elsif v_text ~ '(paviment|calcada|meio fio|meio-fio|paver)' then
    return 'Mão de Obra Empreitada - Pavimentação e urbanização';
  elsif v_text ~ '(paisag|jardim|plantio)' then
    return 'Mão de Obra Empreitada - Paisagismo';
  elsif v_text ~ '(limpeza)' then
    return 'Mão de Obra Empreitada - Limpeza de obra';
  elsif v_text ~ '(granito|marmore|pedra natural|soleira|peitoril)' then
    return 'Mão de Obra Empreitada - Instalação de pedras e bancadas';
  elsif v_text ~ '(piso cimentado|cimento queimado)' then
    return 'Mão de Obra Empreitada - Execução de pisos cimentícios';
  elsif v_text ~ '(isolamento|acustic|termic)' then
    return 'Mão de Obra Empreitada - Instalação de isolamento';
  end if;

  return 'Mão de Obra Empreitada - ' || trim(coalesce(p_description, 'Execução do serviço'));
end;
$$;

create or replace function public.engineering_sync_service_outsourced_labor(p_service_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service public.engineering_services%rowtype;
  v_composition_id uuid;
  v_input_id uuid;
  v_label text;
  v_key text;
  v_code text;
  v_removed_direct integer := 0;
  v_removed_outsourced integer := 0;
begin
  select * into v_service
  from public.engineering_services
  where id = p_service_id;

  if v_service.id is null then
    raise exception 'Serviço não encontrado.';
  end if;

  if auth.uid() is not null and not public.has_company_permission(v_service.company_id, 'services.manage') then
    raise exception 'Sem permissão para atualizar os insumos do serviço.';
  end if;

  select id into v_composition_id
  from public.engineering_service_compositions
  where company_id = v_service.company_id
    and service_id = v_service.id;

  -- Toda mão de obra direta é retirada da composição ativa, inclusive nos grupos excluídos.
  if v_composition_id is not null then
    update public.engineering_service_composition_items item
    set status = 'inactive',
        notes = concat_ws(' · ', nullif(item.notes, ''), 'Mão de obra direta retirada na unificação Serviços V0.52.0'),
        updated_at = now()
    from public.engineering_inputs input
    where item.composition_id = v_composition_id
      and item.company_id = v_service.company_id
      and item.input_id = input.id
      and item.status = 'active'
      and input.category = 'labor'
      and coalesce(input.family_code, '') <> 'MO-EMP'
      and public.engineering_normalize_text(input.description) not like '%mao de obra empreitada%';
    get diagnostics v_removed_direct = row_count;
  end if;

  if v_service.status <> 'active'
     or public.engineering_service_excludes_outsourced_labor(v_service.description, v_service.group_code) then
    if v_composition_id is not null then
      update public.engineering_service_composition_items item
      set status = 'inactive',
          notes = concat_ws(' · ', nullif(item.notes, ''), 'Empreitada automática não aplicável a estrutura, instalações ou esquadrias'),
          updated_at = now()
      from public.engineering_inputs input
      where item.composition_id = v_composition_id
        and item.company_id = v_service.company_id
        and item.input_id = input.id
        and item.status = 'active'
        and (
          input.family_code = 'MO-EMP'
          or public.engineering_normalize_text(input.description) like '%mao de obra empreitada%'
        );
      get diagnostics v_removed_outsourced = row_count;
    end if;

    return jsonb_build_object(
      'service_id', v_service.id,
      'policy', 'excluded',
      'removed_direct_labor', v_removed_direct,
      'removed_outsourced_labor', v_removed_outsourced
    );
  end if;

  if v_composition_id is null then
    insert into public.engineering_service_compositions(
      company_id, service_id, notes, status, created_by
    ) values(
      v_service.company_id,
      v_service.id,
      'Insumos gerenciados diretamente no cadastro do serviço.',
      'active',
      coalesce(v_service.created_by, auth.uid())
    )
    returning id into v_composition_id;
  else
    update public.engineering_service_compositions
    set status = 'active', updated_at = now()
    where id = v_composition_id;
  end if;

  v_label := public.engineering_outsourced_labor_label(v_service.description, v_service.group_code);
  v_key := v_label || '|' || lower(v_service.unit);
  v_code := 'MOE-' || upper(substr(md5(v_key), 1, 10));

  insert into public.engineering_inputs(
    company_id,
    code,
    description,
    unit,
    category,
    family_code,
    family_label,
    technical_specification,
    source_system,
    source_code,
    source_id,
    notes,
    status,
    created_by
  ) values(
    v_service.company_id,
    v_code,
    v_label,
    v_service.unit,
    'labor',
    'MO-EMP',
    'Mão de Obra Empreitada',
    'Execução completa por empreitada, incluindo mão de obra, ferramentas manuais e encargos da equipe contratada, conforme critério de medição do serviço.',
    'elos_os',
    'MOE-AUTO',
    'outsourced-labor:' || md5(v_key),
    'Criado automaticamente pela política de mão de obra empreitada dos Serviços.',
    'active',
    coalesce(v_service.created_by, auth.uid())
  )
  on conflict(company_id, code) do update set
    description = excluded.description,
    unit = excluded.unit,
    category = 'labor',
    family_code = 'MO-EMP',
    family_label = 'Mão de Obra Empreitada',
    technical_specification = excluded.technical_specification,
    status = 'active',
    updated_at = now()
  returning id into v_input_id;

  -- Mantém apenas a empreitada correspondente ao serviço aberto.
  update public.engineering_service_composition_items item
  set status = 'inactive',
      notes = concat_ws(' · ', nullif(item.notes, ''), 'Substituído pela empreitada correspondente ao serviço'),
      updated_at = now()
  from public.engineering_inputs input
  where item.composition_id = v_composition_id
    and item.company_id = v_service.company_id
    and item.input_id = input.id
    and item.status = 'active'
    and item.input_id <> v_input_id
    and (
      input.family_code = 'MO-EMP'
      or public.engineering_normalize_text(input.description) like '%mao de obra empreitada%'
    );

  insert into public.engineering_service_composition_items(
    company_id,
    composition_id,
    input_id,
    coefficient,
    waste_percentage,
    sort_order,
    notes,
    status,
    created_by
  ) values(
    v_service.company_id,
    v_composition_id,
    v_input_id,
    1,
    0,
    9000,
    'Mão de obra empreitada correspondente a 1 ' || v_service.unit || ' do serviço.',
    'active',
    coalesce(v_service.created_by, auth.uid())
  )
  on conflict(composition_id, input_id) do update set
    coefficient = 1,
    waste_percentage = 0,
    sort_order = 9000,
    notes = excluded.notes,
    status = 'active',
    updated_at = now();

  return jsonb_build_object(
    'service_id', v_service.id,
    'policy', 'outsourced',
    'outsourced_labor_input_id', v_input_id,
    'outsourced_labor_label', v_label,
    'removed_direct_labor', v_removed_direct
  );
end;
$$;

create or replace function public.engineering_sync_service_outsourced_labor_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.engineering_sync_service_outsourced_labor(new.id);
  return new;
end;
$$;

drop trigger if exists engineering_services_outsourced_labor_sync on public.engineering_services;
create trigger engineering_services_outsourced_labor_sync
after insert or update of description, group_code, unit, status
on public.engineering_services
for each row
execute function public.engineering_sync_service_outsourced_labor_trigger();

-- Primeiro retira do catálogo ativo as funções de mão de obra direta.
update public.engineering_service_composition_items item
set status = 'inactive',
    notes = concat_ws(' · ', nullif(item.notes, ''), 'Mão de obra direta retirada na unificação Serviços V0.52.0'),
    updated_at = now()
from public.engineering_inputs input
where item.input_id = input.id
  and item.company_id = input.company_id
  and item.status = 'active'
  and input.category = 'labor'
  and coalesce(input.family_code, '') <> 'MO-EMP'
  and public.engineering_normalize_text(input.description) not like '%mao de obra empreitada%';

update public.engineering_inputs
set status = 'inactive',
    notes = concat_ws(' · ', nullif(notes, ''), 'Mão de obra direta substituída por empreitada nos serviços'),
    updated_at = now()
where category = 'labor'
  and status = 'active'
  and coalesce(family_code, '') <> 'MO-EMP'
  and public.engineering_normalize_text(description) not like '%mao de obra empreitada%';

-- Aplica a política em todos os serviços existentes.
do $$
declare
  v_service record;
begin
  for v_service in select id from public.engineering_services loop
    perform public.engineering_sync_service_outsourced_labor(v_service.id);
  end loop;
end $$;

grant execute on function public.engineering_normalize_text(text) to authenticated;
grant execute on function public.engineering_service_excludes_outsourced_labor(text, text) to authenticated;
grant execute on function public.engineering_outsourced_labor_label(text, text) to authenticated;
grant execute on function public.engineering_sync_service_outsourced_labor(uuid) to authenticated;

commit;
