import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { test } from "node:test";

// Node executes the real TS tools with its built-in type stripping. Resolve only
// this checkout's aliases/extensionless imports, without mocking authorization.
const root = fileURLToPath(new URL("../../", import.meta.url));
registerHooks({ resolve(specifier, context, next) {
  let candidate = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : null;
  if (!candidate && specifier.startsWith(".") && context.parentURL?.startsWith("file:")) candidate = fileURLToPath(new URL(specifier, context.parentURL));
  if (candidate?.startsWith(root) && !extname(candidate)) {
    const extension = [".ts", ".mjs", ".js"].find((item) => existsSync(candidate + item));
    if (extension) return next(pathToFileURL(candidate + extension).href, context);
  }
  if (specifier.startsWith("@/") && candidate) return next(pathToFileURL(candidate).href, context);
  return next(specifier, context);
} });
const { runElosIaCommercialTool, elosIaCommercialToolsForPersona } = await import("./commercial-tools.ts");

const company = "company-a";
const project = "project-a";
const unitId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const context = (supabase, can = () => true) => ({ supabase, can, companyId: company, activeProjectId: project, today: "2026-01-01", projects: [{ id: project, name: "Empreendimento A", code: "A", city: null, status: "active" }], cache: new Map() });

function fakeSupabase(tables) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, filters: [], fields: "", single: false, from: 0, to: Infinity, orders: [] };
    calls.push(call);
    const query = {
      select(fields) { call.fields = fields; return query; },
      eq(field, value) { call.filters.push(["eq", field, value]); return query; },
      ilike(field, value) { call.filters.push(["ilike", field, value]); return query; },
      in(field, value) { call.filters.push(["in", field, value]); return query; },
      lte(field, value) { call.filters.push(["lte", field, value]); return query; },
      not(field, operator, value) { call.filters.push(["not", field, value]); return query; },
      or(value) { call.filters.push(["or", value, null]); return query; },
      order(field, options) { call.orders.push([field, options?.ascending !== false]); return query; },
      range(from, to) { call.from = from; call.to = to; return query; },
      limit(limit) { call.to = limit - 1; return query; },
      maybeSingle() { call.single = true; return query; },
      then(resolvePromise, reject) {
        const source = tables[table] ?? [];
        if (source.error) return Promise.resolve({ data: null, error: source.error }).then(resolvePromise, reject);
        let rows = source.filter((row) => call.filters.every(([op, field, value]) => {
          if (op === "eq") return row[field] === value;
          if (op === "ilike") return String(row[field]).toLowerCase() === value.toLowerCase();
          if (op === "in") return value.includes(row[field]);
          if (op === "lte") return row[field] <= value;
          if (op === "not") return row[field] !== value;
          return true;
        }));
        for (const [field, ascending] of [...call.orders].reverse()) rows = [...rows].sort((left, right) => (left[field] < right[field] ? -1 : left[field] > right[field] ? 1 : 0) * (ascending ? 1 : -1));
        rows = rows.slice(call.from, call.to + 1);
        return Promise.resolve({ data: call.single ? rows[0] ?? null : rows, error: null }).then(resolvePromise, reject);
      },
    };
    return query;
  } };
}

test("lucro exige as permissões das fontes antes da primeira consulta", async () => {
  const permissions = ["commercial.incorporation.view", "projects.view", "sales.view", "receivables.view", "schedule.view", "budgets.view", "payables.view", "execution.contracts.view", "execution.measurements.view"];
  for (const blocked of permissions) {
    const db = fakeSupabase({});
    const result = await runElosIaCommercialTool(context(db, (permission) => permission !== blocked), ["resultado_do_empreendimento"], "resultado_do_empreendimento", { obra: null });
    assert.match(result.erro, /não tem permissão/);
    assert.equal(db.calls.length, 0);
  }
});

test("persona sem acesso, permissão de proposta ausente e obra externa não consultam dados", async () => {
  const db = fakeSupabase({});
  assert.deepEqual(elosIaCommercialToolsForPersona("clientes"), []);
  const persona = await runElosIaCommercialTool(context(db), [], "comparar_proposta_unidade", {});
  assert.match(persona.erro, /não está disponível/);
  const permission = await runElosIaCommercialTool(context(db, (value) => value !== "commercial.proposals.view"), ["comparar_proposta_unidade"], "comparar_proposta_unidade", {});
  assert.match(permission.erro, /não tem permissão/);
  const scope = await runElosIaCommercialTool(context(db), ["resultado_do_empreendimento"], "resultado_do_empreendimento", { obra: "Empresa de outro cliente" });
  assert.match(scope.erro, /Não encontrei a obra/);
  assert.equal(db.calls.length, 0);
});

