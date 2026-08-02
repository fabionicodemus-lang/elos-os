-- Elos OS — Parcelamento universal · correções de runtime

begin;

create or replace function public.validate_manual_invoice_installment_balance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice_id uuid;
  v_net numeric(18,2);
  v_sum numeric(18,2);
  v_count integer;
begin
  v_invoice_id:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select net_amount into v_net from public.finance_manual_invoices where id=v_invoice_id;
  if not found then return null; end if;

  select count(*),coalesce(round(sum(amount),2),0) into v_count,v_sum
  from public.finance_manual_invoice_installments where invoice_id=v_invoice_id;
  if v_count=0 then raise exception 'Informe ao menos uma parcela para o documento manual.'; end if;
  if round(v_sum,2)<>round(v_net,2) then
    raise exception 'A soma das parcelas (%) precisa coincidir exatamente com o valor líquido do documento (%).',v_sum,v_net;
  end if;
  return null;
end;
$$;

create or replace function public.validate_electronic_invoice_installment_balance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invoice_id uuid;
  v_total numeric(18,2);
  v_sum numeric(18,2);
  v_count integer;
begin
  v_invoice_id:=case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select invoice_total into v_total from public.finance_electronic_invoices where id=v_invoice_id;
  if not found then return null; end if;

  select count(*),coalesce(round(sum(amount),2),0) into v_count,v_sum
  from public.finance_electronic_invoice_installments where invoice_id=v_invoice_id;
  if v_count=0 then raise exception 'Informe ao menos uma parcela para a NF-e.'; end if;
  if round(v_sum,2)<>round(v_total,2) then
    raise exception 'A soma das parcelas (%) precisa coincidir exatamente com o valor total da NF-e (%).',v_sum,v_total;
  end if;
  return null;
end;
$$;

create or replace function public.validate_work_order_installment_balance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_work_order_id uuid;
  v_mode text;
  v_authorized numeric(18,2);
  v_sum numeric(18,2);
  v_count integer;
begin
  v_work_order_id:=case when tg_op='DELETE' then old.work_order_id else new.work_order_id end;
  select financial_mode,authorized_value into v_mode,v_authorized
  from public.execution_work_orders where id=v_work_order_id;
  if not found or v_mode='none' then return null; end if;

  select count(*),coalesce(round(sum(amount),2),0) into v_count,v_sum
  from public.execution_work_order_installments where work_order_id=v_work_order_id;
  if v_count=0 then raise exception 'Informe ao menos uma parcela para a ordem de serviço.'; end if;
  if round(v_sum,2)<>round(v_authorized,2) then
    raise exception 'A soma das parcelas (%) precisa coincidir exatamente com o valor autorizado da O.S. (%).',v_sum,v_authorized;
  end if;
  return null;
end;
$$;

create or replace function public.generate_execution_work_order_payables(
  p_company_id uuid,p_project_id uuid,p_work_order_id uuid
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.execution_work_orders%rowtype;
  v_installment public.execution_work_order_installments%rowtype;
  v_payable_id uuid;
  v_count integer:=0;
begin
  select * into v_order from public.execution_work_orders
  where id=p_work_order_id and company_id=p_company_id and project_id=p_project_id for update;
  if v_order.id is null then raise exception 'Ordem de serviço não encontrada.'; end if;
  if v_order.financial_mode<>'payable_on_acceptance' then return 0; end if;
  if v_order.status<>'finished' then raise exception 'As parcelas da O.S. só podem ser geradas após o aceite técnico.'; end if;
  if round(v_order.payment_total,2)<>round(v_order.accepted_value,2) then
    raise exception 'O valor aceito da O.S. (%) é diferente da programação financeira (%). Ajuste a O.S. antes do aceite.',v_order.accepted_value,v_order.payment_total;
  end if;

  for v_installment in select * from public.execution_work_order_installments where work_order_id=v_order.id order by sequence_no loop
    insert into public.payables(
      company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,installment_label,notes,
      origin,source_system,source_id,created_by
    ) values(
      p_company_id,p_project_id,v_order.supplier_id,v_order.work_order_number,'Ordem de serviço',v_installment.payment_method,
      v_installment.due_date,v_installment.amount,'open',v_installment.sequence_no||' / '||(select count(*) from public.execution_work_order_installments where work_order_id=v_order.id),
      concat_ws(E'\n',v_order.title,v_order.scope_summary,'Gerada automaticamente após o aceite técnico da O.S.'),
      'work_order','elos_work_order','work_order:'||v_order.id::text||':'||v_installment.id::text,auth.uid()
    ) on conflict(company_id,source_system,source_id) do update set
      due_date=case when payables.status='open' then excluded.due_date else payables.due_date end,
      amount=case when payables.status='open' then excluded.amount else payables.amount end,
      payment_method=case when payables.status='open' then excluded.payment_method else payables.payment_method end,
      document=excluded.document
    returning id into v_payable_id;
    update public.execution_work_order_installments set payable_id=v_payable_id,updated_at=now() where id=v_installment.id;
    v_count:=v_count+1;
  end loop;

  update public.execution_work_orders set payables_generated_at=coalesce(payables_generated_at,now()),updated_at=now() where id=v_order.id;
  insert into public.execution_work_order_audit(company_id,project_id,work_order_id,action,details,changed_by)
  values(p_company_id,p_project_id,v_order.id,'payables_generated',jsonb_build_object('count',v_count,'total',v_order.payment_total),auth.uid());
  return v_count;
end;
$$;

commit;
