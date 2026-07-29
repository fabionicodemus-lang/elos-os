-- Elos OS — Execução · Medições dos Contratos
-- Medição por item, aprovação técnica, retenções e integração com contas a pagar.

begin;

create table if not exists public.execution_contract_measurements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  sequence_no integer not null,
  measurement_number text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','invoiced','paid','cancelled')),
  gross_amount numeric(18,2) not null default 0,
  contractual_retention_percent numeric(8,4) not null default 0 check (contractual_retention_percent between 0 and 100),
  contractual_retention_amount numeric(18,2) not null default 0,
  guarantee_retention_percent numeric(8,4) not null default 0 check (guarantee_retention_percent between 0 and 100),
  guarantee_retention_amount numeric(18,2) not null default 0,
  tax_withholding_amount numeric(18,2) not null default 0,
  advance_deduction_amount numeric(18,2) not null default 0,
  other_discount_amount numeric(18,2) not null default 0,
  total_deductions numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null default 0,
  notes text,
  contractor_notes text,
  requester_user_id uuid references auth.users(id),
  requester_name text,
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
  invoice_number text,
  invoice_date date,
  invoice_gross_amount numeric(18,2),
  payable_id uuid references public.payables(id) on delete set null,
  sent_to_finance_by uuid references auth.users(id),
  sent_to_finance_at timestamptz,
  paid_amount numeric(18,2) not null default 0,
  paid_at date,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, sequence_no),
  unique (project_id, measurement_number),
  unique (contract_id, period_start, period_end),
  constraint execution_contract_measurement_period_check check (period_end >= period_start),
  constraint execution_contract_measurement_values_check check (
    gross_amount >= 0 and contractual_retention_amount >= 0 and guarantee_retention_amount >= 0 and
    tax_withholding_amount >= 0 and advance_deduction_amount >= 0 and other_discount_amount >= 0 and
    total_deductions >= 0 and net_amount >= 0 and paid_amount >= 0
  ),
  constraint execution_contract_measurement_rejection_check check (status <> 'rejected' or nullif(trim(coalesce(rejection_reason,'')),'') is not null),
  constraint execution_contract_measurement_cancel_check check (status <> 'cancelled' or nullif(trim(coalesce(cancellation_reason,'')),'') is not null)
);

create table if not exists public.execution_contract_measurement_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  measurement_id uuid not null references public.execution_contract_measurements(id) on delete cascade,
  contract_id uuid not null references public.execution_service_contracts(id) on delete restrict,
  contract_item_id uuid not null references public.execution_service_contract_items(id) on delete restrict,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  location_id uuid references public.engineering_takeoff_locations(id) on delete restrict,
  service_code text not null,
  service_name text not null,
  location_name text,
  unit_snapshot text not null,
  contracted_quantity numeric(18,6) not null,
  previous_approved_quantity numeric(18,6) not null default 0,
  current_quantity numeric(18,6) not null,
  accumulated_quantity numeric(18,6) not null,
  unit_price numeric(18,6) not null,
  previous_approved_amount numeric(18,2) not null default 0,
  current_amount numeric(18,2) not null,
  accumulated_amount numeric(18,2) not null,
  progress_percent numeric(9,4) not null default 0,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (measurement_id, contract_item_id),
  constraint execution_contract_measurement_item_values_check check (
    contracted_quantity > 0 and previous_approved_quantity >= 0 and current_quantity > 0 and accumulated_quantity >= 0 and
    unit_price >= 0 and previous_approved_amount >= 0 and current_amount >= 0 and accumulated_amount >= 0 and
    progress_percent between 0 and 100.0001 and accumulated_quantity <= contracted_quantity + 0.000001
  )
);

create table if not exists public.execution_contract_measurement_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  measurement_id uuid not null references public.execution_contract_measurements(id) on delete cascade,
  document_type text not null default 'evidence' check (document_type in ('bulletin','evidence','invoice','approval','other')),
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  caption text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  unique (measurement_id, storage_path)
);

