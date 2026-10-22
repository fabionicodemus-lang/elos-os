import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {start,sql,exec,ids,asUser} from '../financeiro/runtime.mjs';import {setup} from './setup.mjs';
import {realizedCashflow,futureCashRows,snapshotCashProjection,toCents} from '../../lib/finance-core/cashflow.mjs';
import {titlesAt} from '../../lib/finance-core/ledger-position.mjs';
import {dueBuckets} from '../../lib/finance-core/due.mjs';
const root=process.env.FINANCE8_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa8-fluxo/evidencias';fs.mkdirSync(root,{recursive:true});
const container=await start(),results=[],states={};const id=()=>crypto.randomUUID();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'",q=o=>quote(JSON.stringify(o))+'::jsonb';
const j=s=>{try{return JSON.parse(s.split('\n').findLast(x=>x.startsWith('{')||x.startsWith('[')));}catch(_e){throw Error('JSON obtido: '+s.slice(0,500));}};
const user=(text,u=ids.ug)=>sql(container,asUser(u,text));
const data=async(table,where='true')=>JSON.parse(await sql(container,`select coalesce(json_agg(t),'[]') from ${table} t where ${where}`));
const title=async(amount,project=ids.pa1)=>{const t=id();await user(`select set_config('finance.effective_date','2026-10-21',true);insert into payables(id,company_id,project_id,supplier_id,amount,due_date,created_by) values('${t}','${ids.a}','${project}','${ids.sa}',${amount},'2026-10-25',auth.uid())`);return t;};

let serial=0;
const cnpj=base=>{const d=(s,w)=>{const r=[...s].reduce((v,x,i)=>v+Number(x)*w[i],0)%11;return r<2?0:11-r;};const n=base+d(base,[5,4,3,2,9,8,7,6,5,4,3,2]);return n+d(n,[6,5,4,3,2,9,8,7,6,5,4,3,2]);};
async function freshScope(opening){const entity=id(),project=id(),bank=id();await sql(container,`insert into legal_entities(id,company_id,legal_name,cnpj) values('${entity}','${ids.a}','Entidade fictícia ${++serial}','${cnpj('9912345600'+String(serial).padStart(2,'0'))}');insert into finance_entity_permissions values('${ids.a}','${entity}','${ids.ug}',true,true);insert into projects(id,company_id,legal_entity_id,name,created_by) values('${project}','${ids.a}','${entity}','Obra fictícia ${serial}','${ids.ug}')`);await user(`insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,opening_balance,opening_balance_date,allow_negative) values('${bank}','${ids.a}','${entity}','Conta fictícia ${serial}','Fictício','${bank}',${opening},'2026-10-01',false);select validate_cash_opening('${bank}','${id()}',0,'Extrato inicial fictício completo','Validação de abertura da fixture')`);return {entity,project,bank};}
async function receivable(amount,project){const t=id(),unit=id(),sale=id();await sql(container,`insert into units(id,company_id,project_id,code) values('${unit}','${ids.a}','${project}','U');insert into sales(id,company_id,project_id,unit_id,client_id,number,sale_date,total_amount) values('${sale}','${ids.a}','${project}','${unit}','${ids.ca}','${sale}','2026-10-01',${amount})`);await user(`select set_config('finance.effective_date','2026-10-21',true);insert into receivables(id,company_id,project_id,sale_id,client_id,unit_id,category,description,due_date,amount,adjusted_amount,created_by) values('${t}','${ids.a}','${project}','${sale}','${ids.ca}','${unit}','other','Fixture AR','2026-10-25',${amount},${amount},auth.uid())`);return t;}
async function save(scope,rows,parent,minimum,reason){return (await user(`select save_cash_scenario('${ids.a}','${scope.entity}',${scope.scenarioProject?quote(scope.scenarioProject):'null'},${parent?quote(parent):'null'},'${id()}','2026-10-21','2026-12-31',${minimum},${scope.baseline?quote(scope.baseline):'null'},${q(rows)},'Premissas fictícias aprovadas CT17/25',${quote(reason)})`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));}
async function importRows(rows){const raw=JSON.stringify(rows);const body={enterprise_id:'fixture-main',currency:'BRL',monetary_basis:'principal',extracted_at:new Date().toISOString(),period_start:'2026-10-01',period_end:'2026-10-21',cutoff:'2026-10-21',reason:'Reimportação fictícia independente',records:rows,pages:[{raw,sha256:crypto.createHash('sha256').update(raw).digest('hex'),request_cursor:null,next_cursor:null}],manifest:{complete:true,expected_count:rows.length,unique_count:rows.length,subtotal_cents:rows.reduce((a,r)=>a+r.principal_cents,0)}};return j(await sql(container,`begin;set local role service_role;select set_config('request.jwt.claim.sub','${ids.ug}',true);select elos_import.apply_financial_batch('${ids.a}','${id()}',${q(body)});commit;`));}

