-- Elos OS — Suprimentos · Orçamentos de Materiais
-- Cotações vinculadas às solicitações aprovadas, com mapa comparativo e custo posto na obra.

begin;

create table if not exists public.procurement_material_quotations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sequence_no integer not null,
  quotation_number text not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft','collecting','analysis','approved','cancelled')),
  award_mode text not null default 'item' check (award_mode in ('item','lot')),
  response_deadline date not null,
  desired_delivery_date date,
  payment_terms text,
  delivery_address text,
  notes text,
  invited_suppliers_count integer not null default 0,
  responses_count integer not null default 0,
  total_awarded_amount numeric(18,2) not null default 0,
  opened_by uuid references auth.users(id),
  opened_at timestamptz,
  analysis_started_by uuid references auth.users(id),
  analysis_started_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_notes text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence_no),
  unique (project_id, quotation_number),
  constraint procurement_material_quotation_sequence_check check (sequence_no > 0),
  constraint procurement_material_quotation_cancel_check check (
    status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null
  )
);

create table if not exists public.procurement_material_quotation_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete cascade,
  request_id uuid not null references public.execution_material_requests(id) on delete restrict,
  request_number text not null,
  needed_date date not null,
  created_at timestamptz not null default now(),
  unique (quotation_id, request_id)
);

create table if not exists public.procurement_material_quotation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete cascade,
  request_id uuid not null references public.execution_material_requests(id) on delete restrict,
  request_item_id uuid not null references public.execution_material_request_items(id) on delete restrict,
  input_id uuid not null references public.engineering_inputs(id) on delete restrict,
  cost_center_service_id uuid references public.engineering_services(id) on delete restrict,
  request_number text not null,
  input_code text not null,
  input_name text not null,
  unit_snapshot text not null,
  category_snapshot text not null,
  cost_center_code text not null,
  cost_center_name text not null,
  requested_quantity numeric(18,6) not null,
  previously_ordered_quantity numeric(18,6) not null default 0,
  quantity_to_quote numeric(18,6) not null,
  best_delivered_unit_cost numeric(18,6),
  best_total_cost numeric(18,2),
  awarded_supplier_id uuid references public.suppliers(id) on delete restrict,
  awarded_offer_item_id uuid,
  awarded_quantity numeric(18,6) not null default 0,
  awarded_unit_cost numeric(18,6),
  awarded_total_cost numeric(18,2) not null default 0,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_id, request_item_id),
  constraint procurement_material_quotation_item_quantity_check check (
    requested_quantity > 0 and previously_ordered_quantity >= 0 and quantity_to_quote > 0 and
    previously_ordered_quantity + quantity_to_quote <= requested_quantity + 0.000001 and
    awarded_quantity >= 0 and awarded_quantity <= quantity_to_quote + 0.000001 and awarded_total_cost >= 0
  )
);

create table if not exists public.procurement_material_quotation_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  status text not null default 'invited' check (status in ('invited','responded','declined','disqualified')),
  sent_at timestamptz,
  responded_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_id, supplier_id)
);

create table if not exists public.procurement_material_quotation_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete cascade,
  quotation_supplier_id uuid not null references public.procurement_material_quotation_suppliers(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  status text not null default 'received' check (status in ('received','declined','disqualified')),
  proposal_number text,
  proposal_date date,
  validity_date date,
  payment_terms text,
  delivery_days integer check (delivery_days is null or delivery_days between 0 and 3650),
  freight_terms text,
  warranty_terms text,
  notes text,
  total_delivered_cost numeric(18,2) not null default 0,
  received_by uuid references auth.users(id),
  received_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (quotation_id, supplier_id)
);

create table if not exists public.procurement_material_quotation_offer_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete cascade,
  offer_id uuid not null references public.procurement_material_quotation_offers(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  quotation_item_id uuid not null references public.procurement_material_quotation_items(id) on delete cascade,
  quantity_offered numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  discount_percent numeric(8,4) not null default 0 check (discount_percent between 0 and 100),
  tax_percent numeric(8,4) not null default 0 check (tax_percent between 0 and 100),
  freight_amount numeric(18,2) not null default 0,
  other_cost_amount numeric(18,2) not null default 0,
  delivered_unit_cost numeric(18,6) not null,
  total_delivered_cost numeric(18,2) not null,
  brand text,
  manufacturer text,
  delivery_days integer check (delivery_days is null or delivery_days between 0 and 3650),
  meets_specification boolean not null default true,
  technical_notes text,
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offer_id, quotation_item_id),
  constraint procurement_material_offer_item_values_check check (
    quantity_offered > 0 and unit_price >= 0 and freight_amount >= 0 and other_cost_amount >= 0 and
    delivered_unit_cost >= 0 and total_delivered_cost >= 0
  )
);

