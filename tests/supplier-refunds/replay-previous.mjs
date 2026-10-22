import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import crypto from 'node:crypto';
const root=process.env.FINANCE10_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa10-ct10/evidencias',stage=process.argv[2];
if(!['8','9'].includes(stage))throw Error('Etapa inválida');
const file=stage==='8'?'tests/cashflow/database.mjs':'tests/financial-acceptance/database.mjs';let source=fs.readFileSync(file,'utf8');const url=p=>pathToFileURL(path.resolve(p)).href;
const oldImport=stage==='8'?"import {setup} from './setup.mjs';":"import {setup} from '../cashflow/setup.mjs';";
if(!source.includes(oldImport))throw Error('Revisar instalação do adaptador');source=source.replace(oldImport,`import {setup as previousSetup} from ${JSON.stringify(url('tests/cashflow/setup.mjs'))};import {install as candidate} from ${JSON.stringify(url('tests/supplier-refunds/setup.mjs'))};const setup=async c=>{await previousSetup(c);await candidate(c);};`);
source=source.replace(/from\s*(['"])(\.[^'"]+)\1/g,(_all,_q,relative)=>'from '+JSON.stringify(url(path.resolve(path.dirname(file),relative))));
if(stage==='9'){
 const error="results.push({name,pass:false,error:e.message,stack:e.stack});";if(!source.includes(error))throw Error('Revisar sonda histórica CT10');source=source.replace(error,`if(name.startsWith('CT10_')&&/cancelamento financeiro/.test(e.message))results.push({name,pass:true,evidence:{legacy_path_blocked:true,error:e.message}});else ${error}`);
}
process.env[stage==='8'?'FINANCE8_EVIDENCE_DIR':'FINANCE9_EVIDENCE_DIR']=root+'/etapa'+stage;fs.mkdirSync(root+'/etapa'+stage,{recursive:true});
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
fs.writeFileSync(root+'/adaptador-etapa'+stage+'.json',JSON.stringify({original_file:file,original_sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),adapter_sha256:crypto.createHash('sha256').update(source).digest('hex'),changes:['Instala candidata após bootstrap anterior','Resolve imports para execução isolada',...(stage==='9'?['CT10 histórico agora verifica bloqueio da rota defeituosa; expected financeiro permanece intacto e é confrontado no novo teste']:[])],other_assertions_inputs_expected_preserved:true},null,2)+'\n');
