-- Elos OS — Fase 3 · Aprovação, contas a pagar e estorno

begin;

create or replace function public.approve_execution_contract_measurement(
  p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_notes text
) returns text
language plpgsql security definer set search_path=public as $$
declare
  m public.execution_contract_measurements%rowtype;
  c public.execution_service_contracts%rowtype;
  payable uuid;
  due_date date;
begin
  if not public.has_company_permission(p_company_id,'execution.measurements.approve') then
    raise exception 'Sem permissão para aprovar medições.';
  end if;
  select * into m
  from public.execution_contract_measurements
  where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id
  for update;
  if m.id is null or m.status<>'submitted' then raise exception 'Medição não disponível para aprovação.'; end if;
  if m.payable_id is not null then raise exception 'A medição já possui conta a pagar vinculada.'; end if;

  select * into c
  from public.execution_service_contracts
  where id=m.contract_id and company_id=p_company_id and project_id=p_project_id
  for update;
  if c.id is null then raise exception 'Contrato da medição não encontrado.'; end if;

  due_date:=current_date+coalesce(c.payment_days,0);
  insert into public.payables(
    company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,
    installment_label,notes,origin,source_system,source_id,created_by
  ) values (
    p_company_id,p_project_id,m.supplier_id,m.measurement_number,'Serviço',null,due_date,m.net_amount,'open',
    m.measurement_number,
    concat_ws(E'\n','Contrato '||c.contract_number||' · Medição '||m.measurement_number,
      'Valor bruto '||m.gross_amount||' · retenções/descontos '||m.total_deductions,
      nullif(trim(coalesce(p_notes,'')),'')),
    'manual','elos_os','measurement:'||m.id::text,auth.uid()
  ) returning id into payable;

  update public.execution_contract_measurements set
    status='invoiced',approved_by=auth.uid(),approved_at=now(),approval_notes=nullif(trim(coalesce(p_notes,'')),''),
    payable_id=payable,sent_to_finance_by=auth.uid(),sent_to_finance_at=now(),updated_by=auth.uid(),updated_at=now()
  where id=m.id;

  perform public.refresh_execution_service_contract_measurements(m.contract_id);
  insert into public.execution_contract_measurement_audit(
    company_id,project_id,measurement_id,action,previous_status,new_status,reason,details,changed_by
  ) values (
    p_company_id,p_project_id,m.id,'approved_and_committed','submitted','invoiced',nullif(trim(coalesce(p_notes,'')),''),
    jsonb_build_object('payable_id',payable,'due_date',due_date,'net_amount',m.net_amount),auth.uid()
  );
  return 'invoiced';
end; $$;

create or replace function public.reverse_execution_contract_measurement(
  p_company_id uuid,p_project_id uuid,p_measurement_id uuid,p_reason text
) returns text
language plpgsql security definer set search_path=public as $$
declare
  m public.execution_contract_measurements%rowtype;
  p public.payables%rowtype;
begin
  if not public.has_company_permission(p_company_id,'execution.measurements.reverse') then
    raise exception 'Sem permissão para estornar medições.';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do estorno.'; end if;

  select * into m
  from public.execution_contract_measurements
  where id=p_measurement_id and company_id=p_company_id and project_id=p_project_id
  for update;
  if m.id is null or m.status not in ('approved','invoiced') then
    raise exception 'Somente medições aprovadas e ainda não pagas podem ser estornadas.';
  end if;

  if m.payable_id is not null then
    select * into p
    from public.payables
    where id=m.payable_id and company_id=p_company_id and project_id=p_project_id
    for update;
    if p.id is not null and p.status='paid' then
      raise exception 'A conta a pagar já foi paga. Reverta o pagamento antes de estornar a medição.';
    end if;
    if p.id is not null and p.status='open' then
      update public.payables set status='cancelled',updated_at=now() where id=p.id;
    end if;
  end if;

  update public.execution_contract_measurements set
    status='reversed',reversed_by=auth.uid(),reversed_at=now(),reversal_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now()
  where id=m.id;

  perform public.refresh_execution_service_contract_measurements(m.contract_id);
  insert into public.execution_contract_measurement_audit(
    company_id,project_id,measurement_id,action,previous_status,new_status,reason,details,changed_by
  ) values (
    p_company_id,p_project_id,m.id,'reversed',m.status,'reversed',trim(p_reason),jsonb_build_object('payable_id',m.payable_id),auth.uid()
  );
  return 'reversed';
end; $$;

create or replace function public.sync_contract_measurement_from_payable()
returns trigger language plpgsql security definer set search_path=public as $$
declare measurement_id uuid; contract_id uuid; begin
  if new.source_system='elos_os' and coalesce(new.source_id,'') like 'measurement:%' then
    begin measurement_id:=replace(new.source_id,'measurement:','')::uuid; exception when others then return new; end;
    select m.contract_id into contract_id from public.execution_contract_measurements m where m.id=measurement_id;
    if new.status='paid' then
      update public.execution_contract_measurements
      set status='paid',paid_amount=coalesce(new.paid_amount,new.amount),paid_at=coalesce(new.paid_at::date,current_date),updated_at=now()
      where id=measurement_id and status in ('approved','invoiced','paid');
      if contract_id is not null then perform public.refresh_execution_service_contract_measurements(contract_id); end if;
    end if;
  end if;
  return new;
end; $$;

grant execute on function public.approve_execution_contract_measurement(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reverse_execution_contract_measurement(uuid,uuid,uuid,text) to authenticated;

commit;
