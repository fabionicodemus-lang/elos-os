// Diagnostic runner. Exit 1 at the end means financial homologation remains incomplete.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve(process.env.FINANCE9_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa9-homologacao/evidencias');fs.mkdirSync(root,{recursive:true});const executed=[];
function run(command,args,log,allowed=[0]){const fd=fs.openSync(path.join(root,log),'w');let r;try{r=spawnSync(command,args,{stdio:['ignore',fd,fd],env:{...process.env,FINANCE9_EVIDENCE_DIR:root,FINANCE8_EVIDENCE_DIR:root+'/reexecucao'}});}finally{fs.closeSync(fd);}executed.push({command:[command,...args],log,exit_code:r?.status});fs.writeFileSync(root+'/execucoes.json',JSON.stringify(executed,null,2)+'\n');if(!allowed.includes(r?.status))throw Error(log+': saída '+r?.status);return r.status;}
if(process.argv.includes('--reuse-stage8')){const prior=JSON.parse(fs.readFileSync(root+'/reexecucao/execucoes.json'));if(!prior.length||prior.some(r=>r.exit_code!==0))throw Error('Reexecução anterior incompleta');executed.push({command:['npm','run','test:cashflow'],log:'reexecucao/execucoes.json',exit_code:0,note:'Reexecução integral feita nesta branch antes das sondas; --reuse-stage8 não afirma nova execução. Fontes operacionais não foram alteradas.'});}
else run('npm',['run','test:cashflow'],'reexecucao.log');
run(process.execPath,['tests/financial-acceptance/database.mjs'],'banco.log');
run(process.execPath,['tests/financial-acceptance/components.mjs'],'componentes.log');
const compare='tests/financeiro/fixtures/comparar_resultados.py';
run('python3',[compare,root+'/casos-obtidos-novos.json','--only','CT13','CT14','CT23','--report',root+'/comparacao-novos-integrais.json'],'comparacao-novos-integrais.log');
run('python3',[compare,root+'/casos-componentes-adicionais.json','--only','CT02','CT11','--report',root+'/comparacao-componentes-adicionais.json'],'comparacao-componentes-adicionais.log');
run('python3',[compare,root+'/casos-obtidos-novos.json','--only','CT03','CT06','CT10','CT22','--report',root+'/comparacao-lacunas.json'],'comparacao-lacunas.log',[0,1]);
run('python3',['docs/financeiro/implementacao-v1/etapa9-homologacao/scripts/fontes_historicas.py'],'fontes-historicas.log');
run('python3',['docs/financeiro/implementacao-v1/etapa9-homologacao/scripts/matriz.py'],'matriz.log');
const matrix=JSON.parse(fs.readFileSync(root+'/matriz-30.json')),context=JSON.parse(fs.readFileSync(root+'/casos-obtidos-novos.json')).execution_context;
fs.writeFileSync(root+'/confronto-30.json',JSON.stringify({execution_context:context,cases:matrix.map(r=>({id:r.id,status:r.actual===null?'não_executado':'executado',actual:r.actual,evidence:r.evidence}))},null,2)+'\n');
const status=run('python3',[compare,root+'/confronto-30.json','--report',root+'/comparacao-30.json'],'comparacao-30.log',[0,1]);
run('python3',['docs/financeiro/implementacao-v1/etapa9-homologacao/scripts/quadro.py'],'quadro.log');
run('npx',['eslint','tests/financial-acceptance'],'eslint.log');
console.log('Etapa9: sondas concluídas; resultado financeiro '+(status?'incompleto/reprovado, consulte comparacao-30.json e a matriz por perímetro.':'numericamente conforme; consultar cobertura/aceites antes de homologar.'));
process.exitCode=status;
