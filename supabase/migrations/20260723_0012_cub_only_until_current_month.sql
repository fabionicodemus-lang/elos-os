-- Elos OS — CUB aplicado somente até o mês atual
--
-- Regra oficial:
-- 1) parcelas abertas com vencimento em meses futuros permanecem no Valor base;
-- 2) parcelas abertas vencidas ou do mês atual, a partir do mês 4 da venda,
--    usam o último CUB cadastrado até o mês atual;
-- 3) parcelas recebidas/canceladas permanecem travadas com o histórico;
-- 4) diferenças históricas importadas do Koper são registradas como correção
--    para não aparecerem incorretamente como "Sem correção no período".
--
-- O corte mensal considera o fuso America/Sao_Paulo para evitar mudança de mês
-- antecipada por causa do UTC do banco.

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

  -- Valores históricos recebidos/cancelados não são recalculados.
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

  -- Índice do mês zero da venda: último valor disponível no mês da venda ou antes.
  select index_value.value
  into new.correction_base_value
  from public.correction_index_values index_value
  where index_value.company_id = new.company_id
    and index_value.correction_index_id = new.correction_index_id
    and index_value.reference_month <= base_month_value
  order by index_value.reference_month desc
  limit 1;

  -- Parcelas de meses futuros ainda não recebem correção.
  if due_month_value > current_month_value then
    new.correction_reference_month := null;
    new.correction_reference_value := null;
    new.correction_amount := 0;
    new.adjusted_amount := round(new.amount, 2);
    return new;
  end if;

  -- Meses 0 a 3 da venda permanecem pelo Valor base.
  if months_after_sale < coalesce(correction_start_value, 4) then
    new.correction_reference_month := base_month_value;
    new.correction_reference_value := new.correction_base_value;
    new.correction_amount := 0;
    new.adjusted_amount := round(new.amount, 2);
    return new;
  end if;

  -- Parcelas vencidas ou do mês atual usam somente o último índice disponível
  -- até o mês atual. Valores de índice cadastrados futuramente são ignorados.
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
    -- CUB-SC: Valor = Valor base × (último CUB até hoje / CUB 0).
    new.adjusted_amount := round(
      new.amount * (target_index_value / new.correction_base_value),
      2
    );
    new.correction_amount := round(new.adjusted_amount - new.amount, 2);
  else
    -- Índices percentuais: acumula somente até o mês atual.
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

-- Recalcula todas as parcelas abertas imediatamente com a nova regra.
update public.receivables
set updated_at = now()
where status = 'open'
  and correction_locked = false;

-- Recupera a correção histórica das parcelas recebidas importadas do Koper.
-- Prioridade:
-- 1) diferença já existente no Valor histórico;
-- 2) composição original dos acréscimos importados;
-- 3) diferença entre valor recebido e Valor base, quando necessário.
with historical_values as (
  select
    receivable.id,
    case
      when abs(coalesce(receivable.adjusted_amount, receivable.amount) - receivable.amount) > 0.004
        then coalesce(receivable.adjusted_amount, receivable.amount)
      when abs(
        (
          receivable.amount
          + coalesce(receivable.installment_interest_amount, 0)
          + coalesce(receivable.correction_amount, 0)
          + coalesce(receivable.late_fee_amount, 0)
          + coalesce(receivable.other_accrual_amount, 0)
          - coalesce(receivable.discount_amount, 0)
        ) - receivable.amount
      ) > 0.004
        then round(
          receivable.amount
          + coalesce(receivable.installment_interest_amount, 0)
          + coalesce(receivable.correction_amount, 0)
          + coalesce(receivable.late_fee_amount, 0)
          + coalesce(receivable.other_accrual_amount, 0)
          - coalesce(receivable.discount_amount, 0),
          2
        )
      when receivable.paid_amount is not null
       and abs(receivable.paid_amount - receivable.amount) > 0.004
        then receivable.paid_amount
      else coalesce(receivable.adjusted_amount, receivable.amount)
    end as historical_adjusted_amount
  from public.receivables receivable
  where receivable.source_system = 'koper_flow_receivables'
    and receivable.status = 'paid'
    and receivable.correction_locked = true
)
update public.receivables receivable
set adjusted_amount = round(historical.historical_adjusted_amount, 2),
    correction_amount = round(historical.historical_adjusted_amount - receivable.amount, 2),
    updated_at = now()
from historical_values historical
where receivable.id = historical.id
  and abs(historical.historical_adjusted_amount - receivable.amount) > 0.004;

commit;

-- Conferência 1: nenhuma parcela aberta de mês futuro pode estar corrigida.
select
  count(*) as parcelas_futuras_corrigidas
from public.receivables receivable
where receivable.status = 'open'
  and receivable.correction_locked = false
  and date_trunc('month', receivable.due_date)::date
      > date_trunc('month', timezone('America/Sao_Paulo', now()))::date
  and (
    abs(coalesce(receivable.adjusted_amount, receivable.amount) - receivable.amount) > 0.004
    or abs(coalesce(receivable.correction_amount, 0)) > 0.004
  );

-- Conferência 2: parcelas abertas vencidas/do mês atual apontam para o último
-- índice disponível até o mês atual, nunca para um índice futuro.
select
  unit.code as unidade,
  receivable.due_date,
  receivable.amount as valor_base,
  receivable.adjusted_amount as valor,
  receivable.correction_amount as correcao,
  receivable.correction_reference_month as mes_cub_aplicado
from public.receivables receivable
join public.units unit on unit.id = receivable.unit_id
where receivable.status = 'open'
  and receivable.correction_locked = false
  and date_trunc('month', receivable.due_date)::date
      <= date_trunc('month', timezone('America/Sao_Paulo', now()))::date
order by receivable.due_date, unit.code;

-- Conferência 3: parcelas recebidas com diferença histórica devem exibir correção.
select
  unit.code as unidade,
  receivable.due_date,
  receivable.amount as valor_base,
  receivable.adjusted_amount as valor_historico,
  receivable.correction_amount as correcao_historica,
  receivable.paid_amount as recebido
from public.receivables receivable
join public.units unit on unit.id = receivable.unit_id
where receivable.source_system = 'koper_flow_receivables'
  and receivable.status = 'paid'
  and receivable.correction_locked = true
  and abs(coalesce(receivable.adjusted_amount, receivable.amount) - receivable.amount) > 0.004
order by receivable.due_date, unit.code;