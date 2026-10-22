import fs from 'node:fs';
import crypto from 'node:crypto';
import {setup as previous} from '../finance-partials/setup.mjs';
import {sql,ids,asUser} from '../financeiro/runtime.mjs';
import {quote as q,json,lastJson} from '../finance-partials/client.mjs';
export async function setup(db,actors){
 await previous(db);
 const extra=Object.entries(actors).filter(([key])=>['Aengineering','Badmin','Bviewer','Bengineering'].includes(key));
 await sql(db,`insert into auth.users(id,email) values ${extra.map(([,a])=>`('${a.id}',${q(a.email)})`).join(',')};
 update companies set name=case id when '${ids.a}' then 'Construtora Horizonte' else 'Construtora Atlântico' end where id in('${ids.a}','${ids.b}');
 update projects set name=case id when '${ids.pa1}' then 'Horizonte Residencial' when '${ids.pa2}' then 'Horizonte Torre 2' else 'Atlântico Residencial' end;
 alter table execution_service_contracts add title text;
 alter table engineering_schedule_baselines add name text,add status text;
 alter table engineering_schedule_activities add name text;
 insert into roles(company_id,key,name) values('${ids.a}','admin','Administrador'),('${ids.b}','admin','Administrador'),('${ids.a}','engineering','Engenharia'),('${ids.b}','engineering','Engenharia'),('${ids.b}','viewer','Visualizador');
 delete from company_memberships where user_id='${ids.ug}';
 insert into company_memberships(company_id,user_id,role_id) select c.company,r.user_id,roles.id from (values('${ids.a}'::uuid),('${ids.b}'::uuid)) c(company)
 cross join (values ${extra.map(([,a])=>`('${a.id}'::uuid,${q(a.profile)},'${a.company==='A'?ids.a:ids.b}'::uuid)`).join(',')},('${ids.ug}'::uuid,'admin','${ids.a}'::uuid)) r(user_id,profile,company)
 join roles on roles.company_id=c.company and roles.key=r.profile where r.company=c.company;
 -- Profiles copied from the existing defaults, not grants invented to pass tests.
 insert into role_permissions(role_id,permission_key) select b.id,p.permission_key from roles b join roles a on a.company_id='${ids.a}' and a.key='viewer' join role_permissions p on p.role_id=a.id where b.company_id='${ids.b}' and b.key='viewer' on conflict do nothing;
 insert into permissions(key,module,action,description) values('execution.contracts.view','execution_contracts','view','Visualizar contratos'),('execution.contracts.manage','execution_contracts','manage','Gerenciar contratos') on conflict do nothing;
 insert into role_permissions(role_id,permission_key) select r.id,p.key from roles r cross join permissions p where r.key='engineering' and p.key in('projects.view','execution.view','execution.manage','quality.view','quality.manage','documents.view','documents.manage','execution.contracts.view','execution.contracts.manage') on conflict do nothing;
 insert into role_permissions(role_id,permission_key) select r.id,'execution.contracts.view' from roles r where r.key in('finance','viewer') on conflict do nothing;
 insert into finance_entity_permissions(company_id,legal_entity_id,user_id,can_read,can_write)
 select '${ids.b}','${ids.b1}',r.user_id,true,r.profile<>'viewer' from (values('${actors.Badmin.id}'::uuid,'admin'),('${actors.Bviewer.id}'::uuid,'viewer')) r(user_id,profile);
 -- Exact company-based native contract SELECT policy replaces the stronger
 -- engineering scaffold. This does not resolve the separate A1/A2 business question.
 drop policy fixture_scoped_read on execution_service_contracts;
 create policy execution_service_contracts_select on execution_service_contracts for select to authenticated using(public.has_company_permission(company_id,'execution.contracts.view') or public.has_company_permission(company_id,'execution.contracts.manage') or public.has_company_permission(company_id,'execution.contracts.approve'));
 create policy execution_service_contracts_write on execution_service_contracts for all to authenticated using(public.has_company_permission(company_id,'execution.contracts.manage') or public.has_company_permission(company_id,'execution.contracts.approve') or public.has_company_permission(company_id,'execution.contracts.amend')) with check(public.has_company_permission(company_id,'execution.contracts.manage') or public.has_company_permission(company_id,'execution.contracts.approve') or public.has_company_permission(company_id,'execution.contracts.amend'));
 grant select,insert,update,delete on execution_service_contracts to authenticated;`);
 const data={};
 for(const company of ['A','B']){
  const s={company:company==='A'?ids.a:ids.b,entity:company==='A'?ids.a1:ids.b1,project:company==='A'?ids.pa1:ids.pb1,account:company==='A'?ids.bank1:ids.bankb,supplier:company==='A'?ids.sa:ids.sb,sale:company==='A'?ids.sale1:ids.saleb,client:company==='A'?ids.ca:ids.cb,unit:company==='A'?ids.u1:ids.ub1};
  s.contract=crypto.randomUUID();s.ap=crypto.randomUUID();s.ar=crypto.randomUUID();
  const actor=actors[company+'finance'].id,ap=company==='A'?10000:90000,ar=company==='A'?5000:45000;
  await sql(db,`insert into execution_service_contracts(id,company_id,project_id,supplier_id,title,status,current_value) values('${s.contract}','${s.company}','${s.project}','${s.supplier}',${q(company+' CONTRATO PRIVADO')},'active',${company==='A'?30000:90000});`);
  await sql(db,asUser(actor,`select set_config('finance.reason','Documentos inteiramente fictícios da Etapa14',true);select set_config('finance.effective_date','2026-10-01',true);
   insert into payables(id,company_id,project_id,supplier_id,document,amount,due_date,created_by) values('${s.ap}','${s.company}','${s.project}','${s.supplier}',${q(company+'-AP-PRIVADO')},${ap},'2026-10-30',auth.uid());
   insert into receivables(id,company_id,project_id,sale_id,client_id,unit_id,category,description,amount,due_date,created_by) values('${s.ar}','${s.company}','${s.project}','${s.sale}','${s.client}','${s.unit}','monthly',${q(company+'-AR-PRIVADO')},${ar},'2026-10-30',auth.uid());
   select settle_finance_titles('${s.company}','${crypto.randomUUID()}','${s.account}','2026-10-20',${json([{type:'AP',title_id:s.ap,principal:company==='A'?3000:10000}])},'Pagamento fictício isolado Etapa14');
   select settle_finance_titles('${s.company}','${crypto.randomUUID()}','${s.account}','2026-10-20',${json([{type:'AR',title_id:s.ar,principal:company==='A'?2000:5000}])},'Recebimento fictício isolado Etapa14');`));
  data[company]=s;
 }
 return data;
}
export async function storagePolicies(db){
 // Storage schema is now provided by the real Storage API migrations.
 // install_roles=false avoids recreating the existing database roles. Restore
 // the schema/object grants from Storage's native0002 install_roles block;
 // business authorization remains enforced by the original object RLS policies.
 await sql(db,`grant usage on schema storage to anon,authenticated,service_role;
 grant all on all tables in schema storage to anon,authenticated,service_role;
 grant all on all functions in schema storage to anon,authenticated,service_role;
 grant all on all sequences in schema storage to anon,authenticated,service_role;`);
 const banking=fs.readFileSync('supabase/migrations/20261013223527_finance_bank_operations.sql','utf8');
 const contract=fs.readFileSync('supabase/migrations/20260728_0038_execution_service_contracts.sql','utf8');
 const foundation=fs.readFileSync('supabase/migrations/20261021120000_financial_foundation_guards.sql','utf8');
 const statements=[];
 for(const source of [banking,foundation]){
  statements.push(...[...source.matchAll(/(?:insert into storage\.buckets[\s\S]*?;|create policy \w+ on storage\.objects\b[\s\S]*?;)/g)].map(m=>m[0]));
 }
 statements.push(contract.slice(contract.indexOf('insert into storage.buckets'),contract.indexOf('grant select,insert,update,delete')));
 await sql(db,statements.join('\n'));
 return {source_sha256:[banking,foundation,contract].map(s=>crypto.createHash('sha256').update(s).digest('hex')),statements_count:statements.length,
  buckets:lastJson(await sql(db,"select jsonb_agg(to_jsonb(b)) from storage.buckets b"))};
}
