-- Elos OS — Financeiro · Notas Eletrônicas · XML
-- Importação de NF-e, conferência fiscal/comercial e geração controlada do Contas a Pagar.

begin;

create table if not exists public.finance_electronic_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  legal_entity_id uuid references public.legal_entities(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  order_id uuid references public.procurement_purchase_orders(id) on delete restrict,
  receipt_id uuid references public.procurement_material_receipts(id) on delete restrict,
  sequence_no integer not null,
  registry_number text not null,
  status text not null default 'review' check(status in ('review','approved','rejected','cancelled')),
  validation_status text not null default 'attention' check(validation_status in ('ready','attention','blocked')),
  access_key text not null,
  model text not null,
  series text,
  invoice_number text not null,
  issue_date date not null,
  issue_datetime timestamptz,
  operation_nature text,
  issuer_tax_id text not null,
  issuer_name text not null,
  issuer_trade_name text,
  issuer_state_registration text,
  recipient_tax_id text,
  recipient_name text,
  products_amount numeric(18,2) not null default 0,
  freight_amount numeric(18,2) not null default 0,
  insurance_amount numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  import_tax_amount numeric(18,2) not null default 0,
  ipi_amount numeric(18,2) not null default 0,
  pis_amount numeric(18,2) not null default 0,
  cofins_amount numeric(18,2) not null default 0,
  icms_amount numeric(18,2) not null default 0,
  other_amount numeric(18,2) not null default 0,
  invoice_total numeric(18,2) not null,
  payment_total numeric(18,2) not null default 0,
  item_count integer not null default 0,
  mapped_item_count integer not null default 0,
  divergence_count integer not null default 0,
  xml_storage_path text not null,
  xml_file_name text not null,
  xml_hash text not null,
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  approval_notes text,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,sequence_no),
  unique(project_id,registry_number),
  unique(access_key),
  unique(xml_hash),
  constraint finance_electronic_invoice_access_key_check check(access_key ~ '^[0-9]{44}$'),
  constraint finance_electronic_invoice_values_check check(
    products_amount>=0 and freight_amount>=0 and insurance_amount>=0 and discount_amount>=0 and
    import_tax_amount>=0 and ipi_amount>=0 and pis_amount>=0 and cofins_amount>=0 and icms_amount>=0 and
    other_amount>=0 and invoice_total>=0 and payment_total>=0 and item_count>=0 and mapped_item_count>=0 and divergence_count>=0
  ),
  constraint finance_electronic_invoice_reject_check check(status<>'rejected' or nullif(trim(coalesce(rejection_reason,'')),'') is not null),
  constraint finance_electronic_invoice_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.finance_electronic_invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_electronic_invoices(id) on delete cascade,
  line_number integer not null,
  supplier_product_code text,
  ean text,
  description text not null,
  ncm text,
  cfop text,
  unit_snapshot text,
  quantity numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  gross_amount numeric(18,2) not null,
  discount_amount numeric(18,2) not null default 0,
  freight_amount numeric(18,2) not null default 0,
  other_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null,
  icms_amount numeric(18,2) not null default 0,
  ipi_amount numeric(18,2) not null default 0,
  pis_amount numeric(18,2) not null default 0,
  cofins_amount numeric(18,2) not null default 0,
  input_id uuid references public.engineering_inputs(id) on delete restrict,
  cost_center_service_id uuid references public.engineering_services(id) on delete restrict,
  order_item_id uuid references public.procurement_purchase_order_items(id) on delete restrict,
  receipt_item_id uuid references public.procurement_material_receipt_items(id) on delete restrict,
  mapping_status text not null default 'unmapped' check(mapping_status in ('matched','unmapped','divergent')),
  order_quantity numeric(18,6),
  order_unit_price numeric(18,6),
  quantity_variance numeric(18,6),
  unit_price_variance numeric(18,6),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(invoice_id,line_number),
  constraint finance_electronic_invoice_item_values_check check(
    quantity>0 and unit_price>=0 and gross_amount>=0 and discount_amount>=0 and freight_amount>=0 and other_amount>=0 and total_amount>=0 and
    icms_amount>=0 and ipi_amount>=0 and pis_amount>=0 and cofins_amount>=0
  )
);

