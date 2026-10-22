import fs from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';
import ts from 'typescript';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import * as jsx from 'react/jsx-runtime';
import {compile} from '../financeiro/runtime.mjs';
import * as core from '../../lib/finance-core/cashflow.mjs';
import * as position from '../../lib/finance-core/ledger-position.mjs';
import * as titles from '../../lib/finance-core/titles.mjs';
import * as coverage from '../../lib/finance-core/coverage.mjs';
import * as due from '../../lib/finance-core/due.mjs';
const root=process.env.FINANCE12_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa12-parciais/evidencias';
const views=JSON.parse(fs.readFileSync(root+'/views.json')),records=JSON.parse(fs.readFileSync(root+'/registros.json'));
function compiled(file,deps,clock=Date){const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,m={exports:{}};new Function('require','module','exports','Date',source)(name=>{if(!(name in deps))throw Error('Dependência não exercitada: '+name);return deps[name];},m,m.exports,clock);return m.exports;}
async function render(id,manage=false){const view=views[id],s=records[id].scope;
 const deps={'react/jsx-runtime':jsx,'next/link':p=>createElement('a',{href:p.href},p.children),'@/components/app-shell':{AppShell:p=>createElement('main',null,p.children)},'@/lib/workspace':{requireCompanyPermission:async()=>({supabase:{rpc:async()=>({data:manage,error:null})},companyId:s.company,projectId:s.entityView?null:s.project,company:{name:'Fictícia'}})},'@/lib/finance-core/cashflow-server':{loadCashflow:async args=>{assert.equal(args.companyId,s.company);assert.equal(args.entityId,s.entity);assert.equal(args.cutoff,view.projection.cutoff);return view;}},'@/lib/finance-core/cashflow.mjs':core,'./actions':{}};
 // Scoped renderer clock for the approved fictional F cutoff20/11; no global or app clock change.
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[view.projection.cutoff+'T15:00:00-03:00']));}}
 const page=compiled('app/financeiro/fluxo-de-caixa/page.tsx',deps,FixedDate);
 const html=renderToStaticMarkup(await page.default({searchParams:Promise.resolve({cutoff:view.projection.cutoff,entity:s.entity,version:view.scenario?.id})}));fs.writeFileSync(root+'/tela-'+id.toLowerCase()+'.html',html);return html;
}
test('CT29: tela real conserva abertura100mil, insuficiência30mil e necessidade50mil',async()=>{
 const html=await render('CT29');assert.match(html,/100\.000,00/);assert.match(html,/40\.000,00/);assert.match(html,/-R\$\s*30\.000,00/);assert.match(html,/50\.000,00/);assert.match(html,/Insuficiência de caixa/);
 assert.match(html,/Referência original parcial — cobertura não validada/);
 assert.match(html,/Parcial — não homologado documentalmente/,'Não transformar prova fictícia em aceite global');
});
test('CT18: tela real usa R17mil, previsão80mil e nunca adiciona AF constituído',async()=>{
 const html=await render('CT18',true);assert.match(html,/17\.000,00/);assert.match(html,/80\.000,00/);assert.match(html,/Acrescentar previsão de encargo/);assert.match(html,/Encargo constituído:/);assert.doesNotMatch(html,/Constituir encargo previsto/);assert.equal(views.CT18.future.rows.filter(r=>r.category==='AF').length,0);
 assert.equal(views.CT18.projection.months.reduce((n,m)=>n+m.outgoing_cents,0),9700000);
});
test('CT29/CT18: ferramenta real da IA recebe entidade e devolve a mesma projeção persistida',async()=>{
 for(const id of ['CT29','CT18']){
  const s=records[id].scope,view=views[id],file='lib/elos-ia/tools.ts';const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  // Unused tools are stubbed, never their financial output. The exercised tool and
  // dispatcher are the real module; captured views came from real loaders + PostgreSQL/RLS.
  const deps=Object.fromEntries([...source.matchAll(/require\("([^"]+)"\)/g)].map(m=>[m[1],{}]));
  deps['@/lib/finance-core/cashflow-server']={loadCashflow:async args=>{assert.equal(args.companyId,s.company);assert.equal(args.entityId,s.entity);assert.equal(args.projectId,s.entityView?null:s.project);assert.equal(args.cutoff,view.projection.cutoff);return view;}};
  const tools=compile(file,deps),context={companyId:s.company,supabase:{},activeProjectId:s.entityView?null:s.project,projects:[{id:s.project,name:id,code:id,status:'active',city:null}],today:view.projection.cutoff,can:()=>true,cache:new Map()};
  const actual=await tools.runElosIaTool(context,['fluxo_de_caixa'],'fluxo_de_caixa',{obra:s.entityView?'todas':id,entidade_id:s.entity});
  assert.equal(actual.erro,undefined);assert.equal(actual.entidade_id,s.entity);assert.deepEqual(actual.projecao,view.projection);assert.deepEqual(actual.projecoes_por_entidade,view.entityProjections);
  fs.writeFileSync(root+'/ia-'+id.toLowerCase()+'.json',JSON.stringify(actual,null,2)+'\n');
  const denied=await tools.runElosIaTool({...context,can:()=>false},['fluxo_de_caixa'],'fluxo_de_caixa',{});assert.match(denied.erro,/não tem permissão/);
 }
});
test('AF não é eliminado se o encargo vinculado não estiver na posição',()=>{
 const r=records.CT18,forecast=r.finance_cash_scenario_rows.find(x=>x.category==='AF'),link=r.finance_cash_adjustment_realizations[0];
 assert.throws(()=>core.futureCashRows({scenarioRows:[forecast],adjustmentRealizations:[link],cutoff:'2026-11-20'}),/Encargo constituído ausente/);
 const e=records.CT18.before_realization_view;assert.equal(e.future.rows.find(r=>r.category==='AF').amount_cents,200000);
});
test('corte K reconhece fusos equivalentes e não usa título futuro como fallback',()=>{
 const r=records.CT02,known=r.audits.find(a=>a.version===1).recorded_at;
 const at=K=>position.titlesAt({titles:r.titles,audits:r.audits,type:'AP',cutoff:'2026-10-19',knownAt:K});
 assert.equal(titles.titlePosition(at(known)[0]).openCents,1000000);assert.equal(titles.titlePosition(at('2026-10-19T18:00:00-03:00')[0]).openCents,1000000);
 assert.equal(at('2026-10-18T23:59:59-03:00').length,0);
});
test('carregador recusa entidade negada e obra incoerente, sem devolver zeros aparentes',async()=>{
 const r=records.CT29,s=r.scope;
 const tables=Object.fromEntries(Object.entries(r).filter(([,v])=>Array.isArray(v)));
 tables.projects=[{id:s.project,company_id:s.company,legal_entity_id:s.entity}];tables.legal_entities=[{id:s.entity,company_id:s.company}];
 const client={from:table=>new class{constructor(){this.rows=tables[table]??[];}select(){return this;}eq(k,v){this.rows=this.rows.filter(x=>x[k]===v);return this;}order(){return this;}range(a,b){return Promise.resolve({data:this.rows.slice(a,b+1),error:null});}}(),rpc:async name=>({data:name==='finance_entity_scope'?false:[],error:null})};
 const {loadCashflow}=compile('lib/finance-core/cashflow-server.ts',{'@/lib/supabase-pagination':compile('lib/supabase-pagination.ts'),'./titles.mjs':titles,'./cashflow.mjs':core,'./coverage.mjs':coverage,'./ledger-position.mjs':position,'./due.mjs':due});
 const args={supabase:client,companyId:s.company,projectId:null,entityId:s.entity,cutoff:'2026-10-21',from:'2026-10-01'};
 await assert.rejects(()=>loadCashflow(args),/sem autorização/);
 await assert.rejects(()=>loadCashflow({...args,projectId:'fora-do-escopo'}),/Obra incompatível/);
});
