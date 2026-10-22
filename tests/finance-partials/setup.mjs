import fs from 'node:fs';
import {setup as previous} from '../supplier-refunds/setup.mjs';
import {sql} from '../financeiro/runtime.mjs';
export const migration='supabase/migrations/20261024100000_cash_adjustment_realizations.sql';
export async function install(container){await sql(container,fs.readFileSync(migration,'utf8'));}
export async function setup(container){
 await previous(container);await install(container);
 // Engineering tables absent from the previous financial scaffold. These support
 // persistent native economic facts/loaders, not a claim of full remote DDL parity.
 await sql(container,`create table engineering_budgets(id uuid primary key,company_id uuid,project_id uuid,code text,name text,version text,status text,is_base boolean,updated_at timestamptz default clock_timestamp());
 create table engineering_budget_items(id uuid primary key,company_id uuid,project_id uuid,budget_id uuid,service_id uuid,code text,description text,total_direct_cost numeric,status text);
 create table execution_contract_measurement_items(id uuid primary key,company_id uuid,project_id uuid,measurement_id uuid,service_id uuid,service_code text,service_name text,current_amount numeric);
 create table procurement_inventory_movements(id uuid primary key,company_id uuid,project_id uuid,cost_center_service_id uuid,cost_center_code text,cost_center_name text,movement_type text,total_value numeric);
 create table procurement_purchase_orders(id uuid primary key,company_id uuid,project_id uuid,status text,source_system text,source_id text);
 create table procurement_purchase_order_items(id uuid primary key,company_id uuid,project_id uuid,order_id uuid,cost_center_service_id uuid,cost_center_code text,cost_center_name text,ordered_quantity numeric,cancelled_quantity numeric,delivered_unit_cost numeric,total_amount numeric);
 create table procurement_inventory_balances(id uuid primary key,company_id uuid,project_id uuid,total_value numeric,quantity_on_hand numeric);
 create table finance_manual_invoice_items(id uuid primary key,company_id uuid,project_id uuid,invoice_id uuid,service_id uuid,service_code text,service_name text,total_amount numeric);
 create table finance_electronic_invoices(id uuid primary key,company_id uuid,project_id uuid,status text);
 create table finance_electronic_invoice_items(id uuid primary key,company_id uuid,project_id uuid,invoice_id uuid,cost_center_service_id uuid,description text,total_amount numeric,order_item_id uuid,receipt_item_id uuid);
 alter table engineering_services add development_cost_category text;
 create table validation.economic_acceptance(measurement_id uuid primary key,document text,accepted_date date,amount numeric,accepted_by uuid,reason text);
 -- Only the audit default clock is controlled for CT02, before inserts. No audit
 -- record is rewritten and no trigger/version/RLS/immutable guard is disabled.
 create function validation.known_clock() returns timestamptz language sql stable as $$select coalesce(nullif(current_setting('validation.known_at',true),'' )::timestamptz,clock_timestamp())$$;
 alter table finance_title_audit alter column recorded_at set default validation.known_clock();`);
 const projectTables=['engineering_budgets','engineering_budget_items','execution_contract_measurement_items','procurement_inventory_movements','procurement_purchase_orders','procurement_purchase_order_items','procurement_inventory_balances','finance_manual_invoice_items','finance_electronic_invoices','finance_electronic_invoice_items','execution_contract_measurements','finance_manual_invoices','finance_manual_invoice_installments','execution_service_contracts','engineering_schedule_baselines','engineering_schedule_activities'];
 for(const table of projectTables)await sql(container,`alter table ${table} enable row level security;
 create policy fixture_scoped_read on ${table} for select to authenticated using(public.finance_entity_scope(company_id,(select legal_entity_id from projects where id=project_id),false));
 grant select on ${table} to authenticated;`);
 await sql(container,'grant select on engineering_services to authenticated;grant usage on schema validation to authenticated;grant execute on function validation.known_clock() to authenticated;');
}
