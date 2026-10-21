-- SOMENTE LEITURA. Não aplicar a extensão antes de analisar cada pendência.
select 'payables_non_finite' as control,count(*) as pending from public.payables where amount='NaN'::numeric or paid_amount='NaN'::numeric
union all select 'receivables_non_finite',count(*) from public.receivables where amount='NaN'::numeric or paid_amount='NaN'::numeric
union all select 'payable_project_company',count(*) from public.payables p left join public.projects j on j.id=p.project_id and j.company_id=p.company_id where j.id is null
union all select 'payable_supplier_company',count(*) from public.payables p join public.suppliers s on s.id=p.supplier_id where s.company_id<>p.company_id
union all select 'receivable_sale_scope',count(*) from public.receivables r left join public.sales s on s.id=r.sale_id and s.company_id=r.company_id and s.project_id=r.project_id and s.client_id=r.client_id and s.unit_id=r.unit_id where s.id is null
union all select 'bank_account_scope',count(*) from public.finance_bank_transactions t join public.finance_bank_accounts a on a.id=t.bank_account_id where t.company_id is distinct from a.company_id or t.legal_entity_id is distinct from a.legal_entity_id
union all select 'unidentified_payable_source',count(*) from public.payables where source_system is null or source_id is null;
