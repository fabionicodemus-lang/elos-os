-- Elos OS — Todas as parcelas abertas usam o último CUB lançado
--
-- Regra oficial:
-- 1) parcelas já recebidas ou canceladas permanecem com o valor histórico;
-- 2) parcelas em aberto, inclusive com vencimento futuro, usam a variação entre
--    o último CUB lançado e o CUB 0 de cada venda;
-- 3) meses anteriores ao início contratual da correção permanecem no valor base;
-- 4) ao cadastrar um novo CUB, todas as parcelas abertas são recalculadas.
--
-- Fórmula para CUB-SC:
--   Valor = Valor base × (último CUB lançado / CUB 0 da venda)

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
  current_month_value date;
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

  -- Valores históricos recebidos ou cancelados nunca são recalculados.
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

  -- Parcela aberta sem índice: Valor = Valor base.
  if new.correction_index_id is null then
    new.adjustment_index := null;
    new.correction_base_month := null;
    new.correction_base_value := null;
    new.correction_reference_month := null;
    new.correction_reference_value := null;
    new.correction_amount := 0;
    new.adjusted_amount := round(new.amount, 2);
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
    new.adjusted_amount := round(new.amount, 2);
    return new;
  end if;

  base_month_value := date_trunc('month', sale_date_value)::date;
  due_month_value := date_trunc('month', new.due_date)::date;
  current_month_value := date_trunc(
    'month',
    timezone('America/Sao_Paulo', now())
  )::date;
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

  -- Antes do mês definido no contrato, permanece o Valor base.
  if months_after_sale < coalesce(correction_start_value, 4) then
    new.correction_reference_month := base_month_value;
    new.correction_reference_value := new.correction_base_value;
    new.correction_amount := 0;
    new.adjusted_amount := round(new.amount, 2);
    return new;
  end if;

  -- Toda parcela aberta usa o último índice efetivamente lançado até o mês atual,
  -- independentemente do seu vencimento ser passado, atual ou futuro.
  select index_value.reference_month, index_value.value
  into target_month_value, target_index_value
  from public.correction_index_values index_value
  where index_value.company_id = new.company_id
    and index_value.correction_index_id = new.correction_index_id
    and index_value.reference_month <= current_month_value
  order by index_value.reference_month desc
  limit 1;

  new.correction_reference_month := target_month_value;
  new.correction_reference_value := target_index_value;

  if new.correction_base_value is null
     or new.correction_base_value = 0
     or target_index_value is null then
    new.correction_amount := 0;
    new.adjusted_amount := round(new.amount, 2);
  elsif index_type_value = 'index_number' then
    -- CUB-SC: Valor base × (último CUB lançado / CUB 0).
    new.adjusted_amount := round(
      new.amount * (target_index_value / new.correction_base_value),
      2
    );
    new.correction_amount := round(new.adjusted_amount - new.amount, 2);
  else
    -- Índices percentuais: acumula até o último índice lançado.
    select coalesce(exp(sum(ln(1 + (index_value.value / 100.0)))), 1)
    into cumulative_factor
    from public.correction_index_values index_value
    where index_value.company_id = new.company_id
      and index_value.correction_index_id = new.correction_index_id
      and index_value.reference_month > base_month_value
      and index_value.reference_month <= target_month_value
      and index_value.value > -100;

    new.adjusted_amount := round(
      new.amount * coalesce(cumulative_factor, 1),
      2
    );
    new.correction_amount := round(new.adjusted_amount - new.amount, 2);
  end if;

  return new;
end;
$$;

-- Recalcula imediatamente todas as parcelas abertas, inclusive as futuras.
update public.receivables
set updated_at = now()
where status = 'open'
  and correction_locked = false;

commit;

-- Conferência 1: parcelas futuras em aberto devem estar usando o último CUB.
select
  unit.code as unidade,
  receivable.due_date,
  receivable.amount as valor_base,
  receivable.adjusted_amount as valor_atualizado,
  receivable.correction_amount as correcao,
  receivable.correction_base_value as cub_0,
  receivable.correction_reference_month as competencia_ultimo_cub,
  receivable.correction_reference_value as ultimo_cub
from public.receivables receivable
join public.units unit on unit.id = receivable.unit_id
where receivable.status = 'open'
  and receivable.correction_locked = false
  and date_trunc('month', receivable.due_date)::date
      > date_trunc('month', timezone('America/Sao_Paulo', now()))::date
order by unit.code, receivable.due_date;

-- Conferência 2: parcelas recebidas continuam com o histórico travado.
select
  unit.code as unidade,
  receivable.due_date,
  receivable.amount as valor_base,
  receivable.adjusted_amount as valor_historico,
  receivable.correction_amount as correcao_historica,
  receivable.correction_reference_month as competencia_historica,
  receivable.paid_amount as recebido
from public.receivables receivable
join public.units unit on unit.id = receivable.unit_id
where receivable.status = 'paid'
  and receivable.correction_locked = true
order by unit.code, receivable.due_date;