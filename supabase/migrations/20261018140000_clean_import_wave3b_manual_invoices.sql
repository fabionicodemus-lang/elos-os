-- Importação limpa — Onda 3b: notas manuais (serviços, recibos e demais documentos) do Flow
--
-- Origem: notas manuais da obra Flow (recibos de serviço, NFS-e, recibos de produto, cupons e outros).
-- * Rascunhos e notas removidas não entram; notas sem geração de financeiro também não.
-- * Numeração no padrão Elos (NM-0001...) pela data de emissão.
-- * Cada linha da nota recebe o centro de custo (serviço do orçamento) por, nesta ordem:
--   1) a ordem de serviço da origem ligada à linha; 2) o serviço da origem pelo de-para;
--   3) para produtos, o pedido de compra ligado; 4) o rateio informado no título da origem.
--   Sem nenhum desses, a linha vai para o serviço "A classificar" (SEM-CC) e vira pendência.
-- * A nota é ligada ao contrato do mesmo fornecedor quando o serviço bate com um item do contrato
--   e, quando o valor bate com uma medição aprovada ainda sem nota, à medição.
-- * Valor bruto = soma das linhas; retenções vêm da nota; o líquido fecha com as parcelas (títulos).
--   Diferenças de frete/arredondamento entram como ajuste, registradas como pendência quando passam de R$ 0,05.

