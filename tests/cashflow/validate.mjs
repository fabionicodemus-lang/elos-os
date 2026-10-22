import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve(process.env.FINANCE8_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa8-fluxo/evidencias');fs.mkdirSync(root,{recursive:true});const results=[];
function run(cmd,args,log){const fd=fs.openSync(root+'/'+log,'w');let r;try{r=spawnSync(cmd,args,{stdio:['ignore',fd,fd],env:{...process.env,FINANCE8_EVIDENCE_DIR:root,FINANCE7_EVIDENCE_DIR:root+'/anteriores'}});}finally{fs.closeSync(fd);}results.push({command:[cmd,...args],log,exit_code:r?.status});fs.writeFileSync(root+'/execucoes.json',JSON.stringify(results,null,2)+'\n');if(r?.status!==0)throw Error(log+': saída '+r?.status);}
run(process.execPath,['--test','tests/cashflow/engine.test.mjs'],'componentes.log');
run(process.execPath,['tests/cashflow/database.mjs'],'banco.log');
run(process.execPath,['--test','tests/cashflow/server.test.mjs'],'servidor-tela.log');
run(process.execPath,['tests/cashflow/prior-stages.mjs','--backup'],'etapas-anteriores.log');
run(process.execPath,['--test','tests/finance-core/components.test.mjs','tests/finance-core/forecast.test.mjs'],'anteriores/componentes.log');
run(process.execPath,['--test','tests/finance-core/render.test.mjs'],'anteriores/render.log');
run(process.execPath,['tests/cashflow/compare.mjs'],'adaptacao-casos.log');
run('python3',['tests/financeiro/fixtures/comparar_resultados.py',root+'/casos-obtidos.json','--only','CT01','CT07','CT08','CT12','CT15','CT16','CT17','CT23','CT25','CT26','CT30','--report',root+'/comparacao-integrais.json'],'comparacao-integrais.log');
run('python3',['tests/financeiro/fixtures/comparar_resultados.py',root+'/casos-componentes.json','--only','CT04','CT18','CT19','CT21','CT29','--report',root+'/comparacao-componentes.json'],'comparacao-componentes.log');
run(process.execPath,['--test','--test-reporter=spec','lib/forecast/engine.test.mjs','lib/forecast/snapshot-comparison.test.mjs','lib/elos-ia/summaries.test.mjs','app/engenharia/contratos/contract-calculations.test.mjs','lib/banking/ofx.test.mjs','tests/banking/bank-operations.test.mjs','lib/elos-ia/finance-safe-write-db.test.mjs','tests/homologation/aurora-regressions.test.mjs','tests/commercial/development-costs.test.mjs','tests/commercial/development-result.test.mjs','tests/financeiro/money.test.mjs'],'regressao-81.log');
run('npx',['tsc','--noEmit'],'typescript.log');
run('npx',['eslint','lib/finance-core','lib/forecast/server.ts','app/financeiro/fluxo-de-caixa','app/financeiro/contas-a-pagar','lib/elos-ia/tools.ts','tests/cashflow'],'eslint.log');
console.log('Etapa 8: validação isolada concluída. Os 30 cenários permanecem sem homologação nominal/documental completa.');