create table if not exists public.procurement_material_quotation_awards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete restrict,
  quotation_item_id uuid not null references public.procurement_material_quotation_items(id) on delete restrict,
  offer_id uuid not null references public.procurement_material_quotation_offers(id) on delete restrict,
  offer_item_id uuid not null references public.procurement_material_quotation_offer_items(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  awarded_quantity numeric(18,6) not null,
  awarded_unit_cost numeric(18,6) not null,
  awarded_total_cost numeric(18,2) not null,
  justification text,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (quotation_id, quotation_item_id),
  constraint procurement_material_award_values_check check (
    awarded_quantity > 0 and awarded_unit_cost >= 0 and awarded_total_cost >= 0
  )
);

alter table public.procurement_material_quotation_items
  drop constraint if exists procurement_material_quotation_items_awarded_offer_item_fk;
alter table public.procurement_material_quotation_items
  add constraint procurement_material_quotation_items_awarded_offer_item_fk
  foreign key (awarded_offer_item_id) references public.procurement_material_quotation_offer_items(id) on delete restrict;

create table if not exists public.procurement_material_quotation_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  document_type text not null default 'other' check (document_type in ('request','proposal','technical','approval','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (quotation_id, storage_path)
);

create table if not exists public.procurement_material_quotation_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quotation_id uuid not null references public.procurement_material_quotations(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists procurement_material_quotations_project_status_idx on public.procurement_material_quotations(project_id,status,response_deadline,created_at desc);
create index if not exists procurement_material_quotation_items_quote_idx on public.procurement_material_quotation_items(quotation_id,sort_order);
create index if not exists procurement_material_quotation_items_request_idx on public.procurement_material_quotation_items(request_item_id);
create index if not exists procurement_material_quotation_suppliers_quote_idx on public.procurement_material_quotation_suppliers(quotation_id,status);
create index if not exists procurement_material_quotation_offers_quote_idx on public.procurement_material_quotation_offers(quotation_id,status);
create index if not exists procurement_material_offer_items_compare_idx on public.procurement_material_quotation_offer_items(quotation_item_id,meets_specification,total_delivered_cost);
create index if not exists procurement_material_awards_quote_idx on public.procurement_material_quotation_awards(quotation_id,supplier_id);
create index if not exists procurement_material_documents_quote_idx on public.procurement_material_quotation_documents(quotation_id,uploaded_at);

insert into public.permissions (key,module,action,description) values
  ('procurement.quotations.view','procurement_quotations','view','Visualizar orçamentos e mapas de cotação de materiais'),
  ('procurement.quotations.manage','procurement_quotations','manage','Criar cotações e registrar propostas de fornecedores'),
  ('procurement.quotations.approve','procurement_quotations','approve','Aprovar fornecedores vencedores por item ou lote'),
  ('procurement.quotations.cancel','procurement_quotations','cancel','Cancelar processos de cotação com justificativa')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('procurement.quotations.view'),('procurement.quotations.manage'),('procurement.quotations.approve'),('procurement.quotations.cancel')) p(permission_key)
where r.key in ('owner','admin','director','procurement')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'procurement.quotations.view',true from public.roles r
where r.key in ('engineering','finance','field','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.procurement_material_quotations enable row level security;
alter table public.procurement_material_quotation_requests enable row level security;
alter table public.procurement_material_quotation_items enable row level security;
alter table public.procurement_material_quotation_suppliers enable row level security;
alter table public.procurement_material_quotation_offers enable row level security;
alter table public.procurement_material_quotation_offer_items enable row level security;
alter table public.procurement_material_quotation_awards enable row level security;
alter table public.procurement_material_quotation_documents enable row level security;
alter table public.procurement_material_quotation_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'procurement_material_quotations','procurement_material_quotation_requests','procurement_material_quotation_items',
    'procurement_material_quotation_suppliers','procurement_material_quotation_offers','procurement_material_quotation_offer_items',
    'procurement_material_quotation_awards','procurement_material_quotation_documents','procurement_material_quotation_audit'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''procurement.quotations.view'') or public.has_company_permission(company_id,''procurement.quotations.manage'') or public.has_company_permission(company_id,''procurement.quotations.approve''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''procurement.quotations.manage'') or public.has_company_permission(company_id,''procurement.quotations.approve'')) with check (public.has_company_permission(company_id,''procurement.quotations.manage'') or public.has_company_permission(company_id,''procurement.quotations.approve''))',t,t);
  end loop;
