-- Importação limpa — Onda 4 (ajustes de vínculo entre títulos e documentos)
--
-- 1) Duplicatas de NF-e que a origem lançou como "Conta a pagar" ficam ligadas à parcela da NF-e.
-- 2) Notas manuais cujas parcelas a origem desdobrou em outros títulos: as parcelas da nota passam a ser
--    exatamente os títulos existentes (mesmo total), cada uma ligada ao seu título.

with x as (
  select i.id inst_id, i.invoice_id, i.sequence_no, (select count(*) from finance_electronic_invoice_installments k where k.invoice_id = i.invoice_id) n,
         p.id pay_id, f.invoice_number, f.series, f.access_key
  from finance_electronic_invoice_installments i
  join integration_mappings m on m.target_entity_id = i.id and m.source_entity_type = 'bill'
  join integration_mappings mp on mp.source_entity_type = 'bill_to_pay' and mp.external_id = m.external_id and mp.scope_id = i.project_id
  join payables p on p.id = mp.target_entity_id
  join finance_electronic_invoices f on f.id = i.invoice_id
  where i.payable_id is null),
u as (update payables p set source_system = 'elos_os', source_id = 'nfe:' || x.invoice_id || ':' || x.inst_id, origin = 'xml', fiscal_class = 'NF-e',
        document = concat(x.invoice_number, '/', coalesce(x.series, '-')), installment_label = concat(x.sequence_no, ' / ', x.n),
        notes = concat_ws(E'\n', 'NF-e ' || x.access_key, p.notes), updated_at = now()
      from x where p.id = x.pay_id returning p.id)
update finance_electronic_invoice_installments i set payable_id = x.pay_id, updated_at = now()
from x where i.id = x.inst_id and exists (select 1 from u where u.id = x.pay_id);

create or replace function elos_import.fix_manual_invoice_split_titles(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare inv record; e record; v_missing uuid[]; v_k int; v_next int; v_cnt int := 0; v_total int; v_inst uuid;
begin
  for inv in
    select fi.id, fi.registry_number from finance_manual_invoices fi
    where fi.project_id = p_project_id
      and exists (select 1 from finance_manual_invoice_installments k where k.invoice_id = fi.id and k.payable_id is null)
      and exists (select 1 from elos_import.issues i where i.problem = 'titulo_extra_da_nota_manual' and i.detail->>'nota' = fi.registry_number and i.project_id = p_project_id)
  loop
    select array_agg(id order by sequence_no) into v_missing from finance_manual_invoice_installments where invoice_id = inv.id and payable_id is null;
    select coalesce(max(sequence_no), 0) into v_next from finance_manual_invoice_installments where invoice_id = inv.id;
    v_k := 0;
    for e in
      select p.* from elos_import.issues i
      join payables p on p.id = elos_import.map_get(p.company_id, p_project_id, 'bill_to_pay', i.source_key)
      where i.problem = 'titulo_extra_da_nota_manual' and i.detail->>'nota' = inv.registry_number and i.project_id = p_project_id
      order by p.due_date, p.amount desc
    loop
      v_k := v_k + 1;
      if v_k <= cardinality(v_missing) then
        v_inst := v_missing[v_k];
        update finance_manual_invoice_installments set amount = e.amount, due_date = e.due_date, payable_id = e.id, updated_at = now() where id = v_inst;
      else
        v_next := v_next + 1;
        insert into finance_manual_invoice_installments(company_id, project_id, invoice_id, sequence_no, installment_label, due_date, amount, payable_id)
        values (e.company_id, p_project_id, inv.id, v_next, v_next::text, e.due_date, e.amount, e.id)
        returning id into v_inst;
      end if;
      update payables set source_system = 'elos_os', source_id = 'manual_invoice:' || inv.id || ':' || v_inst, origin = 'manual_invoice', updated_at = now()
       where id = e.id;
    end loop;
    select count(*) into v_total from finance_manual_invoice_installments where invoice_id = inv.id;
    update payables p set installment_label = concat(k.sequence_no, ' / ', v_total)
      from finance_manual_invoice_installments k where k.invoice_id = inv.id and p.id = k.payable_id;
    perform refresh_finance_manual_invoice(inv.id);
    v_cnt := v_cnt + 1;
  end loop;
  return jsonb_build_object('notas_ajustadas', v_cnt);
end;
$$;

revoke all on function elos_import.fix_manual_invoice_split_titles(uuid) from public, anon, authenticated;
