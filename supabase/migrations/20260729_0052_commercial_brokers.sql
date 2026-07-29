-- Elos OS — Comercial: corretores, imobiliárias e comissões
-- Execute após 20260729_0051a_commercial_proposals_runtime_fix.sql.

begin;

create table if not exists public.commercial_brokers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null default 'broker'
    check (kind in ('broker','agency','manager','partner')),
  name text not null,
  legal_name text,
  tax_id text,
  creci_number text,
  creci_state text,
  agency_name text,
  phone text,
  email text,
  pix_key text,
  bank_name text,
  bank_agency text,
  bank_account text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  default_commission_pct numeric(8,4) not null default 0
    check (default_commission_pct >= 0),
  payment_due_days integer not null default 0
    check (payment_due_days >= 0 and payment_due_days <= 3650),
  status text not null default 'active' check (status in ('active','inactive')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commercial_brokers_company_name_uq
  on public.commercial_brokers(company_id, lower(trim(name)));
create index if not exists commercial_brokers_company_status_idx
  on public.commercial_brokers(company_id, status, kind, name);
create index if not exists commercial_brokers_supplier_idx
  on public.commercial_brokers(supplier_id) where supplier_id is not null;

alter table public.commercial_proposals
  add column if not exists broker_id uuid references public.commercial_brokers(id) on delete set null;
alter table public.sales
  add column if not exists broker_id uuid references public.commercial_brokers(id) on delete set null;

create index if not exists commercial_proposals_broker_idx
  on public.commercial_proposals(broker_id, proposal_date desc) where broker_id is not null;
create index if not exists sales_broker_idx
  on public.sales(broker_id, sale_date desc) where broker_id is not null;

create table if not exists public.commercial_sale_commissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  proposal_id uuid references public.commercial_proposals(id) on delete set null,
  broker_id uuid not null references public.commercial_brokers(id) on delete restrict,
  role text not null default 'broker'
    check (role in ('broker','agency','manager','referral','other')),
  calculation_base numeric(16,2) not null check (calculation_base >= 0),
  commission_pct numeric(8,4) not null check (commission_pct >= 0),
  commission_amount numeric(16,2) generated always as (
    round(calculation_base * commission_pct / 100, 2)
  ) stored,
  due_date date not null,
  status text not null default 'planned'
    check (status in ('planned','approved','payable_generated','paid','cancelled')),
  payable_id uuid references public.payables(id) on delete set null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  paid_at date,
  paid_amount numeric(16,2) check (paid_amount is null or paid_amount >= 0),
  notes text,
  source_system text not null default 'manual',
  source_id text not null default gen_random_uuid()::text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, source_system, source_id)
);

create index if not exists commercial_sale_commissions_company_status_idx
  on public.commercial_sale_commissions(company_id, project_id, status, due_date);
create index if not exists commercial_sale_commissions_broker_idx
  on public.commercial_sale_commissions(broker_id, status, due_date);
create index if not exists commercial_sale_commissions_sale_idx
  on public.commercial_sale_commissions(sale_id, role);
create index if not exists commercial_sale_commissions_payable_idx
  on public.commercial_sale_commissions(payable_id) where payable_id is not null;

insert into public.permissions(key, module, action, description) values
  ('commercial.brokers.view', 'commercial_brokers', 'view', 'Visualizar corretores, imobiliárias e comissões'),
  ('commercial.brokers.manage', 'commercial_brokers', 'manage', 'Cadastrar corretores e preparar comissões'),
  ('commercial.brokers.approve', 'commercial_brokers', 'approve', 'Aprovar comissões de vendas'),
  ('commercial.brokers.finance', 'commercial_brokers', 'finance', 'Gerar contas a pagar e acompanhar pagamentos de comissões')
