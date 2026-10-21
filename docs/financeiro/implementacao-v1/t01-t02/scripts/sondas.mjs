// Sondas diagnósticas sobre código real com fontes simuladas e PostgreSQL em memória.
// Não é adaptador de homologação CT01–CT30 e não publica aprovação desses casos.
import fs from 'node:fs';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as engine from '../../../../../lib/forecast/engine.mjs';
import * as curves from '../../../../../app/engenharia/curvas/curve-calculations.mjs';

const results = [];
const record = (id, kind, expected, actual, scope) => {
  results.push({ id, kind, expected_observation_for_reproduction: expected, actual, scope,
    diagnostic_reproduced: JSON.stringify(expected) === JSON.stringify(actual) });
};
function compile(file, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name) => {
    if (!(name in dependencies)) throw new Error(`Dependência não autorizada: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

const pagination = compile('lib/supabase-pagination.ts');
const pages = [[{id:'P1',amount:100000},{id:'P2',amount:200000}],
  [{id:'P3',amount:300000},{id:'P4',amount:400000}], [{id:'P5',amount:500000}]];
const complete = await pagination.fetchAllRows(async from => ({data:pages[from/2]??[],error:null}), 2);
record('P01', 'capacidade', {count:5,total_cents:1500000,error:null}, {
  count:complete.data.length,total_cents:complete.data.reduce((s,r)=>s+r.amount,0),error:complete.error,
}, 'CT26 parcial: helper Supabase por offset, não extração Koper nem manifesto/cursor.');
const failed = await pagination.fetchAllRows(async from => from === 2
  ? {data:null,error:{message:'503 sintético'}} : {data:pages[0],error:null}, 2);
record('P02','capacidade',{count:2,total_cents:300000,error:'503 sintético'}, {
  count:failed.data.length,total_cents:failed.data.reduce((s,r)=>s+r.amount,0),error:failed.error?.message,
}, 'CT26 parcial: falha preserva subtotal e erro; consumidor deve propagar incompletude.');
const repeated = await pagination.fetchAllRows(async from => ({data:from<4?pages[0]:[],error:null}),2);
record('P03','lacuna',{rows:4,unique:2,error:null}, {
  rows:repeated.data.length,unique:new Set(repeated.data.map(r=>r.id)).size,error:repeated.error,
}, 'Helper aceita páginas com IDs repetidos. Não há afirmação de cursor Koper atual.');

const base={asOfDate:'2026-10-21',services:[{id:'s',name:'Teste',budgetAmount:1000}],
  activities:[],commitments:[],openPayables:[{id:'open',serviceId:'s',amount:200,dueDate:'2026-11-01'}]};
for (const [id, paidAt, expected] of [['P04','2000-01-01',{actual:100,committedPayable:0,toCommit:900}],
  ['P05','2027-01-01',{actual:100,committedPayable:200,toCommit:700}]]) {
  const out=engine.buildUnifiedForecast({...base,actualPayments:[{id:'paid',serviceId:'s',amount:100,paidAt}]}).totals;
  record(id,'lacuna',expected,{actual:out.actual,committedPayable:out.committedPayable,toCommit:out.toCommit},
    id==='P04'?'Data extrema provoca curto-circuito e não agrega títulos abertos.':'Data de corte não exclui pagamento posterior do realizado.');
}

const loaderSource = fs.readFileSync('lib/forecast/server.ts','utf8');
const snippet = loaderSource.slice(loaderSource.indexOf('function allocateByCostAllocations('),
  loaderSource.indexOf('function allocatePayable('));
const allocate = new Function('number', ts.transpile(snippet,{target:ts.ScriptTarget.ES2022})
  + ';return allocateByCostAllocations;')(x=>Number(x??0));
const allocation=allocate({id:'p'},1000,[{service_id:'s',allocation_amount:400},
  {service_id:null,allocation_amount:600}],new Set());
record('P06','lacuna',[{serviceId:'s',amount:1000}],allocation.map(({serviceId,amount})=>({serviceId,amount})),
  'Rateio misto 400 classificado + 600 pendente: esperado normativo é preservar 600 pendente; observado transfere tudo.');

const {loadProjectForecast} = compile('lib/forecast/server.ts',{
  '@/lib/supabase-pagination':pagination,
  '@/app/engenharia/curvas/curve-calculations.mjs':curves,'./engine.mjs':engine,
});
const scope={company_id:'c',project_id:'p'};
const data={projects:[{id:'p',company_id:'c',forecast_default_payment_days:30}],
  engineering_schedule_baselines:[{...scope,id:'b',budget_id:'budget',status:'approved'}],
  engineering_budgets:[{...scope,id:'budget'}],
  engineering_budget_items:[{...scope,id:'bi',budget_id:'budget',status:'active',service_id:'s',total_direct_cost:1000}],
  engineering_services:[{id:'s',company_id:'c',code:'01',description:'Sintético'}],
  execution_service_contracts:[{...scope,id:'ct',status:'active',end_date:'2026-12-31',payment_days:0}],
  execution_service_contract_items:[{...scope,id:'ci',contract_id:'ct',service_id:'s',total_value:1000}],
  payables:[{...scope,id:'paid',status:'paid',due_date:'2026-10-01',paid_at:'2026-10-01',amount:400,paid_amount:400,
    source_system:'elos_os',source_id:'manual_invoice:n:i'}],
  payable_cost_allocations:[{...scope,id:'a',payable_id:'paid',service_id:'s',allocation_amount:400}],
  finance_manual_invoices:[{...scope,id:'n',contract_id:'ct'}]};
class Query {
  constructor(table){this.rows=[...(data[table]??[])];}
  select(){return this;}order(){return this;}
  eq(k,v){this.rows=this.rows.filter(r=>r[k]===v);return this;}
  neq(k,v){this.rows=this.rows.filter(r=>r[k]!==v);return this;}
  in(k,v){this.rows=this.rows.filter(r=>v.includes(r[k]));return this;}
  lte(k,v){this.rows=this.rows.filter(r=>r[k]<=v);return this;}
  is(k,v){this.rows=this.rows.filter(r=>(r[k]??null)===v);return this;}
  range(a,b){return Promise.resolve({data:this.rows.slice(a,b+1),error:null});}
  maybeSingle(){return Promise.resolve({data:this.rows[0]??null,error:null});}
}
const forecast=await loadProjectForecast({supabase:{from:t=>new Query(t)},companyId:'c',projectId:'p',asOfDate:'2026-10-21'});
record('P07','lacuna',{actual:400,committedFuture:1000,projectedCost:1400,errors:[]},{
  actual:forecast.forecast?.totals.actual,committedFuture:forecast.forecast?.totals.committedFuture,
  projectedCost:forecast.forecast?.totals.projectedCost,errors:forecast.errors,
},'Contrato 1000; nota vinculada sem medição; título pago 400. Carregador real mantém contrato inteiro no futuro. Não é posição real.');

const {saveKoperStagingRecord}=compile('services/koper-worker/src/elos/koper-staging-repository.ts',{
  './supabase.js':{requestSupabase:()=>{throw new Error('Rede proibida nesta sonda');}},
});
const stored=[];
const request=async(_table,options)=>{
  if(!options.method)return stored.filter(r=>r.company_id===options.query.get('company_id')?.slice(3)
    &&r.source===options.query.get('source')?.slice(3)&&r.entity===options.query.get('entity')?.slice(3)
    &&r.koper_id===options.query.get('koper_id')?.slice(3));
  if(options.method==='POST'){const row={...options.body,id:String(stored.length+1)};stored.push(row);return [row];}
  if(options.method==='PATCH'){const row=stored.find(r=>r.id===options.query.get('id')?.slice(3));Object.assign(row,options.body);return [row];}
  throw new Error('Método não permitido');
};
const staging={company_id:'A',source:'koper',entity:'bill',koper_id:'77',payload_hash:'a'.repeat(64),last_seen_at:'2026-10-21'};
const actions=[];for(let n=0;n<3;n++)actions.push((await saveKoperStagingRecord(staging,request)).action);
await saveKoperStagingRecord({...staging,company_id:'B'},request);
record('P08','capacidade',{actions:['inserted','unchanged','unchanged'],rows:2,companies:['A','B']},
  {actions,rows:stored.length,companies:stored.map(r=>r.company_id)},
  'CT01/CT24 apenas identidade da staging com requester simulado; não valida promoção de títulos, RLS, banco ou papéis.');

const db=new PGlite();
try {
  await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function has_company_permission(uuid,text) returns boolean language sql as $$select true$$;
    create table receivables(id uuid,company_id uuid,project_id uuid,client_id uuid,status text,amount numeric,adjusted_amount numeric,due_date date,description text,sequence_number int,sequence_total int,paid_at date,paid_amount numeric,paid_account_name text,bank_account_id uuid,bank_transaction_id uuid,correction_locked boolean,updated_at timestamptz);
    create table finance_bank_accounts(id uuid,company_id uuid,status text,legal_entity_id uuid,label text);
    create table projects(id uuid,company_id uuid,legal_entity_id uuid);
    create table clients(id uuid,name text);
    create table finance_bank_transactions(id uuid default gen_random_uuid(),company_id uuid,project_id uuid,legal_entity_id uuid,bank_account_id uuid,transaction_date date,competence_date date,direction text,transaction_type text,description text,document text,counterparty text,amount numeric,status text,receivable_id uuid,source_system text,source_id text,created_by uuid);`);
  const source=fs.readFileSync('supabase/migrations/20260729_0048_finance_bank_accounts.sql','utf8');
  const start=source.indexOf('create or replace function public.receive_finance_receivable(');
  await db.exec(source.slice(start,source.indexOf('end; $$;',start)+9));
  const company='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',
    title='33333333-3333-4333-8333-333333333333',account='44444444-4444-4444-8444-444444444444';
  await db.query('insert into projects(id,company_id) values($1,$2)',[project,company]);
  await db.query("insert into finance_bank_accounts(id,company_id,status,label) values($1,$2,'active','Sintética')",[account,company]);
  await db.query("insert into receivables(id,company_id,project_id,status,amount,adjusted_amount,due_date) values($1,$2,$3,'open',1000,1000,'2026-10-21')",[title,company,project]);
  await db.query("select receive_finance_receivable($1,$2,$3,$4,'2026-10-21',100)",[company,project,title,account]);
  const row=(await db.query('select status,amount,paid_amount from receivables')).rows[0];
  record('P09','lacuna',{status:'paid',amount:1000,paid_amount:100},
    {status:row.status,amount:Number(row.amount),paid_amount:Number(row.paid_amount)},
    'RPC real extraída, schema mínimo e permissões simuladas; recebimento de 100 encerra título de 1000. Não valida segurança.');
} finally {await db.close();}

console.log(JSON.stringify({scope:'Diagnóstico T01/T02; somente fontes simuladas e PostgreSQL em memória',
  monetary_unit:'BRL, exceto campos explicitamente terminados em _cents',
  normative_contrast:{P04:'Títulos abertos não podem desaparecer por data extrema de outro evento.',
    P05:'Posição em T não deve incluir pagamento posterior a T.',
    P06:'400 no serviço e 600 pendentes; conservar valor sem atribuição presumida.',
    P07:'Cobertura financeira: pago 400 + futuro 600, sem criar 400 adicionais.',
    P09:'Receber 100 de principal 1000 conserva saldo 900; estado não pode indicar quitação integral.'},
  package_cases_certified:[], probes:results},null,2));
if(results.some(r=>!r.diagnostic_reproduced))process.exitCode=1;
