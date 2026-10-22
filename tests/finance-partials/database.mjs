import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {start,sql,exec,ids,asUser} from '../financeiro/runtime.mjs';
import {setup} from './setup.mjs';
import {quote as q,json,lastJson as j,sqlClient} from './client.mjs';
import {loadCashflow,loadCostVsBudget} from './loaders.mjs';
import {titlesAt} from '../../lib/finance-core/ledger-position.mjs';
import {titlePosition} from '../../lib/finance-core/titles.mjs';
import {collectFinancialPages} from '../../lib/koper-finance/collection.mjs';
import {toCents} from '../../lib/finance-core/cashflow.mjs';

const root=process.env.FINANCE12_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa12-parciais/evidencias';fs.mkdirSync(root,{recursive:true});
const fixtures=JSON.parse(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json'));
const f=id=>fixtures.cases.find(c=>c.id===id),uuid=()=>crypto.randomUUID();
const container=await start(),results=[],states={},records={},views={};
const user=(text,actor=ids.ug)=>sql(container,asUser(actor,text));
const rows=(table,where='true',actor=null)=>{
 const query=`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from ${table} t where ${where}`;
 return (actor?user(query,actor):sql(container,query)).then(j);
};
const check=async(name,run)=>{try{const evidence=await run();results.push({name,pass:true,evidence});}catch(e){results.push({name,pass:false,error:e.message,stack:e.stack});}};
function cnpj(base){const digit=(s,w)=>{const n=[...s].reduce((n,d,i)=>n+Number(d)*w[i],0)%11;return n<2?0:11-n;};const a=base+digit(base,[5,4,3,2,9,8,7,6,5,4,3,2]);return a+digit(a,[6,5,4,3,2,9,8,7,6,5,4,3,2]);}
let serial=0;
async function scope(tag,opening=1000000,restricted=0){
 const s={tag,entity:uuid(),project:uuid(),account:uuid(),company:ids.a};
 await sql(container,`insert into legal_entities(id,company_id,legal_name,cnpj) values('${s.entity}','${ids.a}',${q(tag+' entidade fictícia')},'${cnpj('9987654300'+String(++serial).padStart(2,'0'))}');
 insert into finance_entity_permissions values('${ids.a}','${s.entity}','${ids.ug}',true,true),('${ids.a}','${s.entity}','${ids.ur}',true,false);
 insert into projects(id,company_id,legal_entity_id,name,created_by) values('${s.project}','${ids.a}','${s.entity}',${q(tag+' obra fictícia')},'${ids.ug}');`);
 await user(`insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,account_number,opening_balance,opening_balance_date,allow_negative)
 values('${s.account}','${ids.a}','${s.entity}',${q(tag)},'Fictício',${q(tag)},${opening},'2026-10-01',false);
 select validate_cash_opening('${s.account}','${uuid()}',${restricted},'Extrato inicial fictício independente','Abertura documentada da fixture')`);
 return s;
}
async function title(s,amount,due='2026-11-20'){
 const id=uuid();await user(`select set_config('finance.reason','Obrigação documentada fictícia ${s.tag}',true);select set_config('finance.effective_date','2026-10-01',true);
 insert into payables(id,company_id,project_id,supplier_id,document,amount,due_date,source_system,source_id,created_by)
 values('${id}','${ids.a}','${s.project}','${ids.sa}',${q(s.tag)},${amount},'${due}','elos_os','${id}',auth.uid())`);return id;
}
const settle=(s,t,amount,date)=>user(`select settle_finance_titles('${ids.a}','${uuid()}','${s.account}','${date}',${json([{type:'AP',title_id:t,principal:amount}])},'Pagamento documentado ${s.tag}')`).then(j);
async function statement(s,entries,events){
 const raw=JSON.stringify(entries),hash=crypto.createHash('sha256').update(raw).digest('hex');
 const before=await rows('finance_bank_transactions',`bank_account_id='${s.account}'`);
 const importSQL=`select bank_import_ofx('${s.account}',${q(s.tag+'.ofx')},'${hash}',null,${q(s.tag)},${json(entries)})`;
 await user(importSQL);
 for(let i=0;i<entries.length;i++){
  const entry=(await rows('finance_statement_entries',`bank_account_id='${s.account}' and fit_id=${q(entries[i].fit_id)}`))[0];
  await user(`select bank_link_entry('${entry.id}','${events[i].bank_transaction_id}',${Math.abs(entries[i].amount)})`);
 }
 await user(importSQL);
 const after=await rows('finance_bank_transactions',`bank_account_id='${s.account}'`);
 const money=rs=>rs.reduce((n,r)=>n+(r.direction==='debit'?-1:1)*toCents(r.amount),0);
 assert.equal(after.length,before.length);assert.equal(money(after),money(before));
 return {raw,sha256:hash,entries,cash_created_by_reconciliation_cents:money(after)-money(before)};
}
async function save(s,rows,parent=null,kind='reschedule',cutoff='2026-10-21',minimum=0){
 return (await user(`select save_cash_scenario('${ids.a}','${s.entity}',${s.entityView?'null':q(s.project)},${parent?q(parent):'null'},'${uuid()}','${cutoff}','2026-12-31',${minimum},null,${json(rows)},'Premissas fictícias aprovadas ${s.tag}','Versão documentada ${s.tag}','${kind}')`)).split('\n').findLast(x=>/^[0-9a-f-]{36}$/.test(x));
}
const view=(s,cutoff='2026-10-21',version=null,actor=ids.ug)=>loadCashflow({supabase:sqlClient(container,actor),companyId:ids.a,projectId:s.entityView?null:s.project,entityId:s.entity,scenarioId:version,cutoff,from:'2026-10-01'});
async function capture(s){
 const tables=['payables','finance_title_audit','finance_settlement_events','finance_settlement_lines','finance_title_charges','finance_cash_adjustment_realizations','finance_cash_scenarios','finance_cash_scenario_rows','finance_cash_coverage_links','finance_bank_transactions','finance_statement_entries','finance_reconciliation_links','execution_service_contracts','execution_contract_measurements','execution_contract_measurement_items'];
 const data={scope:s};for(const table of tables){const all=await rows(table);data[table]=all.filter(r=>r.project_id===s.project||r.legal_entity_id===s.entity||r.title_id===s.title);}
 records[s.tag]=data;return data;
}
try{
 await setup(container);
 await check('CT02_reimportacao_aprovacao_e_tres_cortes_persistidos',async()=>{
  const i=f('CT02').inputs;
  const r={external_id:'77',installment:'1',document_id:'DOC-77',document:'Documento CT02',principal_cents:i.original_principal_cents,
   reported_paid_cents:0,source_status:'Pendente',due_date:'2026-10-30',effective_date:'2026-10-19',obligation_evidence:'Obrigação fictícia aprovada',legal_entity_id:ids.a1,project_id:ids.pa1,supplier_id:ids.sa};
  const batch=async(row,stamp)=>({...await collectFinancialPages({expectedCount:1,fetchPage:async()=>({rows:[row],raw:JSON.stringify([row]),nextCursor:null})}),enterprise_id:'fixture-main',currency:'BRL',monetary_basis:'principal',extracted_at:new Date(stamp).toISOString(),period_start:'2026-10-01',period_end:'2026-10-21',cutoff:'2026-10-21',filters:{entity:'AP',status:'all'},reason:'Importação com aprovação documental CT02'});
  // Import is private to the trusted worker schema, as in the existing Etapa6 harness.
  // The worker connection supplies actor claims; the RPC still checks company/entity permissions.
  const apply=async(b,stamp)=>j(await sql(container,`begin;select set_config('request.jwt.claim.sub','${ids.ug}',true);select set_config('validation.known_at',${q(stamp)},true);select elos_import.apply_financial_batch('${ids.a}','${uuid()}',${json(b)});commit;`));
  const original=await batch(r,i.original_known_at);const first=await apply(original,i.original_known_at);assert.equal(first.accepted,1,JSON.stringify(first));
  const t=first.reconciliation.rows[0].target_id;
  const revision={...r,principal_cents:i.original_principal_cents+i.adjustment_cents,effective_date:i.effective_date,change_evidence:'Acréscimo2000 autorizado por responsável fictício CT02'};
  await sql(container,`create table validation.financial_approval(title_id uuid,amount_cents bigint,effective_date date,approved_by uuid,approved_at timestamptz,document text);
  insert into validation.financial_approval values('${t}',${i.adjustment_cents},'${i.effective_date}','${ids.ug}',${q(i.revision_known_at)},'CT02-AUTORIZACAO-2000')`);
  const revisedBatch=await batch(revision,i.revision_known_at);const applied=await apply(revisedBatch,i.revision_known_at);assert.equal(applied.accepted,1,JSON.stringify(applied));
  const replay=await apply(revisedBatch,i.revision_known_at);assert.equal(replay.unchanged,1);
  const audits=await rows('finance_title_audit',`title_id='${t}'`,ids.ug),titles=await rows('payables',`company_id='${ids.a}' and source_system='koper_finance' and source_id::jsonb->>0='fixture-main' and source_id::jsonb->>2='77'`,ids.ug);
  const get=async(T,K)=>{const stored=j(await user(`select coalesce(finance_payable_at('${t}','${T}',${q(K)}),'{}'::jsonb)`));const projected=titlesAt({titles,audits,type:'AP',cutoff:T,knownAt:K});assert.equal(projected.length,Object.keys(stored).length?1:0);if(projected.length)assert.equal(projected[0].amount,stored.amount);return projected;};
  const a=await get('2026-10-19',i.original_known_at),b=await get('2026-10-21',i.revision_known_at),c=await get('2026-10-21','2026-10-20T23:59:59.999-03:00');
  states.CT02={canonical_title_count:titles.length,original_snapshot_open_cents:titlePosition(a[0]).openCents,revised_snapshot_open_cents:titlePosition(b[0]).openCents,documented_bridge_cents:toCents(b[0].amount)-toCents(a[0].amount),at_T_2026_10_21_K_2026_10_20_open_cents:titlePosition(c[0]).openCents};assert.deepEqual(states.CT02,f('CT02').expected);
  assert.equal((await get('2026-10-18','2026-10-18T23:59:59-03:00')).length,0);
  assert.equal(audits.length,2);assert.ok(audits.every(a=>a.actor_id&&a.reason));
  assert.equal((await rows('payables',`id='${t}'`,ids.ub)).length,0);
  await assert.rejects(()=>user(`select revise_finance_payable('${ids.a}','${t}','${uuid()}',2,99999,'2026-10-30','2026-10-21','Alteração indevida de leitor')`,ids.ur));
  records.CT02={original,revisedBatch,first,applied,replay,titles,audits,approval:await rows('validation.financial_approval')};return states.CT02;
 });
 await check('CT03_pagamento_e_conciliacao_nao_criam_custo_economico',async()=>{
  const i=f('CT03').inputs,s=await scope('CT03');s.title=await title(s,i.principal_cents/100,'2026-10-21');
  const contract=uuid(),measurement=uuid(),service=uuid(),budget=uuid();
  await sql(container,`insert into execution_service_contracts(id,company_id,project_id,status,current_value) values('${contract}','${ids.a}','${s.project}','active',10000);
  insert into execution_contract_measurements(id,company_id,project_id,contract_id,payable_id,status) values('${measurement}','${ids.a}','${s.project}','${contract}','${s.title}','approved');
  insert into engineering_services(id,company_id,code,description) values('${service}','${ids.a}','CT03','Serviço fictício aceito');
  insert into execution_contract_measurement_items values('${uuid()}','${ids.a}','${s.project}','${measurement}','${service}','CT03','Serviço fictício aceito',10000);
  insert into validation.economic_acceptance values('${measurement}','CT03-ACEITE-SERVICO','2026-10-01',10000,'${ids.ug}','Fato econômico anterior aos pagamentos');
  insert into engineering_budgets(id,company_id,project_id,code,name,version,status,is_base) values('${budget}','${ids.a}','${s.project}','CT03','Orçamento fictício','1','approved',true);
  insert into engineering_budget_items values('${uuid()}','${ids.a}','${s.project}','${budget}','${service}','CT03','Serviço fictício',10000,'active');`);
  const cost=async()=>{const c=await loadCostVsBudget({supabase:sqlClient(container,ids.ug),companyId:ids.a,projectId:s.project});assert.deepEqual(c.errors,[]);return c;};
  const before=await cost(),p1=await settle(s,s.title,i.payments[0].cash_cents/100,i.payments[0].date),after1=(await rows('payables',`id='${s.title}'`))[0];
  const between=await cost(),p2=await settle(s,s.title,i.payments[1].cash_cents/100,i.payments[1].date),after2=(await rows('payables',`id='${s.title}'`))[0];
  const statementProof=await statement(s,i.payments.map((p,n)=>({fit_id:i.bank_transaction_ids[n],transaction_date:p.date,amount:-p.cash_cents/100,description:'CT03 extrato independente'})),[p1,p2]);
  const after=await cost(),flow=await view(s);views.CT03=flow;
  states.CT03={after_P1_open_cents:toCents(after1.finance_open_amount),after_P2_open_cents:toCents(after2.finance_open_amount),I02_gross_disbursed_cents:flow.history.confirmed_external_outgoing_cents,bank_debit_count:(await rows('finance_bank_transactions',`bank_account_id='${s.account}' and direction='debit'`)).length,payment_count:(await rows('finance_settlement_events',`project_id='${s.project}' and kind='payment'`)).length,cash_created_by_reconciliation_cents:statementProof.cash_created_by_reconciliation_cents,I01_extra_cost_created_by_payments_cents:toCents(after.totals.recognized)-toCents(before.totals.recognized)};
  assert.equal(toCents(before.totals.recognized),1000000);assert.equal(toCents(between.totals.recognized),1000000);assert.deepEqual(states.CT03,f('CT03').expected);
  const beforeForeign=await loadCostVsBudget({supabase:sqlClient(container,ids.ub),companyId:ids.a,projectId:s.project});assert.equal(beforeForeign.project,null);assert.equal(beforeForeign.rows.length,0);
  await capture(s);Object.assign(records.CT03,{economic_acceptance:await rows('validation.economic_acceptance'),cost_before:before,cost_between:between,cost_after:after,statement:statementProof});return states.CT03;
 });
 await check('CT18_cadeia_P_C_R_pagamento_AF_e_constituicao_persistida',async()=>{
  const i=f('CT18').inputs,s=await scope('CT18');const contract=uuid();
  const aRows=[{scope_key:'covered',category:'P',amount_cents:i.firm_contract_cents,expected_date:'2026-12-20',source_kind:'documented_estimate'},{scope_key:'uncovered',category:'P',amount_cents:i.initial_uncovered_forecast_cents-i.firm_contract_cents,expected_date:'2026-12-20',source_kind:'documented_estimate'}];
  const A=await save(s,aRows),observed=[];
  const observe=async(stage,T='2026-10-21',version=null)=>{const v=await view(s,T,version),total=category=>v.future.rows.filter(r=>r.category===category).reduce((sum,r)=>sum+r.amount_cents,0),R=total('R'),C=total('C'),P=total('P'),AF=total('AF');observed.push({stage,R_cents:R,C_cents:C,P_cents:P,Q_cents:R+C+P,AF_cents:AF,...(['E','F'].includes(stage)?{Q_scenario_cents:R+C+P+AF}:{})});return v;};
  await observe('A','2026-10-21',A);
  await sql(container,`insert into execution_service_contracts(id,company_id,project_id,status,current_value) values('${contract}','${ids.a}','${s.project}','active',${i.firm_contract_cents/100})`);
  const bRows=[{...aRows[0],category:'C',source_kind:'contract',source_id:contract},aRows[1]],B=await save(s,bRows,A,'coverage');await observe('B','2026-10-21',B);
  s.title=await title(s,i.recognized_title_principal_cents/100);
  await user(`select link_cash_coverage('${ids.a}','${s.entity}','${s.project}','covered','${B}','AP','${s.title}','${uuid()}','Título cobre exatamente o contrato CT18','Cobertura monetária CT18 documentada')`);
  await observe('C','2026-10-21',B);
  const pay=await settle(s,s.title,i.principal_payment_cents/100,'2026-10-21');await statement(s,[{fit_id:'CT18-P1',transaction_date:'2026-10-21',amount:-i.principal_payment_cents/100,description:'Pagamento CT18 referência fixa'}],[pay]);
  await observe('D','2026-10-21',B);
  const eRows=[...bRows,{scope_key:'interest',category:'AF',amount_cents:i.future_interest_adjustment_cents,expected_date:i.future_interest_expected_date,title_type:'AP',title_id:s.title,source_kind:'title',source_id:s.title}];
  await assert.rejects(()=>save(s,eRows.map(r=>r.scope_key==='uncovered'?{...r,amount_cents:4000001}:r),B,'adjustment'),/preserva valores/);
  const E=await save(s,eRows,B,'adjustment');const before=await observe('E','2026-10-21',E);
  const forecast=(await rows('finance_cash_scenario_rows',`scenario_id='${E}' and category='AF'`))[0],command=uuid();
  const call=(cmd=command,actor=ids.ug,amount=2000,titleId=s.title)=>user(`select realize_cash_adjustment('${ids.a}','${forecast.id}','AP','${titleId}','${cmd}',${amount},'${i.stage_F_cutoff}','Encargo contratual documentado CT18','Constituição integral do AF CT18')`,actor);
  await assert.rejects(()=>call(uuid(),ids.ur));await assert.rejects(()=>call(uuid(),ids.ub));await assert.rejects(()=>call(uuid(),ids.ug,1999));
  const pair=await Promise.all([call(),call()]);assert.equal(pair[0],pair[1]);await assert.rejects(()=>call(uuid()));
  const after=await observe('F',i.stage_F_cutoff,E);views.CT18=after;
  states.CT18={states:observed};assert.deepEqual(states.CT18,f('CT18').expected);
  assert.equal(after.future.rows.filter(r=>r.category==='AF').length,0);
  assert.equal(before.projection.horizon_30.outgoing_cents,1700000); // 15.000 R +2.000 AF at E
  const frozen=(await rows('finance_cash_scenarios',`id='${E}'`))[0].source_snapshot;assert.equal(frozen.adjustment_realizations.length,0);
  const descendant=await save(s,eRows,E,'reschedule',i.stage_F_cutoff);const next=await view(s,i.stage_F_cutoff,descendant);assert.equal(next.future.rows.filter(r=>r.category==='AF').length,0);
  const newAF=(await rows('finance_cash_scenario_rows',`scenario_id='${descendant}' and category='AF'`))[0];await assert.rejects(()=>user(`select realize_cash_adjustment('${ids.a}','${newAF.id}','AP','${s.title}','${uuid()}',2000,'2026-11-20','Mesma previsão em outra versão','Tentativa duplicada de encargo CT18')`));
  const realization=(await rows('finance_cash_adjustment_realizations',`project_id='${s.project}'`))[0];assert.equal((await rows('finance_title_charges',`project_id='${s.project}'`)).length,1);assert.ok(realization.created_by&&realization.reason&&realization.evidence);
  await assert.rejects(()=>sql(container,`update finance_cash_adjustment_realizations set amount_cents=1 where id='${realization.id}'`),/imutável/);
  assert.equal((await rows('finance_cash_adjustment_realizations',`project_id='${s.project}'`,ids.ub)).length,0);
  const foreign=await title({project:ids.pa2,tag:'Outra entidade'},10000);await assert.rejects(()=>call(uuid(),ids.ug,2000,foreign));
  const otherWork=uuid();await sql(container,`insert into projects(id,company_id,legal_entity_id,name,created_by) values('${otherWork}','${ids.a}','${s.entity}','Outra obra da mesma entidade','${ids.ug}')`);
  const otherTitle=await title({project:otherWork,tag:'Outra obra'},10000);await assert.rejects(()=>call(uuid(),ids.ug,2000,otherTitle),/mesma entidade, obra/);
  await capture(s);records.CT18.before_realization_view=before;records.CT18.descendant_view=next;return {actual:states.CT18,one_charge:true,concurrent_replay_same_result:true,immutable_original:true};
 });
 await check('CT29_agenda_persistida_restricao_e_amortizacao_uma_vez',async()=>{
  const i=f('CT29').inputs,s=await scope('CT29',i.bank_opening_cents/100,i.restricted_cents/100);s.entityView=true;
  s.title=await title(s,i.principal_amortization_already_in_month2_cents/100,'2026-12-20');
  const financing=uuid();await sql(container,`create table validation.financing_contract(id uuid primary key,company_id uuid,legal_entity_id uuid,project_id uuid,unused_credit_limit_cents bigint,amortization_cents bigint,evidence text,approved_by uuid);
  insert into validation.financing_contract values('${financing}','${ids.a}','${s.entity}','${s.project}',${i.unused_credit_limit_cents},${i.principal_amortization_already_in_month2_cents},'Cronograma fictício CT29 independente','${ids.ug}')`);
  const agenda=[{scope_key:'in1',category:'AR_FUTURE',amount_cents:i.monthly_inflows_cents[0],expected_date:'2026-11-01',source_kind:'documented_estimate'},
   {scope_key:'out1',category:'P',amount_cents:i.monthly_outflows_cents[0],expected_date:'2026-11-20',source_kind:'documented_estimate'},
   {scope_key:'in2',category:'AR_FUTURE',amount_cents:i.monthly_inflows_cents[1],expected_date:'2026-12-01',source_kind:'documented_estimate'},
   {scope_key:'out2',category:'P',amount_cents:i.monthly_outflows_cents[1]-i.principal_amortization_already_in_month2_cents,expected_date:'2026-12-20',source_kind:'documented_estimate'},
   {scope_key:'amortization',category:'FINANCING_OUT',amount_cents:i.principal_amortization_already_in_month2_cents,expected_date:'2026-12-20',source_kind:'financing',source_id:financing}];
  const version=await save(s,agenda,null,'reschedule','2026-10-21',i.minimum_cash_cents/100);
  await user(`select link_cash_coverage('${ids.a}','${s.entity}','${s.project}','amortization','${version}','AP','${s.title}','${uuid()}','Título representa amortização CT29','Evitar repetir amortização já na agenda')`);
  const actual=await view(s,'2026-10-21',version);views.CT29=actual;const months=actual.projection.months.filter(m=>['2026-11','2026-12'].includes(m.month));
  states.CT29={available_opening_cents:actual.projection.available_opening_cents,closing_month1_cents:months[0].closing_cents,closing_month2_cents:months[1].closing_cents,peak_additional_funding_cents:actual.projection.peak_additional_funding_cents,additional_amortization_duplicate_cents:actual.future.rows.filter(r=>r.category==='FINANCING_OUT').reduce((n,r)=>n+r.amount_cents,0),unused_limit_in_available_cash_cents:actual.projection.unused_credit_limit_in_cash_cents};assert.deepEqual(states.CT29,f('CT29').expected);
  assert.equal(months[0].outgoing_cents,12000000);assert.equal(months[1].outgoing_cents,15000000);
  const restricted=await loadCashflow({supabase:sqlClient(container,ids.ua),companyId:ids.a,projectId:null,entityId:s.entity,cutoff:'2026-10-21',from:'2026-10-01'}).then(()=>false,()=>true);assert.equal(restricted,true);
  await capture(s);records.CT29.financing_contract=await rows('validation.financing_contract');return states.CT29;
 });
}finally{
 await exec('docker',['rm','-f',container]);
 const context={implementation_version:'Candidata Etapa12 sobre65fe2cc; hashes dos arquivos no manifesto da entrega',executed_at:new Date().toISOString(),fixture_sha256:crypto.createHash('sha256').update(fs.readFileSync('tests/financeiro/fixtures/casos_financeiros.json')).digest('hex'),environment:'PostgreSQL17 descartável, network=none, sem portas; papéis SQL/RLS; loaders reais via adaptador SQL, não Auth/PostgREST/browser',expected_origin:'Fixture aprovada, não calculada pelo Elos; aceite econômico adicional CT03 explicitamente fictício10.000',clock_control:'Default recorded_at de finance_title_audit no scaffold; nenhum evento imutável reescrito. Relógio local do renderer para o corte fictício20/11, sem alterar o relógio da aplicação'};
 fs.writeFileSync(root+'/banco.json',JSON.stringify({execution_context:context,results,states,container_removed:true,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length},null,2)+'\n');
 fs.writeFileSync(root+'/registros.json',JSON.stringify(records,null,2)+'\n');fs.writeFileSync(root+'/views.json',JSON.stringify(views,null,2)+'\n');
 fs.writeFileSync(root+'/casos-obtidos.json',JSON.stringify({execution_context:context,cases:Object.entries(states).map(([id,actual])=>({id,status:'executado',actual,evidence:['banco.json','registros.json','views.json']}))},null,2)+'\n');
 console.log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).map(r=>({name:r.name,error:r.error}))},null,2));
 if(results.some(r=>!r.pass))process.exitCode=1;
}
