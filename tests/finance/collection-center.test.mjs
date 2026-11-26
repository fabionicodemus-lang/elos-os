import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [user,co,other,project,spe,account,sale,client,unit,receivable,wrongAccount,wrongSpe,imported] = Array.from({length:13},(_,i)=>id(i+1));
const bankBase=sql("20260729_0048_finance_bank_accounts.sql");
const bank=sql("20261013223527_finance_bank_operations.sql");
const migration=sql("20261126150000_finance_collection_center.sql");

test("Collection center — PostgreSQL integration", async t => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create schema storage; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create function public.has_company_permission(c uuid,p text) returns boolean language sql stable as $$select auth.uid() is not null and c=nullif(current_setting('test.company',true),'')::uuid and p is distinct from current_setting('test.denied',true)$$;
   create function public.is_valid_cnpj(text) returns boolean language sql immutable as $$select length($1)=14$$;
   create table companies(id uuid primary key);
   create table legal_entities(id uuid primary key,company_id uuid,legal_name text,cnpj text,status text);
   create table projects(id uuid primary key,company_id uuid,legal_entity_id uuid,status text,name text);
   create table clients(id uuid primary key,company_id uuid,name text,email text,phone text);
   create table units(id uuid primary key,company_id uuid,project_id uuid,code text);
   create table sales(id uuid primary key,company_id uuid,project_id uuid,status text,total_amount numeric);
   create table payables(id uuid primary key);
   create table receivables(id uuid primary key,company_id uuid,project_id uuid,sale_id uuid,client_id uuid,unit_id uuid,status text,description text,amount numeric,adjusted_amount numeric,due_date date,paid_amount numeric,paid_at date,bank_account_id uuid,bank_transaction_id uuid,correction_amount numeric,adjustment_index text,correction_base_month date,correction_base_value numeric,correction_reference_month date,correction_reference_value numeric,correction_locked boolean,source_system text,updated_at timestamptz);
   create table integration_import_rows(id uuid primary key,normalized_data jsonb);
   create table integration_import_records(company_id uuid,entity_kind text,target_id uuid,row_id uuid);
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
   grant usage on schema public,auth,storage to authenticated,service_role;`);
  for(const name of ["finance_bank_accounts","finance_bank_transfers","finance_bank_transactions"]){
   const statement=bankBase.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
   assert.ok(statement); await db.exec(statement);
  }
  for(const name of ["finance_bank_account_balance","post_finance_bank_transaction"]){
   const statement=bankBase.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
   assert.ok(statement); await db.exec(statement);
  }
  await db.exec(bank); await db.exec(migration);
  await db.exec(`insert into auth.users values('${user}');insert into companies values('${co}'),('${other}');
   select set_config('test.uid','${user}',false),set_config('test.company','${co}',false);
   insert into legal_entities values('${spe}','${co}','SPE Teste','11222333000181','active'),('${wrongSpe}','${co}','Outra SPE','11222333000262','active');
   insert into projects values('${project}','${co}','${spe}','active','Obra teste');
   insert into clients values('${client}','${co}','Cliente teste','cliente@example.invalid','5511999990000');
   insert into units values('${unit}','${co}','${project}','101');
   insert into sales values('${sale}','${co}','${project}','active',2000);
   insert into finance_bank_accounts(id,company_id,legal_entity_id,label,bank_name,bank_code,account_number) values('${account}','${co}','${spe}','Conta A','Banco','001','1234'),('${wrongAccount}','${co}','${wrongSpe}','Conta B','Banco','001','5678');
   insert into receivables(id,company_id,project_id,sale_id,client_id,unit_id,status,description,amount,adjusted_amount,due_date,correction_amount,adjustment_index,correction_locked,source_system) values
   ('${receivable}','${co}','${project}','${sale}','${client}','${unit}','open','Mensal',900,1000,(now() at time zone 'America/Sao_Paulo')::date+2,100,'CUB-SC',false,null),
   ('${imported}','${co}','${project}','${sale}','${client}','${unit}','open','Importada',900,1000,(now() at time zone 'America/Sao_Paulo')::date+2,100,'CUB-SC',true,'eobra');
   grant select,update on receivables to authenticated;
   set role authenticated;`);
  const q=(str,params=[])=>db.query(str,params);
  const val=async(str,params=[]) => (await q(str,params)).rows[0]?.v;
  const cfg=(acc=account,exception=null)=>val("select collection_config($1,$2,$3,$4,'mock','conv-1',$5,'teste@example.invalid','mock-wa','09:00') v",[co,project,exception,acc,exception?"Exceção aprovada":null]);
  const prep=(r=receivable)=>val("select collection_prepare($1,$2) v",[co,r]);
  const as=async role=>db.exec(`reset role; set role ${role}`);
  const command=(charge,action)=>q("select collection_command($1,$2,$3,'motivo teste')",[co,charge,action]);
  let config,charge;
  await t.test("rejects missing configuration, wrong SPE, and cross-company configuration",async()=>{
   await assert.rejects(prep(),/Configuração válida/); await assert.rejects(cfg(wrongAccount),/fora da SPE/);
   await assert.rejects(q("select collection_prepare($1,$2)",[other,receivable]),/Sem permissão/);
   config=await cfg(); charge=await prep(); assert.equal(await prep(),charge);
   const c=(await q("select * from finance_collections where id=$1",[charge])).rows[0];
   assert.equal(c.bank_account_id,account);assert.equal(Number(c.amount),1000);assert.equal(Number(c.correction_snapshot.correction),100);
  });
  await t.test("imported corrected amount is preserved and requires review",async()=>{
   await assert.rejects(prep(imported),/Conferir boleto/);
   await q("select collection_review_import($1,$2,'Consulta ao banco sem boleto ativo')",[co,imported]);
   const c=await prep(imported); assert.equal(Number(await val("select amount v from finance_collections where id=$1",[c])),1000);
  });
  await t.test("registration and outbound messages require trusted adapter and verified configuration",async()=>{
   await assert.rejects(command(charge,"request"),/homologada/);
   await assert.rejects(q("select collection_verify_config($1,true,true,true,now())",[config]),/permission denied/);
   await as("service_role"); await q("select collection_verify_config($1,true,true,true,now())",[config]);
   await as("authenticated"); await command(charge,"request");
   await assert.rejects(q("select collection_bank_result($1,'registered','ABC','private/test.pdf','ok')",[charge]),/permission denied/);
   await assert.rejects(q("update receivables set status='paid',paid_amount=1000 where id=$1",[receivable]),/Baixa exige/);
   await as("service_role"); assert.equal(await val("select collection_schedule($1) v",[charge]),0);
   await q("select collection_bank_result($1,'registered','ABC','private/test.pdf','ok')",[charge]);
   assert.equal(await val("select collection_schedule($1) v",[charge]),6);
   assert.equal(await val("select collection_schedule($1) v",[charge]),0);
   const reminders=(await q("select purpose,(scheduled_at at time zone 'America/Sao_Paulo')::time::text as local from finance_collection_messages where collection_id=$1 and purpose<>'initial'",[charge])).rows;
   assert.equal(reminders.length,4); assert.ok(reminders.every(x=>x.local==="09:00:00"));
  });
  await t.test("separate email/WA events, duplicated claim/event, failures without payment",async()=>{
   const m=(await q("select id,channel from finance_collection_messages where collection_id=$1 and purpose='initial' order by channel",[charge])).rows;
   for(const x of m){assert.ok(await val("select collection_claim_message($1) v",[x.id]));assert.equal(await val("select collection_claim_message($1) v",[x.id]),null);}
   await q("select collection_message_event($1,'e1','opened',now(),true,null,'mail-id')",[m[0].id]);
   await q("select collection_message_event($1,'e1','opened',now(),true,null,'mail-id')",[m[0].id]);
   await q("select collection_message_event($1,'w1','failed',now(),null,'teste','wa-id')",[m[1].id]);
   assert.equal(Number(await val("select count(*) v from finance_collection_message_events")),2);
   await as("authenticated"); assert.equal(await val("select status v from receivables where id=$1",[receivable]),"open");
  });
  await t.test("due-date changes invalidate old reminders and require a new registered document",async()=>{
   const c=await prep(imported); await command(c,"request");
   await as("service_role"); await q("select collection_bank_result($1,'registered','IMPORT-TEST','private/import.pdf',null)",[c]);
   assert.equal(await val("select collection_schedule($1) v",[c]),6);
   await as("authenticated"); await q("update receivables set due_date=due_date+7 where id=$1",[imported]);
   assert.equal(await val("select status v from finance_collections where id=$1",[c]),"cancellation_requested");
   assert.equal(Number(await val("select count(*) v from finance_collection_messages where collection_id=$1 and status='pending'",[c])),0);
   await as("service_role"); await q("select collection_bank_result($1,'cancelled','IMPORT-TEST','private/import.pdf',null)",[c]);
   await as("authenticated"); const next=await prep(imported);assert.notEqual(next,c); await command(next,"request");
   await as("service_role"); await q("select collection_bank_result($1,'registered','IMPORT-NEW','private/import-new.pdf',null)",[next]);
   assert.equal(await val("select collection_schedule($1) v",[next]),6);
   const m=await val("select id v from finance_collection_messages where collection_id=$1 and purpose='initial' limit 1",[next]);
   await q("select collection_verify_config($1,true,true,true,now()-interval '60 minutes')",[config]);
   assert.equal(await val("select collection_claim_message($1) v",[m]),null);
   await q("select collection_mark_reconciled($1)",[config]); assert.ok(await val("select collection_claim_message($1) v",[m]));
   await as("authenticated"); await command(next,"suspend");
   assert.equal(Number(await val("select count(*) v from finance_collection_messages where collection_id=$1 and status='pending'",[next])),0);
  });
  async function evidence(n,amount,kind="receipt"){
   const tx=id(n),imp=id(n+1000),entry=id(n+2000),link=id(n+3000),direction=amount>0?"credit":"debit";
   await db.exec("reset role");
   await q("insert into finance_bank_imports(id,company_id,bank_account_id,file_name,file_hash,created_by) values($1,$2,$3,'test.ofx',$4,$5)",[imp,co,account,String(n).padStart(64,"0"),user]);
   await q("insert into finance_statement_entries(id,company_id,bank_account_id,import_id,fit_id,transaction_date,amount,description,created_by) values($1,$2,$3,$4,$5,current_date,$6,'test',$7)",[entry,co,account,imp,String(n),amount,user]);
   await q("insert into finance_bank_transactions(id,company_id,project_id,legal_entity_id,bank_account_id,transaction_date,direction,transaction_type,description,amount,status,reconciliation_date) values($1,$2,$3,$4,$5,current_date,$6,$7,'test',$8,'reconciled',current_date)",[tx,co,project,spe,account,direction,kind,Math.abs(amount)]);
   await q("insert into finance_reconciliation_links(id,company_id,project_id,entry_id,transaction_id,amount,created_by) values($1,$2,$3,$4,$5,$6,$7)",[link,co,project,entry,tx,Math.abs(amount),user]);
   await as("authenticated");return link;
  }
  const apply=(link,fee=null,reversal=null)=>val("select collection_allocate($1,$2,$3,$4,$5,'Conferência do extrato') v",[co,charge,link,fee,reversal]);
  await t.test("partial, fee, excess credit, duplicate, refund and reversal of reconciliation",async()=>{
   const l=await evidence(20,400),fee=await evidence(21,-5,"fee");
   const a=await apply(l,fee);assert.equal(await apply(l,fee),a);
   assert.equal(Number(await val("select paid_amount v from receivables where id=$1",[receivable])),400);
   assert.equal(Number(await val("select net_amount v from finance_collection_allocations where id=$1",[a])),395);
   const l2=await evidence(22,700);
   await as("service_role"); assert.equal(await val("select collection_match_receipt($1,'mock','conv-1','UNKNOWN',$2,null) v",[account,l2]),null);
   const a2=await val("select collection_match_receipt($1,'mock','conv-1','ABC',$2,null) v",[account,l2]);
   await as("authenticated");
   assert.equal(await val("select status v from receivables where id=$1",[receivable]),"paid");
   assert.equal(Number(await val("select available_credit v from finance_collection_allocations where id=$1",[a2])),100);
   assert.equal(Number(await val("select count(*) v from finance_collection_messages where collection_id=$1 and status='pending'",[charge])),0);
   const refund=await evidence(23,-700,"refund"); await apply(refund,null,a2);
   assert.equal(await val("select status v from receivables where id=$1",[receivable]),"open");
   assert.equal(Number(await val("select paid_amount v from receivables where id=$1",[receivable])),400);
   await db.exec("reset role");await q("update finance_reconciliation_links set reversed_at=now() where id=$1",[l]);
   assert.equal(Number(await val("select paid_amount v from receivables where id=$1",[receivable])),0);
  });
  await t.test("RLS isolates the other company and rejects direct writes",async()=>{
   await as("authenticated"); await assert.rejects(q("update finance_collections set status='registered'"),/permission denied/);
   await db.exec("reset role");await q("select set_config('test.company',$1,false)",[other]);await as("authenticated");
   assert.equal(Number(await val("select count(*) v from finance_collections")),0);
   await assert.rejects(command(charge,"cancel"),/Sem permissão/);
  });
 } finally {await db.close();}
});
