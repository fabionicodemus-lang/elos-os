-- Elos IA: medição física e reprogramação assistidas, revisadas e atômicas.
-- Não atualiza a linha de base; usa a RPC oficial de execução para todas as atividades.
begin;

alter table public.ai_action_proposals drop constraint if exists ai_action_proposals_action_type_check;
alter table public.ai_action_proposals add constraint ai_action_proposals_action_type_check check (action_type in (
  'procurement_supplier_offer','execution_contract_measurement',
  'finance_payable_create','finance_payable_payment','finance_receivable_receipt','finance_manual_invoice',
  'finance_tax_obligation','finance_tax_payable','finance_bank_transaction','finance_bank_transfer',
  'finance_bank_reconciliation','finance_correction_index','execution_schedule_update'
));

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
    else null
  end
$$;

-- Executor independente: não substitui nem altera o executor dos módulos financeiros.
create or replace function public.ai_execute_schedule_action_proposal(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  p public.ai_action_proposals%rowtype;
  b public.engineering_schedule_baselines%rowtype;
  a public.engineering_schedule_activities%rowtype;
  latest public.engineering_schedule_progress_measurements%rowtype;
  item jsonb;
  measurement_day date;
  progress numeric;
  previous_progress numeric;
  start_day date;
  finish_day date;
  real_start date;
  real_finish date;
  n integer := 0;
  tracking_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Sua sessão expirou.'; end if;
  select * into p from public.ai_action_proposals where id=p_proposal_id for update;
  if p.id is null or p.action_type<>'execution_schedule_update' then raise exception 'Esta ação não é uma atualização de cronograma.'; end if;
  if p.status='executed' then return coalesce(p.result,'{}'::jsonb); end if;
  if p.status<>'pending_review' or p.expires_at<=now() then raise exception 'Esta proposta não está disponível; prepare uma nova revisão.'; end if;
  if p.project_id is null or p.required_permission<>'execution.schedule.manage'
     or not public.has_company_permission(p.company_id,'execution.schedule.manage') then
    raise exception 'Seu papel não pode atualizar o cronograma desta empresa.';
  end if;
  if coalesce((p.preview->>'blocked')::boolean,false) then raise exception 'A proposta está bloqueada para revisão.'; end if;
  if coalesce(jsonb_typeof(p.payload->'items'),'null')<>'array'
    or jsonb_array_length(p.payload->'items') not between 1 and 25 then
    raise exception 'A proposta deve conter entre uma e 25 atividades.';
  end if;
  measurement_day:=(p.payload->>'measurementDate')::date;
  if measurement_day is null or measurement_day > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Data da medição inválida ou futura.';
  end if;
  select * into b from public.engineering_schedule_baselines
  where id=(p.payload->>'baselineId')::uuid and company_id=p.company_id and project_id=p.project_id;
  if b.id is null or b.status<>'approved' then raise exception 'A linha de base não está aprovada ou não pertence à obra.'; end if;

  -- Lock e escrita na ordem do cartão. Qualquer divergência reverte a operação inteira.
  for item in select * from jsonb_array_elements(p.payload->'items') loop
    if item->>'measurementDate' is distinct from measurement_day::text then raise exception 'As atividades devem pertencer à mesma data de medição.'; end if;
    select * into a from public.engineering_schedule_activities
      where id=(item->>'activityId')::uuid and baseline_id=b.id and company_id=p.company_id
      and project_id=p.project_id and record_status='active' for update;
    if a.id is null or a.code is distinct from item->>'code' then raise exception 'Atividade não identificada ou alterada após preparar o cartão.'; end if;
    if exists(select 1 from jsonb_array_elements(p.payload->'items') v
      where v->>'activityId'=item->>'activityId' and v<>item)
      then raise exception 'Atividade repetida no cartão.'; end if;

    select * into latest from public.engineering_schedule_progress_measurements m
      where m.company_id=p.company_id and m.project_id=p.project_id and m.baseline_id=b.id
        and m.activity_id=a.id and m.voided_at is null
      order by m.measurement_date desc,m.updated_at desc,m.id desc limit 1;
    if latest.id is distinct from nullif(item->>'expectedLatestId','')::uuid
       or latest.updated_at is distinct from nullif(item->>'expectedLatestUpdatedAt','')::timestamptz then
      raise exception 'Houve nova medição/reprogramação para %; solicite à Elos IA um novo cartão antes de confirmar.',a.code;
    end if;
    if latest.measurement_date is not null and measurement_day<=latest.measurement_date then
      raise exception 'Já existe uma medição nesta data ou posterior para %. Utilize novo período ou retifique o histórico.',a.code;
    end if;
    -- Também bloqueia medições anuladas na mesma data. A RPC manual faz upsert:
    -- sem esta guarda, uma revisão por IA poderia ressuscitar um lançamento anulado.
    if exists(select 1 from public.engineering_schedule_progress_measurements m
      where m.company_id=p.company_id and m.project_id=p.project_id and m.baseline_id=b.id
        and m.activity_id=a.id and m.measurement_date=measurement_day) then
      raise exception 'Já existe lançamento ativo ou anulado em % para %. Revise pelo histórico, sem sobrescrever.',measurement_day,a.code;
    end if;

    progress:=(item->>'progressPercent')::numeric;
    previous_progress:=coalesce(latest.progress_percent,0);
    start_day:=(item->>'currentStart')::date;
    finish_day:=(item->>'currentFinish')::date;
    real_start:=nullif(item->>'actualStart','')::date;
    real_finish:=nullif(item->>'actualFinish','')::date;
    if progress is null or progress<previous_progress or progress>100 or progress<0 then
      raise exception 'Percentual inválido ou regressivo para %.',a.code;
    end if;
    if start_day is null or finish_day is null or finish_day<start_day then
      raise exception 'Datas reprogramadas inválidas para %.',a.code;
    end if;
    if real_start is not null and real_start>measurement_day then raise exception 'Início real futuro para %.',a.code; end if;
    if real_finish is not null and (progress<>100 or real_finish>measurement_day or real_start is null or real_finish<real_start) then
      raise exception 'Conclusão real inválida para %.',a.code;
    end if;
    if latest.id is not null and (latest.current_start is distinct from (item->>'previousStart')::date
      or latest.current_finish is distinct from (item->>'previousFinish')::date
      or latest.progress_percent is distinct from (item->>'previousPercent')::numeric) then
      raise exception 'O cronograma foi alterado para %; gere novo cartão.',a.code;
    end if;
    if latest.id is null and (a.planned_start is distinct from (item->>'previousStart')::date
      or a.planned_finish is distinct from (item->>'previousFinish')::date) then
      raise exception 'O planejamento foi alterado para %; gere novo cartão.',a.code;
    end if;
    tracking_id:=public.record_execution_schedule_progress(
      p.company_id,p.project_id,b.id,a.id,measurement_day,progress,
      coalesce((item->>'actualQuantity')::numeric,0),
      coalesce((item->>'actualCost')::numeric,0),
      nullif(item->>'teamCount','')::numeric,
      start_day,finish_day,real_start,real_finish,
      'Elos IA · ação '||p.id::text||' · '||coalesce(nullif(item->>'notes',''), 'Atualização do cronograma confirmada pelo usuário.')
    );
    n:=n+1;
  end loop;
  v_result:=jsonb_build_object('kind','execution_schedule_update','count',n,'baseline_id',b.id,'measurement_date',measurement_day);
  update public.ai_action_proposals set status='executed',reviewed_by=auth.uid(),reviewed_at=now(),
     executed_by=auth.uid(),executed_at=now(),result=v_result,last_error=null,updated_at=now() where id=p.id;
  return v_result;
end; $$;

revoke all on function public.ai_execute_schedule_action_proposal(uuid) from public,anon;
grant execute on function public.ai_execute_schedule_action_proposal(uuid) to authenticated;

commit;
