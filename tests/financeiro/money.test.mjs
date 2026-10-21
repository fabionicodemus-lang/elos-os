import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compile} from './runtime.mjs';
import {allocateByWeight} from '../../lib/cost-vs-budget/native-allocation.mjs';
const money=fs.existsSync('lib/money.mjs')?await import('../../lib/money.mjs'):{};
const installments=compile('lib/financial-installments.ts',{'./money.mjs':money});
test('T06: 1.005 preserva arredondamento decimal para 101 centavos',()=>assert.equal(installments.moneyToCents(1.005),101));
test('T06: dinheiro desconhecido não vira zero',()=>assert.ok(Number.isNaN(installments.moneyToCents(Number.NaN))));
test('T06: centavos fora do intervalo seguro são rejeitados',()=>assert.ok(Number.isNaN(installments.moneyToCents(1e16))));
test('T07: 31/02 não é vencimento válido',()=>assert.equal(installments.financialInstallmentSummary(10,[{due_date:'2026-02-31',amount:10}]).valid,false));
test('T06/CT11 componente: maior resto desempata por ID, independente da ordem',()=>{
 const rows=[{id:'C',current_amount:1},{id:'B',current_amount:1},{id:'A',current_amount:1}];
 const values=allocateByWeight(100.01,rows);assert.deepEqual(Object.fromEntries(rows.map((r,i)=>[r.id,values[i]])),{C:33.33,B:33.34,A:33.34});
});
test('T06/CT11 componente: rateio 60/40 e parcial conservam centavos',()=>{
 assert.deepEqual(allocateByWeight(10000,[{current_amount:60},{current_amount:40}]),[6000,4000]);
 assert.deepEqual(allocateByWeight(3000,[{current_amount:60},{current_amount:40}]),[1800,1200]);
});
test('T06: divisão de parcelas preserva soma',()=>assert.equal(installments.distributeMoney(100.01,3).reduce((s,x)=>s+installments.moneyToCents(x),0),10001));
