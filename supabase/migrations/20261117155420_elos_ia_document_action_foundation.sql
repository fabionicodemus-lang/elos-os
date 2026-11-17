-- Document preparation only: no business record is created by this migration or RPC.
begin;

-- Privileged implementations live outside the exposed public API schema.
create schema if not exists elos_ia_private;
revoke all on schema elos_ia_private from public,anon;
grant usage on schema elos_ia_private to authenticated;

alter table public.ai_action_proposals add column if not exists document_fingerprint text;
alter table public.ai_action_attachments add column if not exists content_sha256 text
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
alter table public.ai_action_attachments add column if not exists retained_at timestamptz;
alter table public.ai_action_attachments alter column expires_at drop not null;

alter table public.ai_action_proposals drop constraint if exists ai_action_proposals_action_type_check;
alter table public.ai_action_proposals add constraint ai_action_proposals_action_type_check check (action_type in (
  'procurement_supplier_offer','execution_contract_measurement',
  'finance_payable_create','finance_payable_payment','finance_receivable_receipt','finance_manual_invoice',
  'finance_tax_obligation','finance_tax_payable','finance_bank_transaction','finance_bank_transfer',
  'finance_bank_reconciliation','finance_correction_index','execution_schedule_update',
  'commercial_sale_create','procurement_quotation_create','execution_contract_create'
));

create unique index if not exists ai_document_action_executed_once_idx
on public.ai_action_proposals(company_id,action_type,document_fingerprint)
where document_fingerprint is not null and status='executed';

-- Document cards can only be prepared by the atomic RPC below; direct inserts
-- must not forge an executed result or associate an unrelated source.
drop policy if exists ai_action_proposals_insert on public.ai_action_proposals;
create policy ai_action_proposals_insert on public.ai_action_proposals for insert to authenticated
with check (
  created_by=(select auth.uid())
  and action_type not in ('commercial_sale_create','procurement_quotation_create','execution_contract_create')
  and public.has_company_permission(company_id,'ai.assistant.use')
  and public.has_company_permission(company_id,required_permission)
);
drop policy if exists ai_action_proposals_select on public.ai_action_proposals;
create policy ai_action_proposals_select on public.ai_action_proposals for select to authenticated
using (
  (created_by=(select auth.uid()) or public.has_company_permission(company_id,required_permission))
  and (action_type not in ('commercial_sale_create','procurement_quotation_create','execution_contract_create')
    or (public.has_company_permission(company_id,'ai.assistant.use') and public.has_company_permission(company_id,required_permission)))
);

drop policy if exists ai_action_attachments_insert on public.ai_action_attachments;
create policy ai_action_attachments_insert on public.ai_action_attachments for insert to authenticated
with check (
  uploaded_by=(select auth.uid()) and proposal_id is null and retained_at is null
  and expires_at is not null and expires_at>now()
  and public.has_company_permission(company_id,'ai.assistant.use')
  and split_part(storage_path,'/',1)=company_id::text
  and split_part(storage_path,'/',2)=(select auth.uid())::text
  and position('..' in storage_path)=0
  and (project_id is null or exists(select 1 from public.projects pr where pr.id=project_id and pr.company_id=ai_action_attachments.company_id))
);
-- The source ACL is evaluated with current membership even for its uploader.
-- This narrowly scoped predicate avoids owner-only Storage policies outliving a role.
create or replace function elos_ia_private.ai_can_read_action_source(p_storage_path text)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare a public.ai_action_attachments%rowtype; p public.ai_action_proposals%rowtype;
  source_company uuid;
begin
  if auth.uid() is null then return false; end if;
  if split_part(p_storage_path,'/',1)!~'^[0-9a-fA-F-]{36}$' then return false; end if;
  begin source_company:=split_part(p_storage_path,'/',1)::uuid; exception when invalid_text_representation then return false; end;
  if not public.has_company_permission(source_company,'ai.assistant.use') then return false; end if;
  select * into a from public.ai_action_attachments where company_id=source_company and storage_path=p_storage_path;
  if a.id is null then return split_part(p_storage_path,'/',2)=auth.uid()::text; end if;
  if split_part(p_storage_path,'/',2)<>a.uploaded_by::text then return false; end if;
  if a.proposal_id is null then return a.uploaded_by=auth.uid(); end if;
  select * into p from public.ai_action_proposals where id=a.proposal_id and company_id=a.company_id;
  return p.id is not null and public.has_company_permission(p.company_id,p.required_permission);
