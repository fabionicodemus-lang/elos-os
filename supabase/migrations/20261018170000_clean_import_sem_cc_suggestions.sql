-- Importação limpa — sugestões de centro de custo para o que veio sem classificação (SEM-CC)
--
-- Regras de palavras-chave (prioridade menor vence) aplicadas a itens de NF-e sem centro de custo,
-- itens de nota manual no serviço "A classificar" e rateios SEM-CC de títulos avulsos.
-- O resultado vai para revisão do Fábio antes de ser aplicado. As regras usadas no Flow estão na
-- tabela elos_import.sem_cc_rules (dados), e o agrupamento revisado em elos_import.sem_cc_groups.

create table if not exists elos_import.sem_cc_rules(
  priority int primary key,
  pattern text not null,
  target_code text not null,
  reason text not null
);

create or replace view elos_import.sem_cc_lines as
with src as (
  select 'nfe_item' kind, ii.id, ii.project_id, ii.total_amount v, lower(coalesce(ii.description,'')||' | '||coalesce(f.issuer_name,'')) txt
  from finance_electronic_invoice_items ii join finance_electronic_invoices f on f.id = ii.invoice_id
  where ii.cost_center_service_id is null
    and not exists (select 1 from procurement_purchase_order_items poi where poi.id = ii.order_item_id and poi.cost_center_code = 'VIAB')
  union all
  select 'manual_item', mi.id, mi.project_id, mi.total_amount, lower(coalesce(mi.description,'')||' | '||coalesce(s.legal_name,'')||' | '||coalesce(fi.notes,''))
  from finance_manual_invoice_items mi join finance_manual_invoices fi on fi.id = mi.invoice_id left join suppliers s on s.id = fi.supplier_id
  join engineering_services es on es.id = mi.service_id and es.code = 'SEM-CC'
  union all
  select 'title_alloc', a.id, a.project_id, a.allocation_amount, lower(coalesce(a.service_name_snapshot,'')||' | '||coalesce(p.beneficiary_name,'')||' | '||coalesce(p.source_category,'')||' | '||coalesce(p.notes,''))
  from payable_cost_allocations a join payables p on p.id = a.payable_id
  where a.service_id is null and a.wbs_code_snapshot = 'SEM-CC'
    and p.source_id not like 'nfe:%' and p.source_id not like 'manual_invoice:%')
select src.*, r.target_code, r.reason, r.priority
from src left join lateral (select * from elos_import.sem_cc_rules r where src.txt ~* r.pattern order by r.priority limit 1) r on true;
