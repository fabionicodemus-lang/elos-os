import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {stack} from './stack.mjs';
import {setup,storagePolicies} from './setup.mjs';
import {nativeContractFunctions} from './native.mjs';
import {sql,compile} from '../financeiro/runtime.mjs';
import {lastJson} from '../finance-partials/client.mjs';
import {loadCashflow} from '../finance-partials/loaders.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=process.env.FINANCE14_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa14-isolamento/evidencias';
fs.mkdirSync(root,{recursive:true});const records=[],baseline=[],permissions=[];let services,browser,fatalError=null,completed=false;
const migration='supabase/migrations/20261025100000_contract_refresh_tenant_guards.sql';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function persist(){fs.writeFileSync(root+'/tentativas.json',JSON.stringify(records,null,2)+'\n');}
async function check(id,actor,target,expected,fn){try{const actual=await fn();records.push({id,identity:actor?{id:actor.id,email:actor.email,company:actor.company,profile:actor.profile}:null,target,expected,actual,passed:true});}
 catch(e){records.push({id,identity:actor?{id:actor.id,email:actor.email,company:actor.company,profile:actor.profile}:null,target,expected,passed:false,error:services?.redact(e.message)??e.message});}persist();}
const denied=(response)=>{assert.ok(response.status>=400&&response.status<500,'Negação deve ser4xx, obtido'+response.status);};
const tokenHeaders=actor=>actor?{Authorization:'Bearer '+actor.session.access_token}:{};
try{
 console.log('Auth real, oito identidades fictícias');services=await stack(root);
 const data=await setup(services.db,services.actors),native=await nativeContractFunctions(services.db);
 await sql(services.db,`insert into execution_service_contract_items(company_id,project_id,contract_id,total_value) values('${data.A.company}','${data.A.project}','${data.A.contract}',29000),('${data.B.company}','${data.B.project}','${data.B.contract}',90000);
 insert into execution_service_contract_amendments(company_id,project_id,contract_id,value_change) values('${data.A.company}','${data.A.project}','${data.A.contract}',1000),('${data.B.company}','${data.B.project}','${data.B.contract}',10000);
 insert into execution_contract_measurements(id,company_id,project_id,contract_id,status,gross_amount,contractual_retention_amount,guarantee_retention_amount,net_amount) values('${crypto.randomUUID()}','${data.B.company}','${data.B.project}','${data.B.contract}','approved',20000,2000,0,18000);`);
 console.log('PostgREST e Storage reais');const http=await services.startHTTP(),storagePolicy=await storagePolicies(services.db);
 const clients=Object.fromEntries(Object.entries(services.actors).map(([key,a])=>[key,createClient(http.gatewayURL,http.anonKey,{global:{headers:tokenHeaders(a)},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})]));
 const rest=async(actor,path,method='GET',body=null,headers={})=>{const r=await fetch(http.restURL+'/'+path,{method,headers:{...tokenHeaders(actor),'Content-Type':'application/json',...headers},...(body===null?{}:{body:JSON.stringify(body)})});const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};};
 const rpc=(actor,name,args)=>rest(actor,'rpc/'+name,'POST',args);
 const contracts=()=>sql(services.db,'select jsonb_agg(to_jsonb(c) order by id) from execution_service_contracts c').then(lastJson);
 // Demonstrate before correction. Knowing B's UUID must not authorize A or anon.
 for(const [name,actor] of [['refresh_execution_service_contract_value',services.actors.Afinance],['refresh_execution_service_contract_measurements',services.actors.Aengineering],['refresh_execution_service_contract_value',null]]){
  const before=await contracts(),actual=await rpc(actor,name,{p_contract_id:data.B.contract}),after=await contracts();
  baseline.push({function:name,identity:actor?{id:actor.id,company:actor.company,profile:actor.profile}:null,target_company:'B',target_id:data.B.contract,expected:'Negado; nenhum valor privado ou alteração na outra empresa',actual,before,after,unauthorized_success:actual.status>=200&&actual.status<300});
  await sql(services.db,`update execution_service_contracts set current_value=90000,original_value=0,amendments_value=0,measured_value=0,retained_value=0,invoiced_value=0,paid_value=0 where id='${data.B.contract}'`);
 }
 fs.writeFileSync(root+'/vulnerabilidades-antes.json',JSON.stringify(baseline,null,2)+'\n');
 assert.ok(baseline.every(b=>b.unauthorized_success),'A falha deve ser demonstrada antes da alteração');
 if(process.argv.includes('--baseline-only')){console.log('Causas demonstradas por HTTP real, sem correção aplicada');process.exitCode=0;}
 else{
  if(!fs.existsSync(migration))throw Error('Baseline pronto; migração candidata ainda não criada');
  const beforeDefinitions=lastJson(await sql(services.db,"select jsonb_object_agg(proname,prosrc) from pg_proc where oid in('public.refresh_execution_service_contract_value(uuid)'::regprocedure,'public.refresh_execution_service_contract_measurements(uuid)'::regprocedure)"));
  await sql(services.db,fs.readFileSync(migration,'utf8'));await sql(services.db,"notify pgrst,'reload schema'");
  const afterDefinitions=lastJson(await sql(services.db,"select jsonb_object_agg(proname,prosrc) from pg_proc where oid in('public.refresh_execution_service_contract_value(uuid)'::regprocedure,'public.refresh_execution_service_contract_measurements(uuid)'::regprocedure)"));
  const unchanged={};for(const [name,body] of Object.entries(afterDefinitions)){const stripped=body.replace(/\n-- E14_TENANT_GUARD_BEGIN[\s\S]*?-- E14_TENANT_GUARD_END\n/,'');assert.equal(stripped,beforeDefinitions[name]);unchanged[name]={original_sha256:hash(beforeDefinitions[name]),financial_body_after_removing_guard_sha256:hash(stripped)};}
  fs.writeFileSync(root+'/formulas-preservadas.json',JSON.stringify(unchanged,null,2)+'\n');
  // Real password authentication and invalid credentials; never persist secrets/tokens.
  for(const [key,a] of Object.entries(services.actors)){
   await check(key+'-login',a,{channel:'Auth/password'},'Autenticar a própria identidade',async()=>{
    const r=await fetch(http.authURL+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:a.email,password:a.password})});const body=await r.json();assert.equal(r.status,200);assert.equal(body.user.id,a.id);a.session=body;return {status:r.status,authenticated_user_id:body.user.id};});
   await check(key+'-senha-incorreta',a,{channel:'Auth/password'},'Negado, sem sessão',async()=>{const r=await fetch(http.authURL+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:a.email,password:'INVALID-ONLY-FICTIONAL'})});assert.ok(r.status>=400&&r.status<500);const b=await r.json();assert.equal(b.access_token,undefined);return {status:r.status,code:b.error_code};});
   const own=data[a.company],foreign=data[a.company==='A'?'B':'A'];
   for(const p of ['payables.view','payables.manage','receivables.view','receivables.manage','finance.bank_accounts.view','cashflow.view','execution.contracts.view','execution.contracts.manage']){
    const ownResult=await clients[key].rpc('has_company_permission',{target_company_id:own.company,target_permission:p});const foreignResult=await clients[key].rpc('has_company_permission',{target_company_id:foreign.company,target_permission:p});
    assert.equal(ownResult.error,null);assert.equal(foreignResult.error,null);assert.equal(foreignResult.data,false);
    permissions.push({identity:{id:a.id,email:a.email,company:a.company,profile:a.profile},permission:p,expected_foreign:false,observed_foreign:foreignResult.data,observed_own:ownResult.data,source:'has_company_permission:0081 + configuração declarada da fixture; não matriz nominal real'});
   }
   for(const [table,id,permission] of [['payables',foreign.ap,'payables.view'],['receivables',foreign.ar,'receivables.view'],['execution_service_contracts',foreign.contract,'execution.contracts.view'],['finance_bank_accounts',foreign.account,'finance.bank_accounts.view']]){
    await check(key+'-ID-'+table,a,{channel:'REST',company:foreign.company,table,id},'200 sem linhas estrangeiras, mesmo conhecendo UUID',async()=>{const actual=await rest(a,table+'?id=eq.'+id);assert.equal(actual.status,200);assert.deepEqual(actual.body,[]);return actual;});
    await check(key+'-filtro-'+table,a,{channel:'REST',company:foreign.company,table},'Filtro de empresa estrangeira não retorna dados',async()=>{const actual=await rest(a,table+'?company_id=eq.'+foreign.company);assert.equal(actual.status,200);assert.deepEqual(actual.body,[]);return actual;});
    const expectedOwn=permissions.find(p=>p.identity.id===a.id&&p.permission===permission).observed_own;
    const ownId=table==='payables'?own.ap:table==='receivables'?own.ar:table==='finance_bank_accounts'?own.account:own.contract;
    await check(key+'-legitimo-'+table,a,{channel:'REST',company:own.company,table,id:ownId},expectedOwn?'Uma linha própria':'Sem permissão: nenhuma linha',async()=>{const actual=await rest(a,table+'?id=eq.'+ownId);assert.equal(actual.status,200);assert.equal(actual.body.length,expectedOwn?1:0);return {status:actual.status,rows:actual.body.length};});
   }
   for(const [table,id,changes] of [['payables',foreign.ap,{amount:1}],['receivables',foreign.ar,{amount:1}],['execution_service_contracts',foreign.contract,{current_value:1}]]){
    await check(key+'-mutacao-'+table,a,{channel:'REST PATCH',company:foreign.company,table,id},'Nenhuma alteração estrangeira',async()=>{const actual=await rest(a,table+'?id=eq.'+id,'PATCH',changes,{Prefer:'return=representation'});assert.ok([200,204,403].includes(actual.status));if(actual.status<400)assert.deepEqual(actual.body,[]);return actual;});
   }
   for(const name of ['refresh_execution_service_contract_value','refresh_execution_service_contract_measurements']){
    await check(key+'-RPC-'+name,a,{channel:'REST RPC',company:foreign.company,id:foreign.contract},'403; nenhum recálculo estrangeiro',async()=>{const before=await contracts(),actual=await rpc(a,name,{p_contract_id:foreign.contract});assert.equal(actual.status,403);assert.deepEqual(await contracts(),before);return actual;});
   }
   for(const table of ['finance_settlement_events','finance_settlement_lines','finance_bank_transactions','finance_title_audit','execution_service_contract_items','execution_service_contract_amendments']){
    const present=lastJson(await sql(services.db,`select jsonb_build_object('n',count(*)) from ${table} where company_id='${foreign.company}'`)).n;
    assert.ok(present>0);
    await check(key+'-linhas-financeiras-'+table,a,{channel:'REST filter',company:foreign.company,table,source_rows:present},'Nenhum evento/valor estrangeiro',async()=>{const actual=await rest(a,table+'?company_id=eq.'+foreign.company);assert.equal(actual.status,200);assert.deepEqual(actual.body,[]);return actual;});
   }
   await check(key+'-revisao-propria',a,{channel:'REST RPC',company:own.company,id:own.ap},canOwnWrite()?'Operação própria permitida sem mudar valor':'Perfil sem gestão não pode revisar',async()=>{
    const current=await rest(services.actors[a.company+'admin'],'payables?id=eq.'+own.ap);assert.equal(current.status,200);const t=current.body[0];
    const actual=await rpc(a,'revise_finance_payable',{p_company:own.company,p_title:own.ap,p_command:crypto.randomUUID(),p_expected_version:t.finance_version,p_amount:t.amount,p_due:t.due_date,p_effective:'2026-10-21',p_reason:'Conferência de autorização fictícia, preservando valor e vencimento'});
    if(canOwnWrite()){assert.equal(actual.status,200);assert.equal(actual.body,own.ap);}else{assert.equal(actual.status,400);assert.equal(actual.body.code,'P0001');assert.equal(actual.body.message,'Sem permissão.');}return actual;
   });
   function canOwnWrite(){return permissions.find(p=>p.identity.id===a.id&&p.permission==='payables.manage').observed_own;}
   await check(key+'-RPC-liquidar-outra-empresa',a,{channel:'REST RPC',company:foreign.company,id:foreign.ap},'Negado',async()=>{const actual=await rpc(a,'settle_finance_titles',{p_company:foreign.company,p_command:crypto.randomUUID(),p_account:foreign.account,p_date:'2026-10-21',p_lines:[{type:'AP',title_id:foreign.ap,principal:1}],p_reason:'Tentativa indevida fictícia'});denied(actual);return actual;});
   await check(key+'-importacao-privada',a,{channel:'REST RPC',company:foreign.company,function:'elos_import.apply_financial_batch'},'Rotina privada não exposta a usuário',async()=>{const actual=await rpc(a,'apply_financial_batch',{p_company:foreign.company,p_command:crypto.randomUUID(),p_batch:{}});assert.equal(actual.status,404);return actual;});
   await check(key+'-worker-sem-permissao-estrangeira',a,{channel:'SQL trusted-worker claims',company:foreign.company,function:'elos_import.apply_financial_batch'},'Checar empresa antes de processar manifesto',async()=>{await assert.rejects(()=>sql(services.db,`begin;select set_config('request.jwt.claim.sub','${a.id}',true);select elos_import.apply_financial_batch('${foreign.company}','${crypto.randomUUID()}','{}'::jsonb);commit;`),/Sem permissão financeira/);return {blocked:true,reason:'Sem permissão financeira',koper_remote_called:false};});
   await check(key+'-indicador-estrangeiro',a,{channel:'loadCashflow/REST',company:foreign.company,id:foreign.entity},'Negar perímetro financeiro estrangeiro',async()=>{await assert.rejects(()=>loadCashflow({supabase:clients[key],companyId:foreign.company,projectId:null,entityId:foreign.entity,cutoff:'2026-10-21',from:'2026-10-01'}),/Entidade indisponível|Entidade sem autorização/);return {blocked:true,reason:'Entidade indisponível ou sem autorização financeira'};});
   // Only the exercised dispatcher/tool and actual financial loader are used.
   const source=ts.transpileModule(fs.readFileSync('lib/elos-ia/tools.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   let loaderFailure=null;
   const deps=Object.fromEntries([...source.matchAll(/require\("([^"]+)"\)/g)].map(m=>[m[1],{}]));deps['@/lib/finance-core/cashflow-server']={loadCashflow:async args=>{try{return await loadCashflow(args);}catch(e){loaderFailure=e.message;throw e;}}};const tools=compile('lib/elos-ia/tools.ts',deps);
   const can=p=>permissions.find(row=>row.identity.id===a.id&&row.permission===p)?.observed_own===true;
   await check(key+'-IA-estrangeira',a,{channel:'Ferramenta IA/REST',company:foreign.company,id:foreign.entity},'Erro de autorização/perímetro, sem dados',async()=>{
    const actual=await tools.runElosIaTool({supabase:clients[key],companyId:own.company,activeProjectId:null,projects:[],today:'2026-10-21',can,cache:new Map()},['fluxo_de_caixa'],'fluxo_de_caixa',{obra:'todas',entidade_id:foreign.entity});assert.ok(actual.erro);if(loaderFailure)assert.match(loaderFailure,/Entidade indisponível|Entidade sem autorização/);else assert.match(actual.erro,/não tem permissão/);assert.ok(!JSON.stringify(actual).includes(foreign.contract));return {...actual,observed_loader_denial:loaderFailure};});
  }
  for(const name of ['refresh_execution_service_contract_value','refresh_execution_service_contract_measurements'])await check('anon-'+name,null,{channel:'REST RPC',company:'B',id:data.B.contract},'Sem autenticação, negado',async()=>{const actual=await rpc(null,name,{p_contract_id:data.B.contract});denied(actual);return actual;});
  await check('JWT-adulterado',services.actors.Afinance,{channel:'PostgREST JWT',company:'B'},'401: assinatura inválida',async()=>{const parts=services.actors.Afinance.session.access_token.split('.');parts[1]=Buffer.from(JSON.stringify({sub:services.actors.Afinance.id,role:'service_role',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');const r=await fetch(http.restURL+'/payables',{headers:{Authorization:'Bearer '+parts.join('.')}});assert.equal(r.status,401);return {status:r.status};});
  await check('JWT-expirado',services.actors.Afinance,{channel:'PostgREST JWT',company:'A'},'401: token expirado',async()=>{const r=await fetch(http.restURL+'/payables',{headers:{Authorization:'Bearer '+services.jwt({sub:services.actors.Afinance.id,role:'authenticated',exp:Math.floor(Date.now()/1000)-60})}});assert.equal(r.status,401);return {status:r.status};});
  await check('propria-empresa-recalculo-legitimo',services.actors.Bfinance,{channel:'REST RPC',company:'B',id:data.B.contract},'V90.000+aditivo10.000=100.000; medição20.000/retenção2.000',async()=>{
   assert.equal((await rpc(services.actors.Bfinance,'refresh_execution_service_contract_value',{p_contract_id:data.B.contract})).body,100000);
   assert.equal((await rpc(services.actors.Bfinance,'refresh_execution_service_contract_measurements',{p_contract_id:data.B.contract})).status,204);
   const b=(await contracts()).find(c=>c.id===data.B.contract);assert.equal(b.current_value,100000);assert.equal(b.measured_value,20000);assert.equal(b.retained_value,2000);return {current_value:b.current_value,measured_value:b.measured_value,retained_value:b.retained_value};});
  // Real file upload, URL signing, authenticated and public download endpoints.
  for(const company of ['A','B']){
   const s=data[company],content=Buffer.from('%PDF-1.4\n'+company+' DOCUMENTO INTEIRAMENTE FICTICIO\n%%EOF'),path=s.company+'/'+s.account+'/ficticio.pdf';s.documentPath=path;
   const upload=await clients[company+'finance'].storage.from('bank-documents').upload(path,content,{contentType:'application/pdf'});assert.equal(upload.error,null);
   const registered=await clients[company+'finance'].rpc('bank_save_document',{p_account:s.account,p_transaction:null,p_name:'ficticio.pdf',p_path:path,p_kind:'receipt'});
   assert.equal(registered.error,null);s.documentRegistration=registered.data;
  }
  for(const [key,a] of Object.entries(services.actors)){
   const own=data[a.company],foreign=data[a.company==='A'?'B':'A'],ownCan=permissions.find(p=>p.identity.id===a.id&&p.permission==='finance.bank_accounts.view').observed_own;
   await check(key+'-arquivo-foreign',a,{channel:'Storage download',company:foreign.company,path:foreign.documentPath},'Negado, sem bytes financeiros',async()=>{const actual=await clients[key].storage.from('bank-documents').download(foreign.documentPath);assert.ok(actual.error);assert.equal(actual.data,null);return {blocked:true,status:actual.error.statusCode,message:actual.error.message};});
   await check(key+'-URL-foreign',a,{channel:'Storage sign',company:foreign.company,path:foreign.documentPath},'Negado; não emitir URL',async()=>{const actual=await clients[key].storage.from('bank-documents').createSignedUrl(foreign.documentPath,300);assert.ok(actual.error);assert.equal(actual.data,null);return {blocked:true,status:actual.error.statusCode,message:actual.error.message};});
   await check(key+'-arquivo-proprio',a,{channel:'Storage download',company:own.company,path:own.documentPath},ownCan?'Download autorizado':'Sem permissão bancária, negar',async()=>{const actual=await clients[key].storage.from('bank-documents').download(own.documentPath);if(ownCan){assert.equal(actual.error,null);assert.ok((await actual.data.text()).includes(a.company+' DOCUMENTO'));}else assert.ok(actual.error);return {downloaded:!actual.error,status:actual.error?.statusCode??200};});
   await check(key+'-upload-foreign',a,{channel:'Storage upload',company:foreign.company,path:foreign.company+'/'+foreign.account+'/invasao.pdf'},'Negar criação em caminho estrangeiro',async()=>{const actual=await clients[key].storage.from('bank-documents').upload(foreign.company+'/'+foreign.account+'/invasao.pdf',Buffer.from('%PDF ficticio'),{contentType:'application/pdf'});assert.ok(actual.error);return {blocked:true,status:actual.error.statusCode,message:actual.error.message};});
   await check(key+'-metadados-documento-foreign',a,{channel:'REST document ID',company:foreign.company,table:'finance_bank_documents',id:foreign.documentRegistration},'Não revelar metadados do documento estrangeiro',async()=>{const actual=await rest(a,'finance_bank_documents?id=eq.'+foreign.documentRegistration);assert.equal(actual.status,200);assert.deepEqual(actual.body,[]);return actual;});
   await check(key+'-excluir-arquivo-foreign',a,{channel:'Storage DELETE',company:foreign.company,path:foreign.documentPath},'Não excluir documento estrangeiro',async()=>{const actual=await clients[key].storage.from('bank-documents').remove([foreign.documentPath]);if(!actual.error)assert.deepEqual(actual.data,[]);const exists=await clients[(a.company==='A'?'B':'A')+'finance'].storage.from('bank-documents').download(foreign.documentPath);assert.equal(exists.error,null);return {status:actual.error?.statusCode??200,removed_count:actual.data?.length??0,foreign_file_preserved:true};});
  }
  await check('URL-publica-bucket-privado',null,{channel:'Storage public URL',company:'B',path:data.B.documentPath},'Negado mesmo com caminho conhecido',async()=>{const r=await fetch(http.storageURL+'/object/public/bank-documents/'+data.B.documentPath);denied(r);return {status:r.status};});
  const signed=await clients.Bfinance.storage.from('bank-documents').createSignedUrl(data.B.documentPath,1);assert.equal(signed.error,null);
  const bearer=await fetch(signed.data.signedUrl);assert.equal(bearer.status,200);await new Promise(r=>setTimeout(r,2100));const expired=await fetch(signed.data.signedUrl);
  fs.writeFileSync(root+'/url-assinada.json',JSON.stringify({url_sha256:hash(signed.data.signedUrl),full_url_not_recorded:true,fresh_without_session_status:bearer.status,expired_status:expired.status,meaning:'URL assinada é credencial portadora temporária; não é apenas o identificador. Dependência de decisão se documentos exigirem reautenticação por usuário em cada download.'},null,2)+'\n');
  assert.ok(expired.status>=400);
  console.log('Next e navegador reais');const appURL=await services.nextApp(http.gatewayURL);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext();
  const exposedServiceKey=[];
  context.on('response',async response=>{if(response.url().startsWith(appURL)&&/javascript|html|json/.test(response.headers()['content-type']??'')){try{if((await response.text()).includes(http.serviceKey))exposedServiceKey.push(response.url());}catch{}}});
  for(const [key,a] of Object.entries(services.actors)){
   const page=await context.newPage();await page.goto(appURL+'/login');await page.locator('input[name=email]').fill(a.email);await page.locator('input[name=password]').first().fill(a.password);
   const loginResponse=page.waitForResponse(r=>r.url().includes('/api/auth/login'));await page.locator('form[action="/api/auth/login"] button[type=submit]').click();await loginResponse;
   const own=data[a.company],foreign=data[a.company==='A'?'B':'A'],ownCan=permissions.find(p=>p.identity.id===a.id&&p.permission==='cashflow.view').observed_own;
   await context.addCookies([{name:'elos_company_id',value:own.company,url:appURL},{name:'elos_project_id',value:'__company_overview__',url:appURL}]);
   await check(key+'-UI-propria',a,{channel:'Chromium/Next',company:own.company,path:'/financeiro/fluxo-de-caixa'},ownCan?'Página própria200':'Redirecionamento por falta de permissão',async()=>{
    const r=await context.request.get(appURL+'/financeiro/fluxo-de-caixa?cutoff=2026-10-21&entity='+own.entity,{maxRedirects:0});if(ownCan)assert.equal(r.status(),200);else assert.ok([303,307].includes(r.status()));const body=await r.text();assert.ok(!body.includes(foreign.contract));return {status:r.status(),location:r.headers().location??null,foreign_record_occurrences:0};});
   await check(key+'-UI-ID-estrangeiro',a,{channel:'Chromium/Next URL',company:foreign.company,id:foreign.entity},'Não mostrar o dado; mensagem uniforme ou redirecionamento por perfil',async()=>{
    const r=await context.request.get(appURL+'/financeiro/fluxo-de-caixa?cutoff=2026-10-21&entity='+foreign.entity,{maxRedirects:0});const body=await r.text();if(ownCan){assert.equal(r.status(),200);assert.ok(body.includes('Perímetro indisponível'));}else assert.ok([303,307].includes(r.status()));assert.ok(!body.includes(foreign.contract));return {status:r.status(),foreign_record_occurrences:0};});
   await check(key+'-exportacao-propria',a,{channel:'Next HTTP export',company:own.company},ownCan?'JSON da própria empresa':'Negar por perfil',async()=>{
    const r=await context.request.get(appURL+'/api/financeiro/fluxo-de-caixa?cutoff=2026-10-21&entity='+own.entity,{maxRedirects:0});if(ownCan){assert.equal(r.status(),200);const b=await r.json();assert.equal(b.company_id,own.company);assert.equal(b.indicators.known_obligations_subtotal_cents,a.company==='A'?700000:8000000);assert.equal(r.headers()['cache-control'],'private, no-store');return {status:r.status(),company_id:b.company_id,open_cents:b.indicators.known_obligations_subtotal_cents};}assert.ok([303,307].includes(r.status()));return {status:r.status()};});
   await check(key+'-cookie-empresa-forjada',a,{channel:'Chromium cookies/Next',company:foreign.company},'Não assumir empresa estrangeira',async()=>{
    await context.addCookies([{name:'elos_company_id',value:foreign.company,url:appURL},{name:'elos_project_id',value:foreign.project,url:appURL}]);
    const r=await context.request.get(appURL+'/api/financeiro/fluxo-de-caixa?cutoff=2026-10-21',{maxRedirects:0});if(ownCan){assert.equal(r.status(),200);const b=await r.json();assert.equal(b.company_id,own.company);return {status:r.status(),resolved_company:b.company_id,foreign_cookie_ignored:true};}assert.ok([303,307].includes(r.status()));return {status:r.status()};});
   await check(key+'-exportacao-ID-estrangeiro',a,{channel:'Next HTTP export',company:foreign.company,id:foreign.entity},'Negar, sem dados estrangeiros',async()=>{
    const r=await context.request.get(appURL+'/api/financeiro/fluxo-de-caixa?cutoff=2026-10-21&entity='+foreign.entity,{maxRedirects:0});assert.ok([303,307,403,404].includes(r.status()),'Código de negação controlado, obtido'+r.status());const body=await r.text();assert.ok(!body.includes(foreign.contract));return {status:r.status()};});
   if(ownCan){await page.goto(appURL+'/financeiro/fluxo-de-caixa?cutoff=2026-10-21&entity='+own.entity);await page.screenshot({path:root+'/UI-'+key+'.png',fullPage:true});}
   await page.close();
  }
  await context.close();
  assert.deepEqual(exposedServiceKey,[],'A chave privilegiada da fixture não pode chegar ao navegador');
  const ledger=lastJson(await sql(services.db,"select jsonb_build_object('AP',(select jsonb_agg(jsonb_build_object('company_id',company_id,'open',finance_open_amount)) from payables),'AR',(select jsonb_agg(jsonb_build_object('company_id',company_id,'open',finance_open_amount)) from receivables),'events',(select count(*) from finance_settlement_events),'cash',(select count(*) from finance_bank_transactions))"));
  assert.equal(ledger.events,4);assert.equal(ledger.cash,4);assert.deepEqual(ledger.AP.map(r=>r.open).sort((a,b)=>a-b),[7000,80000]);assert.deepEqual(ledger.AR.map(r=>r.open).sort((a,b)=>a-b),[3000,40000]);
  fs.writeFileSync(root+'/integridade-financeira.json',JSON.stringify({expected:{AP_A:7000,AP_B:80000,AR_A:3000,AR_B:40000,settlement_events:4,bank_movements:4},actual:ledger,financial_formulas_changed:false},null,2)+'\n');
  const policyInventory=lastJson(await sql(services.db,"select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'view_options',c.reloptions,'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','storage') and c.relkind in('r','v')"));
  fs.writeFileSync(root+'/politicas-banco.json',JSON.stringify(policyInventory,null,2)+'\n');
  fs.writeFileSync(root+'/ambiente.json',JSON.stringify({images:services.images,companies:data,actors:Object.fromEntries(Object.entries(services.actors).map(([k,a])=>[k,{id:a.id,email:a.email,company:a.company,profile:a.profile}])),auth:'GoTrue real/password; separate disposable Auth DB with matching app IDs',data_api:'PostgREST real JWT verification + RLS',storage:'Storage API real, file backend in tmpfs, original policies reinstalled',network:'private Docker internal network; localhost gateway and Next only',UI:'Production build of original financial routes reexported in a temporary Next project; not a full OS build',typography:'Official next/font test hook with local font bytes; layout and business components unchanged',service_key_occurrences_in_browser:exposedServiceKey.length,native_functions:native,storage_policies:storagePolicy},null,2)+'\n');
 }
 completed=true;
}catch(e){fatalError=services?.redact(e.message)??e.message;console.error(services?.redact(e.stack)??e.message);process.exitCode=1;}
finally{
 if(browser)await browser.close();if(services)await services.close();
 fs.writeFileSync(root+'/permissoes.json',JSON.stringify(permissions,null,2)+'\n');
 fs.writeFileSync(root+'/resultado.json',JSON.stringify({executed_at:new Date().toISOString(),completed,fatal_error:fatalError,passed:records.filter(r=>r.passed).length,failed:records.filter(r=>!r.passed).length,failures:records.filter(r=>!r.passed).map(r=>({id:r.id,error:r.error})),resources_removed:true,production_or_koper_access:false},null,2)+'\n');
 if(records.some(r=>!r.passed))process.exitCode=1;console.log(JSON.stringify({passed:records.filter(r=>r.passed).length,failed:records.filter(r=>!r.passed).map(r=>r.id)}));
}
