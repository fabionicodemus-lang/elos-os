-- Elos OS — Parcelas abertas sempre usam o CUB mais recente cadastrado
--
-- Regra oficial:
--   Valor atualizado = Valor base × (CUB atual / CUB do mês 0 da venda)
--
-- O mês da venda permanece como mês 0.
-- Meses 0, 1, 2 e 3 permanecem sem reajuste.
-- A partir do mês 4, toda parcela em aberto usa o último CUB disponível,
-- independentemente do mês de vencimento da parcela.
-- Parcelas recebidas continuam travadas com os valores históricos.

begin;

create or replace function public.set_receivable_automatic_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_date_value date;
  correction_start_value integer;
  index_code_value text;
  index_type_value text;
  base_month_value date;
  due_month_value date;
  months_after_sale integer;
  target_month_value date;
  target_index_value numeric(18,6);
  cumulative_factor numeric;
begin
  new.amount := coalesce(new.amount, 0);
  new.installment_interest_amount := coalesce(new.installment_interest_amount, 0);
  new.correction_amount := coalesce(new.correction_amount, 0);
  new.late_fee_amount := coalesce(new.late_fee_amount, 0);
  new.other_accrual_amount := coalesce(new.other_accrual_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);

  -- Valores históricos recebidos não são recalculados.
  if new.correction_locked or new.status <> 'open' then
    if new.adjusted_amount is null or new.adjusted_amount = 0 then
      new.adjusted_amount := round(
        new.amount
        + new.installment_interest_amount
        + new.correction_amount
        + new.late_fee_amount
        + new.other_accrual_amount
        - new.discount_amount,
        2
      );
    end if;
    return new;
  end if;

  if new.correction_index_id is null then
    new.adjustment_index := null;
    new.correction_base_month := null;
    new.correction_base_value := null;
    new.correction_reference_month := null;
    new.correction_reference_value := null;
    new.correction_amount := 0;
    new.adjusted_amount := round(
      new.amount
      + new.installment_interest_amount
      + new.late_fee_amount
      + new.other_accrual_amount
      - new.discount_amount,
      2
    );
    return new;
  end if;

  select sale.sale_date, sale.correction_start_month
  into sale_date_value, correction_start_value
  from public.sales sale
  where sale.id = new.sale_id;

  select correction_index.code, correction_index.value_type
  into index_code_value, index_type_value
  from public.correction_indices correction_index
  where correction_index.id = new.correction_index_id
    and correction_index.company_id = new.company_id;

  if sale_date_value is null or index_code_value is null then
    new.correction_amount := 0;
    new.adjusted_amount := round(
      new.amount
      + new.installment_interest_amount
      + new.late_fee_amount
      + new.other_accrual_amount
      - new.discount_amount,
      2
    );
    return new;
  end if;

  base_month_value := date_trunc('month', sale_date_value)::date;
  due_month_value := date_trunc('month', new.due_date)::date;
  months_after_sale := public.receivable_month_distance(base_month_value, due_month_value);

  new.adjustment_index := index_code_value;
  new.correction_base_month := base_month_value;

  -- CUB 0: último índice disponível no mês da venda ou antes dele.
  select index_value.value
  into new.correction_base_value
  from public.correction_index_values index_value
  where index_value.company_id = new.company_id
    and index_value.correction_index_id = new.correction_index_id
    and index_value.reference_month <= base_month_value
  order by index_value.reference_month desc
  limit 1;

  -- Antes do mês 4, mantém o valor base.
  if months_after_sale < coalesce(correction_start_value, 4) then
    new.correction_reference_month := base_month_value;
    new.correction_reference_value := new.correction_base_value;
    new.correction_amount := 0;
    new.adjusted_amount := round(
      new.amount
      + new.installment_interest_amount
      + new.late_fee_amount
      + new.other_accrual_amount
      - new.discount_amount,
      2
    );
    return new;
  end if;

  -- Toda parcela aberta usa o índice mais recente existente no cadastro,
  -- sem limitar pelo mês de vencimento da parcela.
  select index_value.reference_month, index_value.value
  into target_month_value, target_index_value
  from public.correction_index_values index_value
  where index_value.company_id = new.company_id
    and index_value.correction_index_id = new.correction_index_id
  order by index_value.reference_month desc
  limit 1;

  new.correction_reference_month := target_month_value;
  new.correction_reference_value := target_index_value;

  if new.correction_base_value is null
     or new.correction_base_value = 0
     or target_index_value is null then
    new.correction_amount := 0;
  elsif index_type_value = 'index_number' then
    -- CUB-SC: Valor = Valor base × (CUB atual / CUB 0).
    new.correction_amount := round(
      new.amount * ((target_index_value / new.correction_base_value) - 1),
      2
    );
  else
    -- Para índices percentuais, acumula até o índice mais recente cadastrado.
    select coalesce(exp(sum(ln(1 + (index_value.value / 100.0)))), 1)
    into cumulative_factor
    from public.correction_index_values index_value
    where index_value.company_id = new.company_id
      and index_value.correction_index_id = new.correction_index_id
      and index_value.reference_month > base_month_value
      and index_value.reference_month <= target_month_value
      and index_value.value > -100;

    new.correction_amount := round(
      new.amount * (coalesce(cumulative_factor, 1) - 1),
      2
    );
  end if;

  new.adjusted_amount := round(
    new.amount
    + new.installment_interest_amount
    + new.correction_amount
    + new.late_fee_amount
    + new.other_accrual_amount
    - new.discount_amount,
    2
  );

  return new;
end;
$$;

-- Força o recálculo imediato de todas as parcelas abertas e não travadas.
update public.receivables
set updated_at = now()
where status = 'open'
  and correction_locked = false
  and correction_index_id is not null;

commit;

-- Conferência: todas as parcelas abertas reajustadas devem apontar
-- para o mesmo mês de referência mais recente de cada índice.
select
  correction_index.code as indice,
  receivable.correction_reference_month,
  count(*) as parcelas_abertas,
  round(sum(receivable.amount), 2) as valor_base,
  round(sum(receivable.adjusted_amount), 2) as valor_atualizado
from public.receivables receivable
join public.correction_indices correction_index
  on correction_index.id = receivable.correction_index_id
where receivable.status = 'open'
  and receivable.correction_locked = false
group by correction_index.code, receivable.correction_reference_month
order by correction_index.code, receivable.correction_reference_month desc;
