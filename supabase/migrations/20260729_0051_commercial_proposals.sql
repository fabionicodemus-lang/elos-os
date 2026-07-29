-- Elos OS — Comercial: propostas, condições de pagamento e conversão em venda
-- Execute após 20260729_0050_finance_taxes.sql.

begin;

create table if not exists public.commercial_proposal_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  counter_year integer not null,
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (company_id, project_id, counter_year)
);

create table if not exists public.commercial_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  client_id uuid not null references public.clients(id),
  number text not null,
  version_no integer not null default 1 check (version_no > 0),
  parent_proposal_id uuid references public.commercial_proposals(id) on delete set null,
  proposal_date date not null default current_date,
  valid_until date not null,
  reservation_until date,
  list_price numeric(16,2) not null default 0 check (list_price >= 0),
  proposed_amount numeric(16,2) not null check (proposed_amount > 0),
  discount_amount numeric(16,2) generated always as (greatest(list_price - proposed_amount, 0)) stored,
  discount_percentage numeric(10,6) generated always as (
    case when list_price > 0 then greatest((list_price - proposed_amount) / list_price * 100, 0) else 0 end
  ) stored,
  commission_pct numeric(8,4) not null default 0 check (commission_pct >= 0),
  broker_name text,
  source_channel text,
  status text not null default 'draft'
    check (status in ('draft','sent','negotiation','approved','rejected','expired','cancelled','converted')),
  terms text,
  notes text,
  converted_sale_id uuid references public.sales(id) on delete set null,
  converted_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, number, version_no),
  check (valid_until >= proposal_date),
  check (reservation_until is null or reservation_until >= proposal_date)
);

create table if not exists public.commercial_proposal_payment_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  proposal_id uuid not null references public.commercial_proposals(id) on delete cascade,
  category text not null check (category in ('entry','monthly','reinforcement','keys','post_keys','other')),
  description text not null,
  installment_count integer not null default 1 check (installment_count > 0 and installment_count <= 240),
  first_due_date date not null,
  interval_months integer not null default 1 check (interval_months >= 0 and interval_months <= 120),
  amount_per_installment numeric(16,2) not null check (amount_per_installment > 0),
  total_amount numeric(16,2) generated always as (installment_count * amount_per_installment) stored,
  adjustment_index text,
  interest_rate_monthly numeric(8,4) check (interest_rate_monthly is null or interest_rate_monthly >= 0),
  sort_order integer not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commercial_proposals_company_project_status_idx
  on public.commercial_proposals(company_id, project_id, status, proposal_date desc);
create index if not exists commercial_proposals_unit_idx
  on public.commercial_proposals(unit_id, status, valid_until);
create index if not exists commercial_proposals_client_idx
  on public.commercial_proposals(client_id, proposal_date desc);
create index if not exists commercial_proposals_number_idx
  on public.commercial_proposals(company_id, number, version_no desc);
create unique index if not exists commercial_proposals_one_approved_unit_uq
  on public.commercial_proposals(unit_id)
  where status = 'approved';
create index if not exists commercial_proposal_payment_items_proposal_idx
  on public.commercial_proposal_payment_items(proposal_id, sort_order, first_due_date);

insert into public.permissions (key, module, action, description) values
  ('commercial.proposals.view', 'commercial_proposals', 'view', 'Visualizar propostas comerciais'),
  ('commercial.proposals.manage', 'commercial_proposals', 'manage', 'Criar e editar propostas e condições de pagamento'),
  ('commercial.proposals.approve', 'commercial_proposals', 'approve', 'Aprovar propostas e reservar unidades'),
  ('commercial.proposals.convert', 'commercial_proposals', 'convert', 'Converter propostas aprovadas em vendas e contas a receber')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select role.id, permission_key
