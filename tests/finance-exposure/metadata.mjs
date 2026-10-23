// Metadata collector validation only, on a disposable network:none database.
// No connection URL/credential is accepted. No production endpoint is contacted.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {start, sql, exec, image} from '../financeiro/runtime.mjs';
import {lastJson} from '../finance-partials/client.mjs';

const root='docs/financeiro/implementacao-v1/etapa14b-exposicao';
const evidence=path.join(root,'evidencias');
const collector=fs.readFileSync(path.join(root,'sql/inventario-metadados.sql'),'utf8');
const contracts='supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql';
const orders='supabase/migrations/20261025110000_work_order_financial_tenant_guard.sql';
const targets=[
 ['20260728_0038_execution_service_contracts.sql','refresh_execution_service_contract_value'],
 ['20260801_0067_service_contract_procurement.sql','refresh_execution_service_contract_measurements'],
 ['20260729_0040_execution_work_orders.sql','refresh_execution_work_order_values'],
];
const db=await start(), checks=[];
let fatal=null,removed=false;
const save=(file,data)=>fs.writeFileSync(path.join(evidence,file),JSON.stringify(data,null,2)+'\n');
const capture=async(file)=>{
 const data=lastJson(await sql(db,'set role e14b_metadata_reader;\n'+collector));
 data.environment='ISOLADO_FICTICIO_NAO_PRODUCAO';
 if(file)save(file,data);return data;
};
async function check(name,fn){try{checks.push({name,passed:true,result:await fn()});}
 catch(e){checks.push({name,passed:false,error:e.message});}}
