import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {allocateByWeight} from '../../lib/cost-vs-budget/native-allocation.mjs';
import {start,bootstrap,sql,asUser,exec,ids,image} from './runtime.mjs';
const baseline=process.argv.includes('--baseline');
const output=process.env.FINANCE_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/base-validacao/evidencias';
fs.mkdirSync(output,{recursive:true});
const results=[];
const container=await start();
const json=async(user,statement)=>JSON.parse((await sql(container,asUser(user,statement))).split('\n').findLast(s=>s.startsWith('{')));
const check=async(id,fn)=>{try{const evidence=await fn();results.push({id,passed:true,evidence});}catch(e){results.push({id,passed:false,error:e.message});}};
const denied=async(statement,user=ids.ua)=>{
 await assert.rejects(()=>sql(container,asUser(user,statement)),error=>
  /permiss|autoriz|organiza|incompat|imut.vel|autoria|motivo|obsoleta|reutilizado|Revis.o exige|check constraint/i.test(error.message));
 return 'Operação recusada por autorização/integridade; não por falta de função ou erro de sintaxe';
};
const title=(id,project,company,supplier,value,source=id)=>`insert into payables(id,company_id,project_id,supplier_id,amount,due_date,source_system,source_id,created_by) values('${id}','${company}','${project}','${supplier}',${value},'2026-10-30','KOPER_TEST','${source}',auth.uid())`;
try {
 await bootstrap(container);
 if(!baseline){
  await sql(container,fs.readFileSync('supabase/migrations/20261021120000_financial_foundation_guards.sql','utf8'));
  await sql(container,`insert into finance_company_controls values('${ids.a}',true),('${ids.b}',true);
   insert into finance_entity_permissions values
   ('${ids.a}','${ids.a1}','${ids.ua}',true,true),('${ids.a}','${ids.a1}','${ids.ur}',true,false),
   ('${ids.a}','${ids.a1}','${ids.ug}',true,true),('${ids.a}','${ids.a2}','${ids.ug}',true,true),
   ('${ids.b}','${ids.b1}','${ids.ub}',true,true),('${ids.b}','${ids.b1}','${ids.ug}',true,true);`);
 }
 await sql(container,asUser(ids.ug,`select set_config('finance.effective_date','2026-10-19',true);
 ${title(ids.t1,ids.pa1,ids.a,ids.sa,1000,'77')};${title(ids.t2,ids.pa2,ids.a,ids.sa,3000,'79')};${title(ids.tb,ids.pb1,ids.b,ids.sb,9000,'77')}`));
 for(const [id,company,project,sale,client,unit,amount] of [[ids.r1,ids.a,ids.pa1,ids.sale1,ids.ca,ids.u1,1000],[ids.r2,ids.a,ids.pa2,ids.sale2,ids.ca,ids.u2,3000],[ids.rb,ids.b,ids.pb1,ids.saleb,ids.cb,ids.ub1,9000]])
  await sql(container,asUser(ids.ug,`insert into receivables(id,company_id,project_id,sale_id,client_id,unit_id,category,description,due_date,amount,adjusted_amount,created_by) values('${id}','${company}','${project}','${sale}','${client}','${unit}','other','Fixture','2026-10-30',${amount},${amount},auth.uid())`));
 await check('dataset_30_casos_hash_preservado',async()=>{
  const fixtures=fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json');
  const manifest=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/manifesto.json'));
  assert.equal(crypto.createHash('sha256').update(fixtures).digest('hex'),manifest.files_sha256['casos_financeiros.json']);
  const count=await sql(container,'select count(*) from validation.cases');assert.equal(count,'30');return {cases:Number(count),fixture_sha256:manifest.files_sha256['casos_financeiros.json']};
 });
 await check('empresa_A_nao_le_empresa_B',async()=>{const r=await json(ids.ua,`select json_build_object('count',count(*)) from payables where company_id='${ids.b}'`);assert.equal(r.count,0);return r;});
 await check('perfil_leitura_nao_altera',async()=>{const r=await json(ids.ur,`with changed as(update payables set amount=999 where id='${ids.t1}' returning id) select json_build_object('changes',count(*)) from changed`);assert.equal(r.changes,0);return r;});
 await check('entidade_A1_nao_le_A2',async()=>{const r=await json(ids.ua,`select json_build_object('count',count(*)) from payables where id='${ids.t2}'`);assert.equal(r.count,0);return r;});
 await check('recebiveis_tambem_respeitam_entidade',async()=>{const r=await json(ids.ua,`select json_build_object('count',count(*)) from receivables where id='${ids.r2}'`);assert.equal(r.count,0);return r;});
 await check('agregado_respeita_entidade',async()=>{const r=await json(ids.ua,`select json_build_object('open_cents',(payables_summary('${ids.a}',null)->>'open_amount')::numeric*100)`);assert.equal(r.open_cents,100000);return r;});
 await check('usuario_multientidade_consolida_autorizado',async()=>{const r=await json(ids.ug,`select json_build_object('open_cents',sum(amount)*100) from payables where company_id='${ids.a}'`);assert.equal(r.open_cents,400000);return r;});
 await check('RPC_saldo_nao_expoe_entidade_alheia',()=>denied(`select finance_bank_account_balance('${ids.bank2}',null)`));
 await check('RPC_importacao_nao_aceita_conta_de_A2',()=>denied(`select bank_import_ofx('${ids.bank2}','fixture.ofx',repeat('a',64),null,'2','[{"fit_id":"FIX","transaction_date":"2026-10-21","amount":1,"description":"Fictício"}]'::jsonb)`));
 await check('fornecedor_de_outra_empresa_recusado',()=>denied(`select set_config('finance.reason','Teste de integridade',true);update payables set supplier_id='${ids.sb}' where id='${ids.t1}';rollback`));
 await check('obra_de_outra_empresa_recusada',()=>denied(`select set_config('finance.reason','Teste de integridade',true);update payables set project_id='${ids.pb1}' where id='${ids.t1}';rollback`));
 await check('NaN_nao_persiste_como_dinheiro',()=>denied(`select set_config('finance.reason','Teste de integridade',true);update payables set amount='NaN' where id='${ids.t1}';rollback`));
 await check('concorrencia_liquidacao_exatamente_uma',async()=>{
  const pay='00000000-0000-4000-8000-000000000101';
  await sql(container,asUser(ids.ua,title(pay,ids.pa1,ids.a,ids.sa,1000)));
  const request=()=>sql(container,asUser(ids.ua,`select pay_finance_payable('${ids.a}','${ids.pa1}','${pay}','${ids.bank1}','2026-10-21',1000);select pg_sleep(0.2)`));
  const settled=await Promise.allSettled([request(),request()]);
  const r=JSON.parse(await sql(container,`select json_build_object('movements',count(*),'cash',sum(amount)) from finance_bank_transactions where payable_id='${pay}'`));
  assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal(r.movements,1);assert.equal(r.cash,1000);return {...r,connections:2,accepted:1,rejected:1};
 });
 await check('concorrencia_mesma_identidade_nao_duplica',async()=>{
  const insert=`insert into payables(company_id,project_id,supplier_id,amount,due_date,source_system,source_id,created_by) values('${ids.a}','${ids.pa1}','${ids.sa}',10,'2026-10-30','KOPER_TEST','concurrent',auth.uid()) on conflict(company_id,source_system,source_id) do nothing`;
  await Promise.all([sql(container,asUser(ids.ua,insert)),sql(container,asUser(ids.ua,insert))]);
  const r=await json(ids.ua,"select json_build_object('count',count(*),'sum',sum(amount)) from payables where source_id='concurrent'");assert.equal(r.count,1);assert.equal(r.sum,10);
  if(!baseline){const orphans=await sql(container,"select count(*) from finance_title_audit a where title_type='payables' and not exists(select 1 from payables p where p.id=a.title_id)");assert.equal(orphans,'0');}
  return r;
 });
 await check('concorrencia_recebimento_exatamente_um',async()=>{
  const request=()=>sql(container,asUser(ids.ua,`select receive_finance_receivable('${ids.a}','${ids.pa1}','${ids.r1}','${ids.bank1}','2026-10-21',1000);select pg_sleep(0.2)`));
  const responses=await Promise.allSettled([request(),request()]);
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);
  const r=JSON.parse(await sql(container,`select json_build_object('movements',count(*),'received',sum(amount)) from finance_bank_transactions where receivable_id='${ids.r1}'`));
  assert.equal(r.movements,1);assert.equal(r.received,1000);return {...r,connections:2,accepted:1,rejected:1};
 });
 await check('revisao_idempotente_autoria_motivo_antes_depois_T_K',async()=>{
  const t='00000000-0000-4000-8000-000000000102',command='00000000-0000-4000-8000-000000000201';
  await sql(container,asUser(ids.ua,`select set_config('finance.effective_date','2026-10-19',true);${title(t,ids.pa1,ids.a,ids.sa,10000)}`));
  const k=JSON.parse(await sql(container,"select json_build_object('k',clock_timestamp())")).k;
  const revise=`select revise_finance_payable('${ids.a}','${t}','${command}',1,12000,'2026-10-30','2026-10-20','Acréscimo fictício aprovado no caso CT02')`;
  const responses=await Promise.allSettled([sql(container,asUser(ids.ua,revise+';select pg_sleep(0.2)')),sql(container,asUser(ids.ua,revise+';select pg_sleep(0.2)'))]);
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,2);
  const audit=JSON.parse(await sql(container,`select json_build_object('versions',count(*),'before',(max((previous_value->>'amount')::numeric)),'after',max((new_value->>'amount')::numeric),'actors',count(*) filter(where actor_id='${ids.ua}'),'reason',max(reason)) from finance_title_audit where title_id='${t}'`));
  assert.equal(audit.versions,2);assert.equal(audit.before,10000);assert.equal(audit.after,12000);assert.equal(audit.actors,2);
  const history=await json(ids.ua,`select json_build_object('original',(finance_payable_at('${t}','2026-10-21','${k}')->>'amount')::numeric,'restated',(finance_payable_at('${t}','2026-10-21',clock_timestamp())->>'amount')::numeric)`);
  assert.equal(history.original,10000);assert.equal(history.restated,12000);
  await denied(`select revise_finance_payable('${ids.a}','${t}','${command}',1,13000,'2026-10-30','2026-10-20','Conteúdo diferente')`);
  await denied(`update finance_title_audit set reason='forjado' where title_id='${t}'`);
  await assert.rejects(()=>sql(container,`update finance_title_audit set reason='forjado' where title_id='${t}'`),e=>/Histórico imutável/.test(e.message));
  return {audit,history,concurrent_connections:2,command_count:Number(await sql(container,`select count(*) from finance_title_commands where command_id='${command}'`)),known_cut:k};
 });
 await check('atualizacao_sem_motivo_recusada',()=>denied(`update payables set amount=1100 where id='${ids.t1}';rollback`));
 await check('identidade_origem_nao_e_reescrita',()=>denied(`select set_config('finance.reason','Teste identidade',true);update payables set source_id='novo' where id='${ids.t1}';rollback`));
 await check('autoria_de_origem_nao_e_forjada',()=>denied(`select set_config('finance.reason','Teste autoria',true);update payables set created_by='${ids.ub}' where id='${ids.t1}';rollback`));
 await check('RPC_revisao_nao_aceita_centavo_fracionario',()=>denied(`select revise_finance_payable('${ids.a}','${ids.t1}','00000000-0000-4000-8000-000000000202',1,1000.001,'2026-10-30','2026-10-21','Teste')`));
 if(!baseline){
  await check('preflight_somente_leitura_da_base_ficticia',async()=>{
   const report=await sql(container,fs.readFileSync('supabase/diagnostics/20261021_financial_foundation_preflight.sql','utf8'));
   for(const row of report.split('\n'))assert.equal(row.split('|')[1],'0');return report;
  });
  const fixtures=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json'));
  const initial={execution_context:{implementation_version:(await exec('git',['rev-parse','HEAD'])).stdout.trim()+'+candidate',executed_at:new Date().toISOString(),environment:'PostgreSQL 17 network=none; interfaces de banco/componentes, sem API Next',fixture_sha256:crypto.createHash('sha256').update(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).digest('hex')},cases:fixtures.cases.map(c=>({id:c.id,status:'nao_executado',actual:null,evidence:[]})),component_checks:[]};
  const ct07=fixtures.cases.find(c=>c.id==='CT07');
  const t='00000000-0000-4000-8000-000000000107';
  await sql(container,asUser(ids.ua,title(t,ids.pa1,ids.a,ids.sa,ct07.inputs.principal_cents/100)));
  await sql(container,asUser(ids.ua,`select pay_finance_payable('${ids.a}','${ids.pa1}','${t}','${ids.bank1}','2026-10-21',${ct07.inputs.first_payment_principal_cents/100})`));
  const actual=await json(ids.ua,`select json_build_object('open_cents',case when status='open' then amount*100 else 0 end,'status',status,'paid_cents',paid_amount*100) from payables where id='${t}'`);
  initial.component_checks.push({id:'CT07_primeira_parcial',expected:ct07.expected.after_first_open_principal_cents,actual:actual.open_cents,passed:actual.open_cents===ct07.expected.after_first_open_principal_cents,evidence:actual,limit:'Primeiro passo reproduzido; juros/desconto e demais liquidações requerem T18. Não é caso integral.'});
  Object.assign(initial.cases.find(c=>c.id==='CT07'),{status:'parcial',actual:{after_first_open_principal_cents:actual.open_cents},evidence:['initial component_checks.CT07_primeira_parcial']});
  const ct11=fixtures.cases.find(c=>c.id==='CT11');
  const roundRows=Object.entries(ct11.inputs.rounding_fixture.weights).reverse().map(([id,current_amount])=>({id,current_amount}));
  const rounding=Object.fromEntries(roundRows.map((r,i)=>[r.id,Math.round(allocateByWeight(ct11.inputs.rounding_fixture.amount_cents/100,roundRows)[i]*100)]));
  initial.component_checks.push({id:'CT11_arredondamento',expected:ct11.expected.rounding_fixture,actual:rounding,passed:rounding.A===3334&&rounding.B===3334&&rounding.C===3333,limit:'Somente componente monetário; não liquidação e saldos por obra.'});
  Object.assign(initial.cases.find(c=>c.id==='CT11'),{status:'parcial',actual:{rounding_fixture:rounding},evidence:['initial component_checks.CT11_arredondamento']});
  Object.assign(initial.cases.find(c=>c.id==='CT24'),{status:'parcial',actual:null,evidence:['banco-final.json: controles de empresa/entidade/perfil/RPC'],limit:'Banco real isolado; não certifica API, cache, exportações, IA ou Storage real.'});
  fs.writeFileSync(output+'/casos-iniciais.json',JSON.stringify(initial,null,2)+'\n');
  await check('comparador_nao_certifica_casos_parciais',async()=>{
   fs.rmSync(output+'/comparacao-casos.json',{force:true});
   let status=0,text='';
   try{const r=await exec('python3',['tests/financeiro/fixtures/comparar_resultados.py',output+'/casos-iniciais.json','--report',output+'/comparacao-casos.json']);text=r.stdout;}
   catch(e){status=e.code;text=(e.stdout??'')+(e.stderr??'');}
   fs.writeFileSync(output+'/comparacao-casos.log',text);
   assert.equal(status,1);
   const report=JSON.parse(fs.readFileSync(output+'/comparacao-casos.json'));
   assert.equal(report.passed_count,0);assert.equal(report.selected_count,30);assert.equal(report.complete,false);
   return {comparator_exit:status,integral_cases_certified:report.passed_count,partial_cases:3,unrun_cases:27};
  });
 }
 // Backup real e restore test sobre o mesmo contêiner sem rede; scripts não sabem acessar produção.
 if(process.argv.includes('--backup')) {
  const dir=fs.mkdtempSync('/tmp/elos-finance-backup-');
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',PG_DOCKER_CONTAINER:container,SUPABASE_DB_URL:'postgresql://postgres@localhost/elos_finance_test',BACKUP_PASSPHRASE:crypto.randomBytes(32).toString('hex'),BACKUP_OUT_DIR:dir,GNUPGHOME:dir+'/gnupg'};
  await check('backup_restauracao_e_controles_restaurados',async()=>{
   await sql(container,'create table validation.snapshot_churn(id bigint generated always as identity,payload text)');
   let stop=false,writes=0;
   const writer=(async()=>{while(!stop){await sql(container,"insert into validation.snapshot_churn(payload) values(repeat('ficticio',1000))");writes++;}})();
   let backup;
   try{backup=await exec('bash',['.github/scripts/backup-database.sh'],{env,maxBuffer:2e6});}
   finally{stop=true;await writer;}
   assert.ok(writes>0);
   const restored=await exec('bash',['.github/scripts/restore-test.sh'],{env,maxBuffer:2e6});
   const counts=JSON.parse(await sql(container,"select json_build_object('titles',count(*),'sum',sum(amount)) from payables"));
   const restoredCounts=JSON.parse(await sql(container,"select json_build_object('titles',count(*),'sum',sum(amount)) from payables",'elos_restore_fixture'));
   assert.deepEqual(restoredCounts,counts);
   await assert.rejects(()=>sql(container,asUser(ids.ua,`update finance_title_audit set reason='forjado'`),'elos_restore_fixture'));
   await assert.rejects(()=>sql(container,"update finance_title_audit set reason='forjado'",'elos_restore_fixture'),e=>/Histórico imutável/.test(e.message));
   const historySql="select md5(string_agg(new_value::text||coalesce(previous_value::text,'')||coalesce(actor_id::text,''),'|' order by id)) from finance_title_audit";
   const historyHash=await sql(container,historySql);assert.equal(await sql(container,historySql,'elos_restore_fixture'),historyHash);
   const hidden=await sql(container,asUser(ids.ua,`select count(*) from payables where company_id='${ids.b}'`),'elos_restore_fixture');
   assert.ok(hidden.split('\n').includes('0'));
   return {backup:backup.stdout,restore:restored.stdout,backup_manifest:JSON.parse(fs.readFileSync(dir+'/manifest.json')),counts,restoredCounts,historyHash,concurrent_source_writes:writes,rls_and_immutable_audit_preserved:true};
  });
  await check('backup_corrompido_e_destino_existente_sao_recusados',async()=>{
   await assert.rejects(()=>exec('bash',['.github/scripts/restore-test.sh'],{env}),e=>/Destino j. existe/.test(e.stderr));
   const manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json'));
   const file=dir+'/'+manifest.archive;const bytes=fs.readFileSync(file);bytes[0]^=1;fs.writeFileSync(file,bytes);
   await assert.rejects(()=>exec('bash',['.github/scripts/restore-test.sh'],{env:{...env,RESTORE_TEST_DB:'elos_restore_corrupt'}}),e=>/Checksum/.test(e.stderr));
   return {existing_destination_rejected:true,corrupt_checksum_rejected:true};
  });
  await check('erro_do_pg_restore_bloqueia_certificacao',async()=>{
   const dump=dir+'/invalid.dump',archive=dir+'/elos-os-123Z.dump.gpg';fs.writeFileSync(dump,'invalid archive');
   await exec('python3',['-c',"import importlib.util,sys; s=importlib.util.spec_from_file_location('b','.github/scripts/database_backup.py'); b=importlib.util.module_from_spec(s); s.loader.exec_module(b); b.gpg(['--symmetric','--cipher-algo','AES256','--output',sys.argv[1],sys.argv[2]])",archive,dump],{env});
   const manifest=JSON.parse(fs.readFileSync(dir+'/manifest.json'));
   manifest.archive='elos-os-123Z.dump.gpg';manifest.archive_sha256=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');manifest.dump_sha256=crypto.createHash('sha256').update(fs.readFileSync(dump)).digest('hex');fs.writeFileSync(dir+'/manifest.json',JSON.stringify(manifest));
   await assert.rejects(()=>exec('bash',['.github/scripts/restore-test.sh'],{env:{...env,RESTORE_TEST_DB:'elos_restore_invaliddump'}}),e=>/pg_restore.*falhou/.test(e.stderr));
   return {invalid_archive_rejected_by_pg_restore:true,success_not_reported:true};
  });
  fs.rmSync(dir,{recursive:true,force:true});
 }
} catch(e){results.push({id:'bootstrap',passed:false,error:e.message});}
finally{
 const inspect=JSON.parse((await exec('docker',['inspect',container])).stdout)[0];
 const report={executed_at:new Date().toISOString(),base_commit:(await exec('git',['rev-parse','HEAD'])).stdout.trim(),mode:baseline?'baseline_sem_extensao':'candidato_isolado',image,postgres_version:await sql(container,'select version()'),postgres_container:container,network:inspect.HostConfig.NetworkMode,published_ports:inspect.HostConfig.PortBindings,tmpfs:inspect.HostConfig.Tmpfs,fixture_count:30,supabase_auth:'auth.uid() lê claim em GUC local, sem servidor Auth',surface:'PostgreSQL/RLS/RPC; não inclui navegador/API Next/Storage real',candidate_migration_sha256:crypto.createHash('sha256').update(fs.readFileSync('supabase/migrations/20261021120000_financial_foundation_guards.sql')).digest('hex'),results,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};
 await exec('docker',['rm','-f',container]);
 report.container_removed=true;
 fs.writeFileSync(`${output}/${baseline?'banco-inicial':'banco-final'}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({baseline,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,failures:results.filter(r=>!r.passed).map(r=>({id:r.id,error:r.error.slice(0,150)}))}));
}
if(results.some(r=>!r.passed))process.exitCode=1;
