import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {stack} from '../finance-isolation/stack.mjs';
import {sql,asUser} from '../financeiro/runtime.mjs';
import {lastJson,json} from '../finance-partials/client.mjs';
import {setup} from './setup.mjs';

const root='docs/financeiro/implementacao-v1/etapa14c-correcao-rpcs/evidencias';
fs.mkdirSync(root,{recursive:true});
const migration='supabase/migrations/20261025120000_financial_refresh_internal_authorization.sql';
const save=(f,v)=>fs.writeFileSync(root+'/'+f,JSON.stringify(v,null,2)+'\n');
const services=await stack(root),checks=[],baseline=[];
let fatal=null,removed=false;
const check=async(name,fn)=>{try{checks.push({name,passed:true,actual:await fn()});}catch(e){checks.push({name,passed:false,error:services.redact(e.message)});}};
try{
 const data=await setup(services.db,services.actors),http=await services.startHTTP();
 const {db,actors}=services;
 const rpc=async(actor,name,args)=>{
  const r=await fetch(http.restURL+'/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(actor?actor.session.access_token:http.anonKey),apikey:http.anonKey},body:JSON.stringify(args)});
  return {status:r.status,body:await r.json().catch(()=>null)};
 };
 const state=()=>sql(db,`select jsonb_build_object('contract',(select to_jsonb(c) from execution_service_contracts c where id='${data.B.contract}'),'measurement',(select to_jsonb(m) from execution_contract_measurements m where id='${data.measurement}'),'order',(select to_jsonb(w) from execution_work_orders w where id='${data.order}'),'events',(select count(*) from finance_settlement_events),'movements',(select count(*) from finance_bank_transactions))`).then(lastJson);
 const definitions=()=>sql(db,"select jsonb_object_agg(proname,prosrc) from pg_proc where oid in('refresh_execution_service_contract_value(uuid)'::regprocedure,'refresh_execution_service_contract_measurements(uuid)'::regprocedure,'refresh_execution_work_order_values(uuid)'::regprocedure)").then(lastJson);
 const native=await definitions();
 for(const [name,arg,id] of [['refresh_execution_service_contract_value','p_contract_id',data.B.contract],['refresh_execution_service_contract_measurements','p_contract_id',data.B.contract],['refresh_execution_work_order_values','p_work_order_id',data.order]]){
  for(const actor of [null,actors.Afinance]){
   const before=await state(),actual=await rpc(actor,name,{[arg]:id}),after=await state();
   assert.ok(actual.status>=200&&actual.status<300,'Native vulnerability must reproduce');
   baseline.push({function:name,identity:actor?{id:actor.id,company:actor.company,profile:actor.profile}:null,actual,before,after,environment:'ISOLADO FICTÍCIO'});
  }
 }
 save('vulnerabilidades-antes.json',baseline);
 for(const f of ['20261025100000_contract_refresh_tenant_guards.sql','20261025110000_work_order_financial_tenant_guard.sql'])await sql(db,fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await check('dependencia_comprovada_guard14_bloqueia_aprovador_minimo',async()=>{
  await assert.rejects(()=>sql(db,asUser(actors.Bengineering.id,`select validation.measurements('${data.B.contract}')`)),/Contrato indisponível ou sem autorização/);
  return {permission:'execution.measurements.approve',contract_view:false,old_guard_denied:true};
 });
 await sql(db,fs.readFileSync(migration,'utf8'));
 const after=await definitions();
 await check('formulas_nativas_das_tres_funcoes_preservadas',async()=>{
  const sha=s=>crypto.createHash('sha256').update(s).digest('hex');const result={};
  for(const [name,body] of Object.entries(after)){
   const financial=body.replace(/\n-- E14C_AUTHORIZATION_BEGIN[\s\S]*?-- E14C_AUTHORIZATION_END\n/,'');
   assert.equal(financial,native[name]);result[name]={native_sha256:sha(native[name]),financial_sha256:sha(financial)};
  }save('formulas-preservadas.json',result);return result;
 });
 await check('reaplicacao_idempotente',async()=>{await sql(db,fs.readFileSync(migration,'utf8'));assert.deepEqual(await definitions(),after);return true;});
 for(const [name,arg,id] of [['refresh_execution_service_contract_value','p_contract_id',data.B.contract],['refresh_execution_service_contract_measurements','p_contract_id',data.B.contract],['refresh_execution_work_order_values','p_work_order_id',data.order]]){
  for(const [key,actor] of [['anon',null],['foreign',actors.Afinance],['viewer',actors.Bviewer],['admin_direct',actors.Badmin]]){
   await check(name+'-'+key+'-RPC_direta_negada',async()=>{
    const before=await state(),r=await rpc(actor,name,{[arg]:id});assert.ok(r.status>=400&&r.status<500,JSON.stringify(r));assert.deepEqual(await state(),before);
    return {identity:actor?{id:actor.id,company:actor.company,profile:actor.profile}:null,requested_id:id,...r,values_unchanged:true};
   });
  }
 }
 for(const [fn,id] of [['contract_value',data.B.contract],['measurements',data.B.contract],['order_values',data.order]]){
  await check(fn+'-chamador_definer_nao_contorna_empresa_ou_permissao',async()=>{
   const before=await state();
   for(const actor of [actors.Aadmin,actors.Afinance,actors.Bviewer])await assert.rejects(()=>sql(db,asUser(actor.id,`select validation.${fn}('${id}')`)),/Registro indisponível ou sem autorização/);
   await assert.rejects(()=>sql(db,`begin;set local role anon;select validation.${fn}('${id}');commit`),/Registro indisponível ou sem autorização/);
   assert.deepEqual(await state(),before);return {foreign_admin_denied:true,viewer_denied:true,anonymous_denied:true,values_unchanged:true};
  });
 }
 await check('contrato_ativacao_nativa_autorizada_preservada',async()=>{
  await sql(db,`update execution_service_contracts set status='draft',current_value=90000 where id='${data.B.contract}'`);
  const r=await rpc(actors.Badmin,'activate_execution_service_contract',{p_company_id:data.B.company,p_project_id:data.B.project,p_contract_id:data.B.contract});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body,'active');assert.equal((await state()).contract.current_value,100000);return {response:r,expected:100000,actual:(await state()).contract.current_value};
 });
 await check('medicao_aprovacao_nativa_com_permissao_minima_preservada',async()=>{
  await sql(db,`update execution_contract_measurements set status='submitted' where id='${data.measurement}'`);
  const r=await rpc(actors.Bengineering,'approve_execution_contract_measurement',{p_company_id:data.B.company,p_project_id:data.B.project,p_measurement_id:data.measurement,p_notes:'Aprovação fictícia14C'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body,'approved');const s=await state();assert.equal(s.contract.measured_value,20000);assert.equal(s.contract.retained_value,2000);return {response:r,expected:[20000,2000],actual:[s.contract.measured_value,s.contract.retained_value],no_contract_read_permission_granted:true};
 });
 await check('OS_progresso_nativo_autorizado_preservado',async()=>{
  const r=await rpc(actors.Badmin,'update_execution_work_order_progress',{p_company_id:data.B.company,p_project_id:data.B.project,p_work_order_id:data.order,p_items:[{work_order_item_id:data.order_item,executed_quantity:8}],p_notes:'Progresso fictício14C'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body,8000);const s=(await state()).order;assert.deepEqual([s.authorized_value,s.executed_value,s.accepted_value,s.measured_value],[20000,8000,7000,6000]);return {response:r,expected:[20000,8000,7000,6000],actual:[s.authorized_value,s.executed_value,s.accepted_value,s.measured_value]};
 });
 await check('RPCs_operacionais_negam_viewer_e_empresa_estrangeira',async()=>{
  const before=await state();
  for(const actor of [actors.Aadmin,actors.Bviewer]){
   const r=await rpc(actor,'approve_execution_contract_measurement',{p_company_id:data.B.company,p_project_id:data.B.project,p_measurement_id:data.measurement,p_notes:'Indevido'});assert.ok(r.status>=400&&r.status<500,JSON.stringify(r));
  }assert.deepEqual(await state(),before);return {denied:true,values_unchanged:true};
 });
 await check('trigger_nativo_de_pagamento_preservado_sem_permissao_contratual_de_escrita',async()=>{
  const title=crypto.randomUUID(),key=crypto.randomUUID();
  await sql(db,`update execution_contract_measurements set status='invoiced',payable_id='${title}' where id='${data.measurement}'`);
  await sql(db,asUser(actors.Bfinance.id,`select set_config('finance.reason','Título fictício14C',true);select set_config('finance.effective_date','2026-10-20',true);insert into payables(id,company_id,project_id,supplier_id,document,amount,due_date,status,origin,source_system,source_id,created_by) values('${title}','${data.B.company}','${data.B.project}','${data.B.supplier}','FAKE14C',18000,'2026-10-20','open','manual','elos_os','measurement:${data.measurement}',auth.uid());select settle_finance_titles('${data.B.company}','${key}','${data.B.account}','2026-10-20',${json([{type:'AP',title_id:title,principal:18000}])},'Pagamento fictício14C');`));
  const s=await state();assert.equal(s.measurement.status,'paid');assert.equal(s.contract.paid_value,18000);assert.equal(s.contract.retained_value,2000);return {expected_paid:18000,actual_paid:s.contract.paid_value,expected_retained:2000,actual_retained:s.contract.retained_value,through:'settle_finance_titles → native payables trigger → helper'};
 });
 await check('membership_suspensa_e_perfil_inativo_negados_no_helper',async()=>{
  for(const command of ["update company_memberships set status='suspended' where user_id='"+actors.Bengineering.id+"'","update roles set status='inactive' where key='isolated_measurement_approver'"]){
   await sql(db,command);await assert.rejects(()=>sql(db,asUser(actors.Bengineering.id,`select validation.measurements('${data.B.contract}')`)),/Registro indisponível ou sem autorização/);
   await sql(db,`update company_memberships set status='active' where user_id='${actors.Bengineering.id}';update roles set status='active' where key='isolated_measurement_approver'`);
  }return {denied:true};
 });
 await check('sessao_sem_identidade_negada_em_chamada_interna',async()=>{await assert.rejects(()=>sql(db,`begin;set local role authenticated;select validation.measurements('${data.B.contract}');commit`),/Registro indisponível ou sem autorização/);return {denied:true};});
 await check('servico_e_sessao_do_proprietario_preservados',async()=>{
  for(const context of ['set local role service_role;',''])await sql(db,`begin;${context}select refresh_execution_service_contract_value('${data.B.contract}');select refresh_execution_service_contract_measurements('${data.B.contract}');select refresh_execution_work_order_values('${data.order}');commit`);
  return {trusted_service_role:true,direct_owner:true,financial_result:(await state()).contract.current_value};
 });
 await check('ACL_remove_PUBLIC_anon_authenticated_e_grant_customizado',async()=>{
  const actual=lastJson(await sql(db,"select jsonb_agg(jsonb_build_object('function',p.proname,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'custom',has_function_privilege('e14c_custom_grantee',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p where p.proname in('refresh_execution_service_contract_value','refresh_execution_service_contract_measurements','refresh_execution_work_order_values')"));
  assert.equal(actual.length,3);assert.ok(actual.every(r=>!r.anon&&!r.authenticated&&!r.custom&&r.service));save('ACL.json',actual);return actual;
 });
 await check('drift_financeiro_aborta_migracao_sem_alteracao_parcial',async()=>{
  const defs=await definitions();await sql(db,"alter function refresh_execution_work_order_values(uuid) rename to e14c_temporarily_absent");
  await assert.rejects(()=>sql(db,fs.readFileSync(migration,'utf8')),/inesperados/);
  await sql(db,"alter function e14c_temporarily_absent(uuid) rename to refresh_execution_work_order_values");assert.deepEqual(await definitions(),defs);
  return {missing_target_aborts_transaction:true,previous_targets_unchanged:true};
 });
 await check('corpo_desconhecido_nao_e_sobrescrito',async()=>{
  const {ddl}=lastJson(await sql(db,"select jsonb_build_object('ddl',pg_get_functiondef('refresh_execution_work_order_values(uuid)'::regprocedure))"));
  try{
   await sql(db,ddl.replace('updated_at=now()','updated_at=clock_timestamp()'));
   const changed=await definitions();await assert.rejects(()=>sql(db,fs.readFileSync(migration,'utf8')),/Corpo financeiro divergente/);
   assert.deepEqual(await definitions(),changed);
  }finally{await sql(db,ddl);}
  return {unknown_body_rejected:true,no_formula_overwritten:true};
 });
 await check('proprietario_distinto_do_chamador_exige_revisao',async()=>{
  try{
   await sql(db,'alter function validation.order_values(uuid) owner to e14c_custom_grantee');
   await assert.rejects(()=>sql(db,fs.readFileSync(migration,'utf8')),/Chamador com proprietário distinto/);
  }finally{await sql(db,'alter function validation.order_values(uuid) owner to postgres');}
  return {unexpected_owner_rejected:true};
 });
 await check('heranca_de_papel_privilegiado_exige_revisao',async()=>{
  try{
   await sql(db,'alter role authenticated noinherit;grant service_role to authenticated');
   await assert.rejects(()=>sql(db,fs.readFileSync(migration,'utf8')),/Herança privilegiada inesperada/);
  }finally{await sql(db,'revoke service_role from authenticated;alter role authenticated inherit');}
  return {privileged_membership_rejected_even_with_noinherit:true};
 });
 await check('sobrecarga_desconhecida_exige_revisao',async()=>{
  try{
   await sql(db,'create function public.refresh_execution_service_contract_value(text) returns numeric language sql as $$select 0::numeric$$');
   await assert.rejects(()=>sql(db,fs.readFileSync(migration,'utf8')),/Sobrecarga inesperada/);
  }finally{await sql(db,'drop function public.refresh_execution_service_contract_value(text)');}
  return {unknown_overload_rejected:true};
 });
 await check('onze_capacidades_minimas_dos_chamadores_preservadas',async()=>{
  const actual=[];
  const capabilities=[['contract_value',data.B.contract,['execution.contracts.manage','execution.contracts.approve','execution.contracts.amend','execution.contract_procurement.contract']],['measurements',data.B.contract,['execution.measurements.approve','execution.measurements.finance','execution.measurements.reverse','payables.manage']],['order_values',data.order,['execution.work_orders.manage','execution.work_orders.progress','execution.work_orders.accept']]];
  const role="(select id from roles where company_id='"+data.B.company+"' and key='isolated_measurement_approver')";
  try{
   for(const [fn,id,permissions] of capabilities)for(const permission of permissions){
    await sql(db,`insert into permissions(key,module,action,description) values('${permission}','validation','test','Capacidade existente em papel fictício mínimo') on conflict do nothing;delete from role_permissions where role_id=${role};insert into role_permissions(role_id,permission_key) values(${role},'${permission}')`);
    await sql(db,asUser(actors.Bengineering.id,`select validation.${fn}('${id}')`));actual.push({permission,helper:fn,allowed:true});
   }
  }finally{await sql(db,`delete from role_permissions where role_id=${role};insert into role_permissions(role_id,permission_key) values(${role},'execution.measurements.approve')`);}
  assert.equal(actual.length,11);return actual;
 });
 save('estado-final.json',await state());
}catch(e){fatal=services.redact(e.stack);process.exitCode=1;}
finally{
 await services.close();removed=true;
 save('resultado.json',{executed_at:new Date().toISOString(),environment:'ISOLADO FICTÍCIO Horizonte/Atlântico',network:'Docker internal; sem portas publicadas; gateway localhost',images:services.images,passed:checks.filter(r=>r.passed).length,failed:checks.filter(r=>!r.passed).length,fatal_error:fatal,resources_removed:removed,production_calls:0,koper_calls:0,checks});
 if(checks.some(r=>!r.passed))process.exitCode=1;
 console.log(JSON.stringify({passed:checks.filter(r=>r.passed).length,failed:checks.filter(r=>!r.passed).length,fatal_error:fatal}));
}
