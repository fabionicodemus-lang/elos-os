-- Elos IA · Financeiro
-- Amplia a fila de ações revisáveis para processos financeiros existentes.
begin;

alter table public.ai_action_proposals drop constraint if exists ai_action_proposals_action_type_check;
alter table public.ai_action_proposals add constraint ai_action_proposals_action_type_check check (action_type in (
  'procurement_supplier_offer','execution_contract_measurement',
  'finance_payable_create','finance_payable_payment','finance_receivable_receipt','finance_manual_invoice',
  'finance_tax_obligation','finance_tax_payable','finance_bank_transaction','finance_bank_transfer',
  'finance_bank_reconciliation','finance_correction_index'
));

create or replace function public.ai_action_required_permission(p_action_type text)
returns text language sql immutable set search_path=''
as $$
  select case p_action_type
    when 'procurement_supplier_offer' then 'procurement.quotations.manage'
    when 'execution_contract_measurement' then 'execution.measurements.manage'
    when 'finance_payable_create' then 'payables.manage'
    when 'finance_payable_payment' then 'payables.manage'
    when 'finance_receivable_receipt' then 'receivables.manage'
    when 'finance_manual_invoice' then 'finance.manual_invoices.manage'
    when 'finance_tax_obligation' then 'finance.taxes.manage'
    when 'finance_tax_payable' then 'finance.taxes.manage'
    when 'finance_bank_transaction' then 'finance.bank_accounts.manage'
    when 'finance_bank_transfer' then 'finance.bank_accounts.transfer'
    when 'finance_bank_reconciliation' then 'finance.bank_accounts.reconcile'
    when 'finance_correction_index' then 'indices.manage'
    else null
  end
$$;

