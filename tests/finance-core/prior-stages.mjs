// Reuses prior assertions; adds the new schema only. Historical records are untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.env.FINANCE7_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa7-calculos/evidencias';
const url=p=>pathToFileURL(path.resolve(p)).href;
const e7='supabase/migrations/20261021160000_financial_settlement_ledger.sql';
const ai='supabase/migrations/20261021163000_financial_ai_settlements.sql';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function execute(source){return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));}
const original=fs.readFileSync('tests/financeiro/run.mjs','utf8');
const anchor="await sql(container,fs.readFileSync('supabase/migrations/20261021120000_financial_foundation_guards.sql','utf8'));";
if(original.split(anchor).length!==2)throw Error('Revisar adaptador da fundação');
let source=original.replace("'./runtime.mjs'",JSON.stringify(url('tests/financeiro/runtime.mjs'))).replace("'../../lib/cost-vs-budget/native-allocation.mjs'",JSON.stringify(url('lib/cost-vs-budget/native-allocation.mjs')))
 .replace(anchor,anchor+`\nawait prepareImportSchema(container);await sql(container,fs.readFileSync('supabase/migrations/20261021140000_koper_financial_snapshots.sql','utf8'));await sql(container,fs.readFileSync('${e7}','utf8'));await sql(container,fs.readFileSync('${ai}','utf8'));`)
 // This is the old observational probe, not a changed assertion/expected.
 .replace("case when status='open' then amount*100 else 0 end","finance_open_amount*100");
source=`import {prepareImportSchema} from ${JSON.stringify(url('tests/koper-finance/setup.mjs'))};\n`+source;
process.env.FINANCE_EVIDENCE_DIR=path.join(root,'fundacao');
await execute(source);
const old=fs.readFileSync('tests/koper-finance/run.mjs','utf8');
const install="await sql(container,fs.readFileSync(migration,'utf8'));";
if(old.split(install).length!==2)throw Error('Revisar adaptador Koper');
const next=old.replace("'typescript'",JSON.stringify(url('node_modules/typescript/lib/typescript.js'))).replace("'../financeiro/runtime.mjs'",JSON.stringify(url('tests/financeiro/runtime.mjs'))).replace("'./setup.mjs'",JSON.stringify(url('tests/koper-finance/setup.mjs'))).replace("'../../lib/koper-finance/collection.mjs'",JSON.stringify(url('lib/koper-finance/collection.mjs')))
 .replace(install,install+`await sql(container,fs.readFileSync('${e7}','utf8'));await sql(container,fs.readFileSync('${ai}','utf8'));`);
process.env.KOPER_EVIDENCE_DIR=path.join(root,'integracao');
await execute(next);
fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(root+'/adaptadores-anteriores.json',JSON.stringify({foundation_original_sha256:sha(original),foundation_executed_sha256:sha(source),integration_original_sha256:sha(old),integration_executed_sha256:sha(next),e7_migration_sha256:sha(fs.readFileSync(e7)),expected_or_assertions_changed:false,observational_probe_change:'CT07 parcial lê finance_open_amount em vez de amount condicionado ao status antigo'},null,2)+'\n');