const proposalTables = () => ({
  units: [{ id: unitId, company_id: company, project_id: project, code: "101", list_price: 1_000, status: "available" }],
  commercial_proposals: [{ id: proposalId, company_id: company, project_id: project, unit_id: unitId, number: "P-1", version_no: 1, proposed_amount: 900, list_price: 1_000, status: "sent", proposal_date: "2026-01-01", valid_until: "2026-02-01" }],
  commercial_proposal_payment_items: [
    { id: "1", company_id: company, proposal_id: proposalId, installment_count: 1, first_due_date: "2026-01-01", interval_months: 0, amount_per_installment: 300, total_amount: 300 },
    { id: "2", company_id: company, proposal_id: proposalId, installment_count: 1, first_due_date: "2027-01-01", interval_months: 0, amount_per_installment: 600, total_amount: 600 },
  ],
});
const proposalArgs = { obra: null, unidade: "101", proposta: "P-1", versao: null, taxa_desconto_pct: 10, base_taxa: "anual", data_base: "2026-01-01", condicoes_proposta: null, condicoes_tabela: null };

test("compara preço e proposta oficiais com escopo da empresa/obra, sem inventar VP da tabela ou margem", async () => {
  const db = fakeSupabase(proposalTables());
  const result = await runElosIaCommercialTool(context(db, (permission) => permission !== "commercial.incorporation.view"), ["comparar_proposta_unidade"], "comparar_proposta_unidade", proposalArgs);
  assert.equal(result.erro, undefined);
  assert.equal(result.unidade, "101");
  assert.deepEqual(result.cenarios.map((item) => [item.valor_nominal, item.valor_presente, item.margem_pct]), [[1_000, null, null], [900, 845.45, null]]);
  assert.equal(result.comparacao_valor_presente_disponivel, false);
  for (const call of db.calls) {
    assert.ok(call.filters.some(([op, field, value]) => op === "eq" && field === "company_id" && value === company));
    assert.ok(call.filters.some(([op, field, value]) => op === "eq" && (field === "project_id" && value === project || field === "proposal_id" && value === proposalId)));
  }
  assert.ok(!db.calls.some((call) => call.table.startsWith("commercial_price_table")));
});

test("sem taxa e data, comparação nominal continua disponível e VP permanece null", async () => {
  const db = fakeSupabase(proposalTables());
  const result = await runElosIaCommercialTool(context(db, (permission) => permission !== "commercial.incorporation.view"), ["comparar_proposta_unidade"], "comparar_proposta_unidade", { ...proposalArgs, taxa_desconto_pct: null, base_taxa: null, data_base: null });
  assert.equal(result.taxa_desconto_anual_pct, null);
  assert.equal(result.data_base, null);
  assert.ok(result.cenarios.every((scenario) => scenario.valor_presente === null));
  assert.match(result.avisos.join(" "), /taxa de desconto/);
});

test("total explícito divergente da tabela é rejeitado mesmo quando parcelas fecham o preço oficial", async () => {
  const tables = proposalTables();
  tables.units[0].list_price = 1_200_000;
  const db = fakeSupabase(tables);
  const result = await runElosIaCommercialTool(context(db, (permission) => permission !== "commercial.incorporation.view"), ["comparar_proposta_unidade"], "comparar_proposta_unidade", {
    ...proposalArgs,
    condicoes_tabela: { nome: "Tabela informada", valor_total: 1_100_000, parcelas: [{ quantidade: 1, valor_parcela: 1_200_000, primeiro_vencimento: "2027-01-01", intervalo_meses: 0 }] },
  });
  assert.match(result.erro, /valor total informado.*diverge do preço de referência/);
  assert.equal(result.cenarios, undefined);
});

test("dois VPs entre três cenários não habilitam a comparação geral em valor presente", async () => {
  const db = fakeSupabase({ ...proposalTables(),
    commercial_price_tables: [{ id: "table-a", company_id: company, project_id: project, name: "Tabela A", version_no: 1, valid_from: "2025-12-01", valid_until: null, status: "active" }],
    commercial_price_table_items: [{ company_id: company, project_id: project, price_table_id: "table-a", unit_id: unitId, list_price: 1_000, cash_price: 950 }],
  });
  const result = await runElosIaCommercialTool(context(db), ["comparar_proposta_unidade"], "comparar_proposta_unidade", proposalArgs);
  assert.equal(result.erro, undefined);
  assert.equal(result.cenarios.length, 3);
  assert.deepEqual(result.cenarios.map((scenario) => scenario.valor_presente), [null, 950, 845.45]);
  assert.equal(result.comparacao_valor_presente_disponivel, false);
  assert.deepEqual(result.cenarios_com_valor_presente, ["Tabela à vista", "Proposta P-1 v1"]);
  assert.match(result.avisos.join(" "), /comparação geral permanece nominal/);
});