end;
$$;
revoke execute on function elos_ia_private.ai_can_read_action_source(text) from public,anon;
grant execute on function elos_ia_private.ai_can_read_action_source(text) to authenticated;
create or replace function public.ai_can_read_action_source(p_storage_path text)
returns boolean language sql stable security invoker set search_path=''
as $$select elos_ia_private.ai_can_read_action_source(p_storage_path)$$;
revoke execute on function public.ai_can_read_action_source(text) from public,anon;
grant execute on function public.ai_can_read_action_source(text) to authenticated;

drop policy if exists ai_action_attachments_select on public.ai_action_attachments;
create policy ai_action_attachments_select on public.ai_action_attachments for select to authenticated
using (public.ai_can_read_action_source(storage_path));

drop policy if exists ai_action_storage_select on storage.objects;
create policy ai_action_storage_select on storage.objects for select to authenticated
using (bucket_id='ai-action-attachments' and public.ai_can_read_action_source(name));

create or replace function public.ai_action_required_permission(p_action_type text)
returns text language sql immutable set search_path=''
as $$
  select case p_action_type
    when 'procurement_supplier_offer' then 'procurement.quotations.manage'
    when 'execution_contract_measurement' then 'execution.measurements.manage'
    when 'execution_schedule_update' then 'execution.schedule.manage'
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
    when 'commercial_sale_create' then 'commercial.proposals.convert'
    when 'procurement_quotation_create' then 'procurement.quotations.manage'
    when 'execution_contract_create' then 'execution.contract_procurement.contract'
    else null
  end
$$;

-- A card ID identifies an immutable version, including the document fingerprint.
create or replace function public.ai_action_proposal_before_write()
returns trigger language plpgsql set search_path=''
as $$
declare required text;
begin
  required:=public.ai_action_required_permission(new.action_type);
  if required is null then raise exception 'Tipo de ação do Elos IA não suportado.'; end if;
  new.required_permission:=required;
  new.updated_at:=now();
  if tg_op='UPDATE' and (
    old.company_id<>new.company_id or old.project_id is distinct from new.project_id
    or old.turn_id<>new.turn_id or old.action_type<>new.action_type
    or old.payload<>new.payload or old.preview<>new.preview or old.created_by<>new.created_by
    or old.document_fingerprint is distinct from new.document_fingerprint
  ) then raise exception 'A proposta preparada pelo Elos IA é imutável.'; end if;
  return new;
end;
$$;

create or replace function public.ai_protect_document_source()
returns trigger language plpgsql set search_path=''
as $$
begin
  if old.proposal_id is not null and exists (
    select 1 from public.ai_action_proposals p where p.id=old.proposal_id
    and p.action_type in ('commercial_sale_create','procurement_quotation_create','execution_contract_create')
  ) and (
    old.proposal_id is distinct from new.proposal_id or old.company_id<>new.company_id
    or old.storage_path<>new.storage_path or old.file_name<>new.file_name
    or old.uploaded_by<>new.uploaded_by or old.turn_id<>new.turn_id
    or old.content_sha256 is distinct from new.content_sha256
    or old.file_size<>new.file_size or old.mime_type is distinct from new.mime_type
  ) then raise exception 'O documento vinculado ao rascunho é imutável.'; end if;
  return new;
end;
$$;
create trigger ai_protect_document_source_trg before update on public.ai_action_attachments
for each row execute function public.ai_protect_document_source();
revoke execute on function public.ai_protect_document_source() from public,anon,authenticated;