from public.roles role
cross join lateral (
  select unnest(
    case
      when role.key in ('owner','admin','director','commercial') then
        array['commercial.proposals.view','commercial.proposals.manage','commercial.proposals.approve','commercial.proposals.convert']::text[]
      when role.key in ('finance','viewer') then
        array['commercial.proposals.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.commercial_proposals enable row level security;
alter table public.commercial_proposal_payment_items enable row level security;
alter table public.commercial_proposal_counters enable row level security;

drop policy if exists commercial_proposals_select on public.commercial_proposals;
create policy commercial_proposals_select on public.commercial_proposals
for select using (
  public.has_company_permission(company_id, 'commercial.proposals.view')
  or public.has_company_permission(company_id, 'commercial.proposals.manage')
  or public.has_company_permission(company_id, 'commercial.proposals.approve')
  or public.has_company_permission(company_id, 'commercial.proposals.convert')
);

drop policy if exists commercial_proposals_insert on public.commercial_proposals;
create policy commercial_proposals_insert on public.commercial_proposals
for insert with check (
  public.has_company_permission(company_id, 'commercial.proposals.manage')
);

drop policy if exists commercial_proposals_update on public.commercial_proposals;
create policy commercial_proposals_update on public.commercial_proposals
for update using (
  public.has_company_permission(company_id, 'commercial.proposals.manage')
  or public.has_company_permission(company_id, 'commercial.proposals.approve')
  or public.has_company_permission(company_id, 'commercial.proposals.convert')
) with check (
  public.has_company_permission(company_id, 'commercial.proposals.manage')
  or public.has_company_permission(company_id, 'commercial.proposals.approve')
  or public.has_company_permission(company_id, 'commercial.proposals.convert')
);

drop policy if exists commercial_proposal_payment_items_select on public.commercial_proposal_payment_items;
create policy commercial_proposal_payment_items_select on public.commercial_proposal_payment_items
for select using (
  public.has_company_permission(company_id, 'commercial.proposals.view')
  or public.has_company_permission(company_id, 'commercial.proposals.manage')
  or public.has_company_permission(company_id, 'commercial.proposals.approve')
  or public.has_company_permission(company_id, 'commercial.proposals.convert')
);

drop policy if exists commercial_proposal_payment_items_insert on public.commercial_proposal_payment_items;
create policy commercial_proposal_payment_items_insert on public.commercial_proposal_payment_items
for insert with check (public.has_company_permission(company_id, 'commercial.proposals.manage'));

drop policy if exists commercial_proposal_payment_items_update on public.commercial_proposal_payment_items;
create policy commercial_proposal_payment_items_update on public.commercial_proposal_payment_items
for update using (public.has_company_permission(company_id, 'commercial.proposals.manage'))
with check (public.has_company_permission(company_id, 'commercial.proposals.manage'));

drop policy if exists commercial_proposal_payment_items_delete on public.commercial_proposal_payment_items;
create policy commercial_proposal_payment_items_delete on public.commercial_proposal_payment_items
for delete using (public.has_company_permission(company_id, 'commercial.proposals.manage'));

-- O contador é acessado apenas pelas funções security definer.
drop policy if exists commercial_proposal_counters_select on public.commercial_proposal_counters;

create or replace function public.commercial_proposal_next_number(
  p_company_id uuid,
  p_project_id uuid,
  p_proposal_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from coalesce(p_proposal_date, current_date))::integer;
  v_number integer;
begin
  if not public.has_company_permission(p_company_id, 'commercial.proposals.manage') then
    raise exception 'Você não possui permissão para criar propostas.';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and company_id = p_company_id and status <> 'archived'
  ) then
    raise exception 'O empreendimento informado não pertence à empresa ativa.';
  end if;

  insert into public.commercial_proposal_counters(company_id, project_id, counter_year, last_number)
  values (p_company_id, p_project_id, v_year, 1)
  on conflict (company_id, project_id, counter_year)
  do update set last_number = public.commercial_proposal_counters.last_number + 1, updated_at = now()
  returning last_number into v_number;

  return format('PROP-%s-%s', v_year, lpad(v_number::text, 4, '0'));
end;
$$;

create or replace function public.commercial_proposals_summary(
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
    'total_count', count(*),
    'draft_count', count(*) filter (where status = 'draft'),
    'pipeline_count', count(*) filter (where status in ('sent','negotiation','approved')),
    'approved_count', count(*) filter (where status = 'approved'),
    'converted_count', count(*) filter (where status = 'converted'),
    'pipeline_amount', coalesce(sum(proposed_amount) filter (where status in ('sent','negotiation','approved')), 0),
    'approved_amount', coalesce(sum(proposed_amount) filter (where status = 'approved'), 0),
    'converted_amount', coalesce(sum(proposed_amount) filter (where status = 'converted'), 0),
    'expiring_count', count(*) filter (
      where status in ('sent','negotiation','approved')
        and valid_until between current_date and current_date + 7
    ),
    'expired_open_count', count(*) filter (
      where status in ('draft','sent','negotiation','approved') and valid_until < current_date
    )
  )
  from public.commercial_proposals
  where company_id = p_company_id
    and (p_project_id is null or project_id = p_project_id)
    and (
      public.has_company_permission(company_id, 'commercial.proposals.view')
      or public.has_company_permission(company_id, 'commercial.proposals.manage')
      or public.has_company_permission(company_id, 'commercial.proposals.approve')
      or public.has_company_permission(company_id, 'commercial.proposals.convert')
    );
$$;

create or replace function public.commercial_set_proposal_status(
  p_company_id uuid,
  p_proposal_id uuid,
  p_status text,
  p_reservation_until date default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.commercial_proposals%rowtype;
  v_sale_exists boolean;
begin
  if p_status not in ('draft','sent','negotiation','approved','rejected','expired','cancelled') then
    raise exception 'Situação da proposta inválida.';
  end if;

  if p_status = 'approved' then
    if not public.has_company_permission(p_company_id, 'commercial.proposals.approve') then
      raise exception 'Você não possui permissão para aprovar propostas.';
    end if;
  elsif not public.has_company_permission(p_company_id, 'commercial.proposals.manage') then
    raise exception 'Você não possui permissão para alterar propostas.';
  end if;

  select * into v_proposal
  from public.commercial_proposals
  where id = p_proposal_id and company_id = p_company_id
  for update;

  if not found then raise exception 'Proposta não encontrada.'; end if;
  if v_proposal.status = 'converted' then raise exception 'Uma proposta convertida não pode ser alterada.'; end if;

  select exists(
    select 1 from public.sales
    where unit_id = v_proposal.unit_id and status = 'active'
  ) into v_sale_exists;

  if p_status = 'approved' then
    if v_sale_exists then raise exception 'A unidade já possui uma venda ativa.'; end if;
    if v_proposal.valid_until < current_date then raise exception 'A proposta está vencida. Crie uma nova versão antes de aprovar.'; end if;
    if exists(
      select 1 from public.commercial_proposals
      where unit_id = v_proposal.unit_id and status = 'approved' and id <> v_proposal.id
    ) then
      raise exception 'A unidade já está reservada por outra proposta aprovada.';
    end if;

    update public.units
      set status = 'reserved', updated_at = now()
    where id = v_proposal.unit_id and company_id = p_company_id and status <> 'sold';
  elsif v_proposal.status = 'approved' and not v_sale_exists then
    update public.units
      set status = 'available', updated_at = now()
    where id = v_proposal.unit_id and company_id = p_company_id and status = 'reserved';
  end if;

  update public.commercial_proposals
  set status = p_status,
      reservation_until = case when p_status = 'approved' then p_reservation_until else null end,
      updated_by = p_user_id,
      updated_at = now()
  where id = v_proposal.id;
end;
$$;

create or replace function public.commercial_create_proposal_revision(
  p_company_id uuid,
  p_proposal_id uuid,
  p_valid_until date,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.commercial_proposals%rowtype;
  v_new_id uuid := gen_random_uuid();
  v_new_version integer;
begin
  if not public.has_company_permission(p_company_id, 'commercial.proposals.manage') then
    raise exception 'Você não possui permissão para criar versões.';
  end if;

  select * into v_old
  from public.commercial_proposals
  where id = p_proposal_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  if v_old.status = 'converted' then raise exception 'Não é possível versionar uma proposta convertida.'; end if;
  if p_valid_until < current_date then raise exception 'Informe uma validade futura para a nova versão.'; end if;

  select coalesce(max(version_no), 0) + 1 into v_new_version
  from public.commercial_proposals
  where company_id = p_company_id and project_id = v_old.project_id and number = v_old.number;

  if v_old.status = 'approved' then
    update public.units set status = 'available', updated_at = now()
    where id = v_old.unit_id and status = 'reserved';
  end if;

  update public.commercial_proposals
  set status = 'rejected', reservation_until = null, updated_by = p_user_id, updated_at = now()
  where id = v_old.id;

  insert into public.commercial_proposals(
    id, company_id, project_id, unit_id, client_id, number, version_no, parent_proposal_id,
    proposal_date, valid_until, list_price, proposed_amount, commission_pct, broker_name,
    source_channel, status, terms, notes, created_by, updated_by
  ) values (
    v_new_id, v_old.company_id, v_old.project_id, v_old.unit_id, v_old.client_id,
    v_old.number, v_new_version, v_old.id, current_date, p_valid_until, v_old.list_price,
    v_old.proposed_amount, v_old.commission_pct, v_old.broker_name, v_old.source_channel,
    'draft', v_old.terms, v_old.notes, p_user_id, p_user_id
  );

  insert into public.commercial_proposal_payment_items(
    company_id, proposal_id, category, description, installment_count, first_due_date,
    interval_months, amount_per_installment, adjustment_index, interest_rate_monthly,
    sort_order, notes, created_by
  )
  select company_id, v_new_id, category, description, installment_count,
    greatest(first_due_date, current_date), interval_months, amount_per_installment,
    adjustment_index, interest_rate_monthly, sort_order, notes, p_user_id
  from public.commercial_proposal_payment_items
  where proposal_id = v_old.id
  order by sort_order, first_due_date;

  return v_new_id;
end;
$$;

create or replace function public.commercial_convert_proposal(
  p_company_id uuid,
  p_proposal_id uuid,
  p_sale_date date,
  p_contract_number text default null,
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.commercial_proposals%rowtype;
  v_sale_id uuid := gen_random_uuid();
  v_planned numeric(16,2);
  v_sale_number text;
begin
  if not public.has_company_permission(p_company_id, 'commercial.proposals.convert') then
    raise exception 'Você não possui permissão para converter propostas.';
  end if;

  select * into v_proposal
  from public.commercial_proposals
  where id = p_proposal_id and company_id = p_company_id
  for update;

  if not found then raise exception 'Proposta não encontrada.'; end if;
  if v_proposal.status <> 'approved' then raise exception 'Somente uma proposta aprovada pode ser convertida.'; end if;
  if v_proposal.valid_until < current_date then raise exception 'A proposta está vencida.'; end if;
  if v_proposal.converted_sale_id is not null then return v_proposal.converted_sale_id; end if;

  if exists(select 1 from public.sales where unit_id = v_proposal.unit_id and status = 'active') then
    raise exception 'A unidade já possui uma venda ativa.';
  end if;

  select coalesce(sum(total_amount), 0) into v_planned
  from public.commercial_proposal_payment_items
  where proposal_id = v_proposal.id;

  if v_planned <= 0 then raise exception 'Cadastre as condições de pagamento antes da conversão.'; end if;
  if abs(v_planned - v_proposal.proposed_amount) > 0.01 then
    raise exception 'O plano financeiro (%) não fecha com o valor da proposta (%).', v_planned, v_proposal.proposed_amount;
  end if;

  v_sale_number := 'VEN-' || v_proposal.number || '-V' || v_proposal.version_no;

  insert into public.sales(
    id, company_id, project_id, unit_id, client_id, number, source_code, contract_number,
    sale_date, total_amount, commission_pct, commission_amount, broker_name, status,
    payment_plan_available, notes, source_system, source_id, created_by
  ) values (
    v_sale_id, v_proposal.company_id, v_proposal.project_id, v_proposal.unit_id,
    v_proposal.client_id, v_sale_number, v_proposal.number, nullif(trim(p_contract_number), ''),
    coalesce(p_sale_date, current_date), v_proposal.proposed_amount, v_proposal.commission_pct,
    round(v_proposal.proposed_amount * v_proposal.commission_pct / 100, 2),
    v_proposal.broker_name, 'active', true,
    concat('Convertida da proposta ', v_proposal.number, ' versão ', v_proposal.version_no,
      case when v_proposal.notes is not null then E'\n' || v_proposal.notes else '' end),
    'commercial_proposal', v_proposal.id::text, p_user_id
  );

  insert into public.receivables(
    company_id, project_id, sale_id, client_id, unit_id, category, description,
    sequence_number, sequence_total, due_date, amount, adjustment_index,
    interest_rate_monthly, status, notes, source_system, source_id, created_by
  )
  select
    v_proposal.company_id, v_proposal.project_id, v_sale_id, v_proposal.client_id,
    v_proposal.unit_id, item.category, item.description, installment.number,
    item.installment_count,
    (item.first_due_date + make_interval(months => item.interval_months * (installment.number - 1)))::date,
    item.amount_per_installment, item.adjustment_index, item.interest_rate_monthly,
    'open', item.notes, 'commercial_proposal',
    concat(v_proposal.id, ':', item.id, ':', installment.number), p_user_id
  from public.commercial_proposal_payment_items item
  cross join lateral generate_series(1, item.installment_count) as installment(number)
  where item.proposal_id = v_proposal.id;

  update public.units
  set status = 'sold', updated_at = now()
  where id = v_proposal.unit_id and company_id = p_company_id;

  update public.commercial_proposals
  set status = 'converted', converted_sale_id = v_sale_id, converted_at = now(),
      reservation_until = null, updated_by = p_user_id, updated_at = now()
  where id = v_proposal.id;

  update public.commercial_proposals
  set status = 'rejected', reservation_until = null, updated_at = now()
  where unit_id = v_proposal.unit_id
    and id <> v_proposal.id
    and status in ('draft','sent','negotiation','approved');

  return v_sale_id;
end;
$$;

grant select, insert, update on public.commercial_proposals to authenticated;
grant select, insert, update, delete on public.commercial_proposal_payment_items to authenticated;
grant execute on function public.commercial_proposal_next_number(uuid, uuid, date) to authenticated;
grant execute on function public.commercial_proposals_summary(uuid, uuid) to authenticated;
grant execute on function public.commercial_set_proposal_status(uuid, uuid, text, date, uuid) to authenticated;
grant execute on function public.commercial_create_proposal_revision(uuid, uuid, date, uuid) to authenticated;
grant execute on function public.commercial_convert_proposal(uuid, uuid, date, text, uuid) to authenticated;

commit;
