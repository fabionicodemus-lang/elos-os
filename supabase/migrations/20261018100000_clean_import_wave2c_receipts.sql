-- Importação limpa — Onda 2c: recebimentos de material do Flow
--
-- Origem: stock_entry + stock_entry_item do tipo "Compra programada" (entrada ligada a pedido).
-- Ajustes de inventário, transferências e registro inicial não são recebimentos de compra e ficam de fora.
-- * Um recebimento no Elos por par (entrada da origem, pedido). Numeração REC-0001... pela data.
-- * Cada item da entrada é distribuído entre os itens do pedido com o mesmo insumo (um por centro de custo),
--   na proporção da quantidade pedida, sem passar do que foi pedido (excesso de entrega fica de fora).
-- * O custo unitário do recebimento é o do item do pedido (a origem registra valor de estoque, não de compra).
-- * Só entram itens da entrada que a origem aponta como candidatos daquele pedido.
-- * Os recebimentos entram aprovados. As quantidades recebidas do pedido já vieram da onda 2b,
--   então aqui não são somadas de novo.

create or replace function elos_import.wave2c_receipts(p_company_id uuid, p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; e record; po_id text; it record; part record;
  v_po record; v_rec uuid; v_seq int; v_input uuid; v_sort int; v_inv record; v_prev numeric; v_qty numeric; v_hit boolean;
  v_recs int := 0; v_items int := 0; v_orphans int := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '2c-recebimentos') returning id into v_run;
  select coalesce(max(sequence_no), 0) into v_seq from procurement_material_receipts where project_id = p_project_id;

  for e in
    select payload p from koper_staging_records
    where entity = 'stock_entry' and payload->>'entryType' = 'Compra programada'
      and jsonb_array_length(coalesce(payload->'purchaseOrderIds', '[]')) > 0
    order by (payload->>'movementDate')::timestamptz, (payload->>'stockMovementId')::int
  loop
    for po_id in select jsonb_array_elements_text(e.p->'purchaseOrderIds') loop
      if elos_import.map_get(p_company_id, p_project_id, 'stock_entry', (e.p->>'stockMovementId') || ':' || po_id) is not null then continue; end if;
      select o.* into v_po from procurement_purchase_orders o
       where o.id = elos_import.map_get(p_company_id, p_project_id, 'purchase_order', po_id);
      if v_po.id is null then continue; end if;

      select x.payload->>'invoiceNumber' num, x.payload->>'emitDate' dt, nullif(x.payload->'total'->>'totalValue', '')::numeric val into v_inv
      from koper_staging_records x
      where x.entity = 'xml_invoice' and x.payload->>'invoiceId' = any(array(select jsonb_array_elements_text(coalesce(e.p->'invoiceIds', '[]'))))
      limit 1;

      v_seq := v_seq + 1; v_sort := 0;
      insert into procurement_material_receipts(company_id, project_id, order_id, supplier_id, sequence_no, receipt_number, status, receipt_date,
        invoice_number, invoice_date, invoice_amount, receiver_user_id, receiver_name, submitted_by, submitted_at, approved_by, approved_at,
        created_by, created_at, updated_at)
      values (p_company_id, p_project_id, v_po.id, v_po.supplier_id, v_seq, 'REC-' || lpad(v_seq::text, 4, '0'), 'approved',
        (e.p->>'movementDate')::date, v_inv.num, nullif(v_inv.dt, '')::date, v_inv.val, p_user_id, 'Almoxarifado da obra',
        p_user_id, (e.p->>'movementDate')::timestamptz, p_user_id, (e.p->>'movementDate')::timestamptz,
        p_user_id, (e.p->>'movementDate')::timestamptz, now())
      returning id into v_rec;
      perform elos_import.map_put(p_company_id, p_project_id, 'stock_entry', (e.p->>'stockMovementId') || ':' || po_id, 'procurement_material_receipt', v_rec,
        'imported', 'REC-' || lpad(v_seq::text, 4, '0'));
      v_recs := v_recs + 1;

      for it in
        select payload p from koper_staging_records
        where entity = 'stock_entry_item' and payload->>'stockMovementId' = e.p->>'stockMovementId'
          and coalesce(nullif(payload->>'productAmount', '')::numeric, 0) > 0
          and payload->'candidatePurchaseOrderIds' ? po_id
      loop
        v_input := elos_import.map_get(p_company_id, null, 'product', it.p->>'productId');
        v_hit := false;
        for part in
          select poi.*, poi.ordered_quantity / nullif(sum(poi.ordered_quantity) over (), 0) share
          from procurement_purchase_order_items poi
          where poi.order_id = v_po.id and poi.input_id = v_input
        loop
          v_hit := true;
          select coalesce(sum(accepted_quantity), 0) into v_prev from procurement_material_receipt_items where order_item_id = part.id;
          v_qty := least(round((it.p->>'productAmount')::numeric * part.share, 6), part.ordered_quantity - v_prev);
          if v_qty <= 0 then continue; end if;
          v_sort := v_sort + 1;
          insert into procurement_material_receipt_items(company_id, project_id, receipt_id, order_id, order_item_id, input_id, cost_center_service_id,
            input_code, input_name, unit_snapshot, cost_center_code, cost_center_name, ordered_quantity, previously_accepted_quantity,
            delivered_quantity, accepted_quantity, rejected_quantity, unit_cost, sort_order)
          values (p_company_id, p_project_id, v_rec, v_po.id, part.id, part.input_id, part.cost_center_service_id,
            part.input_code, part.input_name, part.unit_snapshot, part.cost_center_code, part.cost_center_name, part.ordered_quantity, v_prev,
            v_qty, v_qty, 0, part.delivered_unit_cost, v_sort)
          on conflict (receipt_id, order_item_id) do update
            set delivered_quantity = procurement_material_receipt_items.delivered_quantity + excluded.delivered_quantity,
                accepted_quantity = procurement_material_receipt_items.accepted_quantity + excluded.accepted_quantity,
                updated_at = now();
          v_items := v_items + 1;
        end loop;
        if not v_hit then
          v_orphans := v_orphans + 1;
          perform elos_import.issue(v_run, p_company_id, p_project_id, 'stock_entry_item', it.p->>'productMovementId', 'item_sem_pedido_correspondente',
            jsonb_build_object('recebimento', 'REC-' || lpad(v_seq::text, 4, '0'), 'produto', it.p->>'productId', 'pedido', v_po.order_number));
        end if;
      end loop;
    end loop;
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('recebimentos', v_recs, 'itens', v_items, 'itens_sem_pedido', v_orphans) where id = v_run;
  return jsonb_build_object('recebimentos', v_recs, 'itens', v_items, 'itens_sem_pedido', v_orphans);
end;
$$;

revoke all on function elos_import.wave2c_receipts(uuid, uuid, uuid) from public, anon, authenticated;
