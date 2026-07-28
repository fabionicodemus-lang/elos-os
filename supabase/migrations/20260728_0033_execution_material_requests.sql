-- Elos OS — Execução · Solicitações de Materiais
-- Solicitações vinculadas ao catálogo de insumos e aos centros de custo do orçamento aprovado.

begin;

create table if not exists public.execution_material_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete restrict,
  sequence_no integer not null,
  request_number text not null,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'partially_ordered', 'attended', 'cancelled')),
  needed_date date not null,
  requester_user_id uuid not null references auth.users(id),
  requester_name text not null,
  notes text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence_no),
  unique (project_id, request_number),
  constraint execution_material_request_sequence_check check (sequence_no > 0),
  constraint execution_material_request_cancel_check check (
    status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason, '')), '') is not null
  )
);

create table if not exists public.execution_material_request_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  request_id uuid not null references public.execution_material_requests(id) on delete cascade,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  input_code text not null,
  input_name text not null,
  unit_snapshot text not null,
  category_snapshot text not null,
  cost_center_code text not null,
  cost_center_name text not null,
  requested_quantity numeric(18,6) not null,
  ordered_quantity numeric(18,6) not null default 0,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, input_id, cost_center_code),
  constraint execution_material_request_item_quantity_check check (
    requested_quantity > 0 and ordered_quantity >= 0 and ordered_quantity <= requested_quantity
  )
);

create index if not exists execution_material_requests_project_status_idx
  on public.execution_material_requests(project_id, status, needed_date, created_at desc);
create index if not exists execution_material_request_items_request_idx
  on public.execution_material_request_items(request_id, sort_order, input_code);
create index if not exists execution_material_request_items_input_idx
  on public.execution_material_request_items(project_id, input_id);

insert into public.permissions (key, module, action, description) values
  ('execution.material_requests.view', 'execution_material_requests', 'view', 'Visualizar solicitações de materiais da obra'),
  ('execution.material_requests.manage', 'execution_material_requests', 'manage', 'Criar e editar solicitações de materiais'),
  ('execution.material_requests.approve', 'execution_material_requests', 'approve', 'Aprovar e cancelar solicitações de materiais')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, permission.permission_key, true
from public.roles role
cross join (values
  ('execution.material_requests.view'),
  ('execution.material_requests.manage'),
  ('execution.material_requests.approve')
) as permission(permission_key)
where role.key in ('owner', 'admin', 'director', 'engineering')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, permission.permission_key, true
from public.roles role
cross join (values
  ('execution.material_requests.view'),
  ('execution.material_requests.manage')
) as permission(permission_key)
where role.key in ('field')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

insert into public.role_permissions (role_id, permission_key, allowed)
select role.id, 'execution.material_requests.view', true
from public.roles role
where role.key in ('procurement', 'finance', 'viewer')
on conflict (role_id, permission_key) do update set allowed = excluded.allowed;

alter table public.execution_material_requests enable row level security;
alter table public.execution_material_request_items enable row level security;

drop policy if exists execution_material_requests_select on public.execution_material_requests;
create policy execution_material_requests_select on public.execution_material_requests
for select to authenticated using (
  public.has_company_permission(company_id, 'execution.material_requests.view')
  or public.has_company_permission(company_id, 'execution.material_requests.manage')
  or public.has_company_permission(company_id, 'execution.material_requests.approve')
);

drop policy if exists execution_material_requests_write on public.execution_material_requests;
create policy execution_material_requests_write on public.execution_material_requests
for all to authenticated using (
  public.has_company_permission(company_id, 'execution.material_requests.manage')
  or public.has_company_permission(company_id, 'execution.material_requests.approve')
) with check (
  public.has_company_permission(company_id, 'execution.material_requests.manage')
  or public.has_company_permission(company_id, 'execution.material_requests.approve')
);

drop policy if exists execution_material_request_items_select on public.execution_material_request_items;
create policy execution_material_request_items_select on public.execution_material_request_items
for select to authenticated using (
  public.has_company_permission(company_id, 'execution.material_requests.view')
  or public.has_company_permission(company_id, 'execution.material_requests.manage')
  or public.has_company_permission(company_id, 'execution.material_requests.approve')
);

drop policy if exists execution_material_request_items_write on public.execution_material_request_items;
create policy execution_material_request_items_write on public.execution_material_request_items
for all to authenticated using (
  public.has_company_permission(company_id, 'execution.material_requests.manage')
  or public.has_company_permission(company_id, 'execution.material_requests.approve')
) with check (
  public.has_company_permission(company_id, 'execution.material_requests.manage')
  or public.has_company_permission(company_id, 'execution.material_requests.approve')
);

