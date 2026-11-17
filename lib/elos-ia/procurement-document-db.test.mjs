import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../../", import.meta.url));
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const candidate = fileURLToPath(new URL(specifier, context.parentURL));
    if (candidate.startsWith(root) && !extname(candidate)) {
      const extension = [".ts", ".mjs"].find(value => existsSync(candidate + value));
      if (extension) return next(pathToFileURL(candidate + extension).href, context);
    }
  }
  return next(specifier, context);
} });
const { runProcurementDocumentTool, procurementDocumentToolsForPersona } = await import("./procurement-document-tools.ts");

const read = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = read("20261117155434_elos_ia_document_procurement.sql");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const updated = "2026-11-17T12:00:00Z";
function fn(file, name) {
  const source = read(file), start = source.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf("$$;", start);
  assert.ok(end > start, name);
  return source.slice(start, end + 3);
}
async function insert(db, table, values) {
  const columns = (await db.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1 and is_nullable='NO' and column_default is null and is_generated='NEVER'", [table])).rows;
  const data = { ...values };
  for (const column of columns) if (!(column.column_name in data)) data[column.column_name] = column.data_type === "uuid" ? id(9) : column.data_type === "date" ? "2026-11-17" : column.data_type === "boolean" ? false : ["integer", "bigint", "numeric"].includes(column.data_type) ? 1 : column.data_type === "jsonb" ? {} : "Teste";
  const names = Object.keys(data);
  await db.query(`insert into public.${table}(${names.join(",")}) values(${names.map((_, index) => `$${index + 1}`).join(",")})`, Object.values(data));
}
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create function public.has_company_permission(uuid,text) returns boolean language sql stable as $$select auth.uid() is not null and $1='${id(1)}'::uuid and coalesce(current_setting('test.denied',true),'')<>$2$$;
    create table public.projects(id uuid primary key,company_id uuid,status text default 'active',code text default 'DEMO',name text default 'Obra demo');
    create table public.suppliers(id uuid primary key,company_id uuid,status text default 'active',legal_name text,trade_name text,tax_id text default '12345678000199',updated_at timestamptz);
    create table public.profiles(id uuid primary key,full_name text);
    select set_config('test.user','${id(9)}',false);
    insert into projects(id,company_id) values('${id(2)}','${id(1)}');
    insert into suppliers(id,company_id,legal_name,updated_at) values('${id(3)}','${id(1)}','Fornecedor','${updated}');
    insert into profiles values('${id(9)}','Revisor');
  `);
  // Use the domain's real table constraints and real RPC bodies. Foreign-key
  // infrastructure outside these two domains is omitted from this isolated fixture.
  for (const file of ["20260728_0033_execution_material_requests.sql", "20260729_0041_procurement_material_quotations.sql", "20260728_0038_execution_service_contracts.sql", "20260801_0067_service_contract_procurement.sql"]) {
    for (const match of read(file).matchAll(/create table if not exists public\.\w+\s*\([\s\S]*?\n\);/g)) {
      await db.exec(match[0].replace(/ references (?:public|auth)\.\w+\(id\)(?: on delete (?:cascade|restrict|set null))?/g, ""));
    }
  }
  await db.exec(`alter table execution_material_request_items add column stock_fulfilled_quantity numeric not null default 0, add column cost_center_service_id uuid;
    alter table procurement_material_quotations add column is_historical boolean not null default false,add column original_date date,add column history_reason text;
    alter table execution_service_contracts add column source_request_id uuid,add column source_competition_id uuid;
    create unique index on execution_service_contracts(source_competition_id) where source_competition_id is not null;`);
  for (const [file, name] of [
    ["20261018164938_brisa_quotation_refresh_aliases.sql", "refresh_procurement_material_quotation"],
    ["20261018234844_brisa_usability_complete.sql", "save_procurement_material_quotation_v2"],
    ["20260729_0041_procurement_material_quotations.sql", "open_procurement_material_quotation"],
    ["20260729_0041a_procurement_material_quotation_offer_fix.sql", "save_procurement_material_supplier_offer"],
    ["20260728_0038_execution_service_contracts.sql", "refresh_execution_service_contract_value"],
    ["20260801_0067_service_contract_procurement.sql", "generate_execution_service_contract_from_competition"],
    ["20260801_0067_service_contract_procurement.sql", "block_direct_execution_contract_insert"],
  ]) await db.exec(fn(file, name));
  await db.exec("create trigger execution_contract_require_competition before insert on execution_service_contracts for each row execute function block_direct_execution_contract_insert()");
  await db.exec(migration);
  const scope = { company_id: id(1), project_id: id(2) };
  await insert(db, "execution_material_requests", { id: id(4), ...scope, request_number: "SM-0001", status: "approved", updated_at: updated });
  await insert(db, "execution_material_request_items", { id: id(5), ...scope, request_id: id(4), input_id: id(6), input_code: "I01", input_name: "Cimento", unit_snapshot: "sc", category_snapshot: "material", cost_center_code: "01", cost_center_name: "Estrutura", requested_quantity: 100, ordered_quantity: 10, stock_fulfilled_quantity: 20, updated_at: updated });
  await insert(db, "execution_service_requests", { id: id(11), ...scope, request_number: "SS-0001", status: "competition", updated_at: updated });
  await insert(db, "execution_service_request_items", { id: id(14), ...scope, request_id: id(11), service_id: id(15), service_code: "S01", service_name: "Pintura", unit_snapshot: "m2", requested_quantity: 20 });
  await insert(db, "execution_service_competitions", { id: id(10), ...scope, request_id: id(11), competition_number: "MC-0001", status: "approved", winner_offer_id: id(12), winner_supplier_id: id(3), updated_at: updated });
  await insert(db, "execution_service_competition_offers", { id: id(12), ...scope, competition_id: id(10), supplier_id: id(3), status: "winner", total_amount: 600, updated_at: updated });
  await insert(db, "execution_service_competition_offer_items", { id: id(13), ...scope, offer_id: id(12), request_item_id: id(14), offered_quantity: 20, unit_price: 30, total_amount: 600, meets_specification: true });
  return db;
}
function quotation() { return { requestId: id(4), requestNumber: "SM-0001", requestUpdatedAt: updated, supplierId: id(3), supplierUpdatedAt: updated, title: "Cimento", awardMode: "item", responseDeadline: "2099-11-20", documentTotal: 220, total: 220, freightTotal: 20, otherTotal: 0, items: [{ request_item_id: id(5), input_id: id(6), code: "I01", name: "Cimento", unit: "sc", costCenter: "01 · Estrutura", expected_updated_at: updated, expected_remaining_quantity: 70, quantity_to_quote: 10, quantity_offered: 10, unit_price: 20, discount_percent: 0, tax_percent: 0, freight_amount: 20, other_cost_amount: 0, meets_specification: false, specificationConfirmed: false, total: 220 }] }; }
function contract() { return { competitionId: id(10), competitionNumber: "MC-0001", competitionUpdatedAt: updated, winnerOfferId: id(12), offerUpdatedAt: updated, supplierId: id(3), supplierUpdatedAt: updated, title: "Pintura", scopeSummary: "Pintura interna", startDate: "2026-12-01", endDate: "2026-12-31", retentionPercent: 5, guaranteePercent: 5, guaranteeMonths: 60, paymentDays: 15, total: 600, items: [{ request_item_id: id(14), offer_item_id: id(13), service_id: id(15), code: "S01", name: "Pintura", unit: "m2", quantity: 20, unit_price: 30, total: 600, stages: [{ code: "ET-01", name: "Execução", measurement_mode: "quantity", weight_percent: 100 }] }] }; }
const call = (db, fn, payload, company = id(1)) => db.query(`select public.${fn}($1,$2,$3::jsonb) as result`, [company, id(2), JSON.stringify(payload)]);

function quotationPreview(payload) {
  return {
    kind: "procurement_quotation_create", blocked: false, module: "Orçamentos de Materiais", sourceFile: "documento.pdf",
    project: { id: id(2), label: "DEMO · Obra demo" }, supplier: { id: id(3), name: "Fornecedor", taxId: "12345678000199" },
    request: { id: id(4), number: "SM-0001" },
    ...Object.fromEntries(["title", "awardMode", "responseDeadline", "desiredDeliveryDate", "paymentTerms", "proposalNumber", "proposalDate", "validityDate", "deliveryAddress", "freightTerms", "warrantyTerms", "notes", "deliveryDays"].map(key => [key, payload[key] ?? null])),
    items: [{ code: "I01", name: "Cimento", unit: "sc", costCenter: "01 · Estrutura", quantity: 10, unitPrice: 20, discountPercent: 0, taxPercent: 0, freight: 20, otherCost: 0, brand: null, manufacturer: null, deliveryDays: null, meetsSpecification: false, specificationConfirmed: false, technicalNotes: null, total: 220 }],
    freightTotal: 20, otherTotal: 0, total: 220,
    effects: ["Criar uma cotação vinculada à solicitação aprovada.", "Abrir a cotação para coleta e registrar esta proposta de fornecedor.", "Manter a escolha de vencedor, pedido de compra e financeiro no fluxo de aprovação."],
    warnings: ["Há itens sem comprovação de atendimento à especificação; eles ficam sem aceite técnico."],
  };
}
function contractPreview(payload) {
  return {
    kind: "execution_contract_create", blocked: false, module: "Contratos e Medições", sourceFile: "documento.pdf",
    project: { id: id(2), label: "DEMO · Obra demo" }, supplier: { id: id(3), name: "Fornecedor", taxId: "12345678000199" },
    competition: { id: id(10), number: "MC-0001", title: "Teste" },
    ...Object.fromEntries(["title", "scopeSummary", "startDate", "endDate", "signedDate", "adjustmentIndex", "adjustmentBaseDate", "contactName", "contactPhone", "contactEmail", "notes", "retentionPercent", "guaranteePercent", "guaranteeMonths", "paymentDays"].map(key => [key, payload[key] ?? null])),
    items: [{ code: "S01", name: "Pintura", location: null, scopeNotes: null, measurementNotes: null, unit: "m2", quantity: 20, unitPrice: 30, total: 600, stages: [{ name: "Execução", description: null, measurementMode: "quantity", weightPercent: 100 }] }], total: 600,
    effects: ["Criar contrato em elaboração a partir do mapa de concorrência já aprovado.", "Registrar escopo, condições e etapas de medição exibidas.", "Ativação, medições, aprovação e financeiro continuam nas etapas próprias."], warnings: [],
  };
}
const validatePreview = async (db, type, payload, preview) => (await db.query("select public.ai_validate_procurement_document_preview($1,$2,$3,$4::jsonb,$5::jsonb) valid", [id(1), id(2), type, JSON.stringify(payload), JSON.stringify(preview)])).rows[0].valid;

// Read through the preparation adapter into the same real domain fixture, then
// capture its sole write request to validate the actual rendered card contract.
function preparationContext(db) {
  const proposals = [];
  const supabase = { async rpc(name, args) {
    assert.equal(name, "ai_prepare_document_action");
    assert.equal(await validatePreview(db, args.p_action_type, args.p_payload, args.p_preview), true);
    proposals.push(args); return { data: { id: id(100), title: args.p_title, summary: args.p_summary }, error: null };
  }, from(table) {
    const filters = []; let single = false, limit = 101;
    const query = {
      select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      order() { return query; }, limit(value) { limit = value; return query; }, maybeSingle() { single = true; return query; },
      then(resolve, reject) { return db.query(`select * from public.${table}`).then(result => {
        const rows = result.rows.filter(row => filters.every(filter => filter(row))).slice(0, limit);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }).then(resolve, reject); },
    }; return query;
  } };
  return { proposals, context: { supabase, companyId: id(1), activeProjectId: id(2), projects: [{ id: id(2), code: "DEMO", name: "Obra demo", status: "active" }], userId: id(9), turnId: id(8), persona: "diretoria", attachmentNames: ["documento.pdf"], today: "2026-11-17", can: () => true, cache: new Map() } };
}

test("cotação usa RPCs reais, mantém collecting e valores; não aprova nem gera pedidos", async () => {
  const db = await setup();
  try {
    const result = (await call(db, "ai_create_quotation_from_document", quotation())).rows[0].result;
    const quote = (await db.query("select status,responses_count,total_awarded_amount from procurement_material_quotations where id=$1", [result.quotation_id])).rows[0];
    assert.equal(quote.status, "collecting"); assert.equal(quote.responses_count, 1); assert.equal(Number(quote.total_awarded_amount), 0);
    assert.equal(Number((await db.query("select total_delivered_cost from procurement_material_quotation_offers where id=$1", [result.offer_id])).rows[0].total_delivered_cost), 220);
    assert.equal((await db.query("select count(*)::int n from procurement_material_quotation_awards")).rows[0].n, 0);
    assert.equal(Number((await db.query("select ordered_quantity from execution_material_request_items where id=$1", [id(5)])).rows[0].ordered_quantity), 10);
  } finally { await db.close(); }
});
test("mudança de saldo, duplicação de item e total divergente impedem gravação integral", async () => {
  const db = await setup();
  try {
    for (const mutate of [payload => { payload.items[0].expected_remaining_quantity = 90; }, payload => { payload.items.push({ ...payload.items[0] }); }, payload => { payload.total = 221; }]) {
      const payload = quotation(); mutate(payload);
      await assert.rejects(call(db, "ai_create_quotation_from_document", payload));
      assert.equal((await db.query("select count(*)::int n from procurement_material_quotations")).rows[0].n, 0);
    }
    await db.exec(`update execution_material_requests set status='requested' where id='${id(4)}'`);
    await assert.rejects(call(db, "ai_create_quotation_from_document", quotation()), /não está aprovada/);
  } finally { await db.close(); }
});
test("erro da RPC de oferta reverte cotação e itens já criados", async () => {
  const db = await setup();
  try {
    const payload = quotation(); payload.items[0].delivery_days = -1;
    await assert.rejects(call(db, "ai_create_quotation_from_document", payload), /check constraint/);
    for (const table of ["procurement_material_quotations", "procurement_material_quotation_items", "procurement_material_quotation_offers"]) assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0);
  } finally { await db.close(); }
});
test("contrato usa geração oficial e preserva rascunho, itens, etapas e vínculo vencedor", async () => {
  const db = await setup();
  try {
    const result = (await call(db, "ai_create_service_contract_from_document", contract())).rows[0].result;
    const saved = (await db.query("select status,current_value,source_competition_id from execution_service_contracts where id=$1", [result.contract_id])).rows[0];
    assert.equal(saved.status, "draft"); assert.equal(Number(saved.current_value), 600); assert.equal(saved.source_competition_id, id(10));
    const stages = (await db.query("select weight_percent,total_value from execution_service_contract_stages where contract_id=$1", [result.contract_id])).rows;
    assert.equal(stages.length, 1); assert.equal(Number(stages[0].weight_percent), 100); assert.equal(Number(stages[0].total_value), 600);
    await assert.rejects(call(db, "ai_create_service_contract_from_document", contract()), /já gerou contrato/);
    assert.equal((await db.query("select count(*)::int n from execution_service_contracts")).rows[0].n, 1);
  } finally { await db.close(); }
});
test("contrato rejeita nova aprovação, valores ou etapas divergentes sem criar registros", async () => {
  const db = await setup();
  try {
    for (const mutate of [payload => { payload.items[0].unit_price = 31; }, payload => { payload.items[0].stages[0].weight_percent = 70; }, payload => { payload.supplierId = id(99); }, payload => { payload.competitionUpdatedAt = "2026-11-16T12:00:00Z"; }]) {
      const payload = contract(); mutate(payload);
      await assert.rejects(call(db, "ai_create_service_contract_from_document", payload));
      assert.equal((await db.query("select count(*)::int n from execution_service_contracts")).rows[0].n, 0);
    }
    await db.exec(`update execution_service_competitions set status='analysis' where id='${id(10)}'`);
    await assert.rejects(call(db, "ai_create_service_contract_from_document", contract()), /mapa aprovado/);
  } finally { await db.close(); }
});
test("helpers não são executáveis por authenticated e revalidam empresa/permissão", async () => {
  const db = await setup();
  try {
    await assert.rejects(call(db, "ai_create_quotation_from_document", quotation(), id(99)), /Sem permissão/);
    await db.exec("select set_config('test.denied','execution.contract_procurement.contract',false)");
    await assert.rejects(call(db, "ai_create_service_contract_from_document", contract()), /Sem permissão/);
    await db.exec("grant usage on schema public,auth to authenticated; set role authenticated");
    await assert.rejects(call(db, "ai_create_quotation_from_document", quotation()), /permission denied for function/);
    await assert.rejects(call(db, "ai_create_service_contract_from_document", contract()), /permission denied for function/);
    await assert.rejects(validatePreview(db, "procurement_quotation_create", quotation(), quotationPreview(quotation())), /permission denied for function/);
  } finally { await db.close(); }
});

test("cotação rejeita cartão falso mesmo com payload de domínio válido", async () => {
  const db = await setup();
  try {
    const payload = quotation(), preview = quotationPreview(payload);
    assert.equal(await validatePreview(db, preview.kind, payload, preview), true);
    for (const mutate of [
      row => { row.total = 1; }, row => { row.paymentTerms = "Não será lançado"; }, row => { row.items[0].quantity = 1; },
      row => { row.supplier.name = "Fornecedor diferente"; }, row => { row.supplier.id = id(99); }, row => { row.project.label = "Outra obra"; },
      row => { row.request.number = "SM-9999"; }, row => { row.items[0].technicalNotes = "Aprovado"; }, row => { row.items[0].meetsSpecification = true; },
      row => { row.effects = ["Somente leitura, nada será criado."]; }, row => { row.warnings = []; }, row => { delete row.deliveryAddress; },
      row => { row.extra = "Campo que a interface não deve aceitar"; },
    ]) { const changed = structuredClone(preview); mutate(changed); assert.equal(await validatePreview(db, preview.kind, payload, changed), false); }
    const forged = structuredClone(payload); forged.items[0].unit_price = 1;
    assert.equal(await validatePreview(db, preview.kind, forged, preview), false);
    const rounded = structuredClone(payload), misleading = structuredClone(preview);
    rounded.items[0].unit_price = 20.0000001; misleading.items[0].unitPrice = 20.0000001;
    assert.equal(await validatePreview(db, preview.kind, rounded, misleading), false, "do not show precision that the domain would silently round");
    assert.equal((await db.query("select count(*)::int n from procurement_material_quotations")).rows[0].n, 0);
  } finally { await db.close(); }
});
test("contrato rejeita divergência em condições, etapas, identidade e textos revisados", async () => {
  const db = await setup();
  try {
    const payload = contract(), preview = contractPreview(payload);
    assert.equal(await validatePreview(db, preview.kind, payload, preview), true);
    for (const mutate of [
      row => { row.total = 1; }, row => { row.retentionPercent = 0; }, row => { row.paymentDays = 0; },
      row => { row.scopeSummary = "Outro escopo"; }, row => { row.items[0].stages[0].weightPercent = 20; },
      row => { row.items[0].stages[0].description = "Pagar já"; }, row => { row.items[0].scopeNotes = "Texto oculto diferente"; },
      row => { row.supplier.taxId = "00000000000000"; }, row => { row.project.id = id(99); }, row => { row.competition.id = id(99); },
      row => { row.effects = ["Contrato apenas consultado"]; }, row => { delete row.adjustmentIndex; },
    ]) { const changed = structuredClone(preview); mutate(changed); assert.equal(await validatePreview(db, preview.kind, payload, changed), false); }
    const forged = structuredClone(payload); forged.items[0].stages[0].code = "CODIGO-OCULTO";
    assert.equal(await validatePreview(db, preview.kind, forged, preview), false);
    const rounded = structuredClone(payload), misleading = structuredClone(preview);
    rounded.retentionPercent = 5.00001; misleading.retentionPercent = 5.00001;
    assert.equal(await validatePreview(db, preview.kind, rounded, misleading), false);
    await db.exec(`update suppliers set legal_name='Outro nome' where id='${id(3)}'`);
    assert.equal(await validatePreview(db, preview.kind, payload, preview), false);
    assert.equal((await db.query("select count(*)::int n from execution_service_contracts")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("cartões da preparação TypeScript passam validação SQL e executam com os valores revisados", async () => {
  const db = await setup();
  try {
    const { context, proposals } = preparationContext(db);
    const allowed = procurementDocumentToolsForPersona("diretoria");
    // 1.005 is a classic binary half-cent edge; SQL numeric must agree exactly.
    const quote = await runProcurementDocumentTool(context, allowed, "preparar_nova_cotacao_documento", {
      obra: null, solicitacao: "SM-0001", fornecedor_id: id(3), titulo: "Cimento", modo_fechamento: "item", prazo_resposta: "2099-11-20",
      valor_total_documento: 1.01, itens: [{ item_solicitacao_id: id(5), unidade: "sc", quantidade: 1, preco_unitario: 1.005 }],
    });
    assert.equal(quote.acao_preparada, true, quote.erro);
    const quotationResult = (await call(db, "ai_create_quotation_from_document", proposals[0].p_payload)).rows[0].result;
    assert.equal(Number((await db.query("select total_delivered_cost from procurement_material_quotation_offers where id=$1", [quotationResult.offer_id])).rows[0].total_delivered_cost), proposals[0].p_preview.total);
    const contractResult = await runProcurementDocumentTool(context, allowed, "preparar_contrato_empreiteiro_documento", {
      obra: null, concorrencia: "MC-0001", fornecedor_id: id(3), titulo: "Pintura", escopo: "Pintura interna", inicio: "2026-12-01", fim: "2026-12-31",
      retencao_percentual: 5, garantia_percentual: 5, garantia_meses: 60, prazo_pagamento_dias: 15, valor_total_documento: 600,
      itens: [{ item_solicitacao_id: id(14), unidade: "m2", quantidade: 20, preco_unitario: 30, etapas: [{ nome: "Execução", modo_medicao: "quantity", peso_percentual: 100 }] }],
    });
    assert.equal(contractResult.acao_preparada, true, contractResult.erro);
    const created = (await call(db, "ai_create_service_contract_from_document", proposals[1].p_payload)).rows[0].result;
    const persisted = (await db.query("select current_value,retention_percent from execution_service_contracts where id=$1", [created.contract_id])).rows[0];
    assert.equal(Number(persisted.current_value), proposals[1].p_preview.total);
    assert.equal(Number(persisted.retention_percent), proposals[1].p_preview.retentionPercent);
  } finally { await db.close(); }
});
