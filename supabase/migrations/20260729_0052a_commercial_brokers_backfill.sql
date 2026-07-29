-- Elos OS — Corretores: backfill seguro das comissões de vendas já existentes
-- Execute após 20260729_0052_commercial_brokers.sql.

begin;

insert into public.commercial_sale_commissions(
  company_id,
  project_id,
  sale_id,
  proposal_id,
  broker_id,
  role,
  calculation_base,
  commission_pct,
  due_date,
  status,
  notes,
  source_system,
  source_id,
  created_by
)
select
  sale.company_id,
  sale.project_id,
  sale.id,
  proposal.id,
  sale.broker_id,
  'broker',
  sale.total_amount,
  sale.commission_pct,
  (sale.sale_date + broker.payment_due_days)::date,
  'planned',
  concat('Comissão automática da venda ', sale.number),
  'sales',
  sale.id::text,
  sale.created_by
from public.sales sale
join public.commercial_brokers broker
  on broker.id = sale.broker_id
 and broker.company_id = sale.company_id
left join public.commercial_proposals proposal
  on proposal.company_id = sale.company_id
 and proposal.converted_sale_id = sale.id
where sale.status = 'active'
  and sale.broker_id is not null
  and sale.commission_pct > 0
on conflict(company_id, source_system, source_id) do nothing;

commit;
