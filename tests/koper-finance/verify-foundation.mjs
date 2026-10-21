// Executes every original Etapa 5 assertion without editing its runner/records.
// Only adds the candidate schema immediately after the existing migration.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const original=fs.readFileSync('tests/financeiro/run.mjs','utf8');
const anchor="await sql(container,fs.readFileSync('supabase/migrations/20261021120000_financial_foundation_guards.sql','utf8'));";
if(original.split(anchor).length!==2)throw Error('Runner de fundação mudou; revisar adaptador antes de executar');
const fileUrl=p=>pathToFileURL(path.resolve(p)).href;
const transformed=original.replace("'./runtime.mjs'",JSON.stringify(fileUrl('tests/financeiro/runtime.mjs')))
 .replace("'../../lib/cost-vs-budget/native-allocation.mjs'",JSON.stringify(fileUrl('lib/cost-vs-budget/native-allocation.mjs')))
 .replace(anchor,anchor+"\nawait prepareImportSchema(container); await sql(container,fs.readFileSync('supabase/migrations/20261021140000_koper_financial_snapshots.sql','utf8')); ");
const source=`import {prepareImportSchema} from ${JSON.stringify(fileUrl('tests/koper-finance/setup.mjs'))};\n`+transformed;
if(!process.env.FINANCE_EVIDENCE_DIR)throw Error('Defina diretório novo para preservar evidências da Etapa 5');
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
fs.writeFileSync(path.join(process.env.FINANCE_EVIDENCE_DIR,'adaptador-fundacao.json'),JSON.stringify({original_runner_sha256:crypto.createHash('sha256').update(original).digest('hex'),executed_runner_sha256:crypto.createHash('sha256').update(source).digest('hex'),change:'Somente instalação do schema candidato entre bootstrap e mesmas asserções',original_assertions_preserved:true},null,2)+'\n');
