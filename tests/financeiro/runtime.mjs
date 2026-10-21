import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import ts from 'typescript';
export const exec = promisify(execFile);
export const image = 'postgres@sha256:a63c1ea3f6a3a5a1621f97d2aba3b30faecfab4224c1b0000cc85ced57bb1939';
export const ids = Object.fromEntries(['ua','ub','ur','ug','a','b','a1','a2','b1','pa1','pa2','pb1','sa','sb','bank1','bank2','bankb','t1','t2','tb','ca','cb','u1','u2','ub1','sale1','sale2','saleb','r1','r2','rb'].map((k,i)=>[k,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
function fictitiousCnpj(base) {
  const digit=(s,weights)=>{const r=[...s].reduce((n,d,i)=>n+Number(d)*weights[i],0)%11;return r<2?0:11-r;};
  const first=base+digit(base,[5,4,3,2,9,8,7,6,5,4,3,2]);
  return first+digit(first,[6,5,4,3,2,9,8,7,6,5,4,3,2]);
}
export function compile(file, dependencies={}) {
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};
  new Function('require','module','exports',code)(name=>{if(!(name in dependencies))throw Error(name);return dependencies[name]},m,m.exports);
  return m.exports;
}
export function sql(container, text, database='elos_finance_test') {
  if(!/^elos-finance-test-\d+$/.test(container)||!/^elos_(finance_test|restore_[a-z_]+)$/.test(database))throw Error('Destino fora do ambiente descartável');
  return new Promise((resolve,reject)=>{
    const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-At','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
    let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);
    p.on('close',code=>code===0?resolve(out.trim()):reject(Error(err.trim())));p.stdin.end(text);
  });
}
export const asUser=(user,text)=>`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${user}',true); ${text}; commit;`;
export async function start() {
  const container=`elos-finance-test-${process.pid}`;
  await exec('docker',['run','--detach','--name',container,'--label','elos.finance.validation=true','--network','none','--memory','1g','--cpus','2','--tmpfs','/var/lib/postgresql/data:rw,size=512m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
  try {
    for(let i=0;;i++) {try{await exec('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch(e){if(i>100)throw e;await new Promise(r=>setTimeout(r,100));}}
    await exec('docker',['exec',container,'createdb','-U','postgres','elos_finance_test']);
    return container;
  } catch(e) {await exec('docker',['rm','-f',container]);throw e;}
}
export async function bootstrap(container) {
  await sql(container,`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema storage;create schema extensions;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
  const migrations=['20260722_0001_multitenancy.sql','20260722_0002_suppliers_clients.sql','20260722_0003_flow_payables.sql','20260723_0004_flow_sales.sql','20260723_0005_receivables.sql','20260727_0030_legal_entities.sql'];
  for(const name of migrations)await sql(container,fs.readFileSync('supabase/migrations/'+name,'utf8'));
  // Prerequisites normally added by correction/role migrations; not financial oracles.
  await sql(container,`alter table receivables add adjusted_amount numeric(16,2),add correction_locked boolean default false;
    alter table roles add status text default 'active';`);
  for(const name of ['20260729_0048_finance_bank_accounts.sql','20260729_0048a_finance_bank_accounts_security_fix.sql','20261013223527_finance_bank_operations.sql'])await sql(container,fs.readFileSync('supabase/migrations/'+name,'utf8'));
  const permission=fs.readFileSync('supabase/migrations/20260810_0081_owner_admin_full_access.sql','utf8').match(/create or replace function public.has_company_permission\([\s\S]*?\$\$;/)[0];
  await sql(container,permission);
  await sql(container,`insert into auth.users(id,email) values ${['ua','ub','ur','ug'].map(k=>`('${ids[k]}','${k}@example.invalid')`).join(',')};
    insert into companies(id,name,slug,created_by) values('${ids.a}','Fictícia A','fixture-a','${ids.ua}'),('${ids.b}','Fictícia B','fixture-b','${ids.ub}');
    insert into legal_entities(id,company_id,legal_name,cnpj) values('${ids.a1}','${ids.a}','A1','${fictitiousCnpj('990000010001')}'),('${ids.a2}','${ids.a}','A2','${fictitiousCnpj('990000020001')}'),('${ids.b1}','${ids.b}','B1','${fictitiousCnpj('990000030001')}');
    insert into projects(id,company_id,legal_entity_id,name,created_by) values('${ids.pa1}','${ids.a}','${ids.a1}','OA1','${ids.ua}'),('${ids.pa2}','${ids.a}','${ids.a2}','OA2','${ids.ua}'),('${ids.pb1}','${ids.b}','${ids.b1}','OB','${ids.ub}');
    insert into roles(company_id,key,name) values('${ids.a}','finance','Finance'),('${ids.a}','viewer','Leitura'),('${ids.b}','finance','Finance');
    insert into role_permissions(role_id,permission_key) select r.id,p.key from roles r cross join permissions p where p.key in('payables.view','receivables.view','finance.bank_accounts.view') or (r.key='finance' and p.key in('payables.manage','receivables.manage','finance.bank_accounts.manage','finance.bank_accounts.transfer','finance.bank_accounts.reconcile')) on conflict do nothing;
    insert into company_memberships(company_id,user_id,role_id) select r.company_id,u.id,r.id from roles r join auth.users u on (r.company_id='${ids.a}' and ((u.id in('${ids.ua}','${ids.ug}') and r.key='finance') or (u.id='${ids.ur}' and r.key='viewer'))) or (r.company_id='${ids.b}' and u.id in('${ids.ub}','${ids.ug}') and r.key='finance');
    insert into suppliers(id,company_id,legal_name) values('${ids.sa}','${ids.a}','Fornecedor fictício A'),('${ids.sb}','${ids.b}','Fornecedor fictício B');
    insert into clients(id,company_id,name) values('${ids.ca}','${ids.a}','Cliente fictício A'),('${ids.cb}','${ids.b}','Cliente fictício B');
    insert into units(id,company_id,project_id,code) values('${ids.u1}','${ids.a}','${ids.pa1}','U1'),('${ids.u2}','${ids.a}','${ids.pa2}','U2'),('${ids.ub1}','${ids.b}','${ids.pb1}','UB');
    insert into sales(id,company_id,project_id,unit_id,client_id,number,sale_date,total_amount) values
    ('${ids.sale1}','${ids.a}','${ids.pa1}','${ids.u1}','${ids.ca}','TEST-1','2026-01-01',1000),
    ('${ids.sale2}','${ids.a}','${ids.pa2}','${ids.u2}','${ids.ca}','TEST-2','2026-01-01',3000),
    ('${ids.saleb}','${ids.b}','${ids.pb1}','${ids.ub1}','${ids.cb}','TEST-B','2026-01-01',9000);
    insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,allow_negative,opening_balance,opening_balance_date) values
    ('${ids.bank1}','${ids.a}','${ids.a1}','A1','Fictício','1',true,10000,'2026-01-01'),('${ids.bank2}','${ids.a}','${ids.a2}','A2','Fictício','2',true,0,'2026-01-01'),('${ids.bankb}','${ids.b}','${ids.b1}','B1','Fictício','3',true,0,'2026-01-01');
    create schema validation;create table validation.cases(id text primary key,definition jsonb not null);`);
  const fixtures=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json','utf8'));
  for(const c of fixtures.cases)await sql(container,`insert into validation.cases values('${c.id}','${JSON.stringify(c).replaceAll("'","''")}'::jsonb);`);
}