create table if not exists public.execution_contract_measurement_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  measurement_id uuid not null references public.execution_contract_measurements(id) on delete cascade,
  action text not null,
  previous_status text,
  new_status text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create index if not exists execution_contract_measurements_project_status_idx on public.execution_contract_measurements(project_id,status,period_end desc);
create index if not exists execution_contract_measurements_contract_idx on public.execution_contract_measurements(contract_id,sequence_no);
create index if not exists execution_contract_measurement_items_measurement_idx on public.execution_contract_measurement_items(measurement_id,sort_order);
create index if not exists execution_contract_measurement_items_contract_item_idx on public.execution_contract_measurement_items(contract_item_id);
create index if not exists execution_contract_measurement_documents_idx on public.execution_contract_measurement_documents(measurement_id,uploaded_at);

insert into public.permissions (key,module,action,description) values
  ('execution.measurements.view','execution_measurements','view','Visualizar medições dos contratos'),
  ('execution.measurements.manage','execution_measurements','manage','Criar e editar medições em elaboração'),
  ('execution.measurements.submit','execution_measurements','submit','Enviar medições para aprovação'),
  ('execution.measurements.approve','execution_measurements','approve','Aprovar ou rejeitar medições contratuais'),
  ('execution.measurements.finance','execution_measurements','finance','Vincular nota e gerar contas a pagar'),
  ('execution.measurements.cancel','execution_measurements','cancel','Cancelar medições ainda não aprovadas')
on conflict(key) do update set module=excluded.module,action=excluded.action,description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.measurements.view'),('execution.measurements.manage'),('execution.measurements.submit'),('execution.measurements.approve'),('execution.measurements.finance'),('execution.measurements.cancel')) p(permission_key)
where r.key in ('owner','admin','director')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.measurements.view'),('execution.measurements.manage'),('execution.measurements.submit'),('execution.measurements.approve')) p(permission_key)
where r.key in ('engineering')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.measurements.view'),('execution.measurements.manage'),('execution.measurements.submit')) p(permission_key)
where r.key in ('field')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,p.permission_key,true from public.roles r
cross join (values('execution.measurements.view'),('execution.measurements.finance')) p(permission_key)
where r.key in ('finance')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'execution.measurements.view',true from public.roles r
where r.key in ('procurement','viewer')
on conflict(role_id,permission_key) do update set allowed=excluded.allowed;

alter table public.execution_contract_measurements enable row level security;
alter table public.execution_contract_measurement_items enable row level security;
alter table public.execution_contract_measurement_documents enable row level security;
alter table public.execution_contract_measurement_audit enable row level security;

do $$
declare t text;
begin
  foreach t in array array['execution_contract_measurements','execution_contract_measurement_items','execution_contract_measurement_documents','execution_contract_measurement_audit']
  loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_company_permission(company_id,''execution.measurements.view'') or public.has_company_permission(company_id,''execution.measurements.manage'') or public.has_company_permission(company_id,''execution.measurements.approve'') or public.has_company_permission(company_id,''execution.measurements.finance''))',t,t);
    execute format('drop policy if exists %I_write on public.%I',t,t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_company_permission(company_id,''execution.measurements.manage'') or public.has_company_permission(company_id,''execution.measurements.approve'') or public.has_company_permission(company_id,''execution.measurements.finance'')) with check (public.has_company_permission(company_id,''execution.measurements.manage'') or public.has_company_permission(company_id,''execution.measurements.approve'') or public.has_company_permission(company_id,''execution.measurements.finance''))',t,t);
  end loop;
end $$;

