-- Importação limpa — Onda 5: unidades, vendas e contas a receber do Flow
--
-- * A origem financeira (títulos a receber) não traz unidade nem contrato de venda. Por isso a base
--   comercial (unidades, clientes e vendas ativas) vem da carga comercial anterior, conferida, e é
--   copiada para a Flow Aptos com numeração Elos (VD-0001...) e sem referências ao sistema de origem.
--   Vendas canceladas entram como distrato (status cancelado), com as parcelas que o cliente pagou.
-- * As parcelas vêm dos títulos a receber da empresa Flow na origem (fonte do dinheiro recebido):
--   - títulos "desdobrados" (o original que foi quebrado em outros) não entram: os pedaços carregam o valor;
--   - cada parcela é ligada à venda do cliente (cada cliente tem uma venda ativa no Flow);
--   - valor base = valor original; parcelas pagas ficam travadas com o valor efetivamente recebido;
--   - parcelas abertas com plano "+ CUB" usam o índice CUB-SC e o Elos recalcula a correção sozinho;
--   - a categoria (entrada, mensal, reforço, chaves, pós-chaves) vem da carga anterior quando a parcela
--     casa por venda + vencimento + valor; senão é deduzida do plano.
-- * Recebimentos: data, valor, juros/multa/desconto e conta (de-para de contas da onda 1).

