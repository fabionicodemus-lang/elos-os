import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const output=path.resolve(process.env.KOPER_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa6-koper/evidencias');
fs.mkdirSync(output,{recursive:true});
const run=(cmd,args,log,env={})=>{
 const file=fs.openSync(path.join(output,log),'w');
 try {const result=spawnSync(cmd,args,{stdio:['ignore',file,file],env:{...process.env,KOPER_EVIDENCE_DIR:output,...env}});if(result.error)throw result.error;if(result.status!==0)throw Error(`${log}: saída ${result.status}`);}
 finally {fs.closeSync(file);}
};
run(process.execPath,['--test','tests/koper-finance/collection.test.mjs'],'componentes.log');
run(process.execPath,['tests/koper-finance/run.mjs'],'integracao.log');
run('python3',['tests/financeiro/fixtures/comparar_resultados.py',path.join(output,'casos-obtidos.json'),'--only','CT01','CT26','--report',path.join(output,'comparacao-CT01-CT26.json')],'comparacao-CT01-CT26.log');
run(process.execPath,['tests/koper-finance/verify-foundation.mjs','--backup'],'fundacao.log',{FINANCE_EVIDENCE_DIR:path.join(output,'fundacao')});
console.log('Integração, CT01/CT26 e mesmos 25 controles da fundação com schema candidato aprovados. Demais cenários não homologados.');
