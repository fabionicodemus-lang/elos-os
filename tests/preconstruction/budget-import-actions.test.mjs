import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as XLSX from "xlsx";
import * as parser from "../../lib/budget-import/parser.mjs";

const require = createRequire(import.meta.url);
class Navigation extends Error { constructor(url) { super(url); this.url = url; } }

function setup({ matched = true, duplicate = null, insertError = false, invalid = 0, unit = "m³", staleMapping = false } = {}) {
  const calls = [];
  function from(table) {
    const query = { table, op: "select", value: null };
    const builder = {};
    for (const op of ["select", "insert", "update", "delete"]) builder[op] = value => {
      // select after insert requests RETURNING; retain the mutation.
      if (op !== "select" || query.op === "select") { query.op = op; query.value = value; }
      return builder;
    };
    for (const op of ["eq", "neq", "or", "order", "limit", "range", "single"]) builder[op] = () => builder;
    builder.then = (resolve, reject) => Promise.resolve().then(() => {
      calls.push({ ...query });
      if (query.op === "insert" && table === "engineering_budget_import_batches") return { data: { id: "batch-1" }, error: null };
      if (query.op === "insert" && table === "engineering_budget_import_rows" && insertError) return { error: { message: "Falha simulada" } };
      if (query.op !== "select") return { data: null, error: null };
      if (table === "engineering_services") return { data: matched ? [{ id: "service-1", code: "01.01", description: "Concreto", unit }] : [], error: null };
      if (table === "integration_mappings" && staleMapping) return { data: [{ source_entity_type: "service", scope: "company", scope_id: "company-1", key_kind: "code", external_key: "01.01", target_entity_type: "engineering_service", target_entity_id: "deleted-service" }], error: null };
      if (table === "engineering_budget_import_batches") return { data: duplicate ? [duplicate] : [], error: null };
      if (table === "engineering_budget_import_rows") return { count: invalid, error: null };
      return { data: [], error: null };
    }).then(resolve, reject);
    return builder;
  }
  const supabase = { from, rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: "budget-1", error: null }; } };
  const mocks = {
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect: url => { throw new Navigation(url); } },
    "@/lib/workspace": { requireCompanyPermission: async () => ({ supabase, companyId: "company-1", projectId: "project-1", userId: "user-1" }) },
    "@/lib/budget-import/parser.mjs": parser,
    "@/lib/supabase-pagination": { fetchAllRows: async load => load(0, 999) },
  };
  function load(path) {
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", code)(name => mocks[name] ?? require(name), loaded, loaded.exports);
    return loaded.exports;
  }
  return { calls, actions: load("../../app/engenharia/orcamentos/importar/actions.ts"), review: load("../../app/engenharia/orcamentos/importar/review-actions.ts") };
}
function upload() {
  const row = []; row[4] = "01.01"; row[6] = "Concreto"; row[7] = 10; row[8] = "m³"; row[9] = 100; row[10] = 1000;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([row]), "ORCAMENTO ANALITICO");
  const form = new FormData();
  form.set("file", new File([XLSX.write(book, { type: "buffer", bookType: "xlsx" })], "orcamento.xlsx"));
  return form;
}

test("lote totalmente reconhecido termina pronto e redireciona à revisão", async () => {
  const { actions, calls } = setup();
  await assert.rejects(actions.stageBudgetImport(upload()), e => e instanceof Navigation && e.url.endsWith("/batch-1"));
  assert.equal(calls.find(c => c.op === "update").value.status, "ready");
  assert.equal(calls.filter(c => c.op === "insert").length, 2);
});

test("cadastro desconhecido mantém revisão e não cria cadastro canônico", async () => {
  const { actions, calls } = setup({ matched: false });
  await assert.rejects(actions.stageBudgetImport(upload()), Navigation);
  assert.equal(calls.find(c => c.op === "update").value.status, "review");
  assert.ok(calls.filter(c => c.op === "insert").every(c => c.table.startsWith("engineering_budget_import_")));
});

test("reenviar mesmo arquivo reutiliza lote sem criar nova revisão", async () => {
  const { actions, calls } = setup({ duplicate: { id: "existing", status: "review" } });
  await assert.rejects(actions.stageBudgetImport(upload()), e => e instanceof Navigation && e.url.includes("/existing?"));
  assert.equal(calls.filter(c => c.op === "insert").length, 0);
});

test("lote cancelado permite reenviar o arquivo com as regras atuais", async () => {
  const { actions, calls } = setup({ duplicate: { id: "old", status: "cancelled" } });
  await assert.rejects(actions.stageBudgetImport(upload()), Navigation);
  assert.equal(calls.find(c => c.op === "insert").value.metadata.previous_batch_id, "old");
});

test("falha na gravação de linhas remove lote parcial e não libera confirmação", async () => {
  const { actions, calls } = setup({ insertError: true });
  await assert.rejects(actions.stageBudgetImport(upload()), e => e instanceof Navigation && e.url.includes("error="));
  assert.ok(calls.some(c => c.op === "delete"));
  assert.ok(!calls.some(c => c.op === "update"));
});

test("promoção de lote antigo com serviço zero é bloqueada antes da RPC", async () => {
  const { review, calls } = setup({ invalid: 1 });
  const form = new FormData();
  for (const [key, value] of Object.entries({ batch_id: "batch-1", budget_code: "ORC", budget_name: "Teste", budget_version: "R01" })) form.set(key, value);
  await assert.rejects(review.promoteBudgetImport(form), e => e instanceof Navigation && decodeURIComponent(e.url).includes("lote+antigo"));
  assert.ok(!calls.some(c => c.rpc));
});

for (const options of [{ unit: "kg" }, { staleMapping: true }]) {
  test(`vínculo incompatível exige revisão: ${JSON.stringify(options)}`, async () => {
    const { actions, calls } = setup(options);
    await assert.rejects(actions.stageBudgetImport(upload()), Navigation);
    assert.equal(calls.find(c => c.op === "update").value.status, "review");
    const staged = calls.find(c => c.op === "insert" && c.table === "engineering_budget_import_rows").value;
    assert.equal(staged[0].target_entity_id, null);
    assert.equal(staged[0].match_status, "ambiguous");
  });
}
