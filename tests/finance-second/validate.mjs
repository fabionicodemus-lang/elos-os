import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(process.env.FINANCE13_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa13-segundo-grupo/evidencias');
fs.mkdirSync(root,{recursive:true});const results=[];
const env={...process.env,DOCKER_HOST:'unix:///var/run/docker.sock',FINANCE13_EVIDENCE_DIR:root,FINANCE12_EVIDENCE_DIR:root+'/regressao-etapa12'};
for(const key of ['DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
function run(command,args,log){const fd=fs.openSync(root+'/'+log,'w');let result;try{result=spawnSync(command,args,{env,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
 results.push({command:[command,...args],log,exit_code:result?.status});fs.writeFileSync(root+'/execucoes.json',JSON.stringify(results,null,2)+'\n');if(result?.status!==0)throw Error(log+': saída '+result?.status);}
run(process.execPath,['tests/finance-second/baseline-core.mjs'],'baseline-core.log');
run(process.execPath,['tests/finance-second/database.mjs'],'banco.log');
run(process.execPath,['--test','tests/finance-second/core.test.mjs','tests/finance-second/channels.test.mjs'],'testes-etapa13.log');
run('python3',['tests/financeiro/fixtures/comparar_resultados.py',root+'/casos-obtidos.json','--only','CT21','CT24','--report',root+'/comparacao-2.json'],'comparacao-2.log');
// Preserved prior assertions, expected values, backup/restore and CT10 adapter.
// Every output is redirected to this stage, never to a prior evidence directory.
run(process.execPath,['tests/finance-partials/validate.mjs'],'regressoes-etapas5-12.log');
run('npx',['eslint','lib/finance-core/cashflow.mjs','lib/finance-core/cashflow-server.ts','lib/elos-ia/tools.ts','app/financeiro/fluxo-de-caixa/page.tsx','app/api/financeiro/fluxo-de-caixa/route.ts','tests/finance-second'],'eslint.log');
run('npx',['tsc','--noEmit'],'typescript.log');
console.log('Etapa13: comparação fictícia CT21/24 conforme; casos continuam parciais até fechar as lacunas documentadas. Sem aceite financeiro.');
