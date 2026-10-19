-- Importação limpa — Onda 2b: pedidos de compra do Flow
--
-- Origem: purchase_order + purchase_order_item (empresa Flow).
-- * Pedidos cancelados não entram. Finalizados entram como "closed".
-- * Numeração no padrão Elos (PC-0001...) pela data do pedido.
-- * O centro de custo do item vem, nesta ordem: das solicitações atendidas (rateado pelo que cada
--   item da solicitação pediu), dos centros de custo do próprio item, ou "SEM-CC" (pendência).
-- * Um item da origem com vários centros de custo vira um item do pedido por centro de custo.
-- * Valores negativos da origem (preço final, quantidade recebida) são tratados como zero.
-- * A quantidade pedida da solicitação nunca passa da quantidade solicitada.
-- * Cada parte ligada a uma solicitação gera o vínculo pedido → solicitação (allocations), e a
--   quantidade pedida da solicitação é atualizada.

-- Fornecedor que só aparece no pedido (fora do cadastro da origem): vincula por CPF/CNPJ ou cria.
create or replace function elos_import.ensure_supplier(p_company_id uuid, p_source_id text, p_name text, p_doc text)
returns uuid
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare v_id uuid; v_doc text := nullif(regexp_replace(coalesce(p_doc, ''), '\D', '', 'g'), '');
begin
  v_id := elos_import.map_get(p_company_id, null, 'supplier', p_source_id);
  if v_id is not null then return v_id; end if;
  if nullif(btrim(p_name), '') is null or p_name ilike '%koper%' or p_name ilike '%não identificado%' then return null; end if;
  if v_doc is not null then
    select id into v_id from suppliers where company_id = p_company_id and regexp_replace(coalesce(tax_id, ''), '\D', '', 'g') = v_doc
    order by (coalesce(source_system, '') ilike 'koper%'), (status <> 'active'), created_at limit 1;
  end if;
  if v_id is null then
    insert into suppliers(company_id, person_type, legal_name, tax_id, category, status, source_system, source_id)
    values (p_company_id, case when length(v_doc) = 14 then 'company' when length(v_doc) = 11 then 'individual' else 'other' end,
            btrim(p_name), v_doc, 'Serviços / materiais', 'active', 'elos_import', 'supplier:' || p_source_id)
    on conflict (company_id, source_system, source_id) do update set updated_at = now() returning id into v_id;
  end if;
  perform elos_import.map_put(p_company_id, null, 'supplier', p_source_id, 'supplier', v_id,
    case when v_doc is not null then 'tax_id_or_created' else 'created' end, p_name, v_doc);
  return v_id;
end;
$$;

revoke all on function elos_import.ensure_supplier(uuid, text, text, text) from public, anon, authenticated;

