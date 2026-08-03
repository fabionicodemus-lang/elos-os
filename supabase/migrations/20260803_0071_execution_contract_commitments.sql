-- Elos OS — Fase 3 · Contratos comprometidos
-- Evolui contratos e medições existentes sem alterar registros atuais.

begin;

create table if not exists public.execution_service_contract_amendment_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete restrict,
  amendment_id uuid not null references public.execution_service_contract_amendments(id) on delete cascade,
  contract_item_id uuid not null references public.execution_service_contract_items(id) on delete restrict,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  value_change numeric(18,2) not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (amendment_id, contract_item_id),
  constraint execution_service_contract_amendment_item_value_check check (value_change <> 0)
);

create index if not exists execution_service_contract_amendment_items_contract_idx
  on public.execution_service_contract_amendment_items(contract_id, amendment_id);
create index if not exists execution_service_contract_amendment_items_service_idx
  on public.execution_service_contract_amendment_items(project_id, service_id);

alter table public.execution_service_contract_amendment_items enable row level security;

drop policy if exists execution_service_contract_amendment_items_select on public.execution_service_contract_amendment_items;
create policy execution_service_contract_amendment_items_select
on public.execution_service_contract_amendment_items
for select to authenticated
using (
  public.has_company_permission(company_id,'execution.contracts.view')
  or public.has_company_permission(company_id,'execution.contracts.manage')
  or public.has_company_permission(company_id,'execution.contracts.approve')
  or public.has_company_permission(company_id,'execution.contracts.amend')
);

drop policy if exists execution_service_contract_amendment_items_write on public.execution_service_contract_amendment_items;
create policy execution_service_contract_amendment_items_write
on public.execution_service_contract_amendment_items
for all to authenticated
using (public.has_company_permission(company_id,'execution.contracts.amend'))
with check (public.has_company_permission(company_id,'execution.contracts.amend'));

alter table public.execution_contract_measurements
  add column if not exists over_contract_confirmed boolean not null default false,
  add column if not exists over_contract_confirmed_by uuid references auth.users(id),
  add column if not exists over_contract_confirmed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id),
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_reason text;

alter table public.execution_contract_measurements
  drop constraint if exists execution_contract_measurements_status_check;
alter table public.execution_contract_measurements
  add constraint execution_contract_measurements_status_check
  check (status in ('draft','submitted','approved','rejected','invoiced','paid','cancelled','reversed'));

alter table public.execution_contract_measurements
  drop constraint if exists execution_contract_measurement_reversal_check;
alter table public.execution_contract_measurements
  add constraint execution_contract_measurement_reversal_check
  check (status <> 'reversed' or nullif(trim(coalesce(reversal_reason,'')),'') is not null);

alter table public.execution_contract_measurement_items
  drop constraint if exists execution_contract_measurement_item_values_check;
alter table public.execution_contract_measurement_items
  add constraint execution_contract_measurement_item_values_check check (
    contracted_quantity > 0 and previous_approved_quantity >= 0 and current_quantity > 0 and accumulated_quantity >= 0 and
    unit_price >= 0 and previous_approved_amount >= 0 and current_amount >= 0 and accumulated_amount >= 0 and
    progress_percent >= 0
  );

insert into public.permissions (key,module,action,description) values
  ('execution.measurements.reverse','execution_measurements','reverse','Estornar medição aprovada e cancelar conta a pagar ainda não paga')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'execution.measurements.reverse',true
from public.roles r
where r.key in ('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

grant select,insert,update,delete on public.execution_service_contract_amendment_items to authenticated;

commit;
