import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { addCommercialMonths } from "./commercial-document-utils.mjs";

const migration = (name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const company = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const user = "11111111-1111-4111-8111-111111111111";
const client = "44444444-4444-4444-8444-444444444444";
const unit = "55555555-5555-4555-8555-555555555555";

function sqlFunction(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert(start >= 0, `Função de produção ${name} não encontrada.`);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end + 3);
}

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table companies(id uuid primary key,created_by uuid);
    create table projects(id uuid primary key,company_id uuid,status text default 'active',code text,name text);
    create table permissions(key text primary key,module text,action text,description text);
    create table roles(id uuid primary key default gen_random_uuid(),key text);
    create table role_permissions(role_id uuid,permission_key text,allowed boolean default true,primary key(role_id,permission_key));
    create function public.has_company_permission(c uuid,p text) returns boolean language sql stable as $$
      select auth.uid() is not null and c=nullif(current_setting('test.company',true),'')::uuid
        and p<>coalesce(current_setting('test.denied',true),'')$$;
    insert into auth.users values('${user}'); insert into companies values('${company}','${user}');
    insert into projects values('${project}','${company}','active','P1','Projeto Teste');
    grant usage on schema auth,public to authenticated;
  `);
  for (const name of [
    "20260722_0002_suppliers_clients.sql", "20260723_0004_flow_sales.sql", "20260723_0005_receivables.sql",
    "20260723_0006_correction_indices.sql", "20260729_0051_commercial_proposals.sql", "20260729_0051a_commercial_proposals_runtime_fix.sql",
  ]) await db.exec(migration(name));
  await db.exec(`
    create table commercial_brokers(id uuid primary key,company_id uuid,name text,status text,updated_at timestamptz default now());
    alter table commercial_proposals add column broker_id uuid;
    alter table sales add column broker_id uuid,add column correction_start_month integer not null default 4;
    alter table receivables add column correction_locked boolean default false,
      add column correction_reference_month date,add column correction_reference_value numeric,
      add column installment_interest_amount numeric default 0,add column correction_amount numeric default 0,
      add column late_fee_amount numeric default 0,add column other_accrual_amount numeric default 0,
      add column discount_amount numeric default 0,add column adjusted_amount numeric default 0;
  `);
  await db.exec(sqlFunction(migration("20260723_0008_automatic_cub_correction.sql"), "receivable_month_distance"));
  await db.exec(sqlFunction(migration("20260723_0013_open_receivables_use_latest_cub.sql"), "set_receivable_automatic_correction"));
  await db.exec("create trigger receivables_automatic_correction before insert or update on receivables for each row execute function public.set_receivable_automatic_correction();");
  await db.exec(migration("20261117155428_elos_ia_document_commercial.sql"));
  await db.exec(`
    select set_config('test.uid','${user}',false),set_config('test.company','${company}',false),set_config('test.denied','',false);
    insert into clients(id,company_id,name,person_type,tax_id,status,updated_at) values('${client}','${company}','Comprador','PF','123.456.789-01','active','2026-01-01T00:00:00Z');
    insert into units(id,company_id,project_id,code,status,list_price,updated_at) values('${unit}','${company}','${project}','101','available',1100,'2026-01-01T00:00:00Z');
    create function test_confirm(c uuid,p uuid,payload jsonb) returns jsonb language sql security definer set search_path='' as $$select public.ai_create_sale_from_document(c,p,payload)$$;
    revoke all on function test_confirm(uuid,uuid,jsonb) from public,anon;
    grant execute on function test_confirm(uuid,uuid,jsonb) to authenticated;
  `);
  return db;
}

function payload() {
  return {
    unitId: unit, expectedUnitUpdatedAt: "2026-01-01T00:00:00Z", clientId: client,
    expectedClientUpdatedAt: "2026-01-01T00:00:00Z", clientTaxId: "12345678901", documentClientName: "Comprador", newClient: null,
    saleDate: "2026-01-10", contractNumber: "CT-101", totalAmount: 1100, listPrice: 1100, commissionPct: 0,
    brokerName: null, brokerId: null, expectedBrokerUpdatedAt: null, correctionStartMonth: null,
    paymentItems: [
      { category: "entry", description: "Entrada", installmentCount: 1, firstDueDate: "2026-01-10", intervalMonths: 0, amountPerInstallment: 100, correctionIndexId: null, correctionIndexLabel: null, correctionIndexUpdatedAt: null, interestRateMonthly: null, paymentMethod: "PIX", notes: "Forma de pagamento: PIX.", total: 100 },
      { category: "monthly", description: "Mensais", installmentCount: 10, firstDueDate: "2026-01-31", intervalMonths: 1, amountPerInstallment: 100, correctionIndexId: null, correctionIndexLabel: null, correctionIndexUpdatedAt: null, interestRateMonthly: null, paymentMethod: null, notes: null, total: 1000 },
    ], notes: "Contrato de teste", expectedCompetingProposals: [], unsupportedClauses: [],
  };
}

async function execute(db, value) {
  return (await db.query("select test_confirm($1,$2,$3::jsonb) result", [company, project, JSON.stringify(value)])).rows[0].result;
}

function preview(value) {
  const installments = value.paymentItems.flatMap(item => Array.from({ length: item.installmentCount }, (_, i) => ({
    category: item.category, description: item.description, sequenceNumber: i + 1, sequenceTotal: item.installmentCount,
    dueDate: addCommercialMonths(item.firstDueDate, i * item.intervalMonths), amount: item.amountPerInstallment,
    correctionIndexLabel: item.correctionIndexLabel, interestRateMonthly: item.interestRateMonthly, paymentMethod: item.paymentMethod,
  })));
  return {
    kind: "commercial_sale_create", blocked: false, blockReason: null, sourceFile: "Contrato.pdf",
    project: { id: project, label: "P1 · Projeto Teste" }, unit: { id: unit, code: "101", tower: null, status: "available" },
    client: { id: client, name: "Comprador", taxId: "12345678901", personType: "PF", isNew: false, details: {} },
    saleDate: value.saleDate, contractNumber: value.contractNumber, totalAmount: value.totalAmount,
    listPrice: value.listPrice, discountAmount: 0, commissionPct: 0, brokerName: null, correctionStartMonth: null,
    paymentItems: value.paymentItems, installments, notes: value.notes, unsupportedClauses: [], competingProposals: [],
    effects: ["Registrar a proposta comercial do contrato, aprová-la e convertê-la em venda.",
      "Criar 11 título(s) a receber em aberto, com os valores nominais e vencimentos mostrados.",
      "Alterar a unidade 101 de disponível para vendida.", "Preservar o documento de origem no histórico da ação confirmada."],
    warnings: ["As parcelas serão criadas em aberto. Esta ação não registra recebimento, não emite boleto e não envia cobrança.",
      "A forma de pagamento será preservada nas observações de cada série e título, conforme os campos existentes no módulo."],
  };
}

test("o banco compara cartão canônico, parcelas e efeitos; preview enganoso é recusado", async () => {
  const db = await setup();
  try {
    const value = payload(); const review = preview(value);
    const validate = (shown) => db.query("select ai_validate_sale_document_preview($1,$2,$3::jsonb,$4::jsonb) ok", [company, project, JSON.stringify(value), JSON.stringify(shown)]);
    assert.equal((await validate(review)).rows[0].ok, true);
    for (const mutate of [
      shown => { shown.totalAmount = 1; },
      shown => { shown.client.name = "Outro comprador"; },
      shown => { shown.unit.code = "999"; },
      shown => { shown.paymentItems[1].total = 0; },
      shown => { shown.installments[2].dueDate = "2099-02-28"; },
      shown => { shown.effects = ["Somente salvar rascunho, sem gerar títulos."]; },
      shown => { shown.warnings = []; },
    ]) {
      const spoof = structuredClone(review); mutate(spoof);
      await assert.rejects(validate(spoof), /revisão exibida diverge/);
    }
    assert.equal((await db.query("select count(*)::int n from sales")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("venda documental usa aprovação/conversão oficiais e preserva entrada em aberto", async () => {
  const db = await setup();
  try {
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select ai_create_sale_from_document($1,$2,$3::jsonb)", [company, project, JSON.stringify(payload())]), /permission denied/);
    const result = await execute(db, payload());
    assert.equal(result.receivables_count, 11);
    const sale = (await db.query("select * from sales where id=$1", [result.sale_id])).rows[0];
    assert.equal(sale.client_id, client); assert.equal(Number(sale.total_amount), 1100); assert.equal(sale.status, "active");
    const titles = (await db.query("select * from receivables where sale_id=$1 order by due_date", [result.sale_id])).rows;
    assert.equal(titles.length, 11); assert(titles.every(row => row.status === "open" && row.paid_at === null));
    assert.equal(titles[0].notes, "Forma de pagamento: PIX.");
    assert.equal(titles[2].due_date.toISOString().slice(0, 10), "2026-02-28");
    assert.equal(titles[3].due_date.toISOString().slice(0, 10), "2026-03-31");
    assert.equal((await db.query("select status from units where id=$1", [unit])).rows[0].status, "sold");
    assert.equal((await db.query("select status from commercial_proposals where id=$1", [result.commercial_proposal_id])).rows[0].status, "converted");
  } finally { await db.close(); }
});

test("correção real conserva FK e calcula CUB; índice textual sozinho não é aceito", async () => {
  const db = await setup();
  try {
    const index = (await db.query("select id,code,updated_at::text from correction_indices where company_id=$1 and code='CUB-SC'", [company])).rows[0];
    await db.query("insert into correction_index_values(company_id,correction_index_id,reference_month,value,created_by) values($1,$2,'2026-01-01',1000,$3),($1,$2,'2026-02-01',1100,$3)", [company, index.id, user]);
    const value = payload(); value.correctionStartMonth = 0;
    Object.assign(value.paymentItems[1], { correctionIndexId: index.id, correctionIndexLabel: index.code, correctionIndexUpdatedAt: index.updated_at });
    const result = await execute(db, value);
    const row = (await db.query("select correction_index_id,adjustment_index,amount,adjusted_amount from receivables where sale_id=$1 and category='monthly' limit 1", [result.sale_id])).rows[0];
    assert.equal(row.correction_index_id, index.id); assert.equal(row.adjustment_index, "CUB-SC");
    assert.equal(Number(row.amount), 100); assert.equal(Number(row.adjusted_amount), 110);
  } finally { await db.close(); }
});

test("permissão revogada, cláusula impedida, diferença de total e índice incompleto revertem sem efeitos", async () => {
  const db = await setup();
  try {
    await db.exec("select set_config('test.denied','commercial.proposals.approve',false)");
    await assert.rejects(execute(db, payload()), /Sem permissão/);
    await db.exec("select set_config('test.denied','',false)");
    const clause = payload(); clause.unsupportedClauses = ["Permuta"];
    await assert.rejects(execute(db, clause), /cláusulas pendentes/);
    const total = payload(); total.totalAmount = 1099;
    await assert.rejects(execute(db, total), /somar exatamente/);
    const interest = payload(); interest.paymentItems[1].interestRateMonthly = 0.59;
    await assert.rejects(execute(db, interest), /Juros mensais/);
    const textOnly = payload(); textOnly.paymentItems[1].correctionIndexLabel = "CUB-SC";
    await assert.rejects(execute(db, textOnly), /índice textual/);
    assert.equal((await db.query("select count(*)::int n from sales")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from commercial_proposals")).rows[0].n, 0);
    assert.equal((await db.query("select status from units where id=$1", [unit])).rows[0].status, "available");
  } finally { await db.close(); }
});

test("novo cliente só é inserido na confirmação e perde autorização se clients.manage for revogada", async () => {
  const db = await setup();
  try {
    const value = payload(); value.clientId = null; value.expectedClientUpdatedAt = null; value.clientTaxId = "98765432100";
    value.newClient = { name: "Novo comprador", personType: "PF", taxId: "98765432100", email: "teste@example.invalid", address: "Rua teste, 10" };
    await db.exec("select set_config('test.denied','clients.manage',false)");
    await assert.rejects(execute(db, value), /Sem permissão para cadastrar/);
    assert.equal((await db.query("select count(*)::int n from clients")).rows[0].n, 1);
    await db.exec("select set_config('test.denied','',false)");
    const result = await execute(db, value);
    const saved = (await db.query("select name,tax_id,address,email from clients where id=$1", [result.client_id])).rows[0];
    assert.deepEqual(saved, { name: "Novo comprador", tax_id: "98765432100", address: "Rua teste, 10", email: "teste@example.invalid" });
  } finally { await db.close(); }
});

test("mudança da unidade, cliente, concorrência ou vínculo de empresa impede confirmar cartão antigo", async () => {
  const db = await setup();
  try {
    const stale = payload(); stale.expectedUnitUpdatedAt = "2025-01-01T00:00:00Z";
    await assert.rejects(execute(db, stale), /unidade mudou/);
    const wrongClient = payload(); wrongClient.clientTaxId = "98765432100";
    await assert.rejects(execute(db, wrongClient), /cliente mudou/);
    const otherCompany = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await assert.rejects(db.query("select test_confirm($1,$2,$3::jsonb)", [otherCompany, project, JSON.stringify(payload())]), /Sem permissão/);
    await db.query("insert into commercial_proposals(company_id,project_id,unit_id,client_id,number,proposal_date,valid_until,proposed_amount,created_by) values($1,$2,$3,$4,'OUTRA',current_date,current_date,1100,$5)", [company, project, unit, client, user]);
    await assert.rejects(execute(db, payload()), /propostas concorrentes mudaram/);
    assert.equal((await db.query("select count(*)::int n from sales")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("falha dentro da conversão oficial reverte cliente, proposta, venda, títulos e unidade", async () => {
  const db = await setup();
  try {
    const value = payload(); value.clientId = null; value.expectedClientUpdatedAt = null; value.clientTaxId = "98765432100";
    value.newClient = { name: "Não deve ficar salvo", personType: "PF", taxId: "98765432100" };
    await db.exec("create function reject_title_for_test() returns trigger language plpgsql as $$begin raise exception 'Falha simulada no domínio'; end;$$; create trigger reject_title_for_test before insert on receivables for each row execute function reject_title_for_test();");
    await assert.rejects(execute(db, value), /Falha simulada no domínio/);
    for (const table of ["sales", "commercial_proposals", "commercial_proposal_payment_items", "receivables"]) {
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0);
    }
    assert.equal((await db.query("select count(*)::int n from clients")).rows[0].n, 1);
    assert.equal((await db.query("select status from units where id=$1", [unit])).rows[0].status, "available");
  } finally { await db.close(); }
});
