import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {start,sql,asUser,ids,exec} from '../financeiro/runtime.mjs';
import {setup} from './setup.mjs';
import {nativeContractFunctions} from './native.mjs';
import {lastJson} from '../finance-partials/client.mjs';
import {isCashflowScopeError} from '../../lib/finance-core/cashflow.mjs';
const root=process.env.FINANCE14_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa14-isolamento/evidencias';
const db=await start(),results=[];
const actors=Object.fromEntries([['Aadmin','A','admin',ids.ug],['Afinance','A','finance',ids.ua],['Aviewer','A','viewer',ids.ur],['Bfinance','B','finance',ids.ub],...['Aengineering','Badmin','Bviewer','Bengineering'].map(k=>[k,k[0],k.slice(1),crypto.randomUUID()])].map(([key,company,profile,id])=>[key,{id,company,profile,email:key+'@example.invalid'}]));
const run=(actor,text)=>sql(db,asUser(actor.id,text));
const numericOutput=text=>Number(text.split('\n').findLast(line=>/^-?\d+(\.\d+)?$/.test(line)));
async function check(name,fn){try{results.push({name,pass:true,actual:await fn()});}catch(e){results.push({name,pass:false,error:e.message});}}
try{
 const data=await setup(db,actors);await nativeContractFunctions(db);
 await sql(db,`insert into execution_service_contract_items(company_id,project_id,contract_id,total_value) values('${data.A.company}','${data.A.project}','${data.A.contract}',30000),('${data.B.company}','${data.B.project}','${data.B.contract}',90000);
 insert into execution_service_contract_amendments(company_id,project_id,contract_id,value_change) values('${data.B.company}','${data.B.project}','${data.B.contract}',10000)`);
 const migration=fs.readFileSync('supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql','utf8');await sql(db,migration);
 await check('migracao_repetida_nao_duplica_guard',async()=>{
  const definition=()=>sql(db,"select jsonb_object_agg(proname,prosrc) from pg_proc where oid in('refresh_execution_service_contract_value(uuid)'::regprocedure,'refresh_execution_service_contract_measurements(uuid)'::regprocedure)").then(lastJson);
  const before=await definition();await sql(db,migration);assert.deepEqual(await definition(),before);return {idempotent:true};
 });
 await check('permissoes_EXECUTE_sem_public_ou_anon',async()=>{
  const actual=lastJson(await sql(db,"select jsonb_agg(jsonb_build_object('function',p.proname,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p where p.oid in('refresh_execution_service_contract_value(uuid)'::regprocedure,'refresh_execution_service_contract_measurements(uuid)'::regprocedure)"));
  assert.ok(actual.every(r=>!r.anon_execute&&r.authenticated_execute&&r.service_execute));return actual;
 });
 await check('financeiro_e_engenharia_legitimos_na_propria_empresa',async()=>{
  assert.equal(numericOutput(await run(actors.Afinance,`select refresh_execution_service_contract_value('${data.A.contract}')`)),30000);
  assert.equal(numericOutput(await run(actors.Aengineering,`select refresh_execution_service_contract_value('${data.A.contract}')`)),30000);
  assert.equal(numericOutput(await run(actors.Bfinance,`select refresh_execution_service_contract_value('${data.B.contract}')`)),100000);return {A:30000,B:100000};
 });
 await check('membro_desativado_perde_acesso_mesmo_com_identidade',async()=>{
  await sql(db,`update company_memberships set status='suspended' where user_id='${actors.Afinance.id}'`);
  try{await assert.rejects(()=>run(actors.Afinance,`select refresh_execution_service_contract_value('${data.A.contract}')`),/Contrato indisponível ou sem autorização/);}finally{await sql(db,`update company_memberships set status='active' where user_id='${actors.Afinance.id}'`);}return {denied:true};
 });
 await check('perfil_desativado_perde_acesso',async()=>{
  await sql(db,`update roles set status='inactive' where company_id='${data.A.company}' and key='finance'`);
  try{await assert.rejects(()=>run(actors.Afinance,`select refresh_execution_service_contract_value('${data.A.contract}')`),/Contrato indisponível ou sem autorização/);}finally{await sql(db,`update roles set status='active' where company_id='${data.A.company}' and key='finance'`);}return {denied:true};
 });
 await check('sem_sub_autenticado_nao_e_autorizado',async()=>{await assert.rejects(()=>sql(db,`begin;set local role authenticated;select refresh_execution_service_contract_value('${data.A.contract}');commit`),/Contrato indisponível ou sem autorização/);return {denied:true};});
 await check('worker_privilegiado_preservado_sem_chave_no_browser',async()=>{const value=await sql(db,`begin;set local role service_role;select refresh_execution_service_contract_value('${data.A.contract}');commit`);assert.ok(value.split('\n').includes('30000'));return {trusted_service_context:true,A:30000,note:'Papel SQL privilegiado local; não é execução do worker remoto.'};});
 await check('erros_de_banco_nao_viram_negacao_ou_zero',async()=>{for(const message of ['Entidade indisponível','Obra incompatível com a entidade','Entidade sem autorização de leitura financeira','Versão fora do perímetro'])assert.equal(isCashflowScopeError(new Error(message)),true);assert.equal(isCashflowScopeError(new Error('Banco indisponível')),false);assert.equal(isCashflowScopeError(null),false);return {only_known_scope_errors:true};});
}finally{await exec('docker',['rm','-f',db]);fs.writeFileSync(root+'/guards.json',JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,network:'none',container_removed:true,auth_layer:'SQL roles/claims; supplementary to real Auth HTTP tests'},null,2)+'\n');if(results.some(r=>!r.pass))process.exitCode=1;console.log(JSON.stringify(results));}
