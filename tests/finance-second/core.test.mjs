import test from 'node:test';
import assert from 'node:assert/strict';
import {futureCashRows,projectCashflow} from '../../lib/finance-core/cashflow.mjs';
const title={id:'T1',project_id:'O1',status:'open',amount:140000,due_date:'2026-11-10',finance_managed:true,
 finance_open_amount:140000,finance_principal_paid:0,finance_interest_due:0,finance_interest_paid:0,
 finance_discount:0,finance_noncash:0,finance_advance_applied:0,finance_cash_gross:0,finance_cash_refunded:0,finance_cash_pending:0};
const contract={id:'C1',scope_key:'contract:1',source_kind:'contract',source_id:'contract:1',category:'C',amount_cents:84000000,expected_date:'2026-11-10'};
test('CT21: título certificado não torna exclusiva a soma com contrato sem vínculo',()=>{
 const future=futureCashRows({payables:[title],scenarioRows:[contract],cutoff:'2026-10-21'});
 assert.equal(future.complete,false);assert.match(future.warnings.join(' '),/Vínculo contrato–título ausente/);
 assert.deepEqual(future.rows.map(r=>r.amount_cents),[14000000,84000000],'Preservar os dois valores; não inventar ajuste de 140mil');
 const projection=projectCashflow({openingCents:100000000,restrictedCents:0,minimumCashCents:0,rows:future.rows,cutoff:'2026-10-21',through:'2026-12-31',complete:future.complete});
 assert.equal(projection.complete,false);
});
test('Vínculo nativo explícito substitui cobertura uma vez, sem adivinhar por valor',()=>{
 const future=futureCashRows({payables:[title],scenarioRows:[contract],nativeBindings:[{title_id:'T1',contract_id:'contract:1'}],cutoff:'2026-10-21'});
 assert.equal(future.complete,true);assert.equal(future.rows.find(r=>r.category==='C').amount_cents,70000000);
 assert.equal(future.rows.reduce((n,r)=>n+r.amount_cents,0),84000000);
});
test('Vínculo em outra categoria não certifica cobertura de contrato',()=>{
 const future=futureCashRows({payables:[title],scenarioRows:[contract,{id:'P1',scope_key:'P1',category:'P',amount_cents:14000000}],coverageLinks:[{title_id:'T1',title_type:'AP',scope_key:'P1',amount_cents:14000000}],cutoff:'2026-10-21'});
 assert.equal(future.complete,false);
});
test('Sem contrato ambíguo não se altera a posição de um título',()=>{
 const future=futureCashRows({payables:[title],cutoff:'2026-10-21'});
 assert.equal(future.complete,true);assert.equal(future.rows.length,1);assert.equal(future.rows[0].amount_cents,14000000);
});
test('Vínculo de outra obra não certifica cobertura no consolidado',()=>{
 const future=futureCashRows({payables:[title],scenarioRows:[{...contract,project_id:'O1'}],coverageLinks:[{title_id:'T1',title_type:'AP',scope_key:contract.scope_key,scope_project_id:'O2',amount_cents:14000000}],cutoff:'2026-10-21'});
 assert.equal(future.complete,false);assert.equal(future.rows.find(r=>r.category==='C').amount_cents,84000000);
 assert.match(future.warnings.join(' '),/Vínculo contrato–título ausente/);
});
