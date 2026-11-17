import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), project = id(2), user = id(9), unit = id(20);
const read = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.projects(id uuid primary key,company_id uuid not null);
    create function public.has_company_permission(uuid,text) returns boolean language sql stable as $$
      select auth.uid() is not null and $1=nullif(current_setting('test.company',true),'')::uuid
      and coalesce(current_setting('test.denied',true),'') not in ('all',$2)
    $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
    insert into auth.users values('${user}'),('${id(19)}');
    insert into companies values('${company}'),('${id(11)}');
    insert into projects values('${project}','${company}'),('${id(12)}','${id(11)}');
    grant usage on schema public,auth,storage to authenticated;
    grant select on companies,projects to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
    create table public.test_business_records(id uuid primary key default gen_random_uuid(),company_id uuid,payload jsonb);
    grant select on test_business_records to authenticated;
    -- Domain-specific suites exercise real business RPCs. These stand-ins isolate
    -- the proposal lifecycle, authorization, retention and transaction boundary.
    create function public.ai_create_sale_from_document(uuid,uuid,jsonb) returns jsonb language plpgsql as $$
      declare saved uuid; begin
        insert into public.test_business_records(company_id,payload) values($1,$3) returning id into saved;
        if coalesce(($3->>'forceFail')::boolean,false) then raise exception 'Falha de domínio após primeira escrita'; end if;
        return jsonb_build_object('kind','commercial_sale_create','sale_id',saved);
      end;
    $$;
    create function public.ai_create_quotation_from_document(uuid,uuid,jsonb) returns jsonb language sql as $$select public.ai_create_sale_from_document($1,$2,$3)$$;
    create function public.ai_create_service_contract_from_document(uuid,uuid,jsonb) returns jsonb language sql as $$select public.ai_create_sale_from_document($1,$2,$3)$$;
    create function public.ai_validate_sale_document_preview(uuid,uuid,jsonb,jsonb) returns boolean language sql as $$select $3->'total'=$4->'total'$$;
    create function public.ai_validate_procurement_document_preview(uuid,uuid,text,jsonb,jsonb) returns boolean language sql as $$select $4->'total'=$5->'total'$$;
  `);
  for (const file of [
    "20261014100000_elos_ia_safe_write.sql",
    "20261014100100_elos_ia_safe_write_attachment_link.sql",
    "20261014110000_elos_ia_financeiro.sql",
    "20261117155420_elos_ia_document_action_foundation.sql",
    "20261117155439_elos_ia_document_execution.sql",
  ]) await db.exec(read(file));
  await db.exec(`select set_config('test.uid','${user}',false),set_config('test.company','${company}',false),set_config('test.denied','',false); set role authenticated;`);
  return db;
}

async function upload(db, { hash = "a".repeat(64), turn = crypto.randomUUID(), fileName = "Contrato.pdf" } = {}) {
  const path = `${company}/${user}/${crypto.randomUUID()}.pdf`;
  await db.query("insert into storage.objects(bucket_id,name) values('ai-action-attachments',$1)", [path]);
  const result = await db.query("insert into ai_action_attachments(company_id,project_id,turn_id,uploaded_by,storage_path,file_name,mime_type,file_size,content_sha256) values($1,$2,$3,$4,$5,$6,'application/pdf',100,$7) returning id,expires_at", [company, project, turn, user, path, fileName, hash]);
  return { id: result.rows[0].id, expiresAt: result.rows[0].expires_at, turn, path, fileName };
}

async function prepare(db, file, { payload = { unitId: unit, total: 500000 }, previewTotal = payload.total, blocked = false, documentKey = unit } = {}) {
  const preview = { kind: "commercial_sale_create", sourceFile: file.fileName, total: previewTotal, blocked, blockReason: blocked ? "Cláusula não representada" : null };
  const result = await db.query("select ai_prepare_document_action($1,$2,$3,'diretoria','commercial_sale_create','Título',$4,$5::jsonb,$6::jsonb,$7,$8) result", [company, project, file.turn, "Resumo", JSON.stringify(payload), JSON.stringify(preview), file.fileName, documentKey]);
  return result.rows[0].result;
}
const execute = (db, proposal) => db.query("select ai_execute_document_action_proposal($1) result", [proposal.id]);
const countBusiness = async db => (await db.query("select count(*)::int n from test_business_records")).rows[0].n;

test("preparar não cria negócio; confirmar grava uma vez e retém a fonte na mesma transação", async () => {
  const db = await setup();
  try {
    const file = await upload(db), proposal = await prepare(db, file);
    assert.equal(await countBusiness(db), 0);
    const pending = (await db.query("select status,expires_at from ai_action_proposals where id=$1", [proposal.id])).rows[0];
    assert.equal(pending.status, "pending_review"); assert.equal(String(pending.expires_at), String(file.expiresAt));
    const first = (await execute(db, proposal)).rows[0].result;
    assert.equal(await countBusiness(db), 1); assert.equal(first.source_proposal_id, proposal.id);
    assert.deepEqual((await execute(db, proposal)).rows[0].result, first);
    assert.equal(await countBusiness(db), 1);
    const source = (await db.query("select retained_at,expires_at from ai_action_attachments where id=$1", [file.id])).rows[0];
    assert.ok(source.retained_at); assert.equal(source.expires_at, null);
    await db.query("delete from storage.objects where name=$1", [file.path]);
    assert.equal((await db.query("select count(*)::int n from storage.objects where name=$1", [file.path])).rows[0].n, 1);
  } finally { await db.close(); }
});

test("prévia divergente, chave falsa e bloqueios não produzem registros", async () => {
  const db = await setup();
  try {
    const file = await upload(db);
    await assert.rejects(prepare(db, file, { previewTotal: 1 }), /não corresponde/);
    await assert.rejects(prepare(db, file, { documentKey: "chave inventada" }), /identificação/);
    assert.equal((await db.query("select count(*)::int n from ai_action_proposals")).rows[0].n, 0);
    const proposal = await prepare(db, file, { blocked: true });
    await assert.rejects(execute(db, proposal), /Cláusula não representada/);
    assert.equal(await countBusiness(db), 0);
  } finally { await db.close(); }
});

test("falha parcial do módulo reverte negócio, confirmação e retenção", async () => {
  const db = await setup();
  try {
    const file = await upload(db), proposal = await prepare(db, file, { payload: { unitId: unit, total: 500000, forceFail: true } });
    await assert.rejects(execute(db, proposal), /Falha de domínio/);
    assert.equal(await countBusiness(db), 0);
    assert.equal((await db.query("select status from ai_action_proposals where id=$1", [proposal.id])).rows[0].status, "pending_review");
    assert.equal((await db.query("select retained_at from ai_action_attachments where id=$1", [file.id])).rows[0].retained_at, null);
  } finally { await db.close(); }
});

test("arquivo repetido não cria cartão concorrente e pode ser corrigido depois de descartado", async () => {
  const db = await setup();
  try {
    const firstFile = await upload(db), first = await prepare(db, firstFile), repeatedFile = await upload(db);
    await assert.rejects(prepare(db, repeatedFile), /já possui/);
    await assert.rejects(prepare(db, firstFile), /já está vinculado/);
    await db.query("select ai_reject_action_proposal($1)", [first.id]);
    const second = await prepare(db, repeatedFile);
    assert.notEqual(first.id, second.id);
    await execute(db, second);
    await assert.rejects(prepare(db, await upload(db)), /já possui/);
    assert.equal(await countBusiness(db), 1);
  } finally { await db.close(); }
});

test("permissão revogada bloqueia execução, replay, descarte e leitura direta da fonte", async () => {
  const db = await setup();
  try {
    const file = await upload(db), proposal = await prepare(db, file);
    await db.query("select set_config('test.denied','commercial.proposals.convert',false)");
    await assert.rejects(execute(db, proposal), /permissão/);
    await assert.rejects(db.query("select ai_reject_action_proposal($1)", [proposal.id]), /permissão/);
    assert.equal((await db.query("select count(*)::int n from ai_action_proposals where id=$1", [proposal.id])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from storage.objects where name=$1", [file.path])).rows[0].n, 0);
    await db.query("select set_config('test.denied','',false)"); await execute(db, proposal);
    await db.query("select set_config('test.company',$1,false)", [id(11)]);
    await assert.rejects(execute(db, proposal), /permissão/);
    assert.equal((await db.query("select count(*)::int n from ai_action_attachments where id=$1", [file.id])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from storage.objects where name=$1", [file.path])).rows[0].n, 0);
  } finally { await db.close(); }
});

test("endpoints legados e inserts diretos não falsificam confirmação ou substituem a fonte", async () => {
  const db = await setup();
  try {
    const file = await upload(db), proposal = await prepare(db, file), secondFile = await upload(db, { hash: "b".repeat(64) });
    await assert.rejects(db.query("insert into ai_action_proposals(company_id,project_id,turn_id,persona,action_type,required_permission,title,payload,preview,created_by,status,result) values($1,$2,$3,'diretoria','commercial_sale_create','x','Falsa','{}','{}',$4,'executed','{}')", [company, project, crypto.randomUUID(), user]), /row-level security/);
    for (const [sql, args] of [
      ["select ai_claim_action_proposal($1)", [proposal.id]],
      ["select ai_finish_action_proposal($1,'{}')", [proposal.id]],
      ["select ai_fail_action_proposal($1,'erro')", [proposal.id]],
      ["select ai_link_action_attachment($1,$2,$3)", [file.turn, proposal.id, file.fileName]],
      ["select ai_link_action_attachments($1,$2)", [file.turn, proposal.id]],
      ["select ai_create_sale_from_document($1,$2,'{}')", [company, project]],
    ]) await assert.rejects(db.query(sql, args));
    await assert.rejects(db.query("insert into ai_action_attachments(company_id,turn_id,uploaded_by,storage_path,file_name,proposal_id) values($1,$2,$3,$4,'Outro.pdf',$5)", [company, secondFile.turn, user, `${company}/${user}/inventado.pdf`, proposal.id]), /row-level security/);
    await execute(db, proposal);
    await assert.rejects(db.query("select ai_execute_action_proposal($1)", [proposal.id]), /executor específico/);
    assert.equal(await countBusiness(db), 1);
  } finally { await db.close(); }
});

test("metadados não apontam a arquivo nem obra de outra empresa e documento permanece imutável", async () => {
  const db = await setup();
  try {
    await assert.rejects(db.query("insert into ai_action_attachments(company_id,project_id,turn_id,uploaded_by,storage_path,file_name) values($1,$2,$3,$4,$5,'Estranho.pdf')", [company, project, crypto.randomUUID(), user, `${id(11)}/${id(19)}/outro.pdf`]), /row-level security/);
    await assert.rejects(db.query("insert into ai_action_attachments(company_id,project_id,turn_id,uploaded_by,storage_path,file_name) values($1,$2,$3,$4,$5,'Estranho.pdf')", [company, id(12), crypto.randomUUID(), user, `${company}/${user}/outro.pdf`]), /row-level security/);
    const file = await upload(db), proposal = await prepare(db, file);
    await db.exec("reset role");
    await assert.rejects(db.query("update ai_action_proposals set preview='{\"total\":1}' where id=$1", [proposal.id]), /imutável/);
    await assert.rejects(db.query("update ai_action_attachments set storage_path='outro' where id=$1", [file.id]), /imutável/);
    await assert.rejects(db.query("update ai_action_attachments set content_sha256=$1 where id=$2", ["b".repeat(64), file.id]), /imutável/);
  } finally { await db.close(); }
});
