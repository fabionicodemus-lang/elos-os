// Same original assertions, now exercised with stage 8 installed. No prior artifacts overwritten.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import crypto from 'node:crypto';
const root=process.env.FINANCE8_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa8-fluxo/evidencias';fs.mkdirSync(root,{recursive:true});
const url=p=>pathToFileURL(path.resolve(p)).href;
const inject=`import {install as installStage8} from ${JSON.stringify(url('tests/cashflow/setup.mjs'))};\n`;
process.env.FINANCE7_EVIDENCE_DIR=root+'/anteriores';
let prior=fs.readFileSync('tests/finance-core/prior-stages.mjs','utf8');
const anchor="await sql(container,fs.readFileSync('${ai}','utf8'));";
if(prior.split(anchor).length!==3)throw Error('Revisar adaptador das instalações anteriores');
prior=prior.replaceAll(anchor,anchor+'await installStage8(container);').replace('Buffer.from(source)',`Buffer.from(${JSON.stringify(inject)}+source)`);
await import('data:text/javascript;base64,'+Buffer.from(prior).toString('base64'));
let ledger=fs.readFileSync('tests/finance-core/settlements.mjs','utf8');
ledger=inject+ledger.replace("'../financeiro/runtime.mjs'",JSON.stringify(url('tests/financeiro/runtime.mjs'))).replace("'../koper-finance/setup.mjs'",JSON.stringify(url('tests/koper-finance/setup.mjs'))).replace("await sql(container,fs.readFileSync(migration,'utf8'));","await sql(container,fs.readFileSync(migration,'utf8'));await installStage8(container);");
await import('data:text/javascript;base64,'+Buffer.from(ledger).toString('base64'));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');fs.writeFileSync(root+'/adaptadores-anteriores.json',JSON.stringify({assertions_expected_changed:false,stage7_prior_adapter_sha256:sha(prior),stage7_ledger_adapter_sha256:sha(ledger),observation_probe_unchanged_from_stage7:true},null,2)+'\n');
