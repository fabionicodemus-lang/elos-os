-- Only the protected document-action executor may invoke this domain helper.
-- All business writes remain in the caller's transaction; the official proposal
-- approval/conversion routines continue to own sales and receivable creation.
begin;

create or replace function public.ai_create_sale_from_document(
  p_company_id uuid,
  p_project_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  required text;
  unit_row public.units%rowtype;
  client_row public.clients%rowtype;
  broker_row public.commercial_brokers%rowtype;
  index_row public.correction_indices%rowtype;
  existing_proposal public.commercial_proposals%rowtype;
  client_id uuid;
  proposal_id uuid := gen_random_uuid();
  proposal_number text;
  v_sale_id uuid;
  item_id uuid;
  item_ids uuid[] := array[]::uuid[];
  new_client jsonb;
  item jsonb;
  expected jsonb;
  v_tax_id text;
  amount numeric;
  total_amount numeric;
  list_price numeric;
  planned_amount numeric := 0;
  commission numeric;
  sale_date date;
  count_installments integer := 0;
  item_count integer;
  interval_months integer;
  sequence integer := 0;
  index_id uuid;
  has_index boolean := false;
  correction_start integer;
  current_competing integer;
  expected_competing integer;
  changed integer;
  deadline date := current_date;
  broker_id uuid;
  v_contract_number text;
begin
  if actor is null then raise exception 'Sessão inválida.'; end if;
  foreach required in array array['ai.assistant.use','commercial.proposals.manage','commercial.proposals.approve','commercial.proposals.convert','sales.manage','receivables.manage'] loop
    if not public.has_company_permission(p_company_id,required) then
      raise exception 'Sem permissão para executar esta venda (%).',required;
    end if;
  end loop;
  if p_company_id is null or p_project_id is null
     or not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id) then
    raise exception 'A obra não pertence à empresa autorizada.';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
     or jsonb_typeof(p_payload->'paymentItems') is distinct from 'array'
     or jsonb_typeof(p_payload->'unsupportedClauses') is distinct from 'array'
     or jsonb_typeof(p_payload->'expectedCompetingProposals') is distinct from 'array' then
    raise exception 'Estrutura da venda inválida. Prepare o documento novamente.';
  end if;
  if jsonb_array_length(p_payload->'unsupportedClauses')<>0 then
    raise exception 'O contrato possui cláusulas pendentes que impedem o lançamento.';
  end if;
  if jsonb_array_length(p_payload->'paymentItems') not between 1 and 24 then
    raise exception 'O plano precisa ter entre 1 e 24 séries de pagamento.';
  end if;
  if nullif(p_payload->>'saleDate','') is null or (p_payload->>'saleDate') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Data da venda inválida.';
  end if;
  sale_date := (p_payload->>'saleDate')::date;
  if sale_date<date '1900-01-01' or sale_date>(timezone('America/Sao_Paulo',now()))::date then
    raise exception 'A data da venda não pode estar no futuro.';
  end if;
  v_contract_number := nullif(trim(p_payload->>'contractNumber'),'');
  if v_contract_number is null or length(v_contract_number)>150 then raise exception 'Identificação do contrato inválida.'; end if;
  total_amount := (p_payload->>'totalAmount')::numeric;
  list_price := (p_payload->>'listPrice')::numeric;
  commission := (p_payload->>'commissionPct')::numeric;
  if total_amount is null or total_amount<=0 or total_amount>1000000000000 or round(total_amount,2)<>total_amount
     or list_price is null or list_price<0 or list_price>1000000000000 or round(list_price,2)<>list_price
     or commission is null or commission<0 or commission>100 or round(commission,4)<>commission then
    raise exception 'Valor da venda ou comissão inválidos.';
  end if;
  if length(coalesce(p_payload->>'notes',''))>4000 then raise exception 'Observações da venda excedem o limite.'; end if;

  select * into unit_row from public.units
    where id=(p_payload->>'unitId')::uuid and company_id=p_company_id and project_id=p_project_id for update;
  if unit_row.id is null or unit_row.status<>'available' then raise exception 'A unidade não está mais disponível nesta obra.'; end if;
  if unit_row.updated_at is distinct from nullif(p_payload->>'expectedUnitUpdatedAt','')::timestamptz then
    raise exception 'A unidade mudou depois da revisão. Prepare um novo cartão.';
  end if;
  if list_price is distinct from coalesce(unit_row.list_price,total_amount) then raise exception 'O preço de tabela mudou depois da revisão.'; end if;
  if exists(select 1 from public.sales s where s.company_id=p_company_id and s.project_id=p_project_id
    and (s.unit_id=unit_row.id and s.status='active' or s.contract_number=v_contract_number)) then
    raise exception 'Já existe venda para esta unidade ou identificação contratual. Confira o cadastro existente.';
  end if;

  -- Lock every competitor visible in the review. Their rejection is an explicit
  -- effect of the official conversion, so changed/new competitors require review.
  expected_competing := jsonb_array_length(p_payload->'expectedCompetingProposals');
  select count(*) into current_competing from public.commercial_proposals
    where company_id=p_company_id and project_id=p_project_id and unit_id=unit_row.id
      and status in ('draft','sent','negotiation','approved');
  if current_competing<>expected_competing then raise exception 'As propostas concorrentes mudaram. Prepare um novo cartão.'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'expectedCompetingProposals'))<>expected_competing then
    raise exception 'Lista de propostas concorrentes inválida.';
  end if;
  for expected in select value from jsonb_array_elements(p_payload->'expectedCompetingProposals') loop
    select * into existing_proposal from public.commercial_proposals
      where id=(expected->>'id')::uuid and company_id=p_company_id and project_id=p_project_id and unit_id=unit_row.id for update;
    if existing_proposal.id is null or existing_proposal.status not in ('draft','sent','negotiation')
       or existing_proposal.status is distinct from expected->>'status'
       or existing_proposal.number is distinct from expected->>'number'
       or existing_proposal.updated_at is distinct from (expected->>'updatedAt')::timestamptz then
      raise exception 'Uma proposta concorrente mudou ou já foi aprovada. Prepare uma nova revisão.';
    end if;
  end loop;

  v_tax_id := upper(regexp_replace(coalesce(p_payload->>'clientTaxId',''),'[./[:space:]-]','','g'));
  if v_tax_id !~ '^(\d{11}|[A-Z0-9]{12}\d{2})$' then raise exception 'CPF/CNPJ do comprador inválido.'; end if;
  -- Prevent two document imports from creating the same previously absent client.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_company_id::text),pg_catalog.hashtext(v_tax_id));
  new_client := p_payload->'newClient';
  client_id := nullif(p_payload->>'clientId','')::uuid;
  if client_id is not null then
    if new_client is not null and jsonb_typeof(new_client)<>'null' then raise exception 'Cliente existente e novo cliente não podem ser enviados juntos.'; end if;
    select * into client_row from public.clients where id=client_id and company_id=p_company_id for share;
    if client_row.id is null or client_row.status<>'active'
       or upper(regexp_replace(coalesce(client_row.tax_id,''),'[./[:space:]-]','','g'))<>v_tax_id
       or client_row.updated_at is distinct from nullif(p_payload->>'expectedClientUpdatedAt','')::timestamptz then
      raise exception 'O cliente mudou ou não pertence à empresa. Revise o cadastro novamente.';
    end if;
    if (select count(*) from public.clients where company_id=p_company_id
      and upper(regexp_replace(coalesce(clients.tax_id,''),'[./[:space:]-]','','g'))=v_tax_id)<>1 then
      raise exception 'Existe duplicidade de CPF/CNPJ no cadastro. Resolva antes de importar.';
    end if;
  else
    if not public.has_company_permission(p_company_id,'clients.manage') then raise exception 'Sem permissão para cadastrar o novo cliente.'; end if;
    if jsonb_typeof(new_client) is distinct from 'object' or nullif(trim(new_client->>'name'),'') is null
       or length(new_client->>'name')>250 or new_client->>'personType' not in ('PF','PJ')
       or upper(regexp_replace(coalesce(new_client->>'taxId',''),'[./[:space:]-]','','g'))<>v_tax_id then
      raise exception 'Dados do novo cliente inválidos.';
    end if;
    if ((new_client->>'personType')='PF' and v_tax_id !~ '^\d{11}$')
       or ((new_client->>'personType')='PJ' and v_tax_id !~ '^[A-Z0-9]{12}\d{2}$') then raise exception 'Tipo de pessoa incompatível com o documento.'; end if;
    if exists(select 1 from public.clients where company_id=p_company_id
      and upper(regexp_replace(coalesce(clients.tax_id,''),'[./[:space:]-]','','g'))=v_tax_id) then
      raise exception 'Este cliente foi cadastrado após a preparação. Prepare novamente para reutilizar o cadastro.';
    end if;
    if nullif(new_client->>'birthDate','') is not null then
      if (new_client->>'birthDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data de nascimento inválida.'; end if;
      if (new_client->>'birthDate')::date>(timezone('America/Sao_Paulo',now()))::date then raise exception 'Nascimento do cliente no futuro.'; end if;
    end if;
  end if;

  broker_id := nullif(p_payload->>'brokerId','')::uuid;
  if broker_id is not null then
    select * into broker_row from public.commercial_brokers where id=broker_id and company_id=p_company_id for share;
    if broker_row.id is null or broker_row.status<>'active'
       or broker_row.name is distinct from p_payload->>'brokerName'
       or broker_row.updated_at is distinct from nullif(p_payload->>'expectedBrokerUpdatedAt','')::timestamptz then
      raise exception 'O corretor mudou ou não pertence à empresa. Prepare uma nova revisão.';
    end if;
  elsif commission>0 or nullif(p_payload->>'brokerName','') is not null then
    raise exception 'Confirme o corretor cadastrado antes de lançar comissão ou intermediação.';
  end if;
  correction_start := nullif(p_payload->>'correctionStartMonth','')::integer;
  if correction_start is not null and correction_start not between 0 and 60 then raise exception 'Início da correção inválido.'; end if;

  for item in select value from jsonb_array_elements(p_payload->'paymentItems') loop
    if jsonb_typeof(item)<>'object' or item->>'category' not in ('entry','monthly','reinforcement','keys','post_keys','other')
       or nullif(trim(item->>'description'),'') is null or length(item->>'description')>250 then raise exception 'Série de pagamento inválida.'; end if;
    item_count := (item->>'installmentCount')::integer;
    interval_months := (item->>'intervalMonths')::integer;
    amount := (item->>'amountPerInstallment')::numeric;
    if item_count is null or item_count not between 1 and 240 or interval_months is null or interval_months not between 0 and 120
       or item_count>1 and interval_months=0 or amount is null or amount<=0 or amount>1000000000000 or round(amount,2)<>amount
       or (item->>'installmentCount')::numeric<>item_count or (item->>'intervalMonths')::numeric<>interval_months then
      raise exception 'Quantidade, intervalo ou valor da série inválidos.';
    end if;
    if nullif(item->>'firstDueDate','') is null or (item->>'firstDueDate') !~ '^\d{4}-\d{2}-\d{2}$'
       or (item->>'firstDueDate')::date<date '1900-01-01'
       or (item->>'firstDueDate')::date+make_interval(months=>interval_months*(item_count-1))>date '9999-12-31' then
      raise exception 'Vencimento inválido na série de pagamento.';
    end if;
    if coalesce((item->>'interestRateMonthly')::numeric,0)<>0 then
      raise exception 'Juros mensais exigem tratamento no motor financeiro antes desta importação.';
    end if;
    if length(coalesce(item->>'paymentMethod',''))>120 or length(coalesce(item->>'notes',''))>4200 then
      raise exception 'Condições de pagamento excedem os limites de texto.';
    end if;
    count_installments := count_installments+item_count;
    planned_amount := planned_amount+item_count*amount;
    index_id := nullif(item->>'correctionIndexId','')::uuid;
    if index_id is not null then
      has_index := true;
      select * into index_row from public.correction_indices where id=index_id and company_id=p_company_id for share;
      if index_row.id is null or index_row.status<>'active' or index_row.code is distinct from item->>'correctionIndexLabel'
         or index_row.updated_at is distinct from nullif(item->>'correctionIndexUpdatedAt','')::timestamptz then
        raise exception 'O índice de correção mudou ou não pertence à empresa.';
      end if;
      if coalesce((select value from public.correction_index_values where company_id=p_company_id and correction_index_id=index_id
        and reference_month<=date_trunc('month',sale_date)::date order by reference_month desc limit 1),0)=0 then
        raise exception 'Falta valor-base do índice no mês da venda ou anterior. Cadastre-o antes de importar.';
      end if;
    elsif nullif(item->>'correctionIndexLabel','') is not null then
      raise exception 'Um índice textual sem vínculo cadastrado não pode ser descartado.';
    end if;
  end loop;
  if count_installments>240 or planned_amount<>total_amount then raise exception 'As parcelas precisam somar exatamente o valor da venda e respeitar o limite de 240 títulos.'; end if;
  if has_index and correction_start is null then raise exception 'Informe o início contratual da correção; nenhum padrão será presumido.'; end if;

  if client_id is null then
    insert into public.clients(company_id,person_type,name,tax_id,identity_document,birth_date,marital_status,profession,
      email,phone,secondary_phone,address,postal_code,city,state,nationality,status,source_system,source_id,created_by)
    values(p_company_id,new_client->>'personType',trim(new_client->>'name'),v_tax_id,new_client->>'identityDocument',
      nullif(new_client->>'birthDate','')::date,new_client->>'maritalStatus',new_client->>'profession',new_client->>'email',
      new_client->>'phone',new_client->>'secondaryPhone',new_client->>'address',new_client->>'postalCode',
      new_client->>'city',new_client->>'state',new_client->>'nationality','active','elos_ia',gen_random_uuid()::text,actor)
    returning id into client_id;
  end if;

  -- The current date is only the validity of the internal conversion proposal.
  -- The historical contract/sale date remains the explicit reviewed sale_date.
  proposal_number := public.commercial_proposal_next_number(p_company_id,p_project_id,deadline);
  insert into public.commercial_proposals(id,company_id,project_id,unit_id,client_id,number,proposal_date,valid_until,
    list_price,proposed_amount,commission_pct,broker_name,broker_id,source_channel,status,notes,created_by,updated_by)
  values(proposal_id,p_company_id,p_project_id,unit_row.id,client_id,proposal_number,deadline,deadline,
    list_price,total_amount,commission,broker_row.name,broker_id,'elos_ia_document','draft',p_payload->>'notes',actor,actor);

  for item in select value from jsonb_array_elements(p_payload->'paymentItems') loop
    sequence := sequence+1;
    insert into public.commercial_proposal_payment_items(company_id,proposal_id,category,description,installment_count,
      first_due_date,interval_months,amount_per_installment,adjustment_index,interest_rate_monthly,sort_order,notes,created_by)
    values(p_company_id,proposal_id,item->>'category',item->>'description',(item->>'installmentCount')::integer,
      (item->>'firstDueDate')::date,(item->>'intervalMonths')::integer,(item->>'amountPerInstallment')::numeric,
      item->>'correctionIndexLabel',nullif(item->>'interestRateMonthly','')::numeric,sequence,item->>'notes',actor)
    returning id into item_id;
    item_ids := array_append(item_ids,item_id);
  end loop;
  perform public.commercial_set_proposal_status(p_company_id,proposal_id,'approved',deadline,actor);
  v_sale_id := public.commercial_convert_proposal(p_company_id,proposal_id,sale_date,v_contract_number,actor);
  if v_sale_id is null then raise exception 'A conversão oficial não retornou uma venda.'; end if;

  -- Convert preserves the text but not the FK used by the correction trigger.
  -- Attach verified IDs in the same transaction; never allow a silent loss of CUB/IPCA.
  if has_index then
    update public.sales set correction_start_month=correction_start,updated_at=now()
      where id=v_sale_id and company_id=p_company_id and project_id=p_project_id;
  end if;
  sequence := 0;
  for item in select value from jsonb_array_elements(p_payload->'paymentItems') loop
    sequence := sequence+1;
    update public.receivables
      set correction_index_id=nullif(item->>'correctionIndexId','')::uuid,updated_at=now()
      where company_id=p_company_id and project_id=p_project_id and receivables.sale_id=v_sale_id
        and source_system='commercial_proposal' and source_id like proposal_id::text||':'||item_ids[sequence]::text||':%';
    get diagnostics changed=row_count;
    if changed<>(item->>'installmentCount')::integer then raise exception 'A quantidade de títulos gerada diverge da revisão. Operação revertida.'; end if;
  end loop;
  if exists(select 1 from public.commercial_proposals q where q.company_id=p_company_id and q.unit_id=unit_row.id
    and q.id<>proposal_id and q.status='rejected' and q.updated_at=now()
    and not exists(select 1 from jsonb_array_elements(p_payload->'expectedCompetingProposals') e where (e->>'id')::uuid=q.id)) then
    raise exception 'Uma proposta concorrente surgiu durante a confirmação. Nada foi gravado; revise novamente.';
  end if;
  return jsonb_build_object('kind','commercial_sale_create','sale_id',v_sale_id,'client_id',client_id,
    'commercial_proposal_id',proposal_id,'unit_id',unit_row.id,'receivables_count',count_installments,
    'total_amount',total_amount,'url','/comercial/vendas/'||v_sale_id::text);
end;
$$;

-- The review is a verified projection of the exact payload, never independent
-- prose supplied by the model/client. The protected prepare/execute RPCs call it.
create or replace function public.ai_validate_sale_document_preview(
  p_company_id uuid,
  p_project_id uuid,
  p_payload jsonb,
  p_preview jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  project_row public.projects%rowtype;
  unit_row public.units%rowtype;
  client_row public.clients%rowtype;
  new_client jsonb;
  client_data jsonb;
  canonical jsonb;
  canonical_items jsonb := '[]'::jsonb;
  canonical_installments jsonb := '[]'::jsonb;
  effects jsonb := '[]'::jsonb;
  warnings jsonb := jsonb_build_array('As parcelas serão criadas em aberto. Esta ação não registra recebimento, não emite boleto e não envia cobrança.');
  item jsonb;
  expected jsonb;
  row_number integer;
  installment_count integer;
  total_installments integer := 0;
  competing_count integer;
  client_name text;
  client_tax text;
  document_name text;
  is_new boolean;
  blocked boolean;
  method_present boolean := false;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_preview) is distinct from 'object'
     or jsonb_typeof(p_payload->'paymentItems') is distinct from 'array'
     or jsonb_typeof(p_payload->'unsupportedClauses') is distinct from 'array'
     or jsonb_typeof(p_payload->'expectedCompetingProposals') is distinct from 'array' then
    raise exception 'A revisão da venda precisa conter o payload estruturado completo.';
  end if;
  if jsonb_array_length(p_payload->'paymentItems') not between 1 and 24 then raise exception 'Quantidade de séries inválida na revisão.'; end if;
  select * into project_row from public.projects where id=p_project_id and company_id=p_company_id;
  select * into unit_row from public.units where id=(p_payload->>'unitId')::uuid and company_id=p_company_id and project_id=p_project_id;
  if project_row.id is null or unit_row.id is null then raise exception 'Obra/unidade da revisão não pertencem ao contexto autorizado.'; end if;
  document_name := nullif(trim(p_payload->>'documentClientName'),'');
  if document_name is null or length(document_name)>250 then raise exception 'O nome do comprador no documento precisa constar na revisão.'; end if;
  client_tax := p_payload->>'clientTaxId';
  new_client := p_payload->'newClient';
  is_new := nullif(p_payload->>'clientId','') is null;
  if is_new then
    if jsonb_typeof(new_client) is distinct from 'object' then raise exception 'Dados do novo cliente ausentes na revisão.'; end if;
    client_name := new_client->>'name';
    client_data := jsonb_build_object('id',null,'name',client_name,'taxId',client_tax,'personType',new_client->>'personType','isNew',true,
      'details',jsonb_build_object('identityDocument',new_client->'identityDocument','birthDate',new_client->'birthDate',
        'maritalStatus',new_client->'maritalStatus','profession',new_client->'profession','email',new_client->'email',
        'phone',new_client->'phone','secondaryPhone',new_client->'secondaryPhone','address',new_client->'address',
        'postalCode',new_client->'postalCode','city',new_client->'city','state',new_client->'state','nationality',new_client->'nationality'));
    effects := effects || jsonb_build_array('Cadastrar '||client_name||' como novo cliente.');
  else
    if new_client is not null and jsonb_typeof(new_client)<>'null' then raise exception 'Cliente existente e novo cadastro conflitantes.'; end if;
    select * into client_row from public.clients where id=(p_payload->>'clientId')::uuid and company_id=p_company_id;
    if client_row.id is null or upper(regexp_replace(coalesce(client_row.tax_id,''),'[./[:space:]-]','','g')) is distinct from client_tax then
      raise exception 'O cliente mostrado não corresponde ao CPF/CNPJ da operação.';
    end if;
    client_name := client_row.name;
    client_data := jsonb_build_object('id',client_row.id,'name',client_name,'taxId',client_tax,'personType',client_row.person_type,'isNew',false,'details','{}'::jsonb);
    if lower(trim(client_name))<>lower(trim(document_name)) then
      warnings := warnings || jsonb_build_array('O CPF/CNPJ pertence ao cliente cadastrado como '||client_name||'. O nome no documento é '||document_name||'; o cadastro existente será preservado.');
    end if;
  end if;

  for item in select value from jsonb_array_elements(p_payload->'paymentItems') loop
    installment_count := (item->>'installmentCount')::integer;
    if installment_count is null or installment_count not between 1 and 240 then raise exception 'Quantidade de parcelas inválida na revisão.'; end if;
    total_installments := total_installments+installment_count;
    if total_installments>240 then raise exception 'A revisão excede 240 parcelas.'; end if;
    if nullif(item->>'correctionIndexId','') is not null and not exists(
      select 1 from public.correction_indices where id=(item->>'correctionIndexId')::uuid and company_id=p_company_id
        and code=item->>'correctionIndexLabel'
    ) then raise exception 'O rótulo do índice não corresponde ao cadastro autorizado.'; end if;
    canonical_items := canonical_items || jsonb_build_array(item || jsonb_build_object('total',installment_count*(item->>'amountPerInstallment')::numeric));
    method_present := method_present or nullif(item->>'paymentMethod','') is not null;
    for row_number in 1..installment_count loop
      canonical_installments := canonical_installments || jsonb_build_array(jsonb_build_object(
        'category',item->>'category','description',item->>'description','sequenceNumber',row_number,'sequenceTotal',installment_count,
        'dueDate',to_char((item->>'firstDueDate')::date+make_interval(months=>(item->>'intervalMonths')::integer*(row_number-1)),'YYYY-MM-DD'),
        'amount',item->'amountPerInstallment','correctionIndexLabel',item->'correctionIndexLabel',
        'interestRateMonthly',item->'interestRateMonthly','paymentMethod',item->'paymentMethod'));
    end loop;
  end loop;
  if method_present then warnings := warnings || jsonb_build_array('A forma de pagamento será preservada nas observações de cada série e título, conforme os campos existentes no módulo.'); end if;
  if unit_row.list_price is null then warnings := warnings || jsonb_build_array('A unidade não possui preço de tabela. A proposta de registro usará o valor do contrato como referência, sem desconto de tabela calculado.'); end if;
  effects := effects || jsonb_build_array(
    'Registrar a proposta comercial do contrato, aprová-la e convertê-la em venda.',
    'Criar '||total_installments||' título(s) a receber em aberto, com os valores nominais e vencimentos mostrados.',
    'Alterar a unidade '||unit_row.code||' de disponível para vendida.');
  competing_count := jsonb_array_length(p_payload->'expectedCompetingProposals');
  if competing_count>0 then effects := effects || jsonb_build_array('Rejeitar '||competing_count||' proposta(s) concorrente(s) listada(s) abaixo, conforme o fluxo oficial de conversão.'); end if;
  for expected in select value from jsonb_array_elements(p_payload->'expectedCompetingProposals') loop
    if not exists(select 1 from public.commercial_proposals q where q.id=(expected->>'id')::uuid
      and q.company_id=p_company_id and q.project_id=p_project_id and q.unit_id=unit_row.id and q.number=expected->>'number') then
      raise exception 'Uma proposta concorrente da revisão não corresponde ao cadastro.';
    end if;
  end loop;
  if coalesce((p_payload->>'commissionPct')::numeric,0)>0 then
    effects := effects || jsonb_build_array('Registrar comissão planejada de '||(p_payload->>'commissionPct')||'% para '||coalesce(nullif(p_payload->>'brokerName',''),'corretor pendente')||'; a aprovação financeira segue o módulo Comercial.');
  end if;
  if nullif(p_payload->>'brokerId','') is not null and not exists(select 1 from public.commercial_brokers b
    where b.id=(p_payload->>'brokerId')::uuid and b.company_id=p_company_id and b.name=p_payload->>'brokerName') then
    raise exception 'O corretor mostrado na revisão não corresponde ao cadastro.';
  end if;
  effects := effects || jsonb_build_array('Preservar o documento de origem no histórico da ação confirmada.');
  blocked := jsonb_array_length(p_payload->'unsupportedClauses')>0;
  canonical := jsonb_build_object(
    'kind','commercial_sale_create','blocked',blocked,
    'blockReason',case when blocked then 'O contrato possui condições pendentes de revisão. Nenhuma venda poderá ser gerada até resolvê-las.' else null end,
    'sourceFile',p_preview->'sourceFile',
    'project',jsonb_build_object('id',project_row.id,'label',concat_ws(' · ',nullif(project_row.code,''),project_row.name)),
    'unit',jsonb_build_object('id',unit_row.id,'code',unit_row.code,'tower',unit_row.tower,'status',unit_row.status),
    'client',client_data,'saleDate',p_payload->'saleDate','contractNumber',p_payload->'contractNumber',
    'totalAmount',p_payload->'totalAmount','listPrice',p_payload->'listPrice',
    'discountAmount',greatest(0,round((p_payload->>'listPrice')::numeric-(p_payload->>'totalAmount')::numeric,2)),
    'commissionPct',p_payload->'commissionPct','brokerName',p_payload->'brokerName','correctionStartMonth',p_payload->'correctionStartMonth',
    'paymentItems',canonical_items,'installments',canonical_installments,'notes',p_payload->'notes',
    'unsupportedClauses',p_payload->'unsupportedClauses','effects',effects,'warnings',warnings,
    'competingProposals',p_payload->'expectedCompetingProposals');
  if p_preview is distinct from canonical then raise exception 'A revisão exibida diverge dos dados ou efeitos da venda. Prepare um novo cartão.'; end if;
  return true;
end;
$$;

revoke all on function public.ai_create_sale_from_document(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ai_validate_sale_document_preview(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;

commit;
