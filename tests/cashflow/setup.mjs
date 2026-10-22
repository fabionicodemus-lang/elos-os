import fs from 'node:fs';
import {setup as previous} from '../koper-finance/setup.mjs';
import {sql,ids} from '../financeiro/runtime.mjs';
export const migrations=['20261022100000_entity_obligations.sql','20261022110000_cashflow_versions.sql','20261022120000_cash_transfers.sql'].map(n=>'supabase/migrations/'+n);
export async function install(container){for(const m of migrations)await sql(container,fs.readFileSync(m,'utf8'));}
export async function setup(container){
 await previous(container);
 for(const n of ['20261021160000_financial_settlement_ledger.sql','20261021163000_financial_ai_settlements.sql'])await sql(container,fs.readFileSync('supabase/migrations/'+n,'utf8'));
 await install(container);
 // Explicit isolated scaffold, not an assertion about the full remote engineering schema.
 await sql(container,`create table engineering_schedule_baselines(id uuid primary key,company_id uuid,project_id uuid);
 create table finance_manual_invoices(id uuid primary key,company_id uuid,project_id uuid,contract_id uuid,measurement_id uuid,status text);
 create table finance_manual_invoice_installments(id uuid primary key,company_id uuid,project_id uuid,invoice_id uuid,payable_id uuid);
 create table execution_contract_measurements(id uuid primary key,company_id uuid,project_id uuid,contract_id uuid,payable_id uuid,status text);
 create table engineering_schedule_activities(id uuid primary key,company_id uuid,project_id uuid,baseline_id uuid,planned_finish date);
 create table execution_service_contracts(id uuid primary key,company_id uuid,project_id uuid,status text,current_value numeric(18,2));
 insert into permissions(key,module,action,description) values('cashflow.view','finance','view_cashflow','Fixture') on conflict do nothing;
 insert into role_permissions(role_id,permission_key) select r.id,p.key from roles r cross join permissions p where r.key='finance' and p.key in('cashflow.view','cashflow.manage') on conflict do nothing;
 insert into finance_entity_permissions values('${ids.a}','${ids.a1}','${ids.ur}',true,false) on conflict do nothing;`);
}
