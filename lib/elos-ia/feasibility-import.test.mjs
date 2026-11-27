import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeasibilityImport,feasibilityImportWarnings,isFeasibilityImportRequest} from './feasibility-import.mjs';
test('missing values are null and declared totals are not derived from operational data',()=>{
 const p=normalizeFeasibilityImport({study:{name:'Estudo 2023',land_cash_amount:'1.234.567,89',company_id:'attacker',status:'converted'},reported:{vgv:10000000,profit:2000000,total_cost:7000000},unit_types:[{name:'Tipo A',quantity:20}]});
 assert.equal(p.study.land_cash_amount,1234567.89);assert.equal(p.study.tax_rate_pct,null);assert.equal(p.study.status,undefined);assert.equal(p.study.company_id,undefined);assert.equal(p.unit_types[0].barter_units,null);
 assert.ok(feasibilityImportWarnings(p).some(x=>x.includes('difere do lucro')));assert.ok(feasibilityImportWarnings(p).some(x=>x.includes('Tipologias incompletas')));
});
test('explicit zero is preserved; malformed dates and financial values are rejected',()=>{
 assert.equal(normalizeFeasibilityImport({study:{land_cash_amount:0}}).study.land_cash_amount,0);
 for(const input of [{study:{construction_start_date:'2026-02-31'}},{study:{tax_rate_pct:999}},{study:{land_cash_amount:-1}},{unit_types:[{quantity:1.5}]},{study:{land_cash_amount:'não sei'}}])assert.throws(()=>normalizeFeasibilityImport(input));
});
test('document import intent avoids consulting profitability before preparing review',()=>{
 assert.equal(isFeasibilityImportRequest('Esse é o estudo da obra. Lance pra mim',['Viabilidade Econômica.pdf']),true);
 assert.equal(isFeasibilityImportRequest('Importe a viabilidade do empreendimento',['estudo.xlsx']),true);
 assert.equal(isFeasibilityImportRequest('Qual o lucro atual?',['Viabilidade.pdf']),false);
 assert.equal(isFeasibilityImportRequest('Lance a nota fiscal',['nota.pdf']),false);
});