create or replace function elos_import.wave2b_purchase_orders(p_company_id uuid, p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; it record; part record;
  v_po uuid; v_seq int; v_supplier uuid; v_input uuid; v_inp record; v_sort int; v_poi uuid; v_req record;
  v_sub numeric; v_freight numeric; v_disc numeric;
  v_pos int := 0; v_items int := 0; v_nocc int := 0; v_links int := 0; v_skip int := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '2b-pedidos') returning id into v_run;
  select coalesce(max(sequence_no), 0) into v_seq from procurement_purchase_orders where project_id = p_project_id;

  for r in
    select payload p from koper_staging_records
    where entity = 'purchase_order' and payload->>'status' not ilike 'cancel%' and coalesce((payload->>'isDraft')::boolean, false) = false
    order by (payload->>'orderDate')::timestamptz, (payload->>'orderId')::int
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'purchase_order', r.p->>'orderId') is not null then continue; end if;

    v_supplier := elos_import.ensure_supplier(p_company_id, r.p->>'supplierId',
      coalesce(nullif(r.p->>'companyName', ''), r.p->>'supplierName'), coalesce(r.p->>'supplierCnpj', r.p->>'supplierCpf'));
    if v_supplier is null then
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'purchase_order', r.p->>'orderId', 'fornecedor_sem_vinculo',
        jsonb_build_object('fornecedor', r.p->>'supplierName'));
      v_skip := v_skip + 1;
      continue;
    end if;

    v_seq := v_seq + 1;
    v_freight := greatest(coalesce(nullif(r.p->>'costShipping', '')::numeric, 0), 0);
    v_disc := greatest(coalesce(nullif(r.p->>'totalDiscount', '')::numeric, 0), 0);
    insert into procurement_purchase_orders(company_id, project_id, supplier_id, sequence_no, order_number, status, issue_date,
      expected_delivery_date, buyer_name, supplier_contact_name, supplier_contact_email, notes,
      freight_amount, discount_amount, issued_by, issued_at, closed_by, closed_at, created_by, created_at, updated_at,
      source_system, source_id)
    values (p_company_id, p_project_id, v_supplier, v_seq, 'PC-' || lpad(v_seq::text, 4, '0'), 'closed', (r.p->>'orderDate')::date,
      nullif(r.p->>'deliveryDate', '')::date, nullif(btrim(r.p->>'userName'), ''), nullif(btrim(r.p->>'personName'), ''),
      nullif(btrim(r.p->>'email'), ''), nullif(btrim(coalesce(r.p->>'comments', '')), ''),
      v_freight, v_disc, p_user_id, (r.p->>'orderDate')::timestamptz, p_user_id, (r.p->>'orderDate')::timestamptz,
      p_user_id, (r.p->>'orderDate')::timestamptz, now(), 'elos_import', 'flow:po:' || (r.p->>'orderId'))
    returning id into v_po;
    perform elos_import.map_put(p_company_id, p_project_id, 'purchase_order', r.p->>'orderId', 'procurement_purchase_order', v_po, 'imported',
      'PC-' || lpad(v_seq::text, 4, '0'));
    v_pos := v_pos + 1; v_sort := 0; v_sub := 0;

    for it in
      select payload p from koper_staging_records
      where entity = 'purchase_order_item' and payload->>'orderId' = r.p->>'orderId'
        and coalesce((payload->>'prodCanceled')::boolean, false) = false
        and coalesce(nullif(payload->>'amount', '')::numeric, 0) > 0
      order by (payload->>'orderProductId')::int
    loop
      v_input := elos_import.ensure_input(p_company_id, it.p->>'productId',
        coalesce(nullif(it.p->>'productFullName', ''), it.p->>'productName'), it.p->>'symbol');
      select code, description, unit into v_inp from engineering_inputs where id = v_input;

      -- partes do item por centro de custo (e solicitação, quando houver)
      for part in
        with req_parts as (
          select ri.id request_item_id, ri.request_id, er.request_number, ri.cost_center_service_id sid, ri.cost_center_code cc_code, ri.cost_center_name cc_name,
                 (x->>'requestAmount')::numeric * ri.requested_quantity
                   / nullif(sum(ri.requested_quantity) over (partition by x->>'productRequestId'), 0) qty
          from jsonb_array_elements(coalesce(it.p->'requests', '[]')) x
          join integration_mappings m on m.company_id = p_company_id and m.project_id = p_project_id and m.source_system = 'koper'
               and m.source_entity_type = 'stock_request_item' and m.external_id like (x->>'productRequestId') || ':%'
          join execution_material_request_items ri on ri.id = m.target_entity_id
          join execution_material_requests er on er.id = ri.request_id
        ),
        svc_parts as (
          select null::uuid request_item_id, null::uuid request_id, null::text request_number, cc.service_id sid,
                 case when cc.service_id is not null then cc.code when cc.kref like '29.%' then 'VIAB' else 'SEM-CC' end cc_code,
                 case when cc.service_id is not null then cc.name when cc.kref like '29.%' then 'Custos de incorporação (viabilidade)' else 'Sem centro de custo na origem' end cc_name,
                 (x->>'inputAmount')::numeric qty
          from jsonb_array_elements(coalesce(it.p->'services', '[]')) x
          left join lateral elos_import.cost_center_for_monitoring_input(p_project_id, x->>'itemMonitInputId') cc on true
          where not exists (select 1 from req_parts)
        ),
        all_parts as (
          select * from req_parts union all select * from svc_parts
        ),
        normalized as (
          -- garante que as partes somem exatamente a quantidade do pedido
          select *, qty * (it.p->>'amount')::numeric / nullif(sum(qty) over (), 0) q from all_parts where qty > 0
        )
        select * from normalized
        union all
        select null, null, null, null, 'SEM-CC', 'Sem centro de custo na origem', (it.p->>'amount')::numeric, (it.p->>'amount')::numeric
        where not exists (select 1 from all_parts where qty > 0)
      loop
        v_sort := v_sort + 1;
        insert into procurement_purchase_order_items(company_id, project_id, order_id, request_id, request_item_id, input_id, cost_center_service_id,
          request_number, input_code, input_name, unit_snapshot, cost_center_code, cost_center_name, ordered_quantity,
          received_quantity, accepted_quantity, unit_price, discount_percent, delivered_unit_cost, total_amount, sort_order,
          source_system, source_id)
        values (p_company_id, p_project_id, v_po, part.request_id, part.request_item_id, v_input, part.sid,
          coalesce(part.request_number, '—'), v_inp.code, v_inp.description, v_inp.unit, part.cc_code, part.cc_name, round(part.q, 6),
          least(round(part.q, 6), round(greatest(coalesce(nullif(it.p->>'amountReceived', '')::numeric, 0), 0) * part.q / (it.p->>'amount')::numeric, 6)),
          least(round(part.q, 6), round(greatest(coalesce(nullif(it.p->>'amountReceived', '')::numeric, 0), 0) * part.q / (it.p->>'amount')::numeric, 6)),
          greatest(coalesce(nullif(it.p->>'price', '')::numeric, 0), 0), case when nullif(it.p->>'price', '')::numeric > 0 and nullif(it.p->>'finalPrice', '')::numeric between 0 and nullif(it.p->>'price', '')::numeric
                then round((1 - nullif(it.p->>'finalPrice', '')::numeric / nullif(it.p->>'price', '')::numeric) * 100, 4) else 0 end,
          greatest(coalesce(nullif(it.p->>'finalPrice', '')::numeric, nullif(it.p->>'price', '')::numeric, 0), 0),
          round(part.q * greatest(coalesce(nullif(it.p->>'finalPrice', '')::numeric, nullif(it.p->>'price', '')::numeric, 0), 0), 2), v_sort,
          'elos_import', 'flow:poi:' || (it.p->>'orderProductId') || ':' || v_sort)
        returning id into v_poi;
        v_sub := v_sub + round(part.q * greatest(coalesce(nullif(it.p->>'finalPrice', '')::numeric, nullif(it.p->>'price', '')::numeric, 0), 0), 2);
        v_items := v_items + 1;
        if part.sid is null and part.cc_code = 'SEM-CC' then
          v_nocc := v_nocc + 1;
          perform elos_import.issue(v_run, p_company_id, p_project_id, 'purchase_order_item', (it.p->>'orderProductId') || ':' || v_sort, 'sem_centro_de_custo',
            jsonb_build_object('pedido', 'PC-' || lpad(v_seq::text, 4, '0'), 'insumo', v_inp.description));
        end if;
        if part.request_item_id is not null then
          insert into procurement_purchase_order_item_request_allocations(company_id, project_id, purchase_order_item_id, request_id, request_item_id,
            allocated_quantity, source_system, source_id)
          values (p_company_id, p_project_id, v_poi, part.request_id, part.request_item_id, round(part.q, 6), 'elos_import', 'flow:poi-req:' || v_poi)
          on conflict (purchase_order_item_id, request_item_id) do nothing;
          update execution_material_request_items set ordered_quantity = least(requested_quantity, ordered_quantity + round(part.q, 6)), updated_at = now()
           where id = part.request_item_id;
          v_links := v_links + 1;
        end if;
      end loop;
    end loop;

    update procurement_purchase_orders
       set subtotal_amount = v_sub, total_amount = greatest(v_sub + v_freight - v_disc, 0),
           received_amount = (select coalesce(sum(round(received_quantity * delivered_unit_cost, 2)), 0) from procurement_purchase_order_items where order_id = v_po)
     where id = v_po;
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('pedidos', v_pos, 'itens', v_items, 'vinculos_solicitacao', v_links, 'sem_centro_de_custo', v_nocc, 'sem_fornecedor', v_skip)
   where id = v_run;
  return jsonb_build_object('pedidos', v_pos, 'itens', v_items, 'vinculos_solicitacao', v_links, 'sem_centro_de_custo', v_nocc, 'sem_fornecedor', v_skip);
end;
$$;

create index if not exists integration_mappings_external_id_prefix_idx
  on public.integration_mappings (company_id, source_entity_type, external_id text_pattern_ops);

revoke all on function elos_import.wave2b_purchase_orders(uuid, uuid, uuid) from public, anon, authenticated;
