-- Elos OS — Comercial · ERP de incorporadora
-- Camada contratual e de carteira sobre vendas, propostas e recebíveis existentes.
begin;

insert into public.permissions(key,module,action,description) values
  ('commercial.incorporation.view','commercial_incorporation','view','Visualizar carteira, contratos, permutas, repasses, cobrança e distratos'),
  ('commercial.incorporation.manage','commercial_incorporation','manage','Gerenciar compradores, contratos, permutas, aditivos e carteira'),
  ('commercial.incorporation.approve','commercial_incorporation','approve','Aprovar renegociações e distratos'),
  ('commercial.incorporation.finance','commercial_incorporation','finance','Gerenciar repasses, cobrança e efeitos financeiros da carteira')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true
from public.roles r
cross join lateral (
  select unnest(case
    when r.key in ('owner','admin','director') then array['commercial.incorporation.view','commercial.incorporation.manage','commercial.incorporation.approve','commercial.incorporation.finance']::text[]
    when r.key='commercial' then array['commercial.incorporation.view','commercial.incorporation.manage']::text[]
    when r.key='finance' then array['commercial.incorporation.view','commercial.incorporation.approve','commercial.incorporation.finance']::text[]
    when r.key='viewer' then array['commercial.incorporation.view']::text[]
    else array[]::text[] end) permission_key
) p
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

create table if not exists public.commercial_price_tables(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  version_no integer not null default 1 check(version_no>0),
  valid_from date not null,
  valid_until date,
  status text not null default 'draft' check(status in ('draft','active','inactive','archived')),
  default_correction_index_id uuid references public.correction_indices(id) on delete set null,
  notes text,
  activated_at timestamptz,
  activated_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(valid_until is null or valid_until>=valid_from),
  unique(project_id,name,version_no)
);
create index if not exists commercial_price_tables_project_idx on public.commercial_price_tables(company_id,project_id,status,valid_from desc);

create table if not exists public.commercial_price_table_items(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  price_table_id uuid not null references public.commercial_price_tables(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  list_price numeric(16,2) not null check(list_price>0),
  cash_price numeric(16,2) check(cash_price is null or cash_price>0),
  minimum_price numeric(16,2) check(minimum_price is null or minimum_price>0),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(price_table_id,unit_id),
  check(minimum_price is null or minimum_price<=list_price)
);
create index if not exists commercial_price_table_items_unit_idx on public.commercial_price_table_items(unit_id,price_table_id);

create table if not exists public.commercial_sale_parties(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  role text not null default 'buyer' check(role in ('buyer','co_buyer','spouse','guarantor','assignee','representative','other')),
  ownership_percent numeric(7,4) check(ownership_percent is null or ownership_percent between 0 and 100),
  is_primary boolean not null default false,
  status text not null default 'active' check(status in ('active','inactive')),
  joined_at date,
  left_at date,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sale_id,client_id,role)
);
create unique index if not exists commercial_sale_parties_primary_uq on public.commercial_sale_parties(sale_id) where is_primary and status='active';
create index if not exists commercial_sale_parties_client_idx on public.commercial_sale_parties(company_id,client_id,status);

