import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';import {createElement} from 'react';import * as jsx from 'react/jsx-runtime';
import {compile} from '../financeiro/runtime.mjs';import * as core from '../../lib/finance-core/cashflow.mjs';import * as position from '../../lib/finance-core/ledger-position.mjs';import * as titles from '../../lib/finance-core/titles.mjs';import * as coverage from '../../lib/finance-core/coverage.mjs';
import * as due from '../../lib/finance-core/due.mjs';
const root=process.env.FINANCE8_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa8-fluxo/evidencias';
const evidence=JSON.parse(fs.readFileSync(root+'/banco.json'));
const result=evidence.results.find(r=>r.name.startsWith('CT17_')&&r.pass);assert.ok(result,'Execute a fixture PostgreSQL antes deste teste');
const versions=result.evidence.source_snapshot_versions;
const latest=[...versions].sort((a,b)=>b.created_at.localeCompare(a.created_at))[0],snap=latest.source_snapshot,company=latest.company_id,entity=latest.legal_entity_id;
const tables={finance_bank_accounts:snap.accounts,finance_bank_transactions:snap.movements,finance_reconciliation_links:snap.links,finance_statement_entries:snap.entries,finance_bank_transfers:snap.transfers,finance_cash_openings:snap.openings,payables:structuredClone(snap.payables),receivables:structuredClone(snap.receivables),finance_cash_scenarios:versions,finance_cash_scenario_rows:versions.flatMap(v=>v.request.rows.map((r,i)=>({...r,id:v.id+':'+i,scenario_id:v.id,company_id:company,project_id:v.project_id}))),finance_cash_coverage_links:snap.coverage,finance_title_audit:snap.audits,finance_settlement_events:snap.events,finance_settlement_lines:snap.lines,finance_title_charges:snap.charges,finance_settlement_cash_rows:snap.cash,projects:[...new Map([...snap.payables,...snap.receivables].map(t=>[t.project_id,{id:t.project_id,company_id:company,legal_entity_id:entity}])).values()],legal_entities:[{id:entity,company_id:company,legal_name:'Entidade fictícia CT17'}],execution_service_contracts:snap.contracts,engineering_schedule_baselines:[],engineering_schedule_activities:[],finance_manual_invoices:[],finance_manual_invoice_installments:[],execution_contract_measurements:[]};
const client={rpc:async name=>({data:name==='list_unassigned_obligations'?[]:true,error:null}),from:table=>new class{
 constructor(){this.rows=[...(tables[table]??[])];}select(){return this;}eq(k,v){this.rows=this.rows.filter(x=>x[k]===v);return this;}order(){return this;}range(a,b){return Promise.resolve({data:this.rows.slice(a,b+1),error:null});}
 }()};
