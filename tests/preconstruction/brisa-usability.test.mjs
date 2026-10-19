import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizedPercentages} from '../../lib/preconstruction/physical-weights.mjs';
import {compatibleService} from '../../lib/preconstruction/service-identity.mjs';
test('suggested physical weights have two decimals, total exactly 100 and remain nonnegative',()=>{
 for(const values of [[1,1,1],[0,0,0],[3962030,67,11,1],Array(300).fill(1),[0,1,0],[NaN,-1,1]]){
  const weights=normalizedPercentages(values);
  assert.equal(weights.reduce((sum,value)=>sum+Math.round(value*100),0),10000);
  assert.ok(weights.every(value=>value>=0&&value<=100&&Math.abs(value*100-Math.round(value*100))<1e-8));
  assert.deepEqual(weights,normalizedPercentages(values));
 }
 assert.deepEqual(normalizedPercentages([]),[]);
});
test('catalog reuse requires matching description and unit rather than matching code alone',()=>{
 assert.equal(compatibleService({description:'Fundações',unit:'m³'},{description:'fundações',unit:'m3'}),true);
 assert.equal(compatibleService({description:'Fundações',unit:'m³'},{description:'Fundações',unit:'un'}),false);
 assert.equal(compatibleService({description:'Estrutura etapa 1',unit:'m3'},{description:'Estrutura etapa 2',unit:'m3'}),false);
});