create or replace function public.refresh_execution_service_contract_measurements(p_contract_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
begin
  update public.execution_service_contract_items ci
  set measured_quantity=coalesce(x.quantity,0), measured_value=coalesce(x.amount,0), updated_at=now()
  from (
    select mi.contract_item_id,sum(mi.current_quantity) quantity,sum(mi.current_amount) amount
    from public.execution_contract_measurement_items mi
    join public.execution_contract_measurements m on m.id=mi.measurement_id
    where mi.contract_id=p_contract_id and m.status in ('approved','invoiced','paid')
    group by mi.contract_item_id
  ) x
  where ci.id=x.contract_item_id;

  update public.execution_service_contract_items ci
  set measured_quantity=0,measured_value=0,updated_at=now()
  where ci.contract_id=p_contract_id and not exists(
    select 1 from public.execution_contract_measurement_items mi
    join public.execution_contract_measurements m on m.id=mi.measurement_id
    where mi.contract_item_id=ci.id and m.status in ('approved','invoiced','paid')
  );

  update public.execution_service_contracts c
  set measured_value=coalesce(x.measured,0),
      retained_value=coalesce(x.retained,0),
      invoiced_value=coalesce(x.invoiced,0),
      paid_value=coalesce(x.paid,0),
      updated_at=now()
  from (
    select p_contract_id contract_id,
      coalesce(sum(gross_amount) filter(where status in ('approved','invoiced','paid')),0) measured,
      coalesce(sum(contractual_retention_amount+guarantee_retention_amount) filter(where status in ('approved','invoiced','paid')),0) retained,
      coalesce(sum(net_amount) filter(where status in ('invoiced','paid')),0) invoiced,
      coalesce(sum(paid_amount) filter(where status='paid'),0) paid
    from public.execution_contract_measurements where contract_id=p_contract_id
  ) x
  where c.id=x.contract_id;
end; $$;

create or replace function public.save_execution_contract_measurement(
  p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_contract_id uuid,
  p_period_start date,p_period_end date,p_tax_withholding numeric,p_advance_deduction numeric,p_other_discount numeric,
  p_notes text,p_contractor_notes text,p_items jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  m public.execution_contract_measurements%rowtype; c public.execution_service_contracts%rowtype; ci public.execution_service_contract_items%rowtype;
  item jsonb; resolved_id uuid; seq integer; n integer:=0; current_qty numeric; previous_qty numeric; current_amount numeric; gross numeric:=0;
  contractual_retention numeric; guarantee_retention numeric; deductions numeric; net numeric; requester text;
begin
  if not public.has_company_permission(p_company_id,'execution.measurements.manage') then raise exception 'Sem permissão para criar ou editar medições.'; end if;
  select * into c from public.execution_service_contracts where id=p_contract_id and company_id=p_company_id and project_id=p_project_id and status in ('active','suspended');
  if c.id is null then raise exception 'Selecione um contrato ativo ou suspenso da obra.'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Revise o período da medição.'; end if;
  if p_period_start<c.start_date or p_period_end>c.end_date then raise exception 'O período da medição deve estar dentro da vigência atual do contrato.'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Informe pelo menos um item medido.'; end if;
  select coalesce(nullif(trim(pr.full_name),''),nullif(auth.jwt()->>'email',''),'Usuário') into requester from public.profiles pr where pr.id=auth.uid();
  requester:=coalesce(requester,nullif(auth.jwt()->>'email',''),'Usuário');

  if p_measurement_id is null then
    perform pg_advisory_xact_lock(hashtext(p_project_id::text||':contract-measurements'));
    select coalesce(max(sequence_no),0)+1 into seq from public.execution_contract_measurements where project_id=p_project_id;
    insert into public.execution_contract_measurements(company_id,project_id,contract_id,supplier_id,sequence_no,measurement_number,period_start,period_end,status,requester_user_id,requester_name,created_by,updated_by)
    values(p_company_id,p_project_id,c.id,c.supplier_id,seq,'MED-'||lpad(seq::text,4,'0'),p_period_start,p_period_end,'draft',auth.uid(),requester,auth.uid(),auth.uid()) returning id into resolved_id;
  else
    select * into m from public.execution_contract_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id for update;
    if m.id is null then raise exception 'Medição não encontrada.'; end if;
    if m.status not in ('draft','rejected') then raise exception 'Somente medições em elaboração ou rejeitadas podem ser editadas.'; end if;
    if m.contract_id<>p_contract_id then raise exception 'O contrato da medição não pode ser alterado.'; end if;
    resolved_id:=m.id;
    delete from public.execution_contract_measurement_items where measurement_id=resolved_id;
    update public.execution_contract_measurements set period_start=p_period_start,period_end=p_period_end,status='draft',rejection_reason=null,rejected_by=null,rejected_at=null,updated_by=auth.uid(),updated_at=now() where id=resolved_id;
  end if;

  for item in select value from jsonb_array_elements(p_items) loop
    current_qty:=coalesce(nullif(item->>'current_quantity','')::numeric,0);
    if current_qty<=0 then continue; end if;
    select * into ci from public.execution_service_contract_items where id=nullif(item->>'contract_item_id','')::uuid and contract_id=c.id and company_id=p_company_id and project_id=p_project_id;
    if ci.id is null then raise exception 'Um dos itens não pertence ao contrato selecionado.'; end if;
    previous_qty:=coalesce(ci.measured_quantity,0);
    if previous_qty+current_qty>ci.contracted_quantity+0.000001 then raise exception 'A quantidade acumulada do item % ultrapassa o contratado.',ci.service_code; end if;
    current_amount:=round(current_qty*ci.unit_price,2); gross:=gross+current_amount; n:=n+1;
    insert into public.execution_contract_measurement_items(company_id,project_id,measurement_id,contract_id,contract_item_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,previous_approved_quantity,current_quantity,accumulated_quantity,unit_price,previous_approved_amount,current_amount,accumulated_amount,progress_percent,notes,sort_order)
    values(p_company_id,p_project_id,resolved_id,c.id,ci.id,ci.service_id,ci.location_id,ci.service_code,ci.service_name,ci.location_name,ci.unit_snapshot,ci.contracted_quantity,previous_qty,current_qty,previous_qty+current_qty,ci.unit_price,ci.measured_value,current_amount,ci.measured_value+current_amount,round(((previous_qty+current_qty)/ci.contracted_quantity)*100,4),nullif(trim(coalesce(item->>'notes','')),''),n);
  end loop;
  if n=0 or gross<=0 then raise exception 'Informe ao menos uma quantidade medida com valor maior que zero.'; end if;
  contractual_retention:=round(gross*coalesce(c.retention_percent,0)/100,2);
  guarantee_retention:=round(gross*coalesce(c.guarantee_percent,0)/100,2);
  deductions:=contractual_retention+guarantee_retention+greatest(coalesce(p_tax_withholding,0),0)+greatest(coalesce(p_advance_deduction,0),0)+greatest(coalesce(p_other_discount,0),0);
  net:=gross-deductions;
  if net<0 then raise exception 'As retenções e descontos não podem superar o valor bruto medido.'; end if;
  update public.execution_contract_measurements set
    gross_amount=gross,contractual_retention_percent=c.retention_percent,contractual_retention_amount=contractual_retention,
    guarantee_retention_percent=c.guarantee_percent,guarantee_retention_amount=guarantee_retention,
    tax_withholding_amount=greatest(coalesce(p_tax_withholding,0),0),advance_deduction_amount=greatest(coalesce(p_advance_deduction,0),0),other_discount_amount=greatest(coalesce(p_other_discount,0),0),
    total_deductions=deductions,net_amount=net,notes=nullif(trim(coalesce(p_notes,'')),''),contractor_notes=nullif(trim(coalesce(p_contractor_notes,'')),''),updated_by=auth.uid(),updated_at=now()
  where id=resolved_id;
  insert into public.execution_contract_measurement_audit(company_id,project_id,measurement_id,action,new_status,details,changed_by)
  values(p_company_id,p_project_id,resolved_id,case when p_measurement_id is null then 'created' else 'updated' end,'draft',jsonb_build_object('gross_amount',gross,'net_amount',net),auth.uid());
  return resolved_id;
end; $$;

create or replace function public.submit_execution_contract_measurement(p_company_id uuid,p_project_id uuid,p_measurement_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare m public.execution_contract_measurements%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.measurements.submit') then raise exception 'Sem permissão para enviar medições.'; end if;
  select * into m from public.execution_contract_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id for update;
  if m.id is null or m.status not in ('draft','rejected') then raise exception 'Medição não disponível para envio.'; end if;
  if m.gross_amount<=0 or not exists(select 1 from public.execution_contract_measurement_items where measurement_id=m.id) then raise exception 'A medição precisa possuir itens e valor bruto maior que zero.'; end if;
  update public.execution_contract_measurements set status='submitted',submitted_by=auth.uid(),submitted_at=now(),rejection_reason=null,rejected_by=null,rejected_at=null,updated_by=auth.uid(),updated_at=now() where id=m.id;
  insert into public.execution_contract_measurement_audit(company_id,project_id,measurement_id,action,previous_status,new_status,changed_by) values(p_company_id,p_project_id,m.id,'submitted',m.status,'submitted',auth.uid());
  return 'submitted';
end; $$;

create or replace function public.approve_execution_contract_measurement(p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare m public.execution_contract_measurements%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.measurements.approve') then raise exception 'Sem permissão para aprovar medições.'; end if;
  select * into m from public.execution_contract_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id for update;
  if m.id is null or m.status<>'submitted' then raise exception 'Medição não disponível para aprovação.'; end if;
  update public.execution_contract_measurements set status='approved',approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=auth.uid(),updated_at=now() where id=m.id;
  perform public.refresh_execution_service_contract_measurements(m.contract_id);
  insert into public.execution_contract_measurement_audit(company_id,project_id,measurement_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,m.id,'approved','submitted','approved',nullif(trim(coalesce(p_notes,'')),''),auth.uid());
  return 'approved';
end; $$;

create or replace function public.reject_execution_contract_measurement(p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare m public.execution_contract_measurements%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.measurements.approve') then raise exception 'Sem permissão para rejeitar medições.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo da rejeição.'; end if;
  select * into m from public.execution_contract_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id for update;
  if m.id is null or m.status<>'submitted' then raise exception 'Medição não disponível para rejeição.'; end if;
  update public.execution_contract_measurements set status='rejected',rejected_by=auth.uid(),rejected_at=now(),rejection_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=m.id;
  insert into public.execution_contract_measurement_audit(company_id,project_id,measurement_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,m.id,'rejected','submitted','rejected',trim(p_reason),auth.uid());
  return 'rejected';
end; $$;

create or replace function public.cancel_execution_contract_measurement(p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_reason text)
returns text language plpgsql security definer set search_path=public as $$
declare m public.execution_contract_measurements%rowtype; begin
  if not public.has_company_permission(p_company_id,'execution.measurements.cancel') then raise exception 'Sem permissão para cancelar medições.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into m from public.execution_contract_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id for update;
  if m.id is null or m.status not in ('draft','rejected') then raise exception 'Somente medições não aprovadas podem ser canceladas.'; end if;
  update public.execution_contract_measurements set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),cancellation_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() where id=m.id;
  insert into public.execution_contract_measurement_audit(company_id,project_id,measurement_id,action,previous_status,new_status,reason,changed_by) values(p_company_id,p_project_id,m.id,'cancelled',m.status,'cancelled',trim(p_reason),auth.uid());
  return 'cancelled';
end; $$;

create or replace function public.send_execution_contract_measurement_to_finance(
  p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_invoice_number text,p_invoice_date date,p_invoice_gross_amount numeric,p_due_date date,p_payment_method text,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare m public.execution_contract_measurements%rowtype; c public.execution_service_contracts%rowtype; payable uuid; begin
  if not public.has_company_permission(p_company_id,'execution.measurements.finance') then raise exception 'Sem permissão para integrar a medição ao financeiro.'; end if;
  select * into m from public.execution_contract_measurements where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id for update;
  if m.id is null or m.status<>'approved' then raise exception 'Somente medições aprovadas podem ser enviadas ao financeiro.'; end if;
  if m.payable_id is not null then raise exception 'Esta medição já possui conta a pagar vinculada.'; end if;
  if nullif(trim(coalesce(p_invoice_number,'')),'') is null or p_invoice_date is null or p_due_date is null then raise exception 'Informe número, emissão e vencimento da nota.'; end if;
  if coalesce(p_invoice_gross_amount,0)<=0 then raise exception 'Informe o valor bruto da nota fiscal.'; end if;
  select * into c from public.execution_service_contracts where id=m.contract_id;
  insert into public.payables(company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,installment_label,notes,origin,source_system,source_id,created_by)
  values(p_company_id,p_project_id,m.supplier_id,trim(p_invoice_number),'Serviço',nullif(trim(coalesce(p_payment_method,'')),''),p_due_date,m.net_amount,'open',m.measurement_number,concat_ws(E'\n',nullif(trim(coalesce(p_notes,'')),''),'Contrato '||c.contract_number||' · Medição '||m.measurement_number||' · bruto '||m.gross_amount||' · deduções '||m.total_deductions),'manual','elos_os','measurement:'||m.id::text,auth.uid()) returning id into payable;
  update public.execution_contract_measurements set status='invoiced',invoice_number=trim(p_invoice_number),invoice_date=p_invoice_date,invoice_gross_amount=p_invoice_gross_amount,payable_id=payable,sent_to_finance_by=auth.uid(),sent_to_finance_at=now(),updated_by=auth.uid(),updated_at=now() where id=m.id;
  perform public.refresh_execution_service_contract_measurements(m.contract_id);
  insert into public.execution_contract_measurement_audit(company_id,project_id,measurement_id,action,previous_status,new_status,details,changed_by) values(p_company_id,p_project_id,m.id,'sent_to_finance','approved','invoiced',jsonb_build_object('payable_id',payable,'invoice_number',trim(p_invoice_number),'net_amount',m.net_amount),auth.uid());
  return payable;
end; $$;

create or replace function public.sync_contract_measurement_from_payable()
returns trigger language plpgsql security definer set search_path=public as $$
declare measurement_id uuid; contract_id uuid; begin
  if new.source_system='elos_os' and coalesce(new.source_id,'') like 'measurement:%' then
    begin measurement_id:=replace(new.source_id,'measurement:','')::uuid; exception when others then return new; end;
    select m.contract_id into contract_id from public.execution_contract_measurements m where m.id=measurement_id;
    if new.status='paid' then
      update public.execution_contract_measurements set status='paid',paid_amount=coalesce(new.paid_amount,new.amount),paid_at=coalesce(new.paid_at::date,current_date),updated_at=now() where id=measurement_id and status in ('invoiced','paid');
      if contract_id is not null then perform public.refresh_execution_service_contract_measurements(contract_id); end if;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists sync_contract_measurement_from_payable_trigger on public.payables;
create trigger sync_contract_measurement_from_payable_trigger after insert or update of status,paid_amount,paid_at on public.payables for each row execute function public.sync_contract_measurement_from_payable();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('contract-measurement-documents','contract-measurement-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists contract_measurement_documents_select on storage.objects;
create policy contract_measurement_documents_select on storage.objects for select to authenticated using(bucket_id='contract-measurement-documents' and exists(select 1 from public.company_memberships m where m.user_id=auth.uid() and m.status='active' and m.company_id::text=(storage.foldername(name))[1]));
drop policy if exists contract_measurement_documents_insert on storage.objects;
create policy contract_measurement_documents_insert on storage.objects for insert to authenticated with check(bucket_id='contract-measurement-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.measurements.manage'));
drop policy if exists contract_measurement_documents_delete on storage.objects;
create policy contract_measurement_documents_delete on storage.objects for delete to authenticated using(bucket_id='contract-measurement-documents' and public.has_company_permission(((storage.foldername(name))[1])::uuid,'execution.measurements.manage'));

grant select,insert,update,delete on public.execution_contract_measurements,public.execution_contract_measurement_items,public.execution_contract_measurement_documents,public.execution_contract_measurement_audit to authenticated;
grant execute on function public.refresh_execution_service_contract_measurements(uuid) to authenticated;
grant execute on function public.save_execution_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb) to authenticated;
grant execute on function public.submit_execution_contract_measurement(uuid,uuid,uuid) to authenticated;
grant execute on function public.approve_execution_contract_measurement(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reject_execution_contract_measurement(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.cancel_execution_contract_measurement(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.send_execution_contract_measurement_to_finance(uuid,uuid,uuid,text,date,numeric,date,text,text) to authenticated;

commit;
