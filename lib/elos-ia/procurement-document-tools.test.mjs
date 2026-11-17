import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

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
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const updated = "2026-11-17T12:00:00Z";
const scope = { company_id: id(1), project_id: id(2) };
function tables() { return {
  suppliers: [{ id: id(3), company_id: id(1), legal_name: "Fornecedor", trade_name: null, tax_id: "12345678000199", status: "active", updated_at: updated }],
  execution_material_requests: [{ id: id(4), ...scope, request_number: "SM-0001", status: "approved", updated_at: updated }],
  execution_material_request_items: [{ id: id(5), ...scope, request_id: id(4), input_id: id(6), input_code: "I01", input_name: "Cimento", unit_snapshot: "sc", cost_center_code: "01", cost_center_name: "Estrutura", requested_quantity: 100, ordered_quantity: 10, stock_fulfilled_quantity: 20, updated_at: updated }],
  execution_service_competitions: [{ id: id(10), ...scope, competition_number: "MC-0001", title: "Pintura", request_id: id(11), status: "approved", winner_offer_id: id(12), winner_supplier_id: id(3), generated_contract_id: null, updated_at: updated }],
  execution_service_competition_offers: [{ id: id(12), ...scope, competition_id: id(10), supplier_id: id(3), status: "winner", total_amount: 600, payment_days: 15, updated_at: updated }],
  execution_service_competition_offer_items: [{ id: id(13), ...scope, offer_id: id(12), request_item_id: id(14), offered_quantity: 20, unit_price: 30, total_amount: 600, meets_specification: true }],
  execution_service_request_items: [{ id: id(14), ...scope, request_id: id(11), service_id: id(15), service_code: "S01", service_name: "Pintura", location_name: null, unit_snapshot: "m2", scope_notes: null, measurement_notes: null }],
}; }
function database(data) {
  const calls = [];
  return { calls, async rpc(name, args) { calls.push({ rpc: name, args }); assert.equal(name, "ai_prepare_document_action", "preparation must never invoke a domain executor"); return { data: { id: id(100), title: args.p_title, summary: args.p_summary }, error: null }; }, from(table) {
    const call = { table, filters: [] }; calls.push(call); let single = false; let limit = Infinity;
    const query = {
      select() { return query; }, eq(key, value) { call.filters.push(row => row[key] === value); return query; },
      in(key, values) { call.filters.push(row => values.includes(row[key])); return query; },
      is(key, value) { call.filters.push(row => row[key] === value); return query; },
      order() { return query; }, or() { return query; }, limit(value) { limit = value; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve, reject) { const rows = (data[table] ?? []).filter(row => call.filters.every(filter => filter(row))).slice(0, limit); return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject); },
    }; return query;
  } };
}
function context(db, can = () => true) { return { supabase: db, companyId: id(1), activeProjectId: id(2), projects: [{ id: id(2), code: "DEMO", name: "Obra demo", status: "active" }], userId: id(9), turnId: id(8), persona: "diretoria", attachmentNames: ["documento.pdf"], today: "2026-11-17", can, cache: new Map() }; }
const quotation = () => ({ obra: null, solicitacao: "SM-0001", fornecedor_id: id(3), titulo: "Compra de cimento", modo_fechamento: "item", prazo_resposta: "2026-11-20", frete_total: 20, valor_total_documento: 220, itens: [{ item_solicitacao_id: id(5), unidade: "sc", quantidade: 10, preco_unitario: 20 }] });
const contract = () => ({ obra: null, concorrencia: "MC-0001", fornecedor_id: id(3), titulo: "Contrato de pintura", escopo: "Pintura interna", inicio: "2026-12-01", fim: "2026-12-31", retencao_percentual: 5, garantia_percentual: 5, garantia_meses: 60, prazo_pagamento_dias: 15, valor_total_documento: 600, itens: [{ item_solicitacao_id: id(14), unidade: "m2", quantidade: 20, preco_unitario: 30, etapas: [{ nome: "Execução", modo_medicao: "quantity", peso_percentual: 100 }] }] });
const run = (db, name, args, ctx = context(db)) => runProcurementDocumentTool(ctx, procurementDocumentToolsForPersona("diretoria"), name, args);

