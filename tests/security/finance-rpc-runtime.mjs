// Disposable PostgreSQL only. No remote URL/credential is accepted.
import fs from 'node:fs';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
export const exec=promisify(execFile);
export const image='postgres@sha256:a63c1ea3f6a3a5a1621f97d2aba3b30faecfab4224c1b0000cc85ced57bb1939';
export const migrations=[
 '20260722_0001_multitenancy.sql','20260722_0002_suppliers_clients.sql','20260722_0003_flow_payables.sql',
 '20260723_0004_flow_sales.sql','20260723_0005_receivables.sql','20260723_0006_correction_indices.sql',
 '20260724_0014_engineering_budgets.sql','20260724_0015_engineering_services.sql','20260724_0016_engineering_inputs.sql',
 '20260724_0017_engineering_input_prices.sql','20260724_0019_engineering_service_compositions.sql',
 '20260724_0021_engineering_takeoffs.sql','20260726_0023_engineering_schedule_baseline.sql',
 '20260727_0030_legal_entities.sql','20260728_0033_execution_material_requests.sql','20260728_0038_execution_service_contracts.sql',
 '20260728_0039_execution_contract_measurements.sql','20260729_0040_execution_work_orders.sql',
 '20260729_0041_procurement_material_quotations.sql','20260729_0042_procurement_purchase_orders.sql',
 '20260729_0043_procurement_material_receipts.sql','20260729_0044_procurement_inventory.sql',
 '20260729_0045_finance_electronic_invoices.sql','20260729_0046_finance_supplier_product_mappings.sql',
 '20260729_0047_finance_manual_invoices.sql','20260729_0048_finance_bank_accounts.sql',
 '20260729_0048a_finance_bank_accounts_security_fix.sql','20260729_0056_system_permissions.sql',
 '20260731_0063_universal_financial_installments.sql','20260801_0067_service_contract_procurement.sql',
 '20260803_0071_execution_contract_commitments.sql','20260803_0072_execution_contract_workflows.sql',
 '20260803_0075_execution_contract_finance.sql','20260810_0081_owner_admin_full_access.sql',
 '20261013_0092_measurement_approval_waits_invoice.sql','20261014_0093_security_audit_trail.sql'
];
export function sql(db,query,{user='e14e_admin',database='e14e_native'}={}){
 if(!/^elos-rpc-p0-\d+$/.test(db)||!['e14e_native','postgres'].includes(database))throw Error('Non-disposable destination refused');
 return new Promise((resolve,reject)=>{
  const p=spawn('docker',['exec','-i',db,'psql','-XAt','-v','ON_ERROR_STOP=1','-U',user,'-d',database],{stdio:['pipe','pipe','pipe']});
  let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);
  p.on('close',c=>c===0?resolve(out.trim()):reject(Error(err.trim())));p.stdin.end(query);
 });
}
export const lastJSON=s=>JSON.parse(s.split('\n').findLast(x=>x.startsWith('{')||x.startsWith('[')));
export const q=s=>"'"+String(s).replaceAll("'","''")+"'";
export const j=s=>q(JSON.stringify(s))+'::jsonb';
export const asUser=(id,query)=>`begin;set local role authenticated;select set_config('request.jwt.claims',${q(JSON.stringify({sub:id,role:'authenticated'}))},true);${query};commit;`;
export async function start(){
 const db='elos-rpc-p0-'+process.pid;
 await exec('docker',['run','-d','--name',db,'--network','none','--label','elos.security.p0=true','--tmpfs','/var/lib/postgresql/data:rw,size=768m','--memory','1536m','--cpus','2','-e','POSTGRES_USER=e14e_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 try{
  for(let i=0;;i++){try{await exec('docker',['exec',db,'pg_isready','-h','127.0.0.1','-U','e14e_admin']);break;}catch{if(i>100)throw Error('Disposable DB unavailable');await new Promise(r=>setTimeout(r,100));}}
  await sql(db,`create role postgres login nosuperuser bypassrls;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role authenticator login noinherit;grant anon,authenticated,service_role to authenticator;create database e14e_native owner postgres;`,{database:'postgres'});
  return db;
 }catch(e){await exec('docker',['rm','-f',db]);throw e;}
}
export async function native(db){
 // Supabase platform prerequisites only; every business table/function/trigger
 // below comes from repository DDL, not a business-table scaffold. The historical
 // data-only tail of0048 is omitted: its ON CONFLICT is invalid on a fresh native
 // partial index. No DDL/function/grant is changed to hide that historical issue.
 await sql(db,`set role postgres;alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant all on sequences to service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
 create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 grant usage on schema public,storage to anon,authenticated,service_role;`);
 for(const file of migrations){
  let source=fs.readFileSync('supabase/migrations/'+file,'utf8');
  if(file==='20260729_0048_finance_bank_accounts.sql'){
   const begin=source.indexOf('update public.payables p set bank_account_id=a.id');
   const end=source.indexOf('grant select,insert,update on public.finance_bank_accounts',begin);
   if(begin<0||end<begin)throw Error('Native data-backfill boundary changed');
   source=source.slice(0,begin)+source.slice(end);
  }
  try{await sql(db,'set role postgres;\n'+source);}
  catch(e){throw Error('Native migration '+file+': '+e.message);}
 }
}
