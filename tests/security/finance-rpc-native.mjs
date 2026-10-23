// Execute with DOCKER_HOST=unix:///var/run/docker.sock. Outputs contain fake data only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {start,native,exec,sql,lastJSON,j,q,migrations,image} from './finance-rpc-runtime.mjs';
import {fixture,users,generateArgs,sqlArgs} from './finance-rpc-fixture.mjs';
const patch='supabase/migrations/20261023180000_financial_rpc_p0_isolation.sql';
const out=path.resolve(process.env.RPC_P0_EVIDENCE_DIR??'/tmp/elos-rpc-p0-evidence');fs.mkdirSync(out,{recursive:true});
const db=await start(),checks=[],baseline=[];let data,rest,network,secretFile,restURL,fatal=null;
const secret=crypto.randomBytes(48).toString('hex');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=(uid,role='authenticated')=>{
 const input=[{alg:'HS256',typ:'JWT'},{role,sub:uid,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 return input+'.'+crypto.createHmac('sha256',secret).update(input).digest('base64url');
};
const record=async(name,fn)=>{try{checks.push({name,passed:true,actual:await fn()});}catch(e){checks.push({name,passed:false,error:e.message.replaceAll(secret,'[test-secret]')});}};
const targets=[['refresh_execution_service_contract_value','p_contract_id',()=>data.B.base.contract],['refresh_execution_service_contract_measurements','p_contract_id',()=>data.B.base.contract],['refresh_execution_work_order_values','p_work_order_id',()=>data.B.order]];
const defs=()=>sql(db,"select jsonb_object_agg(proname,jsonb_build_object('body',prosrc,'definer',prosecdef,'config',proconfig,'owner',pg_get_userbyid(proowner))) from pg_proc where oid in('public.refresh_execution_service_contract_value(uuid)'::regprocedure,'public.refresh_execution_service_contract_measurements(uuid)'::regprocedure,'public.refresh_execution_work_order_values(uuid)'::regprocedure)").then(lastJSON);
const state=()=>sql(db,`select jsonb_build_object('contract',(select to_jsonb(c) from execution_service_contracts c where id='${data.B.base.contract}'),'measurement',(select to_jsonb(m) from execution_contract_measurements m where id='${data.B.measurement}'),'order',(select to_jsonb(w) from execution_work_orders w where id='${data.B.order}'),'payables',(select jsonb_agg(to_jsonb(p) order by id) from payables p),'transactions',(select jsonb_agg(to_jsonb(t) order by id) from finance_bank_transactions t),'audit_rows',(select count(*) from security_audit_log))`).then(lastJSON);
const owner=query=>sql(db,query,{user:'postgres'});
const as=async(uid,query,{prepare='',cleanup=''}={})=>{
 const old=prepare?await state():null;
 try{
  if(prepare)await owner(prepare);
  return await sql(db,`begin;set local role authenticated;select set_config('request.jwt.claims',${j({sub:uid,role:'authenticated'})}::text,true);${query};rollback;`,{user:'authenticator'});
 }finally{
  if(cleanup)await owner(cleanup);
  if(old)await owner(`update execution_contract_measurements set status=${q(old.measurement.status)},payable_id=${old.measurement.payable_id?q(old.measurement.payable_id)+'::uuid':'null'} where id='${data.B.measurement}';update execution_work_orders set status=${q(old.order.status)} where id='${data.B.order}';`);
 }
};
const rpc=async(uid,name,args,role='authenticated',jwt=null)=>{
 const r=await fetch(restURL+'/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+(jwt??token(uid,role)),'Content-Type':'application/json'},body:JSON.stringify(args)});
 return {status:r.status,body:await r.json().catch(()=>null)};
};
async function http(){
 network='elos-rpc-p0-'+process.pid+'-net';rest='elos-rpc-p0-'+process.pid+'-rest';
 await exec('docker',['network','create','--internal',network]);await exec('docker',['network','disconnect','none',db]);await exec('docker',['network','connect','--alias','db',network,db]);
 secretFile=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'elos-p0-')),'rest.env');
 fs.writeFileSync(secretFile,`PGRST_DB_URI=postgres://authenticator@db:5432/e14e_native\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${secret}\n`,{mode:0o600});
 await exec('docker',['run','-d','--name',rest,'--network',network,'--env-file',secretFile,'postgrest/postgrest@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228']);
 const {stdout}=await exec('docker',['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',rest]);restURL='http://'+stdout.trim()+':3000';
 for(let i=0;;i++){try{if((await fetch(restURL,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}if(i>100)throw Error('Local PostgREST unavailable');await new Promise(r=>setTimeout(r,100));}
}
try{
 await native(db);data=await fixture(db);const before=await defs();
 // Prove the native bug with real unprivileged session identity, then roll back.
 for(const [name,,id] of targets){
  const actual=await sql(db,`begin;set local role anon;select public.${name}('${id()}');select jsonb_build_object('current_user',current_user,'session_user',session_user);rollback;`,{user:'authenticator'});
  baseline.push({function:name,layer:'Native SQL session/authenticator/anon, rolled back',unauthorized_native_execution_succeeded:true,identity:lastJSON(actual)});
 }
 const snapshot=await state();await sql(db,fs.readFileSync(patch,'utf8'));
 await record('standalone_native_structure_no_experimental_migrations',async()=>{
  assert.deepEqual(await state(),snapshot);return {native_DDL_sources:migrations.length,business_scaffolds:0,security_migrations_applied:[patch],financial_rows_unchanged:true};
 });
 const patched=await defs();
 await record('three_financial_bodies_identical_and_invoker_search_path',async()=>{
  const result={};for(const [name,f] of Object.entries(patched)){
   const clean=f.body.replace(/\n-- E14E_BEGIN[\s\S]*?-- E14E_END\n/,'');assert.equal(clean,before[name].body);assert.equal(f.definer,false);assert.deepEqual(f.config,['search_path=pg_catalog, pg_temp']);
   result[name]={before_sha256:sha(before[name].body),financial_after_sha256:sha(clean),definer:f.definer,config:f.config};
  }return result;
 });
 await record('reapplication_safe',async()=>{await sql(db,fs.readFileSync(patch,'utf8'));assert.deepEqual(await defs(),patched);assert.deepEqual(await state(),snapshot);return {identical:true};});
 await record('ACL_effective_and_native_owner_not_superuser',async()=>{
  const actual=lastJSON(await sql(db,"select jsonb_agg(jsonb_build_object('function',p.proname,'owner_superuser',r.rolsuper,'owner_bypassrls',r.rolbypassrls,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_roles r on r.oid=p.proowner where p.proname in('refresh_execution_service_contract_value','refresh_execution_service_contract_measurements','refresh_execution_work_order_values')"));
  assert.equal(actual.length,3);assert.ok(actual.every(x=>!x.anon&&!x.authenticated&&x.service&&!x.owner_superuser&&x.owner_bypassrls));return actual;
 });
 await owner(`create schema p0_probe;grant usage on schema p0_probe to anon,authenticated;
  create function p0_probe.call_helper(p_kind text,p_id uuid) returns void language plpgsql security definer set search_path=public as $$begin
   if p_kind='value' then perform public.refresh_execution_service_contract_value(p_id);
   elsif p_kind='measurement' then perform public.refresh_execution_service_contract_measurements(p_id);
   else perform public.refresh_execution_work_order_values(p_id);end if;end$$;
  create function p0_probe.escalate_role() returns void language plpgsql security definer as $$begin perform set_config('role','service_role',true);end$$;`);
 await owner(`create function p0_probe.old14c_authorizes(p_id uuid) returns boolean language plpgsql security definer set search_path=public as $$begin
  return current_setting('role',true)='service_role'
   or (current_setting('role',true)='none' and session_user=current_user)
   or (auth.uid() is not null and exists(select 1 from public.execution_service_contracts c where c.id=p_id
    and public.is_company_member(c.company_id) and (public.has_company_permission(c.company_id,'execution.contracts.manage')
      or public.has_company_permission(c.company_id,'execution.contracts.approve') or public.has_company_permission(c.company_id,'execution.contracts.amend')
      or public.has_company_permission(c.company_id,'execution.contract_procurement.contract'))));end$$;`);
 await sql(db,'create role p0_sql_client login;grant authenticated to p0_sql_client');
 await http();
 for(const [name,arg,id] of targets)for(const [label,uid,role] of [['anon',null,'anon'],['foreign',users.Aadmin,'authenticated'],['viewer',users.Bviewer,'authenticated'],['own_admin_direct',users.Badmin,'authenticated']]){
  await record(name+'-HTTP-'+label,async()=>{const old=await state(),r=await rpc(uid,name,{[arg]:id()},role);assert.ok(r.status>=400&&r.status<500,JSON.stringify(r));assert.deepEqual(await state(),old);return {user:uid,role,requested_id:id(),...r,unchanged:true};});
 }
 for(const [kind,id] of [['value',data.B.base.contract],['measurement',data.B.base.contract],['order',data.B.order]]){
  await record('definer_does_not_bypass_tenant_or_permission-'+kind,async()=>{
   const old=await state();for(const uid of [users.Aadmin,users.Afinance,users.Bviewer])await assert.rejects(()=>as(uid,`select p0_probe.call_helper('${kind}','${id}')`),/sem autorização/);
   assert.deepEqual(await state(),old);return {foreign_and_viewer_denied:true,unchanged:true};
  });
 }
 await record('mutable_claim_role_does_not_grant_service_bypass',async()=>{
  await assert.rejects(()=>as(users.Aadmin,`select set_config('request.jwt.claim.role','service_role',true);select p0_probe.call_helper('value','${data.B.base.contract}')`),/sem autorização/);return {denied:true};
 });
 await record('inconsistent_legacy_subject_rejected',async()=>{
  const old=lastJSON(await as(users.Aadmin,`select set_config('request.jwt.claim.sub','${users.Badmin}',true);select jsonb_build_object('old_guard_accepts',p0_probe.old14c_authorizes('${data.B.base.contract}'))`));
  assert.equal(old.old_guard_accepts,true);
  await assert.rejects(()=>as(users.Aadmin,`select set_config('request.jwt.claim.sub','${users.Badmin}',true);select p0_probe.call_helper('value','${data.B.base.contract}')`),/sem autorização/);return {original_JWT_subject:users.Aadmin,forged_legacy_subject:users.Badmin,old_14c_decision_accepts:old.old_guard_accepts,new_guard_denied:true,limit:'Controlled SQL probe; no public claim-setter endpoint or 14C exploitation demonstrated.'};
 });
 await record('role_and_session_identity_escalation_rejected',async()=>{
  await assert.rejects(()=>as(users.Aadmin,'select p0_probe.escalate_role()'),/cannot set parameter "role" within security-definer function/);
  await assert.rejects(()=>sql(db,"set role authenticated;select set_config('role','service_role',true)",{user:'p0_sql_client'}),/permission denied/);
  await assert.rejects(()=>sql(db,"set session authorization postgres",{user:'authenticator'}),/permission denied/);
  return {actual_role_and_session_user_changes_denied:true};
 });
 await record('temporary_objects_do_not_shadow_company_or_authorization',async()=>{
  await assert.rejects(()=>as(users.Aadmin,`create temp table execution_service_contracts(id uuid,company_id uuid);insert into execution_service_contracts values('${data.B.base.contract}','${data.A.company}');create function pg_temp.has_company_permission(uuid,text) returns boolean language sql as 'select true';select p0_probe.call_helper('value','${data.B.base.contract}')`),/sem autorização/);return {denied:true};
 });
 await record('forged_JWT_signature_rejected_by_real_gateway',async()=>{
  const signed=token(users.Aadmin),parts=signed.split('.');parts[1]=Buffer.from(JSON.stringify({sub:users.Badmin,role:'service_role',exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  const r=await rpc(users.Aadmin,'refresh_execution_service_contract_value',{p_contract_id:data.B.base.contract},'authenticated',parts.join('.'));assert.equal(r.status,401);return {status:r.status};
 });
 await record('native_contract_activation',async()=>{
  const actual=lastJSON(await as(users.Badmin,`select activate_execution_service_contract('${data.B.company}','${data.B.project}','${data.B.draft.contract}');select jsonb_build_object('value',current_value,'status',status) from execution_service_contracts where id='${data.B.draft.contract}'`));
  assert.deepEqual(actual,{value:30000,status:'active'});return {expected:{value:30000,status:'active'},actual};
 });
 await record('native_measurement_approval_minimal_capability',async()=>{
  const actual=lastJSON(await as(users.Bapprover,`select jsonb_build_object('status',approve_execution_contract_measurement('${data.B.company}','${data.B.project}','${data.B.measurement}','Fictício'))`,{prepare:`update execution_contract_measurements set status='submitted',payable_id=null where id='${data.B.measurement}';`}));
  assert.deepEqual(actual,{status:'approved'});return {expected:{status:'approved'},actual,no_contract_read_privilege_added:true};
 });
 await record('native_OS_progress_minimal_capability',async()=>{
  const value=await as(users.Bprogress,`select jsonb_build_object('value',update_execution_work_order_progress('${data.B.company}','${data.B.project}','${data.B.order}',${j([{work_order_item_id:data.B.order_item,executed_quantity:8}])},'Fictício'))`);
  const actual=lastJSON(value);assert.equal(actual.value,8000);return {expected:8000,actual:actual.value};
 });
 await record('native_pay_finance_payable_trigger_helper_HTTP',async()=>{
  const r=await rpc(users.Bfinance,'pay_finance_payable',{p_company_id:data.B.company,p_project_id:data.B.project,p_payable_id:data.B.payable,p_account_id:data.B.bank,p_paid_at:'2026-10-23',p_paid_amount:18000});assert.equal(r.status,200,JSON.stringify(r));
  const s=await state();assert.equal(s.measurement.status,'paid');assert.equal(s.contract.paid_value,18000);assert.equal(s.contract.retained_value,2000);assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].amount,18000);
  const audit=lastJSON(await owner(`select jsonb_build_object('created_by',created_by,'new_status',new_values->>'status') from security_audit_log where table_name='payables' and record_id='${data.B.payable}' and action='update' order by id desc limit 1`));
  assert.deepEqual(audit,{created_by:users.Bfinance,new_status:'paid'});
  const balance=lastJSON(await as(users.Bfinance,`select jsonb_build_object('balance',finance_bank_account_balance('${data.B.bank}','2026-10-23'))`));assert.equal(balance.balance,82000);
  return {path:'pay_finance_payable → native trigger0075 → helper',expected:{paid:18000,retained:2000,bank_transactions:1},actual:{paid:s.contract.paid_value,retained:s.contract.retained_value,bank_transactions:s.transactions.length}};
 });
 await record('native_payment_foreign_or_readonly_denied',async()=>{
  const old=await state();for(const uid of [users.Afinance,users.Bviewer]){const r=await rpc(uid,'pay_finance_payable',{p_company_id:data.B.company,p_project_id:data.B.project,p_payable_id:data.B.payable,p_account_id:data.B.bank,p_paid_at:'2026-10-23',p_paid_amount:18000});assert.ok(r.status>=400&&r.status<500);}
  assert.deepEqual(await state(),old);return {denied:true,unchanged:true};
 });
 await record('native_payment_bad_cross_company_measurement_rolls_back_bank_and_title',async()=>{
  await owner(`update payables set source_system='elos_os',source_id='measurement:${data.B.measurement}' where id='${data.A.bad_payable}'`);
  const old=await state();const r=await rpc(users.Afinance,'pay_finance_payable',{p_company_id:data.A.company,p_project_id:data.A.project,p_payable_id:data.A.bad_payable,p_account_id:data.A.bank,p_paid_at:'2026-10-23',p_paid_amount:18000});assert.ok(r.status>=400&&r.status<500,JSON.stringify(r));assert.deepEqual(await state(),old);return {response:r,bank_and_title_and_measurement_unchanged:true};
 });
 await record('inactive_membership_and_role_denied',async()=>{
  for(const prepare of [`update company_memberships set status='suspended' where user_id='${users.Bfinance}';`,`update roles set status='inactive' where company_id='${data.B.company}' and key='finance';`])await assert.rejects(()=>as(users.Bfinance,`select pay_finance_payable('${data.B.company}','${data.B.project}','${data.B.bad_payable}','${data.B.bank}','2026-10-23',18000)`,{prepare,cleanup:`update company_memberships set status='active' where user_id='${users.Bfinance}';update roles set status='active' where company_id='${data.B.company}' and key='finance';`}),/Sem permissão/);
  return {denied:true};
 });
 await record('trusted_service_and_direct_native_owner',async()=>{
  const responses=[];
  for(const [name,arg,id] of targets){const r=await rpc(null,name,{[arg]:id()},'service_role');assert.equal(r.status,name==='refresh_execution_service_contract_value'?200:204,JSON.stringify(r));if(name==='refresh_execution_service_contract_value')assert.equal(r.body,100000);responses.push({function:name,status:r.status});}
  await owner(`select refresh_execution_service_contract_value('${data.B.base.contract}');select refresh_execution_service_contract_measurements('${data.B.base.contract}');select refresh_execution_work_order_values('${data.B.order}')`);return {service_HTTP_value:100000,service_HTTP:responses,native_owner_SQL_all_three:true};
 });
 // Additional native callers are tested in rolled-back transactions.
 const d=data.B;
 await record('native_contract_generation_from_competition',async()=>{
  const r=await as(users.Badmin,`select generate_execution_service_contract_from_competition(${sqlArgs(generateArgs(d))});select jsonb_build_object('value',current_value) from execution_service_contracts where source_competition_id='${d.new.competition}'`);
  assert.deepEqual(lastJSON(r),{value:100000});return {expected:100000,actual:lastJSON(r).value};
 });
 await record('native_contract_amendment',async()=>{
  const r=await as(users.Badmin,`select add_execution_service_contract_amendment('${d.company}','${d.project}','${d.base.contract}','addition','Fictício',10000,null,'Teste fictício');select jsonb_build_object('value',current_value) from execution_service_contracts where id='${d.base.contract}'`);
  assert.equal(lastJSON(r).value,110000);return {expected:110000,actual:lastJSON(r).value};
 });
 await record('native_contract_save_existing_draft',async()=>{
  const args=[d.company,d.project,d.draft.contract,d.supplier,null,'Contrato fictício','Escopo fictício','2026-01-01','2026-12-31',null,10,0,0,15,null,null,null,null,null,null,[{service_id:d.service,quantity:100,unit_price:300}]];
  const r=await as(users.Badmin,`select save_execution_service_contract(${sqlArgs(args)});select jsonb_build_object('value',current_value) from execution_service_contracts where id='${d.draft.contract}'`);
  assert.equal(lastJSON(r).value,30000);return {expected:30000,actual:lastJSON(r).value};
 });
 await record('native_contract_amendment_with_item_allocation',async()=>{
  const r=await as(users.Badmin,`select add_execution_service_contract_amendment_with_items('${d.company}','${d.project}','${d.base.contract}','addition','Fictício',10000,null,'Fictício',${j([{contract_item_id:d.base.item,value_change:10000}])});select jsonb_build_object('value',current_value) from execution_service_contracts where id='${d.base.contract}'`);
  assert.equal(lastJSON(r).value,110000);return {expected:110000,actual:lastJSON(r).value};
 });
 await record('native_measurement_to_finance',async()=>{
  const m='10000000-0000-4000-8000-000000000999';
  const prepare=`insert into execution_contract_measurements select (jsonb_populate_record(null::execution_contract_measurements,to_jsonb(x)||jsonb_build_object('id','${m}','status','approved','payable_id',null,'paid_amount',0,'paid_at',null,'sequence_no',99,'measurement_number','MED-099','period_start','2026-11-01','period_end','2026-11-20'))).* from execution_contract_measurements x where id='${d.measurement}';insert into execution_contract_measurement_items select (jsonb_populate_record(null::execution_contract_measurement_items,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid(),'measurement_id','${m}','previous_approved_quantity',20,'accumulated_quantity',40,'previous_approved_amount',20000,'accumulated_amount',40000))).* from execution_contract_measurement_items x where measurement_id='${d.measurement}';`;
  const r=await as(users.Badmin,`select send_execution_contract_measurement_to_finance('${d.company}','${d.project}','${m}','NF-FICTICIA','2026-10-23',20000,'2026-11-01',null,'Fictício');select jsonb_build_object('measured',measured_value,'invoiced',invoiced_value) from execution_service_contracts where id='${d.base.contract}'`,{prepare,cleanup:`delete from execution_contract_measurements where id='${m}';`});
  assert.deepEqual(lastJSON(r),{measured:40000,invoiced:36000});return {expected:{measured:40000,invoiced:36000},actual:lastJSON(r)};
 });
 const saveOrderArgs=[d.company,d.project,null,d.base.contract,'OS fictícia','Escopo fictício','2026-10-01','2026-10-31',null,null,null,null,null,null,[{contract_item_id:d.base.item,authorized_quantity:10}],[]];
 await record('native_OS_save_direct',async()=>{
  const r=await as(users.Badmin,`select save_execution_work_order(${sqlArgs(saveOrderArgs)});select jsonb_build_object('value',authorized_value) from execution_work_orders where work_order_number<>'OS-001' and company_id='${d.company}'`);
  assert.equal(lastJSON(r).value,10000);return {expected:10000,actual:lastJSON(r).value};
 });
 await record('native_OS_save_indirect_financial_plan',async()=>{
  const r=await as(users.Badmin,`select save_execution_work_order_with_financial_plan(${sqlArgs([...saveOrderArgs,'forecast_only',[{due_date:'2026-11-01',amount:10000}]])});select jsonb_build_object('value',authorized_value) from execution_work_orders where work_order_number<>'OS-001' and company_id='${d.company}'`);
  assert.equal(lastJSON(r).value,10000);return {expected:10000,actual:lastJSON(r).value};
 });
 await record('native_OS_acceptance_indirect_financial_wrapper',async()=>{
  const r=await as(users.Badmin,`select accept_execution_work_order_with_financial('${d.company}','${d.project}','${d.order}','approved','passed',null,'Fictício','[]');select jsonb_build_object('accepted',accepted_value,'status',status) from execution_work_orders where id='${d.order}'`,{prepare:`update execution_work_orders set status='pending_acceptance' where id='${d.order}';`});
  assert.deepEqual(lastJSON(r),{accepted:8000,status:'finished'});return {expected:{accepted:8000,status:'finished'},actual:lastJSON(r)};
 });
 await record('native_measurement_reverse',async()=>{
  const r=await as(users.Badmin,`select reverse_execution_contract_measurement('${d.company}','${d.project}','${d.measurement}','Fictício');select jsonb_build_object('measured',measured_value,'paid',paid_value) from execution_service_contracts where id='${d.base.contract}'`,{prepare:`update execution_contract_measurements set status='invoiced',payable_id=null where id='${d.measurement}';`});
  assert.deepEqual(lastJSON(r),{measured:0,paid:0});return {expected:{measured:0,paid:0},actual:lastJSON(r)};
 });
 await record('concurrent_native_payment_does_not_duplicate',async()=>{
  const a=data.A,args={p_company_id:a.company,p_project_id:a.project,p_payable_id:a.payable,p_account_id:a.bank,p_paid_at:'2026-10-23',p_paid_amount:18000};
  const responses=await Promise.all([rpc(users.Afinance,'pay_finance_payable',args),rpc(users.Afinance,'pay_finance_payable',args)]);
  assert.equal(responses.filter(r=>r.status===200).length,1);assert.ok(responses.some(r=>r.status>=400&&r.status<500));
  const count=lastJSON(await owner(`select jsonb_build_object('count',count(*),'amount',sum(amount)) from finance_bank_transactions where payable_id='${a.payable}'`));assert.deepEqual(count,{count:1,amount:18000});return {responses,expected:{count:1,amount:18000},actual:count};
 });
 await record('guard_marker_alone_is_not_trusted_on_reapplication',async()=>{
  const original=lastJSON(await sql(db,"select jsonb_build_object('ddl',pg_get_functiondef('refresh_execution_work_order_values(uuid)'::regprocedure))")).ddl;
  await sql(db,original.replace(/\n-- E14E_BEGIN[\s\S]*?-- E14E_END\n/,'\n-- E14E_BEGIN\nnull;\n-- E14E_END\n'));
  await sql(db,fs.readFileSync(patch,'utf8'));assert.deepEqual(await defs(),patched);return {altered_guard_repaired:true};
 });
 await record('unknown_financial_drift_aborts_without_partial_changes',async()=>{
  const original=lastJSON(await sql(db,"select jsonb_build_object('ddl',pg_get_functiondef('refresh_execution_work_order_values(uuid)'::regprocedure))")).ddl;
  try{
   await sql(db,original.replace('updated_at=now()','updated_at=clock_timestamp()'));
   const drift=await defs(),rows=await state();await assert.rejects(()=>sql(db,fs.readFileSync(patch,'utf8')),/Unknown financial body/);
   assert.deepEqual(await defs(),drift);assert.deepEqual(await state(),rows);
  }finally{await sql(db,original);}
  return {rejected:true,first_two_functions_and_business_rows_unchanged:true};
 });
 await record('service_table_privileges_not_silently_broadened',async()=>{
  try{
   await owner('revoke update on execution_work_orders from service_role');
   await assert.rejects(()=>sql(db,fs.readFileSync(patch,'utf8')),/technical table privileges insufficient/);
  }finally{await owner('grant update on execution_work_orders to service_role');}
  assert.deepEqual(await defs(),patched);return {missing_grant_blocks_migration:true};
 });
 await record('privileged_membership_and_extra_overload_block_migration',async()=>{
  try{
   await sql(db,'grant service_role to authenticated with inherit false');
   await assert.rejects(()=>sql(db,fs.readFileSync(patch,'utf8')),/Unsafe API role/);
  }finally{await sql(db,'revoke service_role from authenticated');}
  try{
   await owner('create function public.refresh_execution_service_contract_value(text) returns numeric language sql as $$select 0::numeric$$');
   await assert.rejects(()=>sql(db,fs.readFileSync(patch,'utf8')),/Unexpected overload/);
  }finally{await owner('drop function public.refresh_execution_service_contract_value(text)');}
  assert.deepEqual(await defs(),patched);return {noinherit_member_rejected:true,overload_rejected:true};
 });
}catch(e){fatal=e.stack?.replaceAll(secret,'[test-secret]')??String(e);process.exitCode=1;}
finally{
 if(rest)try{await exec('docker',['rm','-f',rest]);}catch{}
 await exec('docker',['rm','-f',db]);if(network)await exec('docker',['network','rm',network]);if(secretFile)fs.rmSync(path.dirname(secretFile),{recursive:true,force:true});
 const result={executed_at:new Date().toISOString(),base_commit:'460147e74be9b67c9cff2613b710a9cf0c264274',migration_sha256:sha(fs.readFileSync(patch,'utf8')),postgres_image:image,native_DDL_sources:migrations,platform_prerequisites:'auth/storage platform stubs; JWT signature/roles verified by real PostgREST. Native business tables/constraints/RLS/functions/triggers, no experimental financial schema.',native_0048_data_backfill_skipped:true,baseline,checks,passed:checks.filter(x=>x.passed).length,failed:checks.filter(x=>!x.passed).length,fatal_error:fatal,resources_removed:true,production_calls:0};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');
 if(result.failed)process.exitCode=1;console.log(JSON.stringify({passed:result.passed,failed:result.failed,fatal_error:fatal}));
}
