import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../financeiro/runtime.mjs';
import * as titles from '../../lib/finance-core/titles.mjs';
import * as coverage from '../../lib/finance-core/coverage.mjs';
import * as allocation from '../../lib/forecast/cost-allocation.mjs';
import * as engine from '../../lib/forecast/engine.mjs';
import * as curves from '../../app/engenharia/curvas/curve-calculations.mjs';
const {loadProjectForecast}=compile('lib/forecast/server.ts',{
 '@/lib/finance-core/titles.mjs':titles,'../finance-core/titles.mjs':titles,'../finance-core/coverage.mjs':coverage,'../finance-core/server':{loadSettlementCash:async()=>[]},
 '@/lib/supabase-pagination':compile('lib/supabase-pagination.ts'),'./cost-allocation.mjs':allocation,'./engine.mjs':engine,'@/app/engenharia/curvas/curve-calculations.mjs':curves,
});
function client(data){return {from:table=>new class{
 constructor(){this.rows=[...(data[table]??[])];}select(){return this;}order(){return this;}eq(k,v){this.rows=this.rows.filter(x=>x[k]===v);return this;}not(k,op,v){this.rows=this.rows.filter(x=>x[k]!==v);return this;}neq(k,v){this.rows=this.rows.filter(x=>x[k]!==v);return this;}in(k,v){this.rows=this.rows.filter(x=>v.includes(x[k]));return this;}lte(k,v){this.rows=this.rows.filter(x=>x[k]<=v);return this;}is(k,v){this.rows=this.rows.filter(x=>(x[k]??null)===v);return this;}range(a,b){return Promise.resolve({data:this.rows.slice(a,b+1),error:null});}maybeSingle(){return Promise.resolve({data:this.rows[0]??null,error:null});}
 }()};}
const scope={company_id:'c',project_id:'p'};
const base=()=>({projects:[{id:'p',company_id:'c',forecast_default_payment_days:0}],engineering_schedule_baselines:[{...scope,id:'b',budget_id:'budget',status:'approved'}],engineering_budgets:[{...scope,id:'budget'}],engineering_budget_items:[{...scope,id:'bi',budget_id:'budget',status:'active',service_id:'s',total_direct_cost:1000}],engineering_services:[{id:'s',company_id:'c',code:'01',description:'Fictício'}],execution_service_contracts:[{...scope,id:'ct',status:'active',end_date:'2026-12-31',payment_days:0}],execution_service_contract_items:[{...scope,id:'ci',contract_id:'ct',service_id:'s',total_value:1000}],payables:[{...scope,id:'paid',status:'paid',due_date:'2026-10-01',paid_at:'2026-10-01',amount:400,paid_amount:400,source_system:'elos_os',source_id:'manual_invoice:n:i'}],payable_cost_allocations:[{...scope,id:'a',payable_id:'paid',service_id:'s',allocation_amount:400}],finance_manual_invoices:[{...scope,id:'n',contract_id:'ct',measurement_id:null,status:'approved'}],finance_manual_invoice_installments:[{...scope,invoice_id:'n',payable_id:'paid'}]});
test('nota ligada a contrato sem medição cobre 400: futuro 600, nunca 1000+400',async()=>{
 const data=base();const result=await loadProjectForecast({supabase:client(data),companyId:'c',projectId:'p',asOfDate:'2026-10-21'});
 assert.deepEqual(result.errors,[]);assert.equal(result.forecast.totals.actual,400);assert.equal(result.forecast.totals.committedFuture,600);assert.equal(result.forecast.totals.projectedCost,1000);assert.equal(result.financialIndicators.Q_cents,null);
});
test('medição e nota do mesmo escopo usam um vínculo financeiro',async()=>{
 const data=base();data.finance_manual_invoices[0].measurement_id='m';data.execution_contract_measurements=[{...scope,id:'m',contract_id:'ct',status:'invoiced',gross_amount:400,payable_id:'paid'}];data.execution_contract_measurement_items=[{...scope,measurement_id:'m',contract_id:'ct',service_id:'s',current_amount:400}];
 const result=await loadProjectForecast({supabase:client(data),companyId:'c',projectId:'p',asOfDate:'2026-10-21'});assert.equal(result.forecast.totals.projectedCost,1000);assert.equal(result.forecast.totals.committedFuture,600);
});
test('vínculo ausente torna cobertura incompleta, sem certificar Q/EAC',async()=>{
 const data=base();data.finance_manual_invoice_installments=[];const result=await loadProjectForecast({supabase:client(data),companyId:'c',projectId:'p',asOfDate:'2026-10-21'});
 assert.ok(result.errors.some(x=>x.includes('não comprovado')));assert.equal(result.financialIndicators.Q_cents,null);assert.equal(result.financialIndicators.EAC_cents,null);
});

test('medição não reabre desconto já liquidado como saldo artificial',async()=>{
 const native=await import('../../lib/cost-vs-budget/native-allocation.mjs');
 const {loadNativeMeasurementTitles}=compile('lib/cost-vs-budget/native-measurement-titles.ts',{'@/lib/finance-core/titles.mjs':titles,'@/lib/supabase-pagination':compile('lib/supabase-pagination.ts'),'./native-allocation.mjs':native});
 const p={...scope,id:'p1',source_system:'elos_os',status:'paid',amount:100000,finance_managed:true,finance_open_amount:0,finance_principal_paid:95000,finance_cash_gross:97000,finance_cash_refunded:0,finance_cash_pending:0,finance_discount:5000,finance_noncash:0,finance_interest_due:2000,finance_interest_paid:2000};
 const data={payables:[p],execution_contract_measurements:[{...scope,id:'m',payable_id:'p1',status:'paid'}],execution_contract_measurement_items:[{...scope,id:'i',measurement_id:'m',service_id:'s',current_amount:100000}]};
 const x=await loadNativeMeasurementTitles(client(data),'c','p');assert.equal(x.allocations[0].title.paidAllocatedAmount,95000);assert.equal(x.allocations[0].title.openAllocatedAmount,0);
});
