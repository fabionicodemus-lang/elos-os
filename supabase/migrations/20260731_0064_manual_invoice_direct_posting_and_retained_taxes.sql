-- Elos OS — Notas Manuais · lançamento direto, retenções automáticas e edição segura
-- A nota passa a gerar o Contas a Pagar sem etapa de aprovação. Retenções geram
-- obrigações fiscais próprias, com regra configurável por obra e bloqueio após pagamento.

begin;

alter table public.finance_tax_types
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists retention_key text,
  add column if not exists due_trigger text not null default 'issue_date',
  add column if not exists due_rule text not null default 'manual',
  add column if not exists due_day integer,
  add column if not exists due_month_offset integer not null default 1,
  add column if not exists due_days_after_event integer not null default 0,
  add column if not exists business_day_adjustment text not null default 'none',
  add column if not exists auto_generate_payable boolean not null default true;

do $$ begin
  alter table public.finance_tax_types
    add constraint finance_tax_types_retention_key_check
    check(retention_key is null or retention_key in('inss','iss','irrf','pis','cofins','csll','other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.finance_tax_types
    add constraint finance_tax_types_due_trigger_check
    check(due_trigger in('issue_date','competence_date','first_installment_due_date'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.finance_tax_types
    add constraint finance_tax_types_due_rule_check
    check(due_rule in('manual','fixed_day','days_after_event'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.finance_tax_types
    add constraint finance_tax_types_due_values_check
    check(
      due_month_offset between 0 and 24
      and due_days_after_event between 0 and 730
      and (due_day is null or due_day between 1 and 31)
      and (due_rule<>'fixed_day' or due_day is not null)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.finance_tax_types
    add constraint finance_tax_types_business_day_check
    check(business_day_adjustment in('none','previous_weekday','next_weekday'));
exception when duplicate_object then null; end $$;

create unique index if not exists finance_tax_types_retention_scope_unique_idx
  on public.finance_tax_types(company_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid),retention_key)
  where retention_key is not null and status='active';
create index if not exists finance_tax_types_project_retention_idx
  on public.finance_tax_types(company_id,project_id,retention_key,status);

alter table public.finance_manual_invoices
  add column if not exists material_receipt_id uuid references public.procurement_material_receipts(id) on delete restrict,
  add column if not exists posted_by uuid references auth.users(id),
  add column if not exists posted_at timestamptz;

create unique index if not exists finance_manual_invoice_receipt_unique_idx
  on public.finance_manual_invoices(material_receipt_id)
  where material_receipt_id is not null and status<>'cancelled';

alter table public.finance_tax_obligations
  add column if not exists manual_invoice_id uuid references public.finance_manual_invoices(id) on delete cascade,
  add column if not exists retention_key text,
  add column if not exists source_system text,
  add column if not exists source_id text;

do $$ begin
  alter table public.finance_tax_obligations
    add constraint finance_tax_obligations_retention_key_check
    check(retention_key is null or retention_key in('inss','iss','irrf','pis','cofins','csll','other'));
exception when duplicate_object then null; end $$;

create unique index if not exists finance_tax_obligations_source_unique_idx
  on public.finance_tax_obligations(company_id,source_system,source_id)
  where source_system is not null and source_id is not null;
create index if not exists finance_tax_obligations_manual_invoice_idx
  on public.finance_tax_obligations(manual_invoice_id,retention_key);

-- Compatibilidade: tipos já cadastrados com códigos conhecidos recebem o vínculo,
-- sem sobrescrever regras que tenham sido configuradas manualmente.
update public.finance_tax_types set retention_key='inss'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('INSS','INSSRET','INSSRETIDO');
update public.finance_tax_types set retention_key='iss'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('ISS','ISSQN','ISSRET','ISSRETIDO');
update public.finance_tax_types set retention_key='irrf'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('IRRF','IRRET','IRRFRETIDO');
update public.finance_tax_types set retention_key='pis'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('PIS','PISRET','PISRETIDO');
update public.finance_tax_types set retention_key='cofins'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('COFINS','COFINSRET','COFINSRETIDO');
update public.finance_tax_types set retention_key='csll'
where retention_key is null and upper(regexp_replace(code,'[^A-Z0-9]','','g')) in('CSLL','CSLLRET','CSLLRETIDO');

-- Sugestões federais iniciais. Permanecem editáveis e podem ser substituídas por
-- regras específicas da obra. ISS e outros tributos continuam exigindo configuração.
update public.finance_tax_types set
  due_trigger='issue_date',due_rule='fixed_day',due_day=20,due_month_offset=1,
  business_day_adjustment='previous_weekday',auto_generate_payable=true
where retention_key in('inss','irrf') and due_rule='manual';
update public.finance_tax_types set
  due_trigger='first_installment_due_date',due_rule='fixed_day',due_day=20,due_month_offset=1,
  business_day_adjustment='previous_weekday',auto_generate_payable=true
where retention_key in('pis','cofins','csll') and due_rule='manual';

create or replace function public.finance_adjust_weekend(p_date date,p_mode text)
returns date
language plpgsql
immutable
as $$
declare v_date date:=p_date;
begin
  if p_mode='previous_weekday' then
    while extract(isodow from v_date) in(6,7) loop v_date:=v_date-1; end loop;
  elsif p_mode='next_weekday' then
    while extract(isodow from v_date) in(6,7) loop v_date:=v_date+1; end loop;
  end if;
  return v_date;
end;
$$;

create or replace function public.finance_compute_tax_due_date(
  p_tax_type_id uuid,
  p_issue_date date,
  p_competence_date date,
  p_first_installment_due_date date
) returns date
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_type public.finance_tax_types%rowtype;
  v_base date;
  v_month date;
  v_last_day integer;
  v_due date;
begin
  select * into v_type from public.finance_tax_types where id=p_tax_type_id and status='active';
  if v_type.id is null then raise exception 'Regra de retenção não encontrada ou inativa.'; end if;

  v_base:=case v_type.due_trigger
    when 'issue_date' then p_issue_date
    when 'competence_date' then coalesce(p_competence_date,p_issue_date)
    when 'first_installment_due_date' then coalesce(p_first_installment_due_date,p_issue_date)
    else p_issue_date end;
  if v_base is null then raise exception 'Não foi possível determinar a data base da retenção %.',v_type.code; end if;

  if v_type.due_rule='days_after_event' then
    v_due:=v_base+v_type.due_days_after_event;
  elsif v_type.due_rule='fixed_day' then
    v_month:=(date_trunc('month',v_base)::date + make_interval(months=>v_type.due_month_offset))::date;
    v_last_day:=extract(day from (v_month+interval '1 month-1 day'))::integer;
    v_due:=make_date(extract(year from v_month)::integer,extract(month from v_month)::integer,least(v_type.due_day,v_last_day));
  else
    raise exception 'Configure o prazo automático da retenção % antes de lançar a nota.',v_type.code;
  end if;

  return public.finance_adjust_weekend(v_due,v_type.business_day_adjustment);
end;
$$;

create or replace function public.finance_generate_tax_payable(p_obligation_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_obligation public.finance_tax_obligations%rowtype;
  v_type public.finance_tax_types%rowtype;
  v_payable public.payables%rowtype;
  v_payable_id uuid;
  v_document text;
begin
  select * into v_obligation from public.finance_tax_obligations where id=p_obligation_id for update;
  if v_obligation.id is null then raise exception 'Obrigação fiscal não encontrada.'; end if;
  if not public.has_company_permission(v_obligation.company_id,'finance.taxes.manage')
     and not public.has_company_permission(v_obligation.company_id,'finance.manual_invoices.manage') then
    raise exception 'Você não possui permissão para gerar esta conta tributária.';
  end if;
  if v_obligation.total_amount<=0 then raise exception 'O valor da obrigação precisa ser maior que zero.'; end if;

  select * into v_type from public.finance_tax_types
  where id=v_obligation.tax_type_id and company_id=v_obligation.company_id and status='active';
  if v_type.id is null then raise exception 'O tributo está inativo ou não pertence à empresa.'; end if;

  select * into v_payable from public.payables where id=v_obligation.payable_id for update;
  if v_payable.id is not null and (v_payable.status='paid' or v_payable.paid_at is not null) then
    raise exception 'A obrigação tributária já possui pagamento e não pode ser alterada.';
  end if;

  v_document:=coalesce(
    nullif(v_obligation.document_number,''),
    concat_ws(' ',nullif(v_type.document_prefix,''),v_type.code,to_char(v_obligation.competence_date,'MM/YYYY'))
  );

  insert into public.payables(
    company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,
    installment_label,notes,origin,source_system,source_id,created_by
  ) values(
    v_obligation.company_id,v_obligation.project_id,v_type.authority_supplier_id,v_document,
    v_type.fiscal_class,v_type.payment_method,v_obligation.due_date,v_obligation.total_amount,'open',
    concat('Competência ',to_char(v_obligation.competence_date,'MM/YYYY'),case when v_obligation.reference<>'' then ' · '||v_obligation.reference else '' end),
    concat_ws(E'\n',v_type.name,nullif(v_obligation.payment_code,''),nullif(v_obligation.notes,'')),
    'tax','elos_taxes','tax_obligation:'||v_obligation.id::text,auth.uid()
  ) on conflict(company_id,source_system,source_id) do update set
    supplier_id=excluded.supplier_id,
    document=excluded.document,
    fiscal_class=excluded.fiscal_class,
    payment_method=excluded.payment_method,
    due_date=case when public.payables.status='open' then excluded.due_date else public.payables.due_date end,
    amount=case when public.payables.status='open' then excluded.amount else public.payables.amount end,
    installment_label=excluded.installment_label,
    notes=excluded.notes
  returning id into v_payable_id;

  update public.finance_tax_obligations set
    payable_id=v_payable_id,status='payable_generated',updated_at=now()
  where id=v_obligation.id;
  return v_payable_id;
end;
$$;

create or replace function public.manual_invoice_mutability(
  p_company_id uuid,p_project_id uuid,p_invoice_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_invoice public.finance_manual_invoices%rowtype;
  v_has_payment boolean:=false;
  v_has_receipt boolean:=false;
begin
  select * into v_invoice from public.finance_manual_invoices
  where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id;
  if v_invoice.id is null then
    return jsonb_build_object('mutable',false,'reason','Nota manual não encontrada.','has_payment',false,'has_receipt',false);
  end if;

  v_has_receipt:=v_invoice.material_receipt_id is not null;
  select exists(
    select 1 from public.payables p
    where p.company_id=v_invoice.company_id
      and p.source_system='elos_os'
      and p.source_id like 'manual_invoice:'||v_invoice.id::text||':%'
      and (p.status='paid' or p.paid_at is not null)
  ) or exists(
    select 1 from public.finance_tax_obligations o
    left join public.payables p on p.id=o.payable_id
    where o.manual_invoice_id=v_invoice.id
      and (o.status='paid' or p.status='paid' or p.paid_at is not null)
  ) into v_has_payment;

  return jsonb_build_object(
    'mutable',not v_has_payment and not v_has_receipt and v_invoice.status<>'cancelled',
    'has_payment',v_has_payment,
    'has_receipt',v_has_receipt,
    'reason',case
      when v_invoice.status='cancelled' then 'A nota foi cancelada.'
      when v_has_payment then 'A nota possui pagamento do fornecedor ou de imposto vinculado.'
      when v_has_receipt then 'A nota possui recebimento de material vinculado.'
      else null end
  );
end;
$$;

create or replace function public.remove_manual_invoice_generated_finance(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_invoice public.finance_manual_invoices%rowtype;
begin
  select * into v_invoice from public.finance_manual_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Nota manual não encontrada.'; end if;

  if exists(
    select 1 from public.payables p
    where p.company_id=v_invoice.company_id and p.source_system='elos_os'
      and p.source_id like 'manual_invoice:'||v_invoice.id::text||':%'
      and (p.status='paid' or p.paid_at is not null)
  ) or exists(
    select 1 from public.finance_tax_obligations o
    join public.payables p on p.id=o.payable_id
    where o.manual_invoice_id=v_invoice.id and (o.status='paid' or p.status='paid' or p.paid_at is not null)
  ) then
    raise exception 'A nota possui pagamento vinculado e não pode ser alterada ou excluída.';
  end if;

  if v_invoice.measurement_id is not null then
    update public.execution_contract_measurements set
      status='approved',invoice_number=null,invoice_date=null,invoice_gross_amount=null,
      payable_id=null,sent_to_finance_at=null,updated_at=now()
    where id=v_invoice.measurement_id and status='invoiced';
  end if;

  delete from public.payables p
  using public.finance_tax_obligations o
  where o.manual_invoice_id=v_invoice.id and p.id=o.payable_id and p.status<>'paid';
  delete from public.finance_tax_obligations where manual_invoice_id=v_invoice.id;

  delete from public.payables
  where company_id=v_invoice.company_id and source_system='elos_os'
    and source_id like 'manual_invoice:'||v_invoice.id::text||':%'
    and status<>'paid';
  update public.finance_manual_invoice_installments set payable_id=null,updated_at=now()
  where invoice_id=v_invoice.id;

  update public.finance_manual_invoices set
    status='draft',approved_by=null,approved_at=null,approval_notes=null,
    posted_by=null,posted_at=null,updated_at=now(),updated_by=auth.uid()
  where id=v_invoice.id;
end;
$$;

create or replace function public.sync_manual_invoice_retained_taxes(p_invoice_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.finance_manual_invoices%rowtype;
  v_type public.finance_tax_types%rowtype;
  v_entry record;
  v_amount numeric(18,2);
  v_first_due date;
  v_due date;
  v_obligation_id uuid;
  v_count integer:=0;
begin
  select * into v_invoice from public.finance_manual_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Nota manual não encontrada.'; end if;

  if exists(
    select 1 from public.finance_tax_obligations o
    left join public.payables p on p.id=o.payable_id
    where o.manual_invoice_id=v_invoice.id
      and (o.status='paid' or p.status='paid' or p.paid_at is not null)
  ) then raise exception 'Os impostos desta nota já possuem pagamento e não podem ser recalculados.'; end if;

  delete from public.payables p using public.finance_tax_obligations o
  where o.manual_invoice_id=v_invoice.id and p.id=o.payable_id and p.status<>'paid';
  delete from public.finance_tax_obligations where manual_invoice_id=v_invoice.id;

  select min(due_date) into v_first_due from public.finance_manual_invoice_installments where invoice_id=v_invoice.id;

  for v_entry in
    select * from jsonb_each_text(jsonb_build_object(
      'inss',v_invoice.inss_amount,'iss',v_invoice.iss_amount,'irrf',v_invoice.irrf_amount,
      'pis',v_invoice.pis_amount,'cofins',v_invoice.cofins_amount,'csll',v_invoice.csll_amount,
      'other',v_invoice.other_retention_amount
    ))
  loop
    v_amount:=coalesce(v_entry.value::numeric,0);
    if v_amount<=0 then continue; end if;

    select * into v_type from public.finance_tax_types
    where company_id=v_invoice.company_id and retention_key=v_entry.key and status='active'
      and (project_id=v_invoice.project_id or project_id is null)
    order by (project_id=v_invoice.project_id) desc,updated_at desc
    limit 1;
    if v_type.id is null then
      raise exception 'Configure a retenção % para esta obra em Notas Manuais → Configurar retenções.',upper(v_entry.key);
    end if;
    if v_type.authority_supplier_id is null then
      raise exception 'A retenção % não possui órgão favorecido configurado.',upper(v_entry.key);
    end if;

    v_due:=public.finance_compute_tax_due_date(v_type.id,v_invoice.issue_date,v_invoice.competence_date,v_first_due);
    insert into public.finance_tax_obligations(
      company_id,project_id,tax_type_id,competence_date,reference,due_date,principal_amount,
      document_number,notes,status,created_by,manual_invoice_id,retention_key,source_system,source_id
    ) values(
      v_invoice.company_id,v_invoice.project_id,v_type.id,date_trunc('month',coalesce(v_invoice.competence_date,v_invoice.issue_date))::date,
      v_invoice.registry_number||' · '||v_invoice.document_number||' · '||upper(v_entry.key),v_due,v_amount,
      concat_ws('-',nullif(v_type.document_prefix,''),v_invoice.document_number),
      'Retenção gerada automaticamente pela nota manual '||v_invoice.registry_number,
      'scheduled',auth.uid(),v_invoice.id,v_entry.key,'manual_invoice_retention',
      'manual_invoice:'||v_invoice.id::text||':'||v_entry.key
    ) returning id into v_obligation_id;

    perform public.finance_generate_tax_payable(v_obligation_id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Aprovação permanece disponível por compatibilidade, mas o lançamento direto pode
-- executá-la com a permissão de gestão, sem uma segunda ação humana.
create or replace function public.approve_finance_manual_invoice(p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_notes text)
returns text language plpgsql security definer set search_path=public as $$
declare
  v_invoice public.finance_manual_invoices%rowtype; v_installment public.finance_manual_invoice_installments%rowtype;
  v_payable_id uuid; v_first_payable_id uuid; v_installment_count integer;
begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.approve')
     and not public.has_company_permission(p_company_id,'finance.manual_invoices.manage') then
    raise exception 'Sem permissão para lançar notas manuais.';
  end if;
  select * into v_invoice from public.finance_manual_invoices
  where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_invoice.id is null or v_invoice.status<>'submitted' then raise exception 'Documento não disponível para lançamento.'; end if;
  perform public.refresh_finance_manual_invoice(v_invoice.id);
  select * into v_invoice from public.finance_manual_invoices where id=v_invoice.id;
  if v_invoice.item_count=0 then raise exception 'O documento não possui itens.'; end if;
  if round(v_invoice.payment_total,2)<>round(v_invoice.net_amount,2) then raise exception 'As parcelas não coincidem com o valor líquido.'; end if;
  select count(*) into v_installment_count from public.finance_manual_invoice_installments where invoice_id=v_invoice.id;
  if v_invoice.measurement_id is not null and v_installment_count<>1 then
    raise exception 'Documentos vinculados a medição devem possuir uma única parcela.';
  end if;

  for v_installment in select * from public.finance_manual_invoice_installments where invoice_id=v_invoice.id order by sequence_no loop
    insert into public.payables(
      company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,
      installment_label,notes,origin,source_system,source_id,created_by
    ) values(
      p_company_id,p_project_id,v_invoice.supplier_id,
      concat(v_invoice.document_number,case when v_invoice.series is not null then '/'||v_invoice.series else '' end),
      v_invoice.document_type,v_installment.payment_method,v_installment.due_date,v_installment.amount,'open',
      concat(v_installment.sequence_no,' / ',v_installment_count),
      concat_ws(E'\n',v_invoice.registry_number,v_invoice.notes,case when v_invoice.contract_id is not null then 'Contrato vinculado' end,case when v_invoice.measurement_id is not null then 'Medição vinculada' end),
      'manual_invoice','elos_os','manual_invoice:'||v_invoice.id::text||':'||v_installment.id::text,auth.uid()
    ) on conflict(company_id,source_system,source_id) do update set
      due_date=case when public.payables.status='open' then excluded.due_date else public.payables.due_date end,
      amount=case when public.payables.status='open' then excluded.amount else public.payables.amount end,
      payment_method=case when public.payables.status='open' then excluded.payment_method else public.payables.payment_method end,
      document=excluded.document,fiscal_class=excluded.fiscal_class,notes=excluded.notes
    returning id into v_payable_id;
    if v_first_payable_id is null then v_first_payable_id:=v_payable_id; end if;
    update public.finance_manual_invoice_installments set payable_id=v_payable_id,updated_at=now() where id=v_installment.id;
  end loop;

  update public.finance_manual_invoices set status='approved',approved_by=auth.uid(),approved_at=now(),
    approval_notes=nullif(trim(coalesce(p_notes,'')),''),posted_by=auth.uid(),posted_at=now(),updated_by=auth.uid(),updated_at=now()
  where id=v_invoice.id;

  if v_invoice.measurement_id is not null then
    update public.execution_contract_measurements set
      status='invoiced',invoice_number=v_invoice.document_number,invoice_date=v_invoice.issue_date,
      invoice_gross_amount=v_invoice.gross_amount,payable_id=v_first_payable_id,sent_to_finance_at=now(),updated_at=now()
    where id=v_invoice.measurement_id and status='approved' and payable_id is null;
    if not found then raise exception 'A medição já foi enviada ao financeiro ou mudou de status.'; end if;
  end if;

  insert into public.finance_manual_invoice_audit(company_id,project_id,invoice_id,action,previous_status,new_status,reason,changed_by)
  values(p_company_id,p_project_id,v_invoice.id,'posted','submitted','approved',nullif(trim(coalesce(p_notes,'')),''),auth.uid());
  return 'approved';
end;
$$;

create or replace function public.save_and_post_finance_manual_invoice(
  p_company_id uuid,p_project_id uuid,p_invoice_id uuid,p_supplier_id uuid,p_contract_id uuid,p_measurement_id uuid,
  p_material_receipt_id uuid,p_document_type text,p_document_number text,p_series text,p_issue_date date,
  p_competence_date date,p_notes text,p_retentions jsonb,p_items jsonb,p_installments jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_mutability jsonb;
  v_receipt public.procurement_material_receipts%rowtype;
begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.manage') then
    raise exception 'Sem permissão para lançar notas manuais.';
  end if;

  if p_invoice_id is not null then
    v_mutability:=public.manual_invoice_mutability(p_company_id,p_project_id,p_invoice_id);
    if not coalesce((v_mutability->>'mutable')::boolean,false) then
      raise exception '%',coalesce(v_mutability->>'reason','A nota não pode mais ser alterada.');
    end if;
    perform public.remove_manual_invoice_generated_finance(p_invoice_id);
  end if;

  if p_material_receipt_id is not null then
    select * into v_receipt from public.procurement_material_receipts
    where id=p_material_receipt_id and company_id=p_company_id and project_id=p_project_id and status='approved';
    if v_receipt.id is null then raise exception 'O recebimento de material não está aprovado ou não pertence à obra.'; end if;
    if v_receipt.supplier_id<>p_supplier_id then raise exception 'O recebimento de material pertence a outro fornecedor.'; end if;
    if exists(select 1 from public.finance_electronic_invoices where receipt_id=v_receipt.id and status<>'cancelled') then
      raise exception 'O recebimento já está vinculado a uma Nota Eletrônica.';
    end if;
    if exists(select 1 from public.finance_manual_invoices where material_receipt_id=v_receipt.id and id is distinct from p_invoice_id and status<>'cancelled') then
      raise exception 'O recebimento já está vinculado a outra Nota Manual.';
    end if;
  end if;

  v_id:=public.save_finance_manual_invoice(
    p_company_id,p_project_id,p_invoice_id,p_supplier_id,p_contract_id,p_measurement_id,
    p_document_type,p_document_number,p_series,p_issue_date,p_competence_date,p_notes,
    p_retentions,p_items,p_installments,true
  );

  update public.finance_manual_invoices set material_receipt_id=p_material_receipt_id,updated_at=now(),updated_by=auth.uid()
  where id=v_id;
  perform public.approve_finance_manual_invoice(p_company_id,p_project_id,v_id,'Lançamento automático ao salvar a nota.');
  perform public.sync_manual_invoice_retained_taxes(v_id);

  insert into public.finance_manual_invoice_audit(company_id,project_id,invoice_id,action,new_status,details,changed_by)
  values(p_company_id,p_project_id,v_id,'direct_posted','approved',
    jsonb_build_object('material_receipt_id',p_material_receipt_id,'tax_obligations',(select count(*) from public.finance_tax_obligations where manual_invoice_id=v_id)),auth.uid());
  return v_id;
end;
$$;

create or replace function public.delete_finance_manual_invoice(
  p_company_id uuid,p_project_id uuid,p_invoice_id uuid
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice public.finance_manual_invoices%rowtype;
  v_mutability jsonb;
begin
  if not public.has_company_permission(p_company_id,'finance.manual_invoices.manage')
     and not public.has_company_permission(p_company_id,'finance.manual_invoices.cancel') then
    raise exception 'Sem permissão para excluir notas manuais.';
  end if;
  select * into v_invoice from public.finance_manual_invoices
  where id=p_invoice_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_invoice.id is null then raise exception 'Nota manual não encontrada.'; end if;

  v_mutability:=public.manual_invoice_mutability(p_company_id,p_project_id,p_invoice_id);
  if not coalesce((v_mutability->>'mutable')::boolean,false) then
    raise exception '%',coalesce(v_mutability->>'reason','A nota não pode ser excluída.');
  end if;

  perform public.remove_manual_invoice_generated_finance(v_invoice.id);
  delete from public.finance_manual_invoices where id=v_invoice.id;
  return 'deleted';
end;
$$;

-- Perfis que já gerenciam notas deixam de depender de uma aprovação separada.
insert into public.role_permissions(role_id,permission_key,allowed)
select role_id,'finance.manual_invoices.approve',true
from public.role_permissions
where permission_key='finance.manual_invoices.manage' and allowed=true
on conflict(role_id,permission_key) do update set allowed=true;

update public.permissions set
  description='Criar, editar e lançar notas manuais diretamente no Contas a Pagar'
where key='finance.manual_invoices.manage';
update public.permissions set
  description='Permissão legada de conferência de notas manuais'
where key='finance.manual_invoices.approve';
update public.permissions set
  description='Excluir notas manuais sem pagamentos ou recebimentos vinculados'
where key='finance.manual_invoices.cancel';

grant select,insert,update,delete on public.finance_tax_obligations to authenticated;
grant execute on function public.finance_adjust_weekend(date,text) to authenticated;
grant execute on function public.finance_compute_tax_due_date(uuid,date,date,date) to authenticated;
grant execute on function public.manual_invoice_mutability(uuid,uuid,uuid) to authenticated;
grant execute on function public.remove_manual_invoice_generated_finance(uuid) to authenticated;
grant execute on function public.sync_manual_invoice_retained_taxes(uuid) to authenticated;
grant execute on function public.save_and_post_finance_manual_invoice(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,date,date,text,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.delete_finance_manual_invoice(uuid,uuid,uuid) to authenticated;

commit;