on conflict(key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_key, allowed)
select role.id, permission_key, true
from public.roles role
cross join lateral (
  select unnest(
    case
      when role.key in ('owner','admin','director') then
        array['commercial.brokers.view','commercial.brokers.manage','commercial.brokers.approve','commercial.brokers.finance']::text[]
      when role.key = 'commercial' then
        array['commercial.brokers.view','commercial.brokers.manage']::text[]
      when role.key = 'finance' then
        array['commercial.brokers.view','commercial.brokers.approve','commercial.brokers.finance']::text[]
      when role.key = 'viewer' then
        array['commercial.brokers.view']::text[]
      else array[]::text[]
    end
  ) permission_key
) permissions
on conflict(role_id, permission_key) do update set allowed = excluded.allowed;

alter table public.commercial_brokers enable row level security;
alter table public.commercial_sale_commissions enable row level security;

drop policy if exists commercial_brokers_select on public.commercial_brokers;
create policy commercial_brokers_select on public.commercial_brokers
for select using (
  public.has_company_permission(company_id, 'commercial.brokers.view')
  or public.has_company_permission(company_id, 'commercial.brokers.manage')
  or public.has_company_permission(company_id, 'commercial.brokers.approve')
  or public.has_company_permission(company_id, 'commercial.brokers.finance')
  or public.has_company_permission(company_id, 'commercial.proposals.manage')
  or public.has_company_permission(company_id, 'sales.manage')
);

drop policy if exists commercial_brokers_insert on public.commercial_brokers;
create policy commercial_brokers_insert on public.commercial_brokers
for insert with check (public.has_company_permission(company_id, 'commercial.brokers.manage'));

drop policy if exists commercial_brokers_update on public.commercial_brokers;
create policy commercial_brokers_update on public.commercial_brokers
for update using (public.has_company_permission(company_id, 'commercial.brokers.manage'))
with check (public.has_company_permission(company_id, 'commercial.brokers.manage'));

drop policy if exists commercial_sale_commissions_select on public.commercial_sale_commissions;
create policy commercial_sale_commissions_select on public.commercial_sale_commissions
for select using (
  public.has_company_permission(company_id, 'commercial.brokers.view')
  or public.has_company_permission(company_id, 'commercial.brokers.manage')
  or public.has_company_permission(company_id, 'commercial.brokers.approve')
  or public.has_company_permission(company_id, 'commercial.brokers.finance')
);

drop policy if exists commercial_sale_commissions_insert on public.commercial_sale_commissions;
create policy commercial_sale_commissions_insert on public.commercial_sale_commissions
for insert with check (public.has_company_permission(company_id, 'commercial.brokers.manage'));

drop policy if exists commercial_sale_commissions_update on public.commercial_sale_commissions;
create policy commercial_sale_commissions_update on public.commercial_sale_commissions
for update using (
  public.has_company_permission(company_id, 'commercial.brokers.manage')
  or public.has_company_permission(company_id, 'commercial.brokers.approve')
  or public.has_company_permission(company_id, 'commercial.brokers.finance')
) with check (
  public.has_company_permission(company_id, 'commercial.brokers.manage')
  or public.has_company_permission(company_id, 'commercial.brokers.approve')
  or public.has_company_permission(company_id, 'commercial.brokers.finance')
);

-- Converte nomes livres já existentes em cadastros únicos por empresa.
insert into public.commercial_brokers(company_id, kind, name, status, notes)
select legacy.company_id, 'broker', min(legacy.broker_name), 'active', 'Importado automaticamente dos históricos comerciais.'
from (
  select company_id, trim(broker_name) broker_name
  from public.commercial_proposals
  where nullif(trim(broker_name), '') is not null
  union all
  select company_id, trim(broker_name) broker_name
  from public.sales
  where nullif(trim(broker_name), '') is not null
) legacy
group by legacy.company_id, lower(legacy.broker_name)
on conflict do nothing;

update public.commercial_proposals proposal
set broker_id = broker.id
from public.commercial_brokers broker
where proposal.company_id = broker.company_id
  and proposal.broker_id is null
  and lower(trim(proposal.broker_name)) = lower(trim(broker.name));

