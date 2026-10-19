-- Importação limpa — Onda 1c: contas bancárias e contas internas
--
-- Na origem, cada empresa (Bossa, Flow, Alma) tem a sua lista de contas. As contas "PROVISÓRIA ..." do
-- Flow e do Alma são a mesma conta física da Bossa usada provisoriamente: viram uma conta só no Elos.
-- Contas sem banco (Créditos de clientes, Dividendos, Imóveis, Veículos, Ajustes, Dinheiro) são contas
-- internas de liquidação e entram como tipo "cash".

create or replace function elos_import.wave1_bank_accounts(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_run uuid; r record; v_id uuid; v_created int := 0; v_linked int := 0; v_le uuid; v_acc text;
begin
  insert into elos_import.runs(company_id, wave) values (p_company_id, '1c-contas') returning id into v_run;
  select id into v_le from legal_entities where company_id = p_company_id and is_primary order by created_at limit 1;

  for r in
    select * from (
    select payload->>'_enterprise' emp,
           payload->'data'->>'accountId' aid,
           btrim(regexp_replace(payload->'data'->>'accountName', '^\s*PROVIS[ÓO]RIA\s+', '', 'i')) label,
           nullif(btrim(payload->'data'->>'bankName'), '') bank,
           nullif(btrim(payload->'data'->>'agencyNumber'), '') agency,
           nullif(btrim(payload->'data'->>'accountNumber'), '') acc,
           nullif(btrim(payload->'data'->>'accountDigit'), '') dig,
           payload->'data'->>'bankAccountType' btype,
           coalesce(nullif(payload->'data'->>'initialBalance', '')::numeric, 0) ib,
           nullif(payload->'data'->>'initialDate', '')::date idate,
           (payload->'data'->>'accountName') ~* '^\s*PROVIS[ÓO]RIA' provisoria
    from koper_staging_records where entity = 'mirror.account'
    ) a
    order by provisoria, emp = 'bossa' desc, emp, aid::int
  loop
    select a.id into v_id from finance_bank_accounts a
     where a.company_id = p_company_id and public.integration_normalize_key(a.label) = public.integration_normalize_key(r.label)
     limit 1;
    if v_id is null then
      v_acc := coalesce(r.acc, 'INTERNA-' || r.aid);
      -- mesma conta física com outro produto (aplicação, cotas): diferencia o número pelo nome da conta
      if exists (select 1 from finance_bank_accounts a where a.company_id = p_company_id
                   and coalesce(a.legal_entity_id, '00000000-0000-0000-0000-000000000000') = coalesce(v_le, '00000000-0000-0000-0000-000000000000')
                   and lower(a.bank_name) = lower(coalesce(r.bank, 'Conta interna')) and lower(coalesce(a.agency, '')) = lower(coalesce(r.agency, ''))
                   and lower(a.account_number) = lower(v_acc) and lower(coalesce(a.account_digit, '')) = lower(coalesce(r.dig, ''))) then
        v_acc := v_acc || ' · ' || r.label;
      end if;
      insert into finance_bank_accounts(company_id, legal_entity_id, label, bank_name, agency, account_number, account_digit,
                                        account_type, currency_code, opening_balance, opening_balance_date,
                                        allow_negative, is_default, status)
      values (p_company_id, v_le, r.label, coalesce(r.bank, 'Conta interna'), r.agency,
              v_acc, r.dig,
              case when r.bank is null then 'cash'
                   when r.label ~* '(invest|cdi|cotas)' or r.btype = '3' then 'investment'
                   when r.label ~* 'poupan' or r.btype = '2' then 'savings'
                   else 'checking' end,
              'BRL', case when r.provisoria then 0 else r.ib end, coalesce(r.idate, date '2023-01-01'),
              true, false, 'active')
      returning id into v_id;
      v_created := v_created + 1;
    else
      v_linked := v_linked + 1;
    end if;
    perform elos_import.map_put(p_company_id, null, 'account', r.emp || ':' || r.aid, 'finance_bank_account', v_id,
                                case when r.provisoria then 'same_physical_account' else 'label' end, r.label);
  end loop;

  update elos_import.runs set status = 'done', finished_at = now(),
         summary = jsonb_build_object('criadas', v_created, 'vinculadas', v_linked) where id = v_run;
  return jsonb_build_object('criadas', v_created, 'vinculadas', v_linked);
end;
$$;

revoke all on function elos_import.wave1_bank_accounts(uuid) from public, anon, authenticated;
