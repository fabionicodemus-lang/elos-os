import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import * as fields from './feasibility-import.mjs';import * as utils from './action-utils.mjs';
const source=readFileSync(new URL('./feasibility-action-tool.ts',import.meta.url),'utf8');
const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>name==='./feasibility-import.mjs'?fields:utils,Error});
test('preparation routes extracted data into a proposal, never an approved study or operating data',async()=>{
 const touched=[];let inserted;const context={companyId:'company',activeProjectId:'project',projects:[{id:'project',name:'Paradise teste',code:'TEST'}],turnId:'turn',persona:'diretoria',userId:'user',attachmentNames:['Viabilidade teste.pdf'],supabase:{from:table=>{touched.push(table);let q;q=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:[],error:null}).then(resolve):key==='insert'?row=>{inserted=row;return q}:key==='single'?async()=>({data:{id:'proposal'},error:null}):()=>q});return q;},rpc:async()=>({error:null})}};
 const result=await exports.prepareFeasibility(context,{study:{name:'Estudo antigo'},reported:{reference_date:'2023-07-03',vgv:10000000},observations:[{label:'Custos',value:'ilegível',source:'página 2'}]});
 assert.equal(result.acao_preparada,true);assert.equal(result.pagina_revisao,'/elos-ia/acoes/proposal/viabilidade');assert.ok(touched.every(x=>x==='ai_action_proposals'));assert.equal(inserted.payload.study.tax_rate_pct,null);assert.equal(inserted.project_id,'project');assert.equal(inserted.preview.sourceFile,'Viabilidade teste.pdf');assert.equal(inserted.action_type,'commercial_feasibility_import');
 await assert.rejects(exports.prepareFeasibility(context,{obra:'Outra empresa'}),/Selecione/);await assert.rejects(exports.prepareFeasibility(context,{arquivo_origem:'outro.pdf'}),/não pertence/);
});
test('extraction schema explicitly supports absent fields and historical reported totals',()=>{
 const p=exports.feasibilityActionProperties;
 assert.equal(p.study.additionalProperties,false);assert.ok(p.study.required.includes('tax_rate_pct'));assert.ok(p.study.properties.tax_rate_pct.type.includes('null'));assert.ok(p.reported.properties.reference_date);assert.ok(p.unit_types.items.properties.source);
});
