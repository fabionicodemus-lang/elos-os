// Supplementary SQL proof, explicitly not an HTTP/Auth certification of the OS module.
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {start,sql,asUser,ids,exec} from '../financeiro/runtime.mjs';
import {setup} from '../koper-finance/setup.mjs';
import {lastJson} from '../finance-partials/client.mjs';
const root=process.env.FINANCE14_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa14-isolamento/evidencias',db=await start(),results=[];
const id=crypto.randomUUID(),item=crypto.randomUUID(),source=fs.readFileSync('supabase/migrations/20260729_0040_execution_work_orders.sql','utf8');
const body=source.match(/create or replace function public\.refresh_execution_work_order_values\([\s\S]*?end; \$\$;/)[0];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');let baseline;
async function check(name,fn){try{results.push({name,pass:true,actual:await fn()});}catch(e){results.push({name,pass:false,error:e.message});}}
const current=()=>sql(db,`select to_jsonb(t) from execution_work_orders t where id='${id}'`).then(lastJson);
try{
 await setup(db);
 await sql(db,`update companies set name=case id when '${ids.a}' then 'Construtora Horizonte' else 'Construtora Atlântico' end where id in('${ids.a}','${ids.b}')`);
 await sql(db,`create table execution_work_orders(id uuid primary key,company_id uuid,project_id uuid,authorized_value numeric,executed_value numeric,accepted_value numeric,measured_value numeric,updated_at timestamptz);
 create table execution_work_order_items(id uuid primary key,company_id uuid,project_id uuid,work_order_id uuid,authorized_value numeric,executed_value numeric,accepted_value numeric,measured_value numeric);
 insert into execution_work_orders values('${id}','${ids.b}','${ids.pb1}',0,0,0,0,now());
 insert into execution_work_order_items values('${item}','${ids.b}','${ids.pb1}','${id}',20000,8000,7000,6000);
 insert into permissions(key,module,action,description) values('execution.work_orders.view','execution_work_orders','view','Visualizar ordens de serviço');
 insert into role_permissions(role_id,permission_key) select id,'execution.work_orders.view' from roles;
 alter table execution_work_orders enable row level security;alter table execution_work_order_items enable row level security;
 create policy original_read on execution_work_orders for select to authenticated using(has_company_permission(company_id,'execution.work_orders.view'));
 create policy original_read on execution_work_order_items for select to authenticated using(has_company_permission(company_id,'execution.work_orders.view'));
 grant select on execution_work_orders,execution_work_order_items to authenticated;
 ${body}grant execute on function refresh_execution_work_order_values(uuid) to authenticated;`);
 const before=await current();const invisible=await sql(db,asUser(ids.ua,`select count(*) from execution_work_orders where id='${id}'`));assert.equal(invisible.split('\n').findLast(line=>/^\d+$/.test(line)),'0');
 await sql(db,asUser(ids.ua,`select refresh_execution_work_order_values('${id}')`));const leaked=await current();assert.equal(leaked.authorized_value,20000);assert.equal(leaked.measured_value,6000);
 baseline={identity:{id:ids.ua,company:ids.a,profile:'finance'},target_company:ids.b,target_id:id,layer:'SQL authenticated role/claims; real native function',foreign_rows_visible_before:0,before,unauthorized_after:leaked};
 await sql(db,`update execution_work_orders set authorized_value=0,executed_value=0,accepted_value=0,measured_value=0 where id='${id}'`);
 await sql(db,fs.readFileSync('supabase/migrations/20261025110000_work_order_financial_tenant_guard.sql','utf8'));
 await check('formula_nativa_preservada',async()=>{const after=await sql(db,"select prosrc from pg_proc where oid='refresh_execution_work_order_values(uuid)'::regprocedure");const stripped=after.replace(/\n-- E14_WORK_ORDER_GUARD_BEGIN[\s\S]*?-- E14_WORK_ORDER_GUARD_END\n/,'');const expected=body.match(/as \$\$([\s\S]*)\$\$;/)[1].trim();assert.equal(stripped.trim(),expected);return {financial_body_sha256:sha(expected),stripped_after_sha256:sha(stripped.trim())};});
 await check('empresa_estrangeira_nao_recalcula_OS',async()=>{await assert.rejects(()=>sql(db,asUser(ids.ua,`select refresh_execution_work_order_values('${id}')`)),/Ordem indisponível ou sem autorização/);assert.equal((await current()).authorized_value,0);return {denied:true,foreign_value_unchanged:0};});
 await check('anon_nao_executa_OS',async()=>{await assert.rejects(()=>sql(db,`begin;set local role anon;select refresh_execution_work_order_values('${id}');commit`),/permission denied/);return {denied:true};});
 await check('OS_legitima_conserva_valores_independentes',async()=>{await sql(db,asUser(ids.ub,`select refresh_execution_work_order_values('${id}')`));const actual=await current();assert.deepEqual([actual.authorized_value,actual.executed_value,actual.accepted_value,actual.measured_value],[20000,8000,7000,6000]);return actual;});
}finally{await exec('docker',['rm','-f',db]);fs.writeFileSync(root+'/ordens-servico.json',JSON.stringify({baseline,native_source_sha256:sha(body),results,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,container_removed:true,HTTP_Auth_certified:false},null,2)+'\n');if(results.some(r=>!r.pass))process.exitCode=1;console.log(JSON.stringify(results));}