create or replace function elos_import.wave5_commercial(p_company_id uuid, p_project_id uuid, p_from_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; u record; s record; r record; v_unit uuid; v_sale uuid; v_seq int := 0; v_cub uuid; v_client uuid;
  v_cat text; v_status text; v_paid numeric; v_base numeric; v_n_units int := 0; v_n_sales int := 0; v_n int := 0; v_nosale int := 0;
  v_value numeric := 0; v_paid_total numeric := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '5-comercial') returning id into v_run;
  select id into v_cub from correction_indices where company_id = p_company_id and code = 'CUB-SC';

  -- Unidades
  for u in select * from units where project_id = p_from_project_id order by code loop
    if elos_import.map_get(p_company_id, p_project_id, 'unit', u.code) is not null then continue; end if;
    insert into units(company_id, project_id, code, tower, floor, type, private_area, total_area, bedrooms, suites, parking_spaces, list_price, status,
      registry, notes, source_system, source_id, created_by, floor_location_id, position, common_area, uncovered_private_area, fractional_share, parking_description)
    values (p_company_id, p_project_id, u.code, u.tower, u.floor, u.type, nullif(u.private_area, 0), nullif(u.total_area, 0), u.bedrooms, u.suites, u.parking_spaces,
      u.list_price, u.status, u.registry, u.notes, 'elos_import', 'flow:unit:' || u.code, p_user_id, null, u.position, u.common_area,
      u.uncovered_private_area, u.fractional_share, u.parking_description)
    returning id into v_unit;
    perform elos_import.map_put(p_company_id, p_project_id, 'unit', u.code, 'unit', v_unit, 'imported', u.code);
    v_n_units := v_n_units + 1;
  end loop;

  -- Vendas ativas
  for s in
    select sa.*, un.code unit_code from sales sa join units un on un.id = sa.unit_id
    where sa.project_id = p_from_project_id and sa.status in ('active', 'cancelled') order by (sa.status = 'cancelled'), sa.sale_date, sa.number
  loop
    v_seq := v_seq + 1;
    if elos_import.map_get(p_company_id, p_project_id, 'sale', s.id::text) is not null then continue; end if;
    insert into sales(company_id, project_id, unit_id, client_id, number, sale_date, total_amount, commission_pct, commission_amount, broker_name, broker_id,
      status, payment_plan_available, notes, source_system, source_id, created_by, correction_start_month)
    values (p_company_id, p_project_id, elos_import.map_get(p_company_id, p_project_id, 'unit', s.unit_code), s.client_id, 'VD-' || lpad(v_seq::text, 4, '0'),
      s.sale_date, s.total_amount, case when s.status = 'active' then s.commission_pct else 0 end, s.commission_amount,
      case when s.status = 'active' then s.broker_name end, case when s.status = 'active' then s.broker_id end, s.status, s.payment_plan_available,
      case when s.status = 'cancelled' then 'Distrato. Venda cancelada; os valores recebidos do cliente estão nas parcelas pagas desta venda.'
           else nullif(btrim(coalesce(s.notes, '')), '') end, 'elos_import', 'flow:sale:' || s.id, p_user_id, s.correction_start_month)
    returning id into v_sale;
    perform elos_import.map_put(p_company_id, p_project_id, 'sale', s.id::text, 'sale', v_sale, 'imported', 'VD-' || lpad(v_seq::text, 4, '0'));
    v_n_sales := v_n_sales + 1;
  end loop;

  -- Parcelas
  for r in
    select m.payload->'data' d,
      (select sn.id from sales sn join clients c on c.id = sn.client_id
        where sn.project_id = p_project_id
          and lower(regexp_replace(c.name, '\s+', ' ', 'g')) = lower(regexp_replace(m.payload->'data'->>'customerName', '\s+', ' ', 'g'))
        order by (sn.status = 'active') desc limit 1) sale_id
    from koper_staging_records m
    where m.entity = 'mirror.bill_to_receive' and m.payload->>'_enterprise' = 'flow'
      and not coalesce((m.payload->'data'->>'splitted')::boolean, false)
    order by m.payload->'data'->>'customerName', (m.payload->'data'->>'dueDate')::timestamp, (m.payload->'data'->>'billReceiveId')::int
  loop
    if elos_import.map_get(p_company_id, p_project_id, 'bill_to_receive', r.d->>'billReceiveId') is not null then continue; end if;
    if r.sale_id is null then
      v_nosale := v_nosale + 1;
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'bill_to_receive', r.d->>'billReceiveId', 'parcela_sem_venda',
        jsonb_build_object('cliente', r.d->>'customerName', 'vencimento', r.d->>'dueDate', 'valor', r.d->>'originalValue', 'pago', r.d->>'paymentValue'));
      continue;
    end if;
    select * into s from sales where id = r.sale_id;
    v_base := round(coalesce((r.d->>'originalValue')::numeric, 0), 2);
    v_status := case when nullif(r.d->>'paymentDate', '') is not null then 'paid' else 'open' end;
    v_paid := case when v_status = 'paid' then round(coalesce((r.d->>'paymentValue')::numeric, v_base), 2) end;

    -- Categoria: da carga anterior, se a parcela casa; senão pelo plano.
    v_cat := null;
    select o.category into v_cat
    from receivables o join sales os on os.id = o.sale_id
    where o.project_id = p_from_project_id and os.client_id = s.client_id
      and o.due_date = nullif(r.d->>'dueDate','')::timestamp::date and abs(o.amount - v_base) < 1
    limit 1;
    v_cat := coalesce(v_cat,
      case when coalesce((r.d->>'installmentAmount')::int, 1) = 1
                and coalesce(nullif(r.d->>'dueDate','')::timestamp::date, s.sale_date) <= s.sale_date + 60 then 'entry'
           when coalesce((r.d->>'installmentAmount')::int, 1) >= 13 then 'monthly'
           else 'other' end);

    insert into receivables(company_id, project_id, sale_id, client_id, unit_id, category, description, sequence_number, sequence_total, due_date, amount,
      correction_index_id, status, paid_at, paid_amount, paid_account_name, bank_account_id, notes,
      installment_interest_amount, late_fee_amount, other_accrual_amount, discount_amount, correction_amount, adjusted_amount, correction_locked,
      source_system, source_id, source_record_kind, created_by, created_at)
    values (p_company_id, p_project_id, s.id, s.client_id, s.unit_id, v_cat,
      concat(case v_cat when 'entry' then 'Entrada' when 'monthly' then 'Parcela mensal' when 'reinforcement' then 'Reforço'
                        when 'keys' then 'Chaves' when 'post_keys' then 'Parcela pós-chaves' else 'Parcela' end,
             ' ', greatest(coalesce((r.d->>'receiveOrder')::int, 1), 1), '/', greatest(coalesce((r.d->>'installmentAmount')::int, 1), 1),
             coalesce(' · ' || nullif(r.d->>'setupPayName', ''), '')),
      greatest(coalesce((r.d->>'receiveOrder')::int, 1), 1), greatest(coalesce((r.d->>'installmentAmount')::int, 1), 1),
      coalesce(nullif(r.d->>'dueDate','')::timestamp::date, nullif(r.d->>'paymentDate','')::timestamp::date, nullif(r.d->>'payReceiveDate','')::timestamp::date, s.sale_date), v_base,
      case when v_status = 'open' and r.d->>'setupPayName' ilike '%CUB%' then v_cub end,
      v_status, case when v_status = 'paid' then (r.d->>'paymentDate')::timestamp::date end, v_paid,
      case when v_status = 'paid' then r.d->>'accountName' end,
      case when v_status = 'paid' then elos_import.map_get(p_company_id, null, 'account', 'flow:' || (r.d->>'accountId')) end,
      nullif(btrim(coalesce(r.d->>'billComments', '')), ''),
      case when v_status = 'paid' then coalesce((r.d->>'interestValue')::numeric, 0) else 0 end,
      case when v_status = 'paid' then coalesce((r.d->>'lateFeeValue')::numeric, 0) else 0 end,
      case when v_status = 'paid' then coalesce((r.d->>'otherAccruals')::numeric, 0) else 0 end,
      case when v_status = 'paid' then coalesce((r.d->>'discountValue')::numeric, 0) else 0 end,
      case when v_status = 'paid' then round(v_paid - v_base - coalesce((r.d->>'interestValue')::numeric, 0) - coalesce((r.d->>'lateFeeValue')::numeric, 0)
                                             - coalesce((r.d->>'otherAccruals')::numeric, 0) + coalesce((r.d->>'discountValue')::numeric, 0), 2) else 0 end,
      v_paid, v_status = 'paid',
      'elos_import', 'flow:receivable:' || (r.d->>'billReceiveId'), 'imported', p_user_id, now());
    perform elos_import.map_put(p_company_id, p_project_id, 'bill_to_receive', r.d->>'billReceiveId', 'receivable',
      (select id from receivables where company_id = p_company_id and source_system = 'elos_import' and source_id = 'flow:receivable:' || (r.d->>'billReceiveId')), 'imported');
    v_n := v_n + 1; v_value := v_value + v_base; v_paid_total := v_paid_total + coalesce(v_paid, 0);
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('unidades', v_n_units, 'vendas', v_n_sales, 'parcelas', v_n, 'valor_base', v_value, 'recebido', v_paid_total, 'sem_venda', v_nosale)
  where id = v_run;
  return jsonb_build_object('unidades', v_n_units, 'vendas', v_n_sales, 'parcelas', v_n, 'valor_base', v_value, 'recebido', v_paid_total, 'sem_venda', v_nosale);
end;
$$;

revoke all on function elos_import.wave5_commercial(uuid, uuid, uuid, uuid) from public, anon, authenticated;
