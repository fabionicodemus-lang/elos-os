import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const read = name => readFileSync(new URL(name, dir), "utf8");
const migration = read(readdirSync(dir).find(name => name.endsWith("_finance_partial_settlements.sql")));
const bank = read("20260729_0048_finance_bank_accounts.sql");
const operations = read("20261013223527_finance_bank_operations.sql");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C=id(1), OTHER=id(2), PROJECT=id(3), OTHER_PROJECT=id(4), USER=id(5), OTHER_USER=id(6), ACCOUNT=id(7), OTHER_ACCOUNT=id(8), RECEIVABLE=id(9), PAYABLE=id(10), CLIENT=id(11), SALE=id(12), SUPPLIER=id(13);
const iso = value => value instanceof Date ? value.toISOString().slice(0,10) : value;

async function fixture({ bankOperations = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    ${bankOperations ? 'create schema finance_private;' : ''}
    create table auth.users(id uuid primary key); insert into auth.users values('${USER}'),('${OTHER_USER}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$
      select auth.uid() is not null and target_company_id=nullif(current_setting('test.company',true),'')::uuid
      and (coalesce(current_setting('test.permissions',true),'')='' or target_permission=any(string_to_array(current_setting('test.permissions',true),',')))$$;
    create table companies(id uuid primary key); create table legal_entities(id uuid primary key);
    create table projects(id uuid primary key,company_id uuid,legal_entity_id uuid);
    create table clients(id uuid primary key,company_id uuid,name text); create table suppliers(id uuid primary key,company_id uuid,legal_name text,trade_name text);
    create table sales(id uuid primary key,company_id uuid,project_id uuid,total_amount numeric,status text);
    create table payables(id uuid primary key,company_id uuid,project_id uuid,supplier_id uuid,document text,due_date date,amount numeric(16,2),status text,
      paid_amount numeric(16,2),paid_at date,paid_account_name text,bank_account_id uuid,bank_transaction_id uuid,beneficiary_name text,updated_at timestamptz default now());
    create table receivables(id uuid primary key,company_id uuid,project_id uuid,sale_id uuid,client_id uuid,description text,sequence_number integer,sequence_total integer,
      due_date date,amount numeric(16,2),adjusted_amount numeric(16,2),correction_amount numeric(16,2) default 0,status text,paid_amount numeric(16,2),paid_at date,
      paid_account_name text,bank_account_id uuid,bank_transaction_id uuid,correction_locked boolean default false,updated_at timestamptz default now());
    create table eobra_source_accounts(id uuid primary key,company_id uuid,details jsonb);
    create table eobra_source_events(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,entity text,receivable_id uuid,payable_id uuid,
      account_id uuid,bank_transaction_id uuid,kind text,occurred_on date,amount numeric(16,2),medium text,posting_policy text default 'historical_source_only');
    grant usage on schema public,auth to authenticated;
  `);
  for (const name of ["finance_bank_accounts","finance_bank_transfers","finance_bank_transactions"]) {
    const sql = bank.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
    assert.ok(sql,name); await db.exec(sql);
  }
  const balanceFunction=bank.match(/create or replace function public\.finance_bank_account_balance\([\s\S]*?\$\$;/)?.[0];
  assert.ok(balanceFunction); await db.exec(balanceFunction);
  if (bankOperations) {
    const accountFunction=operations.match(/create function finance_private\.account\([\s\S]*?end \$\$;/)?.[0];
    assert.ok(accountFunction); await db.exec(accountFunction);
  }
  await db.exec(`
    ${bankOperations ? 'alter table finance_bank_accounts add column closed_through date;' : ''}
    create unique index finance_bank_transactions_source_unique_idx on finance_bank_transactions(company_id,source_system,source_id) where source_system is not null and source_id is not null;
    create unique index finance_bank_transactions_receivable_unique_idx on finance_bank_transactions(receivable_id) where receivable_id is not null and status<>'cancelled';
    create unique index finance_bank_transactions_payable_unique_idx on finance_bank_transactions(payable_id) where payable_id is not null and status<>'cancelled';
    ${bankOperations ? 'create table finance_collection_drafts(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,bank_account_id uuid,receivable_id uuid,amount numeric,due_date date,fine_percent numeric,monthly_interest_percent numeric,instructions text,created_by uuid);' : ''}
    insert into companies values('${C}'),('${OTHER}'); insert into projects values('${PROJECT}','${C}',null),('${OTHER_PROJECT}','${OTHER}',null);
    insert into clients values('${CLIENT}','${C}','Cliente sintético'); insert into suppliers values('${SUPPLIER}','${C}','Fornecedor sintético',null);
    insert into sales values('${SALE}','${C}','${PROJECT}',100,'active');
    select set_config('test.uid','${USER}',false),set_config('test.company','${C}',false),set_config('test.permissions','',false);
    insert into finance_bank_accounts(id,company_id,label,bank_name,bank_code,account_number,account_digit,opening_balance,allow_negative) values
      ('${ACCOUNT}','${C}','Conta sintética','Banco','000','100','0',1000,false),('${OTHER_ACCOUNT}','${OTHER}','Outra conta','Banco','000','200','0',1000,false);
  `);
  if (bankOperations) {
    const collectionFunction=operations.match(/create function finance_private\.draft_collection\([\s\S]*?end \$\$;/)?.[0];
    assert.ok(collectionFunction); await db.exec(collectionFunction);
  }
  await db.exec(migration);
  for (const table of ["payables","receivables","sales","finance_bank_transactions"]) await db.exec(`
    alter table ${table} enable row level security;
    create policy scoped on ${table} for all to authenticated using(company_id=nullif(current_setting('test.company',true),'')::uuid) with check(company_id=nullif(current_setting('test.company',true),'')::uuid);
    grant select,update on ${table} to authenticated;
  `);
  return db;
}

test("partial finance migration: real PostgreSQL invariants and legacy regression", async t => {
  const db=await fixture();
  const run=(sql,args=[])=>db.query(sql,args);
  const receive=(amount,intent,extra={})=>run("select receive_finance_receivable($1,$2,$3,$4,$5,$6,$7) id",[extra.company??C,extra.project??PROJECT,extra.title??RECEIVABLE,extra.account??ACCOUNT,extra.date??"2022-04-15",amount,intent]);
  const pay=(amount,intent)=>run("select pay_finance_payable($1,$2,$3,$4,$5,$6,$7) id",[C,PROJECT,PAYABLE,ACCOUNT,"2022-04-15",amount,intent]);
  const row=async()=> (await run("select * from receivables where id=$1",[RECEIVABLE])).rows[0];
  async function reset() {
    await db.exec(`set role postgres;truncate eobra_source_events,finance_bank_transactions,finance_collection_drafts,receivables,payables cascade;
      select set_config('test.uid','${USER}',false),set_config('test.company','${C}',false),set_config('test.permissions','',false);
      update finance_bank_accounts set opening_balance=1000,closed_through=null,status='active' where id='${ACCOUNT}';
      insert into receivables(id,company_id,project_id,sale_id,client_id,description,sequence_number,sequence_total,due_date,amount,adjusted_amount,correction_amount,status,correction_locked)
      values('${RECEIVABLE}','${C}','${PROJECT}','${SALE}','${CLIENT}','Parcela sintética',1,1,'2022-05-01',100,110,10,'open',true);
      insert into payables(id,company_id,project_id,supplier_id,document,due_date,amount,status) values('${PAYABLE}','${C}','${PROJECT}','${SUPPLIER}','Documento sintético','2022-05-01',100,'open');
      set role authenticated;`);
  }
  async function check(name,body) { await t.test(name,async()=>{await reset();await body();}); }
  try {
    await check("defaults preserve legacy payables; explicit components generate adjusted value",async()=>{
      let p=(await run("select amount,adjusted_amount from payables")).rows[0];assert.equal(p.amount,"100.00");assert.equal(p.adjusted_amount,"100.00");
      await run("update payables set installment_interest_amount=5,correction_amount=10,late_fee_amount=2,other_accrual_amount=1,discount_amount=3");
      p=(await run("select amount,adjusted_amount from payables")).rows[0];assert.equal(p.amount,"100.00");assert.equal(p.adjusted_amount,"115.00");
      await assert.rejects(run("update payables set adjusted_amount=1"),/generated|DEFAULT/i);
    });
    await check("multiple payments accumulate, preserve original and remain open until zero",async()=>{
      await receive(20,id(101));await receive(30,id(102),{date:"2022-04-20"});
      let r=await row();assert.equal(r.amount,"100.00");assert.equal(r.adjusted_amount,"110.00");assert.equal(r.paid_amount,"50.00");assert.equal(r.status,"open");assert.equal(r.correction_locked,true);
      await receive(60,id(103));r=await row();assert.equal(r.status,"paid");assert.equal(r.paid_amount,"110.00");
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,3);
    });
    await check("stable intent replays before and after closure; changed payload never posts",async()=>{
      const first=(await receive(20,id(101))).rows[0].id;assert.equal((await receive(20,id(101))).rows[0].id,first);
      await assert.rejects(receive(21,id(101)),/intenção/i);
      const last=(await receive(90,id(102))).rows[0].id;assert.equal((await receive(90,id(102))).rows[0].id,last);
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,2);
    });
    await check("replay checks current permission and tenant/project/account scope before returning identity",async()=>{
      const intent=id(107);const first=(await receive(20,intent)).rows[0].id;
      await run("select set_config('test.permissions','receivables.view',false)");await assert.rejects(receive(20,intent),/permissão/i);
      await db.exec(`set role postgres;select set_config('test.permissions','',false);update projects set company_id='${OTHER}' where id='${PROJECT}';set role authenticated;`);
      await assert.rejects(receive(20,intent),/Obra ou conta/i);
      await db.exec(`set role postgres;update projects set company_id='${C}' where id='${PROJECT}';insert into legal_entities(id) values('${id(501)}');update finance_bank_accounts set legal_entity_id='${id(501)}' where id='${ACCOUNT}';set role authenticated;`);
      await assert.rejects(receive(20,intent),/Obra ou conta/i);
      await db.exec(`set role postgres;update finance_bank_accounts set legal_entity_id=null,status='inactive' where id='${ACCOUNT}';set role authenticated;`);
      assert.equal((await receive(20,intent)).rows[0].id,first);
      await assert.rejects(receive(1,id(108)),/inativa/i);
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,1);
    });
    await check("internal payment helper is not executable through public or anonymous grants",async()=>{
      const helper="public.finance_apply_title_payment(uuid,uuid,uuid,uuid,date,numeric,uuid,text)";
      assert.equal((await run("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[helper])).rows[0].allowed,false);
      assert.equal((await run("select has_function_privilege('anon',$1,'EXECUTE') allowed",[helper])).rows[0].allowed,false);
      await assert.rejects(run("select finance_apply_title_payment($1,$2,$3,$4,$5,$6,$7,'receivable')",[C,PROJECT,RECEIVABLE,ACCOUNT,"2022-04-15",20,id(109)]),/permission denied/i);
    });
    await check("overpayment, invalid precision, closed account period and tenant mismatch roll back",async()=>{
      for(const call of [()=>receive(111,id(101)),()=>receive(0.001,id(102)),()=>receive(10,id(103),{account:OTHER_ACCOUNT}),()=>receive(10,id(104),{project:OTHER_PROJECT}),()=>receive(10,id(105),{company:OTHER})]) await assert.rejects(call());
      await db.exec(`set role postgres;update finance_bank_accounts set closed_through='2022-04-30' where id='${ACCOUNT}';set role authenticated;`);
      await assert.rejects(receive(10,id(106)),/encerrado/i);assert.equal((await row()).paid_amount,null);
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,0);
    });
    await check("legacy six-argument callers still settle fully and reject unsafe partial replay",async()=>{
      const args=[C,PROJECT,RECEIVABLE,ACCOUNT,"2022-04-15",20];
      await assert.rejects(run("select receive_finance_receivable($1,$2,$3,$4,$5,$6)",args),/intenção/i);
      args[5]=110;await run("select receive_finance_receivable($1,$2,$3,$4,$5,$6)",args);
      assert.equal((await row()).status,"paid");await assert.rejects(run("select receive_finance_receivable($1,$2,$3,$4,$5,$6)",args));
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,1);
    });
    await check("payables partial uses adjusted value and accumulated paid for summaries",async()=>{
      await run("update payables set correction_amount=10");await pay(30,id(111));
      const summary=(await run("select payables_summary($1,$2) s",[C,PROJECT])).rows[0].s;
      assert.equal(summary.total_amount,100);assert.equal(summary.adjusted_amount,110);assert.equal(summary.open_amount,80);assert.equal(summary.paid_amount,30);
      await pay(80,id(112));assert.equal((await run("select status,amount,paid_amount from payables")).rows[0].status,"paid");
    });
    await check("receivable summary includes partial paid and only remaining open",async()=>{
      await receive(40,id(121));const summary=(await run("select receivables_summary($1,$2,null) s",[C,PROJECT])).rows[0].s;
      assert.equal(summary.base_amount,100);assert.equal(summary.updated_amount,110);assert.equal(summary.open_amount,70);assert.equal(summary.paid_amount,40);assert.equal(summary.partial_count,1);
    });
    await check("cancelled historically settled titles retain paid totals without an exigible balance",async()=>{
      await db.exec(`set role postgres;update receivables set status='cancelled',paid_amount=110,paid_at='2022-02-01' where id='${RECEIVABLE}';update payables set status='cancelled',paid_amount=100,paid_at='2022-02-01' where id='${PAYABLE}';
        insert into eobra_source_events(company_id,project_id,entity,receivable_id,kind,occurred_on,amount,medium) values('${C}','${PROJECT}','settlement','${RECEIVABLE}','payment','2022-02-01',110,'non_cash');set role authenticated;`);
      const r=(await run("select receivables_summary($1,$2,null) s",[C,PROJECT])).rows[0].s;
      const p=(await run("select payables_summary($1,$2) s",[C,PROJECT])).rows[0].s;
      assert.equal(r.paid_amount,110);assert.equal(r.base_amount,0);assert.equal(r.open_amount,0);
      assert.equal(p.paid_amount,100);assert.equal(p.total_amount,0);assert.equal(p.open_amount,0);
      const events=(await run("select * from finance_title_payment_events($1,$2,'receivable',null)",[C,PROJECT])).rows;
      assert.equal(events.length,1);assert.equal(events[0].amount,"110.00");
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,0);
    });
    await check("cancelled historical residual stays preserved while collection and payment remain closed",async()=>{
      await db.exec(`set role postgres;update receivables set status='cancelled',paid_amount=30,paid_at='2022-02-01' where id='${RECEIVABLE}';update payables set status='cancelled',paid_amount=20,paid_at='2022-02-01' where id='${PAYABLE}';
        insert into eobra_source_events(company_id,project_id,entity,receivable_id,kind,occurred_on,amount,medium) values('${C}','${PROJECT}','settlement','${RECEIVABLE}','payment','2022-02-01',30,'non_cash');set role authenticated;`);
      const r=(await run("select receivables_summary($1,$2,null) s",[C,PROJECT])).rows[0].s;
      const p=(await run("select payables_summary($1,$2) s",[C,PROJECT])).rows[0].s;
      assert.equal(r.paid_amount,30);assert.equal(r.open_amount,0);
      assert.equal(p.paid_amount,20);assert.equal(p.open_amount,0);
      const title=(await run("select amount,adjusted_amount,paid_amount,adjusted_amount-paid_amount historical_balance from receivables where id=$1",[RECEIVABLE])).rows[0];
      assert.deepEqual(title,{amount:"100.00",adjusted_amount:"110.00",paid_amount:"30.00",historical_balance:"80.00"});
      const events=(await run("select * from finance_title_payment_events($1,$2,'receivable',null)",[C,PROJECT])).rows;
      assert.equal(events.length,1);assert.equal(events[0].amount,"30.00");
      await assert.rejects(receive(10,id(125)),/não disponível para recebimento/i);
      await assert.rejects(pay(10,id(126)),/não disponível para pagamento/i);
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,0);
    });
    await check("source receipts/reversals keep separate dates without bank posting",async()=>{
      await db.exec(`set role postgres;update receivables set paid_amount=30 where id='${RECEIVABLE}';
        insert into eobra_source_events(company_id,project_id,entity,receivable_id,kind,occurred_on,amount,medium) values
        ('${C}','${PROJECT}','settlement','${RECEIVABLE}','payment','2022-01-10',20,'bank'),('${C}','${PROJECT}','settlement','${RECEIVABLE}','payment','2022-02-10',20,'cash'),('${C}','${PROJECT}','settlement','${RECEIVABLE}','reversal','2022-03-10',10,'bank');set role authenticated;`);
      let events=(await run("select * from finance_title_payment_events($1,$2,null,null)",[C,PROJECT])).rows;
      assert.deepEqual(events.map(e=>[iso(e.occurred_on),e.amount]),[["2022-01-10","20.00"],["2022-02-10","20.00"],["2022-03-10","-10.00"]]);
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,0);
      await receive(10,id(131));events=(await run("select * from finance_title_payment_events($1,$2,null,null)",[C,PROJECT])).rows;
      assert.equal(events.length,4);assert.equal(events.reduce((sum,e)=>sum+Number(e.amount),0),40);
    });
    await check("voided source payment preserves a zero marker and temporal warning without bank posting",async()=>{
      await db.exec(`set role postgres;update receivables set paid_amount=30 where id='${RECEIVABLE}';
        insert into eobra_source_events(company_id,project_id,entity,receivable_id,kind,occurred_on,amount,medium) values
        ('${C}','${PROJECT}','settlement','${RECEIVABLE}','voided_payment','2022-01-10',80,'cash'),
        ('${C}','${PROJECT}','settlement','${RECEIVABLE}','payment','2022-02-10',30,'non_cash');set role authenticated;`);
      const events=(await run("select * from finance_title_payment_events($1,$2,null,null)",[C,PROJECT])).rows;
      assert.equal(events.length,2);
      const voided=events.find(event=>event.kind==='voided_payment');
      assert.equal(Number(voided.amount),0);assert.equal(iso(voided.occurred_on),'2022-01-10');assert.equal(voided.history_dates_complete,false);
      assert.equal(events.reduce((sum,event)=>sum+Number(event.amount),0),30);
      assert.equal(events.find(event=>event.kind==='payment').history_dates_complete,true);
      assert.equal((await run("select count(*)::int n from finance_bank_transactions")).rows[0].n,0);
    });
    await check("timeline permissions isolate tenant and payable/receivable domains",async()=>{
      await receive(20,id(141));await pay(10,id(142));
      await run("select set_config('test.permissions','receivables.view',false)");
      const events=(await run("select * from finance_title_payment_events($1,null,null,null)",[C])).rows;
      assert.equal(events.length,1);assert.equal(events[0].title_kind,"receivable");
      await assert.rejects(run("select * from finance_title_payment_events($1,null,null,null)",[OTHER]),/permissão/i);
      await assert.rejects(receive(1,id(143)),/permissão/i);
      await run("select set_config('test.uid','',false)");await assert.rejects(run("select * from finance_title_payment_events($1,null,null,null)",[C]),/Autenticação/i);
    });
    await check("partial cancellation is blocked and correction stays locked",async()=>{
      await receive(20,id(151));await assert.rejects(run("update receivables set status='cancelled'"),/histórico/i);
      await run("update receivables set correction_locked=false");assert.equal((await row()).correction_locked,true);
      await pay(20,id(152));await assert.rejects(run("update payables set status='cancelled'"),/histórico/i);
    });
    await check("legacy paid scalar remains dated only when no event history exists",async()=>{
      await db.exec(`set role postgres;update receivables set status='paid',paid_amount=110,paid_at='2022-02-01' where id='${RECEIVABLE}';set role authenticated;`);
      const events=(await run("select * from finance_title_payment_events($1,$2,'receivable',null)",[C,PROJECT])).rows;
      assert.equal(events.length,1);assert.equal(events[0].source_system,"legacy_snapshot");assert.equal(events[0].amount,"110.00");assert.equal(iso(events[0].occurred_on),"2022-02-01");
    });
    await check("installed collection module drafts only the residual, and insufficient funds cannot pay",async()=>{
      await receive(30,id(161));
      await db.exec("set role postgres");await run("select finance_private.draft_collection($1,$2,0,0,'')",[ACCOUNT,RECEIVABLE]);
      assert.equal((await run("select amount from finance_collection_drafts")).rows[0].amount,"80.00");
      await run("update finance_bank_accounts set opening_balance=-100 where id=$1",[ACCOUNT]);await db.exec("set role authenticated");
      await assert.rejects(pay(10,id(162)),/Saldo bancário insuficiente/);
    });
  } finally { await db.close(); }
});

test("partial migration and payment work without the optional bank-operations module",async()=>{
  const db=await fixture({bankOperations:false});
  try {
    const optional=(await db.query(`select to_regnamespace('finance_private')::text private_schema,
      to_regprocedure('finance_private.draft_collection(uuid,uuid,numeric,numeric,text)')::text draft_function,
      to_regclass('public.finance_collection_drafts')::text draft_table,
      (select count(*)::int from information_schema.columns where table_schema='public' and table_name='finance_bank_accounts' and column_name='closed_through') closed_period_columns`)).rows[0];
    assert.deepEqual(optional,{private_schema:null,draft_function:null,draft_table:null,closed_period_columns:0});
    await db.exec(`insert into receivables(id,company_id,project_id,sale_id,client_id,description,sequence_number,sequence_total,due_date,amount,adjusted_amount,correction_amount,status,correction_locked)
      values('${RECEIVABLE}','${C}','${PROJECT}','${SALE}','${CLIENT}','Parcela sintética',1,1,'2022-05-01',100,110,10,'open',true);
      insert into payables(id,company_id,project_id,supplier_id,document,due_date,amount,status)
      values('${PAYABLE}','${C}','${PROJECT}','${SUPPLIER}','Documento sintético','2022-05-01',100,'open');set role authenticated;`);
    const args=[C,PROJECT,RECEIVABLE,ACCOUNT,'2022-04-15',30,id(701)];
    const first=(await db.query('select receive_finance_receivable($1,$2,$3,$4,$5,$6,$7) id',args)).rows[0].id;
    assert.equal((await db.query('select receive_finance_receivable($1,$2,$3,$4,$5,$6,$7) id',args)).rows[0].id,first);
    await db.query('select pay_finance_payable($1,$2,$3,$4,$5,$6,$7)',[C,PROJECT,PAYABLE,ACCOUNT,'2022-04-15',20,id(702)]);
    assert.deepEqual((await db.query('select status,paid_amount,finance_title_remaining(amount,adjusted_amount,paid_amount,status)::numeric(16,2) remaining from receivables')).rows[0],
      {status:'open',paid_amount:'30.00',remaining:'80.00'});
    assert.deepEqual((await db.query('select status,paid_amount,finance_title_remaining(amount,adjusted_amount,paid_amount,status)::numeric(16,2) remaining from payables')).rows[0],
      {status:'open',paid_amount:'20.00',remaining:'80.00'});
    assert.equal((await db.query('select count(*)::int n from finance_bank_transactions')).rows[0].n,2);
  } finally {await db.close();}
});
