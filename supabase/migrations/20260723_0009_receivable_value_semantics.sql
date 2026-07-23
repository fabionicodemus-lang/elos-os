-- Elos OS — Semântica oficial de valores do contas a receber
--
-- Valor base: receivables.amount, valor nominal original, nunca reajustado.
-- Valor: receivables.adjusted_amount, atualizado pelo índice aplicável.
-- Valor contrato: soma dos valores base das parcelas não canceladas.
-- Valor atualizado: soma dos valores atualizados das parcelas não canceladas.
-- Em aberto: soma dos valores atualizados das parcelas abertas.
-- Recebido: soma dos valores efetivamente recebidos.

begin;

create or replace function public.receivables_summary(
  p_company_id uuid,
  p_project_id uuid default null,
  p_sale_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with sale_totals as (
    select
      count(*) filter (where sale.status = 'active') as active_sales,
      coalesce(sum(sale.total_amount) filter (where sale.status = 'active'), 0) as registered_sale_amount
    from public.sales sale
    where sale.company_id = p_company_id
      and (p_project_id is null or sale.project_id = p_project_id)
      and (p_sale_id is null or sale.id = p_sale_id)
      and (
        public.has_company_permission(sale.company_id, 'receivables.view')
        or public.has_company_permission(sale.company_id, 'receivables.manage')
      )
  ),
  receivable_totals as (
    select
      count(*) filter (where receivable.status <> 'cancelled') as total_count,
      count(*) filter (where receivable.status = 'open') as open_count,
      count(*) filter (where receivable.status = 'paid') as paid_count,
      count(*) filter (
        where receivable.status = 'open'
          and receivable.due_date < current_date
      ) as overdue_count,
      coalesce(sum(receivable.amount) filter (
        where receivable.status <> 'cancelled'
      ), 0) as base_amount,
      coalesce(sum(receivable.adjusted_amount) filter (
        where receivable.status <> 'cancelled'
      ), 0) as updated_amount,
      coalesce(sum(receivable.correction_amount) filter (
        where receivable.status <> 'cancelled'
      ), 0) as correction_amount,
      coalesce(sum(receivable.adjusted_amount) filter (
        where receivable.status = 'open'
      ), 0) as open_amount,
      coalesce(sum(coalesce(receivable.paid_amount, receivable.adjusted_amount)) filter (
        where receivable.status = 'paid'
      ), 0) as paid_amount,
      coalesce(sum(receivable.correction_amount) filter (
        where receivable.status = 'open'
      ), 0) as open_correction_amount
    from public.receivables receivable
    where receivable.company_id = p_company_id
      and (p_project_id is null or receivable.project_id = p_project_id)
      and (p_sale_id is null or receivable.sale_id = p_sale_id)
      and (
        public.has_company_permission(receivable.company_id, 'receivables.view')
        or public.has_company_permission(receivable.company_id, 'receivables.manage')
      )
  )
  select jsonb_build_object(
    'base_amount', receivable_totals.base_amount,
    'updated_amount', receivable_totals.updated_amount,
    'correction_amount', receivable_totals.correction_amount,
    'open_amount', receivable_totals.open_amount,
    'paid_amount', receivable_totals.paid_amount,
    'open_correction_amount', receivable_totals.open_correction_amount,
    'total_count', receivable_totals.total_count,
    'open_count', receivable_totals.open_count,
    'paid_count', receivable_totals.paid_count,
    'overdue_count', receivable_totals.overdue_count,
    'active_sales', sale_totals.active_sales,
    'registered_sale_amount', sale_totals.registered_sale_amount,

    -- Chaves antigas preservadas para compatibilidade com telas anteriores.
    'contracted_amount', receivable_totals.base_amount,
    'planned_amount', receivable_totals.base_amount,
    'unplanned_amount', greatest(
      sale_totals.registered_sale_amount - receivable_totals.base_amount,
      0
    )
  )
  from sale_totals cross join receivable_totals;
$$;

grant execute on function public.receivables_summary(uuid, uuid, uuid)
  to authenticated;

commit;

-- Conferência por venda: base, atualizado, aberto e recebido.
select
  unit.code as unidade,
  client.name as cliente,
  round(sum(receivable.amount) filter (
    where receivable.status <> 'cancelled'
  ), 2) as valor_contrato,
  round(sum(receivable.adjusted_amount) filter (
    where receivable.status <> 'cancelled'
  ), 2) as valor_atualizado,
  round(sum(receivable.adjusted_amount) filter (
    where receivable.status = 'open'
  ), 2) as em_aberto,
  round(sum(coalesce(receivable.paid_amount, 0)) filter (
    where receivable.status = 'paid'
  ), 2) as recebido
from public.receivables receivable
join public.units unit on unit.id = receivable.unit_id
join public.clients client on client.id = receivable.client_id
where receivable.source_system = 'koper_flow_receivables'
group by unit.code, client.name
order by unit.code;
