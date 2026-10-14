-- Elos OS — Incorporação · execução financeira de renegociação
-- Reprograma somente parcelas abertas sem pagamentos parciais, preservando recebimentos históricos.
begin;

create or replace function public.commercial_execute_payment_plan_renegotiation(
  p_company_id uuid,
  p_sale_id uuid,
  p_effective_date date,
  p_reason text,
  p_financial_impact numeric,
  p_items jsonb,
  p_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.sales;
  actor uuid:=coalesce(p_user_id,auth.uid());
  current_open numeric:=0;
  new_total numeric:=0;
  expected_total numeric:=0;
  amendment_id uuid;
  before_snapshot jsonb;
  item jsonb;
  item_amount numeric;
  item_due date;
  item_category text;
  item_index uuid;
  seq integer:=0;
  total_items integer;
begin
  if not public.has_company_permission(p_company_id,'commercial.incorporation.approve') then
    raise exception 'Sem permissão para executar renegociação.';
  end if;
  if p_effective_date is null then raise exception 'Informe a data de vigência da renegociação.'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Informe o motivo da renegociação.'; end if;
  if coalesce(jsonb_typeof(p_items),'')<>'array' or jsonb_array_length(p_items) not between 1 and 240 then
    raise exception 'O novo plano deve conter entre 1 e 240 parcelas.';
  end if;

  select * into s from public.sales where id=p_sale_id and company_id=p_company_id for update;
  if s.id is null or s.status<>'active' then raise exception 'Venda ativa não encontrada.'; end if;

  if exists(
    select 1 from public.receivables r
    where r.sale_id=s.id and r.status='open' and coalesce(r.paid_amount,0)>0
  ) then
    raise exception 'Existe parcela aberta com pagamento parcial. Regularize ou desdobre essa parcela antes da renegociação automática.';
  end if;

  select coalesce(sum(greatest(coalesce(nullif(r.adjusted_amount,0),r.amount)-coalesce(r.paid_amount,0),0)),0),
         coalesce(jsonb_agg(jsonb_build_object(
           'id',r.id,'category',r.category,'description',r.description,'due_date',r.due_date,
           'amount',r.amount,'adjusted_amount',r.adjusted_amount,'correction_index_id',r.correction_index_id,
           'interest_rate_monthly',r.interest_rate_monthly,'status',r.status
         ) order by r.due_date,r.sequence_number),'[]'::jsonb)
    into current_open,before_snapshot
  from public.receivables r
  where r.sale_id=s.id and r.status='open';

  if current_open<=0 then raise exception 'A venda não possui saldo aberto para renegociar.'; end if;

  total_items:=jsonb_array_length(p_items);
  for item in select value from jsonb_array_elements(p_items) loop
    seq:=seq+1;
    item_category:=coalesce(nullif(item->>'category',''),'monthly');
    if item_category not in ('entry','monthly','reinforcement','keys','post_keys','other') then
      raise exception 'Categoria inválida na parcela %.',seq;
    end if;
    if coalesce(item->>'due_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Vencimento inválido na parcela %.',seq; end if;
    item_due:=(item->>'due_date')::date;
    begin item_amount:=(item->>'amount')::numeric; exception when others then raise exception 'Valor inválido na parcela %.',seq; end;
    if item_amount<=0 or round(item_amount,2)<>item_amount then raise exception 'Valor inválido na parcela %.',seq; end if;
    if item ? 'correction_index_id' and nullif(item->>'correction_index_id','') is not null then
      begin item_index:=(item->>'correction_index_id')::uuid; exception when others then raise exception 'Índice inválido na parcela %.',seq; end;
      if not exists(select 1 from public.correction_indices ci where ci.id=item_index and ci.company_id=p_company_id) then
        raise exception 'Índice de correção não pertence à empresa na parcela %.',seq;
      end if;
    else item_index:=null; end if;
    new_total:=new_total+item_amount;
  end loop;

  expected_total:=round(current_open+coalesce(p_financial_impact,0),2);
  if expected_total<0 then raise exception 'Impacto financeiro torna o saldo contratual negativo.'; end if;
  if abs(round(new_total,2)-expected_total)>0.01 then
    raise exception 'Novo plano totaliza %, mas o saldo esperado após o impacto financeiro é %.',round(new_total,2),expected_total;
  end if;

  insert into public.commercial_sale_amendments(
    company_id,project_id,sale_id,kind,effective_date,reason,financial_impact,status,
    before_snapshot,after_snapshot,approved_by,approved_at,executed_by,executed_at,notes,created_by
  ) values(
    s.company_id,s.project_id,s.id,'payment_plan',p_effective_date,trim(p_reason),coalesce(p_financial_impact,0),'executed',
    jsonb_build_object('open_balance',current_open,'receivables',before_snapshot),
    jsonb_build_object('new_total',round(new_total,2),'items',p_items),actor,now(),actor,now(),
    'Renegociação executada de forma atômica pelo ERP de incorporação.',actor
  ) returning id into amendment_id;

  update public.receivables
     set status='cancelled',notes=concat_ws(E'\n',notes,'Substituída pela renegociação '||amendment_id::text),updated_at=now()
   where sale_id=s.id and status='open';

  seq:=0;
  for item in select value from jsonb_array_elements(p_items) loop
    seq:=seq+1;
    item_category:=coalesce(nullif(item->>'category',''),'monthly');
    item_due:=(item->>'due_date')::date;
    item_amount:=(item->>'amount')::numeric;
    item_index:=case when nullif(item->>'correction_index_id','') is null then null else (item->>'correction_index_id')::uuid end;
    insert into public.receivables(
      company_id,project_id,sale_id,client_id,unit_id,category,description,sequence_number,sequence_total,due_date,amount,
      correction_index_id,interest_rate_monthly,status,notes,source_system,source_id,created_by
    ) values(
      s.company_id,s.project_id,s.id,s.client_id,s.unit_id,item_category,
      coalesce(nullif(trim(item->>'description'),''),'Renegociação '||seq::text||'/'||total_items::text),
      coalesce(nullif(item->>'sequence_number','')::integer,seq),
      coalesce(nullif(item->>'sequence_total','')::integer,total_items),item_due,round(item_amount,2),item_index,
      case when nullif(item->>'interest_rate_monthly','') is null then null else (item->>'interest_rate_monthly')::numeric end,
      'open','Gerada pela renegociação '||amendment_id::text,'commercial_renegotiation',amendment_id::text||':'||seq::text,actor
    );
  end loop;

  if coalesce(p_financial_impact,0)<>0 then
    update public.sales set total_amount=round(total_amount+p_financial_impact,2),updated_at=now() where id=s.id;
  end if;

  insert into public.commercial_sale_contracts(
    company_id,project_id,sale_id,kind,document_number,effective_date,status,notes,created_by
  ) values(
    s.company_id,s.project_id,s.id,'renegotiation','RENEG-'||left(amendment_id::text,8),p_effective_date,'signed',
    'Registro automático da renegociação financeira '||amendment_id::text,actor
  );

  return amendment_id;
end $$;

grant execute on function public.commercial_execute_payment_plan_renegotiation(uuid,uuid,date,text,numeric,jsonb,uuid) to authenticated;

commit;
