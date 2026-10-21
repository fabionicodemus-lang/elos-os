import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(process.env.FINANCE7_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa7-calculos/evidencias');
fs.mkdirSync(root,{recursive:true});const results=[];
function run(cmd,args,log){const fd=fs.openSync(root+'/'+log,'w');let r;try{r=spawnSync(cmd,args,{stdio:['ignore',fd,fd],env:{...process.env,FINANCE7_EVIDENCE_DIR:root}});}finally{fs.closeSync(fd);}results.push({command:[cmd,...args],log,exit_code:r?.status});if(r?.status!==0){fs.writeFileSync(root+'/execucoes.json',JSON.stringify(results,null,2)+'\n');throw Error(log+': falha '+r?.status);}}
run(process.execPath,['--test','tests/finance-core/components.test.mjs','tests/finance-core/forecast.test.mjs'],'componentes.log');
run(process.execPath,['tests/finance-core/settlements.mjs'],'liquidacoes.log');
run(process.execPath,['--test','tests/finance-core/render.test.mjs'],'render.log');
run(process.execPath,['tests/finance-core/prior-stages.mjs','--backup'],'etapas-anteriores.log');
run(process.execPath,['tests/finance-core/compare.mjs'],'adaptacao-casos.log');
for(const [name,ids,file] of [['integrais',['CT01','CT07','CT08','CT23','CT26','CT30'],'casos-obtidos.json'],['componentes',['CT18','CT19','CT21'],'casos-componentes-obtidos.json']])run('python3',['tests/financeiro/fixtures/comparar_resultados.py',root+'/'+file,'--only',...ids,'--report',root+'/comparacao-'+name+'.json'],'comparacao-'+name+'.log');
run(process.execPath,['--test','--test-reporter=spec','lib/forecast/engine.test.mjs','lib/forecast/snapshot-comparison.test.mjs','lib/elos-ia/summaries.test.mjs','app/engenharia/contratos/contract-calculations.test.mjs','lib/banking/ofx.test.mjs','tests/banking/bank-operations.test.mjs','lib/elos-ia/finance-safe-write-db.test.mjs','tests/homologation/aurora-regressions.test.mjs','tests/commercial/development-costs.test.mjs','tests/commercial/development-result.test.mjs','tests/financeiro/money.test.mjs'],'regressao-81.log');
run('npx',['tsc','--noEmit'],'typescript.log');
run('npx',['eslint','lib/finance-core','lib/forecast/server.ts','lib/cost-vs-budget/server.ts','lib/cost-vs-budget/native-allocation.mjs','lib/cost-vs-budget/native-measurement-titles.ts','lib/development-costs','lib/commercial/development-result.mjs','app/comercial/incorporacao/resultado/page.tsx','app/comercial/incorporacao/[saleId]/page.tsx','lib/elos-ia/summaries.mjs','lib/elos-ia/tools.ts','app/financeiro/contas-a-pagar','app/financeiro/contas-a-receber','app/financeiro/relatorios','app/financeiro/fluxo-de-caixa','app/comercial/planos-de-pagamento','app/comercial/vendas/[saleId]/page.tsx','app/dashboard/model-dashboard.tsx','tests/finance-core'],'eslint.log');
fs.writeFileSync(root+'/execucoes.json',JSON.stringify(results,null,2)+'\n');console.log('Validação isolada concluída. O conjunto de 30 casos permanece não homologado.');
