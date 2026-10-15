-- Elos OS — ponte operacional do mapa genérico
-- O trigger legado precisa continuar aprendendo o de-para mesmo quando o usuário
-- operacional não possui projects.manage. A administração manual do mapa continua
-- protegida pela RPC upsert_integration_mapping.

begin;

create or replace function public.remember_engineering_cost_center_mapping(
  p_company_id uuid,
  p_project_id uuid,
  p_source_system text,
  p_source_code text,
  p_source_name text,
  p_service_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text := coalesce(public.integration_normalize_key(p_source_system), 'koper');
  v_source_code text := public.integration_normalize_key(p_source_code);
begin
  if p_company_id is null
     or p_project_id is null
     or p_service_id is null
     or v_source_code is null then
    return;
  end if;

  if not exists (
    select 1
    from public.engineering_services service
    where service.id = p_service_id
      and service.company_id = p_company_id
  ) then
    raise exception 'Serviço do de-para não pertence à empresa informada.';
  end if;

  if not exists (
    select 1
    from public.projects project
    where project.id = p_project_id
      and project.company_id = p_company_id
  ) then
    raise exception 'Empreendimento do de-para não pertence à empresa informada.';
  end if;

  -- Mantém a tabela legada porque outros trechos do sistema ainda podem consultá-la.
  insert into public.engineering_cost_center_mappings (
    company_id,
    project_id,
    source_system,
    source_code,
    source_name,
    service_id
  ) values (
    p_company_id,
    p_project_id,
    v_source_system,
    v_source_code,
    nullif(btrim(p_source_name), ''),
    p_service_id
  )
  on conflict (company_id, project_id, source_system, source_code)
  do update set
    source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
    service_id = excluded.service_id,
    updated_at = now();

  -- Aprende o mesmo vínculo no mapa genérico sem exigir permissão administrativa
  -- do usuário que apenas está lançando pedido/estoque/solicitação.
  insert into public.integration_mappings (
    company_id,
    project_id,
    source_system,
    source_entity_type,
    scope,
    scope_id,
    key_kind,
    external_key,
    external_code,
    external_name,
    target_entity_type,
    target_entity_id,
    status,
    confidence,
    match_method,
    confirmed_by,
    confirmed_at,
    metadata,
    created_by,
    updated_at
  ) values (
    p_company_id,
    p_project_id,
    v_source_system,
    'cost_center',
    'project',
    p_project_id,
    'code',
    v_source_code,
    p_source_code,
    nullif(btrim(p_source_name), ''),
    'engineering_service',
    p_service_id,
    'confirmed',
    100,
    'rule',
    auth.uid(),
    now(),
    jsonb_build_object('bridge', 'engineering_cost_center_mappings'),
    auth.uid(),
    now()
  )
  on conflict (
    company_id,
    source_system,
    source_entity_type,
    scope,
    scope_id,
    key_kind,
    external_key
  )
  do update set
    external_code = coalesce(excluded.external_code, integration_mappings.external_code),
    external_name = coalesce(excluded.external_name, integration_mappings.external_name),
    target_entity_type = excluded.target_entity_type,
    target_entity_id = excluded.target_entity_id,
    status = 'confirmed',
    confidence = 100,
    match_method = 'rule',
    confirmed_by = coalesce(excluded.confirmed_by, integration_mappings.confirmed_by),
    confirmed_at = coalesce(integration_mappings.confirmed_at, now()),
    metadata = integration_mappings.metadata || excluded.metadata,
    updated_at = now();
end;
$$;

revoke all on function public.remember_engineering_cost_center_mapping(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;

commit;