update public.sales sale
set broker_id = broker.id
from public.commercial_brokers broker
where sale.company_id = broker.company_id
  and sale.broker_id is null
  and lower(trim(sale.broker_name)) = lower(trim(broker.name));

create or replace function public.commercial_resolve_broker_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker public.commercial_brokers%rowtype;
begin
  if new.broker_id is not null then
    select * into v_broker
    from public.commercial_brokers
    where id = new.broker_id and company_id = new.company_id;
    if not found then raise exception 'O corretor informado não pertence à empresa.'; end if;
    new.broker_name := v_broker.name;
  elsif nullif(trim(new.broker_name), '') is not null then
    select * into v_broker
    from public.commercial_brokers
    where company_id = new.company_id
      and lower(trim(name)) = lower(trim(new.broker_name))
    limit 1;
    if found then
      new.broker_id := v_broker.id;
      new.broker_name := v_broker.name;
    end if;
  else
    new.broker_name := null;
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_proposals_resolve_broker on public.commercial_proposals;
create trigger commercial_proposals_resolve_broker
before insert or update of broker_id, broker_name on public.commercial_proposals
for each row execute function public.commercial_resolve_broker_reference();

drop trigger if exists sales_resolve_broker on public.sales;
create trigger sales_resolve_broker
before insert or update of broker_id, broker_name on public.sales
for each row execute function public.commercial_resolve_broker_reference();

create or replace function public.commercial_propagate_broker_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.name is distinct from new.name then
    update public.commercial_proposals set broker_name = new.name, updated_at = now() where broker_id = new.id;
    update public.sales set broker_name = new.name, updated_at = now() where broker_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_brokers_propagate_name on public.commercial_brokers;
create trigger commercial_brokers_propagate_name
after update of name on public.commercial_brokers
for each row execute function public.commercial_propagate_broker_name();

create or replace function public.commercial_sync_sale_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_broker public.commercial_brokers%rowtype;
  v_proposal_id uuid;
begin
  if new.source_system = 'commercial_proposal' then
    select id into v_proposal_id
    from public.commercial_proposals
    where company_id = new.company_id and id::text = new.source_id
    limit 1;
  end if;

  if new.status = 'active' and new.broker_id is not null and new.commission_pct > 0 then
    select * into v_broker
    from public.commercial_brokers
    where id = new.broker_id and company_id = new.company_id;
    if not found then return new; end if;

    insert into public.commercial_sale_commissions(
      company_id, project_id, sale_id, proposal_id, broker_id, role,
      calculation_base, commission_pct, due_date, status, notes,
      source_system, source_id, created_by
    ) values (
      new.company_id, new.project_id, new.id, v_proposal_id, new.broker_id, 'broker',
      new.total_amount, new.commission_pct,
      (new.sale_date + v_broker.payment_due_days)::date,
      'planned', concat('Comissão automática da venda ', new.number),
      'sales', new.id::text, new.created_by
    )
    on conflict(company_id, source_system, source_id) do update set
      project_id = excluded.project_id,
      proposal_id = coalesce(excluded.proposal_id, public.commercial_sale_commissions.proposal_id),
      broker_id = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.broker_id else public.commercial_sale_commissions.broker_id end,
      calculation_base = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.calculation_base else public.commercial_sale_commissions.calculation_base end,
      commission_pct = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.commission_pct else public.commercial_sale_commissions.commission_pct end,
      due_date = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.due_date else public.commercial_sale_commissions.due_date end,
      status = case when public.commercial_sale_commissions.status in ('planned','cancelled') then 'planned' else public.commercial_sale_commissions.status end,
      notes = case when public.commercial_sale_commissions.status in ('planned','cancelled') then excluded.notes else public.commercial_sale_commissions.notes end,
      updated_at = now();
  else
    update public.commercial_sale_commissions
    set status = 'cancelled', updated_at = now()
    where company_id = new.company_id
      and source_system = 'sales'
      and source_id = new.id::text
      and status = 'planned';
  end if;

  return new;
end;
$$;

