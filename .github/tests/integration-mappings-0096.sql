do $$
begin
  if to_regclass('public.integration_mappings') is null then
    raise exception '0096: tabela integration_mappings não existe.';
  end if;

  if to_regclass('public.integration_mapping_audit') is null then
    raise exception '0096: tabela integration_mapping_audit não existe.';
  end if;

  if to_regprocedure('public.resolve_integration_mapping(uuid,uuid,text,text,text,text,text,text,text)') is null then
    raise exception '0096: resolvedor genérico não existe.';
  end if;

  if to_regprocedure('public.upsert_integration_mapping(uuid,text,text,text,uuid,uuid,text,text,text,text,text,numeric,text,jsonb)') is null then
    raise exception '0096: upsert genérico não existe.';
  end if;

  if to_regprocedure('public.set_integration_mapping_status(uuid,text,text)') is null then
    raise exception '0096: alteração de status não existe.';
  end if;

  if exists (
    select 1
    from public.integration_mappings mapping
    left join public.projects project on project.id = mapping.project_id
    where (mapping.scope = 'company' and (mapping.project_id is not null or mapping.scope_id <> mapping.company_id))
       or (mapping.scope = 'project' and (
         mapping.project_id is null
         or mapping.scope_id <> mapping.project_id
         or project.company_id is distinct from mapping.company_id
       ))
  ) then
    raise exception '0096: existe mapeamento com escopo inconsistente.';
  end if;

  if exists (
    select 1
    from public.engineering_cost_center_mappings legacy
    where not exists (
      select 1
      from public.integration_mappings mapping
      where mapping.company_id = legacy.company_id
        and mapping.project_id = legacy.project_id
        and mapping.source_system = public.integration_normalize_key(legacy.source_system)
        and mapping.source_entity_type = 'cost_center'
        and mapping.scope = 'project'
        and mapping.key_kind = 'code'
        and mapping.external_key = public.integration_normalize_key(legacy.source_code)
        and mapping.target_entity_type = 'engineering_service'
        and mapping.target_entity_id = legacy.service_id
        and mapping.status = 'confirmed'
    )
  ) then
    raise exception '0096: existe de-para legado sem equivalente no mapa genérico.';
  end if;

  if exists (
    select 1
    from public.engineering_cost_center_mappings legacy
    where public.resolve_engineering_cost_center_service(
      legacy.company_id,
      legacy.project_id,
      legacy.source_system,
      legacy.source_code
    ) is distinct from legacy.service_id
  ) then
    raise exception '0096: resolvedor de centro de custo perdeu compatibilidade.';
  end if;
end $$;

select
  count(*) as integration_mappings_total,
  count(*) filter (where status = 'confirmed') as confirmed_total,
  count(*) filter (where source_entity_type = 'cost_center') as cost_center_total,
  count(*) filter (where source_entity_type = 'service') as service_alias_total
from public.integration_mappings;

select
  source_system,
  source_entity_type,
  key_kind,
  scope,
  count(*) as total
from public.integration_mappings
group by source_system, source_entity_type, key_kind, scope
order by source_system, source_entity_type, key_kind, scope;
