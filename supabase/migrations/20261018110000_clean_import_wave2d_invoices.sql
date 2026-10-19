-- Importação limpa — Onda 2d: notas fiscais eletrônicas (NF-e) de material do Flow
--
-- Origem: notas de entrada da empresa Flow (cabeçalho, produtos, totais e duplicatas).
-- * Notas canceladas não entram.
-- * Numeração no padrão Elos (NFE-0001...) pela data de emissão.
-- * Vínculo com o Pedido (onda 2b) pelos pedidos que a origem associa à nota, e com o
--   Recebimento (onda 2c) pelas entradas de estoque que apontam para a nota.
-- * Cada produto é distribuído entre os itens do pedido com o mesmo insumo (um por centro de custo),
--   na proporção da quantidade pedida. Assim a nota segue o mesmo rateio do pedido.
--   Produto sem item de pedido correspondente entra sem centro de custo e vira pendência.
-- * As parcelas vêm das duplicatas da nota; se a soma não fechar com o total, a última parcela é ajustada
--   e o caso vira pendência. Os títulos a pagar são ligados às parcelas na onda seguinte (financeiro).
-- * O arquivo XML original não acompanha a importação: o caminho registrado é uma referência neutra
--   pela chave de acesso, para anexar o arquivo depois.
-- * As notas entram aprovadas (são fatos já ocorridos); a conferência Pedido × Recebimento × Nota é
--   recalculada pelos gatilhos normais e as divergências históricas ficam visíveis.

