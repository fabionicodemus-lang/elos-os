import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import {compile} from '../financeiro/runtime.mjs';
import * as core from '../../lib/finance-core/cashflow.mjs';
const root=process.env.FINANCE13_EVIDENCE_DIR??'docs/financeiro/implementacao-v1/etapa13-segundo-grupo/evidencias';
const views=JSON.parse(fs.readFileSync(root+'/views.json')),records=JSON.parse(fs.readFileSync(root+'/registros.json'));
function compiled(file,deps){const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,m={exports:{}};
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-10-21T15:00:00-03:00']));}}
 new Function('require','module','exports','Date',source)(name=>{if(!(name in deps))throw Error(name);return deps[name]},m,m.exports,Clock);return m.exports;
}
async function channel(id){
 const v=views[id],s=records[id].scope;
 const load=async args=>{assert.equal(args.companyId,s.company);assert.equal(args.entityId,s.entity);assert.equal(args.cutoff,'2026-10-21');assert.equal(args.projectId,null);return v;};
 const workspace={requireCompanyPermission:async permission=>{assert.equal(permission,'cashflow.view');return {supabase:{rpc:async()=>({data:false,error:null})},companyId:s.company,company:{name:'Fictícia'},projectId:null};}};
 const route=compiled('app/api/financeiro/fluxo-de-caixa/route.ts',{'@/lib/workspace':workspace,'@/lib/finance-core/cashflow-server':{loadCashflow:load},'@/lib/finance-core/cashflow.mjs':core});
 const response=await route.GET(new Request('http://isolated.invalid/api/financeiro/fluxo-de-caixa?cutoff=2026-10-21&entity='+s.entity));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const exported=await response.json();
 assert.deepEqual(exported.indicators,v.financialCoverage);assert.equal(exported.sources.known_at,null);assert.equal(exported.sources.historical_knowledge_supported,false);
 const source=ts.transpileModule(fs.readFileSync('lib/elos-ia/tools.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const deps=Object.fromEntries([...source.matchAll(/require\("([^"]+)"\)/g)].map(m=>[m[1],{}]));deps['@/lib/finance-core/cashflow-server']={loadCashflow:load};
 const tools=compile('lib/elos-ia/tools.ts',deps),context={supabase:{},companyId:s.company,activeProjectId:null,projects:[],today:'2026-10-21',can:()=>true,cache:new Map()};
 const ia=await tools.runElosIaTool(context,['fluxo_de_caixa'],'fluxo_de_caixa',{obra:'todas',entidade_id:s.entity});
 assert.equal(ia.erro,undefined);assert.deepEqual(ia.indicadores_financeiros,v.financialCoverage);assert.deepEqual(ia.fontes_financeiras,exported.sources);
 const page=compiled('app/financeiro/fluxo-de-caixa/page.tsx',{'react/jsx-runtime':jsx,'next/link':p=>createElement('a',{href:p.href},p.children),'@/components/app-shell':{AppShell:p=>createElement('main',null,p.children)},'@/lib/workspace':workspace,'@/lib/finance-core/cashflow-server':{loadCashflow:load},'@/lib/finance-core/cashflow.mjs':core,'./actions':{}});
 const html=renderToStaticMarkup(await page.default({searchParams:Promise.resolve({cutoff:'2026-10-21',entity:s.entity})}));
 fs.writeFileSync(root+'/tela-'+id+'.html',html);fs.writeFileSync(root+'/exportacao-'+id+'.json',JSON.stringify(exported,null,2)+'\n');fs.writeFileSync(root+'/ia-'+id+'.json',JSON.stringify(ia,null,2)+'\n');
 return {ia,exported,html,route,context,tools};
}
test('CT21: dashboard, exportação e IA conservam140mil e840mil separados; Q/EAC/cobertura null',async()=>{
 const {ia,exported,html}=await channel('CT21');
 assert.match(html,/140\.000,00/);assert.match(html,/840\.000,00/);assert.match(html,/Não validado/);assert.match(html,/incompleto/);
 assert.equal(exported.indicators.Q_cents,null);assert.equal(exported.indicators.EAC_cents,null);assert.equal(ia.indicadores_financeiros.external_coverage_percent,null);
 assert.match(exported.warnings.join(' '),/Vínculo contrato–título ausente/);
});
test('CT24: canais reais não incluem contrato/obra/empresa estrangeiros na posição de UA',async()=>{
 const {ia,exported,html,context,tools}=await channel('CT24');
 const r=records.CT24,serialized=JSON.stringify({ia,exported})+html;
 const forbidden=[r.a2,r.b,r.ga2.selectedEntity,r.gb.selectedEntity,...r.ga2.contracts.map(c=>c.id),...r.gb.contracts.map(c=>c.id)];
 const foreignOccurrences=forbidden.filter(id=>serialized.includes(id)).length;
 for(const id of forbidden)assert.ok(!serialized.includes(id),'Dado de outro perímetro: '+id);
 const denied=await tools.runElosIaTool({...context,can:()=>false},['fluxo_de_caixa'],'fluxo_de_caixa',{});assert.match(denied.erro,/não tem permissão/);
 const obtained=JSON.parse(fs.readFileSync(root+'/casos-obtidos.json'));obtained.cases.find(c=>c.id==='CT24').actual.foreign_data_occurrences_in_UA_exports_or_AI=foreignOccurrences;
 fs.writeFileSync(root+'/casos-obtidos.json',JSON.stringify(obtained,null,2)+'\n');
});
test('Exportação rejeita K não suportado e período inválido; falha de autorização não vira zero',async()=>{
 const deps={'@/lib/workspace':{requireCompanyPermission:async()=>({supabase:{},companyId:'A',projectId:null})},'@/lib/finance-core/cashflow.mjs':core,'@/lib/finance-core/cashflow-server':{loadCashflow:async()=>{throw Error('Sem autorização')}}};
 const route=compiled('app/api/financeiro/fluxo-de-caixa/route.ts',deps);
 for(const query of ['known_at=2026-10-20','cutoff=2026-99-01','cutoff=2026-10-01&from=2026-10-02'])assert.equal((await route.GET(new Request('http://isolated.invalid/?'+query))).status,400);
 await assert.rejects(()=>route.GET(new Request('http://isolated.invalid/?cutoff=2026-10-21')),/Sem autorização/);
});
