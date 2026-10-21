import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ts from 'typescript';
import { start, sql, exec, ids } from '../financeiro/runtime.mjs';
import { setup, migration } from './setup.mjs';
import { collectFinancialPages } from '../../lib/koper-finance/collection.mjs';
const output=process.env.KOPER_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa6-koper/evidencias';fs.mkdirSync(output,{recursive:true});
const quote=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const actor=(u,text)=>`begin;select set_config('request.jwt.claim.sub','${u}',true);select set_config('finance.reason','Massa fictícia de integração',true);${text};commit;`;
const jsonLast=s=>JSON.parse(s.split('\n').findLast(s=>s.startsWith('{')));
const results=[];const batches=[];
const container=await start();
const c=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).cases;
const row=(id,amount,extra={})=>({external_id:id,installment:'1',document_id:'DOC-'+id,document:'Documento fictício',principal_cents:amount,reported_paid_cents:0,source_status:'Pendente',due_date:'2026-10-21',effective_date:'2026-10-19',obligation_evidence:'documento-ficticio-aprovado',legal_entity_id:ids.a1,project_id:ids.pa1,supplier_id:ids.sa,...extra});
let stamp=0;
async function batch(records,extra={}){
 const data=await collectFinancialPages({fetchPage:async()=>({rows:records,raw:JSON.stringify(records),nextCursor:null}),expectedCount:records.length});
 return {...data,enterprise_id:'fixture-main',currency:'BRL',monetary_basis:'principal',extracted_at:new Date(Date.UTC(2026,9,21,12,0,stamp++)).toISOString(),period_start:'2026-01-01',period_end:'2026-10-21',cutoff:'2026-10-21',filters:{entity:'AP',status:'all'},reason:'Teste fictício aprovado; sem efeito em produção',...extra};
}
const apply=async(b,company=ids.a,user=ids.ug,command=crypto.randomUUID())=>{
 const result=jsonLast(await sql(container,actor(user,`select elos_import.apply_financial_batch('${company}','${command}',${quote(b)})`)));
 batches.push({command,company,...result});return result;
};
async function check(name,fn){try{const evidence=await fn();results.push({name,pass:true,evidence});}catch(e){results.push({name,pass:false,error:e.message});}}
try{
 await setup(container,false);
 await check('baseline: nova fotografia ignorada pela onda existente',async()=>{
  await sql(container,actor(ids.ug,`insert into payables(id,company_id,project_id,supplier_id,document,due_date,amount,status,source_system,source_id,created_by) values('20000000-0000-4000-8000-000000000001','${ids.a}','${ids.pa2}','${ids.sa}','BASE','2026-10-21',10000,'open','elos_import','baseline:77','${ids.ug}');
   select elos_import.map_put('${ids.a}','${ids.pa2}','bill_to_pay','77','payable','20000000-0000-4000-8000-000000000001','imported');
   insert into koper_staging_records(company_id,entity,koper_id,payload,payload_hash,mapping_version) values('${ids.a}','mirror.bill_to_pay_detail','77','{"_enterprise":"flow","data":{"bill_id":"77","bill_value":12000,"due_date":"2026-10-21","status":"Pendente","bill_origin":{"origin_name":"Nota fiscal eletrônica"}}}',repeat('a',64),1);
   select elos_import.wave2e_nfe_payables('${ids.a}','${ids.pa2}',null,'${ids.ug}')`));
  const amount=Number(await sql(container,`select amount*100 from payables where document='BASE'`));assert.equal(amount,1000000);return {source_cents:1200000,destination_cents:amount,difference_cents:200000};
 });
 await check('baseline: pendente redistribuído ao serviço no forecast',async()=>{
  const {stdout:source}=await exec('git',['show','494c55c:lib/forecast/server.ts']);
  const snippet=source.slice(source.indexOf('function allocateByCostAllocations('),source.indexOf('function allocatePayable('));
  const f=new Function('number',ts.transpile(snippet,{target:ts.ScriptTarget.ES2022})+';return allocateByCostAllocations;')(x=>Number(x??0));
  const result=f({id:'p',amount:1000},1000,[{service_id:'S',allocation_amount:600},{service_id:null,allocation_amount:400}],new Set());
  assert.deepEqual(result.map(r=>r.amount),[1000]);return {known_expected_cents:60000,known_before_cents:100000,unallocated_expected_cents:40000,unallocated_before_cents:0};
 });
 fs.writeFileSync(path.join(output,'baseline.json'),JSON.stringify({commit:'494c55c',results},null,2)+'\n');
 await sql(container,fs.readFileSync(migration,'utf8'));
 // Base baseline belongs to another enterprise and cannot interfere with CT01.
 const ct1=c.find(x=>x.id==='CT01');const mainRows=ct1.inputs.titles.map(t=>row(t.external_id,t.principal_cents));
 const initial=await batch(mainRows);
 await check('CT01: três importações e recorte parcial sem cancelar ausente',async()=>{
  const first=await apply(initial);assert.equal(first.accepted,2,JSON.stringify(first));
  for(let i=1;i<ct1.inputs.same_file_import_count;i++){const report=await apply(initial);assert.equal(report.unchanged,2);}
  const partial=await batch([mainRows[0]]);partial.manifest.expected_count=2;partial.manifest.complete=false;
  const report=await apply(partial);assert.equal(report.complete,false);
  const originalTargets=first.reconciliation.rows.map(r=>`'${r.target_id}'::uuid`).join(',');
  const actual=jsonLast(await sql(container,`select jsonb_build_object('canonical_title_count',count(*),'I03_open_payables_cents',sum(p.amount*100) filter(where p.status='open'),'extra_obligations_from_retries',count(*)-${ct1.inputs.titles.length},'title_78_remains_open_cents',sum(p.amount*100) filter(where p.source_id::jsonb->>2='78' and p.status='open'),'deletions_due_to_absence',(select count(*) from unnest(array[${originalTargets}]) original(id) where not exists(select 1 from payables existing where existing.id=original.id))) from payables p where p.company_id='${ids.a}' and p.source_system='koper_finance' and p.source_id::jsonb->>0='fixture-main'`));
  assert.deepEqual(actual,ct1.expected);return actual;
 });
 await check('CT26: paginação, falha, cursor repetido e retry reconciliados no banco',async()=>{
  const fixture=c.find(x=>x.id==='CT26');
  const collect=(fail=false,repeat=false)=>collectFinancialPages({expectedCount:5,fetchPage:async cursor=>{
   const i=cursor===null?0:Number(cursor);
   if(fail&&i===1)throw Error('503');
   return {raw:JSON.stringify(fixture.inputs.pages[i]),rows:fixture.inputs.pages[i].map(x=>row(x.id,x.amount_cents)),nextCursor:repeat&&i===1?'1':i===2?null:String(i+1)};
  }});
  const wrap=async(data,enterprise)=>({...await batch([],{enterprise_id:enterprise}),...data});
  const full=await apply(await wrap(await collect(),'ct26-complete'));
  const failed=await apply(await wrap(await collect(true),'ct26-retry'));
  const retry=await apply(await wrap(await collect(),'ct26-retry'));
  const repeated=await apply(await wrap(await collect(false,true),'ct26-cursor'));
  const actual={
   complete:{unique_count:full.after.objects,total_cents:full.after.operational_principal_cents,external_coverage_percent:full.source_manifest.coverage_percent},
   failed_page_2:{known_unique_count:failed.after.objects,known_subtotal_cents:failed.after.operational_principal_cents,known_loaded_coverage_percent:failed.source_manifest.coverage_percent,certified_total_cents:failed.source_manifest.certified_total_cents,complete:failed.complete},
   after_retry:{unique_count:retry.after.objects,total_cents:retry.after.operational_principal_cents,duplicate_obligations:retry.after.operational_count-retry.after.objects},
   repeated_cursor_detected:repeated.source_manifest.errors.includes('repeated_cursor')};
  assert.deepEqual(actual,fixture.expected);assert.equal(repeated.complete,false);
  const failedAfterFull=await apply(await wrap(await collect(true),'ct26-complete'));
  assert.equal(failedAfterFull.last_complete_run_id,full.run_id);
  assert.equal(await sql(container,`select count(*) from elos_import.runs where id='${failed.run_id}' and status='done'`),'0');
  return actual;
 });
 await check('mesmo comando concorrente e replay com conteúdo diferente',async()=>{
  const command=crypto.randomUUID();const pair=await Promise.all([apply(initial,ids.a,ids.ug,command),apply(initial,ids.a,ids.ug,command)]);
  assert.deepEqual(pair[0],pair[1]);await assert.rejects(()=>apply({...initial,reason:'alterado'},ids.a,ids.ug,command),/conteúdo diferente/);
  return {same_run:pair[0].run_id===pair[1].run_id};
 });
 await check('comandos diferentes concorrentes criam uma identidade e uma versão',async()=>{
  const b=await batch([row('conc',10001)],{enterprise_id:'concurrent'});
  await Promise.all([apply(b),apply(b)]);
  const actual=jsonLast(await sql(container,`select jsonb_build_object('objects',count(*),'principal_cents',sum(p.amount*100),'versions',sum(f.version)) from elos_import.financial_objects f join payables p on p.id=f.target_id where enterprise_id='concurrent'`));
  assert.deepEqual(actual,{objects:1,principal_cents:10001,versions:1});return actual;
 });
 await check('falha por registro e retry não duplicam primeira linha',async()=>{
  await sql(container,`create function validation.fail_second() returns trigger language plpgsql as $$begin if new.source_system='koper_finance' and new.source_id like '%"crash"%' and new.source_id like '%"78"%' then raise exception 'injected_failure';end if;return new;end$$;create trigger fail_second before insert on payables for each row execute function validation.fail_second();`);
  const b=await batch(mainRows,{enterprise_id:'crash'});const failed=await apply(b);assert.equal(failed.rejected,1);assert.equal(failed.after.objects,1);assert.equal(failed.complete,false);
  await sql(container,'drop trigger fail_second on payables');const retry=await apply({...b,extracted_at:'2026-10-21T15:00:00Z'});
  assert.equal(retry.after.objects,2);assert.equal(retry.after.operational_principal_cents,3000000);assert.equal(retry.unchanged,1);return {failed,retry};
 });
 await check('revisão somente do objeto correto conserva enriquecimento e histórico',async()=>{
  const revised=await batch([row('77',1200000,{change_evidence:'aditivo-ficticio',effective_date:'2026-10-20'})]);
  const report=await apply(revised);assert.equal(report.accepted,1,JSON.stringify(report));assert.equal(report.after.operational_principal_cents,3200000);
  const history=jsonLast(await sql(container,`select jsonb_build_object('before_cents',(a.previous_value->>'amount')::numeric*100,'after_cents',(a.new_value->>'amount')::numeric*100,'actor',a.actor_id,'reason',a.reason) from finance_title_audit a join elos_import.financial_objects f on f.target_id=a.title_id where f.enterprise_id='fixture-main' and f.external_id='77' order by a.version desc limit 1`));
  assert.equal(history.before_cents,1000000);assert.equal(history.after_cents,1200000);assert.equal(history.actor,ids.ug);return {report,history};
 });
 await check('mudança sem suporte não sobrescreve dívida',async()=>{
  const report=await apply(await batch([row('77',1300000)]));assert.equal(report.accepted,0);assert.equal(report.after.operational_principal_cents,3200000);assert.equal(report.complete,false);return report;
 });
 await check('parcial Paga preservado como declaração, sem quitação ou caixa inventado',async()=>{
  const report=await apply(await batch([row('77',1200000,{reported_paid_cents:400000,source_status:'Paga',change_evidence:'snapshot-ficticio'})]));
  assert.equal(report.accepted,0);assert.equal(Number(await sql(container,`select count(*) from finance_bank_transactions`)),0);
  assert.equal(await sql(container,`select p.status from payables p join elos_import.financial_objects f on f.target_id=p.id where f.enterprise_id='fixture-main' and f.external_id='77'`),'open');
  const snap=jsonLast(await sql(container,`select jsonb_build_object('principal_cents',(snapshot->>'principal_cents')::bigint,'declared_paid_cents',(snapshot->>'reported_paid_cents')::bigint,'pending',pending) from elos_import.financial_objects where enterprise_id='fixture-main' and external_id='77'`));
  assert.ok(snap.pending.includes('declared_settlement_requires_ledger'));return {report,snapshot:snap};
 });
 await check('cancelamento documental e estorno não apagam obrigação ou caixa',async()=>{
  const canceled=await apply(await batch([row('78',2000000,{source_status:'Cancelada',change_evidence:'doc-cancelado'})]));
  assert.equal(canceled.accepted,0);assert.equal(await sql(container,`select p.status from payables p join elos_import.financial_objects f on f.target_id=p.id where f.enterprise_id='fixture-main' and f.external_id='78'`),'open');
  const reversed=await apply(await batch([row('78',2000000,{source_status:'Estornada',change_evidence:'estorno-declarado'})]));
  assert.equal(reversed.accepted,0);return {canceled,reversed};
 });
 await check('cancelamento com extinção comprovada conserva original e versão',async()=>{
  const report=await apply(await batch([row('78',2000000,{source_status:'Cancelada',change_evidence:'extincao-ficticia',obligation_extinguished:true,cancellation_evidence:'distrato-ficticio'})]));
  assert.equal(report.accepted,1,JSON.stringify(report));assert.equal(await sql(container,`select p.status from payables p join elos_import.financial_objects f on f.target_id=p.id where f.enterprise_id='fixture-main' and f.external_id='78'`),'cancelled');return report;
 });
 await check('sem obra: 6000 + 4000 preservados, sem padrão Flow',async()=>{
  const report=await apply(await batch([row('known',600000),row('unknown',400000,{project_id:null})],{enterprise_id:'unknown-project'}));
  assert.equal(report.after.principal_cents,1000000);assert.equal(report.after.without_project_cents,400000);assert.equal(report.after.operational_principal_cents,600000);assert.equal(report.after.pending_objects,1);return report;
 });
 await check('rateio monetário parcial preserva A Apropriar e rejeita excesso',async()=>{
  const allocations=[{project_id:ids.pa1,service_id:'10000000-0000-4000-8000-000000000001',amount_cents:60000},{project_id:ids.pa1,service_id:null,amount_cents:40000}];
  const report=await apply(await batch([row('split',100000,{allocations})],{enterprise_id:'allocation'}));assert.equal(report.after.unallocated_cents,40000);
  assert.deepEqual(jsonLast(await sql(container,`select jsonb_build_object('known',sum(allocation_amount*100) filter(where service_id is not null),'pending',sum(allocation_amount*100) filter(where service_id is null),'total',sum(allocation_amount*100)) from payable_cost_allocations a join elos_import.financial_objects f on f.target_id=a.payable_id where f.enterprise_id='allocation'`)),{known:60000,pending:40000,total:100000});
  const bad=await apply(await batch([row('split',100000,{allocations:[{...allocations[0],amount_cents:100001}]})],{enterprise_id:'allocation'}));assert.equal(bad.rejected,1);assert.equal(bad.after.unallocated_cents,40000);return {report,rejected:bad};
 });
 await check('mesmo ID entre organizações e parcelas iguais continuam distintos',async()=>{
  const report=await apply(await batch([row('77',100000,{project_id:ids.pb1,legal_entity_id:ids.b1,supplier_id:ids.sb}),row('77',100000,{installment:'2',project_id:ids.pb1,legal_entity_id:ids.b1,supplier_id:ids.sb})]),ids.b,ids.ub);
  assert.equal(report.after.objects,2);assert.equal(report.after.operational_principal_cents,200000);return report;
 });
 await check('organização, perfil e entidade recusam acesso indevido',async()=>{
  const b=await batch([row('forbidden',100000)]);
  await assert.rejects(()=>apply(b,ids.a,ids.ub),/Sem permissão/);await assert.rejects(()=>apply(b,ids.a,ids.ur),/Sem permissão/);await assert.rejects(()=>apply(b,ids.a,ids.ua),/escopo de todas/);
  await assert.rejects(()=>sql(container,`set role authenticated;select elos_import.apply_financial_batch('${ids.a}','${crypto.randomUUID()}',${quote(b)})`),/permission denied/);
  return {denied:4};
 });
 await check('vínculos cruzados, identidade ausente, snapshots antigos e hash adulterado',async()=>{
  const cross=await apply(await batch([row('bad',100000,{supplier_id:ids.sb})],{enterprise_id:'invalid'}));assert.equal(cross.rejected,1);
  const missing=await apply(await batch([row(null,400000)],{enterprise_id:'invalid'}));assert.equal(missing.rejected,1);
  const stale=await apply({...initial,extracted_at:'2026-10-20T00:00:00Z'});assert.equal(stale.rejected,2);
  const changed=await batch([row('hash',100)]);changed.pages[0].raw+='!';await assert.rejects(()=>apply(changed),/Hash de página/);
  return {cross,missing,stale};
 });
 await check('vínculo legado explícito reaproveita título sem reescrever identidade',async()=>{
  const target='20000000-0000-4000-8000-000000000001';
  const report=await apply(await batch([row('77',1200000,{project_id:ids.pa2,legal_entity_id:ids.a2,target_id:target,binding_evidence:'documento-e-parcela-confirmados'})],{enterprise_id:'bindings'}));
  assert.equal(report.after.operational_count,1);assert.equal(report.after.operational_principal_cents,1200000);
  assert.equal(await sql(container,`select source_id from payables where id='${target}'`),'baseline:77');
  return report;
 });
 await check('alteração local não é sobrescrita por fotografia posterior',async()=>{
  const first=await apply(await batch([row('L',100000)],{enterprise_id:'local-edit'}));
  const target=first.reconciliation.rows[0].target_id;
  await sql(container,actor(ids.ug,`update payables set amount=1100,notes='Enriquecimento local preservado' where id='${target}'`));
  const next=await apply(await batch([row('L',120000,{change_evidence:'origem-alterada'})],{enterprise_id:'local-edit'}));
  assert.equal(next.after.operational_principal_cents,110000);assert.ok(next.reconciliation.rows[0].pending.includes('local_edit_conflict'));
  assert.equal(await sql(container,`select notes from payables where id='${target}'`),'Enriquecimento local preservado');return next;
 });
 await check('baixa bancária local preservada; origem não recria nem altera caixa',async()=>{
  const first=await apply(await batch([row('LB',100000)],{enterprise_id:'local-bank'}));
  const target=first.reconciliation.rows[0].target_id;
  await sql(container,actor(ids.ug,`select pay_finance_payable('${ids.a}','${ids.pa1}','${target}','${ids.bank1}','2026-10-21',1000)`));
  const report=await apply(await batch([row('LB',120000,{change_evidence:'alteracao-origem'})],{enterprise_id:'local-bank'}));
  assert.equal(report.after.operational_principal_cents,100000);assert.equal(report.reconciliation.rows[0].destination_status,'paid');assert.ok(report.reconciliation.rows[0].pending.includes('local_bank_events_preserved'));
  assert.equal(Number(await sql(container,`select count(*) from finance_bank_transactions where payable_id='${target}'`)),1);return report;
 });
 await check('sem entidade permanece em quarentena, com valor e original',async()=>{
  const report=await apply(await batch([row('QE',400000,{project_id:null,legal_entity_id:null})],{enterprise_id:'no-entity'}));
  assert.equal(report.after.without_entity_cents,400000);assert.equal(report.after.operational_count,0);assert.equal(report.after.financial_position_certified,false);return report;
 });
 await check('empresa de origem sem vínculo, manifesto falso e período fechado',async()=>{
  const unmapped=await batch([row('U',100000)],{enterprise_id:'no-binding'});
  await assert.rejects(()=>apply(unmapped),/de-para organizacional/);
  const falseTotal=await batch([row('bad-total',100000)],{enterprise_id:'invalid'});falseTotal.manifest.subtotal_cents=1;
  const bad=await apply(falseTotal);assert.equal(bad.complete,false);
  await sql(container,actor(ids.ug,`update finance_bank_accounts set closed_through='2026-10-20' where id='${ids.bank1}'`));
  const closed=await apply(await batch([row('C',100000)],{enterprise_id:'closed'}));
  assert.ok(closed.reconciliation.rows[0].pending.includes('closed_period'));assert.equal(closed.after.operational_count,0);return {bad,closed};
 });
 await check('entrada privada service_role exige autoria delegada e não permite colisão normalizada',async()=>{
  const b=await batch([row('service-call',1000,{effective_date:'2026-10-21'})],{enterprise_id:'concurrent'});
  const result=jsonLast(await sql(container,`begin;set local role service_role;select set_config('request.jwt.claim.sub','${ids.ug}',true);select elos_import.apply_financial_batch('${ids.a}','${crypto.randomUUID()}',${quote(b)});commit;`));
  assert.equal(result.accepted,1);
  const collision=await apply(await batch([row('CONC',10001)],{enterprise_id:'concurrent'}));
  assert.equal(collision.rejected,1);assert.equal(collision.errors[0].reason,'identity_normalization_collision');return {service_role:result,collision};
 });
 await check('original e trilha imutáveis; importação não cria caixa',async()=>{
  await assert.rejects(()=>sql(container,`update elos_import.financial_revisions set reason='adulterado'`),/Histórico imutável/);
  assert.equal(Number(await sql(container,'select count(*) from finance_bank_transactions')),1);
  await assert.rejects(()=>sql(container,`update elos_import.financial_batches set content='{}'`),/Manifesto e original imutáveis/);
  return {bank_transactions:1,created_by_existing_explicit_payment_RPC:1,created_by_import:0,history_immutable:true,raw_immutable:true};
 });
} catch(e){results.push({name:'setup_or_runner',pass:false,error:e.message});}
finally{
 await exec('docker',['rm','-f',container]);
 const evidence={base_commit:'494c55c',executed_at:new Date().toISOString(),container,container_removed:true,network:'none',candidate_sha256:crypto.createHash('sha256').update(fs.readFileSync(migration)).digest('hex'),passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,batches};
 const model=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/resultados_modelo.json'));
 model.execution_context={implementation_version:'494c55c+etapa6-candidate',executed_at:evidence.executed_at,environment:'PostgreSQL 17 isolado network=none; banco/importação, sem API/produção',fixture_sha256:crypto.createHash('sha256').update(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).digest('hex')};
 for(const item of model.cases){const observed=results.find(r=>r.name.startsWith(item.id+':')&&r.pass);if(observed){item.status='executado';item.actual=observed.evidence;item.evidence=['integracao.json: '+observed.name];}}
 fs.writeFileSync(path.join(output,'casos-obtidos.json'),JSON.stringify(model,null,2)+'\n');
 fs.writeFileSync(path.join(output,'integracao.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({passed:evidence.passed,failed:evidence.failed,failures:results.filter(r=>!r.pass)}));
 if(evidence.failed)process.exitCode=1;
}
