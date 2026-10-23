// Reuses the existing financial tests; never accepts a remote destination.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve('docs/financeiro/implementacao-v1/etapa14b-exposicao/evidencias');
fs.mkdirSync(root,{recursive:true});
const env={...process.env,DOCKER_HOST:'unix:///var/run/docker.sock',FINANCE14_EVIDENCE_DIR:root};
for(const key of ['DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const executions=[];
const commands=[
 ['node',['tests/finance-exposure/metadata.mjs'],'testes-metadados.log'],
 ['node',['tests/finance-isolation/guards.mjs'],'guards.log'],
 ['node',['tests/finance-isolation/work-orders.mjs'],'ordens-servico.log'],
 ['node',['--test','--test-reporter=spec','lib/forecast/engine.test.mjs','lib/forecast/snapshot-comparison.test.mjs','lib/elos-ia/summaries.test.mjs','app/engenharia/contratos/contract-calculations.test.mjs','lib/banking/ofx.test.mjs','tests/banking/bank-operations.test.mjs','lib/elos-ia/finance-safe-write-db.test.mjs','tests/homologation/aurora-regressions.test.mjs','tests/commercial/development-costs.test.mjs','tests/commercial/development-result.test.mjs','tests/financeiro/money.test.mjs'],'regressao-81.log'],
 ['npm',['test'],'npm-test.log'],
 ['npx',['eslint','--max-warnings','0','tests/finance-exposure'],'eslint.log'],
];
for(const [command,args,log] of commands){
 const started_at=new Date().toISOString(),fd=fs.openSync(path.join(root,log),'w');let result;
 try{result=spawnSync(command,args,{env,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
 executions.push({command:[command,...args],log,started_at,ended_at:new Date().toISOString(),exit_code:result?.status});
 fs.writeFileSync(root+'/execucoes.json',JSON.stringify({execution_mode:'Runner sequencial; novos recursos locais por teste SQL.',executions},null,2)+'\n');
 if(result?.status!==0)throw Error(log+': saída '+result?.status);
}
console.log('7 controles de metadados,8 guards,4 OS,81 regressões e142 testes padrão; nenhuma verificação produtiva.');
