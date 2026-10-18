-- Importação limpa — Onda 2e: contas a pagar das NF-e de material do Flow
--
-- Origem: títulos a pagar da empresa Flow cuja origem é "Nota fiscal eletrônica".
-- * Cada título vira um título do Elos ligado à parcela da NF-e (onda 2d), no mesmo formato que a
--   aprovação de uma NF-e gera (origem xml, chave "nfe:<nota>:<parcela>").
-- * Pago na origem → pago no Elos, com data, valor pago e conta bancária (de-para da onda 1).
--   Títulos agrupados na origem são pagos pelo título que os agrupou; o título agrupador não entra,
--   para não contar o valor duas vezes.
-- * Rateio por centro de custo: segue os itens da NF-e (que seguem o pedido). Itens sem centro de custo
--   usam o rateio informado no título da origem, traduzido pelo de-para; se não houver, vão para SEM-CC.

create or replace function elos_import.parse_br_date(p text)
returns date language sql immutable as $$
  select case when p ~ '^\d{2}/\d{2}/\d{4}$' then to_date(p, 'DD/MM/YYYY')
              when p ~ '^\d{4}-\d{2}-\d{2}' then substr(p, 1, 10)::date end;
$$;

create or replace function elos_import.allocate_payable(p_run uuid, p_company_id uuid, p_project_id uuid, p_budget_id uuid,
  p_payable_id uuid, p_amount numeric, p_parts jsonb, p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public, elos_import
as $$
-- p_parts: [{service_id, code, name, weight, method}] — o valor do título é dividido pelos pesos.
declare
  x record; v_total numeric; v_left numeric := round(p_amount, 2); v_amt numeric; v_n int; v_i int := 0; v_bi uuid;
begin
  select sum((e->>'weight')::numeric), count(*) into v_total, v_n from jsonb_array_elements(p_parts) e where (e->>'weight')::numeric > 0;
  if coalesce(v_total, 0) <= 0 or p_amount <= 0 then return 0; end if;
  for x in
    select e->>'service_id' sid, e->>'code' code, e->>'name' nm, (e->>'weight')::numeric w, coalesce(e->>'method', 'origin_title_allocation') m
    from jsonb_array_elements(p_parts) e where (e->>'weight')::numeric > 0
    order by (e->>'weight')::numeric desc
  loop
    v_i := v_i + 1;
    v_amt := case when v_i = v_n then v_left else round(p_amount * x.w / v_total, 2) end;
    v_left := v_left - v_amt;
    if v_amt <= 0 then continue; end if;
    v_bi := null;
    if x.sid is not null then
      select id into v_bi from engineering_budget_items where budget_id = p_budget_id and service_id = x.sid::uuid and status = 'active' order by sort_order limit 1;
    end if;
    insert into payable_cost_allocations(company_id, project_id, payable_id, service_id, budget_item_id, wbs_code_snapshot, service_name_snapshot,
      allocation_amount, allocation_percent, resolution_method, source_system, source_id, evidence, created_by)
    values (p_company_id, p_project_id, p_payable_id, x.sid::uuid, v_bi, x.code, x.nm, v_amt,
      least(100, greatest(0.0001, round(100 * v_amt / p_amount, 4))), x.m, 'elos_import', p_payable_id::text || ':' || v_i, '{}'::jsonb, p_user_id);
  end loop;
  return v_i;
end;
$$;

create or replace function elos_import.koper_title_parts(p_project_id uuid, p_bill_id text)
returns jsonb
language sql
stable
set search_path = public
as $$
  -- Rateio que a origem informou para o título, traduzido para os serviços do orçamento do Elos.
  select coalesce(jsonb_agg(jsonb_build_object('service_id', s.id, 'code', s.code, 'name', s.description,
           'weight', (a->>'amount')::numeric, 'method', 'origin_title_allocation')), '[]'::jsonb)
  from koper_staging_records r, jsonb_array_elements(r.payload->'allocations') a
  join integration_mappings m on m.project_id = p_project_id and m.source_system = 'koper' and m.source_entity_type = 'cost_center'
       and m.status = 'confirmed' and m.metadata->>'koper_service_id' = a->>'serviceSourceId'
  join engineering_services s on s.id = m.target_entity_id
  where r.entity = 'bill_resolution' and r.payload->>'billId' = p_bill_id and coalesce((a->>'amount')::numeric, 0) > 0;
$$;

create or replace function elos_import.wave2e_nfe_payables(p_company_id uuid, p_project_id uuid, p_budget_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; j record; v_inv uuid; v_inst record; v_invrow record; v_pay uuid; v_supplier uuid; v_status text;
  v_paid_at date; v_paid numeric; v_bank uuid; v_bank_name text; v_parts jsonb; v_null_w numeric; v_title jsonb; v_cnt int;
  v_n int := 0; v_paid_n int := 0; v_value numeric := 0; v_noinv int := 0; v_semcc int := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '2e-titulos-nfe') returning id into v_run;

  for r in
    select payload->'data' d from koper_staging_records
    where entity = 'mirror.bill_to_pay_detail' and payload->>'_enterprise' = 'flow'
      and payload->'data'->'bill_origin'->>'origin_name' = 'Nota fiscal eletrônica'
      and payload->'data'->>'status' in ('Paga', 'Pendente', 'Em atraso', 'Agrupada')
    order by (payload->'data'->>'due_date')::timestamp, (payload->'data'->>'bill_id')::int
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id') is not null then continue; end if;

    v_inv := elos_import.map_get(p_company_id, p_project_id, 'xml_invoice', r.d->'origins'->>'invoice_id');
    v_inst := null; v_invrow := null;
    select * into v_invrow from finance_electronic_invoices where id = v_inv;
    select * into v_inst from finance_electronic_invoice_installments
     where id = elos_import.map_get(p_company_id, p_project_id, 'bill', r.d->>'bill_id');
    if v_inst.id is null and v_inv is not null then
      select * into v_inst from finance_electronic_invoice_installments i
       where i.invoice_id = v_inv and i.payable_id is null and abs(i.amount - (r.d->>'bill_value')::numeric) < 0.01
       order by i.sequence_no limit 1;
    end if;

    v_supplier := coalesce(v_invrow.supplier_id, elos_import.ensure_supplier(p_company_id, r.d->'beneficiary'->>'supplier_id',
      r.d->'beneficiary'->>'supplier_name', r.d->'beneficiary'->>'cnpj'));

    -- Pagamento (direto ou pelo título agrupador)
    v_status := 'open'; v_paid_at := null; v_paid := null; v_bank := null; v_bank_name := null;
    if r.d->>'status' = 'Paga' then
      v_status := 'paid';
      v_paid_at := elos_import.parse_br_date(coalesce(r.d->'payment'->>'paid_at', r.d->>'paid_at'));
      v_paid := coalesce(nullif(r.d->'payment'->>'value', '')::numeric, nullif(r.d->>'payment_value', '')::numeric, (r.d->>'bill_value')::numeric);
      v_bank := elos_import.map_get(p_company_id, null, 'account', 'flow:' || (r.d->>'account_id'));
      v_bank_name := r.d->>'bank_name';
    elsif r.d->>'status' = 'Agrupada' then
      select payload->'data' jd into j from koper_staging_records
       where entity = 'mirror.bill_to_pay_detail' and payload->>'_enterprise' = 'flow' and payload->'data'->>'bill_id' = r.d->>'join_bill_id';
      if j.jd->>'status' = 'Paga' then
        v_status := 'paid';
        v_paid_at := elos_import.parse_br_date(coalesce(j.jd->'payment'->>'paid_at', j.jd->>'paid_at'));
        v_paid := round((r.d->>'bill_value')::numeric * coalesce(nullif(j.jd->'payment'->>'value', '')::numeric, (j.jd->>'bill_value')::numeric)
                  / nullif((j.jd->>'bill_value')::numeric, 0), 2);
        v_bank := elos_import.map_get(p_company_id, null, 'account', 'flow:' || (j.jd->>'account_id'));
        v_bank_name := j.jd->>'bank_name';
      end if;
    end if;

    insert into payables(company_id, project_id, supplier_id, document, fiscal_class, payment_method, due_date, amount, status, installment_label, notes,
      paid_at, paid_amount, paid_account_name, bank_account_id, origin, source_system, source_id, beneficiary_name, beneficiary_tax_id, source_category,
      created_by, created_at, updated_at)
    values (p_company_id, p_project_id, v_supplier,
      case when v_invrow.id is not null then concat(v_invrow.invoice_number, '/', coalesce(v_invrow.series, '-')) else r.d->'origins'->>'invoice_number' end,
      'NF-e', null,
      (r.d->>'due_date')::timestamp::date, (r.d->>'bill_value')::numeric, v_status,
      case when v_inst.id is not null then concat(v_inst.sequence_no, ' / ', (select count(*) from finance_electronic_invoice_installments where invoice_id = v_inv))
           else concat(coalesce(r.d->>'duplicate_number', '1'), ' / ', coalesce(r.d->>'installment_amount', '1')) end,
      concat_ws(E'\n', case when v_invrow.id is not null then 'NF-e ' || v_invrow.access_key end,
        case when v_invrow.order_id is not null then 'Pedido vinculado' end, case when v_invrow.receipt_id is not null then 'Recebimento vinculado' end,
        nullif(btrim(coalesce(r.d->>'bill_comments', '')), '')),
      v_paid_at, v_paid, v_bank_name, v_bank, 'xml',
      case when v_inst.id is not null then 'elos_os' else 'elos_import' end,
      case when v_inst.id is not null then 'nfe:' || v_inv || ':' || v_inst.id else 'flow:bill:' || (r.d->>'bill_id') end,
      r.d->'beneficiary'->>'supplier_name', nullif(regexp_replace(coalesce(r.d->'beneficiary'->>'cnpj', r.d->'beneficiary'->>'cpf', ''), '[^0-9]', '', 'g'), ''),
      r.d->>'classification', p_user_id, coalesce(v_invrow.created_at, (r.d->>'due_date')::timestamp), now())
    returning id into v_pay;
    perform elos_import.map_put(p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id', 'payable', v_pay, 'imported');
    if v_inst.id is not null then
      update finance_electronic_invoice_installments set payable_id = v_pay, updated_at = now() where id = v_inst.id;
    else
      v_noinv := v_noinv + 1;
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id', 'titulo_sem_parcela_de_nfe',
        jsonb_build_object('fornecedor', r.d->>'supplier_name', 'valor', r.d->>'bill_value', 'nota', r.d->'origins'->>'invoice_number'));
    end if;
    v_n := v_n + 1; v_value := v_value + (r.d->>'bill_value')::numeric;
    if v_status = 'paid' then v_paid_n := v_paid_n + 1; end if;

    -- Rateio
    select coalesce(jsonb_agg(jsonb_build_object('service_id', g.sid, 'code', g.code, 'name', g.nm, 'weight', g.w,
             'method', case when g.has_order then 'origin_purchase_order' else 'origin_title_allocation' end)) filter (where g.sid is not null or g.code = 'VIAB'), '[]'::jsonb),
           coalesce(sum(g.w) filter (where g.sid is null and g.code is distinct from 'VIAB'), 0)
      into v_parts, v_null_w
    from (
      select ii.cost_center_service_id sid,
             coalesce(s.code, case when poi.cost_center_code = 'VIAB' then 'VIAB' end) code,
             coalesce(s.description, case when poi.cost_center_code = 'VIAB' then 'Custos de incorporação (viabilidade)' end) nm,
             sum(ii.total_amount) w, bool_or(ii.order_item_id is not null) has_order
      from finance_electronic_invoice_items ii
      left join engineering_services s on s.id = ii.cost_center_service_id
      left join procurement_purchase_order_items poi on poi.id = ii.order_item_id
      where ii.invoice_id = v_inv and ii.total_amount > 0
      group by 1, 2, 3
    ) g;
    if v_inv is null then v_null_w := 1; end if;
    if v_null_w > 0 then
      v_title := elos_import.koper_title_parts(p_project_id, r.d->>'bill_id');
      if jsonb_array_length(v_title) > 0 then
        -- O peso sem centro de custo é distribuído pelo rateio do título na origem.
        select v_parts || coalesce(jsonb_agg(jsonb_set(t, '{weight}', to_jsonb(v_null_w * (t->>'weight')::numeric / tot.s))), '[]'::jsonb) into v_parts
        from jsonb_array_elements(v_title) t, (select sum((x->>'weight')::numeric) s from jsonb_array_elements(v_title) x) tot;
      else
        v_parts := v_parts || jsonb_build_array(jsonb_build_object('service_id', null, 'code', 'SEM-CC', 'name', 'Sem centro de custo na origem', 'weight', v_null_w, 'method', 'import_other'));
        v_semcc := v_semcc + 1;
        perform elos_import.issue(v_run, p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id', 'titulo_com_parte_sem_centro_de_custo',
          jsonb_build_object('fornecedor', r.d->>'supplier_name', 'valor', r.d->>'bill_value', 'nota', r.d->'origins'->>'invoice_number'));
      end if;
    end if;
    v_cnt := elos_import.allocate_payable(v_run, p_company_id, p_project_id, p_budget_id, v_pay, (r.d->>'bill_value')::numeric, v_parts, p_user_id);
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('titulos', v_n, 'pagos', v_paid_n, 'valor', v_value, 'sem_parcela_nfe', v_noinv, 'com_sem_cc', v_semcc) where id = v_run;
  return jsonb_build_object('titulos', v_n, 'pagos', v_paid_n, 'valor', v_value, 'sem_parcela_nfe', v_noinv, 'com_sem_cc', v_semcc);
end;
$$;

revoke all on function elos_import.wave2e_nfe_payables(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function elos_import.allocate_payable(uuid, uuid, uuid, uuid, uuid, numeric, jsonb, uuid) from public, anon, authenticated;
revoke all on function elos_import.koper_title_parts(uuid, text) from public, anon, authenticated;
