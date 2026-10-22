// Preserve original assertions and inputs; install the CT10 candidate before their operations.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import crypto from 'node:crypto';
const root=process.env.FINANCE10_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa10-ct10/evidencias';const url=p=>pathToFileURL(path.resolve(p)).href;const encoded=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const wrapper=encoded(`import {install as previous} from ${JSON.stringify(url('tests/cashflow/setup.mjs'))};import {install as candidate} from ${JSON.stringify(url('tests/supplier-refunds/setup.mjs'))};export async function install(c){await previous(c);await candidate(c);}`);
process.env.FINANCE8_EVIDENCE_DIR=root+'/etapa8';process.env.FINANCE7_EVIDENCE_DIR=root+'/etapa8/anteriores';
let source=fs.readFileSync('tests/cashflow/prior-stages.mjs','utf8').replace("url('tests/cashflow/setup.mjs')",JSON.stringify(wrapper));
await import(encoded(source));
fs.writeFileSync(root+'/adaptador-etapas5-7.json',JSON.stringify({assertions_inputs_expected_changed:false,installation:'Etapa8 seguida da candidata CT10',adapter_sha256:crypto.createHash('sha256').update(source).digest('hex')},null,2)+'\n');