create or replace function elos_import.wave2d_invoices(p_company_id uuid, p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; pr record; part record; d record;
  v_entity uuid; v_seq int; v_inv uuid; v_supplier uuid; v_pos uuid[]; v_recs uuid[]; v_order uuid; v_receipt uuid;
  v_input uuid; v_line int; v_parts int; v_i int; v_qty numeric; v_amt numeric; v_left_amt numeric; v_left_qty numeric;
  v_rec_item uuid; v_total numeric; v_dup_sum numeric; v_n int; v_last numeric; v_unit text; v_key text;
  v_count int := 0; v_items int := 0; v_noorder int := 0; v_dupfix int := 0; v_value numeric := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '2d-notas-fiscais') returning id into v_run;
  select legal_entity_id into v_entity from projects where id = p_project_id;
  select coalesce(max(sequence_no), 0) into v_seq from finance_electronic_invoices where project_id = p_project_id;

  for r in
    select m.payload->'data' d, s.payload->'purchaseOrders' spo
    from koper_staging_records m
    left join koper_staging_records s on s.entity = 'xml_invoice' and s.payload->>'invoiceId' = m.payload->'data'->>'invoiceId'
    where m.entity = 'mirror.xml_invoice' and m.payload->>'_enterprise' = 'flow'
      and m.payload->'data'->>'situation' <> 'Cancelada'
      and coalesce((m.payload->'data'->>'isDraft')::boolean, false) = false
    order by (m.payload->'data'->>'emitDate')::timestamptz, m.payload->'data'->>'invoiceNumber'
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'xml_invoice', r.d->>'invoiceId') is not null then continue; end if;
    v_key := r.d->>'accessKey';
    v_total := coalesce(nullif(r.d->'total'->>'totalNF', '')::numeric, 0);

    v_supplier := elos_import.ensure_supplier(p_company_id, r.d->'supplier'->>'supplierId',
      coalesce(r.d->'supplier'->>'supplierName', r.d->'supplier'->>'fantasyName'), r.d->'supplier'->>'cnpj');

    -- Pedidos ligados à nota (da origem) e recebimentos que apontam para ela.
    select array_agg(o.id order by o.total_amount desc nulls last) into v_pos
    from (select distinct elos_import.map_get(p_company_id, p_project_id, 'purchase_order', x->>'purchaseOrderId') id
          from jsonb_array_elements(coalesce(nullif(r.spo, 'null'::jsonb), nullif(r.d->'purchaseOrders', 'null'::jsonb), '[]')) x) z
    join procurement_purchase_orders o on o.id = z.id;

    select array_agg(distinct elos_import.map_get(p_company_id, p_project_id, 'stock_entry', (e.payload->>'stockMovementId') || ':' || po)) into v_recs
    from koper_staging_records e, jsonb_array_elements_text(coalesce(e.payload->'purchaseOrderIds', '[]')) po
    where e.entity = 'stock_entry' and e.payload->'invoiceIds' ? (r.d->>'invoiceId');
    v_recs := array_remove(v_recs, null);

    -- Pedido sem vínculo direto, mas recebimento encontrado: o pedido vem do recebimento.
    if v_pos is null and cardinality(v_recs) > 0 then
      select array_agg(distinct order_id) into v_pos from procurement_material_receipts where id = any(v_recs);
    end if;
    v_order := v_pos[1];
    v_receipt := null;
    select id into v_receipt from procurement_material_receipts where id = any(coalesce(v_recs, '{}'))
      order by (order_id = v_order) desc, receipt_date limit 1;

    v_seq := v_seq + 1;
    insert into finance_electronic_invoices(company_id, project_id, legal_entity_id, supplier_id, order_id, receipt_id, sequence_no, registry_number,
      status, validation_status, access_key, model, series, invoice_number, issue_date, issue_datetime, operation_nature,
      issuer_tax_id, issuer_name, issuer_trade_name, recipient_tax_id, recipient_name,
      products_amount, freight_amount, discount_amount, ipi_amount, pis_amount, cofins_amount, other_amount, invoice_total,
      xml_storage_path, xml_file_name, xml_hash, imported_by, imported_at, approved_by, approved_at, approval_notes, created_at, updated_at)
    values (p_company_id, p_project_id, v_entity, v_supplier, v_order, v_receipt, v_seq, 'NFE-' || lpad(v_seq::text, 4, '0'),
      'approved', 'ready', v_key, substr(v_key, 21, 2), ltrim(substr(v_key, 23, 3), '0'), r.d->>'invoiceNumber',
      (r.d->>'emitDate')::timestamptz::date, (r.d->>'emitDate')::timestamptz, nullif(r.d->>'itemChartName', ''),
      regexp_replace(coalesce(r.d->'supplier'->>'cnpj', ''), '[^0-9]', '', 'g'),
      coalesce(r.d->'supplier'->>'supplierName', r.d->'supplier'->>'fantasyName', 'Fornecedor'), nullif(r.d->'supplier'->>'fantasyName', ''),
      regexp_replace(coalesce(r.d->'receiver'->>'cnpj', ''), '[^0-9]', '', 'g'), nullif(regexp_replace(coalesce(r.d->'receiver'->>'companyName', ''), '\s+\d+$', ''), ''),
      coalesce((select sum(nullif(x->>'totalValue', '')::numeric) from jsonb_array_elements(coalesce(r.d->'products', '[]')) x), 0),
      greatest(coalesce(nullif(r.d->'total'->>'shippingValue', '')::numeric, 0), 0),
      greatest(coalesce(nullif(r.d->'total'->>'totalDiscount', '')::numeric, 0), 0),
      greatest(coalesce(nullif(r.d->'total'->>'ipi', '')::numeric, 0), 0),
      greatest(coalesce(nullif(r.d->'total'->>'pis', '')::numeric, 0), 0),
      greatest(coalesce(nullif(r.d->'total'->>'cofins', '')::numeric, 0), 0),
      greatest(coalesce(nullif(r.d->'total'->>'otherValues', '')::numeric, 0), 0) + greatest(coalesce(nullif(r.d->'total'->>'st', '')::numeric, 0), 0),
      v_total,
      'importacao/nfe/' || v_key || '.xml', v_key || '.xml', 'importacao:' || v_key,
      p_user_id, (r.d->>'emitDate')::timestamptz, p_user_id, coalesce(nullif(r.d->>'exitDate', '')::timestamptz, (r.d->>'emitDate')::timestamptz),
      'Nota histórica trazida na importação do Flow.', (r.d->>'emitDate')::timestamptz, now())
    returning id into v_inv;
    perform elos_import.map_put(p_company_id, p_project_id, 'xml_invoice', r.d->>'invoiceId', 'finance_electronic_invoice', v_inv, 'imported',
      'NFE-' || lpad(v_seq::text, 4, '0'));
    v_count := v_count + 1; v_value := v_value + v_total;
    if v_order is null then
      v_noorder := v_noorder + 1;
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'xml_invoice', r.d->>'invoiceId', 'nota_sem_pedido',
        jsonb_build_object('nota', 'NFE-' || lpad(v_seq::text, 4, '0'), 'numero', r.d->>'invoiceNumber', 'fornecedor', r.d->'supplier'->>'supplierName', 'valor', v_total));
    end if;

    -- Itens
    v_line := 0;
    for pr in
      select x p from jsonb_array_elements(coalesce(r.d->'products', '[]')) x
      order by nullif(x->>'numberItem', '')::int nulls last
    loop
      -- Produto que a origem não vinculou a um insumo entra sem insumo (como numa NF-e recém-chegada).
      if nullif(pr.p->>'productId', '') is null then
        v_input := null;
      else
        v_input := coalesce(elos_import.map_get(p_company_id, null, 'product', pr.p->>'productId'),
          elos_import.ensure_input(p_company_id, pr.p->>'productId', coalesce(nullif(pr.p->>'productFullName', ''), nullif(pr.p->>'productName', ''), pr.p->>'supplierProductName'), coalesce(pr.p->>'symbol', lower(pr.p->>'unitMeasure'))));
      end if;
      v_qty := coalesce(nullif(pr.p->>'amount', '')::numeric, 0);
      v_amt := coalesce(nullif(pr.p->>'totalValue', '')::numeric, 0);
      v_parts := 0;
      select count(*) into v_parts from procurement_purchase_order_items where order_id = any(coalesce(v_pos, '{}')) and input_id = v_input;

      if v_parts = 0 then
        v_line := v_line + 1;
        v_unit := null;
        select unit into v_unit from engineering_inputs where id = v_input;
        insert into finance_electronic_invoice_items(company_id, project_id, invoice_id, line_number, supplier_product_code, description, cfop, unit_snapshot,
          quantity, unit_price, gross_amount, total_amount, input_id, mapping_status, notes)
        values (p_company_id, p_project_id, v_inv, v_line, nullif(pr.p->>'supplierProductCode', ''),
          coalesce(nullif(pr.p->>'supplierProductName', ''), pr.p->>'productFullName', 'Item'), nullif(pr.p->>'cfop', ''), coalesce(v_unit, pr.p->>'symbol', lower(pr.p->>'unitMeasure')),
          v_qty, coalesce(nullif(pr.p->>'unitValue', '')::numeric, 0), v_amt, v_amt, v_input,
          case when v_input is null then 'unmapped' else 'matched' end,
          case when v_input is null then 'Produto sem insumo vinculado na origem.' else 'Sem item de pedido correspondente na origem.' end);
        v_items := v_items + 1;
        if v_input is null then
          perform elos_import.issue(v_run, p_company_id, p_project_id, 'xml_invoice_item', (r.d->>'invoiceId') || ':' || coalesce(pr.p->>'numberItem', ''),
            'item_nota_sem_insumo', jsonb_build_object('nota', 'NFE-' || lpad(v_seq::text, 4, '0'), 'produto', pr.p->>'supplierProductName', 'valor', v_amt));
        elsif v_order is not null then
          perform elos_import.issue(v_run, p_company_id, p_project_id, 'xml_invoice_item', (r.d->>'invoiceId') || ':' || coalesce(pr.p->>'numberItem', ''),
            'item_nota_sem_item_de_pedido', jsonb_build_object('nota', 'NFE-' || lpad(v_seq::text, 4, '0'), 'produto', pr.p->>'productFullName', 'valor', v_amt));
        end if;
        continue;
      end if;

      v_i := 0; v_left_amt := v_amt; v_left_qty := v_qty;
      for part in
        select poi.*, poi.ordered_quantity / nullif(sum(poi.ordered_quantity) over (), 0) share
        from procurement_purchase_order_items poi
        where poi.order_id = any(v_pos) and poi.input_id = v_input
        order by (poi.order_id = v_order) desc, poi.ordered_quantity desc, poi.id
      loop
        v_i := v_i + 1; v_line := v_line + 1;
        v_rec_item := null;
        select ri.id into v_rec_item from procurement_material_receipt_items ri
         where ri.order_item_id = part.id and ri.receipt_id = any(coalesce(v_recs, '{}'))
         order by (ri.receipt_id = v_receipt) desc limit 1;
        insert into finance_electronic_invoice_items(company_id, project_id, invoice_id, line_number, supplier_product_code, description, cfop, unit_snapshot,
          quantity, unit_price, gross_amount, total_amount, input_id, cost_center_service_id, order_item_id, receipt_item_id, mapping_status, notes)
        values (p_company_id, p_project_id, v_inv, v_line, nullif(pr.p->>'supplierProductCode', ''),
          coalesce(nullif(pr.p->>'supplierProductName', ''), pr.p->>'productFullName', 'Item'), nullif(pr.p->>'cfop', ''), part.unit_snapshot,
          case when v_i = v_parts then v_left_qty else round(v_qty * coalesce(part.share, 1.0 / v_parts), 6) end,
          coalesce(nullif(pr.p->>'unitValue', '')::numeric, 0),
          case when v_i = v_parts then v_left_amt else round(v_amt * coalesce(part.share, 1.0 / v_parts), 2) end,
          case when v_i = v_parts then v_left_amt else round(v_amt * coalesce(part.share, 1.0 / v_parts), 2) end,
          v_input, part.cost_center_service_id, part.id, v_rec_item, 'matched',
          case when v_parts > 1 then 'Rateado conforme centros de custo do pedido (' || part.cost_center_code || ').' end);
        v_left_amt := v_left_amt - round(v_amt * coalesce(part.share, 1.0 / v_parts), 2);
        v_left_qty := v_left_qty - round(v_qty * coalesce(part.share, 1.0 / v_parts), 6);
        v_items := v_items + 1;
      end loop;
    end loop;

    -- Parcelas (duplicatas)
    select count(*), coalesce(sum(nullif(x->>'billValue', '')::numeric), 0) into v_n, v_dup_sum
    from jsonb_array_elements(coalesce(r.d->'bill'->'duplicates', '[]')) x where coalesce(nullif(x->>'billValue', '')::numeric, 0) > 0;
    if v_n = 0 then
      insert into finance_electronic_invoice_installments(company_id, project_id, invoice_id, sequence_no, installment_label, due_date, amount, payment_method)
      values (p_company_id, p_project_id, v_inv, 1, '1', (r.d->>'emitDate')::timestamptz::date, v_total, 'Não informado');
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'xml_invoice', r.d->>'invoiceId', 'nota_sem_duplicatas',
        jsonb_build_object('nota', 'NFE-' || lpad(v_seq::text, 4, '0'), 'valor', v_total));
    else
      if abs(v_dup_sum - v_total) > 0.009 then
        v_dupfix := v_dupfix + 1;
        perform elos_import.issue(v_run, p_company_id, p_project_id, 'xml_invoice', r.d->>'invoiceId', 'duplicatas_nao_fecham_com_nota',
          jsonb_build_object('nota', 'NFE-' || lpad(v_seq::text, 4, '0'), 'total_nota', v_total, 'total_duplicatas', v_dup_sum));
      end if;
      insert into finance_electronic_invoice_installments(company_id, project_id, invoice_id, sequence_no, installment_label, due_date, amount)
      select p_company_id, p_project_id, v_inv, q.rn, coalesce(nullif(q.x->>'duplicateNumber', ''), q.rn::text),
        coalesce(nullif(q.x->>'dueDate', '')::timestamp::date, (r.d->>'emitDate')::timestamptz::date),
        case when q.rn = v_n then (q.x->>'billValue')::numeric + (v_total - v_dup_sum) else (q.x->>'billValue')::numeric end
      from (select x, (row_number() over (order by nullif(x->>'billOrder', '')::int nulls last, x->>'dueDate'))::int rn
            from jsonb_array_elements(r.d->'bill'->'duplicates') x where coalesce(nullif(x->>'billValue', '')::numeric, 0) > 0) q;
      for d in
        select i.id, q.x->>'billId' bill_id
        from (select x, (row_number() over (order by nullif(x->>'billOrder', '')::int nulls last, x->>'dueDate'))::int rn
              from jsonb_array_elements(r.d->'bill'->'duplicates') x where coalesce(nullif(x->>'billValue', '')::numeric, 0) > 0) q
        join finance_electronic_invoice_installments i on i.invoice_id = v_inv and i.sequence_no = q.rn
      loop
        perform elos_import.map_put(p_company_id, p_project_id, 'bill', d.bill_id, 'finance_electronic_invoice_installment', d.id, 'imported');
      end loop;
    end if;

    -- Recebimentos ganham os dados da nota, como na aprovação normal.
    update procurement_material_receipts set invoice_number = r.d->>'invoiceNumber', invoice_series = ltrim(substr(v_key, 23, 3), '0'),
      invoice_access_key = v_key, invoice_date = (r.d->>'emitDate')::timestamptz::date, updated_at = now()
    where id = any(coalesce(v_recs, '{}'));
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('notas', v_count, 'itens', v_items, 'valor', v_value, 'sem_pedido', v_noorder, 'duplicatas_ajustadas', v_dupfix) where id = v_run;
  return jsonb_build_object('notas', v_count, 'itens', v_items, 'valor', v_value, 'sem_pedido', v_noorder, 'duplicatas_ajustadas', v_dupfix);
end;
$$;

revoke all on function elos_import.wave2d_invoices(uuid, uuid, uuid) from public, anon, authenticated;
