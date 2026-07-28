-- Elos OS — Solicitações de Materiais · Centros de custo por serviço
-- Troca a apropriação por grupos do orçamento pela apropriação direta aos serviços.

begin;

alter table public.execution_material_request_items
  add column if not exists cost_center_service_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'execution_material_request_items_cost_center_service_fk'
      and conrelid = 'public.execution_material_request_items'::regclass
  ) then
    alter table public.execution_material_request_items
      add constraint execution_material_request_items_cost_center_service_fk
      foreign key (cost_center_service_id)
      references public.engineering_services(id)
      on delete restrict;
  end if;
end $$;

create index if not exists execution_material_request_items_service_idx
  on public.execution_material_request_items(project_id, cost_center_service_id);

update public.execution_material_request_items item
set cost_center_service_id = service.id
from public.engineering_services service
where item.cost_center_service_id is null
  and service.company_id = item.company_id
  and service.code = item.cost_center_code
  and service.status = 'active';

create or replace function public.save_execution_material_request(
  p_company_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_budget_id uuid,
  p_needed_date date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record public.execution_material_requests%rowtype;
  item jsonb;
  item_input public.engineering_inputs%rowtype;
  item_service public.engineering_services%rowtype;
  item_quantity numeric;
  item_center_service_id uuid;
  item_center_code text;
  item_center_name text;
  next_sequence integer;
  resolved_request_id uuid;
  resolved_requester text;
  item_index integer := 0;
  budget_has_services boolean;
begin
  if not public.has_company_permission(p_company_id, 'execution.material_requests.manage') then
    raise exception 'Sem permissão para criar ou editar solicitações de materiais.';
  end if;

  if p_needed_date is null then
    raise exception 'Informe a data de necessidade dos materiais.';
  end if;

  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and project.company_id = p_company_id
      and project.status <> 'archived'
  ) then
    raise exception 'O empreendimento selecionado não pertence à empresa.';
  end if;

  if not exists (
    select 1 from public.engineering_budgets budget
    where budget.id = p_budget_id
      and budget.company_id = p_company_id
      and budget.project_id = p_project_id
      and budget.status = 'approved'
  ) then
    raise exception 'Selecione um orçamento aprovado para apropriar os materiais.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Insira pelo menos um material na solicitação.';
  end if;

  select exists (
    select 1
    from public.engineering_takeoffs takeoff
    where takeoff.company_id = p_company_id
      and takeoff.project_id = p_project_id
      and takeoff.budget_id = p_budget_id
      and takeoff.record_status = 'active'
  ) into budget_has_services;

  select coalesce(nullif(trim(profile.full_name), ''), nullif(auth.jwt() ->> 'email', ''), 'Usuário')
    into resolved_requester
  from public.profiles profile
  where profile.id = auth.uid();
  resolved_requester := coalesce(resolved_requester, nullif(auth.jwt() ->> 'email', ''), 'Usuário');

  if p_request_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text));
    select coalesce(max(sequence_no), 0) + 1 into next_sequence
    from public.execution_material_requests
    where project_id = p_project_id;

    insert into public.execution_material_requests (
      company_id, project_id, budget_id, sequence_no, request_number,
      status, needed_date, requester_user_id, requester_name,
      notes, created_by, updated_by
    ) values (
      p_company_id, p_project_id, p_budget_id, next_sequence,
      'SM-' || lpad(next_sequence::text, 4, '0'),
      'requested', p_needed_date, auth.uid(), resolved_requester,
      nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), auth.uid()
    ) returning id into resolved_request_id;
  else
    select * into request_record
    from public.execution_material_requests request
    where request.id = p_request_id
      and request.company_id = p_company_id
      and request.project_id = p_project_id
    for update;

    if request_record.id is null then
      raise exception 'Solicitação de materiais não encontrada.';
    end if;

    if request_record.status <> 'requested' then
      raise exception 'Somente solicitações ainda não aprovadas podem ser editadas.';
    end if;

    resolved_request_id := request_record.id;
    update public.execution_material_requests
    set budget_id = p_budget_id,
        needed_date = p_needed_date,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_by = auth.uid(),
        updated_at = now()
    where id = resolved_request_id;

    delete from public.execution_material_request_items where request_id = resolved_request_id;
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_index := item_index + 1;
    item_quantity := nullif(item ->> 'quantity', '')::numeric;
    item_center_service_id := nullif(item ->> 'cost_center_service_id', '')::uuid;
    item_center_code := trim(coalesce(item ->> 'cost_center_code', ''));

    if item_quantity is null or item_quantity <= 0 then
      raise exception 'Informe uma quantidade maior que zero para todos os materiais.';
    end if;

    select * into item_input
    from public.engineering_inputs input
    where input.id = nullif(item ->> 'input_id', '')::uuid
      and input.company_id = p_company_id
      and input.status = 'active';

    if item_input.id is null then
      raise exception 'Um dos materiais não está ativo no catálogo de insumos.';
    end if;

    item_service := null;
    select service.* into item_service
    from public.engineering_services service
    where service.company_id = p_company_id
      and service.status = 'active'
      and (
        service.id = item_center_service_id
        or (item_center_service_id is null and service.code = item_center_code)
      )
      and (
        not budget_has_services
        or exists (
          select 1
          from public.engineering_takeoffs takeoff
          where takeoff.company_id = p_company_id
            and takeoff.project_id = p_project_id
            and takeoff.budget_id = p_budget_id
            and takeoff.service_id = service.id
            and takeoff.record_status = 'active'
        )
      )
    limit 1;

    if item_service.id is null then
      raise exception 'Selecione um serviço válido do orçamento como centro de custo para todos os materiais.';
    end if;

    item_center_service_id := item_service.id;
    item_center_code := item_service.code;
    item_center_name := item_service.description;

    insert into public.execution_material_request_items (
      company_id, project_id, request_id, input_id,
      input_code, input_name, unit_snapshot, category_snapshot,
      cost_center_service_id, cost_center_code, cost_center_name,
      requested_quantity, ordered_quantity, notes, sort_order
    ) values (
      p_company_id, p_project_id, resolved_request_id, item_input.id,
      item_input.code, item_input.description, item_input.unit, item_input.category,
      item_center_service_id, item_center_code, item_center_name,
      item_quantity, 0,
      nullif(trim(coalesce(item ->> 'notes', '')), ''), item_index
    );
  end loop;

  perform public.recalculate_execution_material_request_status(resolved_request_id);
  return resolved_request_id;
end;
$$;

grant execute on function public.save_execution_material_request(uuid, uuid, uuid, uuid, date, text, jsonb) to authenticated;

commit;
