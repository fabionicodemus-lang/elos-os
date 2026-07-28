-- Elos OS — Execução · Qualidade
-- Correções de segurança para versionamento e criação manual de vistorias.

begin;

create or replace function public.save_quality_template(
  p_company_id uuid,
  p_template_id uuid,
  p_service_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_criticality text,
  p_service_weight numeric,
  p_inspection_unit text,
  p_periodicity text,
  p_sampling_rule text,
  p_evidence_rule text,
  p_has_blocking_gate boolean,
  p_change_notes text,
  p_criteria jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_template_id uuid;
  resolved_version_id uuid;
  next_version_no integer;
  item jsonb;
  item_index integer := 0;
begin
  if not public.has_company_permission(p_company_id, 'execution.quality.templates') then
    raise exception 'Sem permissão para cadastrar modelos.';
  end if;

  if nullif(trim(p_code), '') is null or nullif(trim(p_name), '') is null then
    raise exception 'Informe código e nome do modelo.';
  end if;

  if jsonb_typeof(p_criteria) <> 'array' or jsonb_array_length(p_criteria) = 0 then
    raise exception 'Cadastre pelo menos um critério.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_criteria) criterion
    where nullif(trim(coalesce(criterion ->> 'description', '')), '') is null
  ) then
    raise exception 'Todos os critérios precisam possuir uma descrição.';
  end if;

  if p_template_id is null then
    insert into public.quality_checklist_templates (
      company_id,
      service_id,
      code,
      name,
      description,
      criticality,
      service_weight,
      inspection_unit,
      periodicity,
      sampling_rule,
      evidence_rule,
      has_blocking_gate,
      created_by,
      updated_by
    ) values (
      p_company_id,
      p_service_id,
      upper(trim(p_code)),
      trim(p_name),
      nullif(trim(coalesce(p_description, '')), ''),
      p_criticality,
      coalesce(p_service_weight, 1),
      coalesce(nullif(trim(p_inspection_unit), ''), 'local'),
      coalesce(nullif(trim(p_periodicity), ''), 'per_activity'),
      nullif(trim(coalesce(p_sampling_rule, '')), ''),
      nullif(trim(coalesce(p_evidence_rule, '')), ''),
      coalesce(p_has_blocking_gate, false),
      auth.uid(),
      auth.uid()
    )
    returning id into resolved_template_id;
  else
    select template.id
      into resolved_template_id
    from public.quality_checklist_templates template
    where template.id = p_template_id
      and template.company_id = p_company_id
    for update;

    if resolved_template_id is null then
      raise exception 'Modelo não encontrado.';
    end if;

    update public.quality_checklist_templates template
    set service_id = p_service_id,
        code = upper(trim(p_code)),
        name = trim(p_name),
        description = nullif(trim(coalesce(p_description, '')), ''),
        criticality = p_criticality,
        service_weight = coalesce(p_service_weight, 1),
        inspection_unit = coalesce(nullif(trim(p_inspection_unit), ''), 'local'),
        periodicity = coalesce(nullif(trim(p_periodicity), ''), 'per_activity'),
        sampling_rule = nullif(trim(coalesce(p_sampling_rule, '')), ''),
        evidence_rule = nullif(trim(coalesce(p_evidence_rule, '')), ''),
        has_blocking_gate = coalesce(p_has_blocking_gate, false),
        updated_by = auth.uid(),
        updated_at = now()
    where template.id = resolved_template_id;
  end if;

  select coalesce(max(version.version_no), 0) + 1
    into next_version_no
  from public.quality_checklist_versions version
  where version.template_id = resolved_template_id;

  update public.quality_checklist_versions version
  set status = 'retired'
  where version.template_id = resolved_template_id
    and version.status = 'published';

  insert into public.quality_checklist_versions (
    company_id,
    template_id,
    version_no,
    status,
    change_notes,
    published_by,
    published_at,
    created_by
  ) values (
    p_company_id,
    resolved_template_id,
    next_version_no,
    'published',
    nullif(trim(coalesce(p_change_notes, '')), ''),
    auth.uid(),
    now(),
    auth.uid()
  )
  returning id into resolved_version_id;

  for item in
    select value
    from jsonb_array_elements(p_criteria)
  loop
    item_index := item_index + 1;

    insert into public.quality_checklist_criteria (
      company_id,
      version_id,
      group_name,
      code,
      description,
      verification_method,
      acceptance_criterion,
      verification_moment,
      weight,
      failure_severity,
      is_blocking,
      requires_photo,
      requires_measurement,
      measurement_unit,
      allow_reservation,
      is_required,
      guidance,
      sort_order
    ) values (
      p_company_id,
      resolved_version_id,
      coalesce(nullif(trim(item ->> 'group_name'), ''), 'Verificação'),
      coalesce(
        nullif(upper(trim(item ->> 'code')), ''),
        'C' || lpad(item_index::text, 3, '0')
      ),
      trim(item ->> 'description'),
      nullif(trim(coalesce(item ->> 'verification_method', '')), ''),
      nullif(trim(coalesce(item ->> 'acceptance_criterion', '')), ''),
      nullif(trim(coalesce(item ->> 'verification_moment', '')), ''),
      greatest(1, least(5, coalesce(nullif(item ->> 'weight', '')::integer, 1))),
      coalesce(nullif(item ->> 'failure_severity', ''), 'light'),
      coalesce((item ->> 'is_blocking')::boolean, false),
      coalesce((item ->> 'requires_photo')::boolean, false),
      coalesce((item ->> 'requires_measurement')::boolean, false),
      nullif(trim(coalesce(item ->> 'measurement_unit', '')), ''),
      case
        when coalesce(nullif(item ->> 'failure_severity', ''), 'light') = 'critical' then false
        else coalesce((item ->> 'allow_reservation')::boolean, true)
      end,
      coalesce((item ->> 'is_required')::boolean, true),
      nullif(trim(coalesce(item ->> 'guidance', '')), ''),
      item_index
    );
  end loop;

  update public.quality_checklist_templates template
  set current_version_id = resolved_version_id,
      updated_at = now()
  where template.id = resolved_template_id;

  insert into public.quality_audit_logs (
    company_id,
    entity_type,
    entity_id,
    action,
    new_value,
    checklist_version_id,
    changed_by
  ) values (
    p_company_id,
    'template',
    resolved_template_id,
    'published_version',
    jsonb_build_object('version', next_version_no),
    resolved_version_id,
    auth.uid()
  );

  return resolved_template_id;
