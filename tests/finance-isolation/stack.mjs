// Disposable local services. No production URL, credential or Koper connection.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {start,sql,exec,ids} from '../financeiro/runtime.mjs';
const images={auth:'supabase/gotrue@sha256:c485010238ab429edf4ac8eb70b37b41aae0a0905277a935d4a0b64bb848e393',rest:'postgrest/postgrest@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228',storage:'supabase/storage-api@sha256:3e3742049427313d167578ba7af753069947972b64fcc5374cfb750f66a26177'};
export async function stack(root){
 const network='elos-isolation-'+process.pid,containers=[],dir=fs.mkdtempSync(path.join(os.tmpdir(),'elos-isolation-'));
 const secret=crypto.randomBytes(48).toString('hex');
 const redact=s=>String(s).replaceAll(secret,'[test-secret]');
 const jwt=claims=>{const body=[{alg:'HS256',typ:'JWT'},{iss:'supabase-demo',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...claims}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');};
 const anonKey=jwt({role:'anon'}),serviceKey=jwt({role:'service_role'});
 let gateway,app,db,agentBefore;
 const log=(name,data)=>fs.writeFileSync(root+'/'+name,redact(data));
 async function run(name,image,env,extra=[]){const file=path.join(dir,name+'.env');fs.writeFileSync(file,Object.entries(env).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});
  const container=network+'-'+name;containers.push(container);
  await exec('docker',['run','-d','--name',container,'--label','elos.finance.isolation=true','--network',network,'--network-alias',name,'--env-file',file,...extra,image]);return container;
 }
 async function url(container,port){const {stdout}=await exec('docker',['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',container]);if(!/^\d+\.\d+\.\d+\.\d+$/.test(stdout.trim()))throw Error('Endereço privado indisponível');return 'http://'+stdout.trim()+':'+port;}
 async function ready(address,container){for(let i=0;i<120;i++){try{const r=await fetch(address,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}if(i%4===0){const {stdout}=await exec('docker',['inspect','--format','{{.State.Running}}',container]);if(stdout.trim()!=='true')break;}await new Promise(r=>setTimeout(r,250));}
  const {stdout,stderr}=await exec('docker',['logs','--tail','45',container]);log('erro-'+container.split('-').at(-1)+'.log',stdout+stderr);throw Error('Serviço isolado não ficou pronto: '+address);
 }
 async function close(){if(app){app.kill('SIGTERM');await new Promise(r=>setTimeout(r,500));}if(gateway)await new Promise(r=>gateway.close(r));
  for(const c of [...containers].reverse())try{await exec('docker',['rm','-f',c]);}catch{}
  if(db)try{await exec('docker',['rm','-f',db]);}catch{}
  try{await exec('docker',['network','rm',network]);}catch{}fs.rmSync(dir,{recursive:true,force:true});
  if(agentBefore){const current=fs.readFileSync('AGENTS.md','utf8'),outside=s=>s.replace(/<!-- BEGIN:nextjs-agent-rules -->[\s\S]*?<!-- END:nextjs-agent-rules -->/,'');if(outside(current)===outside(agentBefore))fs.writeFileSync('AGENTS.md',agentBefore);}
 }
 try{
  db=await start();await exec('docker',['network','create','--internal','--label','elos.finance.isolation=true',network]);await exec('docker',['network','disconnect','none',db]);await exec('docker',['network','connect','--alias','db',network,db]);
  await exec('docker',['exec',db,'createdb','-U','postgres','elos_auth_test']);
  await exec('docker',['exec',db,'psql','-U','postgres','-d','elos_auth_test','-c',"create schema auth;alter database elos_auth_test set search_path=auth,public;"]);
  const auth=await run('auth',images.auth,{GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:9999,API_EXTERNAL_URL:'http://localhost:9999',GOTRUE_SITE_URL:'http://localhost:3000',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:'postgres://postgres@db:5432/elos_auth_test?sslmode=disable',GOTRUE_DB_NAMESPACE:'auth',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_EXP:3600,GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_EXTERNAL_EMAIL_ENABLED:true,GOTRUE_MAILER_AUTOCONFIRM:true,GOTRUE_DISABLE_SIGNUP:false,GOTRUE_RATE_LIMIT_EMAIL_SENT:100},[]);
  const authURL=await url(auth,9999);await ready(authURL+'/health',auth);
  const actors={};
  for(const [key,company,profile,slot] of [['Aadmin','A','admin','ug'],['Afinance','A','finance','ua'],['Aviewer','A','viewer','ur'],['Aengineering','A','engineering','ae'],['Badmin','B','admin','ba'],['Bfinance','B','finance','ub'],['Bviewer','B','viewer','br'],['Bengineering','B','engineering','be']]){
   const email=key.toLowerCase()+'@example.invalid',password=crypto.randomBytes(24).toString('base64url')+'aA1!';
   const response=await fetch(authURL+'/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const data=await response.json();
   if(!response.ok||!data.user?.id)throw Error('Cadastro fictício recusado: '+response.status+' '+JSON.stringify(data));
   ids[slot]=data.user.id;actors[key]={id:data.user.id,email,password,company,profile,session:data};
  }
  // Existing migrations/fixtures are installed by the caller after real Auth IDs
  // are available. Auth has a separate disposable database; matching IDs are
  // seeded in the application auth.users scaffold, explicitly not remote parity.
  async function startHTTP(){
   await sql(db,`create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    grant execute on all functions in schema auth to anon,authenticated,service_role;
    create role authenticator login noinherit;grant anon,authenticated to authenticator;
    alter role service_role bypassrls;
    alter database elos_finance_test set storage.install_roles='false';
    alter role postgres in database elos_finance_test set search_path=storage,public;
    drop schema storage cascade;`);
   const rest=await run('rest',images.rest,{PGRST_DB_URI:'postgres://authenticator@db:5432/elos_finance_test',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_PORT:3000},[]);
   const restURL=await url(rest,3000);await ready(restURL+'/',rest);
   const storage=await run('storage',images.storage,{ANON_KEY:anonKey,SERVICE_KEY:serviceKey,POSTGREST_URL:'http://rest:3000',PGRST_JWT_SECRET:secret,AUTH_JWT_SECRET:secret,DATABASE_URL:'postgres://postgres@db:5432/elos_finance_test',FILE_SIZE_LIMIT:4000000,STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',TENANT_ID:'isolated',REGION:'local',GLOBAL_S3_BUCKET:'isolated',ENABLE_IMAGE_TRANSFORMATION:false},['--tmpfs','/var/lib/storage:rw,size=64m,mode=1777']);
   const storageURL=await url(storage,5000);await ready(storageURL+'/status',storage);
   gateway=http.createServer((req,res)=>{
    const route=[['/auth/v1',authURL],['/rest/v1',restURL],['/storage/v1',storageURL]].find(([prefix])=>req.url.startsWith(prefix));
    if(!route){res.writeHead(404);res.end();return;}
    const target=new URL(req.url.slice(route[0].length)||'/',route[1]);
    const upstream=http.request(target,{method:req.method,headers:{...req.headers,host:target.host}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
   });await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
   const gatewayURL='http://127.0.0.1:'+gateway.address().port;
   return {gatewayURL,authURL,restURL,storageURL,anonKey,serviceKey};
  }
  async function nextApp(gatewayURL){
   agentBefore=fs.readFileSync('AGENTS.md','utf8');
   const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
   const env={...process.env};for(const k of Object.keys(env))if(/^(SUPABASE|NEXT_PUBLIC_SUPABASE|OPENAI|KOPER|SEFAZ)/.test(k))delete env[k];
   Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:gatewayURL,NEXT_PUBLIC_SUPABASE_ANON_KEY:anonKey,NEXT_TELEMETRY_DISABLED:'1'});
   // Official next/font test hook: local font bytes, no Google request. This is
   // an isolation test, not typography certification. App/layout stays untouched.
   const font=fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')?'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf':'/usr/share/fonts/truetype/open-sans/OpenSans-Regular.ttf';
   const mock=path.join(dir,'fonts.cjs');fs.writeFileSync(mock,`module.exports=new Proxy({}, {get:(_,url)=>{const family=String(url).includes('IBM')?'IBM Plex Sans':'Space Grotesk';return "@font-face {font-family: '"+family+"';font-style: normal;font-weight: 100 900;src: url(${font}) format('truetype');}";}});`);
   env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES=mock;
   // Production compilation of the original financial routes in a temporary
   // project. No mock of the page, workspace, API, Supabase client or AppShell.
   // Other Elos routes are deliberately outside this certification perimeter.
   const site=path.join(dir,'site'),repo=process.cwd();fs.mkdirSync(site);
   fs.symlinkSync(path.join(repo,'node_modules'),path.join(site,'node_modules'),'dir');
   if(fs.existsSync('public'))fs.symlinkSync(path.join(repo,'public'),path.join(site,'public'),'dir');
   fs.copyFileSync('package.json',path.join(site,'package.json'));fs.copyFileSync('proxy.ts',path.join(site,'proxy.ts'));
   const nextConfig=fs.readFileSync('next.config.ts','utf8').replace('poweredByHeader: false,',`poweredByHeader: false,\n webpack(config){config.resolve.alias={...config.resolve.alias,'@':${JSON.stringify(repo)}};return config;},`);
   fs.writeFileSync(path.join(site,'next.config.ts'),nextConfig);
   const config=JSON.parse(fs.readFileSync('tsconfig.json'));config.compilerOptions.baseUrl=repo;config.compilerOptions.allowImportingTsExtensions=true;config.compilerOptions.paths={'@/*':['./*']};fs.writeFileSync(path.join(site,'tsconfig.json'),JSON.stringify(config,null,2));
   const routes={'app/layout.tsx':`export {default,metadata,viewport} from ${JSON.stringify(repo+'/app/layout.tsx')};`,
    'app/login/page.tsx':`export {default} from ${JSON.stringify(repo+'/app/login/page.tsx')};export const dynamic='force-dynamic';`,
    'app/financeiro/fluxo-de-caixa/page.tsx':`export {default} from ${JSON.stringify(repo+'/app/financeiro/fluxo-de-caixa/page.tsx')};export const dynamic='force-dynamic';`,
    'app/api/auth/login/route.ts':`export {POST} from ${JSON.stringify(repo+'/app/api/auth/login/route.ts')};`,
    'app/api/financeiro/fluxo-de-caixa/route.ts':`export {GET} from ${JSON.stringify(repo+'/app/api/financeiro/fluxo-de-caixa/route.ts')};export const dynamic='force-dynamic';export const runtime='nodejs';`,
    'app/api/financeiro/contas-bancarias/opcoes/route.ts':`export {GET} from ${JSON.stringify(repo+'/app/api/financeiro/contas-bancarias/opcoes/route.ts')};export const dynamic='force-dynamic';`};
   for(const [name,source] of Object.entries(routes)){const file=path.join(site,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);}
   const build=fs.openSync(root+'/next-build.log','w');
   try{await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[repo+'/node_modules/next/dist/bin/next','build','--webpack'],{cwd:site,env,stdio:['ignore',build,build]});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Build isolado recusado: '+code+'; ver next-build.log')));});}finally{fs.closeSync(build);}
   const fd=fs.openSync(root+'/next.log','w');app=spawn(process.execPath,[repo+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:site,env,stdio:['ignore',fd,fd]});fs.closeSync(fd);
   const address='http://127.0.0.1:'+port;
   for(let i=0;i<120;i++){try{if((await fetch(address+'/login',{signal:AbortSignal.timeout(1500)})).ok)return address;}catch{}await new Promise(r=>setTimeout(r,500));}throw Error('Next isolado não ficou pronto');
  }
  return {db,actors,startHTTP,nextApp,close,images,redact,jwt};
 }catch(e){await close();throw Error(redact(e.message));}
}
