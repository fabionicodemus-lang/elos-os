import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {financialCoverage,contractRemainder,economicEstimate,exclusiveFutureAdjustments} from '../../lib/finance-core/coverage.mjs';
import {dueBuckets} from '../../lib/finance-core/due.mjs';
import {delinquencyOfCohort} from '../../lib/finance-core/cohort.mjs';
import {titlePosition,openTitleAmount} from '../../lib/finance-core/titles.mjs';
import {financialTitleEntries} from '../../lib/finance-core/cash.mjs';
import {summarizePayables,buildCashflowMonths} from '../../lib/elos-ia/summaries.mjs';
import {allocatePersistedCosts} from '../../lib/forecast/cost-allocation.mjs';
const cases=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).cases;
const get=id=>cases.find(c=>c.id===id),states={};
const output=process.env.FINANCE7_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa7-calculos/evidencias';
test('CT18: R/C/P exclusivos e AF sai quando encargo é constituído',()=>{
 const {inputs:i,expected:e}=get('CT18');const V=i.firm_contract_cents,initial=i.initial_uncovered_forecast_cents,issued=i.recognized_title_principal_cents,paid=i.principal_payment_cents,charge=i.future_interest_adjustment_cents;
 const result=[];
 const stage=(label,R,V,H,Rv,P,AF=0)=>{
  const x=financialCoverage({R_cents:R,items:V?[{valueCents:V,paidPrincipalCents:H,representedOpenCents:Rv}]:[],P_cents:P,AF_cents:AF,coverageComplete:true});
  result.push({stage:label,R_cents:x.known_obligations_subtotal_cents,C_cents:x.C_cents,P_cents:x.P_cents,Q_cents:x.Q_cents,AF_cents:x.AF_cents,...(['E','F'].includes(label)?{Q_scenario_cents:x.Q_scenario_cents}:{})});
 };
 stage('A',0,0,0,0,initial);stage('B',0,V,0,0,initial-V);stage('C',issued,V,0,issued,initial-V);stage('D',issued-paid,V,paid,issued-paid,initial-V);
 const future=[{id:'interest-source',amountCents:charge}];stage('E',issued-paid,V,paid,issued-paid,initial-V,exclusiveFutureAdjustments(future,new Set()));stage('F',issued-paid+charge,V,paid,issued-paid,initial-V,exclusiveFutureAdjustments(future,new Set(['interest-source'])));
 states.CT18={states:result};assert.deepEqual(states.CT18,e);
});
test('CT19: ETC independente do orçamento e aditivo proposto não vira compromisso',()=>{
 const {inputs:i,expected:e}=get('CT19');
 const x=economicEstimate({contracts:[{originalCents:i.foundation_original_contract_cents,incurredCents:i.foundation_incurred_cents,amendments:[{status:'approved',amountCents:i.approved_foundation_addendum_cents},{status:'draft',amountCents:i.unapproved_addendum_risk_cents}]},{originalCents:i.finishes_contract_cents,incurredCents:i.finishes_incurred_cents}],incurredOtherCents:i.other_incurred_cents,uncoveredRemainingCents:i.uncovered_future_estimate_cents,budgetCents:i.current_approved_budget_cents,riskCents:i.unapproved_addendum_risk_cents});
 states.CT19={firm_foundation_contract_cents:x.firm_values_cents[0],incurred_cost_cents:x.incurred_cost_cents,ETC_cents:x.ETC_cents,EAC_cents:x.EAC_cents,variance_to_current_budget_cents:x.variance_cents,variance_percent:x.variance_percent,firm_commitment_increment_from_unapproved_proposal_cents:x.firm_values_cents[0]-i.foundation_original_contract_cents-i.approved_foundation_addendum_cents,scenario_EAC_if_risk_fully_added_cents:x.scenario_EAC_cents};assert.deepEqual(states.CT19,e);
});
test('CT21: desconhecido não vira zero nem Q artificial de 980 mil',()=>{
 const {inputs:i,expected:e}=get('CT21');const x=financialCoverage({R_cents:i.known_R_cents,items:[{valueCents:i.reported_contract_future_cents,paidPrincipalCents:null,representedOpenCents:null,complete:false}],P_cents:i.uncovered_forecast_cents,coverageComplete:i.contract_title_coverage_available,reportedContractFutureCents:i.reported_contract_future_cents,expectedExternalCount:i.expected_external_id_count,loadedExternalCount:i.loaded_external_id_count});
 states.CT21=Object.fromEntries(Object.keys(e).map(k=>[k,x[k]]));assert.deepEqual(states.CT21,e);
});
test('CT04: janelas 30/90 cumulativas, hoje e desconhecido separados',()=>{
 const {inputs:i,expected:e}=get('CT04');const f=i.separate_bucket_fixture;
 const rows=Object.entries(f.amounts_cents_by_due).map(([date,n])=>({status:'open',amount:n/100,due_date:date==='unknown'?null:date}));
 states.CT04={bucket_fixture:dueBuckets(rows,f.cutoff)};assert.deepEqual(states.CT04.bucket_fixture,e.bucket_fixture);
});
test('CT13: coorte de principal exigível exclui carteira futura e juros',()=>{
 const {inputs:i,expected:e}=get('CT13');const rows=i.cohort.map(r=>({id:r.id,amount:r.principal_cents/100,status:'open',due_date:r.due,paid_amount:r.received_principal_cents/100,finance_managed:true,finance_principal_paid:r.received_principal_cents/100,finance_open_amount:(r.principal_cents-r.received_principal_cents)/100,finance_cash_gross:r.received_principal_cents/100,finance_cash_refunded:0,finance_cash_pending:0,finance_noncash:0,finance_discount:0,finance_interest_due:0,finance_interest_paid:0}));
 rows.push({...rows[0],id:i.future_outside_cohort_id,due_date:i.future_outside_cohort_due,amount:i.future_outside_cohort_cents/100,finance_principal_paid:0});
 const x=delinquencyOfCohort(rows,{cutoff:i.cutoff});states.CT13={cohort_due_principal_cents:x.due_principal_cents,cohort_overdue_principal_cents:x.overdue_principal_cents,I19_cohort_principal_delinquency_percent:x.percent};for(const [k,v] of Object.entries(states.CT13))assert.equal(v,e[k]);
});
test('mesma parcial em resumo IA, agenda de relatório e mês financeiro',()=>{
 const row={id:'p',status:'open',amount:100000,due_date:'2026-11-20',dueDate:'2026-11-20',finance_managed:true,finance_open_amount:70000,finance_principal_paid:30000,finance_cash_gross:30000,finance_cash_refunded:0,finance_cash_pending:0,finance_discount:0,finance_noncash:0,finance_interest_due:0,finance_interest_paid:0};
 const cash=[{title_id:'p',title_type:'AP',event_id:'P1',effective_date:'2026-10-15',cash_signed:30000}];
 assert.equal(titlePosition(row).status,'partial');assert.equal(openTitleAmount(row),70000);
 const facts=financialTitleEntries([row],'AP',cash);assert.equal(facts.filter(x=>x.situation==='forecast')[0].amount,70000);assert.equal(facts.filter(x=>x.situation==='realized')[0].amount,30000);
 const summary=summarizePayables([row],{today:'2026-10-21',cashRows:cash});assert.equal(summary.resumo_geral.em_aberto.valor,70000);assert.equal(summary.resumo_geral.pagas.valor,30000);
 const months=buildCashflowMonths({payables:[row],cashRows:cash,today:'2026-10-21'});assert.equal(months.totais_de_toda_a_obra.pago,30000);assert.equal(months.totais_de_toda_a_obra.a_pagar,70000);
 assert.throws(()=>financialTitleEntries([row],'AP'),/não carregadas/);
});
test('rateio não elimina A Apropriar; sobrecobertura não vira C zero certificado',()=>{
 const rows=allocatePersistedCosts({id:'p',amount:1000},300,[{id:'S',service_id:'S',allocation_amount:600}]);assert.deepEqual(rows.map(r=>r.amount),[180,120]);
 assert.equal(contractRemainder({valueCents:1000,paidPrincipalCents:800,representedOpenCents:500}).complete,false);
 assert.equal(contractRemainder({valueCents:1000,paidPrincipalCents:800,representedOpenCents:500}).C_cents,null);
});
process.on('exit',()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/componentes-casos.json',JSON.stringify({perimeter:'Cálculos puros; não certifica persistência/fluxos completos destes casos',states},null,2)+'\n');});
test('resultado comercial usa os mesmos saldos de recebimento e pagamento parciais',async()=>{
 const {calculateDevelopmentResult}=await import('../../lib/commercial/development-result.mjs');
 const row={status:'open',amount:100000,finance_managed:true,finance_open_amount:70000,finance_principal_paid:30000,finance_cash_gross:30000,finance_cash_refunded:0,finance_cash_pending:0,finance_discount:0,finance_noncash:0,finance_interest_due:0,finance_interest_paid:0,due_date:'2026-10-20'};
 const result=calculateDevelopmentResult({receivables:[row],payables:[row],today:'2026-10-21'});
 assert.equal(result.cash.received,30000);assert.equal(result.cash.receivableOpen,70000);assert.equal(result.cash.payableOpen,70000);
});
