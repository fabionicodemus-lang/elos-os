-- Somente leitura. Não executado em servidor externo nesta etapa.
-- A ausência da DDL histórica de payable_cost_allocations exige introspecção
-- autorizada e confronto antes de ensaiar a migration em clone completo.
select n.nspname as schema_name,c.relname,c.relrowsecurity,
 (select count(*) from pg_policy p where p.polrelid=c.oid) as policy_count
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in('public','elos_import') and c.relkind='r'
and c.relname in('payables','payable_cost_allocations','integration_mappings','koper_staging_records','runs','issues')
order by 1,2;
select table_schema,table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name='payable_cost_allocations'
order by ordinal_position;
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid=to_regclass('public.payable_cost_allocations');
-- Sem IDs pessoais, documentos ou valores de credenciais.
select company_id,entity,count(*) as staged_rows,
 count(*) filter(where payload->>'_enterprise' is null) as missing_legacy_enterprise
from public.koper_staging_records where entity in('mirror.bill_to_pay_detail','bill_resolution')
group by company_id,entity;
