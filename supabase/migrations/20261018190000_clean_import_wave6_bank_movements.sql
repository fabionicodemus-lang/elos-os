-- Importação limpa — Onda 6: movimentos bancários do Flow
-- Cada título pago (saída) e cada parcela recebida (entrada) da Flow Aptos vira um lançamento na conta
-- onde foi pago/recebido, ligado ao título (payable_id / receivable_id). Transferências entre contas
-- não vêm na origem financeira já espelhada e ficam para uma etapa própria.

create or replace function elos_import.wave6_bank_movements(p_company_id uuid, p_project_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare v_run uuid; v_out int; v_in int; v_noacc int;
begin
  insert into elos_import.runs(company_id, project_id, wave) values (p_company_id, p_project_id, '6-movimentos-bancarios') returning id into v_run;

  with ins as (
    insert into finance_bank_transactions(company_id, project_id, legal_entity_id, bank_account_id, transaction_date, competence_date, direction, transaction_type,
      description, document, counterparty, amount, status, payable_id, source_system, source_id, created_by, created_at)
    select p.company_id, p.project_id, a.legal_entity_id, p.bank_account_id, p.paid_at, p.due_date, 'debit', 'payment',
      left(concat('Pagamento ', coalesce(p.fiscal_class, ''), ' ', coalesce(p.document, '')), 200), p.document,
      coalesce(s.trade_name, s.legal_name, p.beneficiary_name), p.paid_amount, 'posted', p.id, 'elos_import', 'flow:pay:' || p.id, p_user_id, p.paid_at
    from payables p join finance_bank_accounts a on a.id = p.bank_account_id left join suppliers s on s.id = p.supplier_id
    where p.project_id = p_project_id and p.status = 'paid' and p.paid_amount > 0 and p.paid_at is not null and p.bank_transaction_id is null
    returning id, payable_id)
  , upd as (update payables p set bank_transaction_id = ins.id, updated_at = now() from ins where p.id = ins.payable_id returning 1)
  select count(*) into v_out from upd;

  with ins as (
    insert into finance_bank_transactions(company_id, project_id, legal_entity_id, bank_account_id, transaction_date, competence_date, direction, transaction_type,
      description, document, counterparty, amount, status, receivable_id, source_system, source_id, created_by, created_at)
    select r.company_id, r.project_id, a.legal_entity_id, r.bank_account_id, r.paid_at, r.due_date, 'credit', 'receipt',
      left(concat('Recebimento ', sa.number, ' · ', r.description), 200), sa.number, c.name, r.paid_amount, 'posted', r.id,
      'elos_import', 'flow:rcv:' || r.id, p_user_id, r.paid_at
    from receivables r join finance_bank_accounts a on a.id = r.bank_account_id join sales sa on sa.id = r.sale_id join clients c on c.id = r.client_id
    where r.project_id = p_project_id and r.status = 'paid' and r.paid_amount > 0 and r.paid_at is not null and r.bank_transaction_id is null
    returning id, receivable_id)
  , upd as (update receivables r set bank_transaction_id = ins.id, updated_at = now() from ins where r.id = ins.receivable_id returning 1)
  select count(*) into v_in from upd;

  select count(*) into v_noacc from (
    select id from payables where project_id = p_project_id and status = 'paid' and bank_account_id is null
    union all select id from receivables where project_id = p_project_id and status = 'paid' and bank_account_id is null) z;

  update elos_import.runs set status = 'done', finished_at = now(),
    summary = jsonb_build_object('saidas', v_out, 'entradas', v_in, 'pagos_sem_conta', v_noacc) where id = v_run;
  return jsonb_build_object('saidas', v_out, 'entradas', v_in, 'pagos_sem_conta', v_noacc);
end;
$$;
revoke all on function elos_import.wave6_bank_movements(uuid, uuid, uuid) from public, anon, authenticated;