create table if not exists public.finance_electronic_invoice_installments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_electronic_invoices(id) on delete cascade,
  sequence_no integer not null,
  installment_label text not null,
  due_date date not null,
  amount numeric(18,2) not null,
  payment_method text,
  payable_id uuid references public.payables(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(invoice_id,sequence_no),
  constraint finance_electronic_invoice_installment_value_check check(amount>=0)
);

create table if not exists public.finance_electronic_invoice_divergences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_electronic_invoices(id) on delete cascade,
  invoice_item_id uuid references public.finance_electronic_invoice_items(id) on delete cascade,
  divergence_type text not null check(divergence_type in ('recipient','supplier','order','receipt','item_mapping','quantity','price','total','payment','duplicate','other')),
  severity text not null default 'medium' check(severity in ('low','medium','high','critical')),
  title text not null,
  description text not null,
  expected_value text,
  actual_value text,
  status text not null default 'open' check(status in ('open','resolved','waived')),
  resolution_notes text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_electronic_invoice_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_electronic_invoices(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists finance_electronic_invoices_project_status_idx on public.finance_electronic_invoices(project_id,status,issue_date desc);
create index if not exists finance_electronic_invoices_supplier_idx on public.finance_electronic_invoices(company_id,supplier_id,issue_date desc);
create index if not exists finance_electronic_invoices_order_idx on public.finance_electronic_invoices(order_id,status);
create index if not exists finance_electronic_invoice_items_invoice_idx on public.finance_electronic_invoice_items(invoice_id,line_number);
create index if not exists finance_electronic_invoice_items_input_idx on public.finance_electronic_invoice_items(project_id,input_id);
create index if not exists finance_electronic_invoice_installments_idx on public.finance_electronic_invoice_installments(invoice_id,due_date);
create index if not exists finance_electronic_invoice_divergences_idx on public.finance_electronic_invoice_divergences(invoice_id,status,severity);

insert into public.permissions(key,module,action,description) values
  ('finance.invoices.view','finance_invoices','view','Visualizar notas eletrônicas importadas por XML'),
  ('finance.invoices.manage','finance_invoices','manage','Importar XML e vincular itens, pedidos e recebimentos'),
  ('finance.invoices.approve','finance_invoices','approve','Resolver divergências e aprovar notas eletrônicas'),
  ('finance.invoices.cancel','finance_invoices','cancel','Cancelar notas eletrônicas não aprovadas')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values
  ('finance.invoices.view'),('finance.invoices.manage'),('finance.invoices.approve'),('finance.invoices.cancel'))p(permission_key)
