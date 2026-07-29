-- Elos OS — Financeiro · Notas Manuais
-- Documentos sem XML, retenções, rateio por serviço e geração idempotente do Contas a Pagar.

begin;

create table if not exists public.finance_manual_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  legal_entity_id uuid references public.legal_entities(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  contract_id uuid references public.execution_service_contracts(id) on delete restrict,
  measurement_id uuid references public.execution_contract_measurements(id) on delete restrict,
  sequence_no integer not null,
  registry_number text not null,
  status text not null default 'draft' check(status in ('draft','submitted','approved','rejected','cancelled')),
  document_type text not null check(document_type in ('service_invoice','transport','rent','reimbursement','utility','tax_document','receipt','other')),
  document_number text not null,
  series text,
  issue_date date not null,
  competence_date date,
  gross_amount numeric(18,2) not null default 0,
  item_discount_amount numeric(18,2) not null default 0,
  inss_amount numeric(18,2) not null default 0,
  iss_amount numeric(18,2) not null default 0,
  irrf_amount numeric(18,2) not null default 0,
  pis_amount numeric(18,2) not null default 0,
  cofins_amount numeric(18,2) not null default 0,
  csll_amount numeric(18,2) not null default 0,
  other_retention_amount numeric(18,2) not null default 0,
  total_retention_amount numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null default 0,
  payment_total numeric(18,2) not null default 0,
  item_count integer not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
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
  constraint finance_manual_invoice_values_check check(
    gross_amount>=0 and item_discount_amount>=0 and inss_amount>=0 and iss_amount>=0 and irrf_amount>=0 and
    pis_amount>=0 and cofins_amount>=0 and csll_amount>=0 and other_retention_amount>=0 and
    total_retention_amount>=0 and net_amount>=0 and payment_total>=0 and item_count>=0
  ),
  constraint finance_manual_invoice_rejection_check check(status<>'rejected' or nullif(trim(coalesce(rejection_reason,'')),'') is not null),
  constraint finance_manual_invoice_cancel_check check(status<>'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create unique index if not exists finance_manual_invoice_document_unique_idx
  on public.finance_manual_invoices(project_id,supplier_id,document_type,lower(document_number),lower(coalesce(series,'')))
  where status<>'cancelled';

create table if not exists public.finance_manual_invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_manual_invoices(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  contract_item_id uuid references public.execution_service_contract_items(id) on delete restrict,
  measurement_item_id uuid references public.execution_contract_measurement_items(id) on delete restrict,
  line_number integer not null,
  service_code text not null,
  service_name text not null,
  description text,
  unit_snapshot text not null,
  quantity numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  gross_amount numeric(18,2) not null,
  discount_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(invoice_id,line_number),
  constraint finance_manual_invoice_item_values_check check(
    quantity>0 and unit_price>=0 and gross_amount>=0 and discount_amount>=0 and total_amount>=0 and discount_amount<=gross_amount
  )
);

create table if not exists public.finance_manual_invoice_installments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_manual_invoices(id) on delete cascade,
  sequence_no integer not null,
  installment_label text not null,
  due_date date not null,
  amount numeric(18,2) not null,
  payment_method text,
  payable_id uuid references public.payables(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(invoice_id,sequence_no),
  constraint finance_manual_invoice_installment_value_check check(amount>0)
);

create table if not exists public.finance_manual_invoice_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_manual_invoices(id) on delete cascade,
  document_type text not null default 'invoice' check(document_type in ('invoice','receipt','contract','measurement','tax','evidence','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique(invoice_id,storage_path)
);

create table if not exists public.finance_manual_invoice_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null references public.finance_manual_invoices(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists finance_manual_invoices_project_status_idx on public.finance_manual_invoices(project_id,status,issue_date desc);
create index if not exists finance_manual_invoices_supplier_idx on public.finance_manual_invoices(company_id,supplier_id,issue_date desc);
create index if not exists finance_manual_invoices_contract_idx on public.finance_manual_invoices(contract_id,status);
create index if not exists finance_manual_invoices_measurement_idx on public.finance_manual_invoices(measurement_id,status);
create index if not exists finance_manual_invoice_items_idx on public.finance_manual_invoice_items(invoice_id,line_number);
create index if not exists finance_manual_invoice_installments_idx on public.finance_manual_invoice_installments(invoice_id,due_date);
create index if not exists finance_manual_invoice_documents_idx on public.finance_manual_invoice_documents(invoice_id,uploaded_at desc);

insert into public.permissions(key,module,action,description) values
  ('finance.manual_invoices.view','finance_manual_invoices','view','Visualizar notas e documentos financeiros lançados manualmente'),
  ('finance.manual_invoices.manage','finance_manual_invoices','manage','Criar, editar e enviar notas manuais para aprovação'),
  ('finance.manual_invoices.approve','finance_manual_invoices','approve','Aprovar ou devolver notas manuais e gerar contas a pagar'),
  ('finance.manual_invoices.cancel','finance_manual_invoices','cancel','Cancelar notas manuais ainda não aprovadas')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r cross join(values
  ('finance.manual_invoices.view'),('finance.manual_invoices.manage'),('finance.manual_invoices.approve'),('finance.manual_invoices.cancel'))p(permission_key)
where r.key in('owner','admin','director','finance')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'finance.manual_invoices.view',true from public.roles r
where r.key in('engineering','procurement','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.finance_manual_invoices enable row level security;
alter table public.finance_manual_invoice_items enable row level security;
alter table public.finance_manual_invoice_installments enable row level security;
alter table public.finance_manual_invoice_documents enable row level security;
alter table public.finance_manual_invoice_audit enable row level security;

do $$ declare v_table text; begin
  foreach v_table in array array['finance_manual_invoices','finance_manual_invoice_items','finance_manual_invoice_installments','finance_manual_invoice_documents','finance_manual_invoice_audit'] loop
    execute format('drop policy if exists %I_select on public.%I',v_table,v_table);
    execute format('create policy %I_select on public.%I for select to authenticated using(public.has_company_permission(company_id,''finance.manual_invoices.view'') or public.has_company_permission(company_id,''finance.manual_invoices.manage'') or public.has_company_permission(company_id,''finance.manual_invoices.approve''))',v_table,v_table);
    execute format('drop policy if exists %I_write on public.%I',v_table,v_table);
    execute format('create policy %I_write on public.%I for all to authenticated using(public.has_company_permission(company_id,''finance.manual_invoices.manage'') or public.has_company_permission(company_id,''finance.manual_invoices.approve'')) with check(public.has_company_permission(company_id,''finance.manual_invoices.manage'') or public.has_company_permission(company_id,''finance.manual_invoices.approve''))',v_table,v_table);
  end loop;
end $$;

create or replace function public.refresh_finance_manual_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_gross numeric:=0; v_item_discount numeric:=0; v_payment numeric:=0; v_count integer:=0;
  v_retention numeric:=0; v_net numeric:=0;
begin
  select coalesce(sum(gross_amount),0),coalesce(sum(discount_amount),0),count(*)
  into v_gross,v_item_discount,v_count
  from public.finance_manual_invoice_items where invoice_id=p_invoice_id;

  select coalesce(sum(amount),0) into v_payment
  from public.finance_manual_invoice_installments where invoice_id=p_invoice_id;

  select inss_amount+iss_amount+irrf_amount+pis_amount+cofins_amount+csll_amount+other_retention_amount
  into v_retention from public.finance_manual_invoices where id=p_invoice_id;
  v_retention:=coalesce(v_retention,0);
  v_net:=v_gross-v_item_discount-v_retention;
  if v_net<0 then raise exception 'As retenções e descontos não podem superar o valor bruto.'; end if;

  update public.finance_manual_invoices set
    gross_amount=v_gross,item_discount_amount=v_item_discount,total_retention_amount=v_retention,
    net_amount=v_net,payment_total=v_payment,item_count=v_count,updated_at=now()
  where id=p_invoice_id;
end; $$;

create or replace function public.save_finance_manual_invoice(
  p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_supplier_id uuid,p_contract_id uuid,p_measurement_id uuid,
  p_document_type text,p_document_number text,p_series text,p_issue_date date,p_competence_date date,p_notes text,
  p_retentions jsonb,p_items jsonb,p_installments jsonb,p_submit boolean
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_project public.projects%rowtype; v_supplier public.suppliers%rowtype; v_contract public.execution_service_contracts%rowtype;
  v_measurement public.execution_contract_measurements%rowtype; v_invoice public.finance_manual_invoices%rowtype;
  v_service public.engineering_services%rowtype; v_contract_item public.execution_service_contract_items%rowtype;
  v_measurement_item public.execution_contract_measurement_items%rowtype; v_item jsonb; v_installment jsonb;
  v_resolved_id uuid; v_sequence integer; v_line integer:=0; v_installment_no integer:=0;
  v_quantity numeric; v_unit_price numeric; v_discount numeric; v_gross numeric; v_total numeric;
  v_payment_sum numeric:=0; v_invoice_net numeric; v_next_status text;
  v_inss numeric:=0; v_iss numeric:=0; v_irrf numeric:=0; v_pis numeric:=0; v_cofins numeric:=0; v_csll numeric:=0; v_other numeric:=0;
begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.manage') then raise exception 'Sem permissão para lançar notas manuais.'; end if;
  if p_document_type not in('service_invoice','transport','rent','reimbursement','utility','tax_document','receipt','other') then raise exception 'Tipo de documento inválido.'; end if;
  if nullif(trim(coalesce(p_document_number,'')),'') is null then raise exception 'Informe o número do documento.'; end if;
  if p_issue_date is null then raise exception 'Informe a data de emissão.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Informe ao menos um item vinculado a um serviço.'; end if;
  if jsonb_typeof(p_installments)<>'array' or jsonb_array_length(p_installments)=0 then raise exception 'Informe ao menos uma parcela.'; end if;

  select * into v_project from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived';
  if v_project.id is null then raise exception 'Obra inválida.'; end if;
  select * into v_supplier from public.suppliers where id=p_supplier_id and company_id=p_company_id and status='active';
  if v_supplier.id is null then raise exception 'Fornecedor inválido ou inativo.'; end if;

  if p_contract_id is not null then
    select * into v_contract from public.execution_service_contracts
    where id=p_contract_id and company_id=p_company_id and project_id=p_project_id and status<>'cancelled';
    if v_contract.id is null then raise exception 'Contrato inválido.'; end if;
    if v_contract.supplier_id<>p_supplier_id then raise exception 'O contrato pertence a outro fornecedor.'; end if;
  end if;

  if p_measurement_id is not null then
    select * into v_measurement from public.execution_contract_measurements
    where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id and status='approved' and payable_id is null;
    if v_measurement.id is null then raise exception 'A medição precisa estar aprovada e ainda não enviada ao financeiro.'; end if;
    if v_measurement.supplier_id<>p_supplier_id then raise exception 'A medição pertence a outro fornecedor.'; end if;
    if p_contract_id is null then p_contract_id:=v_measurement.contract_id;
    elsif p_contract_id<>v_measurement.contract_id then raise exception 'A medição não pertence ao contrato selecionado.'; end if;
  end if;

  if exists(
    select 1 from public.finance_manual_invoices d
    where d.project_id=p_project_id and d.supplier_id=p_supplier_id and d.document_type=p_document_type
      and lower(d.document_number)=lower(trim(p_document_number)) and lower(coalesce(d.series,''))=lower(coalesce(trim(p_series),''))
      and d.status<>'cancelled' and (p_invoice_id is null or d.id<>p_invoice_id)
  ) then raise exception 'Já existe um documento ativo com este fornecedor, tipo, número e série.'; end if;

  v_inss:=greatest(coalesce(nullif(p_retentions->>'inss','')::numeric,0),0);
  v_iss:=greatest(coalesce(nullif(p_retentions->>'iss','')::numeric,0),0);
  v_irrf:=greatest(coalesce(nullif(p_retentions->>'irrf','')::numeric,0),0);
  v_pis:=greatest(coalesce(nullif(p_retentions->>'pis','')::numeric,0),0);
  v_cofins:=greatest(coalesce(nullif(p_retentions->>'cofins','')::numeric,0),0);
  v_csll:=greatest(coalesce(nullif(p_retentions->>'csll','')::numeric,0),0);
  v_other:=greatest(coalesce(nullif(p_retentions->>'other','')::numeric,0),0);
  v_next_status:=case when coalesce(p_submit,false) then 'submitted' else 'draft' end;

  if p_invoice_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':manual-invoices'));
    select coalesce(max(sequence_no),0)+1 into v_sequence from public.finance_manual_invoices where project_id=p_project_id;
    insert into public.finance_manual_invoices(
      company_id,project_id,legal_entity_id,supplier_id,contract_id,measurement_id,sequence_no,registry_number,status,
      document_type,document_number,series,issue_date,competence_date,inss_amount,iss_amount,irrf_amount,pis_amount,cofins_amount,csll_amount,other_retention_amount,
      notes,created_by,updated_by,submitted_by,submitted_at
    ) values(
      p_company_id,p_project_id,v_project.legal_entity_id,p_supplier_id,p_contract_id,p_measurement_id,v_sequence,'NM-'||lpad(v_sequence::text,4,'0'),v_next_status,
      p_document_type,trim(p_document_number),nullif(trim(coalesce(p_series,'')),''),p_issue_date,p_competence_date,
      v_inss,v_iss,v_irrf,v_pis,v_cofins,v_csll,v_other,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid(),
      case when v_next_status='submitted' then auth.uid() end,case when v_next_status='submitted' then now() end
    ) returning id into v_resolved_id;
  else
    select * into v_invoice from public.finance_manual_invoices
    where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
    if v_invoice.id is null then raise exception 'Documento não encontrado.'; end if;
    if v_invoice.status not in('draft','rejected') then raise exception 'Somente rascunhos ou documentos devolvidos podem ser editados.'; end if;
    v_resolved_id:=v_invoice.id;
    update public.finance_manual_invoices set
      supplier_id=p_supplier_id,contract_id=p_contract_id,measurement_id=p_measurement_id,status=v_next_status,
      document_type=p_document_type,document_number=trim(p_document_number),series=nullif(trim(coalesce(p_series,'')),''),issue_date=p_issue_date,competence_date=p_competence_date,
      inss_amount=v_inss,iss_amount=v_iss,irrf_amount=v_irrf,pis_amount=v_pis,cofins_amount=v_cofins,csll_amount=v_csll,other_retention_amount=v_other,
      notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now(),
      submitted_by=case when v_next_status='submitted' then auth.uid() else null end,submitted_at=case when v_next_status='submitted' then now() else null end,
      rejected_by=null,rejected_at=null,rejection_reason=null
    where id=v_resolved_id;
    delete from public.finance_manual_invoice_items where invoice_id=v_resolved_id;
    delete from public.finance_manual_invoice_installments where invoice_id=v_resolved_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line:=v_line+1; v_contract_item:=null; v_measurement_item:=null;
    select * into v_service from public.engineering_services
    where id=nullif(v_item->>'service_id','')::uuid and company_id=p_company_id and status='active';
    if v_service.id is null then raise exception 'Um dos serviços/centros de custo não está ativo.'; end if;
    v_quantity:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
    v_unit_price:=coalesce(nullif(v_item->>'unit_price','')::numeric,0);
    v_discount:=greatest(coalesce(nullif(v_item->>'discount_amount','')::numeric,0),0);
    if v_quantity<=0 or v_unit_price<0 then raise exception 'Quantidade e valor unitário dos itens são inválidos.'; end if;
    v_gross:=round(v_quantity*v_unit_price,2); v_total:=v_gross-v_discount;
    if v_total<0 then raise exception 'O desconto de um item não pode superar seu valor bruto.'; end if;

    if nullif(v_item->>'contract_item_id','') is not null then
      select * into v_contract_item from public.execution_service_contract_items
      where id=(v_item->>'contract_item_id')::uuid and contract_id=p_contract_id and company_id=p_company_id and project_id=p_project_id;
      if v_contract_item.id is null then raise exception 'Um item não pertence ao contrato selecionado.'; end if;
      if v_contract_item.service_id<>v_service.id then raise exception 'O serviço do item é diferente do contrato.'; end if;
    end if;
    if nullif(v_item->>'measurement_item_id','') is not null then
      select * into v_measurement_item from public.execution_contract_measurement_items
      where id=(v_item->>'measurement_item_id')::uuid and measurement_id=p_measurement_id and company_id=p_company_id and project_id=p_project_id;
      if v_measurement_item.id is null then raise exception 'Um item não pertence à medição selecionada.'; end if;
      if v_contract_item.id is null then
        select * into v_contract_item from public.execution_service_contract_items where id=v_measurement_item.contract_item_id;
      end if;
      if v_contract_item.service_id<>v_service.id then raise exception 'O serviço do item é diferente da medição.'; end if;
    end if;

    insert into public.finance_manual_invoice_items(
      company_id,project_id,invoice_id,service_id,contract_item_id,measurement_item_id,line_number,
      service_code,service_name,description,unit_snapshot,quantity,unit_price,gross_amount,discount_amount,total_amount,notes
    ) values(
      p_company_id,p_project_id,v_resolved_id,v_service.id,v_contract_item.id,v_measurement_item.id,v_line,
      v_service.code,v_service.description,nullif(trim(coalesce(v_item->>'description','')),''),coalesce(nullif(v_item->>'unit',''),v_service.unit),
      v_quantity,v_unit_price,v_gross,v_discount,v_total,nullif(trim(coalesce(v_item->>'notes','')),'')
    );
  end loop;

  perform public.refresh_finance_manual_invoice(v_resolved_id);
  select net_amount into v_invoice_net from public.finance_manual_invoices where id=v_resolved_id;

  for v_installment in select value from jsonb_array_elements(p_installments) loop
    v_installment_no:=v_installment_no+1;
    if nullif(v_installment->>'due_date','') is null then raise exception 'Informe o vencimento de todas as parcelas.'; end if;
    if coalesce(nullif(v_installment->>'amount','')::numeric,0)<=0 then raise exception 'O valor das parcelas precisa ser maior que zero.'; end if;
    v_payment_sum:=v_payment_sum+(v_installment->>'amount')::numeric;
    insert into public.finance_manual_invoice_installments(company_id,project_id,invoice_id,sequence_no,installment_label,due_date,amount,payment_method)
    values(p_company_id,p_project_id,v_resolved_id,v_installment_no,coalesce(nullif(trim(v_installment->>'label'),''),v_installment_no::text),
      (v_installment->>'due_date')::date,(v_installment->>'amount')::numeric,nullif(trim(coalesce(v_installment->>'payment_method','')),''));
  end loop;

  perform public.refresh_finance_manual_invoice(v_resolved_id);
  if v_next_status='submitted' and abs(v_payment_sum-v_invoice_net)>0.02 then
    raise exception 'A soma das parcelas precisa coincidir com o valor líquido do documento.';
  end if;

  insert into public.finance_manual_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,details,changed_by)
  values(p_company_id,p_project_id,v_resolved_id,case when p_invoice_id is null then 'created' else 'updated' end,
    case when p_invoice_id is null then null else v_invoice.status end,v_next_status,
    jsonb_build_object('supplier_id',p_supplier_id,'contract_id',p_contract_id,'measurement_id',p_measurement_id,'payment_total',v_payment_sum),auth.uid());
  return v_resolved_id;
end; $$;

create or replace function public.approve_finance_manual_invoice(p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare
  v_invoice public.finance_manual_invoices%rowtype; v_installment public.finance_manual_invoice_installments%rowtype;
  v_payable_id uuid; v_first_payable_id uuid; v_installment_count integer;
begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.approve') then raise exception 'Sem permissão para aprovar notas manuais.'; end if;
  select * into v_invoice from public.finance_manual_invoices
  where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_invoice.id is null or v_invoice.status<>'submitted' then raise exception 'Documento não disponível para aprovação.'; end if;
  perform public.refresh_finance_manual_invoice(v_invoice.id);
  select * into v_invoice from public.finance_manual_invoices where id=v_invoice.id;
  if v_invoice.item_count=0 then raise exception 'O documento não possui itens.'; end if;
  if abs(v_invoice.payment_total-v_invoice.net_amount)>0.02 then raise exception 'As parcelas não coincidem com o valor líquido.'; end if;
  select count(*) into v_installment_count from public.finance_manual_invoice_installments where invoice_id=v_invoice.id;
  if v_invoice.measurement_id is not null and v_installment_count<>1 then
    raise exception 'Documentos vinculados a medição devem possuir uma única parcela, compatível com o fluxo atual de medições.';
  end if;

  for v_installment in select * from public.finance_manual_invoice_installments where invoice_id=v_invoice.id order by sequence_no loop
    insert into public.payables(
      company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,installment_label,notes,
      origin,source_system,source_id,created_by
    ) values(
      p_company_id,p_project_id,v_invoice.supplier_id,
      concat(v_invoice.document_number,case when v_invoice.series is not null then '/'||v_invoice.series else '' end),
      v_invoice.document_type,v_installment.payment_method,v_installment.due_date,v_installment.amount,'open',
      concat(v_installment.sequence_no,' / ',v_installment_count),
      concat_ws(E'\n',v_invoice.registry_number,v_invoice.notes,case when v_invoice.contract_id is not null then 'Contrato vinculado' end,case when v_invoice.measurement_id is not null then 'Medição vinculada' end),
      'manual_invoice','elos_os','manual_invoice:'||v_invoice.id::text||':'||v_installment.id::text,auth.uid()
    ) on conflict(company_id,source_system,source_id) do update set
      due_date=excluded.due_date,amount=excluded.amount,payment_method=excluded.payment_method,document=excluded.document,
      fiscal_class=excluded.fiscal_class,notes=excluded.notes
    returning id into v_payable_id;
    if v_first_payable_id is null then v_first_payable_id:=v_payable_id; end if;
    update public.finance_manual_invoice_installments set payable_id=v_payable_id,updated_at=now() where id=v_installment.id;
  end loop;

  update public.finance_manual_invoices set status='approved',approved_by=auth.uid(),approved_at=now(),
    approval_notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now()
  where id=v_invoice.id;

  if v_invoice.measurement_id is not null then
    update public.execution_contract_measurements set
      status='invoiced',invoice_number=v_invoice.document_number,invoice_date=v_invoice.issue_date,
      invoice_gross_amount=v_invoice.gross_amount,payable_id=v_first_payable_id,sent_to_finance_at=now(),updated_at=now()
    where id=v_invoice.measurement_id and status='approved' and payable_id is null;
    if not found then raise exception 'A medição já foi enviada ao financeiro ou mudou de status.'; end if;
  end if;

  insert into public.finance_manual_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,reason,changed_by)
  values(p_company_id,p_project_id,v_invoice.id,'approved','submitted','approved',nullif(trim(coalesce(p_notes,'')),''),auth.uid());
  return 'approved';
end; $$;

create or replace function public.reject_finance_manual_invoice(p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare v_invoice public.finance_manual_invoices%rowtype; begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.approve') then raise exception 'Sem permissão para devolver notas manuais.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da devolução.'; end if;
  select * into v_invoice from public.finance_manual_invoices where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_invoice.id is null or v_invoice.status<>'submitted' then raise exception 'Documento não disponível para devolução.'; end if;
  update public.finance_manual_invoices set status='rejected',rejected_by=auth.uid(),rejected_at=now(),rejection_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=v_invoice.id;
  insert into public.finance_manual_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,reason,changed_by)
  values(p_company_id,p_project_id,v_invoice.id,'rejected','submitted','rejected',trim(p_reason),auth.uid());
  return 'rejected';
end; $$;

create or replace function public.cancel_finance_manual_invoice(p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare v_invoice public.finance_manual_invoices%rowtype; begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.cancel') then raise exception 'Sem permissão para cancelar notas manuais.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into v_invoice from public.finance_manual_invoices where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_invoice.id is null or v_invoice.status not in('draft','submitted','rejected') then raise exception 'Somente documentos não aprovados podem ser cancelados.'; end if;
  update public.finance_manual_invoices set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=v_invoice.id;
  insert into public.finance_manual_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,reason,changed_by)
  values(p_company_id,p_project_id,v_invoice.id,'cancelled',v_invoice.status,'cancelled',trim(p_reason),auth.uid());
  return 'cancelled';
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('manual-invoice-documents','manual-invoice-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists manual_invoice_documents_select on storage.objects;
create policy manual_invoice_documents_select on storage.objects for select to authenticated
using(bucket_id='manual-invoice-documents' and exists(
  select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]
));

drop policy if exists manual_invoice_documents_insert on storage.objects;
create policy manual_invoice_documents_insert on storage.objects for insert to authenticated
with check(bucket_id='manual-invoice-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'finance.manual_invoices.manage'));

drop policy if exists manual_invoice_documents_delete on storage.objects;
create policy manual_invoice_documents_delete on storage.objects for delete to authenticated
using(bucket_id='manual-invoice-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'finance.manual_invoices.manage'));

grant select,insert,update,delete on public.finance_manual_invoices,public.finance_manual_invoice_items,public.finance_manual_invoice_installments,public.finance_manual_invoice_documents,public.finance_manual_invoice_audit to authenticated;
grant execute on function public.refresh_finance_manual_invoice(uuid) to authenticated;
grant execute on function public.save_finance_manual_invoice(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,date,date,text,jsonb,jsonb,jsonb,boolean) to authenticated;
grant execute on function public.approve_finance_manual_invoice(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reject_finance_manual_invoice(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.cancel_finance_manual_invoice(uuid,uuid,uuid,text) to authenticated;

commit;
