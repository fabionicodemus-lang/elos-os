-- Importação limpa — Onda 4: demais contas a pagar do Flow
--
-- Origem: títulos a pagar da empresa Flow que não vêm de NF-e (essas entraram na onda 2e):
-- notas manuais, medições, contas avulsas, tributos, créditos, vendas e comissões.
-- * Título de nota manual ligado à parcela da nota (onda 3b) vira o título que a nota geraria
--   (origem manual_invoice, chave "manual_invoice:<nota>:<parcela>"), com o rateio dos itens da nota.
-- * Título de medição é ligado à medição do contrato do mesmo fornecedor quando o valor bate.
-- * Demais títulos usam o rateio informado na origem (traduzido pelo de-para); sem rateio, ficam em
--   SEM-CC com a classificação da origem no nome, para reclassificação.
-- * Títulos agrupadores ("-") não entram: os títulos agrupados já carregam o valor e o pagamento.
-- * Pagos na origem entram pagos (data, valor e conta bancária).

create or replace function elos_import.wave4_other_payables(p_company_id uuid, p_project_id uuid, p_budget_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; j record; v_inst record; v_mi record; v_pay uuid; v_supplier uuid; v_status text; v_origin text;
  v_paid_at date; v_paid numeric; v_bank uuid; v_bank_name text; v_parts jsonb; v_title jsonb; v_cnt int; v_med uuid; v_mi_id uuid;
  v_src_sys text; v_src_id text; v_doc text; v_class text; v_benef text; v_tax text;
  v_n int := 0; v_paid_n int := 0; v_value numeric := 0; v_semcc int := 0; v_by_mi int := 0; v_by_med int := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '4-demais-titulos') returning id into v_run;

  for r in
    select payload->'data' d from koper_staging_records
    where entity = 'mirror.bill_to_pay_detail' and payload->>'_enterprise' = 'flow'
      and payload->'data'->'bill_origin'->>'origin_name' not in ('Nota fiscal eletrônica', '-')
      and payload->'data'->>'status' in ('Paga', 'Pendente', 'Em atraso', 'Agrupada')
    order by (payload->'data'->>'due_date')::timestamp, (payload->'data'->>'bill_id')::int
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id') is not null then continue; end if;
    v_origin := r.d->'bill_origin'->>'origin_name';
    v_class := nullif(r.d->>'classification', '');

    -- Documento de origem no Elos: parcela da nota manual (pelo título) ou a própria nota (pela nota da origem)
    v_inst := null; v_mi := null; v_mi_id := null; v_med := null;
    select * into v_inst from finance_manual_invoice_installments
     where id = elos_import.map_get(p_company_id, p_project_id, 'bill', r.d->>'bill_id') and payable_id is null;
    v_mi_id := coalesce(v_inst.invoice_id, elos_import.map_get(p_company_id, p_project_id, 'receipt', r.d->'origins'->>'receipt_id'));
    select * into v_mi from finance_manual_invoices where id = v_mi_id;

    -- Beneficiário
    v_supplier := null;
    if v_mi.id is not null then
      v_supplier := v_mi.supplier_id;
    elsif r.d->'beneficiary'->>'supplier_id' is not null then
      v_supplier := elos_import.ensure_supplier(p_company_id, r.d->'beneficiary'->>'supplier_id', r.d->'beneficiary'->>'supplier_name', r.d->'beneficiary'->>'cnpj');
    end if;
    v_tax := r.d->'origins'->>'tax_name';
    v_benef := coalesce(r.d->'beneficiary'->>'supplier_name', r.d->'beneficiary'->>'customer_name', r.d->'beneficiary'->>'employee_name',
      r.d->'beneficiary'->>'commission_name', v_tax, v_class, v_origin);

    -- Medição: contrato do mesmo fornecedor com medição aprovada de mesmo valor
    if v_origin = 'Medições' and v_supplier is not null then
      select m.id into v_med from execution_contract_measurements m join execution_service_contracts c on c.id = m.contract_id
       where c.project_id = p_project_id and c.supplier_id = v_supplier and m.status = 'approved' and m.payable_id is null
         and not exists (select 1 from finance_manual_invoices fi where fi.measurement_id = m.id)
         and abs(m.net_amount - (r.d->>'bill_value')::numeric) < 1
       order by abs(m.period_end - (r.d->>'due_date')::timestamp::date) limit 1;
    end if;

    -- Pagamento
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

    if v_inst.id is not null then
      v_src_sys := 'elos_os'; v_src_id := 'manual_invoice:' || v_mi.id || ':' || v_inst.id;
    elsif v_med is not null then
      v_src_sys := 'elos_os'; v_src_id := 'measurement:' || v_med;
    else
      v_src_sys := 'elos_import'; v_src_id := 'flow:bill:' || (r.d->>'bill_id');
    end if;
    v_doc := coalesce(
      case when v_mi.id is not null then concat(v_mi.document_number, case when v_mi.series is not null then '/' || v_mi.series end) end,
      nullif(r.d->'origins'->>'receipt_number', ''), nullif(r.d->'origins'->>'invoice_number', ''),
      nullif(r.d->>'bill_receipt_number', ''), v_tax, v_origin || ' ' || (r.d->>'bill_id'));

    insert into payables(company_id, project_id, supplier_id, document, fiscal_class, payment_method, due_date, amount, status, installment_label, notes,
      paid_at, paid_amount, paid_account_name, bank_account_id, origin, source_system, source_id, beneficiary_name, beneficiary_tax_id, source_category,
      created_by, created_at, updated_at)
    values (p_company_id, p_project_id, v_supplier, v_doc,
      case when v_mi.id is not null then v_mi.document_type
           else case v_origin when 'Tributos' then 'tax_document' when 'Medições' then 'measurement' when 'Conta a pagar' then 'other'
                  when 'Comissão' then 'commission' when 'Venda' then 'sale' when 'Crédito' then 'credit' else 'other' end end,
      null, (r.d->>'due_date')::timestamp::date, (r.d->>'bill_value')::numeric, v_status,
      case when v_inst.id is not null then concat(v_inst.sequence_no, ' / ', (select count(*) from finance_manual_invoice_installments where invoice_id = v_mi.id))
           else concat(coalesce(r.d->>'duplicate_number', '1'), ' / ', coalesce(r.d->>'installment_amount', '1')) end,
      concat_ws(E'\n', case when v_mi.id is not null then v_mi.registry_number end,
        case when v_med is not null then 'Medição vinculada' end, v_class, nullif(btrim(coalesce(r.d->>'bill_comments', '')), '')),
      v_paid_at, v_paid, v_bank_name, v_bank,
      case when v_inst.id is not null then 'manual_invoice' when v_med is not null then 'measurement' else 'historical_import' end,
      v_src_sys, v_src_id, v_benef,
      nullif(regexp_replace(coalesce(r.d->'beneficiary'->>'cnpj', r.d->'beneficiary'->>'cpf', ''), '[^0-9]', '', 'g'), ''),
      coalesce(v_class, v_origin), p_user_id, coalesce(v_mi.created_at, (r.d->>'due_date')::timestamp), now())
    returning id into v_pay;
    perform elos_import.map_put(p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id', 'payable', v_pay, 'imported');
    if v_inst.id is not null then
      update finance_manual_invoice_installments set payable_id = v_pay, updated_at = now() where id = v_inst.id;
      v_by_mi := v_by_mi + 1;
    elsif v_mi.id is not null then
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id', 'titulo_extra_da_nota_manual',
        jsonb_build_object('nota', v_mi.registry_number, 'valor', r.d->>'bill_value'));
    end if;
    if v_med is not null then
      update execution_contract_measurements set status = case when v_status = 'paid' then 'paid' else 'invoiced' end, payable_id = v_pay,
        paid_amount = v_paid, paid_at = v_paid_at, sent_to_finance_at = coalesce(sent_to_finance_at, (r.d->>'due_date')::timestamp), updated_at = now()
      where id = v_med;
      v_by_med := v_by_med + 1;
    end if;
    v_n := v_n + 1; v_value := v_value + (r.d->>'bill_value')::numeric;
    if v_status = 'paid' then v_paid_n := v_paid_n + 1; end if;

    -- Rateio
    if v_mi.id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('service_id', case when s.code in ('SEM-CC', 'VIAB') then null else s.id end, 'code', s.code, 'name', s.description,
               'weight', g.w, 'method', case when s.code = 'SEM-CC' then 'import_other' when v_mi.contract_id is not null then 'origin_service_contract' else 'origin_title_allocation' end)), '[]'::jsonb)
        into v_parts
      from (select service_id, sum(total_amount) w from finance_manual_invoice_items where invoice_id = v_mi.id group by 1) g
      join engineering_services s on s.id = g.service_id;
    elsif v_med is not null then
      select coalesce(jsonb_agg(jsonb_build_object('service_id', g.service_id, 'code', g.service_code, 'name', g.service_name, 'weight', g.w, 'method', 'origin_measurement')), '[]'::jsonb)
        into v_parts
      from (select service_id, service_code, service_name, sum(current_amount) w from execution_contract_measurement_items where measurement_id = v_med group by 1, 2, 3) g;
    else
      v_parts := elos_import.koper_title_parts(p_project_id, r.d->>'bill_id');
    end if;
    if jsonb_array_length(v_parts) = 0 then
      v_parts := jsonb_build_array(jsonb_build_object('service_id', null, 'code', 'SEM-CC',
        'name', left('Sem centro de custo na origem' || coalesce(' — ' || coalesce(v_class, v_tax, v_origin), ''), 200), 'weight', 1, 'method', 'import_other'));
      v_semcc := v_semcc + 1;
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'bill_to_pay', r.d->>'bill_id', 'titulo_sem_centro_de_custo',
        jsonb_build_object('origem', v_origin, 'classificacao', v_class, 'beneficiario', v_benef, 'valor', r.d->>'bill_value'));
    end if;
    v_cnt := elos_import.allocate_payable(v_run, p_company_id, p_project_id, p_budget_id, v_pay, (r.d->>'bill_value')::numeric, v_parts, p_user_id);
  end loop;

  for v_med in select distinct contract_id from execution_contract_measurements where project_id = p_project_id loop
    perform refresh_execution_service_contract_measurements(v_med);
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('titulos', v_n, 'pagos', v_paid_n, 'valor', v_value, 'de_nota_manual', v_by_mi, 'de_medicao', v_by_med, 'sem_cc', v_semcc) where id = v_run;
  return jsonb_build_object('titulos', v_n, 'pagos', v_paid_n, 'valor', v_value, 'de_nota_manual', v_by_mi, 'de_medicao', v_by_med, 'sem_cc', v_semcc);
end;
$$;

revoke all on function elos_import.wave4_other_payables(uuid, uuid, uuid, uuid) from public, anon, authenticated;