where r.key in('owner','admin','director','finance') on conflict(role_id,permission_key) do update set allowed=excluded.allowed;
insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'finance.invoices.view',true from public.roles r where r.key in('procurement','engineering','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.finance_electronic_invoices enable row level security;
alter table public.finance_electronic_invoice_items enable row level security;
alter table public.finance_electronic_invoice_installments enable row level security;
alter table public.finance_electronic_invoice_divergences enable row level security;
alter table public.finance_electronic_invoice_audit enable row level security;

do $$ declare t text; begin
  foreach t in array array['finance_electronic_invoices','finance_electronic_invoice_items','finance_electronic_invoice_installments','finance_electronic_invoice_divergences','finance_electronic_invoice_audit'] loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using(public.has_company_permission(company_id,''finance.invoices.view'') or public.has_company_permission(company_id,''finance.invoices.manage'') or public.has_company_permission(company_id,''finance.invoices.approve''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using(public.has_company_permission(company_id,''finance.invoices.manage'') or public.has_company_permission(company_id,''finance.invoices.approve'')) with check(public.has_company_permission(company_id,''finance.invoices.manage'') or public.has_company_permission(company_id,''finance.invoices.approve''))',t,t);
  end loop;
end $$;

create or replace function public.refresh_finance_electronic_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare open_high integer; all_open integer; total_items integer; mapped_items integer; payment_sum numeric; begin
  select count(*),count(*) filter(where input_id is not null) into total_items,mapped_items
  from public.finance_electronic_invoice_items where invoice_id=p_invoice_id;
  select count(*) filter(where status='open' and severity in('high','critical')),count(*) filter(where status='open')
  into open_high,all_open from public.finance_electronic_invoice_divergences where invoice_id=p_invoice_id;
  select coalesce(sum(amount),0) into payment_sum from public.finance_electronic_invoice_installments where invoice_id=p_invoice_id;
  update public.finance_electronic_invoices set
    item_count=total_items,mapped_item_count=mapped_items,divergence_count=all_open,payment_total=payment_sum,
    validation_status=case when open_high>0 then 'blocked' when mapped_items<total_items or all_open>0 then 'attention' else 'ready' end,
    updated_at=now()
  where id=p_invoice_id;
end; $$;

create or replace function public.save_finance_electronic_invoice(
  p_company_id uuid,p_project_id uuid,p_supplier_id uuid,p_order_id uuid,p_receipt_id uuid,
  p_xml_storage_path text,p_xml_file_name text,p_xml_hash text,p_payload jsonb,p_items jsonb,p_installments jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  project_row public.projects%rowtype; entity_row public.legal_entities%rowtype; supplier_row public.suppliers%rowtype;
  order_row public.procurement_purchase_orders%rowtype; receipt_row public.procurement_material_receipts%rowtype;
  input_row public.engineering_inputs%rowtype; order_item public.procurement_purchase_order_items%rowtype; receipt_item public.procurement_material_receipt_items%rowtype;
  item jsonb; installment jsonb; invoice_id uuid; invoice_item_id uuid; seq integer; item_index integer:=0; installment_index integer:=0;
  payment_sum numeric:=0; invoice_total numeric; xml_qty numeric; xml_price numeric; quantity_diff numeric; price_diff numeric;
  issuer_tax text; recipient_tax text; entity_tax text; supplier_tax text; access_key text;
begin
  if not public.has_company_permission(p_company_id,'finance.invoices.manage') then raise exception 'Sem permissão para importar notas eletrônicas.'; end if;
  select * into project_row from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived';
  if project_row.id is null then raise exception 'Obra inválida.'; end if;
  select * into entity_row from public.legal_entities where id=project_row.legal_entity_id and company_id=p_company_id and status='active';
  if entity_row.id is null then raise exception 'A obra precisa estar vinculada a uma empresa/SPE fiscal ativa.'; end if;
  select * into supplier_row from public.suppliers where id=p_supplier_id and company_id=p_company_id and status='active';
  if supplier_row.id is null then raise exception 'Fornecedor inválido ou inativo.'; end if;

  access_key:=regexp_replace(coalesce(p_payload->>'access_key',''),'[^0-9]','','g');
  issuer_tax:=regexp_replace(coalesce(p_payload#>>'{issuer,tax_id}',''),'[^0-9]','','g');
  recipient_tax:=regexp_replace(coalesce(p_payload#>>'{recipient,tax_id}',''),'[^0-9]','','g');
  entity_tax:=regexp_replace(coalesce(entity_row.cnpj,''),'[^0-9]','','g');
  supplier_tax:=regexp_replace(coalesce(supplier_row.tax_id,''),'[^0-9]','','g');
  invoice_total:=coalesce(nullif(p_payload#>>'{totals,invoice}','')::numeric,0);
  if length(access_key)<>44 then raise exception 'A chave de acesso da NF-e é inválida.'; end if;
  if exists(select 1 from public.finance_electronic_invoices where access_key=access_key) then raise exception 'Esta NF-e já foi importada.'; end if;
  if exists(select 1 from public.finance_electronic_invoices where xml_hash=p_xml_hash) then raise exception 'Este arquivo XML já foi importado.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'A NF-e não possui itens válidos.'; end if;

  if p_order_id is not null then
    select * into order_row from public.procurement_purchase_orders where id=p_order_id and company_id=p_company_id and project_id=p_project_id and status not in('draft','cancelled');
    if order_row.id is null then raise exception 'Pedido de compra inválido.'; end if;
  end if;
  if p_receipt_id is not null then
    select * into receipt_row from public.procurement_material_receipts where id=p_receipt_id and company_id=p_company_id and project_id=p_project_id and status='approved';
    if receipt_row.id is null then raise exception 'Recebimento inválido ou ainda não aprovado.'; end if;
    if p_order_id is null then p_order_id:=receipt_row.order_id; select * into order_row from public.procurement_purchase_orders where id=p_order_id; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_project_id::text||':electronic-invoices'));
  select coalesce(max(sequence_no),0)+1 into seq from public.finance_electronic_invoices where project_id=p_project_id;
  insert into public.finance_electronic_invoices(
    company_id,project_id,legal_entity_id,supplier_id,order_id,receipt_id,sequence_no,registry_number,status,validation_status,
    access_key,model,series,invoice_number,issue_date,issue_datetime,operation_nature,
    issuer_tax_id,issuer_name,issuer_trade_name,issuer_state_registration,recipient_tax_id,recipient_name,
    products_amount,freight_amount,insurance_amount,discount_amount,import_tax_amount,ipi_amount,pis_amount,cofins_amount,icms_amount,other_amount,invoice_total,
    xml_storage_path,xml_file_name,xml_hash,imported_by
  ) values(
    p_company_id,p_project_id,entity_row.id,p_supplier_id,p_order_id,p_receipt_id,seq,'NFE-'||lpad(seq::text,4,'0'),'review','attention',
    access_key,p_payload->>'model',nullif(p_payload->>'series',''),p_payload->>'number',(p_payload->>'issue_date')::date,nullif(p_payload->>'issue_datetime','')::timestamptz,nullif(p_payload->>'nature_operation',''),
    issuer_tax,coalesce(nullif(p_payload#>>'{issuer,name}',''),supplier_row.legal_name),nullif(p_payload#>>'{issuer,trade_name}',''),nullif(p_payload#>>'{issuer,state_registration}',''),recipient_tax,nullif(p_payload#>>'{recipient,name}',''),
    coalesce(nullif(p_payload#>>'{totals,products}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,freight}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,insurance}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,discount}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,import_tax}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,ipi}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,pis}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,cofins}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,icms}','')::numeric,0),coalesce(nullif(p_payload#>>'{totals,other}','')::numeric,0),invoice_total,
    p_xml_storage_path,p_xml_file_name,p_xml_hash,auth.uid()
  ) returning id into invoice_id;

  if supplier_tax<>issuer_tax then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description,expected_value,actual_value)
    values(p_company_id,p_project_id,invoice_id,'supplier','critical','CNPJ do fornecedor divergente','O fornecedor vinculado não corresponde ao emitente do XML.',supplier_tax,issuer_tax);
  end if;
  if entity_tax='' or recipient_tax<>entity_tax then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description,expected_value,actual_value)
    values(p_company_id,p_project_id,invoice_id,'recipient','critical','Destinatário diferente da SPE da obra','O CNPJ destinatário do XML não corresponde à empresa/SPE vinculada ao empreendimento.',entity_tax,recipient_tax);
  end if;
  if order_row.id is not null and order_row.supplier_id<>p_supplier_id then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description)
    values(p_company_id,p_project_id,invoice_id,'order','critical','Fornecedor diferente do pedido','O pedido selecionado pertence a outro fornecedor.');
  end if;
  if order_row.id is not null and abs(invoice_total-order_row.total_amount)>0.05 then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description,expected_value,actual_value)
    values(p_company_id,p_project_id,invoice_id,'total','medium','Valor da NF-e diferente do pedido','O total da NF-e não coincide com o total atual do pedido.',order_row.total_amount::text,invoice_total::text);
  end if;
  if receipt_row.id is not null and receipt_row.order_id<>p_order_id then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description)
    values(p_company_id,p_project_id,invoice_id,'receipt','critical','Recebimento não pertence ao pedido','O recebimento selecionado não pertence ao pedido vinculado.');
  end if;
  if receipt_row.id is not null and nullif(regexp_replace(coalesce(receipt_row.invoice_access_key,''),'[^0-9]','','g'),'') is not null and regexp_replace(receipt_row.invoice_access_key,'[^0-9]','','g')<>access_key then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description,expected_value,actual_value)
    values(p_company_id,p_project_id,invoice_id,'receipt','high','Chave diferente do recebimento','A chave informada no recebimento não coincide com o XML.',receipt_row.invoice_access_key,access_key);
  end if;
  if receipt_row.id is not null and receipt_row.invoice_amount is not null and abs(receipt_row.invoice_amount-invoice_total)>0.05 then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description,expected_value,actual_value)
    values(p_company_id,p_project_id,invoice_id,'total','medium','Valor diferente do recebimento','O valor informado no recebimento não coincide com o XML.',receipt_row.invoice_amount::text,invoice_total::text);
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    item_index:=item_index+1; input_row:=null; order_item:=null; receipt_item:=null;
    if nullif(item->>'input_id','') is not null then
      select * into input_row from public.engineering_inputs where id=(item->>'input_id')::uuid and company_id=p_company_id and status='active';
      if input_row.id is null then raise exception 'Um dos insumos vinculados não está ativo.'; end if;
    end if;
    if nullif(item->>'order_item_id','') is not null then
      select * into order_item from public.procurement_purchase_order_items where id=(item->>'order_item_id')::uuid and order_id=p_order_id and company_id=p_company_id and project_id=p_project_id;
      if order_item.id is null then raise exception 'Um dos itens não pertence ao pedido selecionado.'; end if;
    end if;
    if nullif(item->>'receipt_item_id','') is not null then
      select * into receipt_item from public.procurement_material_receipt_items where id=(item->>'receipt_item_id')::uuid and receipt_id=p_receipt_id and company_id=p_company_id and project_id=p_project_id;
      if receipt_item.id is null then raise exception 'Um dos itens não pertence ao recebimento selecionado.'; end if;
    end if;
    xml_qty:=coalesce(nullif(item->>'quantity','')::numeric,0); xml_price:=coalesce(nullif(item->>'unit_price','')::numeric,0);
    quantity_diff:=case when order_item.id is not null then xml_qty-order_item.ordered_quantity else null end;
    price_diff:=case when order_item.id is not null then xml_price-order_item.unit_price else null end;
    insert into public.finance_electronic_invoice_items(
      company_id,project_id,invoice_id,line_number,supplier_product_code,ean,description,ncm,cfop,unit_snapshot,quantity,unit_price,gross_amount,discount_amount,freight_amount,other_amount,total_amount,icms_amount,ipi_amount,pis_amount,cofins_amount,
      input_id,cost_center_service_id,order_item_id,receipt_item_id,mapping_status,order_quantity,order_unit_price,quantity_variance,unit_price_variance,notes
    ) values(
      p_company_id,p_project_id,invoice_id,coalesce(nullif(item->>'line_number','')::integer,item_index),nullif(item->>'supplier_code',''),nullif(item->>'ean',''),coalesce(nullif(item->>'description',''),'Item sem descrição'),nullif(item->>'ncm',''),nullif(item->>'cfop',''),nullif(item->>'unit',''),xml_qty,xml_price,
      coalesce(nullif(item->>'gross_amount','')::numeric,0),coalesce(nullif(item->>'discount_amount','')::numeric,0),coalesce(nullif(item->>'freight_amount','')::numeric,0),coalesce(nullif(item->>'other_amount','')::numeric,0),coalesce(nullif(item->>'total_amount','')::numeric,0),coalesce(nullif(item->>'icms_amount','')::numeric,0),coalesce(nullif(item->>'ipi_amount','')::numeric,0),coalesce(nullif(item->>'pis_amount','')::numeric,0),coalesce(nullif(item->>'cofins_amount','')::numeric,0),
      input_row.id,coalesce(order_item.cost_center_service_id,receipt_item.cost_center_service_id,nullif(item->>'cost_center_service_id','')::uuid),order_item.id,receipt_item.id,case when input_row.id is null then 'unmapped' when order_item.id is not null and order_item.input_id<>input_row.id then 'divergent' else 'matched' end,
      order_item.ordered_quantity,order_item.unit_price,quantity_diff,price_diff,nullif(item->>'notes','')
    ) returning id into invoice_item_id;
    if input_row.id is null then
      insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,invoice_item_id,divergence_type,severity,title,description,actual_value)
      values(p_company_id,p_project_id,invoice_id,invoice_item_id,'item_mapping','medium','Produto não vinculado ao cadastro','Vincule o produto do XML a um insumo ativo do Elos OS.',item->>'description');
    elsif order_item.id is not null and order_item.input_id<>input_row.id then
      insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,invoice_item_id,divergence_type,severity,title,description,expected_value,actual_value)
      values(p_company_id,p_project_id,invoice_id,invoice_item_id,'item_mapping','high','Insumo diferente do pedido','O insumo selecionado é diferente do item do pedido.',order_item.input_name,input_row.description);
    end if;
    if order_item.id is not null and abs(quantity_diff)>0.000001 then
      insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,invoice_item_id,divergence_type,severity,title,description,expected_value,actual_value)
      values(p_company_id,p_project_id,invoice_id,invoice_item_id,'quantity','medium','Quantidade diferente do pedido','A quantidade faturada é diferente da quantidade do item do pedido.',order_item.ordered_quantity::text,xml_qty::text);
    end if;
    if order_item.id is not null and abs(price_diff)>greatest(0.01,abs(order_item.unit_price)*0.001) then
      insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,invoice_item_id,divergence_type,severity,title,description,expected_value,actual_value)
      values(p_company_id,p_project_id,invoice_id,invoice_item_id,'price','high','Preço unitário diferente do pedido','O preço unitário do XML é diferente do preço contratado.',order_item.unit_price::text,xml_price::text);
    end if;
  end loop;

  if jsonb_typeof(p_installments)='array' then
    for installment in select value from jsonb_array_elements(p_installments) loop
      if coalesce(nullif(installment->>'amount','')::numeric,0)<=0 then continue; end if;
      installment_index:=installment_index+1; payment_sum:=payment_sum+(installment->>'amount')::numeric;
      insert into public.finance_electronic_invoice_installments(company_id,project_id,invoice_id,sequence_no,installment_label,due_date,amount,payment_method)
      values(p_company_id,p_project_id,invoice_id,installment_index,coalesce(nullif(installment->>'number',''),installment_index::text),(installment->>'due_date')::date,(installment->>'amount')::numeric,nullif(installment->>'payment_method',''));
    end loop;
  end if;
  if installment_index=0 then
    installment_index:=1; payment_sum:=invoice_total;
    insert into public.finance_electronic_invoice_installments(company_id,project_id,invoice_id,sequence_no,installment_label,due_date,amount,payment_method)
    values(p_company_id,p_project_id,invoice_id,1,'1',(p_payload->>'issue_date')::date,invoice_total,'Não informado');
  end if;
  if abs(payment_sum-invoice_total)>0.02 then
    insert into public.finance_electronic_invoice_divergences(company_id,project_id,invoice_id,divergence_type,severity,title,description,expected_value,actual_value)
    values(p_company_id,p_project_id,invoice_id,'payment','high','Parcelas não fecham com a NF-e','A soma das parcelas é diferente do valor total da nota.',invoice_total::text,payment_sum::text);
  end if;

  perform public.refresh_finance_electronic_invoice(invoice_id);
  insert into public.finance_electronic_invoice_audit(company_id,project_id,invoice_id,action,new_status,details,changed_by)
  values(p_company_id,p_project_id,invoice_id,'imported','review',jsonb_build_object('access_key',access_key,'invoice_total',invoice_total,'order_id',p_order_id,'receipt_id',p_receipt_id),auth.uid());
  return invoice_id;
end; $$;

create or replace function public.resolve_finance_electronic_invoice_divergence(
  p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_divergence_id uuid,p_action text,p_notes text
) returns text language plpgsql security definer set search_path=public as $$
declare d public.finance_electronic_invoice_divergences%rowtype; next_status text; begin
  if not public.has_company_permission(p_company_id,'finance.invoices.approve') then raise exception 'Sem permissão para tratar divergências.'; end if;
  if p_action not in('resolve','waive') then raise exception 'Ação inválida.'; end if;
  if nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'Informe a justificativa da resolução.'; end if;
  select * into d from public.finance_electronic_invoice_divergences where id=p_divergence_id and invoice_id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if d.id is null or d.status<>'open' then raise exception 'Divergência não disponível.'; end if;
  next_status:=case when p_action='resolve' then 'resolved' else 'waived' end;
  update public.finance_electronic_invoice_divergences set status=next_status,resolution_notes=trim(p_notes),resolved_by=auth.uid(),resolved_at=now(),updated_at=now() where id=d.id;
  perform public.refresh_finance_electronic_invoice(p_invoice_id);
  insert into public.finance_electronic_invoice_audit(company_id,project_id,invoice_id,action,reason,details,changed_by)
  values(p_company_id,p_project_id,p_invoice_id,'divergence_'||next_status,trim(p_notes),jsonb_build_object('divergence_id',d.id,'type',d.divergence_type),auth.uid());
  return next_status;
end; $$;

create or replace function public.refresh_procurement_purchase_order(p_order_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare current_status text; next_status text; total_ordered numeric; total_accepted numeric; invoice_value numeric; begin
  select status into current_status from public.procurement_purchase_orders where id=p_order_id for update;
  if current_status is null then raise exception 'Pedido de compra não encontrado.'; end if;
  select coalesce(sum(ordered_quantity-cancelled_quantity),0),coalesce(sum(accepted_quantity),0) into total_ordered,total_accepted from public.procurement_purchase_order_items where order_id=p_order_id;
  if current_status in('draft','cancelled','closed') then next_status:=current_status;
  elsif total_ordered>0 and total_accepted>=total_ordered then next_status:='received';
  elsif total_accepted>0 then next_status:='partially_received';
  elsif current_status='confirmed' then next_status:='confirmed'; else next_status:='issued'; end if;
  select coalesce(sum(invoice_total),0) into invoice_value from public.finance_electronic_invoices where order_id=p_order_id and status='approved';
  if invoice_value=0 then select coalesce(sum(invoice_amount),0) into invoice_value from public.procurement_material_receipts where order_id=p_order_id and status='approved'; end if;
  update public.procurement_purchase_orders o set status=next_status,received_amount=coalesce(x.received,0),invoiced_amount=invoice_value,updated_at=now()
  from(select p_order_id id,coalesce(sum(accepted_quantity*delivered_unit_cost),0)received from public.procurement_purchase_order_items where order_id=p_order_id)x where o.id=x.id;
  return next_status;
end; $$;

create or replace function public.approve_finance_electronic_invoice(p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare inv public.finance_electronic_invoices%rowtype; installment public.finance_electronic_invoice_installments%rowtype; payable_id uuid; begin
  if not public.has_company_permission(p_company_id,'finance.invoices.approve') then raise exception 'Sem permissão para aprovar notas eletrônicas.'; end if;
  select * into inv from public.finance_electronic_invoices where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if inv.id is null or inv.status not in('review','rejected') then raise exception 'Nota não disponível para aprovação.'; end if;
  perform public.refresh_finance_electronic_invoice(inv.id);
  select * into inv from public.finance_electronic_invoices where id=inv.id;
  if exists(select 1 from public.finance_electronic_invoice_items where invoice_id=inv.id and input_id is null) then raise exception 'Vincule todos os produtos ao cadastro de insumos.'; end if;
  if exists(select 1 from public.finance_electronic_invoice_divergences where invoice_id=inv.id and status='open' and severity in('high','critical')) then raise exception 'Resolva ou dispense as divergências de alta severidade antes da aprovação.'; end if;
  if abs(inv.payment_total-inv.invoice_total)>0.02 then raise exception 'A soma das parcelas não coincide com o valor da NF-e.'; end if;
  for installment in select * from public.finance_electronic_invoice_installments where invoice_id=inv.id order by sequence_no loop
    insert into public.payables(company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,installment_label,notes,origin,source_system,source_id,created_by)
    values(p_company_id,p_project_id,inv.supplier_id,concat(inv.invoice_number,'/',coalesce(inv.series,'-')),'NF-e',installment.payment_method,installment.due_date,installment.amount,'open',concat(installment.sequence_no,' / ',(select count(*) from public.finance_electronic_invoice_installments where invoice_id=inv.id)),concat_ws(E'\n','NF-e '||inv.access_key,case when inv.order_id is not null then 'Pedido vinculado' end,case when inv.receipt_id is not null then 'Recebimento vinculado' end),'xml','elos_os','nfe:'||inv.id::text||':'||installment.id::text,auth.uid())
    on conflict(company_id,source_system,source_id) do update set due_date=excluded.due_date,amount=excluded.amount,payment_method=excluded.payment_method,document=excluded.document
    returning id into payable_id;
    update public.finance_electronic_invoice_installments set payable_id=payable_id,updated_at=now() where id=installment.id;
  end loop;
  update public.finance_electronic_invoices set status='approved',validation_status='ready',approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),rejection_reason=null,rejected_by=null,rejected_at=null,updated_at=now() where id=inv.id;
  if inv.receipt_id is not null then
    update public.procurement_material_receipts set invoice_number=inv.invoice_number,invoice_series=inv.series,invoice_access_key=inv.access_key,invoice_date=inv.issue_date,invoice_amount=inv.invoice_total,updated_at=now() where id=inv.receipt_id;
  end if;
  if inv.order_id is not null then perform public.refresh_procurement_purchase_order(inv.order_id); end if;
  insert into public.finance_electronic_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,reason,changed_by)
  values(p_company_id,p_project_id,inv.id,'approved',inv.status,'approved',nullif(trim(coalesce(p_notes,'')),''),auth.uid());
  return 'approved';
end; $$;

create or replace function public.reject_finance_electronic_invoice(p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare inv public.finance_electronic_invoices%rowtype; begin
  if not public.has_company_permission(p_company_id,'finance.invoices.approve') then raise exception 'Sem permissão para rejeitar notas eletrônicas.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da rejeição.'; end if;
  select * into inv from public.finance_electronic_invoices where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if inv.id is null or inv.status<>'review' then raise exception 'Nota não disponível para rejeição.'; end if;
  update public.finance_electronic_invoices set status='rejected',rejected_by=auth.uid(),rejected_at=now(),rejection_reason=trim(p_reason),updated_at=now() where id=inv.id;
  insert into public.finance_electronic_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,inv.id,'rejected','review','rejected',trim(p_reason),auth.uid());
  return 'rejected';
end; $$;

create or replace function public.cancel_finance_electronic_invoice(p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare inv public.finance_electronic_invoices%rowtype; begin
  if not public.has_company_permission(p_company_id,'finance.invoices.cancel') then raise exception 'Sem permissão para cancelar notas eletrônicas.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into inv from public.finance_electronic_invoices where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if inv.id is null or inv.status not in('review','rejected') then raise exception 'Somente notas não aprovadas podem ser canceladas.'; end if;
  update public.finance_electronic_invoices set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_at=now() where id=inv.id;
  insert into public.finance_electronic_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,inv.id,'cancelled',inv.status,'cancelled',trim(p_reason),auth.uid());
  return 'cancelled';
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('electronic-invoice-xml','electronic-invoice-xml',false,5242880,array['application/xml','text/xml','application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists electronic_invoice_xml_select on storage.objects;
create policy electronic_invoice_xml_select on storage.objects for select to authenticated using(bucket_id='electronic-invoice-xml' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists electronic_invoice_xml_insert on storage.objects;
create policy electronic_invoice_xml_insert on storage.objects for insert to authenticated with check(bucket_id='electronic-invoice-xml' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'finance.invoices.manage'));

grant select,insert,update,delete on public.finance_electronic_invoices,public.finance_electronic_invoice_items,public.finance_electronic_invoice_installments,public.finance_electronic_invoice_divergences,public.finance_electronic_invoice_audit to authenticated;
grant execute on function public.refresh_finance_electronic_invoice(uuid) to authenticated;
grant execute on function public.save_finance_electronic_invoice(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.resolve_finance_electronic_invoice_divergence(uuid,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.approve_finance_electronic_invoice(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reject_finance_electronic_invoice(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.cancel_finance_electronic_invoice(uuid,uuid,uuid,text) to authenticated;

commit;
