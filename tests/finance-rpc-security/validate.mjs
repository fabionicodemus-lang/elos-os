import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve('docs/financeiro/implementacao-v1/etapa14c-correcao-rpcs/evidencias');
fs.mkdirSync(root,{recursive:true});
const env={...process.env,DOCKER_HOST:'unix:///var/run/docker.sock',FINANCE13_EVIDENCE_DIR:root+'/regressao-etapa13'};
for(const key of ['DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const commands=[
 ['node',['tests/finance-rpc-security/run.mjs'],'testes.log'],
 ['node',['tests/finance-second/validate.mjs'],'regressoes.log'],
 ['npx',['eslint','--max-warnings','0','tests/finance-rpc-security'],'eslint.log'],
];
const results=[];
for(const [command,args,log] of commands){
 const start=new Date().toISOString(),fd=fs.openSync(root+'/'+log,'w');let result;
 try{result=spawnSync(command,args,{env,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
 results.push({command:[command,...args],start,finished:new Date().toISOString(),log,exit_code:result?.status});
 fs.writeFileSync(root+'/execucoes.json',JSON.stringify({mode:'runner sequencial',results},null,2)+'\n');
 if(result?.status!==0)throw Error(log+': '+result?.status);
}
