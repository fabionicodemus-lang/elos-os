import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration0=readFileSync(new URL("../../supabase/migrations/20261014100000_elos_ia_safe_write.sql",import.meta.url),"utf8");
const migration1=readFileSync(new URL("../../supabase/migrations/20261014100100_elos_ia_safe_write_attachment_link.sql",import.meta.url),"utf8");
const migration2=readFileSync(new URL("../../supabase/migrations/20261014100200_elos_ia_safe_write_execute.sql",import.meta.url),"utf8");

async function setup(){
  const db=new PGlite();
  const uid="11111111-1111-4111-8111-111111111111",company="22222222-2222-4222-8222-222222222222",project="33333333-3333-4333-8333-333333333333";
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.projects(id uuid primary key,company_id uuid not null references companies(id));
    create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$select target_company_id=nullif(current_setting('test.company',true),'')::uuid and coalesce(nullif(current_setting('test.allowed',true),''),'true')='true'$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
    grant usage on schema public,auth,storage to authenticated;
    insert into auth.users values('${uid}'); insert into companies values('${company}'); insert into projects values('${project}','${company}');

    create or replace function public.save_procurement_material_supplier_offer(uuid,uuid,uuid,uuid,text,date,date,text,integer,text,text,text,jsonb)
      returns uuid language sql as $$select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid$$;
    create or replace function public.save_execution_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb,boolean)
      returns uuid language sql as $$select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid$$;
  `);
  await db.exec(migration0);await db.exec(migration1);await db.exec(migration2);
  await db.exec(`select set_config('test.uid','${uid}',false),set_config('test.company','${company}',false),set_config('test.allowed','true',false); set role authenticated;`);
  return {db,uid,company,project};
}

test("safe write força permissão pelo tipo, executa uma vez e mantém idempotência",async()=>{
  const {db,uid,company,project}=await setup();
  try{
    const proposal=(await db.query(`insert into ai_action_proposals(company_id,project_id,turn_id,persona,action_type,required_permission,title,payload,preview,created_by)
      values($1,$2,gen_random_uuid(),'engenharia','procurement_supplier_offer','spoof','Fornecedor X',$3::jsonb,$4::jsonb,$5) returning id,required_permission`,[
      company,project,JSON.stringify({quotationId:"44444444-4444-4444-8444-444444444444",supplierId:"55555555-5555-4555-8555-555555555555",proposalNumber:null,proposalDate:null,validityDate:null,paymentTerms:null,deliveryDays:null,freightTerms:null,warrantyTerms:null,notes:null,items:[]}),JSON.stringify({blocked:false}),uid,
    ])).rows[0];
    assert.equal(proposal.required_permission,"procurement.quotations.manage");
    const first=(await db.query(`select ai_execute_action_proposal($1) result`,[proposal.id])).rows[0].result;
    assert.equal(first.offer_id,"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const second=(await db.query(`select ai_execute_action_proposal($1) result`,[proposal.id])).rows[0].result;
    assert.deepEqual(second,first);
    const status=(await db.query(`select status,executed_by from ai_action_proposals where id=$1`,[proposal.id])).rows[0];
    assert.equal(status.status,"executed");assert.equal(status.executed_by,uid);
  }finally{await db.close();}
});

test("safe write bloqueia proposta sinalizada e não executa domínio",async()=>{
  const {db,uid,company,project}=await setup();
  try{
    const proposal=(await db.query(`insert into ai_action_proposals(company_id,project_id,turn_id,persona,action_type,required_permission,title,payload,preview,created_by)
      values($1,$2,gen_random_uuid(),'engenharia','execution_contract_measurement','x','Medição',$3::jsonb,$4::jsonb,$5) returning id`,[
      company,project,JSON.stringify({contractId:"66666666-6666-4666-8666-666666666666",periodStart:"2026-10-01",periodEnd:"2026-10-10",taxWithholding:0,advanceDeduction:0,otherDiscount:0,notes:null,contractorNotes:null,items:[]}),JSON.stringify({blocked:true,blockReason:"Ultrapassa o contrato."}),uid,
    ])).rows[0];
    await assert.rejects(db.query(`select ai_execute_action_proposal($1)`,[proposal.id]),/Ultrapassa o contrato/);
    const status=(await db.query(`select status from ai_action_proposals where id=$1`,[proposal.id])).rows[0].status;
    assert.equal(status,"pending_review");
  }finally{await db.close();}
});

test("payload e preview preparados são imutáveis",async()=>{
  const {db,uid,company,project}=await setup();
  try{
    const proposal=(await db.query(`insert into ai_action_proposals(company_id,project_id,turn_id,persona,action_type,required_permission,title,payload,preview,created_by)
      values($1,$2,gen_random_uuid(),'engenharia','procurement_supplier_offer','x','Teste','{}','{}',$3) returning id`,[company,project,uid])).rows[0];
    await db.exec(`reset role;`);
    await assert.rejects(db.query(`update ai_action_proposals set payload='{"alterado":true}'::jsonb where id=$1`,[proposal.id]),/imutável/);
  }finally{await db.close();}
});
