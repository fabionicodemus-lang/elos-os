// Read-only reproduction before any candidate change. Expected values come from the pinned fixture.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
async function original(file){
 let source=execFileSync('git',['show','65fe2cc:'+file],{encoding:'utf8'});
 source=source.replace(/from\s*(['"])(\.[^'"]+)\1/g,(_m,_q,p)=>'from '+JSON.stringify(pathToFileURL(path.resolve(path.dirname(file),p)).href));
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {futureCashRows}=await original('lib/finance-core/cashflow.mjs');
const {titlesAt}=await original('lib/finance-core/ledger-position.mjs');
const root=process.env.FINANCE12_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa12-parciais/evidencias';
const fixture=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json'));
const f=fixture.cases.find(c=>c.id==='CT18');
const title={id:'title',amount:20000,due_date:'2026-11-20',status:'open',finance_managed:true,
 finance_principal_paid:5000,finance_interest_due:2000,finance_interest_paid:0,finance_discount:0,
 finance_noncash:0,finance_advance_applied:0,finance_cash_gross:5000,finance_cash_refunded:0,
 finance_cash_pending:0,finance_open_amount:17000};
const actual=futureCashRows({payables:[title],scenarioRows:[
 {id:'C',scope_key:'C',category:'C',amount_cents:6000000},
 {id:'P',scope_key:'P',category:'P',amount_cents:4000000},
 {id:'AF',scope_key:'AF',category:'AF',amount_cents:200000}],
 coverageLinks:[{scope_key:'C',title_type:'AP',title_id:'title',amount_cents:2000000}],
 adjustmentRealizations:[{forecast_row_id:'AF',scope_key:'AF',amount_cents:200000,effective_date:'2026-11-20'}],cutoff:f.inputs.stage_F_cutoff});
const revised={id:'77',amount:12000,status:'open'};
const historical=titlesAt({titles:[revised],audits:[{title_id:'77',title_type:'payables',version:1,
 effective_date:'2026-10-19',recorded_at:'2026-10-19T21:00:00.000Z',new_value:{...revised,amount:10000}}],
 type:'AP',cutoff:'2026-10-18',knownAt:'2026-10-18T23:00:00.000Z'});
const offset= titlesAt({titles:[revised],audits:[{title_id:'77',title_type:'payables',version:1,
 effective_date:'2026-10-19',recorded_at:'2026-10-19T21:00:00.000Z',new_value:{...revised,amount:10000}}],
 type:'AP',cutoff:'2026-10-19',knownAt:'2026-10-19T18:00:00-03:00'});
const output={base_commit:'65fe2cc',CT18:{expected_Q_scenario_cents:f.expected.states.at(-1).Q_scenario_cents,
 actual_Q_scenario_cents:actual.rows.reduce((s,r)=>s+r.amount_cents,0),rows:actual.rows,
 cause:'futureCashRows não recebe/consome vínculo de AF com encargo constituído; função pura de cobertura já o separa.'},
 CT02_extension:{expected_visible_before_first_known_version:0,actual_visible:historical.length,
 cause:'titlesAt filtra histórico por K antes de verificar existência; sem versão conhecida usa título atual.'},
 CT02_offset:{expected_principal_cents:1000000,actual_principal_cents:offset[0]?.amount*100,
 cause:'Comparação lexical de timestamps não reconhece o mesmo instante em UTC e America/Sao_Paulo.'}};
fs.mkdirSync(root,{recursive:true});fs.writeFileSync(root+'/baseline.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
