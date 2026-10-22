// Real isolated PostgreSQL/RLS and production loaders; never a remote database.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {start,sql,asUser,ids,exec,image} from '../financeiro/runtime.mjs';
import {setup} from '../finance-partials/setup.mjs';
import {sqlClient,quote as q,json,lastJson as j} from '../finance-partials/client.mjs';
import {loadCashflow} from '../finance-partials/loaders.mjs';
const root=process.env.FINANCE13_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa13-segundo-grupo/evidencias';
fs.mkdirSync(root,{recursive:true});
const baseline=process.argv.includes('--baseline'),container=await start(),uuid=()=>crypto.randomUUID();
const fixture=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json'));
const results=[],states={},views={},records={};
const user=(text,actor=ids.ug)=>sql(container,asUser(actor,text));
const rows=(table,where='true',actor=ids.ug)=>user(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select * from ${table} where ${where}) t`,actor).then(j);
async function check(name,fn){try{results.push({name,pass:true,result:await fn()});}catch(e){results.push({name,pass:false,error:e.message});}}
const view=(company,entity,project=null,actor=ids.ug)=>loadCashflow({supabase:sqlClient(container,actor),companyId:company,entityId:entity,projectId:project,cutoff:'2026-10-21',from:'2026-10-01'});
async function title(id,company,project,supplier,amount,document){
 await sql(container,asUser(company===ids.b?ids.ub:ids.ug,`select set_config('finance.reason','Obrigação fictícia independente Etapa13',true);select set_config('finance.effective_date','2026-10-01',true);
 insert into payables(id,company_id,project_id,supplier_id,document,amount,due_date,created_by)
 values('${id}','${company}','${project}','${supplier}',${q(document)},${amount},'2026-11-10',auth.uid())`));
 // Initialize the fictitious opening through the existing ledger calculator (trusted fixture setup).
 await sql(container,`begin;select set_config('request.jwt.claim.sub','${company===ids.b?ids.ub:ids.ug}',true);select finance_private.refresh_title('${company}','AP','${id}','Abertura fictícia com ledger vazio comprovado','2026-10-01');commit;`);
}
try{
 await setup(container);
 await sql(container,'alter table execution_service_contracts add title text;');
 // UG is explicitly authorized for B in the approved fixture, not by inference.
 await sql(container,`insert into finance_entity_permissions values('${ids.b}','${ids.b1}','${ids.ug}',true,true);
 insert into permissions(key,module,action,description) values('execution.contracts.view','execution_contracts','view','Fixture') on conflict do nothing;
 insert into role_permissions(role_id,permission_key) select id,'execution.contracts.view' from roles on conflict do nothing;
 -- Restore the real native contract SELECT predicate, instead of the stronger
 -- entity scaffold from Etapa12. This exposes the actual loader perimeter gap.
 drop policy fixture_scoped_read on execution_service_contracts;
 create policy execution_service_contracts_select on execution_service_contracts for select to authenticated
 using(public.has_company_permission(company_id,'execution.contracts.view') or public.has_company_permission(company_id,'execution.contracts.manage') or public.has_company_permission(company_id,'execution.contracts.approve'));`);
 const a=uuid(),a2=uuid(),b=uuid(),ca=uuid(),ca2=uuid(),cb=uuid();
 await title(a,ids.a,ids.pa1,ids.sa,1000,'77');await title(a2,ids.a,ids.pa2,ids.sa,3000,'79');await title(b,ids.b,ids.pb1,ids.sb,9000,'77');
 await sql(container,`insert into execution_service_contracts(id,company_id,project_id,title,status,current_value) values
 ('${ca}','${ids.a}','${ids.pa1}','CT24 A1','active',1000),('${ca2}','${ids.a}','${ids.pa2}','CT24 A2','active',3000),('${cb}','${ids.b}','${ids.pb1}','CT24 B1','active',9000)`);
 await check('CT24_tres_identidades_perfis_e_perimetros',async()=>{
  const ua=await view(ids.a,ids.a1,null,ids.ua),ub=await view(ids.b,ids.b1,null,ids.ub);
  const ga1=await view(ids.a,ids.a1),ga2=await view(ids.a,ids.a2),ga=await view(ids.a,null),gb=await view(ids.b,ids.b1);
  const unauth=(await rows('payables',`id in ('${a2}','${b}')`,ids.ua)).length;
  const auditBefore=await rows('finance_title_audit');
  await assert.rejects(()=>user(`select revise_finance_payable('${ids.a}','${a}','${uuid()}',1,2000,'2026-11-10','2026-10-21','Leitor não pode alterar')`,ids.ur));
  const auditAfterReader=await rows('finance_title_audit');
  await assert.rejects(()=>user(`select revise_finance_payable('${ids.a}','${a2}','${uuid()}',1,2000,'2026-11-10','2026-10-21','Outra entidade não autorizada')`,ids.ua));
  await assert.rejects(()=>user(`select revise_finance_payable('${ids.b}','${b}','${uuid()}',1,2000,'2026-11-10','2026-10-21','Outra organização não autorizada')`,ids.ua));
  await assert.rejects(()=>view(ids.a,ids.a2,null,ids.ua));
  const auditAfter=await rows('finance_title_audit');
  assert.deepEqual(auditAfter,auditBefore,'Tentativas negadas não podem criar revisão/auditoria financeira');
  const reader=await view(ids.a,ids.a1,null,ids.ur);
  assert.equal(reader.payableBuckets.R_cents,100000);
  const total=v=>v.payableBuckets.R_cents;
  const leak=ua.contracts.filter(c=>c.project_id!==ids.pa1);
  records.CT24={scope:{company:ids.a,entity:ids.a1,project:ids.pa1},titles:await rows('payables'),a,b,a2,ua,ub,ga1,ga2,ga,gb,
   direct_contract_query_other_entity_rows:(await rows('execution_service_contracts',`project_id='${ids.pa2}'`,ids.ua)).length,
   loader_other_entity_contracts:leak};
  views.CT24=ua;
  if(!baseline){assert.equal(leak.length,0);assert.ok(ga1.contracts.every(c=>c.project_id===ids.pa1));assert.ok(ga2.contracts.every(c=>c.project_id===ids.pa2));}
  // The channels are checked separately: do not fabricate their zero counters.
  states.CT24={canonical_title_count_all_organizations:(await rows('payables')).length,UA_visible_total_cents:total(ua),UB_visible_total_cents:total(ub),UG_A1_context_total_cents:total(ga1),UG_A2_context_total_cents:total(ga2),UG_A_authorized_consolidated_total_cents:total(ga),UG_B_context_total_cents:total(gb),foreign_rows_returned_to_UA:(await rows('payables',`id='${b}'`,ids.ua)).length,restricted_same_organization_rows_returned_to_UA:(await rows('payables',`id='${a2}'`,ids.ua)).length,unauthorized_mutations_committed:auditAfter.length-auditBefore.length,UR_mutations_committed:auditAfterReader.length-auditBefore.length};
  assert.equal(unauth,0);
  return {actual:states.CT24,loader_other_entity_contracts:leak.length,direct_contract_read_gap:records.CT24.direct_contract_query_other_entity_rows};
 });
 // CT21 is a separate legal entity/work, so the three-title CT24 fixture remains exact.
 const entity=uuid(),project=uuid(),account=uuid(),contract=uuid(),t1=uuid(),t2=uuid();
 await sql(container,`insert into legal_entities(id,company_id,legal_name,cnpj) values('${entity}','${ids.a}','CT21 fictícia','99000004000137');
 insert into finance_entity_permissions values('${ids.a}','${entity}','${ids.ug}',true,true);
 insert into projects(id,company_id,legal_entity_id,name,created_by) values('${project}','${ids.a}','${entity}','CT21','${ids.ug}');
 insert into execution_service_contracts(id,company_id,project_id,title,status,current_value) values('${contract}','${ids.a}','${project}','CT21 compromisso sem vínculo','active',840000);`);
 await title(t1,ids.a,project,ids.sa,100000,'CT21-1');await title(t2,ids.a,project,ids.sa,40000,'CT21-2');
 await user(`insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,opening_balance,opening_balance_date,allow_negative)
 values('${account}','${ids.a}','${entity}','CT21','Fictício','CT21',1000000,'2026-10-01',false);
 select validate_cash_opening('${account}','${uuid()}',0,'Extrato fictício independente CT21','Abertura conhecida CT21');
 select save_cash_scenario('${ids.a}','${entity}',null,null,'${uuid()}','2026-10-21','2026-12-31',0,null,
 ${json([{scope_key:'CT21-contract',category:'C',source_kind:'contract',source_id:contract,amount_cents:84000000,expected_date:'2026-11-10'}])},
 'Previsão incompleta da fixture: P e cobertura ausentes','Registro fictício CT21','reschedule')`);
 await check('CT21_projecao_sem_cobertura_nao_e_total_certificado',async()=>{
  const v=await view(ids.a,entity);views.CT21=v;
  records.CT21={scope:{company:ids.a,entity,project},titles:await rows('payables',`project_id='${project}'`),contracts:await rows('execution_service_contracts',`project_id='${project}'`),view:v};
  if(baseline)return {projection_complete:v.projection.complete,outgoing_cents:v.projection.months.reduce((n,m)=>n+m.outgoing_cents,0),coverage:v.financialCoverage??null};
  assert.equal(v.projection.complete,false);
  states.CT21=Object.fromEntries(Object.keys(fixture.cases.find(c=>c.id==='CT21').expected).map(k=>[k,v.financialCoverage[k]]));
  assert.deepEqual(states.CT21,fixture.cases.find(c=>c.id==='CT21').expected);
  return {actual:states.CT21,projection_complete:v.projection.complete,known_rows_retained:v.future.rows.length};
 });
}finally{
 await exec('docker',['rm','-f',container]);
 const context={implementation_version:baseline?'bdf2f04 — antes da Etapa13':'Etapa13 candidata',executed_at:new Date().toISOString(),fixture_sha256:crypto.createHash('sha256').update(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).digest('hex'),environment:'PostgreSQL local Docker, network=none, dados fictícios; JWT SQL simulado, sem Auth/PostgREST real'};
 const prefix=baseline?'baseline-':'';
 fs.writeFileSync(root+'/'+prefix+'banco.json',JSON.stringify({execution_context:context,image,container_removed:true,network:'none',results,states,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length},null,2)+'\n');
 fs.writeFileSync(root+'/'+prefix+'registros.json',JSON.stringify(records,null,2)+'\n');
 fs.writeFileSync(root+'/'+prefix+'views.json',JSON.stringify(views,null,2)+'\n');
 fs.writeFileSync(root+'/'+prefix+'casos-obtidos.json',JSON.stringify({execution_context:context,cases:Object.entries(states).map(([id,actual])=>({id,status:'executado',actual,evidence:['banco.json','registros.json']}))},null,2)+'\n');
 console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
}
