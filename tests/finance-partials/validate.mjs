import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve(process.env.FINANCE12_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa12-parciais/evidencias');
fs.mkdirSync(root,{recursive:true});const results=[];
const env={...process.env,DOCKER_HOST:'unix:///var/run/docker.sock',FINANCE12_EVIDENCE_DIR:root,
 FINANCE7_EVIDENCE_DIR:root+'/reexecucao/anteriores',FINANCE8_EVIDENCE_DIR:root+'/reexecucao/etapa8',FINANCE10_EVIDENCE_DIR:root+'/reexecucao/etapa10'};
for(const key of ['DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
function run(command,args,log,extra={}){const fd=fs.openSync(root+'/'+log,'w');let result;try{result=spawnSync(command,args,{env:{...env,...extra},stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}results.push({command:[command,...args],log,exit_code:result?.status});fs.writeFileSync(root+'/execucoes.json',JSON.stringify(results,null,2)+'\n');if(result?.status!==0)throw Error(log+': saída '+result?.status);}
run(process.execPath,['tests/finance-partials/baseline.mjs'],'baseline.log');
run(process.execPath,['tests/finance-partials/database.mjs'],'banco.log');
run(process.execPath,['--test','tests/finance-partials/server.test.mjs','tests/finance-partials/actions.test.mjs'],'servidor-tela-acoes.log');
run('python3',['tests/financeiro/fixtures/comparar_resultados.py',root+'/casos-obtidos.json','--only','CT02','CT03','CT18','CT29','--report',root+'/comparacao-4.json'],'comparacao-4.log');
for(const stage of ['5-7','8','9','10'])run(process.execPath,['tests/finance-partials/replay-prior.mjs',stage,...(stage==='5-7'?['--backup']:[])],'regressoes-etapa'+stage+'.log');
run(process.execPath,['--test','tests/finance-core/components.test.mjs','tests/finance-core/forecast.test.mjs','tests/finance-core/render.test.mjs','tests/cashflow/engine.test.mjs','tests/cashflow/server.test.mjs','tests/supplier-refunds/server.test.mjs'],'componentes-anteriores.log');
run('python3',['tests/financeiro/fixtures/comparar_resultados.py',root+'/reexecucao/etapa10/casos-obtidos.json','--only','CT10','--report',root+'/reexecucao/etapa10/comparacao-ct10.json'],'comparacao-ct10.log');
run(process.execPath,['--test','--test-reporter=spec','lib/forecast/engine.test.mjs','lib/forecast/snapshot-comparison.test.mjs','lib/elos-ia/summaries.test.mjs','app/engenharia/contratos/contract-calculations.test.mjs','lib/banking/ofx.test.mjs','tests/banking/bank-operations.test.mjs','lib/elos-ia/finance-safe-write-db.test.mjs','tests/homologation/aurora-regressions.test.mjs','tests/commercial/development-costs.test.mjs','tests/commercial/development-result.test.mjs','tests/financeiro/money.test.mjs'],'regressao-81.log');
run('npm',['test'],'npm-test.log');
run('npx',['tsc','--noEmit'],'typescript.log');
run('npx',['eslint','lib/finance-core/cashflow.mjs','lib/finance-core/cashflow-server.ts','lib/finance-core/ledger-position.mjs','lib/elos-ia/tools.ts','app/financeiro/fluxo-de-caixa','tests/finance-partials'],'eslint.log');
console.log('Quatro casos numéricos conformes no perímetro isolado; aceite financeiro e homologação real pendentes.');