-- Atomic prepare + source link. The model receives no executor tool.
create or replace function elos_ia_private.ai_prepare_document_action(
  p_company_id uuid,p_project_id uuid,p_turn_id uuid,p_persona text,p_action_type text,
  p_title text,p_summary text,p_payload jsonb,p_preview jsonb,p_file_name text,p_document_key text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare a public.ai_action_attachments%rowtype; p public.ai_action_proposals%rowtype;
  required text; fingerprint text; document_key text; duplicate_id uuid; n integer;
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou.'; end if;
  if p_action_type not in ('commercial_sale_create','procurement_quotation_create','execution_contract_create')
     or p_action_type is null then raise exception 'Tipo de documento não suportado.'; end if;
  if p_persona not in ('diretoria','engenharia','financeiro') or p_persona is null
     or (p_action_type='commercial_sale_create' and p_persona='engenharia')
     or (p_action_type='execution_contract_create' and p_persona='financeiro')
     then raise exception 'Esta persona não prepara esse lançamento.'; end if;
  required:=public.ai_action_required_permission(p_action_type);
  if not public.has_company_permission(p_company_id,'ai.assistant.use')
     or not public.has_company_permission(p_company_id,required)
     then raise exception 'Você não tem permissão para preparar esse lançamento.'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id)
     then raise exception 'Obra não encontrada nesta empresa.'; end if;
  if nullif(btrim(p_title),'') is null or nullif(btrim(p_document_key),'') is null
     or length(p_document_key)>1000 or length(p_title)>300
     or jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_preview) is distinct from 'object'
     or p_preview->>'kind' is distinct from p_action_type
     or p_preview->>'sourceFile' is distinct from p_file_name
     or pg_column_size(p_payload)>524288 or pg_column_size(p_preview)>524288
     then raise exception 'Revise os dados e o documento do rascunho.'; end if;
  select count(*) into n from public.ai_action_attachments
   where company_id=p_company_id and turn_id=p_turn_id and uploaded_by=auth.uid() and file_name=p_file_name;
  if n<>1 then raise exception 'Anexe um documento de origem com nome único nesta pergunta.'; end if;
  select * into a from public.ai_action_attachments
   where company_id=p_company_id and turn_id=p_turn_id and uploaded_by=auth.uid() and file_name=p_file_name for update;
  if a.proposal_id is not null then raise exception 'Este anexo já está vinculado a outro rascunho. Reenvie para preparar uma nova versão.'; end if;
  if a.content_sha256 is null or a.expires_at is null or a.expires_at<=now() or a.retained_at is not null
     or a.storage_path not like p_company_id::text||'/'||auth.uid()::text||'/%'
     or not exists(select 1 from storage.objects where bucket_id='ai-action-attachments' and name=a.storage_path)
     then raise exception 'O documento não está disponível para conferência. Anexe novamente.'; end if;
  document_key:=case p_action_type
    when 'commercial_sale_create' then p_payload->>'unitId'
    when 'execution_contract_create' then p_payload->>'competitionId'
    else (p_payload->>'supplierId')||':'||(
      select string_agg(item->>'request_item_id',',' order by item->>'request_item_id')
      from jsonb_array_elements(p_payload->'items') item
    ) end;
  if nullif(document_key,'') is null or document_key is distinct from p_document_key then
    raise exception 'A identificação do documento não corresponde ao lançamento.';
  end if;
  fingerprint:=a.content_sha256||':'||md5(document_key);
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_action_type||':'||fingerprint,0));
  select id into duplicate_id from public.ai_action_proposals
   where company_id=p_company_id and action_type=p_action_type and document_fingerprint=fingerprint
     and (status='executed' or (status='pending_review' and expires_at>now())) limit 1;
  if duplicate_id is not null then
    raise exception 'Este documento já possui lançamento ou revisão pendente (%). Confira o registro antes de reenviar.',duplicate_id;
  end if;
  if p_action_type='commercial_sale_create' then
    if public.ai_validate_sale_document_preview(p_company_id,p_project_id,p_payload,p_preview) is distinct from true then
      raise exception 'A revisão da venda não corresponde aos dados do lançamento. Prepare novamente.';
    end if;
  else
    if public.ai_validate_procurement_document_preview(p_company_id,p_project_id,p_action_type,p_payload,p_preview) is distinct from true then
      raise exception 'A revisão do documento não corresponde aos dados do lançamento. Prepare novamente.';
    end if;
  end if;
  insert into public.ai_action_proposals(company_id,project_id,turn_id,persona,action_type,required_permission,
    title,summary,payload,preview,created_by,document_fingerprint,expires_at)
  values(p_company_id,p_project_id,p_turn_id,p_persona,p_action_type,required,
    case p_action_type when 'commercial_sale_create' then 'Venda por documento' when 'procurement_quotation_create' then 'Cotação por documento' else 'Contrato de empreiteiro por documento' end,
    p_file_name,p_payload,p_preview,auth.uid(),fingerprint,a.expires_at)
  returning * into p;
  update public.ai_action_attachments set proposal_id=p.id where id=a.id;
  return jsonb_build_object('id',p.id,'title',p.title,'summary',p.summary);
end;
$$;
revoke execute on function elos_ia_private.ai_prepare_document_action(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text) from public,anon;
grant execute on function elos_ia_private.ai_prepare_document_action(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text) to authenticated;
create or replace function public.ai_prepare_document_action(p_company_id uuid,p_project_id uuid,p_turn_id uuid,p_persona text,p_action_type text,p_title text,p_summary text,p_payload jsonb,p_preview jsonb,p_file_name text,p_document_key text)
returns jsonb language sql security invoker set search_path=''
as $$select elos_ia_private.ai_prepare_document_action(p_company_id,p_project_id,p_turn_id,p_persona,p_action_type,p_title,p_summary,p_payload,p_preview,p_file_name,p_document_key)$$;
revoke execute on function public.ai_prepare_document_action(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text) from public,anon;
grant execute on function public.ai_prepare_document_action(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text) to authenticated;