drop trigger if exists sales_sync_commission on public.sales;
create trigger sales_sync_commission
after insert or update of broker_id, commission_pct, total_amount, sale_date, status on public.sales
for each row execute function public.commercial_sync_sale_commission();

-- Gera comissões para vendas históricas já vinculadas ao cadastro.
update public.sales
set updated_at = updated_at
where status = 'active' and broker_id is not null and commission_pct > 0;

create or replace function public.commercial_brokers_summary(
  p_company_id uuid,
  p_project_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'broker_count', (select count(*) from public.commercial_brokers b where b.company_id = p_company_id),
    'active_broker_count', (select count(*) from public.commercial_brokers b where b.company_id = p_company_id and b.status = 'active'),
    'planned_count', count(*) filter (where c.status = 'planned'),
    'approved_count', count(*) filter (where c.status = 'approved'),
    'generated_count', count(*) filter (where c.status = 'payable_generated'),
    'paid_count', count(*) filter (where c.status = 'paid'),
    'pending_amount', coalesce(sum(c.commission_amount) filter (where c.status in ('planned','approved','payable_generated')), 0),
    'approved_amount', coalesce(sum(c.commission_amount) filter (where c.status = 'approved'), 0),
    'payable_amount', coalesce(sum(c.commission_amount) filter (where c.status = 'payable_generated'), 0),
    'paid_amount', coalesce(sum(coalesce(c.paid_amount, c.commission_amount)) filter (where c.status = 'paid'), 0)
  )
  from public.commercial_sale_commissions c
  where c.company_id = p_company_id
    and (p_project_id is null or c.project_id = p_project_id)
    and (
      public.has_company_permission(c.company_id, 'commercial.brokers.view')
      or public.has_company_permission(c.company_id, 'commercial.brokers.manage')
      or public.has_company_permission(c.company_id, 'commercial.brokers.approve')
      or public.has_company_permission(c.company_id, 'commercial.brokers.finance')
    );
$$;

