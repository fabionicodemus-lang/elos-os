import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import * as jsx from 'react/jsx-runtime';
import * as titles from '../../lib/finance-core/titles.mjs';
import {compile} from '../financeiro/runtime.mjs';
const evidence=JSON.parse(fs.readFileSync((process.env.FINANCE7_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa7-calculos/evidencias')+'/liquidacoes.json'));
const row=evidence.results.find(x=>x.name==='exemplo_100000_30000_70000'&&x.pass)?.evidence.partial;
test('tela AP real apresenta parcialmente pago, saldo 70 mil e novo principal de 70 mil',async()=>{
 assert.ok(row,'Execute o teste PostgreSQL antes do teste de apresentação');
 const data={payables:[row],suppliers:[],finance_bank_accounts:[{id:'bank',label:'Conta fictícia'}],finance_settlement_lines:[]};
 class Query{
  constructor(table){this.rows=data[table]??[];}
  select(){return this;}eq(){return this;}order(){return this;}range(){return this;}limit(){return this;}in(){return this;}or(){return this;}gte(){return this;}lte(){return this;}
  then(resolve){return Promise.resolve({data:this.rows,error:null,count:this.rows.length}).then(resolve);}
 }
 const client={from:t=>new Query(t),rpc:async name=>({data:name==='has_company_permission'?true:{...titles.sumTitlePositions([row]),total_count:1,open_count:1,paid_count:0,cancelled_count:0,total_amount:row.amount,open_amount:titles.openTitleAmount(row),paid_amount:titles.paidTitleCash(row)},error:null})};
 const dependencies={
  'react/jsx-runtime':jsx,'next/link':p=>createElement('a',{href:p.href},p.children),
  '@/lib/finance-core/titles.mjs':titles,'@/components/app-shell':{AppShell:p=>createElement('main',null,p.children)},
  '@/components/date-range-filter':{DateRangeFilter:()=>null},'./payable-create-form':{PayableCreateForm:()=>null},
  './actions':{markPayablePaid:async()=>{},cancelPayable:async()=>{},reversePayableSettlement:async()=>{}},
  '@/lib/date-range':{resolveDateRange:()=>({from:null,to:null})},
  '@/lib/supabase-pagination':compile('lib/supabase-pagination.ts'),
  '@/lib/workspace':{requireCompanyPermission:async()=>({supabase:client,companyId:row.company_id,company:{name:'Fictícia'},projectId:null,roleKey:'finance'})},
 };
 const code=ts.transpileModule(fs.readFileSync('app/financeiro/contas-a-pagar/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(name=>{if(!(name in dependencies))throw Error(name);return dependencies[name];},m,m.exports);
 const html=renderToStaticMarkup(await m.exports.default({searchParams:Promise.resolve({})}));
 assert.match(html,/Parcialmente pago/);assert.match(html,/Saldo:.*70\.000,00/);assert.match(html,/name="paid_amount"[^>]*value="70000.00"/);assert.match(html,/name="bank_account_id"/);
});
