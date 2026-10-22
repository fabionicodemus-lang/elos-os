// Reuse prior assertions and fixed expected values, installing this additive candidate.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.env.FINANCE12_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa12-parciais/evidencias'),stage=process.argv[2];
const url=p=>pathToFileURL(path.resolve(p)).href,encoded=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
fs.mkdirSync(root+'/reexecucao',{recursive:true});
let source,file;
if(stage==='5-7'){
 file='tests/cashflow/prior-stages.mjs';
 const wrapper=encoded(`import {install as eight} from ${JSON.stringify(url('tests/cashflow/setup.mjs'))};import {install as ten} from ${JSON.stringify(url('tests/supplier-refunds/setup.mjs'))};import {install as twelve} from ${JSON.stringify(url('tests/finance-partials/setup.mjs'))};export async function install(c){await eight(c);await ten(c);await twelve(c);}`);
 source=fs.readFileSync(file,'utf8').replace("url('tests/cashflow/setup.mjs')",JSON.stringify(wrapper));
 process.env.FINANCE8_EVIDENCE_DIR=root+'/reexecucao';
}else if(['8','9'].includes(stage)){
 file='tests/supplier-refunds/replay-previous.mjs';
 const wrapper=encoded(`import {install as ten} from ${JSON.stringify(url('tests/supplier-refunds/setup.mjs'))};import {install as twelve} from ${JSON.stringify(url('tests/finance-partials/setup.mjs'))};export async function install(c){await ten(c);await twelve(c);}`);
 source=fs.readFileSync(file,'utf8').replace("url('tests/supplier-refunds/setup.mjs')",JSON.stringify(wrapper));
 process.env.FINANCE10_EVIDENCE_DIR=root+'/reexecucao';
}else if(stage==='10'){
 file='tests/supplier-refunds/database.mjs';source=fs.readFileSync(file,'utf8');
 source=source.replace("import {setup} from './setup.mjs';",`import {setup as previous} from ${JSON.stringify(url('tests/supplier-refunds/setup.mjs'))};import {install} from ${JSON.stringify(url('tests/finance-partials/setup.mjs'))};const setup=async c=>{await previous(c);await install(c);};`);
 source=source.replace(/from\s*(['"])(\.[^'"]+)\1/g,(_a,_q,p)=>'from '+JSON.stringify(url(path.resolve(path.dirname(file),p))));
 process.env.FINANCE10_EVIDENCE_DIR=root+'/reexecucao/etapa10';fs.mkdirSync(process.env.FINANCE10_EVIDENCE_DIR,{recursive:true});
}else throw Error('Etapa inválida');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
fs.writeFileSync(root+'/reexecucao/adaptador-'+stage+'.json',JSON.stringify({original_file:file,original_sha256:sha(fs.readFileSync(file)),adapter_sha256:sha(source),changes:['Instalação candidata após pré-requisitos, imports absolutos, diretório novo de evidência'],assertions_inputs_expected_changed:false,legacy_CT10_probe_uses_preserved_stage10_adapter:stage==='9'},null,2)+'\n');
await import(encoded(source));
