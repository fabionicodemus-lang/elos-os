import fs from 'node:fs';
import crypto from 'node:crypto';
import {sql} from '../financeiro/runtime.mjs';
export async function nativeContractFunctions(db){
 // Missing engineering structures are declared as scaffolds. The two exercised
 // SECURITY DEFINER bodies are extracted verbatim from their latest definitions.
 await sql(db,`alter table execution_service_contracts add original_value numeric default 0,add amendments_value numeric default 0,add retained_value numeric default 0,add paid_value numeric default 0;
 create table execution_service_contract_items(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,contract_id uuid,measured_quantity numeric default 0,measured_value numeric default 0,total_value numeric);
 create table execution_service_contract_amendments(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,contract_id uuid,value_change numeric);
 create table execution_service_contract_stages(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,contract_id uuid,opening_measured_quantity numeric default 0,opening_measured_value numeric default 0,measured_quantity numeric default 0,measured_value numeric default 0,updated_at timestamptz);
 alter table execution_service_contract_items add updated_at timestamptz;
 alter table execution_contract_measurement_items add contract_stage_id uuid,add contract_item_id uuid,add contract_id uuid,add current_quantity numeric;
 alter table execution_contract_measurements add gross_amount numeric default 0,add contractual_retention_amount numeric default 0,add guarantee_retention_amount numeric default 0,add net_amount numeric default 0,add paid_amount numeric default 0;`);
 const definitions=[];
 for(const [file,name] of [['20260728_0038_execution_service_contracts.sql','refresh_execution_service_contract_value'],['20260801_0067_service_contract_procurement.sql','refresh_execution_service_contract_measurements']]){
  const source=fs.readFileSync('supabase/migrations/'+file,'utf8'),pattern=new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?end;? \\$\\$;');
  const body=source.match(pattern)?.[0];if(!body)throw Error('Definição nativa não localizada: '+name);
  await sql(db,body+`grant execute on function public.${name}(uuid) to authenticated;`);
  definitions.push({file,name,sha256:crypto.createHash('sha256').update(body).digest('hex')});
 }
 for(const table of ['execution_service_contract_items','execution_service_contract_amendments','execution_service_contract_stages']){
  const read=table.endsWith('_stages')?"public.has_company_permission(company_id,'execution.contract_procurement.view') or public.has_company_permission(company_id,'execution.contracts.view') or public.has_company_permission(company_id,'execution.measurements.view')":"public.has_company_permission(company_id,'execution.contracts.view') or public.has_company_permission(company_id,'execution.contracts.manage') or public.has_company_permission(company_id,'execution.contracts.approve')";
  await sql(db,`alter table ${table} enable row level security;create policy native_scaffold_read on ${table} for select to authenticated using(${read});grant select on ${table} to authenticated;`);
 }
 return definitions;
}