create or replace function public.commercial_set_commission_status(
  p_company_id uuid,
  p_commission_id uuid,
  p_status text,
  p_due_date date default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.commercial_sale_commissions%rowtype;
begin
  if p_status not in ('planned','approved','cancelled') then
    raise exception 'Situação da comissão inválida.';
  end if;

  if p_status = 'approved' then
    if not public.has_company_permission(p_company_id, 'commercial.brokers.approve') then
      raise exception 'Você não possui permissão para aprovar comissões.';
    end if;
  elsif not public.has_company_permission(p_company_id, 'commercial.brokers.manage') then
    raise exception 'Você não possui permissão para alterar comissões.';
  end if;

  select * into v_commission
  from public.commercial_sale_commissions
  where id = p_commission_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Comissão não encontrada.'; end if;
  if v_commission.status in ('payable_generated','paid') then
    raise exception 'A comissão já está vinculada ao financeiro e não pode ser alterada aqui.';
  end if;

  update public.commercial_sale_commissions
  set status = p_status,
      due_date = coalesce(p_due_date, due_date),
      approved_by = case when p_status = 'approved' then p_user_id else null end,
      approved_at = case when p_status = 'approved' then now() else null end,
      updated_at = now()
  where id = v_commission.id;
end;
$$;

create or replace function public.commercial_generate_commission_payable(p_commission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commission public.commercial_sale_commissions%rowtype;
  v_broker public.commercial_brokers%rowtype;
  v_sale public.sales%rowtype;
  v_supplier_id uuid;
  v_payable_id uuid;
begin
  select * into v_commission
  from public.commercial_sale_commissions
  where id = p_commission_id
  for update;
  if not found then raise exception 'Comissão não encontrada.'; end if;

  if not public.has_company_permission(v_commission.company_id, 'commercial.brokers.finance') then
    raise exception 'Você não possui permissão para gerar a conta a pagar.';
  end if;
  if v_commission.status <> 'approved' or v_commission.payable_id is not null then
    raise exception 'A comissão precisa estar aprovada e sem conta gerada.';
  end if;
  if v_commission.commission_amount <= 0 then
    raise exception 'O valor da comissão precisa ser maior que zero.';
  end if;

  select * into v_broker from public.commercial_brokers
  where id = v_commission.broker_id and company_id = v_commission.company_id;
  if not found then raise exception 'Corretor não encontrado.'; end if;

  select * into v_sale from public.sales
  where id = v_commission.sale_id and company_id = v_commission.company_id;
  if not found then raise exception 'Venda não encontrada.'; end if;

  v_supplier_id := v_broker.supplier_id;
  if v_supplier_id is null then
    insert into public.suppliers(
      company_id, person_type, legal_name, trade_name, tax_id, category,
      contact_name, phone, email, status, notes, source_system, source_id, created_by
    ) values (
      v_broker.company_id,
      case when v_broker.kind = 'agency' then 'company' else 'individual' end,
      coalesce(nullif(v_broker.legal_name, ''), v_broker.name),
      v_broker.name, v_broker.tax_id, 'Corretor / Imobiliária',
      v_broker.name, v_broker.phone, v_broker.email, 'active',
      concat_ws(' · ', nullif(v_broker.creci_number, ''), nullif(v_broker.pix_key, '')),
      'commercial_broker', v_broker.id::text, auth.uid()
    )
    on conflict(company_id, source_system, source_id) do update set
      legal_name = excluded.legal_name,
      trade_name = excluded.trade_name,
      tax_id = excluded.tax_id,
      phone = excluded.phone,
      email = excluded.email,
      status = 'active'
    returning id into v_supplier_id;

    update public.commercial_brokers
    set supplier_id = v_supplier_id, updated_at = now()
    where id = v_broker.id;
  end if;

  insert into public.payables(
    company_id, project_id, supplier_id, document, fiscal_class, payment_method,
    due_date, amount, status, installment_label, notes, origin,
    source_system, source_id, created_by
  ) values (
    v_commission.company_id, v_commission.project_id, v_supplier_id,
    concat('COM-', v_sale.number), 'Comissão de vendas',
    case when nullif(v_broker.pix_key, '') is not null then 'PIX' else null end,
    v_commission.due_date, v_commission.commission_amount, 'open',
    concat('Comissão ', v_commission.role, ' · ', v_sale.number),
    concat_ws(' · ', v_broker.name, nullif(v_broker.creci_number, ''), nullif(v_commission.notes, '')),
    'commission', 'elos_broker_commissions',
    concat('broker_commission:', v_commission.id, ':', gen_random_uuid()), auth.uid()
  ) returning id into v_payable_id;

  update public.commercial_sale_commissions
  set payable_id = v_payable_id, status = 'payable_generated', updated_at = now()
  where id = v_commission.id;

  return v_payable_id;
end;
$$;

create or replace function public.commercial_sync_commission_from_payable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_system <> 'elos_broker_commissions' then return new; end if;

  if new.status = 'paid' then
    update public.commercial_sale_commissions
    set status = 'paid', paid_at = new.paid_at,
        paid_amount = coalesce(new.paid_amount, new.amount), updated_at = now()
    where payable_id = new.id;
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    update public.commercial_sale_commissions
    set status = 'approved', payable_id = null,
        paid_at = null, paid_amount = null, updated_at = now()
    where payable_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists finance_payables_broker_commission_sync on public.payables;
create trigger finance_payables_broker_commission_sync
after update of status, paid_at, paid_amount on public.payables
for each row execute function public.commercial_sync_commission_from_payable();

grant select, insert, update on public.commercial_brokers to authenticated;
grant select, insert, update on public.commercial_sale_commissions to authenticated;
grant execute on function public.commercial_brokers_summary(uuid, uuid) to authenticated;
grant execute on function public.commercial_set_commission_status(uuid, uuid, text, date, uuid) to authenticated;
grant execute on function public.commercial_generate_commission_payable(uuid) to authenticated;

commit;