create table if not exists public.commercial_sale_contracts(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  kind text not null default 'purchase_agreement' check(kind in ('purchase_agreement','addendum','assignment','renegotiation','confession','termination','other')),
  document_number text,
  signed_at date,
  effective_date date,
  status text not null default 'draft' check(status in ('draft','signed','cancelled')),
  supersedes_contract_id uuid references public.commercial_sale_contracts(id) on delete set null,
  document_url text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commercial_sale_contracts_sale_idx on public.commercial_sale_contracts(sale_id,effective_date desc,created_at desc);

create table if not exists public.commercial_sale_considerations(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  kind text not null check(kind in ('real_estate','land','vehicle','service','credit','other')),
  description text not null,
  asset_identifier text,
  appraised_value numeric(16,2) check(appraised_value is null or appraised_value>=0),
  accepted_value numeric(16,2) not null check(accepted_value>0),
  due_date date,
  received_at date,
  status text not null default 'planned' check(status in ('planned','received','transferred','cancelled')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commercial_sale_considerations_sale_idx on public.commercial_sale_considerations(sale_id,status);

create table if not exists public.commercial_sale_amendments(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  kind text not null check(kind in ('payment_plan','price','index','party','assignment','deadline','other')),
  effective_date date not null,
  reason text not null,
  financial_impact numeric(16,2) not null default 0,
  status text not null default 'draft' check(status in ('draft','approved','executed','cancelled')),
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  executed_by uuid references auth.users(id),
  executed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commercial_sale_amendments_sale_idx on public.commercial_sale_amendments(sale_id,status,effective_date desc);

create table if not exists public.commercial_transfer_processes(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  bank_name text,
  financing_type text not null default 'bank_financing' check(financing_type in ('bank_financing','consortium','own_funds','other')),
  requested_amount numeric(16,2) check(requested_amount is null or requested_amount>=0),
  approved_amount numeric(16,2) check(approved_amount is null or approved_amount>=0),
  released_amount numeric(16,2) check(released_amount is null or released_amount>=0),
  expected_release_date date,
  released_at date,
  protocol text,
  status text not null default 'not_started' check(status in ('not_started','documents_pending','submitted','approved','contracting','released','failed','cancelled')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sale_id)
);
create index if not exists commercial_transfer_processes_status_idx on public.commercial_transfer_processes(company_id,project_id,status,expected_release_date);

create table if not exists public.commercial_collection_cases(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  receivable_id uuid references public.receivables(id) on delete set null,
  stage text not null default 'contact' check(stage in ('contact','notice','agreement','legal')),
  status text not null default 'open' check(status in ('open','negotiating','promise','agreement','legal','closed','cancelled')),
  opened_at date not null default current_date,
  last_contact_at date,
  promised_date date,
  promised_amount numeric(16,2) check(promised_amount is null or promised_amount>=0),
  assigned_to uuid references auth.users(id),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commercial_collection_cases_sale_idx on public.commercial_collection_cases(company_id,project_id,status,opened_at desc);
create index if not exists commercial_collection_cases_receivable_idx on public.commercial_collection_cases(receivable_id) where receivable_id is not null;

create table if not exists public.commercial_sale_terminations(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  requested_at date not null default current_date,
  reason text not null,
  paid_amount_snapshot numeric(16,2) not null default 0,
  retention_percent numeric(7,4) not null default 0 check(retention_percent between 0 and 100),
  retention_amount numeric(16,2) not null default 0,
  refund_amount numeric(16,2) not null default 0,
  refund_due_date date,
  refund_payable_id uuid references public.payables(id) on delete set null,
  commission_review_required boolean not null default false,
  status text not null default 'draft' check(status in ('draft','approved','executed','cancelled')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  executed_by uuid references auth.users(id),
  executed_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sale_id)
);
create index if not exists commercial_sale_terminations_status_idx on public.commercial_sale_terminations(company_id,project_id,status,requested_at desc);

-- Vendas históricas ganham automaticamente o comprador principal.
insert into public.commercial_sale_parties(company_id,project_id,sale_id,client_id,role,ownership_percent,is_primary,status,joined_at,notes,created_by)
select s.company_id,s.project_id,s.id,s.client_id,'buyer',100,true,'active',s.sale_date,'Migrado do comprador principal da venda.',s.created_by
from public.sales s
on conflict(sale_id,client_id,role) do nothing;

-- RLS e grants.
do $$ declare t text; begin
  foreach t in array array[
    'commercial_price_tables','commercial_price_table_items','commercial_sale_parties','commercial_sale_contracts',
    'commercial_sale_considerations','commercial_sale_amendments','commercial_transfer_processes','commercial_collection_cases','commercial_sale_terminations'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select,insert,update on public.%I to authenticated',t);
    execute format('create policy incorporation_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''commercial.incorporation.view'') or public.has_company_permission(company_id,''commercial.incorporation.manage'') or public.has_company_permission(company_id,''commercial.incorporation.approve'') or public.has_company_permission(company_id,''commercial.incorporation.finance''))',t);
    execute format('create policy incorporation_insert on public.%I for insert to authenticated with check (public.has_company_permission(company_id,''commercial.incorporation.manage'') or public.has_company_permission(company_id,''commercial.incorporation.finance''))',t);
    execute format('create policy incorporation_update on public.%I for update to authenticated using (public.has_company_permission(company_id,''commercial.incorporation.manage'') or public.has_company_permission(company_id,''commercial.incorporation.approve'') or public.has_company_permission(company_id,''commercial.incorporation.finance'')) with check (public.has_company_permission(company_id,''commercial.incorporation.manage'') or public.has_company_permission(company_id,''commercial.incorporation.approve'') or public.has_company_permission(company_id,''commercial.incorporation.finance''))',t);
  end loop;
end $$;

create or replace function public.commercial_activate_price_table(p_company_id uuid,p_price_table_id uuid,p_user_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare pt public.commercial_price_tables; bad integer; begin
  if not public.has_company_permission(p_company_id,'commercial.incorporation.manage') then raise exception 'Sem permissão para ativar tabela de vendas.'; end if;
  select * into pt from public.commercial_price_tables where id=p_price_table_id and company_id=p_company_id for update;
  if pt.id is null then raise exception 'Tabela de vendas não encontrada.'; end if;
  select count(*) into bad from public.commercial_price_table_items i left join public.units u on u.id=i.unit_id
  where i.price_table_id=pt.id and (u.id is null or u.company_id<>pt.company_id or u.project_id<>pt.project_id);
  if bad>0 then raise exception 'Existem unidades incompatíveis na tabela.'; end if;
  if not exists(select 1 from public.commercial_price_table_items where price_table_id=pt.id) then raise exception 'Inclua ao menos uma unidade antes de ativar.'; end if;
  update public.commercial_price_tables set status='inactive',updated_at=now() where company_id=pt.company_id and project_id=pt.project_id and status='active' and id<>pt.id;
  update public.commercial_price_tables set status='active',activated_at=now(),activated_by=coalesce(p_user_id,auth.uid()),updated_at=now() where id=pt.id;
  update public.units u set list_price=i.list_price,updated_at=now() from public.commercial_price_table_items i where i.price_table_id=pt.id and i.unit_id=u.id and u.company_id=pt.company_id and u.project_id=pt.project_id;
end $$;

grant execute on function public.commercial_activate_price_table(uuid,uuid,uuid) to authenticated;

create or replace function public.commercial_prepare_termination(
  p_company_id uuid,p_sale_id uuid,p_retention_percent numeric,p_refund_due_date date,p_reason text,p_user_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.sales; paid numeric; retention numeric; refund numeric; tid uuid; commission_review boolean; begin
  if not public.has_company_permission(p_company_id,'commercial.incorporation.manage') then raise exception 'Sem permissão para preparar distrato.'; end if;
  if coalesce(p_retention_percent,-1)<0 or p_retention_percent>100 then raise exception 'Percentual de retenção inválido.'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo do distrato.'; end if;
  select * into s from public.sales where id=p_sale_id and company_id=p_company_id for update;
  if s.id is null or s.status<>'active' then raise exception 'Venda ativa não encontrada.'; end if;
  select coalesce(sum(coalesce(r.paid_amount,case when r.status='paid' then coalesce(r.adjusted_amount,r.amount) else 0 end)),0) into paid
  from public.receivables r where r.sale_id=s.id and r.status<>'cancelled';
  retention:=round(paid*p_retention_percent/100,2); refund:=greatest(round(paid-retention,2),0);
  select exists(select 1 from public.commercial_sale_commissions c where c.sale_id=s.id and c.status in ('payable_generated','paid')) into commission_review;
  insert into public.commercial_sale_terminations(company_id,project_id,sale_id,reason,paid_amount_snapshot,retention_percent,retention_amount,refund_amount,refund_due_date,commission_review_required,status,created_by)
  values(s.company_id,s.project_id,s.id,trim(p_reason),paid,p_retention_percent,retention,refund,p_refund_due_date,commission_review,'draft',coalesce(p_user_id,auth.uid()))
  on conflict(sale_id) do update set reason=excluded.reason,paid_amount_snapshot=excluded.paid_amount_snapshot,retention_percent=excluded.retention_percent,retention_amount=excluded.retention_amount,refund_amount=excluded.refund_amount,refund_due_date=excluded.refund_due_date,commission_review_required=excluded.commission_review_required,status=case when public.commercial_sale_terminations.status='executed' then 'executed' else 'draft' end,updated_at=now()
  returning id into tid;
  return tid;
end $$;

grant execute on function public.commercial_prepare_termination(uuid,uuid,numeric,date,text,uuid) to authenticated;

create or replace function public.commercial_execute_termination(p_company_id uuid,p_termination_id uuid,p_user_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.commercial_sale_terminations; s public.sales; c public.clients; payable uuid; actor uuid:=coalesce(p_user_id,auth.uid()); begin
  if not public.has_company_permission(p_company_id,'commercial.incorporation.approve') then raise exception 'Sem permissão para executar distrato.'; end if;
  select * into t from public.commercial_sale_terminations where id=p_termination_id and company_id=p_company_id for update;
  if t.id is null then raise exception 'Distrato não encontrado.'; end if;
  if t.status='executed' then return t.refund_payable_id; end if;
  select * into s from public.sales where id=t.sale_id and company_id=p_company_id for update;
  if s.id is null or s.status<>'active' then raise exception 'A venda não está ativa.'; end if;
  select * into c from public.clients where id=s.client_id and company_id=p_company_id;
  update public.receivables set status='cancelled',notes=concat_ws(E'\n',notes,'Cancelada por distrato '||t.id::text),updated_at=now() where sale_id=s.id and status='open';
  update public.commercial_sale_commissions set status='cancelled',notes=concat_ws(E'\n',notes,'Cancelada por distrato '||t.id::text),updated_at=now() where sale_id=s.id and status in ('planned','approved');
  update public.sales set status='cancelled',notes=concat_ws(E'\n',notes,'Distrato executado em '||current_date::text),updated_at=now() where id=s.id;
  update public.units set status='available',updated_at=now() where id=s.unit_id and company_id=s.company_id;
  if t.refund_amount>0 then
    if t.refund_due_date is null then raise exception 'Informe o vencimento da devolução antes de executar.'; end if;
    insert into public.payables(company_id,project_id,supplier_id,beneficiary_name,beneficiary_tax_id,document,fiscal_class,payment_method,due_date,amount,status,installment_label,notes,origin,source_category,source_system,source_id,created_by)
    values(s.company_id,s.project_id,null,coalesce(c.name,'Comprador'),c.tax_id,'Distrato '||coalesce(s.contract_number,s.number),'distrato',null,t.refund_due_date,t.refund_amount,'open','Devolução distrato','Devolução ao comprador após retenção contratual.','commercial_termination','commercial_termination','commercial_termination',t.id::text,actor)
    on conflict(company_id,source_system,source_id) do update set due_date=excluded.due_date,amount=excluded.amount,beneficiary_name=excluded.beneficiary_name,beneficiary_tax_id=excluded.beneficiary_tax_id,notes=excluded.notes,updated_at=now()
    returning id into payable;
  end if;
  update public.commercial_sale_terminations set status='executed',approved_by=coalesce(approved_by,actor),approved_at=coalesce(approved_at,now()),executed_by=actor,executed_at=now(),refund_payable_id=payable,updated_at=now() where id=t.id;
  insert into public.commercial_sale_contracts(company_id,project_id,sale_id,kind,document_number,effective_date,status,notes,created_by)
  values(s.company_id,s.project_id,s.id,'termination','DISTRATO-'||left(t.id::text,8),current_date,'signed','Registro automático da execução do distrato.',actor);
  return payable;
end $$;

grant execute on function public.commercial_execute_termination(uuid,uuid,uuid) to authenticated;

create or replace function public.commercial_incorporation_summary(p_company_id uuid,p_project_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
with sales_base as (
  select s.id,s.total_amount,s.status
  from public.sales s
  where s.company_id=p_company_id and (p_project_id is null or s.project_id=p_project_id)
    and public.has_company_permission(s.company_id,'commercial.incorporation.view')
), recv as (
  select r.sale_id,
    sum(coalesce(r.adjusted_amount,r.amount)) filter(where r.status<>'cancelled') planned,
    sum(coalesce(r.paid_amount,0)) filter(where r.status<>'cancelled') paid,
    sum(greatest(coalesce(r.adjusted_amount,r.amount)-coalesce(r.paid_amount,0),0)) filter(where r.status='open') open_amount,
    sum(greatest(coalesce(r.adjusted_amount,r.amount)-coalesce(r.paid_amount,0),0)) filter(where r.status='open' and r.due_date<current_date) overdue_amount,
    count(*) filter(where r.status='open' and r.due_date<current_date) overdue_count
  from public.receivables r where r.company_id=p_company_id and (p_project_id is null or r.project_id=p_project_id) group by r.sale_id
), consideration as (
  select sale_id,sum(accepted_value) filter(where status<>'cancelled') barter_amount from public.commercial_sale_considerations where company_id=p_company_id and (p_project_id is null or project_id=p_project_id) group by sale_id
)
select jsonb_build_object(
  'active_sales',count(*) filter(where s.status='active'),
  'cancelled_sales',count(*) filter(where s.status='cancelled'),
  'contracted_amount',coalesce(sum(s.total_amount) filter(where s.status='active'),0),
  'received_amount',coalesce(sum(coalesce(r.paid,0)) filter(where s.status='active'),0),
  'open_amount',coalesce(sum(coalesce(r.open_amount,0)) filter(where s.status='active'),0),
  'overdue_amount',coalesce(sum(coalesce(r.overdue_amount,0)) filter(where s.status='active'),0),
  'overdue_installments',coalesce(sum(coalesce(r.overdue_count,0)) filter(where s.status='active'),0),
  'barter_amount',coalesce(sum(coalesce(c.barter_amount,0)) filter(where s.status='active'),0),
  'repasse_pending',(select count(*) from public.commercial_transfer_processes t where t.company_id=p_company_id and (p_project_id is null or t.project_id=p_project_id) and t.status not in ('released','cancelled')),
  'collection_open',(select count(*) from public.commercial_collection_cases cc where cc.company_id=p_company_id and (p_project_id is null or cc.project_id=p_project_id) and cc.status not in ('closed','cancelled')),
  'terminations_open',(select count(*) from public.commercial_sale_terminations st where st.company_id=p_company_id and (p_project_id is null or st.project_id=p_project_id) and st.status in ('draft','approved'))
) from sales_base s left join recv r on r.sale_id=s.id left join consideration c on c.sale_id=s.id;
$$;

grant execute on function public.commercial_incorporation_summary(uuid,uuid) to authenticated;

create or replace function public.commercial_incorporation_portfolio(p_company_id uuid,p_project_id uuid default null)
returns table(
  sale_id uuid,project_id uuid,sale_number text,contract_number text,sale_date date,total_amount numeric,sale_status text,
  unit_code text,client_name text,received_amount numeric,open_amount numeric,overdue_amount numeric,overdue_count bigint,
  barter_amount numeric,transfer_status text,termination_status text
) language sql stable security invoker set search_path='' as $$
  select s.id,s.project_id,s.number,s.contract_number,s.sale_date,s.total_amount,s.status,u.code,c.name,
    coalesce(sum(coalesce(r.paid_amount,0)) filter(where r.status<>'cancelled'),0),
    coalesce(sum(greatest(coalesce(r.adjusted_amount,r.amount)-coalesce(r.paid_amount,0),0)) filter(where r.status='open'),0),
    coalesce(sum(greatest(coalesce(r.adjusted_amount,r.amount)-coalesce(r.paid_amount,0),0)) filter(where r.status='open' and r.due_date<current_date),0),
    count(r.id) filter(where r.status='open' and r.due_date<current_date),
    coalesce((select sum(sc.accepted_value) from public.commercial_sale_considerations sc where sc.sale_id=s.id and sc.status<>'cancelled'),0),
    coalesce((select tp.status from public.commercial_transfer_processes tp where tp.sale_id=s.id),'not_started'),
    (select st.status from public.commercial_sale_terminations st where st.sale_id=s.id)
  from public.sales s join public.units u on u.id=s.unit_id join public.clients c on c.id=s.client_id
  left join public.receivables r on r.sale_id=s.id
  where s.company_id=p_company_id and (p_project_id is null or s.project_id=p_project_id)
    and public.has_company_permission(s.company_id,'commercial.incorporation.view')
  group by s.id,s.project_id,s.number,s.contract_number,s.sale_date,s.total_amount,s.status,u.code,c.name
  order by s.sale_date desc,s.number desc;
$$;

grant execute on function public.commercial_incorporation_portfolio(uuid,uuid) to authenticated;

commit;