create or replace function public.recalculate_execution_material_request_status(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record public.execution_material_requests%rowtype;
  total_requested numeric;
  total_ordered numeric;
  next_status text;
begin
  select * into request_record
  from public.execution_material_requests
  where id = p_request_id
  for update;

  if request_record.id is null then
    raise exception 'Solicitação de materiais não encontrada.';
  end if;

  if request_record.status = 'cancelled' then
    return request_record.status;
  end if;

  select coalesce(sum(requested_quantity), 0), coalesce(sum(ordered_quantity), 0)
    into total_requested, total_ordered
  from public.execution_material_request_items
  where request_id = p_request_id;

  next_status := case
    when total_requested > 0 and total_ordered >= total_requested then 'attended'
    when total_ordered > 0 then 'partially_ordered'
    when request_record.approved_at is not null then 'approved'
    else 'requested'
  end;

  update public.execution_material_requests
  set status = next_status,
      updated_at = now()
  where id = p_request_id;

  return next_status;
end;
$$;

create or replace function public.execution_material_request_item_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_execution_material_request_status(coalesce(new.request_id, old.request_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists execution_material_request_item_status on public.execution_material_request_items;
create trigger execution_material_request_item_status
after insert or update of requested_quantity, ordered_quantity or delete
on public.execution_material_request_items
for each row execute function public.execution_material_request_item_status_trigger();

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
  item_quantity numeric;
  item_center_code text;
  item_center_name text;
  next_sequence integer;
  resolved_request_id uuid;
  resolved_requester text;
  item_index integer := 0;
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

    select budget_group.name into item_center_name
    from public.engineering_budget_groups budget_group
    where budget_group.company_id = p_company_id
      and budget_group.project_id = p_project_id
      and budget_group.budget_id = p_budget_id
      and budget_group.code = item_center_code
      and budget_group.status = 'active'
    limit 1;

    if item_center_name is null then
      raise exception 'Selecione um centro de custo válido para todos os materiais.';
    end if;

    insert into public.execution_material_request_items (
      company_id, project_id, request_id, input_id,
      input_code, input_name, unit_snapshot, category_snapshot,
      cost_center_code, cost_center_name, requested_quantity,
      ordered_quantity, notes, sort_order
    ) values (
      p_company_id, p_project_id, resolved_request_id, item_input.id,
      item_input.code, item_input.description, item_input.unit, item_input.category,
      item_center_code, item_center_name, item_quantity,
      0, nullif(trim(coalesce(item ->> 'notes', '')), ''), item_index
    );
  end loop;

  perform public.recalculate_execution_material_request_status(resolved_request_id);
  return resolved_request_id;
end;
$$;

create or replace function public.approve_execution_material_request(
  p_company_id uuid,
  p_project_id uuid,
  p_request_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_company_permission(p_company_id, 'execution.material_requests.approve') then
    raise exception 'Sem permissão para aprovar solicitações de materiais.';
  end if;

  update public.execution_material_requests
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_request_id
    and company_id = p_company_id
    and project_id = p_project_id
    and status = 'requested';

  if not found then
    raise exception 'A solicitação não está disponível para aprovação.';
  end if;

  return 'approved';
end;
$$;

create or replace function public.cancel_execution_material_request(
  p_company_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_company_permission(p_company_id, 'execution.material_requests.approve') then
    raise exception 'Sem permissão para cancelar solicitações de materiais.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;

  update public.execution_material_requests
  set status = 'cancelled',
      cancellation_reason = trim(p_reason),
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_request_id
    and company_id = p_company_id
    and project_id = p_project_id
    and status not in ('attended', 'cancelled');

  if not found then
    raise exception 'A solicitação não está disponível para cancelamento.';
  end if;

  return 'cancelled';
end;
$$;

grant select, insert, update, delete on public.execution_material_requests to authenticated;
grant select, insert, update, delete on public.execution_material_request_items to authenticated;
grant execute on function public.recalculate_execution_material_request_status(uuid) to authenticated;
grant execute on function public.save_execution_material_request(uuid, uuid, uuid, uuid, date, text, jsonb) to authenticated;
grant execute on function public.approve_execution_material_request(uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_execution_material_request(uuid, uuid, uuid, text) to authenticated;

commit;
