import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve(process.env.FINANCE14_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa14-isolamento/evidencias');fs.mkdirSync(root,{recursive:true});
const env={...process.env,DOCKER_HOST:'unix:///var/run/docker.sock',FINANCE14_EVIDENCE_DIR:root,FINANCE13_EVIDENCE_DIR:root+'/regressao-etapa13'};
for(const key of ['DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const results=[];
function run(command,args,log){const fd=fs.openSync(root+'/'+log,'w');let r;try{r=spawnSync(command,args,{env,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}results.push({command:[command,...args],log,exit_code:r?.status});fs.writeFileSync(root+'/execucoes.json',JSON.stringify(results,null,2)+'\n');if(r?.status!==0)throw Error(log+': saída '+r?.status);}
run(process.execPath,['tests/finance-isolation/run.mjs'],'isolamento.log');
run(process.execPath,['tests/finance-isolation/verify-permissions.mjs'],'permissoes.log');
run(process.execPath,['tests/finance-isolation/guards.mjs'],'guards.log');
run(process.execPath,['tests/finance-isolation/work-orders.mjs'],'ordens-servico.log');
run(process.execPath,['tests/finance-second/validate.mjs'],'regressoes.log');
run('npx',['eslint','--max-warnings','0','tests/finance-isolation','lib/finance-core/cashflow.mjs','app/api/financeiro/fluxo-de-caixa/route.ts','app/financeiro/fluxo-de-caixa/page.tsx'],'eslint.log');
run('npx',['tsc','--noEmit'],'typescript.log');
console.log('Recortes técnicos executados; certificação global permanece bloqueada conforme CANAIS.md e decisões pendentes.');