try{
 await sql(db,`create role anon;create role authenticated;create role service_role;
 create role authenticator;create role e14b_metadata_reader;
 grant anon,authenticated to authenticator;
 create schema auth;
 create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
 create function public.is_company_member(uuid) returns boolean language sql as $$ select false $$;
 create function public.has_company_permission(uuid,text) returns boolean language sql as $$ select false $$;
 create table public.execution_service_contracts(id uuid primary key,company_id uuid,current_value numeric);
 create table public.execution_work_orders(id uuid primary key,company_id uuid,authorized_value numeric);
 alter table public.execution_service_contracts enable row level security;
 create policy own_contract on public.execution_service_contracts for select to authenticated using(public.is_company_member(company_id));
 insert into public.execution_service_contracts values('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',12345.67);
 insert into public.execution_work_orders values('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',765.43);`);
 for(const [file,name] of targets){
  const source=fs.readFileSync('supabase/migrations/'+file,'utf8');
  const definition=source.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?end;? \\$\\$;'))?.[0];
  assert.ok(definition,name);await sql(db,definition);
 }
 const totals=()=>sql(db,"select jsonb_build_array((select current_value from execution_service_contracts),(select authorized_value from execution_work_orders))").then(lastJson);
 const initial=await totals();const before=await capture('isolado-antes.json');
 await check('coletor_sem_acesso_a_linhas_de_negocio',async()=>{
  await assert.rejects(()=>sql(db,'set role e14b_metadata_reader;select * from execution_service_contracts;'),/permission denied/);
  assert.equal(before.transaction_read_only,'on');assert.equal(before.transaction_isolation,'repeatable read');
  assert.equal(before.current_user,'e14b_metadata_reader');assert.equal(before.functions.length,3);
  assert.deepEqual(await totals(),initial);return {metadata_readable:true,business_select_denied:true,values_unchanged:initial};
 });
 await check('ACL_default_PUBLIC_e_RLS_inventariados',async()=>{
  assert.ok(before.functions.every(f=>f.security_definer&&f.acl_raw===null&&f.acl_expanded.some(a=>a.grantee==='PUBLIC'&&a.privilege==='EXECUTE')));
  const c=before.tables.find(t=>t.name==='execution_service_contracts');assert.ok(c.rls_enabled&&!c.rls_forced&&c.policies.length===1);
  assert.ok(before.functions.every(f=>f.owner_superuser));return {default_public_execute:true,owner_bypasses_RLS:true};
 });
 await sql(db,fs.readFileSync(contracts,'utf8'));await sql(db,fs.readFileSync(orders,'utf8'));
 const after=await capture('isolado-depois.json');
 await check('candidatas_preservam_todos_os_corpos_financeiros',async()=>{
  for(const a of after.functions){const b=before.functions.find(f=>f.name===a.name);
   assert.equal(a.body.replace(/\n-- E14_(?:TENANT|WORK_ORDER)_GUARD_BEGIN[\s\S]*?-- E14_(?:TENANT|WORK_ORDER)_GUARD_END\n/,''),b.body);
   assert.ok(!a.acl_expanded.some(x=>x.grantee==='PUBLIC'));
   const roles=Object.fromEntries(a.effective_roles.map(r=>[r.role,r.execute]));
   assert.equal(roles.anon,false);assert.equal(roles.authenticated,true);assert.equal(roles.service_role,true);
  }assert.deepEqual(await totals(),initial);return {functions:3,values_unchanged:initial};
 });
 await check('reaplicacao_das_duas_candidatas_idempotente',async()=>{
  await sql(db,fs.readFileSync(contracts,'utf8'));await sql(db,fs.readFileSync(orders,'utf8'));
  assert.deepEqual((await capture()).functions,after.functions);return true;
 });
 await check('comparador_offline_distingue_antes_depois',async()=>{
  for(const stage of ['antes','depois'])await exec('python',[root+'/scripts/comparar.py',evidence+`/isolado-${stage}.json`,'--reference',evidence+'/isolado-depois.json','--output',evidence+`/comparacao-isolada-${stage}.json`]);
  const a=JSON.parse(fs.readFileSync(evidence+'/comparacao-isolada-antes.json'));
  const b=JSON.parse(fs.readFileSync(evidence+'/comparacao-isolada-depois.json'));
  assert.ok(a.results.every(r=>!r.same_body&&r.public_execute));
  assert.ok(b.results.every(r=>r.same_body&&r.expected_core_acl));
  assert.ok(b.results.every(r=>r.production_exposure==='NÃO VERIFICADA'));return {before_differences:3,after_equivalent:3,no_production_claim:true};
 });
 await check('contencao_fecha_execucao_interativa_sem_reabrir_vulnerabilidade',async()=>{
  await sql(db,fs.readFileSync(root+'/sql/contencao-condicional.sql','utf8'));
  const snapshot=await capture('isolado-contencao.json');
  for(const f of snapshot.functions){const roles=Object.fromEntries(f.effective_roles.map(r=>[r.role,r.execute]));
   assert.equal(roles.anon,false);assert.equal(roles.authenticated,false);assert.equal(roles.service_role,true);
   assert.equal(f.body,after.functions.find(a=>a.name===f.name).body);
  }assert.deepEqual(await totals(),initial);return {interactive_denied:true,service_preserved:true,guards_preserved:true};
 });
 await check('overload_e_assinatura_ausente_nao_sao_inferidos',async()=>{
  await sql(db,`create function public.refresh_execution_service_contract_value(text) returns numeric language sql as $$select 0::numeric$$;
  drop function public.refresh_execution_work_order_values(uuid);`);
  const data=await capture('isolado-overload-ausente.json');
  assert.equal(data.requested_targets.find(r=>r.name===targets[0][1]).overloads_found,2);
  assert.equal(data.requested_targets.find(r=>r.name===targets[2][1]).expected_signature_exists,false);
  await exec('python',[root+'/scripts/comparar.py',evidence+'/isolado-overload-ausente.json','--reference',evidence+'/isolado-depois.json','--output',evidence+'/comparacao-isolada-ausente.json']);
  const missing=JSON.parse(fs.readFileSync(evidence+'/comparacao-isolada-ausente.json')).results.find(r=>r.function===targets[2][1]);
  assert.equal(missing.comparison,'ASSINATURA AUSENTE OU AMBÍGUA');return {overload_detected:true,missing_not_zero_or_safe:true};
 });
}catch(e){fatal=e.message;process.exitCode=1;}
finally{
 await exec('docker',['rm','-f',db]);removed=true;
 save('testes-metadados.json',{executed_at:new Date().toISOString(),image,network:'none',published_ports:[],environment:'ISOLADO_FICTICIO',scaffold:'Duas tabelas sentinelas e helpers inertes; corpos das três RPCs extraídos literalmente das migrações. Não certifica autorização funcional: ver guards/ordens-servico.',checks,passed:checks.filter(r=>r.passed).length,failed:checks.filter(r=>!r.passed).length,fatal_error:fatal,container_removed:removed,production_connections:0,production_RPC_calls:0,business_production_rows_read:0});
 if(checks.some(r=>!r.passed))process.exitCode=1;
 console.log(JSON.stringify({passed:checks.filter(r=>r.passed).length,failed:checks.filter(r=>!r.passed).length,fatal_error:fatal,container_removed:removed}));
}