const {loadCashflow}=compile('lib/finance-core/cashflow-server.ts',{'@/lib/supabase-pagination':compile('lib/supabase-pagination.ts'),'./titles.mjs':titles,'./cashflow.mjs':core,'./ledger-position.mjs':position,'./due.mjs':due,'./coverage.mjs':coverage});
let view;
test('carregador real produz os mesmos valores da fixture de banco; original usa fontes congeladas',async()=>{
 view=await loadCashflow({supabase:client,companyId:company,projectId:null,entityId:entity,cutoff:'2026-10-21',from:'2026-10-01'});
 assert.deepEqual(view.projection.months.map(m=>m.closing_cents),[8000000,-1000000,4000000]);assert.deepEqual(view.baseline.months.map(m=>m.closing_cents),[13000000,8000000,4000000]);assert.equal(view.projection.peak_additional_funding_cents,3000000);
 assert.equal(view.projection.complete,false,'Título legado informado não se torna certificado só por produzir valores');
});
test('tela real apresenta origem da previsão, comparação original e insuficiência',async()=>{
 if(!view)view=await loadCashflow({supabase:client,companyId:company,projectId:null,entityId:entity,cutoff:'2026-10-21',from:'2026-10-01'});
 const deps={'react/jsx-runtime':jsx,'next/link':p=>createElement('a',{href:p.href},p.children),'@/components/app-shell':{AppShell:p=>createElement('main',null,p.children)},'@/lib/workspace':{requireCompanyPermission:async()=>({supabase:client,company:{name:'Fictícia'},companyId:company,projectId:null})},'@/lib/finance-core/cashflow-server':{loadCashflow:async()=>view},'@/lib/finance-core/cashflow.mjs':core,'./actions':{}};
 const code=ts.transpileModule(fs.readFileSync('app/financeiro/fluxo-de-caixa/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;const m={exports:{}};new Function('require','module','exports',code)(n=>{if(!(n in deps))throw Error(n);return deps[n]},m,m.exports);
 const html=renderToStaticMarkup(await m.exports.default({searchParams:Promise.resolve({cutoff:'2026-10-21',entity})}));assert.match(html,/Saldo original preservado/);assert.match(html,/Insuficiência de caixa/);assert.match(html,/90\.000,00/);assert.match(html,/30\.000,00/);assert.match(html,/Receita comercial estimada/);
 fs.writeFileSync(root+'/tela-exemplo.html',html);
});
test('obra compartilha conta, preserva movimentos e não herda abertura de cem mil como saldo próprio',async()=>{
 const project=snap.payables[0].project_id;const work=await loadCashflow({supabase:client,companyId:company,projectId:project,entityId:entity,cutoff:'2026-10-21',from:'2026-10-01'});assert.equal(work.projection.available_opening_cents,null);assert.ok(work.warnings.some(x=>x.includes('compartilhada')));assert.equal(work.history.accounts.length,1);
});
test('consolidado inclui planos de ambas as entidades e não compensa a insuficiência de um titular',async()=>{
 const changed=['finance_bank_accounts','finance_cash_openings','finance_cash_scenarios','finance_cash_scenario_rows','legal_entities'];const original=Object.fromEntries(changed.map(k=>[k,tables[k]]));
 const entityB='ENTITY-B-FICTITIOUS',bank={...snap.accounts[0],id:'BANK-B-FICTITIOUS',legal_entity_id:entityB,opening_balance:0},proof={...snap.openings[0],id:'PROOF-B-FICTITIOUS',bank_account_id:bank.id,opening_amount:0,restricted_amount:0};
 const version={...latest,id:'VERSION-B-FICTITIOUS',legal_entity_id:entityB,parent_id:null,minimum_cash:0,source_snapshot:{accounts:[bank],openings:[proof],movements:[],links:[],entries:[],transfers:[],payables:[],receivables:[],coverage:[]}};
 const row={id:'ROW-B-FICTITIOUS',company_id:company,scenario_id:version.id,project_id:null,scope_key:'P1',category:'P',source_kind:'documented_estimate',amount_cents:2000000,expected_date:'2026-11-20'};
 try{
  tables.finance_bank_accounts=[...original.finance_bank_accounts,bank];tables.finance_cash_openings=[...original.finance_cash_openings,proof];tables.finance_cash_scenarios=[...original.finance_cash_scenarios,version];tables.finance_cash_scenario_rows=[...original.finance_cash_scenario_rows,row];tables.legal_entities=[...original.legal_entities,{id:entityB,company_id:company,legal_name:'Entidade B fictícia'}];
  const group=await loadCashflow({supabase:client,companyId:company,projectId:null,cutoff:'2026-10-21',from:'2026-10-01',consolidate:true});
  assert.equal(group.entityProjections.length,2);assert.equal(group.projection.closing_cents,2000000);assert.equal(group.projection.peak_additional_funding_cents,null);assert.equal(group.entityProjections.find(e=>e.entity_id===entityB).projection.peak_additional_funding_cents,2000000);assert.ok(group.warnings.some(w=>w.includes('não compensar')));
 }finally{for(const k of changed)tables[k]=original[k];}
});
