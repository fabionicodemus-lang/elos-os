import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {realizedCashflow,projectCashflow} from '../../lib/finance-core/cashflow.mjs';
import {titlesAt} from '../../lib/finance-core/ledger-position.mjs';
import {dueBuckets} from '../../lib/finance-core/due.mjs';
const fixtures=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).cases;const get=id=>fixtures.find(c=>c.id===id);const states={};
const output=process.env.FINANCE8_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa8-fluxo/evidencias';
const account={id:'A',legal_entity_id:'E',currency_code:'BRL',opening_balance:1000,opening_balance_date:'2026-10-01',opening_validated:true};
const movement={id:'M',bank_account_id:'A',amount:300,direction:'debit',transaction_date:'2026-10-22',transaction_type:'payment',status:'posted',project_id:null};
test('saldo contínuo entre períodos; confirmação usa data do extrato, não data da conferência',()=>{
 const links=[{id:'L',transaction_id:'M',entry_id:'B',amount:300,created_at:'2026-10-24T12:00:00Z'}];const entries=[{id:'B',bank_account_id:'A',amount:-300,transaction_date:'2026-10-22',created_at:'2026-10-24T12:00:00Z'}];const input={accounts:[account],movements:[movement],links,entries};
 const a=realizedCashflow({...input,from:'2026-10-01',to:'2026-10-21'}),b=realizedCashflow({...input,from:'2026-10-22',to:'2026-10-23'}),c=realizedCashflow({...input,from:'2026-10-24',to:'2026-10-31'});
 assert.equal(a.closing_cents,b.opening_cents);assert.equal(b.closing_cents,c.opening_cents);assert.equal(b.confirmed_closing_cents,70000);assert.equal(c.confirmed_closing_cents,70000);assert.equal(c.external_outgoing_cents,0);
 assert.equal(realizedCashflow({...input,from:'2026-10-01',to:'2026-10-22',knownAt:'2026-10-23T23:59:59Z',movements:[{...movement,created_at:'2026-10-22T12:00:00Z'}]}).unconfirmed_movement_cents,30000);
});
test('conta compartilhada não cria saldo por obra nem copia abertura; saída sem obra fica na entidade',()=>{
 const r=realizedCashflow({accounts:[account],movements:[movement,{...movement,id:'M2',amount:100,project_id:'OBRA'}],from:'2026-10-01',to:'2026-10-31'});assert.equal(r.closing_cents,60000);assert.equal(r.project_bank_balance_available,false);assert.equal(r.unconfirmed_movement_cents,40000);
 const unknown=realizedCashflow({accounts:[{...account,opening_validated:false}],movements:[movement],from:'2026-10-01',to:'2026-10-31'});assert.equal(unknown.confirmed_closing_cents,null);assert.equal(unknown.closing_cents,70000);
});
test('devolução mantém débito histórico e fluxo inverso; conciliação não cria nova liquidação',()=>{
 const r=realizedCashflow({accounts:[account],movements:[movement,{...movement,id:'REFUND',direction:'credit',transaction_date:'2026-10-23',transaction_type:'refund'}],from:'2026-10-01',to:'2026-10-31'});assert.equal(r.closing_cents,100000);assert.equal(r.external_outgoing_cents,30000);assert.equal(r.external_incoming_cents,30000);
});
test('CT29: restrição, caixa mínimo e amortização já incluída; limite não utilizado não vira caixa',()=>{
 const {inputs:i,expected:e}=get('CT29');const p=projectCashflow({openingCents:i.bank_opening_cents,restrictedCents:i.restricted_cents,minimumCashCents:i.minimum_cash_cents,cutoff:'2026-10-01',through:'2026-11-30',complete:true,rows:i.monthly_inflows_cents.flatMap((n,k)=>[{id:'I'+k,category:'AR',amount_cents:n,expected_date:k?'2026-11-20':'2026-10-20'},{id:'O'+k,category:'R',amount_cents:i.monthly_outflows_cents[k],expected_date:k?'2026-11-20':'2026-10-20'}])});
 states.CT29={available_opening_cents:p.available_opening_cents,closing_month1_cents:p.months[0].closing_cents,closing_month2_cents:p.months[1].closing_cents,peak_additional_funding_cents:p.peak_additional_funding_cents,additional_amortization_duplicate_cents:p.months.reduce((s,m)=>s+m.outgoing_cents,0)-i.monthly_outflows_cents.reduce((a,b)=>a+b,0),unused_limit_in_available_cash_cents:p.unused_credit_limit_in_cash_cents};assert.deepEqual(states.CT29,e);
});
test('receita comercial estimada é cenário separado e insuficiência diária não some no fechamento mensal',()=>{
 const p=projectCashflow({openingCents:100000,minimumCashCents:20000,cutoff:'2026-10-01',through:'2026-10-31',complete:true,rows:[{id:'PAY',category:'R',amount_cents:150000,expected_date:'2026-10-10'},{id:'AR',category:'AR',amount_cents:100000,expected_date:'2026-10-20'},{id:'SALE',category:'REVENUE',amount_cents:70000,expected_date:'2026-10-20'}]});assert.equal(p.closing_cents,50000);assert.equal(p.commercial_closing_cents,120000);assert.equal(p.peak_additional_funding_cents,70000);
});
test('pendência de data, caixa mínimo ou abertura não vira zero nem selo de completude',()=>{
 const p=projectCashflow({openingCents:null,cutoff:'2026-10-21',through:'2026-12-31',complete:true,rows:[{id:'DUE',category:'R',amount_cents:100000,expected_date:null}]});assert.equal(p.undated_cents,100000);assert.equal(p.closing_cents,null);assert.equal(p.peak_additional_funding_cents,null);assert.equal(p.complete,false);
});
test('CT04: cortes efetivos não usam o estado quitado atual em 21/10 nem movem caixa para 24/10',()=>{
 const {inputs:i,expected:e}=get('CT04'),f=i.date_fixture;
 const base={id:'T',amount:f.amount_cents/100,due_date:f.due,status:'open'};
 const evt={id:'E',kind:'payment',effective_date:f.paid,created_at:'2026-10-22T12:00:00Z'};
 const line={event_id:'E',title_type:'AP',title_id:'T',principal:10000,interest:0,fee:0,excess_credit:0,discount:0,noncash:0};
 const audits=[{title_id:'T',title_type:'payables',effective_date:f.issued,recorded_at:'2026-10-05T12:00:00Z',version:1,new_value:base}];
 const position=t=>titlesAt({titles:[{...base,status:'paid'}],audits,events:[evt],lines:[line],type:'AP',cutoff:t})[0];
 const bankInput={accounts:[{...account,opening_balance:20000}],movements:[{...movement,amount:10000}],links:[{id:'L',transaction_id:'M',entry_id:'B',amount:10000,created_at:'2026-10-24T12:00:00Z'}],entries:[{id:'B',bank_account_id:'A',amount:-10000,transaction_date:f.bank_date,created_at:'2026-10-24T12:00:00Z'}]};
 const at21=realizedCashflow({...bankInput,from:'2026-10-21',to:'2026-10-21'}),at22=realizedCashflow({...bankInput,from:'2026-10-22',to:'2026-10-22'}),at24=realizedCashflow({...bankInput,from:'2026-10-24',to:'2026-10-24'});
 const rows=Object.entries(i.separate_bucket_fixture.amounts_cents_by_due).map(([date,n])=>({status:'open',amount:n/100,due_date:date==='unknown'?null:date}));
 states.CT04={date_fixture:{september_cost_cents:f.competence==='2026-09'?f.amount_cents:0,open_at_2026_10_21_cents:dueBuckets([position('2026-10-21')],'2026-10-21').R_cents,overdue_at_2026_10_21_cents:dueBuckets([position('2026-10-21')],'2026-10-21').overdue_cents,cash_at_2026_10_21_cents:at21.confirmed_external_outgoing_cents,bank_cash_on_2026_10_22_cents:at22.confirmed_external_outgoing_cents,new_cash_on_2026_10_24_cents:at24.confirmed_external_outgoing_cents},bucket_fixture:dueBuckets(rows,i.separate_bucket_fixture.cutoff)};assert.deepEqual(states.CT04,e);
 assert.equal(position('2026-10-24').finance_open_amount,0);
});
process.on('exit',()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/componentes-casos.json',JSON.stringify({states,perimeter:'Núcleo com fontes fictícias explícitas; CT04 não comprova persistência econômica'},null,2)+'\n');});
test('vínculo nativo reutiliza cobertura do contrato: R 400 + C 600, sem somar 1.400',async()=>{
 const {futureCashRows}=await import('../../lib/finance-core/cashflow.mjs');const {nativeFinancialBindings}=await import('../../lib/finance-core/coverage.mjs');
 const bindings=nativeFinancialBindings({invoices:[{id:'NF',contract_id:'CT',measurement_id:null}],installments:[{invoice_id:'NF',payable_id:'T'}]});
 const rows=[{id:'C',scope_key:'CT',category:'C',source_id:'CT',source_kind:'contract',amount_cents:100000,expected_date:'2026-11-20'}];const title={id:'T',amount:400,status:'open',due_date:'2026-11-20'};
 const future=futureCashRows({payables:[title],nativeBindings:bindings,scenarioRows:rows,cutoff:'2026-10-21'});assert.equal(future.rows.find(r=>r.category==='R').amount_cents,40000);assert.equal(future.rows.find(r=>r.category==='C').amount_cents,60000);
 assert.throws(()=>futureCashRows({payables:[title],nativeBindings:bindings,scenarioRows:[...rows,{...rows[0],id:'C2',scope_key:'CT2'}],cutoff:'2026-10-21'}),/dividido/);
});
