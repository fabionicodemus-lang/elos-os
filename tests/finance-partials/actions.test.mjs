import test from 'node:test';import assert from 'node:assert/strict';
import {compile} from '../financeiro/runtime.mjs';import {toCents} from '../../lib/finance-core/cashflow.mjs';
function context({project='work',parentProject='work',foreign=false}={}){
 const data={finance_cash_scenarios:[{id:'parent',company_id:'company',legal_entity_id:'entity',project_id:parentProject,cutoff:'2026-10-21',completion_date:'2026-12-31',minimum_cash:0,baseline_id:null}],finance_cash_scenario_rows:[{id:'forecast',company_id:'company',project_id:parentProject,scenario_id:'parent',scope_key:'base',category:'P',amount_cents:4000000,expected_date:'2026-12-20',title_id:null,title_type:null,source_kind:'documented_estimate',source_id:null}]};
 const calls=[],events=[];
 const client={from:table=>new class{constructor(){this.rows=foreign?[]:data[table]??[];}select(){return this;}eq(k,v){this.rows=this.rows.filter(r=>r[k]===v);return this;}order(){return this;}maybeSingle(){return Promise.resolve({data:this.rows[0]??null,error:null});}then(resolve){return Promise.resolve({data:this.rows,error:null}).then(resolve);}}(),rpc:async(name,args)=>{calls.push({name,args});return {data:'new-version',error:null};}};
 const actions=compile('app/financeiro/fluxo-de-caixa/actions.ts',{'next/navigation':{redirect:url=>{throw Error('REDIRECT '+url);}},'@/lib/workspace':{requireCompanyPermission:async permission=>{assert.equal(permission,'cashflow.manage');return {supabase:client,companyId:'company',projectId:project};}},'@/lib/finance-core/revalidate':{revalidateFinancialViews:()=>events.push('revalidated')},'@/lib/finance-core/cashflow.mjs':{toCents}});
 return {data,calls,events,actions};
}
const form=values=>{const f=new FormData();for(const [k,v] of Object.entries(values))f.set(k,v);return f;};
const input={parent_id:'parent',command_id:'stable-command',title_id:'title',amount:'2.000,00',expected_date:'2026-11-20',evidence:'Cláusula fictícia de juros2mil',reason:'Nova previsão documentada'};
test('CT18 ação cria somente AF em nova versão, origem e empresa vêm do servidor',async()=>{
 const c=context(),f=form({...input,company_id:'forjada',entity_id:'forjada'});
 await assert.rejects(()=>c.actions.appendCashAdjustment(f),/success=Ajuste/);
 const a=c.calls[0].args;assert.equal(c.calls[0].name,'save_cash_scenario');assert.equal(a.p_company,'company');assert.equal(a.p_entity,'entity');assert.equal(a.p_project,'work');assert.equal(a.p_parent,'parent');assert.equal(a.p_change_kind,'adjustment');assert.equal(a.p_rows[0].amount_cents,4000000);assert.equal(a.p_rows[1].amount_cents,200000);assert.equal(a.p_rows[1].title_id,'title');assert.equal(a.p_rows[1].category,'AF');assert.equal(c.events.length,1);
 await assert.rejects(()=>c.actions.appendCashAdjustment(f),/success=Ajuste/);assert.deepEqual(c.calls[0],c.calls[1],'Replay conserva comando e payload; idempotência da RPC é testada no banco');
});
test('CT18 ação constitui o valor persistido do AF, sem aceitar valor forjado pelo cliente',async()=>{
 const c=context();Object.assign(c.data.finance_cash_scenario_rows[0],{category:'AF',title_id:'title',title_type:'AP',amount_cents:200000});
 await assert.rejects(()=>c.actions.realizeCashAdjustment(form({forecast_id:'forecast',command_id:'settlement-command',amount:'999999',effective_date:'2026-11-20',evidence:'Encargo contratual comprovado',reason:'Constituição documentada'})),/success=Encargo/);
 assert.equal(c.calls[0].name,'realize_cash_adjustment');assert.equal(c.calls[0].args.p_amount,'2000.00');assert.equal(c.calls[0].args.p_title,'title');assert.equal(c.calls[0].args.p_company,'company');
});
test('CT18 ação preserva o limite inteiro de centavos sem ida e volta por ponto flutuante',async()=>{
 const c=context();await assert.rejects(()=>c.actions.appendCashAdjustment(form({...input,amount:'90.071.992.547.409,91'})),/success=Ajuste/);
 assert.equal(c.calls[0].args.p_rows[1].amount_cents,9007199254740991);
 Object.assign(c.data.finance_cash_scenario_rows[0],{category:'AF',title_id:'title',title_type:'AP',amount_cents:9007199254740991});
 await assert.rejects(()=>c.actions.realizeCashAdjustment(form({forecast_id:'forecast',command_id:'large-cents',effective_date:'2026-11-20',evidence:'Documento fictício de limite',reason:'Teste de precisão no transporte'})),/success=Encargo/);
 assert.equal(c.calls[1].args.p_amount,'90071992547409.91');
});
test('CT18 ações negam versão de outra obra, linha invisível e valor ausente',async()=>{
 const c=context({parentProject:'other-work'});await assert.rejects(()=>c.actions.appendCashAdjustment(form(input)),/fora\+do\+escopo/);assert.equal(c.calls.length,0);
 const invisible=context({foreign:true});await assert.rejects(()=>invisible.actions.realizeCashAdjustment(form({forecast_id:'forecast'})),/fora\+do\+escopo/);assert.equal(invisible.calls.length,0);
 const missing=context();await assert.rejects(()=>missing.actions.appendCashAdjustment(form({...input,amount:''})),/inválido/);assert.equal(missing.calls.length,0);
});
