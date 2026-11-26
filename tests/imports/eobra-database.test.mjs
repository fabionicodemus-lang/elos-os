import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
const migrationFile = readdirSync(migrationDir).find((name) => name.endsWith("_integration_eobra_import.sql"));
assert.ok(migrationFile, "eObra migration must exist");
const migration = readFileSync(new URL(migrationFile, migrationDir), "utf8");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PA = "11111111-1111-4111-8111-111111111111";
const PA2 = "22222222-2222-4222-8222-222222222222";
const PB = "33333333-3333-4333-8333-333333333333";
const UA = "12345678-1234-4234-8234-123456789abc";
const UB = "22345678-1234-4234-8234-123456789abc";
const CA = "44444444-4444-4444-8444-444444444444";
const CB = "55555555-5555-4555-8555-555555555555";
const UNIT = "66666666-6666-4666-8666-666666666666";
const SALE = "77777777-7777-4777-8777-777777777777";
const SB = "88888888-8888-4888-8888-888888888888";
const hash = (text) => createHash("sha256").update(text).digest("hex");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${UA}'),('${UB}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid
    $$;
    create function public.is_company_member(target_company_id uuid) returns boolean language sql stable as $$
      select auth.uid() is not null and target_company_id = nullif(current_setting('test.company',true),'')::uuid
    $$;
    create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$
      select public.is_company_member(target_company_id)
        and coalesce(current_setting('test.denied',true),'')<>target_permission
    $$;
    create table public.companies(id uuid primary key,name text);
    create table public.projects(id uuid primary key,company_id uuid not null references public.companies(id),name text,code text);
    create table public.suppliers(
      id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
      person_type text not null check(person_type in ('company','individual','other')), legal_name text not null,
      tax_id text,email text,phone text,address text,city text,state text,notes text,status text not null,
      source_system text,source_id text,created_by uuid references auth.users(id),
      created_at timestamptz default now(),updated_at timestamptz default now(),
      unique(company_id,source_system,source_id)
    );
    create table public.clients(
      id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
      person_type text not null check(person_type in ('PF','PJ','OTHER')), name text not null,
      tax_id text,email text,phone text,address text,city text,state text,notes text,status text not null,
      source_system text,source_id text,created_by uuid references auth.users(id),
      created_at timestamptz default now(),updated_at timestamptz default now(),
      unique(company_id,source_system,source_id)
    );
    create table public.units(id uuid primary key, company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id));
    create table public.sales(id uuid primary key,company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),client_id uuid not null references public.clients(id),unit_id uuid not null references public.units(id),status text not null default 'active');
    create table public.payables(
      id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),supplier_id uuid references public.suppliers(id),
      document text,due_date date not null,amount numeric(16,2) not null check(amount>=0),status text not null check(status in ('open','paid','cancelled')),installment_label text,notes text,paid_at date,paid_amount numeric(16,2),paid_account_name text,origin text not null,source_system text,source_id text,beneficiary_name text,beneficiary_tax_id text,created_by uuid references auth.users(id),
      created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,source_system,source_id)
    );
    create table public.receivables(
      id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),sale_id uuid not null references public.sales(id),client_id uuid not null references public.clients(id),unit_id uuid not null references public.units(id),category text not null,description text not null,due_date date not null,
      amount numeric(16,2) not null check(amount>=0),adjusted_amount numeric(16,2) not null,status text not null check(status in ('open','paid','cancelled')),paid_at date,paid_amount numeric(16,2),paid_account_name text,correction_locked boolean not null,
      installment_interest_amount numeric(16,2),correction_amount numeric(16,2),late_fee_amount numeric(16,2),other_accrual_amount numeric(16,2),discount_amount numeric(16,2),source_system text,source_id text,created_by uuid references auth.users(id),created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,source_system,source_id)
    );
    insert into public.companies values ('${A}','Empresa sintética A'),('${B}','Outra');
    insert into public.projects values ('${PA}','${A}','Obra sintética A','OBRA-A'),('${PA2}','${A}','Obra sintética B','OBRA-B'),('${PB}','${B}','Outro','OUT');
    insert into public.clients(id,company_id,person_type,name,tax_id,status) values ('${CA}','${A}','PJ','Cliente real','99000001000101','active'),('${CB}','${B}','PJ','Cliente externo','99000002000148','active');
    insert into public.units values ('${UNIT}','${A}','${PA}');
    insert into public.sales(id,company_id,project_id,client_id,unit_id) values ('${SALE}','${A}','${PA}','${CA}','${UNIT}');
    insert into public.suppliers(id,company_id,person_type,legal_name,tax_id,status) values ('${SB}','${B}','company','Fornecedor externo','99000002000148','active');
    grant usage on schema public,auth to authenticated;
    grant select on public.companies,public.projects,public.units,public.sales to authenticated;
    grant select,insert,update on public.suppliers,public.clients,public.payables,public.receivables to authenticated;
    do $$ declare t text; begin
      foreach t in array array['companies','projects','suppliers','clients','units','sales','payables','receivables'] loop
        execute format('alter table public.%I enable row level security',t);
        execute format('create policy tenant on public.%I for all to authenticated using (public.is_company_member(%I)) with check(public.is_company_member(%I))',t,case when t='companies' then 'id' else 'company_id' end,case when t='companies' then 'id' else 'company_id' end);
      end loop;
    end; $$;
  `);
  await db.exec(migration);
  await setTenant(db,A,UA);
  return db;
}

async function setTenant(db, company, user) {
  await db.exec("reset role");
  await db.query("select set_config('test.company',$1,false),set_config('test.uid',$2,false),set_config('test.denied','',false)",[company,user]);
  await db.exec("set role authenticated");
}

function contact(id, name = "Fornecedor", extra = {}) {
  return {source_row:2,external_id:id,raw_data:{codigo:id,nome:name},normalized_data:{name,tax_id:null,person_type:"PJ",status:"active",...extra},errors:[],warnings:[]};
}

function title(id, extra={}) {
  return {source_row:2,external_id:id,raw_data:{codigo:id},normalized_data:{description:`Título ${id}`,document:id,due_date:"2026-12-01",original_amount:"100.00",current_amount:"100.00",paid_amount:"0.00",balance_amount:"100.00",status:"open",counterparty_name:"Favorecido",source_project:null,category:"monthly",...extra},errors:[],warnings:[]};
}

async function stage(db, rows, {kind="supplier",company=A,project=null,file=`${kind}-${rows[0]?.external_id}`,host="fixture.eobra.com.br",mapping={single_project_confirmed:true},sheet="Planilha"}={}) {
  const {rows:result}=await db.query("select public.stage_eobra_import($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id",[company,project,host,kind,`${file}.xlsx`,hash(file),sheet,"2026-11-26",mapping,rows]);
  return result[0].id;
}

async function batch(db,id){return (await db.query("select * from public.integration_import_batches where id=$1",[id])).rows[0];}
async function promote(db,id,preview){return (await db.query("select public.promote_eobra_import($1,$2) result",[id,preview??(await batch(db,id)).preview_hash])).rows[0].result;}
async function count(db,table){return (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n;}

test("eObra database isolation, review and immutable promotion", async t=>{
  const db=await fixture();
  try{
    await t.test("RPCs remain security invoker and staging writes no production rows",async()=>{
      const {rows}=await db.query("select proname,prosecdef from pg_proc where proname in ('stage_eobra_import','promote_eobra_import','cancel_eobra_import')");
      assert.equal(rows.length,3); assert.ok(rows.every(r=>r.prosecdef===false));
      const before=await count(db,"suppliers");
      const id=await stage(db,[contact("S1")]);
      const b=await batch(db,id);
      assert.equal(b.status,"ready"); assert.equal(b.summary.ready,1); assert.equal(b.created_by,UA);
      assert.equal(await count(db,"suppliers"),before);
      await assert.rejects(promote(db,id,"0".repeat(64)),/revisão mudou/);
      assert.deepEqual(await promote(db,id),{created:1,reused:0,duplicates:0,total:1});
      assert.equal(await count(db,"suppliers"),before+1);
      assert.deepEqual(await promote(db,id,"outdated replay"),{created:1,reused:0,duplicates:0,total:1});
      assert.equal(await count(db,"suppliers"),before+1);
      assert.equal(await stage(db,[contact("S1")]),id);
      await assert.rejects(stage(db,[contact("S1","Tampered")]),/conteúdo diferente/);
    });
    await t.test("new export recognizes unchanged IDs and blocks changed content",async()=>{
      const duplicate=await stage(db,[contact("S1")],{file:"new-same-source"});
      assert.equal((await batch(db,duplicate)).summary.duplicates,1);
      assert.deepEqual(await promote(db,duplicate),{created:0,reused:0,duplicates:1,total:1});
      const conflict=await stage(db,[contact("S1","Nome alterado")],{file:"changed-source"});
      assert.equal((await batch(db,conflict)).status,"review");
      assert.equal((await batch(db,conflict)).summary.conflicts,1);
      await assert.rejects(promote(db,conflict),/pendências/);
      assert.equal((await db.query("select legal_name from public.suppliers where source_id like '%|S1'")).rows[0].legal_name,"Fornecedor");
    });
    await t.test("exact document reuses native client without overwriting",async()=>{
      const id=await stage(db,[contact("C1","Novo nome",{tax_id:"99.000.001/0001-01",email:"different@example.com"})],{kind:"client"});
      const preview=(await db.query("select target_id,warnings from public.integration_import_rows where batch_id=$1",[id])).rows[0];
      assert.equal(preview.target_id,CA);
      assert.ok(preview.warnings.some(warning=>warning.includes("CPF/CNPJ já cadastrado: Cliente real. Será vinculado sem alterar os dados existentes.")));
      assert.deepEqual(await promote(db,id),{created:0,reused:1,duplicates:0,total:1});
      const {rows}=await db.query("select name,email from public.clients where id=$1",[CA]);
      assert.equal(rows[0].name,"Cliente real");assert.equal(rows[0].email,null);
    });
    await t.test("tenant RLS and entity permissions prevent access through RPC and direct tables",async()=>{
      const id=await stage(db,[contact("S-TENANT")]);
      await assert.rejects(stage(db,[contact("ATTACK")],{company:B}),/Sem permissão/);
      await assert.rejects(stage(db,[contact("BAD-PROJECT")],{project:PB}),/Obra não pertence/);
      await db.query("select set_config('test.denied','suppliers.manage',false)");
      await assert.rejects(stage(db,[contact("DENIED")]),/Sem permissão/);
      assert.equal(await count(db,"integration_import_batches"),1); // client batch remains visible
      await db.query("select set_config('test.denied','admin.company.manage',false)");
      assert.equal(await count(db,"integration_import_batches"),0);
      await assert.rejects(promote(db,id,"0".repeat(64)),/indisponível/);
      await setTenant(db,B,UB);
      assert.equal(await count(db,"integration_import_batches"),0);
      await assert.rejects(promote(db,id,"0".repeat(64)),/indisponível/);
      const other=await stage(db,[contact("S1","Outra empresa")],{company:B});
      assert.equal((await promote(db,other)).created,1);
      await setTenant(db,A,UA);
      assert.equal((await db.query("select count(*)::int n from public.integration_import_records where company_id=$1",[B])).rows[0].n,0);
    });
    await t.test("denies anonymous/no-session requests and invalid host",async()=>{
      await db.exec("set role anon");
      await assert.rejects(db.query("select public.cancel_eobra_import($1)",[PA]),/permission denied/);
      await setTenant(db,A,UA);
      await db.query("select set_config('test.uid','',false)");
      await assert.rejects(stage(db,[contact("NO-AUTH")]),/Sem permissão/);
      await setTenant(db,A,UA);
      await assert.rejects(stage(db,[contact("BAD-HOST")],{host:"fixture.eobra.com.br.attacker.test"}),/subdomínio/);
    });
    await t.test("one-project confirmation and external binding are enforced",async()=>{
      await assert.rejects(stage(db,[title("F1")],{kind:"payable",project:PA,mapping:{}}),/Confirme/);
      await assert.rejects(stage(db,[title("F1",{source_project:"900"})],{kind:"payable",project:PA}),/correspondência/);
      await assert.rejects(stage(db,[title("F1",{source_project:"900"}),{...title("F2",{source_project:"901"}),source_row:3}],{kind:"payable",project:PA}),/mais de uma obra/);
      const id=await stage(db,[title("F1",{source_project:"900"})],{kind:"payable",project:PA,mapping:{single_project_confirmed:true,project_binding:{source_reference:"900",project_id:PA,confirmed:true}}});
      assert.equal((await promote(db,id)).created,1);
    });
    await t.test("supplier and client identities always belong to company scope",async()=>{
      for(const kind of ["supplier","client"]){
        await assert.rejects(stage(db,[contact(`CONTACT-PROJECT-${kind}`)],{kind,project:PA}),/pertencem à empresa/);
      }
      const id=await stage(db,[contact("CONTACT-COMPANY")]);
      await promote(db,id);
      const b=await batch(db,id);
      assert.equal(b.project_id,null); assert.equal(b.scope_id,A);
      const record=(await db.query("select project_id,scope_id from public.integration_import_records where batch_id=$1",[id])).rows[0];
      assert.equal(record.project_id,null); assert.equal(record.scope_id,A);
    });
    await t.test("partial, adjusted payable, missing links and foreign supplier remain blocked",async()=>{
      const cases=[
        ["PARTIAL",{status:"partial",paid_amount:"30.00",balance_amount:"70.00"}],
        ["OPEN-PAID",{paid_amount:"30.00",balance_amount:"70.00"}],
        ["ADJUSTED",{current_amount:"110.00",balance_amount:"110.00",correction_amount:"10.00"}],
        ["FOREIGN",{supplier_id:SB}],
        ["BAD-DATE",{due_date:"2026-02-31"}],
        ["CANCEL-PAID",{status:"cancelled",paid_amount:"100.00",balance_amount:"0.00"}],
        ["CANCEL-BALANCE",{status:"cancelled",paid_amount:"0.00",balance_amount:"100.00"}]
      ];
      for(const [key,extra] of cases){
        const id=await stage(db,[title(key,extra)],{kind:"payable",project:PA});
        assert.equal((await batch(db,id)).summary.blocked,1,key);
        await assert.rejects(promote(db,id),/pendências/);
      }
      const missing=await stage(db,[title("RECV-MISSING")],{kind:"receivable",project:PA});
      assert.equal((await batch(db,missing)).summary.blocked,1);
      const foreign=await stage(db,[title("RECV-FOREIGN",{sale_id:SALE,client_id:CB,unit_id:UNIT})],{kind:"receivable",project:PA});
      assert.equal((await batch(db,foreign)).summary.blocked,1);
    });
    await t.test("historical paid title and real receivable preserve values and links",async()=>{
      const id=await stage(db,[title("HIST",{status:"paid",paid_amount:"100.00",balance_amount:"0.00",paid_at:"2026-11-20",paid_account_name:"Banco da origem"})],{kind:"payable",project:PA});
      assert.equal((await promote(db,id)).created,1);
      const p=(await db.query("select * from public.payables where source_id like '%|HIST'")).rows[0];
      assert.equal(p.status,"paid");assert.equal(p.paid_amount,"100.00");assert.equal(p.origin,"historical_import");
      const recv=await stage(db,[title("RECV",{sale_id:SALE,client_id:CA,unit_id:UNIT,current_amount:"110.00",balance_amount:"110.00",correction_amount:"10.00"})],{kind:"receivable",project:PA});
      assert.equal((await promote(db,recv)).created,1);
      const r=(await db.query("select * from public.receivables where source_id like '%|RECV'")).rows[0];
      assert.equal(r.amount,"100.00");assert.equal(r.adjusted_amount,"110.00");assert.equal(r.correction_locked,true);assert.equal(r.client_id,CA);
    });
    await t.test("promotion revalidates cancelled sales and changed counterparty documents",async()=>{
      const saleBatch=await stage(db,[title("SALE-CHANGED",{sale_id:SALE,client_id:CA,unit_id:UNIT,counterparty_tax_id:"99000001000101"})],{kind:"receivable",project:PA});
      assert.equal((await batch(db,saleBatch)).status,"ready");
      await db.exec("reset role");
      await db.query("update public.sales set status='cancelled' where id=$1",[SALE]);
      await db.exec("set role authenticated");
      await assert.rejects(promote(db,saleBatch),/pendência/);
      await db.exec("reset role");
      await db.query("update public.sales set status='active' where id=$1",[SALE]);
      await db.exec("set role authenticated");
      const badClient=await stage(db,[title("CLIENT-DOCUMENT",{sale_id:SALE,client_id:CA,unit_id:UNIT,counterparty_tax_id:"99000002000148"})],{kind:"receivable",project:PA});
      assert.equal((await batch(db,badClient)).status,"review");
      const supplierBatch=await stage(db,[contact("SUPPLIER-DOC","Fornecedor sintético",{tax_id:"99000003000192"})]);
      await promote(db,supplierBatch);
      const supplier=(await db.query("select target_id from public.integration_import_records where batch_id=$1",[supplierBatch])).rows[0].target_id;
      const payableBatch=await stage(db,[title("SUPPLIER-CHANGED",{supplier_id:supplier,counterparty_tax_id:"99000003000192"})],{kind:"payable",project:PA});
      assert.equal((await batch(db,payableBatch)).status,"ready");
      await db.query("update public.suppliers set tax_id='99000002000148' where id=$1",[supplier]);
      await assert.rejects(promote(db,payableBatch),/Documento do fornecedor/);
      await db.query("update public.suppliers set tax_id='99000003000192' where id=$1",[supplier]);
    });
    await t.test("reprocessing preserves old snapshots and creates a new review only when resolution changes",async()=>{
      const unresolved=title("LATER-RESOLVED");
      unresolved.errors=["Venda ainda não localizada."];
      const first=await stage(db,[unresolved],{kind:"receivable",project:PA});
      assert.equal((await batch(db,first)).status,"review");
      assert.equal(await stage(db,[unresolved],{kind:"receivable",project:PA}),first);
      const resolved={...unresolved,normalized_data:{...unresolved.normalized_data,sale_id:SALE,client_id:CA,unit_id:UNIT,resolved_sale_number:"Venda sintética"},errors:[]};
      const second=await stage(db,[resolved],{kind:"receivable",project:PA});
      assert.notEqual(second,first);
      assert.equal((await batch(db,first)).status,"review");
      assert.equal((await batch(db,second)).status,"ready");
      assert.equal(await stage(db,[resolved],{kind:"receivable",project:PA}),second);
      await promote(db,second);
      assert.equal(await stage(db,[resolved],{kind:"receivable",project:PA}),second);
      const cancelled=await stage(db,[contact("RETRY-CANCELLED")]);
      await db.query("select public.cancel_eobra_import($1)",[cancelled]);
      const restarted=await stage(db,[contact("RETRY-CANCELLED")]);
      assert.notEqual(restarted,cancelled);
      assert.equal((await batch(db,cancelled)).status,"cancelled");
      assert.equal((await batch(db,restarted)).status,"ready");
    });
    await t.test("financial totals disclose missing values and project labels normalize whitespace/case",async()=>{
      const incomplete=await stage(db,[title("MISSING-MONEY",{current_amount:null})],{kind:"payable",project:PA});
      const summary=(await batch(db,incomplete)).summary;
      assert.equal(summary.totals_complete,false);assert.equal(summary.totals.original_amount,"100.00");
      assert.equal(summary.totals.current_amount,"0.00");assert.equal(summary.blocked,1);
      const labels=await stage(db,[title("LABEL1",{source_project:"Obra Sintética"}),{...title("LABEL2",{source_project:"  obra   sintética  "}),source_row:3}],{kind:"payable",project:PA,mapping:{single_project_confirmed:true,project_binding:{source_reference:"obra sintética",project_id:PA,confirmed:true}}});
      assert.equal((await batch(db,labels)).summary.totals_complete,true);
      assert.equal((await batch(db,labels)).status,"ready");
    });
    await t.test("direct summary tampering cannot change the reviewed financial totals",async()=>{
      const id=await stage(db,[title("SUMMARY-TAMPER")],{kind:"payable",project:PA});
      const reviewed=await batch(db,id);
      await db.query("update public.integration_import_batches set summary=jsonb_set(summary,'{totals,original_amount}','\"1.00\"'),preview_hash=$2 where id=$1",[id,"f".repeat(64)]);
      const protectedBatch=await batch(db,id);
      assert.equal(protectedBatch.summary.totals.original_amount,"100.00");
      assert.deepEqual(protectedBatch.summary,reviewed.summary);
      assert.equal(protectedBatch.preview_hash,reviewed.preview_hash);
      await promote(db,id,reviewed.preview_hash);
      const imported=await batch(db,id);
      assert.deepEqual(imported.summary,reviewed.summary);
      assert.equal(imported.preview_hash,reviewed.preview_hash);
      assert.equal((await db.query("select amount from public.payables where source_id like '%|SUMMARY-TAMPER'")).rows[0].amount,"100.00");
    });
    await t.test("a native contact created after preview requires a new reviewed reuse decision",async()=>{
      for(const kind of ["supplier","client"]){
        const rows=[contact(`NATIVE-LATE-${kind}`,"Nome da planilha",{tax_id:"99000002000148"})];
        const id=await stage(db,rows,{kind});
        const preview=(await db.query("select target_id,warnings from public.integration_import_rows where batch_id=$1",[id])).rows[0];
        assert.equal(preview.target_id,null);
        const table=kind==="supplier"?"suppliers":"clients";
        const nameColumn=kind==="supplier"?"legal_name":"name";
        const type=kind==="supplier"?"company":"PJ";
        await db.query(`insert into public.${table}(company_id,person_type,${nameColumn},tax_id,status) values($1,$2,'Cadastro nativo tardio','99000002000148','active')`,[A,type]);
        const countBefore=await count(db,table);
        await assert.rejects(promote(db,id),/mudou após a revisão/);
        assert.equal(await count(db,table),countBefore);
        assert.equal((await batch(db,id)).status,"ready");
        const next=await stage(db,rows,{kind});
        assert.notEqual(next,id);
        const revised=(await db.query("select target_id,warnings from public.integration_import_rows where batch_id=$1",[next])).rows[0];
        assert.ok(revised.target_id);
        assert.ok(revised.warnings.some(message=>message.includes("Cadastro nativo tardio")));
        assert.equal((await promote(db,next)).reused,1);
      }
    });
    await t.test("repeated documents for new contacts are blocked before any create/reuse",async()=>{
      for(const [kind,tax] of [["supplier","99000001000101"],["client","99000003000192"]]){
        const table=kind==="supplier"?"suppliers":"clients";
        const before=await count(db,table);
        const id=await stage(db,[contact(`DOC-DUP1-${kind}`,"Primeiro",{tax_id:tax}),{...contact(`DOC-DUP2-${kind}`,"Segundo",{tax_id:tax}),source_row:3}],{kind});
        assert.equal((await batch(db,id)).summary.blocked,2);
        await assert.rejects(promote(db,id),/pendências/);
        assert.equal(await count(db,table),before);
      }
    });
    await t.test("immutable snapshots and canonical source without ledger cannot overwrite",async()=>{
      const id=await stage(db,[contact("IMMUTABLE")]);
      await assert.rejects(db.query("update public.integration_import_rows set normalized_data=jsonb_set(normalized_data,'{name}','\"forged\"') where batch_id=$1",[id]),/imutável/);
      await assert.rejects(db.query("update public.integration_import_batches set company_id=$1 where id=$2",[B,id]),/permissão|policy/);
      await db.query("insert into public.suppliers(company_id,person_type,legal_name,status,source_system,source_id) values($1,'company','Nativo','active','eobra',$2)",[A,`fixture.eobra.com.br|${A}|ORPHAN`]);
      const orphan=await stage(db,[contact("ORPHAN")]);
      assert.equal((await batch(db,orphan)).summary.conflicts,1);
    });
    await t.test("promotion is atomic even if a later canonical constraint fails",async()=>{
      await db.exec("reset role");
      await db.exec("alter table public.suppliers add constraint fixture_canonical_failure check(legal_name<>'FORCE_FAIL')");
      await db.exec("set role authenticated");
      const id=await stage(db,[contact("ROLLBACK1","Before failure"),{...contact("ROLLBACK2","FORCE_FAIL"),source_row:3}]);
      const before=await count(db,"suppliers");
      await assert.rejects(promote(db,id),/fixture_canonical_failure/);
      assert.equal(await count(db,"suppliers"),before);
      assert.equal((await batch(db,id)).status,"ready");
      assert.equal((await db.query("select count(*)::int n from public.integration_import_records where batch_id=$1",[id])).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from public.integration_import_rows where batch_id=$1 and status='ready'",[id])).rows[0].n,2);
    });
    await t.test("cancellation retains staging, has no production effect, and cannot cancel imported batch",async()=>{
      const id=await stage(db,[contact("CANCEL")]);
      const before=await count(db,"suppliers");
      await db.query("select public.cancel_eobra_import($1)",[id]);
      assert.equal((await batch(db,id)).status,"cancelled");
      assert.equal(await count(db,"suppliers"),before);
      await assert.rejects(promote(db,id),/pendências/);
      const imported=(await db.query("select id from public.integration_import_batches where status='imported' limit 1")).rows[0].id;
      await assert.rejects(db.query("select public.cancel_eobra_import($1)",[imported]),/não pode ser cancelado/);
    });
  }finally{await db.close();}
});