create or replace function public.ai_execute_action_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  p public.ai_action_proposals%rowtype;
  offer_id uuid; measurement_id uuid; invoice_id uuid; obligation_id uuid; transaction_id uuid; result_id uuid;
  v_result jsonb; v_installment jsonb; v_supplier uuid; v_group uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into p from public.ai_action_proposals where id=p_proposal_id for update;
  if p.id is null then raise exception 'Ação preparada não encontrada.'; end if;
  if p.status='executed' then return coalesce(p.result,'{}'::jsonb); end if;
  if p.status<>'pending_review' then raise exception 'Esta ação não está mais aguardando revisão.'; end if;
  if p.expires_at<=now() then update public.ai_action_proposals set status='expired',updated_at=now() where id=p.id; raise exception 'Esta ação expirou. Peça para a Elos IA preparar novamente.'; end if;
  if not public.has_company_permission(p.company_id,p.required_permission) then raise exception 'Você não possui a permissão necessária para executar esta ação.'; end if;
  if coalesce((p.preview->>'blocked')::boolean,false) then raise exception '%',coalesce(p.preview->>'blockReason','Esta ação possui uma divergência que exige tratamento manual.'); end if;

  if p.action_type='procurement_supplier_offer' then
    offer_id := public.save_procurement_material_supplier_offer(p.company_id,p.project_id,(p.payload->>'quotationId')::uuid,(p.payload->>'supplierId')::uuid,p.payload->>'proposalNumber',nullif(p.payload->>'proposalDate','')::date,nullif(p.payload->>'validityDate','')::date,p.payload->>'paymentTerms',nullif(p.payload->>'deliveryDays','')::integer,p.payload->>'freightTerms',p.payload->>'warrantyTerms',p.payload->>'notes',p.payload->'items');
    v_result:=jsonb_build_object('kind','procurement_supplier_offer','offer_id',offer_id,'quotation_id',p.payload->>'quotationId','supplier_id',p.payload->>'supplierId');
  elsif p.action_type='execution_contract_measurement' then
    measurement_id := public.save_execution_contract_measurement(p.company_id,p.project_id,null,(p.payload->>'contractId')::uuid,(p.payload->>'periodStart')::date,(p.payload->>'periodEnd')::date,coalesce((p.payload->>'taxWithholding')::numeric,0),coalesce((p.payload->>'advanceDeduction')::numeric,0),coalesce((p.payload->>'otherDiscount')::numeric,0),p.payload->>'notes',p.payload->>'contractorNotes',p.payload->'items',false);
    v_result:=jsonb_build_object('kind','execution_contract_measurement','measurement_id',measurement_id,'contract_id',p.payload->>'contractId');
  elsif p.action_type='finance_payable_create' then
    if p.project_id is null then raise exception 'A conta a pagar exige uma obra.'; end if;
    v_supplier := (p.payload->>'supplierId')::uuid;
    if not exists(select 1 from public.suppliers s where s.id=v_supplier and s.company_id=p.company_id and s.status='active') then raise exception 'Fornecedor inválido ou inativo.'; end if;
    v_group:=gen_random_uuid();
    for v_installment in select * from jsonb_array_elements(coalesce(p.payload->'installments','[]'::jsonb)) loop
      if coalesce((v_installment->>'amount')::numeric,0)<=0 or nullif(v_installment->>'due_date','') is null then raise exception 'Parcela inválida.'; end if;
      insert into public.payables(company_id,project_id,supplier_id,document,fiscal_class,payment_method,due_date,amount,status,installment_label,notes,origin,source_system,source_id,created_by)
      values(p.company_id,p.project_id,v_supplier,nullif(p.payload->>'document',''),nullif(p.payload->>'fiscalClass',''),nullif(v_installment->>'payment_method',''),(v_installment->>'due_date')::date,(v_installment->>'amount')::numeric,'open',v_installment->>'label',nullif(p.payload->>'notes',''),'manual','elos_ia','ai_payable:'||p.id::text||':'||coalesce(v_installment->>'label',v_group::text),auth.uid());
    end loop;
    v_result:=jsonb_build_object('kind','finance_payable_create','proposal_id',p.id);
  elsif p.action_type='finance_payable_payment' then
    perform public.pay_finance_payable(p.company_id,p.project_id,(p.payload->>'payableId')::uuid,(p.payload->>'accountId')::uuid,(p.payload->>'paidAt')::date,(p.payload->>'paidAmount')::numeric);
    v_result:=jsonb_build_object('kind','finance_payable_payment','payable_id',p.payload->>'payableId');
  elsif p.action_type='finance_receivable_receipt' then
    perform public.receive_finance_receivable(p.company_id,p.project_id,(p.payload->>'receivableId')::uuid,(p.payload->>'accountId')::uuid,(p.payload->>'paidAt')::date,(p.payload->>'paidAmount')::numeric);
    v_result:=jsonb_build_object('kind','finance_receivable_receipt','receivable_id',p.payload->>'receivableId');
  elsif p.action_type='finance_manual_invoice' then
    if p.project_id is null then raise exception 'A nota manual exige uma obra.'; end if;
    invoice_id := public.save_and_post_finance_manual_invoice(p.company_id,p.project_id,null,(p.payload->>'supplierId')::uuid,nullif(p.payload->>'contractId','')::uuid,nullif(p.payload->>'measurementId','')::uuid,nullif(p.payload->>'materialReceiptId','')::uuid,p.payload->>'documentType',p.payload->>'documentNumber',p.payload->>'series',(p.payload->>'issueDate')::date,nullif(p.payload->>'competenceDate','')::date,p.payload->>'notes',p.payload->'retentions',p.payload->'items',p.payload->'installments');
    v_result:=jsonb_build_object('kind','finance_manual_invoice','invoice_id',invoice_id);
  elsif p.action_type='finance_tax_obligation' then
    if p.project_id is null then raise exception 'A obrigação fiscal exige uma obra.'; end if;
    insert into public.finance_tax_obligations(company_id,project_id,tax_type_id,competence_date,reference,due_date,principal_amount,interest_amount,penalty_amount,other_amount,discount_amount,document_number,payment_code,barcode,notes,status,created_by,updated_at)
    values(p.company_id,p.project_id,(p.payload->>'taxTypeId')::uuid,(p.payload->>'competenceDate')::date,coalesce(p.payload->>'reference',''),(p.payload->>'dueDate')::date,coalesce((p.payload->>'principalAmount')::numeric,0),coalesce((p.payload->>'interestAmount')::numeric,0),coalesce((p.payload->>'penaltyAmount')::numeric,0),coalesce((p.payload->>'otherAmount')::numeric,0),coalesce((p.payload->>'discountAmount')::numeric,0),nullif(p.payload->>'documentNumber',''),nullif(p.payload->>'paymentCode',''),nullif(p.payload->>'barcode',''),nullif(p.payload->>'notes',''),'scheduled',auth.uid(),now()) returning id into obligation_id;
    v_result:=jsonb_build_object('kind','finance_tax_obligation','obligation_id',obligation_id);
  elsif p.action_type='finance_tax_payable' then
    result_id := public.finance_generate_tax_payable((p.payload->>'obligationId')::uuid);
    v_result:=jsonb_build_object('kind','finance_tax_payable','obligation_id',p.payload->>'obligationId','payable_id',result_id);
  elsif p.action_type='finance_bank_transaction' then
    transaction_id := public.post_finance_bank_transaction(p.company_id,nullif(p.payload->>'projectId','')::uuid,(p.payload->>'accountId')::uuid,(p.payload->>'transactionDate')::date,nullif(p.payload->>'competenceDate','')::date,p.payload->>'direction',p.payload->>'transactionType',p.payload->>'description',p.payload->>'document',p.payload->>'counterparty',(p.payload->>'amount')::numeric,p.payload->>'notes');
    v_result:=jsonb_build_object('kind','finance_bank_transaction','transaction_id',transaction_id);
  elsif p.action_type='finance_bank_transfer' then
    result_id := public.transfer_finance_bank_accounts(p.company_id,nullif(p.payload->>'projectId','')::uuid,(p.payload->>'fromAccountId')::uuid,(p.payload->>'toAccountId')::uuid,(p.payload->>'transferDate')::date,(p.payload->>'amount')::numeric,p.payload->>'description');
    v_result:=jsonb_build_object('kind','finance_bank_transfer','transfer_id',result_id);
  elsif p.action_type='finance_bank_reconciliation' then
    perform public.reconcile_finance_bank_transaction(p.company_id,(p.payload->>'transactionId')::uuid,(p.payload->>'reconciliationDate')::date,p.payload->>'reference');
    v_result:=jsonb_build_object('kind','finance_bank_reconciliation','transaction_id',p.payload->>'transactionId');
  elsif p.action_type='finance_correction_index' then
    insert into public.correction_index_values(company_id,correction_index_id,reference_month,value,notes,created_by,updated_at)
    values(p.company_id,(p.payload->>'correctionIndexId')::uuid,(p.payload->>'referenceMonth')::date,(p.payload->>'value')::numeric,nullif(p.payload->>'notes',''),auth.uid(),now())
    on conflict(company_id,correction_index_id,reference_month) do update set value=excluded.value,notes=excluded.notes,updated_at=now();
    v_result:=jsonb_build_object('kind','finance_correction_index','correction_index_id',p.payload->>'correctionIndexId','reference_month',p.payload->>'referenceMonth');
  else
    raise exception 'Tipo de ação não suportado.';
  end if;

  update public.ai_action_proposals set status='executed',reviewed_by=auth.uid(),reviewed_at=now(),executed_by=auth.uid(),executed_at=now(),result=v_result,last_error=null,updated_at=now() where id=p.id;
  return v_result;
exception when others then raise;
end;
$$;

revoke execute on function public.ai_execute_action_proposal(uuid) from public,anon;
grant execute on function public.ai_execute_action_proposal(uuid) to authenticated;

commit;
