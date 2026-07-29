-- Elos OS — Financeiro · Impostos
-- Cadastro de tributos, agenda fiscal e integração com Contas a Pagar.

begin;

create table if not exists public.finance_tax_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  category text not null default 'other'
    check (category in ('federal','state','municipal','labor','social','property','other')),
  authority_supplier_id uuid not null references public.suppliers(id) on delete restrict,
  fiscal_class text,
  payment_method text,
  document_prefix text,
  notes text,
  status text not null default 'active' check (status in ('active','inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists public.finance_tax_obligations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  tax_type_id uuid not null references public.finance_tax_types(id) on delete restrict,
  competence_date date not null,
  reference text not null default '',
  due_date date not null,
  principal_amount numeric(16,2) not null default 0 check (principal_amount >= 0),
  interest_amount numeric(16,2) not null default 0 check (interest_amount >= 0),
  penalty_amount numeric(16,2) not null default 0 check (penalty_amount >= 0),
  other_amount numeric(16,2) not null default 0 check (other_amount >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(16,2) generated always as (
    principal_amount + interest_amount + penalty_amount + other_amount - discount_amount
  ) stored,
  document_number text,
  payment_code text,
  barcode text,
  notes text,
  status text not null default 'scheduled'
    check (status in ('scheduled','payable_generated','paid','cancelled')),
  payable_id uuid references public.payables(id) on delete set null,
  paid_at date,
  paid_amount numeric(16,2) check (paid_amount is null or paid_amount >= 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (principal_amount + interest_amount + penalty_amount + other_amount >= discount_amount),
  unique(company_id, project_id, tax_type_id, competence_date, reference)
);

create index if not exists finance_tax_types_company_status_idx
  on public.finance_tax_types(company_id, status, category, code);
create index if not exists finance_tax_obligations_company_due_idx
  on public.finance_tax_obligations(company_id, project_id, status, due_date);
create index if not exists finance_tax_obligations_type_idx
  on public.finance_tax_obligations(tax_type_id, competence_date desc);
create index if not exists finance_tax_obligations_payable_idx
  on public.finance_tax_obligations(payable_id)
  where payable_id is not null;

insert into public.permissions (key, module, action, description) values
  ('finance.taxes.view', 'finance_taxes', 'view', 'Visualizar tributos e agenda fiscal'),
  ('finance.taxes.manage', 'finance_taxes', 'manage', 'Cadastrar tributos, obrigações e gerar contas a pagar')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_key, allowed)
select role.id, permission_key, true
from public.roles role
cross join lateral (
  select unnest(
    case
      when role.key in ('owner','admin','director','finance') then
        array['finance.taxes.view','finance.taxes.manage']::text[]
      when role.key in ('engineering','viewer') then
        array['finance.taxes.view']::text[]
      else array[]::text[]
    end
  ) permission_key
) permissions
on conflict(role_id, permission_key) do update set allowed = excluded.allowed;

alter table public.finance_tax_types enable row level security;
alter table public.finance_tax_obligations enable row level security;

drop policy if exists finance_tax_types_select on public.finance_tax_types;
create policy finance_tax_types_select on public.finance_tax_types
for select using (
  public.has_company_permission(company_id, 'finance.taxes.view')
  or public.has_company_permission(company_id, 'finance.taxes.manage')
);

drop policy if exists finance_tax_types_insert on public.finance_tax_types;
create policy finance_tax_types_insert on public.finance_tax_types
for insert with check (
  public.has_company_permission(company_id, 'finance.taxes.manage')
);

drop policy if exists finance_tax_types_update on public.finance_tax_types;
create policy finance_tax_types_update on public.finance_tax_types
for update using (
  public.has_company_permission(company_id, 'finance.taxes.manage')
) with check (
  public.has_company_permission(company_id, 'finance.taxes.manage')
);

drop policy if exists finance_tax_obligations_select on public.finance_tax_obligations;
create policy finance_tax_obligations_select on public.finance_tax_obligations
for select using (
  public.has_company_permission(company_id, 'finance.taxes.view')
  or public.has_company_permission(company_id, 'finance.taxes.manage')
);

drop policy if exists finance_tax_obligations_insert on public.finance_tax_obligations;
create policy finance_tax_obligations_insert on public.finance_tax_obligations
for insert with check (
  public.has_company_permission(company_id, 'finance.taxes.manage')
);

drop policy if exists finance_tax_obligations_update on public.finance_tax_obligations;
create policy finance_tax_obligations_update on public.finance_tax_obligations
for update using (
  public.has_company_permission(company_id, 'finance.taxes.manage')
) with check (
  public.has_company_permission(company_id, 'finance.taxes.manage')
);

create or replace function public.finance_generate_tax_payable(p_obligation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_obligation public.finance_tax_obligations%rowtype;
  v_type public.finance_tax_types%rowtype;
  v_payable_id uuid;
  v_document text;
begin
  select * into v_obligation
  from public.finance_tax_obligations
  where id = p_obligation_id
  for update;

  if v_obligation.id is null then
    raise exception 'Obrigação fiscal não encontrada.';
  end if;

  if not public.has_company_permission(v_obligation.company_id, 'finance.taxes.manage') then
    raise exception 'Você não possui permissão para gerar esta conta a pagar.';
  end if;

  if v_obligation.status <> 'scheduled' or v_obligation.payable_id is not null then
    raise exception 'A obrigação não está disponível para geração.';
  end if;

  if v_obligation.total_amount <= 0 then
    raise exception 'Informe um valor maior que zero antes de gerar a conta.';
  end if;

  select * into v_type
  from public.finance_tax_types
  where id = v_obligation.tax_type_id
    and company_id = v_obligation.company_id
    and status = 'active';

  if v_type.id is null then
    raise exception 'O tributo está inativo ou não pertence à empresa.';
  end if;

  if not exists (
    select 1 from public.projects
    where id = v_obligation.project_id
      and company_id = v_obligation.company_id
  ) then
    raise exception 'O empreendimento da obrigação não pertence à empresa.';
  end if;

  if not exists (
    select 1 from public.suppliers
    where id = v_type.authority_supplier_id
      and company_id = v_obligation.company_id
      and status = 'active'
  ) then
    raise exception 'O órgão ou favorecido do tributo não está disponível.';
  end if;

  v_document := coalesce(
    nullif(v_obligation.document_number, ''),
    concat_ws(' ', nullif(v_type.document_prefix, ''), v_type.code, to_char(v_obligation.competence_date, 'MM/YYYY'))
  );

  insert into public.payables(
    company_id,
    project_id,
    supplier_id,
    document,
    fiscal_class,
    payment_method,
    due_date,
    amount,
    status,
    installment_label,
    notes,
    origin,
    source_system,
    source_id,
    created_by
  ) values (
    v_obligation.company_id,
    v_obligation.project_id,
    v_type.authority_supplier_id,
    v_document,
    v_type.fiscal_class,
    v_type.payment_method,
    v_obligation.due_date,
    v_obligation.total_amount,
    'open',
    concat('Competência ', to_char(v_obligation.competence_date, 'MM/YYYY'), case when v_obligation.reference <> '' then ' · ' || v_obligation.reference else '' end),
    concat_ws(' · ', nullif(v_type.name, ''), nullif(v_obligation.payment_code, ''), nullif(v_obligation.notes, '')),
    'tax',
    'elos_taxes',
    'tax_obligation:' || v_obligation.id::text || ':' || gen_random_uuid()::text,
    auth.uid()
  ) returning id into v_payable_id;

  update public.finance_tax_obligations
  set payable_id = v_payable_id,
      status = 'payable_generated',
      updated_at = now()
  where id = v_obligation.id;

  return v_payable_id;
end;
$$;

create or replace function public.finance_sync_tax_obligation_from_payable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_system <> 'elos_taxes' then
    return new;
  end if;

  if new.status = 'paid' then
    update public.finance_tax_obligations
    set status = 'paid',
        paid_at = new.paid_at,
        paid_amount = coalesce(new.paid_amount, new.amount),
        updated_at = now()
    where payable_id = new.id;
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    update public.finance_tax_obligations
    set status = 'scheduled',
        payable_id = null,
        paid_at = null,
        paid_amount = null,
        updated_at = now()
    where payable_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists finance_payables_tax_obligation_sync on public.payables;
create trigger finance_payables_tax_obligation_sync
after update of status, paid_at, paid_amount on public.payables
for each row
execute function public.finance_sync_tax_obligation_from_payable();

grant select, insert, update on public.finance_tax_types to authenticated;
grant select, insert, update on public.finance_tax_obligations to authenticated;
grant execute on function public.finance_generate_tax_payable(uuid) to authenticated;

commit;
