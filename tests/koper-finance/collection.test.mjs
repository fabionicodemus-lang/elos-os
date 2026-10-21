import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectFinancialPages, normalizeBill } from '../../lib/koper-finance/collection.mjs';
import { allocatePersistedCosts } from '../../lib/forecast/cost-allocation.mjs';
const ct26=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).cases.find(c=>c.id==='CT26');
const fetcher = (fail=false,repeat=false) => async cursor => {
 const index=cursor===null?0:Number(cursor);
 if(fail&&index===1)throw Error('503');
 const rows=ct26.inputs.pages[index].map(r=>({external_id:r.id,installment:'1',principal_cents:r.amount_cents}));
 return {rows,raw:JSON.stringify(ct26.inputs.pages[index]),nextCursor:repeat&&index===1?'1':index===2?null:String(index+1)};
};
test('CT26: 3 páginas completas; página ausente, retry e cursor repetido',async()=>{
 const full=await collectFinancialPages({fetchPage:fetcher(),expectedCount:5});
 assert.equal(full.manifest.unique_count,ct26.expected.complete.unique_count);
 assert.equal(full.manifest.certified_total_cents,ct26.expected.complete.total_cents);
 assert.equal(full.manifest.coverage_percent,ct26.expected.complete.external_coverage_percent);
 const failed=await collectFinancialPages({fetchPage:fetcher(true),expectedCount:5});
 assert.equal(failed.manifest.unique_count,ct26.expected.failed_page_2.known_unique_count);
 assert.equal(failed.manifest.subtotal_cents,ct26.expected.failed_page_2.known_subtotal_cents);
 assert.equal(failed.manifest.certified_total_cents,null);assert.equal(failed.manifest.coverage_percent,'40.00');
 const repeated=await collectFinancialPages({fetchPage:fetcher(false,true),expectedCount:5});
 assert.equal(repeated.manifest.complete,false);assert.ok(repeated.manifest.errors.includes('repeated_cursor'));
});
test('Universo desconhecido, repetição de ID e total divergente nunca certificam',async()=>{
 assert.equal((await collectFinancialPages({fetchPage:fetcher()})).manifest.complete,false);
 const result=await collectFinancialPages({fetchPage:async()=>({rows:[{external_id:'1',installment:'1',principal_cents:1},{external_id:'1',installment:'1',principal_cents:1}],raw:'[]',nextCursor:null}),expectedCount:1});
 assert.equal(result.manifest.complete,false);assert.equal(result.records.length,1);
 assert.equal((await collectFinancialPages({fetchPage:fetcher(),expectedCount:5,expectedTotalCents:1})).manifest.complete,false);
});
test('Baixa parcial, valores desconhecidos e contexto sem obra não são inventados',()=>{
 const row=normalizeBill({data:{bill_id:77,bill_value:'1000.00',status:'Paga',payment:{value:'400.00'},due_date:'2026-10-21T00:00:00'}});
 assert.equal(row.principal_cents,100000);assert.equal(row.reported_paid_cents,40000);assert.equal(row.project_id,undefined);
 assert.equal(normalizeBill({bill_id:78,bill_value:0}).reported_paid_cents,null);
});
test('A Apropriar conserva valor explícito e valor omitido; parcial usa denominador do título',()=>{
 const p={id:'p',amount:1000};
 assert.deepEqual(allocatePersistedCosts(p,1000,[{service_id:'S',allocation_amount:600},{service_id:null,allocation_amount:400}]).map(r=>[r.serviceId,r.amount]),[['S',600],[null,400]]);
 assert.deepEqual(allocatePersistedCosts(p,300,[{service_id:'S',allocation_amount:600}]).map(r=>r.amount),[180,120]);
 assert.throws(()=>allocatePersistedCosts(p,1000,[{service_id:'S',allocation_amount:1001}]),/excede/);
 assert.deepEqual(allocatePersistedCosts(p,1000,[{service_id:'D',allocation_amount:600}],new Set(['D'])).map(r=>r.amount),[400]);
});

test('Excedente de pagamento não vira custo de serviço nem desaparece',()=>{
 const result=allocatePersistedCosts({id:'p',amount:1000},1100,[{service_id:'S',allocation_amount:600}]);
 assert.deepEqual(result.map(r=>[r.serviceId,r.amount]),[['S',600],[null,400],[null,100]]);
 assert.equal(result.reduce((sum,r)=>sum+r.amount,0),1100);
 assert.throws(()=>normalizeBill({bill_id:1,bill_value:100},{principal_cents:1}),/não pode substituir/);
});