end;
$$;

create or replace function public.create_manual_quality_inspection(
  p_company_id uuid,
  p_project_id uuid,
  p_template_id uuid,
  p_schedule_activity_id uuid,
  p_location_id uuid,
  p_stage_name text,
  p_supplier_id uuid,
  p_executor_team text,
  p_due_date date,
  p_tower text,
  p_unit_name text,
  p_environment_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  template_record public.quality_checklist_templates%rowtype;
  activity_record public.engineering_schedule_activities%rowtype;
  resolved_service_id uuid;
  responsible_user_id uuid;
  inspection_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'execution.quality.fill') then
    raise exception 'Sem permissão para criar vistorias.';
  end if;

  if nullif(trim(coalesce(p_stage_name, '')), '') is null or p_due_date is null then
    raise exception 'Informe a etapa da inspeção e a data prevista.';
  end if;

  select template.*
    into template_record
  from public.quality_checklist_templates template
  where template.id = p_template_id
    and template.company_id = p_company_id
    and template.status = 'active';

  if template_record.id is null or template_record.current_version_id is null then
    raise exception 'Selecione um modelo publicado.';
  end if;

  if p_schedule_activity_id is not null then
    select activity.*
      into activity_record
    from public.engineering_schedule_activities activity
    where activity.id = p_schedule_activity_id
      and activity.company_id = p_company_id
      and activity.project_id = p_project_id
      and activity.record_status = 'active';

    if activity_record.id is null then
      raise exception 'A atividade do cronograma não pertence à obra.';
    end if;
  end if;

  resolved_service_id := coalesce(activity_record.service_id, template_record.service_id);
  if resolved_service_id is null then
    raise exception 'O modelo ou a atividade precisa estar vinculado a um serviço.';
  end if;

  select settings.responsible_engineer_user_id
    into responsible_user_id
  from public.quality_settings settings
  where settings.project_id = p_project_id
    and settings.company_id = p_company_id;

  responsible_user_id := coalesce(responsible_user_id, auth.uid());
  if responsible_user_id is null then
    raise exception 'Configure o engenheiro responsável pela obra.';
  end if;

  insert into public.quality_inspections (
    company_id,
    project_id,
    template_id,
    checklist_version_id,
    schedule_activity_id,
    service_id,
    location_id,
    supplier_id,
    stage_name,
    tower,
    unit_name,
    environment_name,
    executor_team,
    responsible_engineer_user_id,
    inspection_number,
    origin,
    due_date,
    created_by,
    updated_by
  ) values (
    p_company_id,
    p_project_id,
    template_record.id,
    template_record.current_version_id,
    activity_record.id,
    resolved_service_id,
    coalesce(p_location_id, activity_record.location_id),
    p_supplier_id,
    trim(p_stage_name),
    nullif(trim(coalesce(p_tower, '')), ''),
    nullif(trim(coalesce(p_unit_name, '')), ''),
    nullif(trim(coalesce(p_environment_name, '')), ''),
    nullif(trim(coalesce(p_executor_team, '')), ''),
    responsible_user_id,
    public.quality_next_number(p_project_id, 'VIS', 'inspection'),
    'Criação manual',
    p_due_date,
    auth.uid(),
    auth.uid()
  )
  returning id into inspection_id;

  perform public.quality_populate_inspection_items(inspection_id);
  return inspection_id;
end;
$$;

grant execute on function public.save_quality_template(
  uuid, uuid, uuid, text, text, text, text, numeric, text, text, text, text,
  boolean, text, jsonb
) to authenticated;

grant execute on function public.create_manual_quality_inspection(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, date, text, text, text
) to authenticated;

commit;
