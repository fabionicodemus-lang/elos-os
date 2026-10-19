-- Importação limpa — Onda 7: transferências e lançamentos avulsos das contas do Flow
--
-- Origem: extrato completo de cada conta do Flow (tela "Contas bancárias", 11 contas, ~6 mil movimentos),
-- guardado em elos_import.flow_movements. Pagamentos e recebimentos já entraram na onda 6 (ligados aos
-- títulos); aqui entram só os movimentos sem título:
-- * transferência com os dois lados no Flow → uma transferência no Elos (dois lançamentos ligados);
-- * transferência com o outro lado em outra empresa do grupo → um lançamento do tipo transferência;
-- * lançamento avulso (tarifa, imposto, integralização, ajuste, pró-labore etc.) → um lançamento.
-- Depois desta onda, o saldo de cada conta do Flow no Elos é igual ao saldo do extrato da origem.

create table if not exists elos_import.flow_movements as
select split_part(k.payload->>'path', '/', 5)::int acc, (it->>'movementId')::int movement_id, it
from public.koper_staging_records k, jsonb_array_elements(k.payload->'body'->'items') it
where k.entity = 'probe.api' and k.payload->>'path' like '/financial/v3/bank-account-details/%/movements'
  and k.payload->'query'->>'size' = '100';
alter table elos_import.flow_movements enable row level security;