-- Uploads are immutable to authenticated users: no UPDATE policy and no DELETE
-- policy. This also closes Storage deletion races while a card is being confirmed.
-- An authorized retention job may remove rejected/expired, unretained sources;
-- it must never remove retained_at IS NOT NULL records/documents.
drop policy if exists ai_action_storage_delete on storage.objects;

comment on column public.ai_action_attachments.retained_at is 'Documento de ação confirmada: sem expiração automática; segue a política de retenção documental da empresa.';
comment on column public.ai_action_proposals.document_fingerprint is 'SHA256 do arquivo + chave de negócio para impedir importação repetida no mesmo fluxo.';

-- The current application uses the atomic executors exclusively. The obsolete
-- claim/finish/fail API could otherwise fabricate confirmation without a write.
revoke execute on function public.ai_claim_action_proposal(uuid) from public,anon,authenticated;
revoke execute on function public.ai_finish_action_proposal(uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.ai_fail_action_proposal(uuid,text) from public,anon,authenticated;

-- Preserve legacy behavior while closing replay and cross-endpoint bypasses.
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
  if p.action_type in ('commercial_sale_create','procurement_quotation_create','execution_contract_create') then
    raise exception 'Confirme este documento pelo executor específico de documentos.';
  end if;
  if not public.has_company_permission(p.company_id,p.required_permission) then
    raise exception 'Você não possui a permissão necessária para executar esta ação.';
  end if;
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


create or replace function public.ai_reject_action_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare p public.ai_action_proposals%rowtype;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into p from public.ai_action_proposals where id=p_proposal_id for update;
  if p.id is null or p.status<>'pending_review' then raise exception 'Ação não disponível para rejeição.'; end if;
  if p.action_type in ('commercial_sale_create','procurement_quotation_create','execution_contract_create')
     and (not public.has_company_permission(p.company_id,'ai.assistant.use')
       or not public.has_company_permission(p.company_id,p.required_permission)) then
    raise exception 'Sem permissão para descartar este documento.';
  end if;
  if p.created_by<>auth.uid() and not public.has_company_permission(p.company_id,p.required_permission) then
    raise exception 'Sem permissão para rejeitar esta ação.';
  end if;
  update public.ai_action_proposals
     set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
   where id=p.id;
end;
$$;


-- Legacy attachment APIs cannot add or replace documentary sources.
create or replace function public.ai_link_action_attachments(p_turn_id uuid,p_proposal_id uuid)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare p public.ai_action_proposals%rowtype; n integer;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  select * into p from public.ai_action_proposals
  where id=p_proposal_id and turn_id=p_turn_id and created_by=auth.uid();
  if p.id is null then raise exception 'Proposta de ação não encontrada.'; end if;
  if p.action_type in ('commercial_sale_create','procurement_quotation_create','execution_contract_create') then
    raise exception 'A fonte deste documento é vinculada somente durante a preparação atômica.';
  end if;
  update public.ai_action_attachments
     set proposal_id=p.id
   where company_id=p.company_id and turn_id=p_turn_id
     and uploaded_by=auth.uid() and proposal_id is null;
  get diagnostics n=row_count;
  return n;
end;
$$;


create or replace function public.ai_link_action_attachment(p_turn_id uuid,p_proposal_id uuid,p_file_name text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare p public.ai_action_proposals%rowtype; attachment_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.'; end if;
  if nullif(trim(coalesce(p_file_name,'')),'') is null then return null; end if;
  select * into p from public.ai_action_proposals
  where id=p_proposal_id and turn_id=p_turn_id and created_by=auth.uid();
  if p.id is null then raise exception 'Proposta de ação não encontrada.'; end if;
  if p.action_type in ('commercial_sale_create','procurement_quotation_create','execution_contract_create') then
    raise exception 'A fonte deste documento é vinculada somente durante a preparação atômica.';
  end if;

  select a.id into attachment_id
  from public.ai_action_attachments a
  where a.company_id=p.company_id and a.turn_id=p_turn_id and a.uploaded_by=auth.uid()
    and a.file_name=p_file_name and a.proposal_id is null
  order by a.created_at,a.id
  limit 1
  for update;

  if attachment_id is null then raise exception 'Arquivo de origem não encontrado nesta pergunta.'; end if;
  update public.ai_action_attachments set proposal_id=p.id where id=attachment_id;
  return attachment_id;
end;
$$;

commit;