test("permissão é conferida antes de consultar dados ou preparar ação", async () => {
  const db = database(tables());
  const result = await run(db, "preparar_nova_cotacao_documento", quotation(), context(db, () => false));
  assert.match(result.erro, /não possui permissão/); assert.equal(db.calls.length, 0);
  assert.deepEqual(procurementDocumentToolsForPersona("clientes"), []);
});
test("cotação prepara somente cartão, com total e vínculo da fonte, sem escolher vencedor", async () => {
  const db = database(tables());
  const result = await run(db, "preparar_nova_cotacao_documento", quotation());
  assert.equal(result.acao_preparada, true);
  const call = db.calls.find(row => row.rpc);
  assert.equal(call.args.p_action_type, "procurement_quotation_create");
  assert.equal(call.args.p_payload.total, 220); assert.equal(call.args.p_payload.items[0].expected_remaining_quantity, 70);
  assert.equal(call.args.p_preview.items[0].specificationConfirmed, false);
  assert.equal(call.args.p_file_name, "documento.pdf");
  assert.equal(call.args.p_document_key, `${id(3)}:${id(5)}`);
});
test("cotação bloqueia origem sem aprovação, unidade divergente, excesso e soma errada", async () => {
  for (const mutate of [
    (args, data) => { data.execution_material_requests[0].status = "requested"; },
    args => { args.itens[0].unidade = "kg"; },
    args => { args.itens[0].quantidade = 90; },
    args => { args.valor_total_documento = 230; },
    args => { args.itens.push({ ...args.itens[0] }); },
    args => { args.prazo_resposta = "2026-02-30"; },
  ]) {
    const data = tables(), args = quotation(); mutate(args, data); const db = database(data);
    const result = await run(db, "preparar_nova_cotacao_documento", args);
    assert.ok(result.erro); assert.equal(db.calls.filter(row => row.rpc).length, 0);
  }
});
test("contrato exige vencedor, valores e etapas aprovadas antes de preparar", async () => {
  for (const mutate of [
    (args, data) => { data.execution_service_competitions[0].status = "analysis"; },
    (args, data) => { data.execution_service_competitions[0].winner_supplier_id = id(99); },
    args => { args.itens[0].preco_unitario = 31; },
    args => { args.itens[0].etapas[0].peso_percentual = 80; },
    args => { args.prazo_pagamento_dias = null; },
    args => { args.garantia_meses = null; },
  ]) {
    const data = tables(), args = contract(); mutate(args, data); const db = database(data);
    const result = await run(db, "preparar_contrato_empreiteiro_documento", args);
    assert.ok(result.erro); assert.equal(db.calls.filter(row => row.rpc).length, 0);
  }
});
test("contrato prepara rascunho completo sem ativação, medição ou conta a pagar", async () => {
  const db = database(tables()); const result = await run(db, "preparar_contrato_empreiteiro_documento", contract());
  assert.equal(result.acao_preparada, true);
  const call = db.calls.find(row => row.rpc);
  assert.equal(call.args.p_action_type, "execution_contract_create");
  assert.equal(call.args.p_payload.total, 600); assert.equal(call.args.p_preview.items[0].stages[0].weightPercent, 100);
  assert.equal(call.args.p_preview.retentionPercent, 5); assert.equal(call.args.p_document_key, id(10));
});
test("documento atual obrigatório e IDs de outra empresa não são aceitos", async () => {
  const db = database(tables()), ctx = context(db); ctx.attachmentNames = [];
  assert.match((await run(db, "preparar_nova_cotacao_documento", quotation(), ctx)).erro, /Anexe o documento/);
  assert.equal(db.calls.filter(row => row.rpc).length, 0);
  const foreign = tables(); foreign.suppliers[0].company_id = id(99); const db2 = database(foreign);
  assert.match((await run(db2, "preparar_nova_cotacao_documento", quotation())).erro, /Fornecedor não encontrado/);
  assert.equal(db2.calls.filter(row => row.rpc).length, 0);
});