async function confirmAccounts(accountIds,tag){
 for(const a of await data('finance_bank_accounts',`id in(${accountIds.map(quote).join(',')})`)){
  await user(`select validate_cash_opening('${a.id}','${id()}',0,'Extrato inicial completo da fixture','Comprovação isolada de abertura')`);
  const movements=await data('finance_bank_transactions',`bank_account_id='${a.id}' and status<>'cancelled'`);
  const entries=movements.map(m=>({fit_id:tag+':'+m.id,transaction_date:m.transaction_date,amount:Number(m.amount)*(m.direction==='credit'?1:-1),description:'Extrato fictício '+tag}));
  if(entries.length){const hash=crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');await user(`select bank_import_ofx('${a.id}','${tag}.ofx','${hash}',null,${quote(a.account_number)},${q(entries)})`);
   for(const m of movements){const entry=(await data('finance_statement_entries',`bank_account_id='${a.id}' and fit_id=${quote(tag+':'+m.id)}`))[0];await user(`select bank_link_entry('${entry.id}','${m.id}',${m.amount})`);}
  }
 }
 return {accounts:(await data('finance_bank_accounts',`id in(${accountIds.map(quote).join(',')})`)).map(a=>({...a,opening_validated:true})),links:await data('finance_reconciliation_links'),entries:await data('finance_statement_entries')};
}
async function check(name,fn){try{results.push({name,pass:true,evidence:await fn()});}catch(e){results.push({name,pass:false,error:e.message,stack:e.stack});}}
try{
 await setup(container);
 await check('CT12_obrigacao_validada_da_entidade_sem_obra',async()=>{
  const rows=[{external_id:'E8-12-A',installment:'1',document:'Evidência CT12',principal_cents:600000,reported_paid_cents:0,source_status:'Pendente',due_date:'2026-10-21',effective_date:'2026-10-21',legal_entity_id:ids.a1,project_id:ids.pa1,supplier_id:ids.sa,obligation_evidence:'aceite-economico-ficticio'},
  {external_id:'E8-12-U',installment:'1',document:'Sem obra documentado',principal_cents:400000,reported_paid_cents:0,source_status:'Pendente',due_date:'2026-10-21',effective_date:'2026-10-21',legal_entity_id:ids.a1,project_id:null,supplier_id:ids.sa,obligation_evidence:'aceite-economico-ficticio'}];
  const raw=JSON.stringify(rows),body={enterprise_id:'unknown-project',currency:'BRL',monetary_basis:'principal',extracted_at:'2026-10-22T12:00:00Z',period_start:'2026-10-01',period_end:'2026-10-21',cutoff:'2026-10-21',reason:'CT12 factual sem obra ficticia',records:rows,pages:[{raw,sha256:crypto.createHash('sha256').update(raw).digest('hex'),request_cursor:null,next_cursor:null}],manifest:{complete:true,expected_count:2,unique_count:2,subtotal_cents:1000000}};
  const imported=j(await sql(container,`begin;set local role service_role;select set_config('request.jwt.claim.sub','${ids.ug}',true);select elos_import.apply_financial_batch('${ids.a}','${id()}',${q(body)});commit;`));
  const obj=imported.reconciliation.rows.find(x=>x.external_id==='E8-12-U');assert.equal(obj.target_id,null);
  await assert.rejects(()=>user(`select settle_finance_titles('${ids.a}','${id()}','${ids.bank1}','2026-10-21',${q([{type:'AP',title_id:obj.object_id,principal:2000}])},'Sem validação não baixa')`),/indisponível/);
  const cmd=id(),args=`'${ids.a}','${obj.object_id}','${cmd}','2026-09-30','Aceite econômico CT12 com titular','Validação financeira explícita da obrigação',4000`;
  await assert.rejects(()=>user(`select validate_unassigned_obligation(${args})`,ids.ur),/permissão/);
  const payable=await user(`select validate_unassigned_obligation(${args})`).then(s=>s.split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x)));assert.ok(payable);
  assert.ok((await user(`select validate_unassigned_obligation(${args})`)).includes(payable)); // exact RPC replay also checked by stored count
  assert.equal((await data('finance_obligation_validations',`object_id='${obj.object_id}'`)).length,1);
  const payment=j(await user(`select settle_finance_titles('${ids.a}','${id()}','${ids.bank1}','2026-10-21',${q([{type:'AP',title_id:payable,principal:2000}])},'Pagamento CT12 comprovado')`));
  const imp=j(await user(`select bank_import_ofx('${ids.bank1}','CT12.ofx',repeat('c',64),null,'1',${q([{fit_id:'CT12-debit',transaction_date:'2026-10-21',amount:-2000,description:'CT12 comprovado'}])})`));
  const entry=(await data('finance_statement_entries',"fit_id='CT12-debit'"))[0];await user(`select bank_link_entry('${entry.id}','${payment.bank_transaction_id}',2000)`);
  const idsTitles=imported.reconciliation.rows.map(x=>x.target_id).filter(Boolean).concat(payable);const titles=await data('payables',`id in(${idsTitles.map(quote).join(',')})`);const missing=titles.find(t=>t.project_id===null);
  const cash=(await data('finance_bank_transactions',`id='${payment.bank_transaction_id}'`))[0];assert.equal(cash.project_id,null);assert.equal(cash.legal_entity_id,ids.a1);
  await assert.rejects(()=>user(`insert into finance_bank_transactions(company_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,payable_id,created_by) values('${ids.a}','${ids.a2}','${ids.bank2}','2026-10-21','debit','payment','Vínculo estrangeiro',1,'${payable}',auth.uid())`),/incompatível/);
  const knownFact=(await data('elos_import.financial_objects',`target_id='${idsTitles[0]}'`))[0];const knownCost=Number(knownFact.snapshot.principal_cents);const unclassifiedCost=toCents((await data('finance_obligation_validations',`title_id='${payable}'`))[0].economic_amount);
  states.CT12={entity_cost_cents:knownCost+unclassifiedCost,obra_A_cost_cents:knownCost,unclassified_cost_cents:toCents((await data('finance_obligation_validations',`title_id='${payable}'`))[0].economic_amount),entity_open_payables_cents:titles.reduce((s,t)=>s+toCents(t.finance_open_amount),0),obra_A_open_payables_cents:titles.filter(t=>t.project_id===ids.pa1).reduce((s,t)=>s+toCents(t.finance_open_amount),0),unclassified_open_payables_cents:toCents(missing.finance_open_amount),entity_disbursed_cents:toCents(cash.amount),unclassified_disbursed_cents:cash.project_id===null?toCents(cash.amount):0,automatic_Flow_allocation_cents:cash.project_id===ids.pa1?toCents(cash.amount):0,appropriation_on_original_amounts_numerator_cents:knownCost,appropriation_on_original_amounts_denominator_cents:titles.reduce((s,t)=>s+toCents(t.amount),0),appropriation_on_original_amounts_percent:(knownCost*100/titles.reduce((s,t)=>s+toCents(t.amount),0)).toFixed(2),obra_cost_complete:missing.project_id!==null};
  assert.equal(states.CT12.entity_open_payables_cents,800000);return {actual:states.CT12,imported,validation:await data('finance_obligation_validations'),titles,payment,bank_import:imp};
 });
 await check('CT15_transferencia_com_transito_e_tarifa',async()=>{
  const a=id(),b=id();await user(`insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,opening_balance,opening_balance_date,allow_negative) values('${a}','${ids.a}','${ids.a1}','CTA','Fictício','${a}',50000,'2026-10-01',false),('${b}','${ids.a}','${ids.a1}','CTB','Fictício','${b}',10000,'2026-10-01',false)`);
  const cmd=id(),args=`'${ids.a}','${a}','${b}','${cmd}','2026-10-20',null,20000,15,'own','Transferência titular comprovado','Transferência fictícia CT15'`;
  const transfer=(await user(`select record_cash_transfer(${args})`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));assert.ok(transfer);await user(`select record_cash_transfer(${args})`);
  const accounts=await data('finance_bank_accounts',`id in('${a}','${b}')`);let movements=await data('finance_bank_transactions',`bank_account_id in('${a}','${b}')`);let transfers=await data('finance_bank_transfers',`id='${transfer}'`);
  let first=realizedCashflow({accounts,movements,transfers,from:'2026-10-20',to:'2026-10-20'});assert.equal(first.transfer_in_transit_cents,2000000);
  await user(`select complete_cash_transfer('${transfer}','2026-10-21','Crédito CT15 confirmado','Efetivação fictícia em B')`);await user(`select complete_cash_transfer('${transfer}','2026-10-21','Crédito CT15 confirmado','Efetivação fictícia em B')`);
  movements=await data('finance_bank_transactions',`bank_account_id in('${a}','${b}')`);transfers=await data('finance_bank_transfers',`id='${transfer}'`);const proof=await confirmAccounts([a,b],'CT15');first=realizedCashflow({...proof,movements,transfers,from:'2026-10-20',to:'2026-10-20'});const last=realizedCashflow({...proof,movements,transfers,from:'2026-10-20',to:'2026-10-21'});assert.equal(last.confirmed_closing_cents,5998500);
  const at=(r,account)=>r.accounts.find(x=>x.account_id===account).closing_cents;
  states.CT15={end_2026_10_20:{A_bank_cents:at(first,a),B_bank_cents:at(first,b),sum_bank_balances_cents:first.closing_cents,transfer_in_transit_cents:first.transfer_in_transit_cents,available_bank_cash_cents:first.closing_cents,external_outflow_cents:first.external_outgoing_cents},end_2026_10_21:{A_bank_cents:at(last,a),B_bank_cents:at(last,b),sum_bank_balances_cents:last.closing_cents,transfer_in_transit_cents:last.transfer_in_transit_cents,external_outflow_cents:last.external_outgoing_cents,external_receipt_cents:last.external_incoming_cents}};
  assert.equal(last.closing_cents,5998500);assert.equal(movements.length,3);return {actual:states.CT15,first,last,transfers,movements};
 });
 await check('CT16_mutuo_perimetro_explicito_e_isolamento',async()=>{
  const a=id(),b=id();await user(`insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,opening_balance,opening_balance_date,allow_negative) values('${a}','${ids.a}','${ids.a1}','Mutuo A','Fictício','${a}',50000,'2026-10-01',false),('${b}','${ids.a}','${ids.a2}','Mutuo B','Fictício','${b}',10000,'2026-10-01',false)`);
  const before=[(await data('finance_obligation_validations')).length,(await data('receivables')).length];
  const transfer=(await user(`select record_cash_transfer('${ids.a}','${a}','${b}','${id()}','2026-10-21','2026-10-21',20000,0,'loan','Contrato de mútuo fictício aprovado','Mútuo entre titulares distintos')`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));
  const accounts=await data('finance_bank_accounts',`id in('${a}','${b}')`),movements=await data('finance_bank_transactions',`bank_account_id in('${a}','${b}')`),transfers=await data('finance_bank_transfers',`id='${transfer}'`);
  const proof=await confirmAccounts([a,b],'CT16');const calc=(acc,eliminateInterentity=false)=>realizedCashflow({...proof,accounts:acc.map(x=>({...x,opening_validated:true})),movements,transfers,from:'2026-10-21',to:'2026-10-21',eliminateInterentity});const A=calc(accounts.filter(x=>x.id===a)),B=calc(accounts.filter(x=>x.id===b)),C=calc(accounts,true);const amount=toCents(transfers[0].amount);
  assert.equal(calc(accounts).external_incoming_cents,amount);assert.equal(C.external_incoming_cents,0);
  await assert.rejects(()=>user(`select record_cash_transfer('${ids.a}','${a}','${b}','${id()}','2026-10-21',null,1,0,'loan','Contrato fictício','Usuário sem B')`,ids.ua),/permissão|autorização/);
  states.CT16={A:{cash_cents:A.closing_cents,loan_receivable_cents:amount,loan_disbursement_cents:A.external_outgoing_cents},B:{cash_cents:B.closing_cents,loan_liability_cents:amount,financing_inflow_cents:B.external_incoming_cents},consolidated:{cash_cents:C.closing_cents,external_flow_from_loan_cents:C.external_outgoing_cents+C.external_incoming_cents,eliminated_asset_cents:amount,eliminated_liability_cents:amount},construction_cost_created_cents:((await data('finance_obligation_validations')).length-before[0])*amount,sales_revenue_created_cents:((await data('receivables')).length-before[1])*amount};return {actual:states.CT16,A,B,C,transfers};
 });
 await check('CT17_versoes_persistidas_reprogramacao_e_vencimentos',async()=>{
  const scope=await freshScope(100000),r=await title(20000,scope.project);const ar=await receivable(60000,scope.project);const contract=id();
  await sql(container,`insert into execution_service_contracts values('${contract}','${ids.a}','${scope.project}','active',60000)`);
  const rows=[{scope_key:'R1',category:'R',amount_cents:2000000,title_id:r,title_type:'AP',source_kind:'title',expected_date:'2026-10-25'},
   {scope_key:'AR1',category:'AR',amount_cents:6000000,title_id:ar,title_type:'AR',source_kind:'title',expected_date:'2026-10-25'},
   {scope_key:'C1',category:'C',amount_cents:1000000,source_kind:'contract',source_id:contract,expected_date:'2026-10-26'},
   {scope_key:'C2',category:'C',amount_cents:5000000,source_kind:'contract',source_id:contract,expected_date:'2026-11-15'},
   {scope_key:'P1',category:'P',amount_cents:3000000,source_kind:'documented_estimate',expected_date:'2026-12-10'},
   {scope_key:'P2',category:'P',amount_cents:1000000,source_kind:'documented_estimate',expected_date:'2026-12-20'}];
  const original=await save(scope,rows,null,20000,'Cronograma financeiro original aprovado');
  const moved=rows.map(x=>({...x,expected_date:({AR1:'2026-12-10',C1:'2026-11-15',P1:'2026-11-20'})[x.scope_key]??x.expected_date}));
  const next=await save(scope,moved,original,20000,'Cronograma físico reprogramado sem mudar preços');
  const versions=await data('finance_cash_scenarios',`id in('${original}','${next}')`);const first=versions.find(x=>x.id===original),last=versions.find(x=>x.id===next);
  const calc=v=>snapshotCashProjection(v.source_snapshot,v.request.rows,{cutoff:v.cutoff,through:v.completion_date,minimumCashCents:toCents(v.minimum_cash)});
  const a=calc(first),b=calc(last);assert.equal(a.months[0].closing_cents,13000000);assert.equal(b.months[1].closing_cents,-1000000);
  await assert.rejects(()=>save(scope,moved,original,20000,'Segunda edição concorrente obsoleta'),/obsoleta/);
  await assert.rejects(()=>save(scope,moved.map(x=>x.scope_key==='R1'?{...x,expected_date:'2026-11-15'}:x),next,20000,'Arrastar vencimento sem acordo'),/vencimento/);
  await assert.rejects(()=>user(`update finance_cash_scenarios set reason='forjado' where id='${original}'`),/permission denied|imutável/);
  const native=(await data('payables',`id='${r}'`))[0];assert.equal(native.due_date,'2026-10-25');
  await user(`select revise_finance_payable('${ids.a}','${r}','${id()}',${native.finance_version},20000,'2026-11-15','2026-10-28','Acordo válido fictício, variante independente')`);
  const audits=await data('finance_title_audit',`title_id='${r}'`),now=(await data('payables',`id='${r}'`));const at=t=>titlesAt({titles:now,audits,type:'AP',cutoff:t});
  states.CT17={Q_before_and_after_cents:a.months.reduce((s,m)=>s+m.outgoing_cents,0),ETC_before_and_after_cents:rows.filter(x=>['C','P'].includes(x.category)).reduce((s,x)=>s+x.amount_cents,0),EAC_before_and_after_cents:2000000+rows.filter(x=>['C','P'].includes(x.category)).reduce((s,x)=>s+x.amount_cents,0),incurred_cost_unchanged_cents:toCents(native.amount),original_projected_closing_cash_cents:Object.fromEntries(a.months.map(m=>[m.month,m.closing_cents])),reprogrammed_projected_closing_cash_cents:Object.fromEntries(b.months.map(m=>[m.month,m.closing_cents])),original_peak_additional_funding_cents:a.peak_additional_funding_cents,reprogrammed_peak_additional_funding_cents:b.peak_additional_funding_cents,AP_overdue_at_2026_10_31_cents:toCents(native.amount),AR_overdue_at_2026_10_31_cents:toCents((await data('receivables',`id='${ar}'`))[0].amount),original_version_retained:versions.some(x=>x.id===original&&x.parent_id===null),separate_valid_renegotiation_variant:{effective_event_date:'2026-10-28',original_due:native.due_date,new_due:at('2026-10-31')[0].due_date,R_unchanged_cents:dueBuckets(at('2026-10-31'),'2026-10-31').R_cents,overdue_before_event_at_2026_10_27_cents:dueBuckets(at('2026-10-27'),'2026-10-27').overdue_cents,overdue_after_event_at_2026_10_31_cents:dueBuckets(at('2026-10-31'),'2026-10-31').overdue_cents,Q_unchanged_cents:b.months.reduce((s,m)=>s+m.outgoing_cents,0)}};
  return {actual:states.CT17,original:a,reprogrammed:b,version_ids:[original,next],source_snapshot_versions:versions,sources_frozen:true};
 });
 await check('CT25_ocorrencia_substituida_por_titulo_sem_recriar_previsao',async()=>{
  const scope=await freshScope(10000);const rows=['10','11','12'].map(month=>({scope_key:'REC-2026-'+month,category:'P',amount_cents:100000,expected_date:'2026-'+month+'-22',source_kind:'documented_estimate'}));
  const version=await save(scope,rows,null,0,'Recorrência trimestral sem contrato firme');const initial=futureCashRows({scenarioRows:rows,cutoff:'2026-10-21'});
  const t=await title(1000,scope.project),cmd=id(),args=`'${ids.a}','${scope.entity}','${scope.project}','REC-2026-10','${version}','AP','${t}','${cmd}','Serviço de outubro aceito','Vínculo documental da ocorrência'`;
  await user(`select link_cash_coverage(${args})`);await user(`select link_cash_coverage(${args})`);
  const links=await data('finance_cash_coverage_links',`legal_entity_id='${scope.entity}'`),titles=await data('payables',`id='${t}'`);const after=futureCashRows({payables:titles,scenarioRows:rows,coverageLinks:links,cutoff:'2026-10-21'});
  const payment=j(await user(`select settle_finance_titles('${ids.a}','${id()}','${scope.bank}','2026-10-21',${q([{type:'AP',title_id:t,principal:1000}])},'Pagamento da ocorrência outubro')`));
  const origin={external_id:'REC-2026-10',installment:'1',target_id:t,binding_evidence:'Ocorrência documento e parcela confirmados',document:'Recorrência outubro',principal_cents:100000,reported_paid_cents:0,source_status:'Pendente',due_date:'2026-10-25',effective_date:'2026-10-21',legal_entity_id:scope.entity,project_id:scope.project,supplier_id:ids.sa,obligation_evidence:'Serviço aceito em outubro'};
  const firstImport=await importRows([origin]),secondImport=await importRows([origin]);assert.equal((await data('elos_import.financial_objects',`target_id='${t}'`)).length,1);
  await confirmAccounts([scope.bank],'CT25');
  const paidTitles=await data('payables',`id='${t}'`),paid=futureCashRows({payables:paidTitles,scenarioRows:rows,coverageLinks:links,cutoff:'2026-10-21'});const value=(f,c)=>f.rows.filter(x=>x.category===c).reduce((s,x)=>s+x.amount_cents,0);
  states.CT25={initial_P_cents:value(initial,'P'),after_title_R_cents:value(after,'R'),after_title_P_cents:value(after,'P'),after_title_Q_cents:after.rows.reduce((s,x)=>s+x.amount_cents,0),after_payment_R_cents:value(paid,'R'),after_payment_P_cents:value(paid,'P'),after_payment_Q_cents:paid.rows.reduce((s,x)=>s+x.amount_cents,0),october_incurred_cost_cents:toCents(titles[0].amount),october_cash_cents:toCents((await data('finance_bank_transactions',`id='${payment.bank_transaction_id}'`))[0].amount),active_occurrence_count:(await data('finance_cash_scenario_rows',`scenario_id='${version}'`)).length,duplicate_october_obligations:(await data('elos_import.financial_objects',`target_id='${t}'`)).length-1};
  assert.equal(states.CT25.after_payment_Q_cents,200000);return {actual:states.CT25,version,links,payment,paidTitles,firstImport,secondImport};
 });

 await check('cronograma_fisico_reprograma_somente_futuro_e_P_migra_para_C',async()=>{
  const scope=await freshScope(10000);scope.scenarioProject=scope.project;scope.baseline=id();const activity=id(),contract=id();
  await sql(container,`insert into engineering_schedule_baselines values('${scope.baseline}','${ids.a}','${scope.project}');insert into engineering_schedule_activities values('${activity}','${ids.a}','${scope.project}','${scope.baseline}','2026-11-05');insert into execution_service_contracts values('${contract}','${ids.a}','${scope.project}','active',1000)`);
  const rows=[{scope_key:'Servico-saldo',category:'P',amount_cents:100000,source_kind:'documented_estimate',expected_date:'2026-11-05',activity_id:activity,payment_lag_days:0}];const original=await save(scope,rows,null,0,'Planejamento físico-financeiro original');
  await sql(container,`update engineering_schedule_activities set planned_finish='2026-12-05' where id='${activity}'`);
  const cmd=id(),args=`'${ids.a}','${original}','${cmd}','2026-10-21','Cronograma revisado fictício documentado','Reprogramação por atividade aprovada'`;
  const next=(await user(`select reprogram_cash_schedule(${args})`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));assert.ok(next);assert.ok((await user(`select reprogram_cash_schedule(${args})`)).includes(next));
  const old=(await data('finance_cash_scenario_rows',`scenario_id='${original}'`))[0],updated=(await data('finance_cash_scenario_rows',`scenario_id='${next}'`))[0];assert.equal(old.expected_date,'2026-11-05');assert.equal(updated.expected_date,'2026-12-05');assert.equal(updated.amount_cents,old.amount_cents);
  const contracted=(await user(`select convert_cash_scope_to_contract('${ids.a}','${next}','${id()}','Servico-saldo','${contract}','Contrato firme documentado','Substituição de previsão por contrato aprovado')`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));assert.ok(contracted);
  const current=(await data('finance_cash_scenario_rows',`scenario_id='${contracted}'`))[0];assert.equal(current.category,'C');assert.equal(current.amount_cents,100000);assert.equal((await data('finance_cash_scenarios',`legal_entity_id='${scope.entity}'`)).length,3);
  const over=await title(2000,scope.project);await assert.rejects(()=>user(`select link_cash_coverage('${ids.a}','${scope.entity}','${scope.project}','Servico-saldo','${contracted}','AP','${over}','${id()}','Documento fictício','Vínculo superior à cobertura')`),/excede/);
  const forbidden=await user(`select count(*) from finance_cash_scenarios where legal_entity_id='${scope.entity}'`,ids.ua);assert.equal(forbidden.split('\n').at(-2),'0');
  await assert.rejects(()=>user(`update finance_cash_scenario_rows set amount_cents=0 where scenario_id='${original}'`),/permission denied|imutável/);
  return {original:old,reprogrammed:updated,contracted:current,versions_retained:3,realized_bank_mutations:(await data('finance_bank_transactions',`bank_account_id='${scope.bank}'`)).length};
 });

 await check('concorrencia_transferencias_nao_excede_disponibilidade',async()=>{
  const scope=await freshScope(1000),bank=id();await user(`insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,opening_balance,opening_balance_date,allow_negative) values('${bank}','${ids.a}','${scope.entity}','Destino fictício','Fictício','${bank}',0,'2026-10-01',false)`);
  const run=command=>user(`select record_cash_transfer('${ids.a}','${scope.bank}','${bank}','${command}','2026-10-21','2026-10-21',700,0,'own','Comprovante fictício de transferência','Concorrência sobre saldo de mil')`);
  const outcomes=await Promise.allSettled([run(id()),run(id())]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.match(outcomes.find(x=>x.status==='rejected').reason.message,/insuficiente/);
  const moves=await data('finance_bank_transactions',`bank_account_id in('${scope.bank}','${bank}')`);assert.equal(moves.length,2);return {accepted:1,rejected:1,movements:moves};
 });

 await check('evento_inverso_preserva_transferencia_e_historico_bancario',async()=>{
  const scope=await freshScope(10000),bank=id();await user(`insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,opening_balance,opening_balance_date,allow_negative) values('${bank}','${ids.a}','${scope.entity}','Destino a devolver','Fictício','${bank}',0,'2026-10-01',false)`);
  const original=(await user(`select record_cash_transfer('${ids.a}','${scope.bank}','${bank}','${id()}','2026-10-21','2026-10-21',100,0,'own','Comprovante original fictício','Original rastreável sem exclusão')`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));assert.ok(original);
  await assert.rejects(()=>sql(container,`update finance_bank_transactions set status='cancelled' where transfer_id='${original}'`),/evento separado/);
  await assert.rejects(()=>sql(container,`update finance_bank_transfers set status='cancelled',cancellation_reason='Apagar indevidamente' where id='${original}'`),/evento inverso/);
  const command=id(),args=`'${original}','${command}','2026-10-22','2026-10-22',0,'Devolução efetiva documentada','Evento inverso com prova bancária'`;
  const reversed=(await user(`select reverse_cash_transfer(${args})`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));assert.ok(reversed);assert.ok((await user(`select reverse_cash_transfer(${args})`)).includes(reversed));
  const moves=await data('finance_bank_transactions',`bank_account_id in('${scope.bank}','${bank}')`);assert.equal(moves.length,4);
  const originalRow=(await data('finance_bank_transfers',`id='${original}'`))[0];assert.equal(originalRow.status,'posted');const child=(await data('finance_bank_transfers',`id='${reversed}'`))[0];assert.equal(child.reversal_of,original);
  const proof=await confirmAccounts([scope.bank,bank],'ESTORNO-TRANSFER');const at=t=>realizedCashflow({...proof,movements:moves,transfers:[originalRow,child],from:'2026-10-21',to:t});
  assert.equal(at('2026-10-21').accounts.find(a=>a.account_id===scope.bank).closing_cents,990000);assert.equal(at('2026-10-22').accounts.find(a=>a.account_id===scope.bank).closing_cents,1000000);
  return {original:originalRow,inverse:child,movements:moves,opening_restored_cents:1000000,original_day_retained_cents:990000};
 });

}catch(e){results.push({name:'bootstrap',pass:false,error:e.message,stack:e.stack});}
finally{await exec('docker',['rm','-f',container]);fs.writeFileSync(root+'/banco.json',JSON.stringify({executed_at:new Date().toISOString(),network:'none',container_removed:true,results,states,passed:results.filter(x=>x.pass).length,failed:results.filter(x=>!x.pass).length},null,2)+'\n');console.log(JSON.stringify(results.map(r=>({name:r.name,pass:r.pass,error:r.error}))));if(results.some(x=>!x.pass))process.exitCode=1;}
