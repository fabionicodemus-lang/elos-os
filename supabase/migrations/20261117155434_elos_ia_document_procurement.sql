-- Elos IA: internal adapters for reviewed material quotations and service contracts.
-- Only the confirmation executor may invoke these adapters; domain permissions,
-- tenant ownership and snapshots are checked again inside the same transaction.
begin;

create or replace function public.ai_create_quotation_from_document(
  p_company_id uuid, p_project_id uuid, p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  request_row public.execution_material_requests%rowtype;
  request_item public.execution_material_request_items%rowtype;
  supplier_row public.suppliers%rowtype;
  item jsonb;
  quotation_items jsonb := '[]'::jsonb;
  offer_items jsonb := '[]'::jsonb;
  v_quotation_id uuid;
  quotation_item_id uuid;
  offer_id uuid;
  qty numeric;
  price numeric;
  discount_pct numeric;
  tax_pct numeric;
  freight numeric;
  other_cost numeric;
  remaining numeric;
  item_total numeric;
  total numeric := 0;
  total_freight numeric := 0;
  total_other numeric := 0;
begin
  if auth.uid() is null or not public.has_company_permission(p_company_id,'procurement.quotations.manage') then
    raise exception 'Sem permissão para criar a cotação desta empresa.';
  end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then
    raise exception 'A obra não está disponível nesta empresa.';
  end if;
  if coalesce(jsonb_typeof(p_payload->'items'),'null')<>'array'
     or jsonb_array_length(p_payload->'items') not between 1 and 100 then
    raise exception 'Revise os itens da cotação.';
  end if;
  if (select count(distinct value->>'request_item_id') from jsonb_array_elements(p_payload->'items'))<>jsonb_array_length(p_payload->'items') then
    raise exception 'A cotação possui itens repetidos ou sem vínculo.';
  end if;
  select * into supplier_row from public.suppliers
    where id=(p_payload->>'supplierId')::uuid and company_id=p_company_id and status='active' for update;
  if supplier_row.id is null or supplier_row.updated_at is distinct from (p_payload->>'supplierUpdatedAt')::timestamptz then
    raise exception 'O fornecedor foi alterado ou não está ativo. Prepare novo cartão.';
  end if;
  select * into request_row from public.execution_material_requests
    where id=(p_payload->>'requestId')::uuid and company_id=p_company_id and project_id=p_project_id
      and status in ('approved','partially_ordered') for update;
  if request_row.id is null or request_row.updated_at is distinct from (p_payload->>'requestUpdatedAt')::timestamptz
    or request_row.request_number is distinct from p_payload->>'requestNumber' then
    raise exception 'A solicitação foi alterada ou não está aprovada. Prepare novo cartão.';
  end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    select * into request_item from public.execution_material_request_items
      where id=(item->>'request_item_id')::uuid and request_id=request_row.id
        and company_id=p_company_id and project_id=p_project_id for update;
    if request_item.id is null or request_item.updated_at is distinct from (item->>'expected_updated_at')::timestamptz
      or request_item.input_id is distinct from (item->>'input_id')::uuid
      or request_item.input_code is distinct from item->>'code'
      or request_item.input_name is distinct from item->>'name'
      or request_item.unit_snapshot is distinct from item->>'unit' then
      raise exception 'Um material foi alterado ou não pertence à solicitação. Prepare novo cartão.';
    end if;
    remaining:=request_item.requested_quantity-request_item.ordered_quantity-coalesce(request_item.stock_fulfilled_quantity,0);
    qty:=(item->>'quantity_to_quote')::numeric;
    price:=(item->>'unit_price')::numeric;
    discount_pct:=(item->>'discount_percent')::numeric;
    tax_pct:=(item->>'tax_percent')::numeric;
    freight:=(item->>'freight_amount')::numeric;
    other_cost:=(item->>'other_cost_amount')::numeric;
    if qty is null or qty<=0 or qty>remaining+0.000001
      or qty is distinct from (item->>'quantity_offered')::numeric
      or remaining is distinct from (item->>'expected_remaining_quantity')::numeric
      or price is null or price<=0 or price>1e12
      or discount_pct is null or discount_pct not between 0 and 100
      or tax_pct is null or tax_pct not between 0 and 100
      or freight is null or freight<0 or other_cost is null or other_cost<0 then
      raise exception 'Quantidade, saldo, preço ou encargos inválidos para %.',request_item.input_code;
    end if;
    item_total:=round(qty*price*(1-discount_pct/100)*(1+tax_pct/100)+freight+other_cost,2);
    if item->>'total' is null or abs(item_total-(item->>'total')::numeric)>0.01 then
      raise exception 'O total do material % diverge do cartão revisado.',request_item.input_code;
    end if;
    total:=total+item_total; total_freight:=total_freight+freight; total_other:=total_other+other_cost;
    quotation_items:=quotation_items||jsonb_build_array(jsonb_build_object('request_item_id',request_item.id,'quantity_to_quote',qty));
  end loop;
  if p_payload->>'total' is null or p_payload->>'freightTotal' is null or p_payload->>'otherTotal' is null
    or abs(total-(p_payload->>'total')::numeric)>0.01
    or abs(total_freight-(p_payload->>'freightTotal')::numeric)>0.01
    or abs(total_other-(p_payload->>'otherTotal')::numeric)>0.01 then
    raise exception 'Os totais da proposta não coincidem com o cartão revisado.';
  end if;
  v_quotation_id:=public.save_procurement_material_quotation_v2(
    p_company_id,p_project_id,null,p_payload->>'title',p_payload->>'awardMode',
    (p_payload->>'responseDeadline')::date,nullif(p_payload->>'desiredDeliveryDate','')::date,
    p_payload->>'paymentTerms',p_payload->>'deliveryAddress',p_payload->>'notes',
    quotation_items,jsonb_build_array(jsonb_build_object('supplier_id',supplier_row.id)),false,null,null
  );
  perform public.open_procurement_material_quotation(p_company_id,p_project_id,v_quotation_id);
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    select id into quotation_item_id from public.procurement_material_quotation_items
      where company_id=p_company_id and project_id=p_project_id and procurement_material_quotation_items.quotation_id=v_quotation_id
        and request_item_id=(item->>'request_item_id')::uuid;
    if quotation_item_id is null then raise exception 'Não foi possível vincular um item da nova cotação.'; end if;
    offer_items:=offer_items||jsonb_build_array(jsonb_build_object(
      'quotation_item_id',quotation_item_id,'quantity_offered',(item->>'quantity_offered')::numeric,
      'unit_price',(item->>'unit_price')::numeric,'discount_percent',(item->>'discount_percent')::numeric,
      'tax_percent',(item->>'tax_percent')::numeric,'freight_amount',(item->>'freight_amount')::numeric,
      'other_cost_amount',(item->>'other_cost_amount')::numeric,'brand',item->>'brand',
      'manufacturer',item->>'manufacturer','delivery_days',nullif(item->>'delivery_days','')::integer,
      'meets_specification',coalesce((item->>'meets_specification')::boolean,false),'technical_notes',item->>'technical_notes'
    ));
  end loop;
  offer_id:=public.save_procurement_material_supplier_offer(
    p_company_id,p_project_id,v_quotation_id,supplier_row.id,p_payload->>'proposalNumber',
    nullif(p_payload->>'proposalDate','')::date,nullif(p_payload->>'validityDate','')::date,
    p_payload->>'paymentTerms',nullif(p_payload->>'deliveryDays','')::integer,p_payload->>'freightTerms',
    p_payload->>'warrantyTerms',p_payload->>'notes',offer_items
  );
  return jsonb_build_object('kind','procurement_quotation_create','quotation_id',v_quotation_id,'offer_id',offer_id,
    'supplier_id',supplier_row.id,'destination','/suprimentos/orcamentos-materiais?quotation='||v_quotation_id::text);
end;
$$;

create or replace function public.ai_create_service_contract_from_document(
  p_company_id uuid, p_project_id uuid, p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  competition_row public.execution_service_competitions%rowtype;
  offer_row public.execution_service_competition_offers%rowtype;
  supplier_row public.suppliers%rowtype;
  offer_item public.execution_service_competition_offer_items%rowtype;
  request_item public.execution_service_request_items%rowtype;
  item jsonb;
  stage jsonb;
  stages jsonb := '[]'::jsonb;
  contract_id uuid;
  expected_count integer;
  total numeric := 0;
  weight numeric;
  retention numeric;
  guarantee numeric;
begin
  if auth.uid() is null or not public.has_company_permission(p_company_id,'execution.contract_procurement.contract') then
    raise exception 'Sem permissão para gerar contratos desta empresa.';
  end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived') then
    raise exception 'A obra não está disponível nesta empresa.';
  end if;
  if coalesce(jsonb_typeof(p_payload->'items'),'null')<>'array'
    or jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Revise os serviços do contrato.'; end if;
  if (select count(distinct value->>'request_item_id') from jsonb_array_elements(p_payload->'items'))<>jsonb_array_length(p_payload->'items') then
    raise exception 'O contrato possui serviços repetidos ou sem vínculo.';
  end if;
  select * into competition_row from public.execution_service_competitions
    where id=(p_payload->>'competitionId')::uuid and company_id=p_company_id and project_id=p_project_id for update;
  if competition_row.id is null or competition_row.status<>'approved' or competition_row.generated_contract_id is not null
    or competition_row.updated_at is distinct from (p_payload->>'competitionUpdatedAt')::timestamptz
    or competition_row.competition_number is distinct from p_payload->>'competitionNumber'
    or competition_row.winner_offer_id is distinct from (p_payload->>'winnerOfferId')::uuid
    or competition_row.winner_supplier_id is distinct from (p_payload->>'supplierId')::uuid then
    raise exception 'O mapa aprovado foi alterado ou já gerou contrato. Prepare novo cartão.';
  end if;
  select * into offer_row from public.execution_service_competition_offers
    where id=competition_row.winner_offer_id and company_id=p_company_id and project_id=p_project_id
      and competition_id=competition_row.id and status='winner' for update;
  if offer_row.id is null or offer_row.updated_at is distinct from (p_payload->>'offerUpdatedAt')::timestamptz
    or offer_row.supplier_id is distinct from competition_row.winner_supplier_id then
    raise exception 'A proposta vencedora foi alterada. Prepare novo cartão.';
  end if;
  select * into supplier_row from public.suppliers
    where id=offer_row.supplier_id and company_id=p_company_id and status='active' for update;
  if supplier_row.id is null or supplier_row.updated_at is distinct from (p_payload->>'supplierUpdatedAt')::timestamptz then
    raise exception 'O fornecedor foi alterado ou não está ativo. Prepare novo cartão.';
  end if;
  perform 1 from public.execution_service_requests where id=competition_row.request_id
    and company_id=p_company_id and project_id=p_project_id and status='competition' for update;
  if not found then raise exception 'A solicitação de serviços não está disponível para contratação.'; end if;
  select count(*) into expected_count from public.execution_service_request_items
    where request_id=competition_row.request_id and company_id=p_company_id and project_id=p_project_id;
  if expected_count<>jsonb_array_length(p_payload->'items')
    or expected_count<>(select count(*) from public.execution_service_competition_offer_items where offer_id=offer_row.id and company_id=p_company_id and project_id=p_project_id) then
    raise exception 'O contrato precisa conferir todos os serviços aprovados.';
  end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    select * into offer_item from public.execution_service_competition_offer_items
      where id=(item->>'offer_item_id')::uuid and offer_id=offer_row.id and request_item_id=(item->>'request_item_id')::uuid
        and company_id=p_company_id and project_id=p_project_id for update;
    select * into request_item from public.execution_service_request_items
      where id=(item->>'request_item_id')::uuid and request_id=competition_row.request_id
        and company_id=p_company_id and project_id=p_project_id for update;
    if offer_item.id is null or request_item.id is null or not offer_item.meets_specification
      or request_item.service_id is distinct from (item->>'service_id')::uuid
      or request_item.service_code is distinct from item->>'code'
      or request_item.service_name is distinct from item->>'name'
      or request_item.location_name is distinct from item->>'location'
      or request_item.scope_notes is distinct from item->>'scopeNotes'
      or request_item.measurement_notes is distinct from item->>'measurementNotes'
      or request_item.unit_snapshot is distinct from item->>'unit'
      or offer_item.offered_quantity is distinct from (item->>'quantity')::numeric
      or offer_item.unit_price is distinct from (item->>'unit_price')::numeric
      or offer_item.total_amount is distinct from (item->>'total')::numeric
      or offer_item.offered_quantity<=0 or offer_item.unit_price<=0 then
      raise exception 'Um serviço, quantidade, preço ou condição foi alterado desde a revisão. Prepare novo cartão.';
    end if;
    if coalesce(jsonb_typeof(item->'stages'),'null')<>'array' or jsonb_array_length(item->'stages') not between 1 and 20 then
      raise exception 'Informe as etapas de medição de cada serviço.';
    end if;
    weight:=0;
    for stage in select value from jsonb_array_elements(item->'stages') loop
      if nullif(trim(stage->>'name'),'') is null or stage->>'measurement_mode' not in ('quantity','percent')
        or stage->>'measurement_mode' is null or stage->>'weight_percent' is null
        or (stage->>'weight_percent')::numeric<=0 or (stage->>'weight_percent')::numeric>100 then
        raise exception 'Uma etapa de medição está incompleta ou inválida.';
      end if;
      weight:=weight+(stage->>'weight_percent')::numeric;
    end loop;
    if abs(weight-100)>0.001 then raise exception 'As etapas de cada serviço devem totalizar 100%%.'; end if;
    stages:=stages||jsonb_build_array(jsonb_build_object('request_item_id',request_item.id,'stages',item->'stages'));
    total:=total+offer_item.total_amount;
  end loop;
  retention:=(p_payload->>'retentionPercent')::numeric;
  guarantee:=(p_payload->>'guaranteePercent')::numeric;
  if retention is null or guarantee is null or retention not between 0 and 100 or guarantee not between 0 and 100 or retention+guarantee>100
    or p_payload->>'guaranteeMonths' is null or (p_payload->>'guaranteeMonths')::integer not between 0 and 240
    or p_payload->>'paymentDays' is null or (p_payload->>'paymentDays')::integer not between 0 and 365 then
    raise exception 'Revise retenções, garantia e prazo de pagamento do contrato.';
  end if;
  if p_payload->>'total' is null or total<=0 or abs(total-(p_payload->>'total')::numeric)>0.01 or abs(total-offer_row.total_amount)>0.01 then
    raise exception 'O valor do contrato diverge da proposta aprovada.';
  end if;
  contract_id:=public.generate_execution_service_contract_from_competition(
    p_company_id,p_project_id,competition_row.id,p_payload->>'title',p_payload->>'scopeSummary',
    (p_payload->>'startDate')::date,(p_payload->>'endDate')::date,nullif(p_payload->>'signedDate','')::date,
    retention,guarantee,(p_payload->>'guaranteeMonths')::integer,(p_payload->>'paymentDays')::integer,
    p_payload->>'adjustmentIndex',nullif(p_payload->>'adjustmentBaseDate','')::date,p_payload->>'contactName',
    p_payload->>'contactPhone',p_payload->>'contactEmail',p_payload->>'notes',stages
  );
  return jsonb_build_object('kind','execution_contract_create','contract_id',contract_id,
    'supplier_id',supplier_row.id,'competition_id',competition_row.id,'destination','/execucao/contratos-servicos?contract='||contract_id::text);
end;
$$;

revoke all on function public.ai_create_quotation_from_document(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ai_create_service_contract_from_document(uuid,uuid,jsonb) from public,anon,authenticated;

-- Validate the entire human-facing card, not just its totals. Authenticated
-- callers can submit JSON directly to the preparation RPC, so neither payload
-- nor preview is trusted until both agree with the current domain records.
create or replace function public.ai_validate_procurement_document_preview(
  p_company_id uuid,p_project_id uuid,p_action_type text,p_payload jsonb,p_preview jsonb
) returns boolean
language plpgsql security invoker set search_path='' as $$
declare
  project_row public.projects%rowtype;
  supplier_row public.suppliers%rowtype;
  material_request public.execution_material_requests%rowtype;
  material_item public.execution_material_request_items%rowtype;
  competition_row public.execution_service_competitions%rowtype;
  offer_row public.execution_service_competition_offers%rowtype;
  service_item public.execution_service_request_items%rowtype;
  offer_item public.execution_service_competition_offer_items%rowtype;
  canonical jsonb;
  canonical_items jsonb := '[]'::jsonb;
  canonical_stages jsonb;
  canonical_warnings jsonb := '[]'::jsonb;
  item jsonb;
  stage jsonb;
  key text;
  text_keys text[];
  number_keys text[];
  date_keys text[];
  quantity numeric;
  unit_price numeric;
  item_total numeric;
  total numeric := 0;
  freight numeric := 0;
  other_cost numeric := 0;
  stage_weight numeric;
  stage_index integer;
  unconfirmed boolean := false;
begin
  if auth.uid() is null or p_action_type is null or p_action_type not in ('procurement_quotation_create','execution_contract_create')
    or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_preview) is distinct from 'object'
    or p_preview->>'kind' is distinct from p_action_type or p_preview->'blocked' is distinct from 'false'::jsonb
    or jsonb_typeof(p_preview->'sourceFile') is distinct from 'string' or nullif(btrim(p_preview->>'sourceFile'),'') is null
    or coalesce(jsonb_typeof(p_payload->'items'),'null')<>'array'
    or jsonb_array_length(p_payload->'items') not between 1 and 100 then return false; end if;
  if not public.has_company_permission(p_company_id,case when p_action_type='procurement_quotation_create'
    then 'procurement.quotations.manage' else 'execution.contract_procurement.contract' end) then return false; end if;
  select * into project_row from public.projects where id=p_project_id and company_id=p_company_id and status<>'archived';
  select * into supplier_row from public.suppliers where id=(p_payload->>'supplierId')::uuid and company_id=p_company_id and status='active';
  if project_row.id is null or supplier_row.id is null
    or supplier_row.updated_at is distinct from (p_payload->>'supplierUpdatedAt')::timestamptz then return false; end if;
  canonical:=jsonb_build_object('kind',p_action_type,'blocked',false,'sourceFile',p_preview->'sourceFile',
    'project',jsonb_build_object('id',project_row.id,'label',concat_ws(' · ',nullif(project_row.code,''),project_row.name)),
    'supplier',jsonb_build_object('id',supplier_row.id,'name',coalesce(nullif(supplier_row.trade_name,''),supplier_row.legal_name),'taxId',supplier_row.tax_id));
  if jsonb_typeof(p_payload->'title') is distinct from 'string' or nullif(btrim(p_payload->>'title'),'') is null then return false; end if;
  if (select count(distinct value->>'request_item_id') from jsonb_array_elements(p_payload->'items'))<>jsonb_array_length(p_payload->'items') then return false; end if;

  if p_action_type='procurement_quotation_create' then
    text_keys:=array['title','awardMode','responseDeadline','desiredDeliveryDate','paymentTerms','proposalNumber','proposalDate','validityDate','deliveryAddress','freightTerms','warrantyTerms','notes'];
    number_keys:=array['deliveryDays'];
    date_keys:=array['responseDeadline','desiredDeliveryDate','proposalDate','validityDate'];
    if p_payload->>'awardMode' not in ('item','lot') or p_payload->>'awardMode' is null
      or p_payload->>'responseDeadline' is null then return false; end if;
    select * into material_request from public.execution_material_requests
      where id=(p_payload->>'requestId')::uuid and company_id=p_company_id and project_id=p_project_id and status in ('approved','partially_ordered');
    if material_request.id is null or material_request.request_number is distinct from p_payload->>'requestNumber'
      or material_request.updated_at is distinct from (p_payload->>'requestUpdatedAt')::timestamptz then return false; end if;
    canonical:=canonical||jsonb_build_object('module','Orçamentos de Materiais',
      'request',jsonb_build_object('id',material_request.id,'number',material_request.request_number),
      'effects',jsonb_build_array('Criar uma cotação vinculada à solicitação aprovada.','Abrir a cotação para coleta e registrar esta proposta de fornecedor.','Manter a escolha de vencedor, pedido de compra e financeiro no fluxo de aprovação.'));
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      select * into material_item from public.execution_material_request_items
        where id=(item->>'request_item_id')::uuid and request_id=material_request.id and company_id=p_company_id and project_id=p_project_id;
      if material_item.id is null or material_item.input_id is distinct from (item->>'input_id')::uuid
        or material_item.input_code is distinct from item->>'code' or material_item.input_name is distinct from item->>'name'
        or material_item.unit_snapshot is distinct from item->>'unit'
        or concat_ws(' · ',material_item.cost_center_code,material_item.cost_center_name) is distinct from item->>'costCenter'
        or material_item.updated_at is distinct from (item->>'expected_updated_at')::timestamptz
        or material_item.requested_quantity-material_item.ordered_quantity-coalesce(material_item.stock_fulfilled_quantity,0)
          is distinct from (item->>'expected_remaining_quantity')::numeric then return false; end if;
      foreach key in array array['quantity_to_quote','quantity_offered','unit_price','discount_percent','tax_percent','freight_amount','other_cost_amount','total'] loop
        if jsonb_typeof(item->key) is distinct from 'number' then return false; end if;
      end loop;
      foreach key in array array['brand','manufacturer','technical_notes'] loop
        if coalesce(jsonb_typeof(item->key),'null') not in ('string','null') then return false; end if;
        if item->>key is not null and (item->>key is distinct from btrim(item->>key) or item->>key='') then return false; end if;
      end loop;
      if coalesce(jsonb_typeof(item->'delivery_days'),'null') not in ('number','null')
        or jsonb_typeof(item->'meets_specification') is distinct from 'boolean'
        or jsonb_typeof(item->'specificationConfirmed') is distinct from 'boolean'
        or (item->>'meets_specification')::boolean and not (item->>'specificationConfirmed')::boolean then return false; end if;
      if item->>'delivery_days' is not null and (item->>'delivery_days')::integer not between 0 and 3650 then return false; end if;
      quantity:=(item->>'quantity_offered')::numeric; unit_price:=(item->>'unit_price')::numeric;
      if quantity<=0 or quantity>material_item.requested_quantity-material_item.ordered_quantity-coalesce(material_item.stock_fulfilled_quantity,0)+0.000001
        or quantity is distinct from (item->>'quantity_to_quote')::numeric or unit_price<=0 or unit_price>1e12
        or (item->>'discount_percent')::numeric not between 0 and 100 or (item->>'tax_percent')::numeric not between 0 and 100
        or (item->>'freight_amount')::numeric<0 or (item->>'other_cost_amount')::numeric<0 then return false; end if;
      if quantity<>round(quantity,6) or unit_price<>round(unit_price,6)
        or (item->>'discount_percent')::numeric<>round((item->>'discount_percent')::numeric,4)
        or (item->>'tax_percent')::numeric<>round((item->>'tax_percent')::numeric,4)
        or (item->>'freight_amount')::numeric<>round((item->>'freight_amount')::numeric,2)
        or (item->>'other_cost_amount')::numeric<>round((item->>'other_cost_amount')::numeric,2) then return false; end if;
      item_total:=round(quantity*unit_price*(1-(item->>'discount_percent')::numeric/100)*(1+(item->>'tax_percent')::numeric/100)
        +(item->>'freight_amount')::numeric+(item->>'other_cost_amount')::numeric,2);
      if item_total is distinct from (item->>'total')::numeric then return false; end if;
      total:=total+item_total; freight:=freight+(item->>'freight_amount')::numeric; other_cost:=other_cost+(item->>'other_cost_amount')::numeric;
      unconfirmed:=unconfirmed or not (item->>'specificationConfirmed')::boolean;
      canonical_items:=canonical_items||jsonb_build_array(jsonb_build_object(
        'code',material_item.input_code,'name',material_item.input_name,'unit',material_item.unit_snapshot,
        'costCenter',concat_ws(' · ',material_item.cost_center_code,material_item.cost_center_name),
        'quantity',quantity,'unitPrice',unit_price,'discountPercent',item->'discount_percent','taxPercent',item->'tax_percent',
        'freight',item->'freight_amount','otherCost',item->'other_cost_amount','brand',item->'brand','manufacturer',item->'manufacturer',
        'deliveryDays',item->'delivery_days','meetsSpecification',item->'meets_specification','specificationConfirmed',item->'specificationConfirmed',
        'technicalNotes',item->'technical_notes','total',item_total));
    end loop;
    foreach key in array array['total','freightTotal','otherTotal'] loop
      if jsonb_typeof(p_payload->key) is distinct from 'number' then return false; end if;
    end loop;
    if total is distinct from (p_payload->>'total')::numeric or freight is distinct from (p_payload->>'freightTotal')::numeric
      or other_cost is distinct from (p_payload->>'otherTotal')::numeric then return false; end if;
    if coalesce(jsonb_typeof(p_payload->'documentTotal'),'null')='null' then
      canonical_warnings:=jsonb_build_array('Total do documento não informado; confira o total calculado.');
    elsif jsonb_typeof(p_payload->'documentTotal')<>'number' or (p_payload->>'documentTotal')::numeric is distinct from total then return false;
    end if;
    if unconfirmed then canonical_warnings:=canonical_warnings||jsonb_build_array('Há itens sem comprovação de atendimento à especificação; eles ficam sem aceite técnico.'); end if;
    canonical:=canonical||jsonb_build_object('items',canonical_items,'total',total,'freightTotal',freight,'otherTotal',other_cost,'warnings',canonical_warnings);
  else
    text_keys:=array['title','scopeSummary','startDate','endDate','signedDate','adjustmentIndex','adjustmentBaseDate','contactName','contactPhone','contactEmail','notes'];
    number_keys:=array['retentionPercent','guaranteePercent','guaranteeMonths','paymentDays'];
    date_keys:=array['startDate','endDate','signedDate','adjustmentBaseDate'];
    if jsonb_typeof(p_payload->'scopeSummary') is distinct from 'string' or nullif(btrim(p_payload->>'scopeSummary'),'') is null
      or p_payload->>'startDate' is null or p_payload->>'endDate' is null then return false; end if;
    select * into competition_row from public.execution_service_competitions
      where id=(p_payload->>'competitionId')::uuid and company_id=p_company_id and project_id=p_project_id and status='approved' and generated_contract_id is null;
    if competition_row.id is null or competition_row.competition_number is distinct from p_payload->>'competitionNumber'
      or competition_row.updated_at is distinct from (p_payload->>'competitionUpdatedAt')::timestamptz
      or competition_row.winner_supplier_id is distinct from supplier_row.id
      or competition_row.winner_offer_id is distinct from (p_payload->>'winnerOfferId')::uuid then return false; end if;
    select * into offer_row from public.execution_service_competition_offers
      where id=competition_row.winner_offer_id and competition_id=competition_row.id and company_id=p_company_id and project_id=p_project_id and status='winner';
    if offer_row.id is null or offer_row.supplier_id is distinct from supplier_row.id
      or offer_row.updated_at is distinct from (p_payload->>'offerUpdatedAt')::timestamptz
      or (select count(*) from public.execution_service_request_items where request_id=competition_row.request_id and company_id=p_company_id and project_id=p_project_id)<>jsonb_array_length(p_payload->'items')
      or (select count(*) from public.execution_service_competition_offer_items where offer_id=offer_row.id and company_id=p_company_id and project_id=p_project_id)<>jsonb_array_length(p_payload->'items') then return false; end if;
    canonical:=canonical||jsonb_build_object('module','Contratos e Medições',
      'competition',jsonb_build_object('id',competition_row.id,'number',competition_row.competition_number,'title',competition_row.title),
      'effects',jsonb_build_array('Criar contrato em elaboração a partir do mapa de concorrência já aprovado.','Registrar escopo, condições e etapas de medição exibidas.','Ativação, medições, aprovação e financeiro continuam nas etapas próprias.'),'warnings','[]'::jsonb);
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      select * into service_item from public.execution_service_request_items
        where id=(item->>'request_item_id')::uuid and request_id=competition_row.request_id and company_id=p_company_id and project_id=p_project_id;
      select * into offer_item from public.execution_service_competition_offer_items
        where id=(item->>'offer_item_id')::uuid and request_item_id=service_item.id and offer_id=offer_row.id and company_id=p_company_id and project_id=p_project_id;
      if service_item.id is null or offer_item.id is null or not offer_item.meets_specification
        or service_item.service_id is distinct from (item->>'service_id')::uuid or service_item.service_code is distinct from item->>'code'
        or service_item.service_name is distinct from item->>'name' or service_item.unit_snapshot is distinct from item->>'unit'
        or service_item.location_name is distinct from item->>'location' or service_item.scope_notes is distinct from item->>'scopeNotes'
        or service_item.measurement_notes is distinct from item->>'measurementNotes' then return false; end if;
      foreach key in array array['quantity','unit_price','total'] loop
        if jsonb_typeof(item->key) is distinct from 'number' then return false; end if;
      end loop;
      if offer_item.offered_quantity is distinct from (item->>'quantity')::numeric
        or offer_item.unit_price is distinct from (item->>'unit_price')::numeric
        or offer_item.total_amount is distinct from (item->>'total')::numeric
        or round(offer_item.offered_quantity*offer_item.unit_price,2) is distinct from offer_item.total_amount
        or offer_item.offered_quantity<=0 or offer_item.unit_price<=0
        or coalesce(jsonb_typeof(item->'stages'),'null')<>'array' or jsonb_array_length(item->'stages') not between 1 and 20 then return false; end if;
      canonical_stages:='[]'::jsonb; stage_weight:=0; stage_index:=0;
      for stage in select value from jsonb_array_elements(item->'stages') loop
        stage_index:=stage_index+1;
        if jsonb_typeof(stage->'name') is distinct from 'string' or nullif(btrim(stage->>'name'),'') is null
          or stage->>'name' is distinct from btrim(stage->>'name')
          or stage->>'code' is distinct from 'ET-'||lpad(stage_index::text,2,'0')
          or coalesce(jsonb_typeof(stage->'description'),'null') not in ('string','null')
          or jsonb_typeof(stage->'measurement_mode') is distinct from 'string' or stage->>'measurement_mode' not in ('quantity','percent')
          or jsonb_typeof(stage->'weight_percent') is distinct from 'number'
          or (stage->>'weight_percent')::numeric<=0 or (stage->>'weight_percent')::numeric>100
          or (stage->>'weight_percent')::numeric<>round((stage->>'weight_percent')::numeric,4) then return false; end if;
        if stage->>'description' is not null and (stage->>'description' is distinct from btrim(stage->>'description') or stage->>'description'='') then return false; end if;
        stage_weight:=stage_weight+(stage->>'weight_percent')::numeric;
        canonical_stages:=canonical_stages||jsonb_build_array(jsonb_build_object('name',stage->'name','description',stage->'description',
          'measurementMode',stage->'measurement_mode','weightPercent',stage->'weight_percent'));
      end loop;
      if abs(stage_weight-100)>0.001 then return false; end if;
      total:=total+offer_item.total_amount;
      canonical_items:=canonical_items||jsonb_build_array(jsonb_build_object('code',service_item.service_code,'name',service_item.service_name,
        'location',service_item.location_name,'scopeNotes',service_item.scope_notes,'measurementNotes',service_item.measurement_notes,
        'unit',service_item.unit_snapshot,'quantity',offer_item.offered_quantity,'unitPrice',offer_item.unit_price,'total',offer_item.total_amount,'stages',canonical_stages));
    end loop;
    if jsonb_typeof(p_payload->'total') is distinct from 'number' or total is distinct from (p_payload->>'total')::numeric
      or total is distinct from offer_row.total_amount then return false; end if;
    foreach key in array number_keys loop
      if jsonb_typeof(p_payload->key) is distinct from 'number' then return false; end if;
    end loop;
    if (p_payload->>'retentionPercent')::numeric not between 0 and 100 or (p_payload->>'guaranteePercent')::numeric not between 0 and 100
      or (p_payload->>'retentionPercent')::numeric<>round((p_payload->>'retentionPercent')::numeric,4)
      or (p_payload->>'guaranteePercent')::numeric<>round((p_payload->>'guaranteePercent')::numeric,4)
      or (p_payload->>'retentionPercent')::numeric+(p_payload->>'guaranteePercent')::numeric>100
      or (p_payload->>'guaranteeMonths')::integer not between 0 and 240 or (p_payload->>'paymentDays')::integer not between 0 and 365
      or (p_payload->>'endDate')::date<(p_payload->>'startDate')::date then return false; end if;
    canonical:=canonical||jsonb_build_object('items',canonical_items,'total',total);
  end if;
  foreach key in array text_keys loop
    if coalesce(jsonb_typeof(p_payload->key),'null') not in ('string','null') then return false; end if;
    if p_payload->>key is not null and (p_payload->>key is distinct from btrim(p_payload->>key) or p_payload->>key='') then return false; end if;
    canonical:=canonical||jsonb_build_object(key,p_payload->key);
  end loop;
  foreach key in array number_keys loop
    if coalesce(jsonb_typeof(p_payload->key),'null') not in ('number','null') then return false; end if;
    if p_payload->>key is not null and (p_payload->>key)::numeric<0 then return false; end if;
    if key='deliveryDays' and p_payload->>key is not null and (p_payload->>key)::integer not between 0 and 3650 then return false; end if;
    canonical:=canonical||jsonb_build_object(key,p_payload->key);
  end loop;
  foreach key in array date_keys loop
    if p_payload->>key is not null and ((p_payload->>key)!~'^\d{4}-\d{2}-\d{2}$' or ((p_payload->>key)::date)::text is distinct from p_payload->>key) then return false; end if;
  end loop;
  -- JSONB equality rejects changed values, hidden/extra presentation fields and
  -- omitted business data. sourceFile is separately bound to the attachment by
  -- prepare/execute; it is included here to forbid extra preview properties.
  return canonical=p_preview;
exception when others then
  return false;
end;
$$;
revoke all on function public.ai_validate_procurement_document_preview(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;

commit;