end $$;

create or replace function public.refresh_procurement_material_quotation(p_quotation_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
begin
  update public.procurement_material_quotation_items qi
  set best_delivered_unit_cost=x.best_unit,
      best_total_cost=x.best_total,
      updated_at=now()
  from (
    select quotation_item_id,min(delivered_unit_cost) best_unit,min(total_delivered_cost) best_total
    from public.procurement_material_quotation_offer_items oi
    join public.procurement_material_quotation_offers o on o.id=oi.offer_id
    where oi.quotation_id=p_quotation_id and oi.meets_specification and o.status='received'
    group by quotation_item_id
  ) x where qi.id=x.quotation_item_id;

  update public.procurement_material_quotation_items qi
  set best_delivered_unit_cost=null,best_total_cost=null,updated_at=now()
  where qi.quotation_id=p_quotation_id and not exists(
    select 1 from public.procurement_material_quotation_offer_items oi
    join public.procurement_material_quotation_offers o on o.id=oi.offer_id
    where oi.quotation_item_id=qi.id and oi.meets_specification and o.status='received'
  );

  update public.procurement_material_quotations q
  set invited_suppliers_count=(select count(*) from public.procurement_material_quotation_suppliers qs where qs.quotation_id=q.id),
      responses_count=(select count(*) from public.procurement_material_quotation_suppliers qs where qs.quotation_id=q.id and qs.status='responded'),
      total_awarded_amount=(select coalesce(sum(a.awarded_total_cost),0) from public.procurement_material_quotation_awards a where a.quotation_id=q.id),
      updated_at=now()
  where q.id=p_quotation_id;
end; $$;

create or replace function public.save_procurement_material_quotation(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_title text,p_award_mode text,
  p_response_deadline date,p_desired_delivery_date date,p_payment_terms text,p_delivery_address text,p_notes text,
  p_items jsonb,p_suppliers jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  q public.procurement_material_quotations%rowtype; request_row public.execution_material_requests%rowtype;
  request_item public.execution_material_request_items%rowtype; supplier public.suppliers%rowtype;
  item jsonb; supplier_item jsonb; resolved_id uuid; seq integer; n integer:=0; sn integer:=0; qty numeric;
begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.manage') then raise exception 'Sem permissão para criar ou editar cotações.'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Informe o título da cotação.'; end if;
  if p_award_mode not in ('item','lot') then raise exception 'Forma de fechamento inválida.'; end if;
  if p_response_deadline is null or p_response_deadline<current_date then raise exception 'Informe uma data-limite igual ou posterior a hoje.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Inclua ao menos um item de solicitação.'; end if;
  if jsonb_typeof(p_suppliers)<>'array' or jsonb_array_length(p_suppliers)=0 then raise exception 'Convide ao menos um fornecedor ativo.'; end if;

  if p_quotation_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':material-quotations'));
    select coalesce(max(sequence_no),0)+1 into seq from public.procurement_material_quotations where project_id=p_project_id;
    insert into public.procurement_material_quotations(company_id,project_id,sequence_no,quotation_number,title,award_mode,response_deadline,desired_delivery_date,payment_terms,delivery_address,notes,created_by,updated_by)
    values(p_company_id,p_project_id,seq,'COT-'||lpad(seq::text,4,'0'),trim(p_title),p_award_mode,p_response_deadline,p_desired_delivery_date,nullif(trim(coalesce(p_payment_terms,'')),''),nullif(trim(coalesce(p_delivery_address,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()) returning id into resolved_id;
  else
    select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
    if q.id is null then raise exception 'Cotação não encontrada.'; end if;
    if q.status<>'draft' then raise exception 'Somente cotações em elaboração podem ser editadas.'; end if;
    resolved_id:=q.id;
    update public.procurement_material_quotations set title=trim(p_title),award_mode=p_award_mode,response_deadline=p_response_deadline,desired_delivery_date=p_desired_delivery_date,payment_terms=nullif(trim(coalesce(p_payment_terms,'')),''),delivery_address=nullif(trim(coalesce(p_delivery_address,'')),''),notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=resolved_id;
    delete from public.procurement_material_quotation_requests where quotation_id=resolved_id;
    delete from public.procurement_material_quotation_items where quotation_id=resolved_id;
    delete from public.procurement_material_quotation_suppliers where quotation_id=resolved_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    qty:=coalesce(nullif(item->>'quantity_to_quote','')::numeric,0);
    if qty<=0 then continue; end if;
    select ri.* into request_item from public.execution_material_request_items ri
    join public.execution_material_requests r on r.id=ri.request_id
    where ri.id=nullif(item->>'request_item_id','')::uuid and ri.company_id=p_company_id and ri.project_id=p_project_id and r.status in ('approved','partially_ordered');
    if request_item.id is null then raise exception 'Um dos itens não pertence a uma solicitação aprovada.'; end if;
    if qty>request_item.requested_quantity-request_item.ordered_quantity+0.000001 then raise exception 'A quantidade cotada de % ultrapassa o saldo pendente.',request_item.input_code; end if;
    select * into request_row from public.execution_material_requests where id=request_item.request_id;
    insert into public.procurement_material_quotation_requests(company_id,project_id,quotation_id,request_id,request_number,needed_date)
    values(p_company_id,p_project_id,resolved_id,request_row.id,request_row.request_number,request_row.needed_date) on conflict(quotation_id,request_id) do nothing;
    n:=n+1;
    insert into public.procurement_material_quotation_items(company_id,project_id,quotation_id,request_id,request_item_id,input_id,cost_center_service_id,request_number,input_code,input_name,unit_snapshot,category_snapshot,cost_center_code,cost_center_name,requested_quantity,previously_ordered_quantity,quantity_to_quote,notes,sort_order)
    values(p_company_id,p_project_id,resolved_id,request_item.request_id,request_item.id,request_item.input_id,request_item.cost_center_service_id,request_row.request_number,request_item.input_code,request_item.input_name,request_item.unit_snapshot,request_item.category_snapshot,request_item.cost_center_code,request_item.cost_center_name,request_item.requested_quantity,request_item.ordered_quantity,qty,nullif(trim(coalesce(item->>'notes','')),''),n);
  end loop;
  if n=0 then raise exception 'Informe ao menos uma quantidade válida para cotação.'; end if;

  for supplier_item in select value from jsonb_array_elements(p_suppliers) loop
    select * into supplier from public.suppliers s where s.id=nullif(supplier_item->>'supplier_id','')::uuid and s.company_id=p_company_id and s.status='active';
    if supplier.id is null then raise exception 'Um dos fornecedores convidados não está ativo.'; end if;
    sn:=sn+1;
    insert into public.procurement_material_quotation_suppliers(company_id,project_id,quotation_id,supplier_id,supplier_name,contact_name,contact_email,contact_phone,notes)
    values(p_company_id,p_project_id,resolved_id,supplier.id,coalesce(nullif(trim(supplier.trade_name),''),supplier.legal_name),nullif(trim(coalesce(supplier_item->>'contact_name','')),''),nullif(trim(coalesce(supplier_item->>'contact_email','')),''),nullif(trim(coalesce(supplier_item->>'contact_phone','')),''),nullif(trim(coalesce(supplier_item->>'notes','')),''));
  end loop;
  if sn=0 then raise exception 'Convide ao menos um fornecedor.'; end if;
  perform public.refresh_procurement_material_quotation(resolved_id);
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,new_status,changed_by)
  values(p_company_id,p_project_id,resolved_id,case when p_quotation_id is null then 'created' else 'updated' end,'draft',auth.uid());
  return resolved_id;
end; $$;

create or replace function public.open_procurement_material_quotation(p_company_id uuid,p_project_id uuid,p_quotation_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare q public.procurement_material_quotations%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.manage') then raise exception 'Sem permissão para abrir a cotação.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
  if q.id is null or q.status<>'draft' then raise exception 'Cotação não disponível para abertura.'; end if;
  if not exists(select 1 from public.procurement_material_quotation_items where quotation_id=q.id) then raise exception 'A cotação não possui itens.'; end if;
  if not exists(select 1 from public.procurement_material_quotation_suppliers where quotation_id=q.id) then raise exception 'A cotação não possui fornecedores convidados.'; end if;
  update public.procurement_material_quotations set status='collecting',opened_by=auth.uid(),opened_at=now(),updated_by=auth.uid(),updated_at=now() where id=q.id;
  update public.procurement_material_quotation_suppliers set sent_at=coalesce(sent_at,now()),updated_at=now() where quotation_id=q.id;
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,q.id,'opened','draft','collecting',auth.uid());
  return 'collecting';
end; $$;

create or replace function public.save_procurement_material_supplier_offer(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_supplier_id uuid,
  p_proposal_number text,p_proposal_date date,p_validity_date date,p_payment_terms text,p_delivery_days integer,
  p_freight_terms text,p_warranty_terms text,p_notes text,p_items jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  q public.procurement_material_quotations%rowtype; qs public.procurement_material_quotation_suppliers%rowtype;
  qi public.procurement_material_quotation_items%rowtype; item jsonb; offer_id uuid; qty numeric; price numeric; discount_pct numeric; tax_pct numeric;
  freight numeric; other_cost numeric; subtotal numeric; total numeric; n integer:=0; offer_total numeric:=0;
begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.manage') then raise exception 'Sem permissão para registrar propostas.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
  if q.id is null or q.status<>'collecting' then raise exception 'A cotação não está recebendo propostas.'; end if;
  select * into qs from public.procurement_material_quotation_suppliers where quotation_id=q.id and supplier_id=p_supplier_id;
  if qs.id is null then raise exception 'O fornecedor não foi convidado para esta cotação.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Informe os preços propostos.'; end if;

  insert into public.procurement_material_quotation_offers(company_id,project_id,quotation_id,quotation_supplier_id,supplier_id,status,proposal_number,proposal_date,validity_date,payment_terms,delivery_days,freight_terms,warranty_terms,notes,received_by,updated_by)
  values(p_company_id,p_project_id,q.id,qs.id,p_supplier_id,'received',nullif(trim(coalesce(p_proposal_number,'')),''),p_proposal_date,p_validity_date,nullif(trim(coalesce(p_payment_terms,'')),''),p_delivery_days,nullif(trim(coalesce(p_freight_terms,'')),''),nullif(trim(coalesce(p_warranty_terms,'')),''),nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid())
  on conflict(quotation_id,supplier_id) do update set status='received',proposal_number=excluded.proposal_number,proposal_date=excluded.proposal_date,validity_date=excluded.validity_date,payment_terms=excluded.payment_terms,delivery_days=excluded.delivery_days,freight_terms=excluded.freight_terms,warranty_terms=excluded.warranty_terms,notes=excluded.notes,updated_by=auth.uid(),updated_at=now()
  returning id into offer_id;
  delete from public.procurement_material_quotation_offer_items where offer_id=offer_id;

  for item in select value from jsonb_array_elements(p_items) loop
    qty:=coalesce(nullif(item->>'quantity_offered','')::numeric,0); price:=coalesce(nullif(item->>'unit_price','')::numeric,0);
    if qty<=0 then continue; end if;
    select * into qi from public.procurement_material_quotation_items where id=nullif(item->>'quotation_item_id','')::uuid and quotation_id=q.id;
    if qi.id is null then raise exception 'Um dos itens não pertence à cotação.'; end if;
    if qty>qi.quantity_to_quote+0.000001 then raise exception 'A quantidade ofertada de % ultrapassa a quantidade solicitada.',qi.input_code; end if;
    discount_pct:=greatest(least(coalesce(nullif(item->>'discount_percent','')::numeric,0),100),0);
    tax_pct:=greatest(least(coalesce(nullif(item->>'tax_percent','')::numeric,0),100),0);
    freight:=greatest(coalesce(nullif(item->>'freight_amount','')::numeric,0),0);
    other_cost:=greatest(coalesce(nullif(item->>'other_cost_amount','')::numeric,0),0);
    subtotal:=qty*price*(1-discount_pct/100);
    total:=round(subtotal*(1+tax_pct/100)+freight+other_cost,2);
    n:=n+1; offer_total:=offer_total+total;
    insert into public.procurement_material_quotation_offer_items(company_id,project_id,quotation_id,offer_id,supplier_id,quotation_item_id,quantity_offered,unit_price,discount_percent,tax_percent,freight_amount,other_cost_amount,delivered_unit_cost,total_delivered_cost,brand,manufacturer,delivery_days,meets_specification,technical_notes)
    values(p_company_id,p_project_id,q.id,offer_id,p_supplier_id,qi.id,qty,price,discount_pct,tax_pct,freight,other_cost,case when qty>0 then round(total/qty,6) else 0 end,total,nullif(trim(coalesce(item->>'brand','')),''),nullif(trim(coalesce(item->>'manufacturer','')),''),nullif(item->>'delivery_days','')::integer,coalesce((item->>'meets_specification')::boolean,true),nullif(trim(coalesce(item->>'technical_notes','')),''));
  end loop;
  if n=0 then raise exception 'Informe ao menos um item com quantidade ofertada.'; end if;
  update public.procurement_material_quotation_offers set total_delivered_cost=offer_total,updated_at=now() where id=offer_id;
  update public.procurement_material_quotation_suppliers set status='responded',responded_at=now(),updated_at=now() where id=qs.id;
  perform public.refresh_procurement_material_quotation(q.id);
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,previous_status,new_status,details,changed_by) values(p_company_id,p_project_id,q.id,'offer_received',q.status,q.status,jsonb_build_object('supplier_id',p_supplier_id,'offer_id',offer_id,'total',offer_total),auth.uid());
  return offer_id;
end; $$;

create or replace function public.start_procurement_material_quotation_analysis(p_company_id uuid,p_project_id uuid,p_quotation_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare q public.procurement_material_quotations%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.manage') then raise exception 'Sem permissão para iniciar a análise.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
  if q.id is null or q.status<>'collecting' then raise exception 'Cotação não disponível para análise.'; end if;
  if not exists(select 1 from public.procurement_material_quotation_offers where quotation_id=q.id and status='received') then raise exception 'Registre ao menos uma proposta antes da análise.'; end if;
  update public.procurement_material_quotations set status='analysis',analysis_started_by=auth.uid(),analysis_started_at=now(),updated_by=auth.uid(),updated_at=now() where id=q.id;
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,q.id,'analysis_started','collecting','analysis',auth.uid());
  return 'analysis';
end; $$;

create or replace function public.approve_procurement_material_quotation(
  p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_approval_notes text,p_awards jsonb
) returns text language plpgsql security definer set search_path=public as $$
declare
  q public.procurement_material_quotations%rowtype; qi public.procurement_material_quotation_items%rowtype;
  oi public.procurement_material_quotation_offer_items%rowtype; award jsonb; n integer:=0; total numeric:=0; lot_supplier uuid:=null;
begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.approve') then raise exception 'Sem permissão para aprovar a cotação.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
  if q.id is null or q.status<>'analysis' then raise exception 'Cotação não disponível para aprovação.'; end if;
  if jsonb_typeof(p_awards)<>'array' then raise exception 'Seleção de vencedores inválida.'; end if;
  delete from public.procurement_material_quotation_awards where quotation_id=q.id;
  update public.procurement_material_quotation_offer_items set is_selected=false where quotation_id=q.id;
  update public.procurement_material_quotation_items set awarded_supplier_id=null,awarded_offer_item_id=null,awarded_quantity=0,awarded_unit_cost=null,awarded_total_cost=0 where quotation_id=q.id;

  for award in select value from jsonb_array_elements(p_awards) loop
    select * into qi from public.procurement_material_quotation_items where id=nullif(award->>'quotation_item_id','')::uuid and quotation_id=q.id;
    if qi.id is null then raise exception 'Um dos itens não pertence à cotação.'; end if;
    select oi.* into oi from public.procurement_material_quotation_offer_items oi
    join public.procurement_material_quotation_offers o on o.id=oi.offer_id
    where oi.id=nullif(award->>'offer_item_id','')::uuid and oi.quotation_item_id=qi.id and oi.meets_specification and o.status='received';
    if oi.id is null then raise exception 'Selecione uma proposta tecnicamente válida para %.',qi.input_code; end if;
    if oi.quantity_offered+0.000001<qi.quantity_to_quote then raise exception 'A proposta escolhida não atende toda a quantidade de %.',qi.input_code; end if;
    if q.award_mode='lot' then
      if lot_supplier is null then lot_supplier:=oi.supplier_id; elsif lot_supplier<>oi.supplier_id then raise exception 'No fechamento por lote, todos os itens devem ser atribuídos ao mesmo fornecedor.'; end if;
    end if;
    n:=n+1; total:=total+round(qi.quantity_to_quote*oi.delivered_unit_cost,2);
    insert into public.procurement_material_quotation_awards(company_id,project_id,quotation_id,quotation_item_id,offer_id,offer_item_id,supplier_id,awarded_quantity,awarded_unit_cost,awarded_total_cost,justification,approved_by)
    values(p_company_id,p_project_id,q.id,qi.id,oi.offer_id,oi.id,oi.supplier_id,qi.quantity_to_quote,oi.delivered_unit_cost,round(qi.quantity_to_quote*oi.delivered_unit_cost,2),nullif(trim(coalesce(award->>'justification','')),''),auth.uid());
    update public.procurement_material_quotation_offer_items set is_selected=true where id=oi.id;
    update public.procurement_material_quotation_items set awarded_supplier_id=oi.supplier_id,awarded_offer_item_id=oi.id,awarded_quantity=qi.quantity_to_quote,awarded_unit_cost=oi.delivered_unit_cost,awarded_total_cost=round(qi.quantity_to_quote*oi.delivered_unit_cost,2),updated_at=now() where id=qi.id;
  end loop;
  if n<>(select count(*) from public.procurement_material_quotation_items where quotation_id=q.id) then raise exception 'Selecione um vencedor para todos os itens.'; end if;
  update public.procurement_material_quotations set status='approved',total_awarded_amount=total,approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_approval_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=q.id;
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,previous_status,new_status,reason,details,changed_by) values(p_company_id,p_project_id,q.id,'approved','analysis','approved',nullif(trim(coalesce(p_approval_notes,'')),''),jsonb_build_object('total_awarded_amount',total,'award_mode',q.award_mode),auth.uid());
  return 'approved';
end; $$;

create or replace function public.cancel_procurement_material_quotation(p_company_id uuid,p_project_id uuid,p_quotation_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare q public.procurement_material_quotations%rowtype; begin
  if not public.has_company_permission(p_company_id,'procurement.quotations.cancel') then raise exception 'Sem permissão para cancelar a cotação.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into q from public.procurement_material_quotations where id=p_quotation_id and company_id=p_company_id and project_id=p_project_id for update;
  if q.id is null or q.status in ('approved','cancelled') then raise exception 'Cotação não disponível para cancelamento.'; end if;
  update public.procurement_material_quotations set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=q.id;
  insert into public.procurement_material_quotation_audit(company_id,project_id,quotation_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,q.id,'cancelled',q.status,'cancelled',trim(p_reason),auth.uid());
  return 'cancelled';
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('material-quotation-documents','material-quotation-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists material_quotation_documents_select on storage.objects;
create policy material_quotation_documents_select on storage.objects for select to authenticated using(bucket_id='material-quotation-documents' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists material_quotation_documents_insert on storage.objects;
create policy material_quotation_documents_insert on storage.objects for insert to authenticated with check(bucket_id='material-quotation-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'procurement.quotations.manage'));
drop policy if exists material_quotation_documents_delete on storage.objects;
create policy material_quotation_documents_delete on storage.objects for delete to authenticated using(bucket_id='material-quotation-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'procurement.quotations.manage'));

grant select,insert,update,delete on public.procurement_material_quotations,public.procurement_material_quotation_requests,public.procurement_material_quotation_items,public.procurement_material_quotation_suppliers,public.procurement_material_quotation_offers,public.procurement_material_quotation_offer_items,public.procurement_material_quotation_awards,public.procurement_material_quotation_documents,public.procurement_material_quotation_audit to authenticated;
grant execute on function public.refresh_procurement_material_quotation(uuid) to authenticated;
grant execute on function public.save_procurement_material_quotation(uuid,uuid,uuid,text,text,date,date,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.open_procurement_material_quotation(uuid,uuid,uuid) to authenticated;
grant execute on function public.save_procurement_material_supplier_offer(uuid,uuid,uuid,uuid,text,date,date,text,integer,text,text,text,jsonb) to authenticated;
grant execute on function public.start_procurement_material_quotation_analysis(uuid,uuid,uuid) to authenticated;
grant execute on function public.approve_procurement_material_quotation(uuid,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.cancel_procurement_material_quotation(uuid,uuid,uuid,text) to authenticated;

commit;
