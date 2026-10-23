import fs from 'node:fs';
import crypto from 'node:crypto';
import {sql} from '../financeiro/runtime.mjs';
import {setup as previous} from '../finance-isolation/setup.mjs';
import {nativeContractFunctions} from '../finance-isolation/native.mjs';

export function nativeFunction(file,name){
 const source=fs.readFileSync('supabase/migrations/'+file,'utf8');
 const start=source.indexOf('create or replace function public.'+name+'(');
 if(start<0)throw Error('Native function absent: '+name);
 const tail=source.slice(start),open=/\bas\s+(\$\w*\$)/i.exec(tail);
 const end=tail.indexOf(open[1]+';',open.index+open[0].length);
 if(end<0)throw Error('Function terminator absent: '+name);
 return tail.slice(0,end+open[1].length+1);
}
export async function setup(db,actors){
 const data=await previous(db,actors);await nativeContractFunctions(db);
 const m=crypto.randomUUID(),wo=crypto.randomUUID(),woi=crypto.randomUUID();
 await sql(db,`alter table execution_service_contracts add activated_by uuid,add activated_at timestamptz;
 alter table execution_contract_measurements add approved_by uuid,add approved_at timestamptz,add approval_notes text,add updated_by uuid,add updated_at timestamptz,add paid_at date;
 create table execution_contract_measurement_audit(id uuid default gen_random_uuid(),company_id uuid,project_id uuid,measurement_id uuid,action text,previous_status text,new_status text,reason text,details jsonb,changed_by uuid);
 create table execution_work_orders(id uuid primary key,company_id uuid,project_id uuid,status text,authorized_value numeric default 0,executed_value numeric default 0,accepted_value numeric default 0,measured_value numeric default 0,updated_at timestamptz,updated_by uuid,actual_start date,started_by uuid,started_at timestamptz,notes text);
 create table execution_work_order_items(id uuid primary key,company_id uuid,project_id uuid,work_order_id uuid,authorized_value numeric,executed_value numeric,accepted_value numeric,measured_value numeric,authorized_quantity numeric,executed_quantity numeric,unit_price numeric,service_code text,updated_at timestamptz);
 create table execution_work_order_audit(id uuid default gen_random_uuid(),company_id uuid,project_id uuid,work_order_id uuid,action text,previous_status text,new_status text,reason text,details jsonb,changed_by uuid);
 insert into execution_service_contract_items(company_id,project_id,contract_id,total_value) values('${data.B.company}','${data.B.project}','${data.B.contract}',90000);
 insert into execution_service_contract_amendments(company_id,project_id,contract_id,value_change) values('${data.B.company}','${data.B.project}','${data.B.contract}',10000);
 insert into execution_contract_measurements(id,company_id,project_id,contract_id,status,gross_amount,contractual_retention_amount,guarantee_retention_amount,net_amount,paid_amount) values('${m}','${data.B.company}','${data.B.project}','${data.B.contract}','approved',20000,2000,0,18000,0);
 insert into execution_work_orders(id,company_id,project_id,status) values('${wo}','${data.B.company}','${data.B.project}','released');
 insert into execution_work_order_items values('${woi}','${data.B.company}','${data.B.project}','${wo}',20000,8000,7000,6000,20,8,1000,'FAKE',null);
 insert into permissions(key,module,action,description) values
 ('execution.contracts.approve','execution_contracts','approve','Ativar contratos'),
 ('execution.measurements.approve','execution_measurements','approve','Aprovar medições'),
 ('execution.measurements.finance','execution_measurements','finance','Integrar medição'),
 ('execution.measurements.reverse','execution_measurements','reverse','Estornar medição'),
 ('execution.work_orders.progress','execution_work_orders','progress','Atualizar execução') on conflict do nothing;
 insert into roles(company_id,key,name) values('${data.B.company}','isolated_measurement_approver','Aprovador mínimo fictício');
 insert into role_permissions(role_id,permission_key) select id,'execution.measurements.approve' from roles where company_id='${data.B.company}' and key='isolated_measurement_approver';
 update company_memberships set role_id=(select id from roles where company_id='${data.B.company}' and key='isolated_measurement_approver') where company_id='${data.B.company}' and user_id='${actors.Bengineering.id}';
 grant select on execution_work_orders,execution_work_order_items to authenticated;
 alter table execution_work_orders enable row level security;alter table execution_work_order_items enable row level security;
 create policy fixture_order_read on execution_work_orders for select to authenticated using(is_company_member(company_id));
 create policy fixture_order_read on execution_work_order_items for select to authenticated using(is_company_member(company_id));`);
 for(const [file,name] of [
  ['20260729_0040_execution_work_orders.sql','refresh_execution_work_order_values'],
  ['20260728_0038_execution_service_contracts.sql','activate_execution_service_contract'],
  ['20261013_0092_measurement_approval_waits_invoice.sql','approve_execution_contract_measurement'],
  ['20260729_0040_execution_work_orders.sql','update_execution_work_order_progress'],
  ['20260803_0075_execution_contract_finance.sql','sync_contract_measurement_from_payable']
 ])await sql(db,nativeFunction(file,name));
 // Reproduce the literal metadata received in the independent HTML report,
 // including the CRLF body of is_company_member. No production connection.
 const audit=JSON.parse(fs.readFileSync('docs/financeiro/implementacao-v1/etapa14c-correcao-rpcs/evidencias/auditoria-recebida.json','utf8'));
 for(const item of [...audit.functions,...audit.helpers])await sql(db,item.definition+';');
 await sql(db,`create trigger sync_contract_measurement_from_payable_trigger after insert or update of status,paid_amount,paid_at on public.payables for each row execute function public.sync_contract_measurement_from_payable();
 -- Test-only bridges deliberately omit an outer guard to test defense in depth.
 -- They are not production functions and validation is not an exposed API schema.
 grant usage on schema validation to anon,authenticated;
 create function validation.contract_value(uuid) returns numeric language plpgsql security definer set search_path=public as $$begin return public.refresh_execution_service_contract_value($1);end$$;
 create function validation.measurements(uuid) returns void language plpgsql security definer set search_path=public as $$begin perform public.refresh_execution_service_contract_measurements($1);end$$;
 create function validation.order_values(uuid) returns void language plpgsql security definer set search_path=public as $$begin perform public.refresh_execution_work_order_values($1);end$$;
 create role e14c_custom_grantee;
 grant execute on function refresh_execution_service_contract_value(uuid),refresh_execution_service_contract_measurements(uuid),refresh_execution_work_order_values(uuid) to e14c_custom_grantee;`);
 return {...data,measurement:m,order:wo,order_item:woi};
}