create or replace function elos_import.ensure_placeholder_service(p_company_id uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from engineering_services where company_id = p_company_id and code = p_code;
  if v_id is null then
    insert into engineering_services(company_id, code, description, unit, group_code, default_method, notes, status, source_system, source_id)
    values (p_company_id, p_code,
      case p_code when 'VIAB' then 'Custos de incorporação (viabilidade)' else 'A classificar (sem centro de custo na origem)' end,
      'vb', p_code, 'unit',
      case p_code when 'VIAB' then 'Custos do estudo de viabilidade, fora do orçamento de obra.'
           else 'Lançamentos históricos sem centro de custo. Reclassifique para o serviço correto do orçamento.' end,
      'active', 'elos_os', 'import-placeholder:' || p_code)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function elos_import.wave3b_manual_invoices(p_company_id uuid, p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; ln record; b record;
  v_entity uuid; v_seq int; v_inv uuid; v_supplier uuid; v_ct uuid; v_med uuid; v_semcc uuid; v_viab uuid;
  v_tv numeric; v_mult boolean; v_sv numeric; v_pv numeric; v_bills numeric; v_gross numeric; v_disc numeric; v_ret numeric; v_diff numeric;
  v_line int; v_sid uuid; v_title jsonb; v_w numeric; v_part record; v_amt numeric; v_left numeric; v_qty numeric; v_n int; v_i int;
  v_doc text; v_inss numeric; v_iss numeric; v_ir numeric; v_pis numeric; v_cof numeric; v_csll numeric; v_big uuid; v_dtype text;
  v_count int := 0; v_lines int := 0; v_semcc_lines int := 0; v_value numeric := 0; v_linked_ct int := 0; v_linked_med int := 0; v_adj int := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '3b-notas-manuais') returning id into v_run;
  select legal_entity_id into v_entity from projects where id = p_project_id;
  select coalesce(max(sequence_no), 0) into v_seq from finance_manual_invoices where project_id = p_project_id;
  v_semcc := elos_import.ensure_placeholder_service(p_company_id, 'SEM-CC');
  v_viab := elos_import.ensure_placeholder_service(p_company_id, 'VIAB');

  create temp table if not exists w3b_os on commit drop as
    select y->>'serviceOrderServiceId' sosid, coalesce(y->>'monItemReference', y->>'itemReference') ref
    from koper_staging_records o, jsonb_array_elements(o.payload->'data'->'services') y
    where o.entity = 'mirror.service_order_detail' and o.payload->>'_enterprise' = 'flow';
  create index on w3b_os(sosid);

  -- Linhas de trabalho por nota (marcadas por nota; linhas substituídas pelo rateio ficam marcadas como substituídas).
  create temp table if not exists w3b_lines(rid text, dropped boolean default false, line int, service_id uuid, code text, name text, description text, unit text, qty numeric, price numeric,
    gross numeric, method text) on commit drop;
  create index on w3b_lines(rid);

  for r in
    select payload->'data' d from koper_staging_records
    where entity = 'mirror.receipt' and payload->>'_enterprise' = 'flow'
      and not coalesce((payload->'data'->>'receiptDraft')::boolean, false)
      and not coalesce((payload->'data'->>'tmpRemoved')::boolean, false)
      and coalesce((payload->'data'->>'generateFinancial')::boolean, true)
      and jsonb_array_length(coalesce(payload->'data'->'bills', '[]')) > 0
    order by (payload->'data'->>'receiptEmitDate')::timestamp, (payload->'data'->>'receiptId')::int
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'receipt', r.d->>'receiptId') is not null then continue; end if;
    v_supplier := elos_import.ensure_supplier(p_company_id, r.d->>'supplierId', r.d->>'supplierName', null);
    v_tv := coalesce((r.d->>'totalValue')::numeric, 0);
    select coalesce(sum((b2->>'billValue')::numeric), 0) into v_bills from jsonb_array_elements(r.d->'bills') b2;
    select coalesce(sum((p->>'price')::numeric * (p->>'productAmount')::numeric), 0) into v_pv from jsonb_array_elements(coalesce(r.d->'products', '[]')) p;
    select coalesce(sum((x->>'serviceValue')::numeric), 0) into v_sv from jsonb_array_elements(coalesce(r.d->'services', '[]')) x;
    -- A origem às vezes grava o valor unitário, às vezes o total da linha: usa o que fecha com o total da nota.
    v_mult := abs((select coalesce(sum((x->>'serviceValue')::numeric * coalesce(nullif((x->>'serviceAmount')::numeric, 0), 1)), 0)
                   from jsonb_array_elements(coalesce(r.d->'services', '[]')) x) + v_pv - v_tv) < 0.05;
    v_line := 0;

    -- Serviços
    for ln in
      select x, nullif((x->>'serviceAmount')::numeric, 0) amt,
        (select mp.target_entity_id from w3b_os y
           join integration_mappings mp on mp.project_id = p_project_id and mp.source_system = 'koper' and mp.source_entity_type = 'cost_center'
             and mp.key_kind = 'code' and mp.external_code = y.ref and mp.status = 'confirmed'
          where y.sosid = x->>'purchaseServiceId' limit 1) by_os,
        (select bool_or(y.ref like '29.%') from w3b_os y where y.sosid = x->>'purchaseServiceId') os_viab,
        (select mp.target_entity_id from integration_mappings mp where mp.project_id = p_project_id and mp.source_system = 'koper' and mp.source_entity_type = 'cost_center'
            and mp.status = 'confirmed' and mp.metadata->>'koper_service_id' = x->>'serviceId' order by mp.external_code limit 1) by_svc
      from jsonb_array_elements(coalesce(r.d->'services', '[]')) x
      where coalesce((x->>'serviceValue')::numeric, 0) > 0
    loop
      v_line := v_line + 1;
      v_qty := coalesce(ln.amt, 1);
      v_amt := case when v_mult then round((ln.x->>'serviceValue')::numeric * v_qty, 2) else round((ln.x->>'serviceValue')::numeric, 2) end;
      v_sid := coalesce(ln.by_os, case when ln.os_viab then v_viab end, ln.by_svc);
      insert into w3b_lines values (r.d->>'receiptId', false, v_line, v_sid, null, null, coalesce(ln.x->>'serviceName', 'Serviço'), 'vb', v_qty, round(v_amt / v_qty, 6), v_amt,
        case when ln.by_os is not null then 'os' when ln.os_viab then 'viab' when ln.by_svc is not null then 'servico' end);
    end loop;

    -- Produtos
    for ln in
      select p, (p->>'productAmount')::numeric amt, (p->>'price')::numeric price,
        (select poi.cost_center_service_id from jsonb_array_elements(coalesce(p->'orders', '[]')) o
           join procurement_purchase_order_items poi on poi.order_id = elos_import.map_get(p_company_id, p_project_id, 'purchase_order', o->>'orderId')
             and poi.input_id = elos_import.map_get(p_company_id, null, 'product', p->>'productId')
          where poi.cost_center_service_id is not null order by poi.ordered_quantity desc limit 1) by_po
      from jsonb_array_elements(coalesce(r.d->'products', '[]')) p
      where coalesce((p->>'productAmount')::numeric, 0) > 0 and coalesce((p->>'price')::numeric, 0) > 0
    loop
      v_line := v_line + 1;
      insert into w3b_lines values (r.d->>'receiptId', false, v_line, ln.by_po, null, null, coalesce(ln.p->>'productFullName', ln.p->>'productName', 'Produto'), coalesce(ln.p->>'symbol', 'un'),
        ln.amt, ln.price, round(ln.amt * ln.price, 2), case when ln.by_po is not null then 'pedido' end);
    end loop;

    if v_line = 0 then
      v_line := 1;
      insert into w3b_lines values (r.d->>'receiptId', false, 1, null, null, null, coalesce(nullif(r.d->>'itemChartName', ''), 'Documento sem itens na origem'), 'vb', 1, v_tv, v_tv, null);
    end if;

    -- Linhas ainda sem centro de custo: rateio do título na origem, se houver.
    if exists (select 1 from w3b_lines where rid = r.d->>'receiptId' and not dropped and service_id is null) then
      select coalesce(jsonb_agg(t), '[]'::jsonb) into v_title
      from jsonb_array_elements(r.d->'bills') b2, jsonb_array_elements(elos_import.koper_title_parts(p_project_id, b2->>'billId')) t;
      if jsonb_array_length(v_title) > 0 then
        for ln in select * from w3b_lines where rid = r.d->>'receiptId' and not dropped and service_id is null loop
          update w3b_lines set dropped = true where rid = r.d->>'receiptId' and line = ln.line;
          select sum((t->>'weight')::numeric), count(*) into v_w, v_n from jsonb_array_elements(v_title) t;
          v_left := ln.gross; v_i := 0;
          for v_part in select (t->>'service_id')::uuid sid, (t->>'weight')::numeric w from jsonb_array_elements(v_title) t order by (t->>'weight')::numeric desc loop
            v_i := v_i + 1;
            v_amt := case when v_i = v_n then v_left else round(ln.gross * v_part.w / v_w, 2) end;
            v_left := v_left - v_amt;
            if v_amt <= 0 then continue; end if;
            insert into w3b_lines values (r.d->>'receiptId', false, ln.line * 100 + v_i, v_part.sid, null, null, ln.description, 'vb', 1, v_amt, v_amt, 'titulo');
          end loop;
        end loop;
      end if;
    end if;
    update w3b_lines set service_id = v_semcc, method = 'sem_cc' where rid = r.d->>'receiptId' and not dropped and service_id is null;
    update w3b_lines l set code = s.code, name = s.description from engineering_services s where s.id = l.service_id and l.rid = r.d->>'receiptId' and not l.dropped;

    -- Fechamento: bruto, desconto, retenções e líquido = parcelas
    select coalesce(sum(gross), 0) into v_gross from w3b_lines where rid = r.d->>'receiptId' and not dropped;
    v_disc := least(greatest(coalesce((r.d->>'discountValue')::numeric, 0), 0), v_gross);
    v_inss := greatest(coalesce((r.d->>'inssValue')::numeric, 0), 0);
    v_iss := greatest(coalesce((r.d->>'issRetained')::numeric, 0), 0);
    v_ir := greatest(coalesce((r.d->>'irValue')::numeric, 0), 0);
    v_pis := greatest(coalesce((r.d->>'pisValue')::numeric, 0), 0);
    v_cof := greatest(coalesce((r.d->>'cofinsValue')::numeric, 0), 0);
    v_csll := greatest(coalesce((r.d->>'csllValue')::numeric, 0), 0);
    v_ret := v_inss + v_iss + v_ir + v_pis + v_cof + v_csll;
    v_diff := round(v_bills - (v_gross - v_disc - v_ret), 2);
    if v_diff > 0 then
      -- O título é maior que o documento (frete, acréscimo ou arredondamento): soma na maior linha.
      update w3b_lines set gross = gross + v_diff, price = round((gross + v_diff) / qty, 6)
       where rid = r.d->>'receiptId' and not dropped
         and line = (select line from w3b_lines where rid = r.d->>'receiptId' and not dropped order by gross desc limit 1);
      v_gross := v_gross + v_diff;
    end if;
    if abs(v_diff) > 0.05 then
      v_adj := v_adj + 1;
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'receipt', r.d->>'receiptId', 'nota_manual_ajustada_ao_titulo',
        jsonb_build_object('numero', r.d->>'receiptNumber', 'fornecedor', r.d->>'supplierName', 'total_nota', v_tv, 'total_titulos', v_bills, 'ajuste', v_diff));
    end if;

    -- Contrato e medição
    v_ct := null; v_med := null;
    select ct.id into v_ct from execution_service_contracts ct
     where ct.project_id = p_project_id and ct.supplier_id = v_supplier
     order by (exists (select 1 from execution_service_contract_items ci join w3b_lines l on l.service_id = ci.service_id and l.rid = r.d->>'receiptId' and not l.dropped where ci.contract_id = ct.id)) desc,
              ct.start_date desc
     limit 1;
    if v_ct is not null and not exists (select 1 from execution_service_contract_items ci join w3b_lines l on l.service_id = ci.service_id and l.rid = r.d->>'receiptId' and not l.dropped where ci.contract_id = v_ct)
       and (select count(*) from execution_service_contracts where project_id = p_project_id and supplier_id = v_supplier) > 1 then
      v_ct := null;
    end if;
    if v_ct is not null and jsonb_array_length(r.d->'bills') = 1 then
      select m.id into v_med from execution_contract_measurements m
       where m.contract_id = v_ct and m.status = 'approved' and m.payable_id is null
         and not exists (select 1 from finance_manual_invoices fi where fi.measurement_id = m.id)
         and (abs(m.gross_amount - v_gross) < 1 or abs(m.gross_amount - v_tv) < 1)
       order by abs(m.period_end - (r.d->>'receiptEmitDate')::timestamp::date) limit 1;
    end if;

    v_seq := v_seq + 1;
    v_doc := coalesce(nullif(btrim(r.d->>'receiptNumber'), ''), 'S/N');
    v_dtype := case r.d->>'recTypeName' when 'Nota fiscal de prestação de serviço' then 'service_invoice'
           when 'Recibo de serviços' then 'receipt' when 'Recibo de produtos' then 'receipt'
           else case when r.d->>'itemChartName' ilike 'frete%' then 'transport' when r.d->>'itemChartName' ilike '%aluguel%' then 'rent' else 'other' end end;
    -- Número repetido para o mesmo fornecedor (comum em recibos "S/N"): identifica pela data e, se preciso, pelo registro.
    if exists (select 1 from finance_manual_invoices where project_id = p_project_id and supplier_id = v_supplier and document_type = v_dtype
               and lower(document_number) = lower(v_doc) and coalesce(series, '') = '') then
      v_doc := v_doc || ' · ' || to_char((r.d->>'receiptEmitDate')::timestamp, 'DD/MM/YYYY');
      if exists (select 1 from finance_manual_invoices where project_id = p_project_id and supplier_id = v_supplier and document_type = v_dtype
                 and lower(document_number) = lower(v_doc) and coalesce(series, '') = '') then
        v_doc := v_doc || ' · NM-' || lpad(v_seq::text, 4, '0');
      end if;
    end if;
    insert into finance_manual_invoices(company_id, project_id, legal_entity_id, supplier_id, contract_id, measurement_id, sequence_no, registry_number, status,
      document_type, document_number, issue_date, competence_date, inss_amount, iss_amount, irrf_amount, pis_amount, cofins_amount, csll_amount,
      other_retention_amount, notes, created_by, updated_by, submitted_by, submitted_at, approved_by, approved_at, approval_notes, posted_by, posted_at,
      created_at, updated_at)
    values (p_company_id, p_project_id, v_entity, v_supplier, v_ct, v_med, v_seq, 'NM-' || lpad(v_seq::text, 4, '0'), 'approved', v_dtype, v_doc, (r.d->>'receiptEmitDate')::timestamp::date, nullif(r.d->>'registerDate', '')::timestamptz::date,
      v_inss, v_iss, v_ir, v_pis, v_cof, v_csll, greatest(-v_diff, 0),
      concat_ws(E'\n', nullif(btrim(coalesce(r.d->>'receiptComments', '')), ''), nullif(r.d->>'itemChartName', ''),
        case when jsonb_array_length(coalesce(r.d->'servicesOrders', '[]')) > 0 then 'Ordem de serviço de origem: ' ||
          (select string_agg(o->>'serviceOrderId', ', ') from jsonb_array_elements(r.d->'servicesOrders') o) end),
      p_user_id, p_user_id, p_user_id, nullif(r.d->>'registerDate', '')::timestamptz, p_user_id, nullif(r.d->>'registerDate', '')::timestamptz,
      'Documento histórico trazido na importação do Flow.', p_user_id, nullif(r.d->>'registerDate', '')::timestamptz,
      coalesce(nullif(r.d->>'registerDate', '')::timestamptz, (r.d->>'receiptEmitDate')::timestamp), now())
    returning id into v_inv;
    perform elos_import.map_put(p_company_id, p_project_id, 'receipt', r.d->>'receiptId', 'finance_manual_invoice', v_inv, 'imported', 'NM-' || lpad(v_seq::text, 4, '0'));
    if v_ct is not null then v_linked_ct := v_linked_ct + 1; end if;
    if v_med is not null then v_linked_med := v_linked_med + 1; end if;

    insert into finance_manual_invoice_items(company_id, project_id, invoice_id, service_id, line_number, service_code, service_name, description, unit_snapshot,
      quantity, unit_price, gross_amount, discount_amount, total_amount, notes)
    select p_company_id, p_project_id, v_inv, l.service_id, row_number() over (order by l.line), l.code, l.name, l.description, l.unit,
      l.qty, l.price, l.gross, 0, l.gross,
      case l.method when 'os' then 'Centro de custo pela ordem de serviço de origem.' when 'pedido' then 'Centro de custo pelo pedido de compra.'
        when 'titulo' then 'Centro de custo pelo rateio do título de origem.' when 'viab' then 'Custos de incorporação (viabilidade).'
        when 'sem_cc' then 'Sem centro de custo na origem: reclassificar.' end
    from w3b_lines l where l.rid = r.d->>'receiptId' and not l.dropped;
    if v_disc > 0 then
      select id into v_big from finance_manual_invoice_items where invoice_id = v_inv order by gross_amount desc limit 1;
      update finance_manual_invoice_items set discount_amount = least(v_disc, gross_amount), total_amount = gross_amount - least(v_disc, gross_amount) where id = v_big;
    end if;
    select count(*) into v_n from w3b_lines where rid = r.d->>'receiptId' and not dropped;
    v_lines := v_lines + v_n;
    select count(*) into v_n from w3b_lines where rid = r.d->>'receiptId' and not dropped and method = 'sem_cc';
    if v_n > 0 then
      v_semcc_lines := v_semcc_lines + v_n;
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'receipt', r.d->>'receiptId', 'nota_manual_sem_centro_de_custo',
        jsonb_build_object('nota', 'NM-' || lpad(v_seq::text, 4, '0'), 'numero', v_doc, 'fornecedor', r.d->>'supplierName',
          'valor', (select sum(gross) from w3b_lines where rid = r.d->>'receiptId' and not dropped and method = 'sem_cc')));
    end if;

    insert into finance_manual_invoice_installments(company_id, project_id, invoice_id, sequence_no, installment_label, due_date, amount)
    select p_company_id, p_project_id, v_inv, q.rn, q.rn::text, (q.b2->>'dueDate')::timestamp::date, (q.b2->>'billValue')::numeric
    from (select b2, (row_number() over (order by b2->>'dueDate', (b2->>'billId')::int))::int rn from jsonb_array_elements(r.d->'bills') b2
          where coalesce((b2->>'billValue')::numeric, 0) > 0) q;
    for b in
      select i.id, q.b2->>'billId' bill_id
      from (select b2, (row_number() over (order by b2->>'dueDate', (b2->>'billId')::int))::int rn from jsonb_array_elements(r.d->'bills') b2
            where coalesce((b2->>'billValue')::numeric, 0) > 0) q
      join finance_manual_invoice_installments i on i.invoice_id = v_inv and i.sequence_no = q.rn
    loop
      perform elos_import.map_put(p_company_id, p_project_id, 'bill', b.bill_id, 'finance_manual_invoice_installment', b.id, 'imported');
    end loop;
    perform refresh_finance_manual_invoice(v_inv);

    if v_med is not null then
      update execution_contract_measurements set status = 'invoiced', invoice_number = v_doc, invoice_date = (r.d->>'receiptEmitDate')::timestamp::date,
        invoice_gross_amount = v_gross, sent_to_finance_at = nullif(r.d->>'registerDate', '')::timestamptz, updated_at = now()
      where id = v_med;
    end if;
    v_count := v_count + 1; v_value := v_value + v_bills;
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('notas', v_count, 'linhas', v_lines, 'valor_liquido', v_value, 'linhas_sem_cc', v_semcc_lines,
      'com_contrato', v_linked_ct, 'com_medicao', v_linked_med, 'ajustadas', v_adj) where id = v_run;
  return jsonb_build_object('notas', v_count, 'linhas', v_lines, 'valor_liquido', v_value, 'linhas_sem_cc', v_semcc_lines,
      'com_contrato', v_linked_ct, 'com_medicao', v_linked_med, 'ajustadas', v_adj);
end;
$$;

revoke all on function elos_import.wave3b_manual_invoices(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function elos_import.ensure_placeholder_service(uuid, text) from public, anon, authenticated;
