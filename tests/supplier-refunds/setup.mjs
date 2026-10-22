import fs from 'node:fs';
import {sql} from '../financeiro/runtime.mjs';
import {setup as cashSetup} from '../cashflow/setup.mjs';
export const migration='supabase/migrations/20261023100000_supplier_advance_refunds.sql';
export async function install(container){
 // Explicit test scaffolds where earlier-stage fixtures do not install engineering DDL.
 // Keep the five-column contract shape unchanged for earlier tests' positional inserts.
 await sql(container,`create table if not exists execution_service_contracts(id uuid primary key,company_id uuid,project_id uuid,status text,current_value numeric(18,2));
 create table if not exists execution_contract_measurements(id uuid primary key,company_id uuid,project_id uuid,contract_id uuid,payable_id uuid,status text);
 create table if not exists finance_manual_invoices(id uuid primary key,company_id uuid,project_id uuid,contract_id uuid,measurement_id uuid,status text);`);
 const source=fs.readFileSync('supabase/migrations/20260728_0038_execution_service_contracts.sql','utf8');
 await sql(container,source.match(/create table if not exists public.execution_service_contract_audit \([\s\S]*?\n\);/)[0]);
 await sql(container,source.match(/create or replace function public.change_execution_service_contract_status\([\s\S]*?end; \$\$;/)[0]);
 await sql(container,fs.readFileSync(migration,'utf8'));
}
export async function setup(container){
 await cashSetup(container);await install(container);
 await sql(container,`alter table execution_service_contracts add supplier_id uuid,add measured_value numeric(18,2) not null default 0,add invoiced_value numeric(18,2) not null default 0,
 add finished_by uuid,add finished_at timestamptz,add cancelled_by uuid,add cancelled_at timestamptz,add cancellation_reason text,add updated_by uuid,add updated_at timestamptz;
 insert into permissions(key,module,action,description) values('execution.contracts.cancel','execution_contracts','cancel','Fixture') on conflict do nothing;
 insert into role_permissions(role_id,permission_key) select id,'execution.contracts.cancel' from roles where key='finance' on conflict do nothing;`);
}