create or replace function elos_import.wave7_bank_other(p_company_id uuid, p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; v_from uuid; v_to uuid; v_tr uuid; v_d uuid; v_c uuid; v_acc uuid; v_le uuid; v_amount numeric; v_type text;
  n_pairs int := 0; n_single int := 0; n_other int := 0; v_sum numeric := 0;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '7-transferencias-avulsos') returning id into v_run;

  -- 1) Transferências com os dois lados no Flow
  for r in
    select it_out.it o, it_in.it i, it_out.acc oacc, it_in.acc iacc
    from elos_import.flow_movements it_out
    join elos_import.flow_movements it_in on it_in.it->>'transferenceId' = it_out.it->>'transferenceId' and it_in.movement_id <> it_out.movement_id
    where it_out.it->>'transferenceId' is not null and (it_out.it->>'movementValue')::numeric < 0 and (it_in.it->>'movementValue')::numeric > 0
  loop
    if exists (select 1 from finance_bank_transactions where company_id = p_company_id and source_id = 'flow:mov:' || (r.o->>'movementId')) then continue; end if;
    v_from := elos_import.map_get(p_company_id, null, 'account', 'flow:' || r.oacc);
    v_to := elos_import.map_get(p_company_id, null, 'account', 'flow:' || r.iacc);
    v_amount := abs((r.o->>'movementValue')::numeric);
    if v_from = v_to then
      -- As duas contas da origem são a mesma conta física no Elos: o dinheiro não sai da conta.
      perform elos_import.issue(v_run, p_company_id, p_project_id, 'movement', r.o->>'movementId', 'transferencia_mesma_conta',
        jsonb_build_object('valor', v_amount, 'data', r.o->>'movementDate'));
      continue;
    end if;
    insert into finance_bank_transfers(company_id, project_id, from_account_id, to_account_id, transfer_date, amount, description, status, created_by)
    values (p_company_id, p_project_id, v_from, v_to, (r.o->>'movementDate')::date, v_amount,
      left(concat('Transferência ', r.o->>'originAccountName', ' → ', r.o->>'destinationAccountName', coalesce(' · ' || nullif(r.o->>'movementComments', ''), '')), 300),
      'posted', p_user_id) returning id into v_tr;
    insert into finance_bank_transactions(company_id, project_id, legal_entity_id, bank_account_id, transaction_date, competence_date, direction, transaction_type,
      description, counterparty, amount, status, transfer_id, source_system, source_id, notes, created_by)
    select p_company_id, p_project_id, a.legal_entity_id, v_from, (r.o->>'movementDate')::date, (r.o->>'movementDate')::date, 'debit', 'transfer',
      left(concat('Transferência para ', r.o->>'destinationAccountName'), 200), r.o->>'destinationAccountName', v_amount, 'posted', v_tr,
      'elos_import', 'flow:mov:' || (r.o->>'movementId'), nullif(r.o->>'movementComments', ''), p_user_id
    from finance_bank_accounts a where a.id = v_from returning id into v_d;
    insert into finance_bank_transactions(company_id, project_id, legal_entity_id, bank_account_id, transaction_date, competence_date, direction, transaction_type,
      description, counterparty, amount, status, transfer_id, source_system, source_id, notes, created_by)
    select p_company_id, p_project_id, a.legal_entity_id, v_to, (r.i->>'movementDate')::date, (r.i->>'movementDate')::date, 'credit', 'transfer',
      left(concat('Transferência de ', r.i->>'originAccountName'), 200), r.i->>'originAccountName', v_amount, 'posted', v_tr,
      'elos_import', 'flow:mov:' || (r.i->>'movementId'), nullif(r.i->>'movementComments', ''), p_user_id
    from finance_bank_accounts a where a.id = v_to returning id into v_c;
    update finance_bank_transfers set debit_transaction_id = v_d, credit_transaction_id = v_c where id = v_tr;
    n_pairs := n_pairs + 1;
  end loop;

  -- 2) Transferências com um lado só no Flow e 3) lançamentos avulsos
  for r in
    select m.acc, m.it from elos_import.flow_movements m
    where m.it->>'billId' is null and m.it->>'billReceiveId' is null and (m.it->>'movementValue')::numeric <> 0
      and not exists (select 1 from finance_bank_transactions t where t.company_id = p_company_id and t.source_id = 'flow:mov:' || m.movement_id)
      and not (m.it->>'transferenceId' is not null and exists (select 1 from elos_import.flow_movements o
                where o.it->>'transferenceId' = m.it->>'transferenceId' and o.movement_id <> m.movement_id))
    order by (m.it->>'movementDate')::date, m.movement_id
  loop
    v_acc := elos_import.map_get(p_company_id, null, 'account', 'flow:' || r.acc);
    select legal_entity_id into v_le from finance_bank_accounts where id = v_acc;
    v_amount := (r.it->>'movementValue')::numeric;
    v_type := case
      when r.it->>'transferenceId' is not null then 'transfer'
      when r.it->>'itemChartName' ilike 'Tarifa%' then 'fee'
      when r.it->>'itemChartName' ilike '%imposto%' then 'tax'
      when r.it->>'itemChartName' ilike '%não identificad%' or r.it->>'originName' ilike '%ajuste%' then 'adjustment'
      when r.it->>'itemChartName' ilike 'Devolução%' then 'refund'
      else 'other' end;
    insert into finance_bank_transactions(company_id, project_id, legal_entity_id, bank_account_id, transaction_date, competence_date, direction, transaction_type,
      description, counterparty, amount, status, source_system, source_id, notes, created_by)
    values (p_company_id, p_project_id, v_le, v_acc, (r.it->>'movementDate')::date, (r.it->>'movementDate')::date,
      case when v_amount > 0 then 'credit' else 'debit' end, v_type,
      left(case when v_type = 'transfer'
             then concat('Transferência entre empresas · ', r.it->>'originAccountName', ' → ', r.it->>'destinationAccountName')
             else concat(coalesce(r.it->>'itemChartName', 'Lançamento avulso'), ' · ', r.it->>'originName') end, 200),
      case when v_type = 'transfer' then case when v_amount > 0 then r.it->>'originAccountName' else r.it->>'destinationAccountName' end else r.it->>'originName' end,
      abs(v_amount), 'posted', 'elos_import', 'flow:mov:' || (r.it->>'movementId'), nullif(r.it->>'movementComments', ''), p_user_id);
    if v_type = 'transfer' then n_single := n_single + 1; else n_other := n_other + 1; end if;
    v_sum := v_sum + v_amount;
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('transferencias_internas', n_pairs, 'transferencias_entre_empresas', n_single, 'avulsos', n_other, 'liquido_um_lado', v_sum)
  where id = v_run;
  return jsonb_build_object('transferencias_internas', n_pairs, 'transferencias_entre_empresas', n_single, 'avulsos', n_other, 'liquido_um_lado', v_sum);
end;
$$;
revoke all on function elos_import.wave7_bank_other(uuid, uuid, uuid) from public, anon, authenticated;