test("data-base histórica encontra tabela inativa que era vigente naquela data", async () => {
  const db = fakeSupabase({ ...proposalTables(),
    commercial_price_tables: [
      { id: "old-table", company_id: company, project_id: project, name: "Tabela histórica", version_no: 1, valid_from: "2025-12-01", valid_until: "2026-06-01", status: "inactive" },
      { id: "new-table", company_id: company, project_id: project, name: "Tabela atual", version_no: 2, valid_from: "2026-06-02", valid_until: null, status: "active" },
    ],
    commercial_price_table_items: [{ company_id: company, project_id: project, price_table_id: "old-table", unit_id: unitId, list_price: 950, cash_price: null }],
  });
  const request = context(db);
  request.today = "2026-11-10";
  const result = await runElosIaCommercialTool(request, ["comparar_proposta_unidade"], "comparar_proposta_unidade", {
    ...proposalArgs,
    condicoes_tabela: { nome: "Condições históricas", valor_total: 950, parcelas: [{ quantidade: 1, valor_parcela: 950, primeiro_vencimento: "2026-01-01", intervalo_meses: 0 }] },
  });
  assert.equal(result.erro, undefined);
  assert.equal(result.cenarios[0].valor_nominal, 950);
  assert.equal(result.cenarios[0].valor_presente, 950);
  assert.equal(result.comparacao_valor_presente_disponivel, true);
  assert.ok(result.fontes.some((source) => /Tabela histórica v1/.test(source)));
});

test("preço atual de unidade não ganha VP histórico quando falta tabela vigente comprovada", async () => {
  const db = fakeSupabase(proposalTables());
  const request = context(db);
  request.today = "2026-11-10";
  const result = await runElosIaCommercialTool(request, ["comparar_proposta_unidade"], "comparar_proposta_unidade", {
    ...proposalArgs,
    condicoes_tabela: { nome: "Tabela informada", valor_total: 1_000, parcelas: [{ quantidade: 1, valor_parcela: 1_000, primeiro_vencimento: "2026-01-01", intervalo_meses: 0 }] },
  });
  assert.equal(result.erro, undefined);
  assert.equal(result.cenarios[0].valor_nominal, 1_000);
  assert.equal(result.cenarios[0].valor_presente, null);
  assert.match(result.cenarios[0].nome, /histórico não confirmado/);
  assert.match(result.avisos.join(" "), /preço ATUAL cadastrado na unidade/);
  assert.equal(result.comparacao_valor_presente_disponivel, false);
});

test("várias revisões não escondem outra proposta da mesma unidade", async () => {
  const tables = proposalTables();
  const proposal = tables.commercial_proposals[0];
  tables.commercial_proposals = [1, 2, 3, 4].map((version_no) => ({ ...proposal, id: `revision-${version_no}`, version_no }));
  tables.commercial_proposals.push({ ...proposal, id: "other-proposal", number: "P-2" });
  const db = fakeSupabase(tables);
  const result = await runElosIaCommercialTool(context(db), ["comparar_proposta_unidade"], "comparar_proposta_unidade", { ...proposalArgs, proposta: null });
  assert.match(result.erro, /mais de uma proposta.*P-1, P-2/);
  assert.equal(result.cenarios, undefined);
});

test("falha ao carregar parcelas não publica um resultado parcial", async () => {
  const db = fakeSupabase({ ...proposalTables(), commercial_proposal_payment_items: { error: { message: "Leitura indisponível" } } });
  const result = await runElosIaCommercialTool(context(db, (permission) => permission !== "commercial.incorporation.view"), ["comparar_proposta_unidade"], "comparar_proposta_unidade", proposalArgs);
  assert.match(result.erro, /Não foi possível consultar as parcelas/);
  assert.equal(result.cenarios, undefined);
});

test("lucro usa o motor oficial com baseline e todas as consultas vinculadas ao escopo", async () => {
  const baseline = { available_vgv: 1_000, available_units: 1, total_cost: 700, construction_cost: 400, contingency_cost: 20, commission_cost: 50, tax_cost: 40, profit: 300, margin_pct: 30 };
  const db = fakeSupabase({
    ...proposalTables(),
    projects: [{ id: project, company_id: company, total_units: 1 }],
    commercial_development_profiles: [{ company_id: company, project_id: project, baseline_study_id: "study-a", baseline_metrics: baseline, approved_at: "2025-12-01" }],
    commercial_feasibility_studies: [{ id: "study-a", company_id: company, converted_project_id: project, commission_pct: 5, tax_rate_pct: 4 }],
  });
  const request = context(db);
  request.cache.set(`forecast:${project}`, Promise.resolve({ forecast: null, errors: [] }));
  const result = await runElosIaCommercialTool(request, ["resultado_do_empreendimento"], "resultado_do_empreendimento", { obra: null });
  assert.equal(result.erro, undefined);
  assert.equal(result.projecao_disponivel, true);
  assert.equal(result.resultado.result.projectedProfit, 300);
  for (const call of db.calls) assert.ok(call.filters.some(([op, field, value]) => op === "eq" && field === "company_id" && value === company));
  assert.match(result.avisos.join(" "), /Sem previsão financeira atual/);
});
