import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectBinding, normalizeSourceHost, resolveFinancialRows, validateReferenceDate } from "../../lib/eobra-import/resolution.mjs";

const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const HOST = "exemplo.eobra.com.br";
const row = (data = {}) => ({ source_row: 2, external_id: "0007", raw_data: {}, normalized_data: data, errors: [], warnings: [] });
const context = (extra = {}) => ({ companyId: COMPANY, projectId: PROJECT, sourceHost: HOST, entityKind: "payable", ...extra });

test("source instance accepts only an eObra hostname, never credentials or arbitrary URLs", () => {
  assert.equal(normalizeSourceHost("  EXEMPLO.eobra.com.br  "), HOST);
  assert.equal(normalizeSourceHost(`https://${HOST}/`), HOST);
  for (const value of [`https://user:password@${HOST}`, `https://${HOST}/SignIn`, `${HOST}.example.com`, `http://${HOST}`, `${HOST}:443`, "127.0.0.1", `https://${HOST}/?token=secret`, `https://${HOST}/#token`]) {
    assert.throws(() => normalizeSourceHost(value));
  }
});

test("reference date requires a real full calendar date", () => {
  assert.equal(validateReferenceDate("2028-02-29"), "2028-02-29");
  for (const value of ["2026-02-29", "2026-13-01", "2026-11-31", "26/11/2026", ""]) assert.throws(() => validateReferenceDate(value));
});

test("one explicitly bound project is required and mixed source projects are rejected", () => {
  const rows = [row({ source_project: "900" }), row({ source_project: "900" })];
  assert.deepEqual(buildProjectBinding(rows, PROJECT, true, true), { source_reference: "900", project_id: PROJECT, confirmed: true });
  assert.throws(() => buildProjectBinding(rows, PROJECT, false, true), /confirme/);
  assert.throws(() => buildProjectBinding([row({ source_project: "900" }), row({ source_project: "901" })], PROJECT, true, true), /mais de uma obra/);
  const incomplete = [row({ source_project: "900" }), row()];
  buildProjectBinding(incomplete, PROJECT, true, true);
  assert.match(incomplete[1].errors[0], /vazia/);
  const filteredExport = [row()];
  assert.equal(buildProjectBinding(filteredExport, PROJECT, true, false).source_reference, null);
  assert.equal(filteredExport[0].errors.length, 0);
});

test("payables resolve exact source or document, and never match names alone", () => {
  const supplier = { id: "supplier-a", company_id: COMPANY, legal_name: "Fornecedor exemplo", tax_id: "12345678000199" };
  const link = { company_id: COMPANY, scope_id: COMPANY, source_host: HOST, entity_kind: "supplier", external_id: "0002", target_id: supplier.id };
  const inputs = [row({ counterparty_external_id: "0002" }), row({ counterparty_tax_id: "12.345.678/0001-99" }), row({ counterparty_name: supplier.legal_name })];
  const results = resolveFinancialRows(inputs, context({ suppliers: [supplier], supplierLinks: [link] }));
  assert.equal(results[0].normalized_data.supplier_id, supplier.id);
  assert.equal(results[1].normalized_data.supplier_id, supplier.id);
  assert.equal(results[2].normalized_data.supplier_id, undefined);
  assert.match(results[2].warnings[0], /não há vínculo/);
  assert.equal(inputs[0].normalized_data.supplier_id, undefined, "source snapshot is not mutated");
});

test("conflicting and duplicate supplier documents block financial association", () => {
  const suppliers = [
    { id: "one", company_id: COMPANY, legal_name: "Um", tax_id: "11111111111" },
    { id: "two", company_id: COMPANY, legal_name: "Dois", tax_id: "22222222222" },
  ];
  const supplierLinks = [{ company_id: COMPANY, scope_id: COMPANY, source_host: HOST, entity_kind: "supplier", external_id: "1", target_id: "one" }];
  const result = resolveFinancialRows([row({ counterparty_external_id: "1", counterparty_tax_id: "22222222222" })], context({ suppliers, supplierLinks }))[0];
  assert.match(result.errors[0], /ambíguo/);
  assert.equal(result.normalized_data.supplier_id, undefined);
  const duplicate = resolveFinancialRows([row({ counterparty_tax_id: "11111111111" })], context({ suppliers: [...suppliers, { ...suppliers[0], id: "three" }] }))[0];
  assert.match(duplicate.errors[0], /ambíguo/);
});

test("foreign tenant, host, kind and project-scoped supplier identities are ignored", () => {
  const supplier = { id: "local", company_id: COMPANY, legal_name: "Mesmo nome" };
  const base = { company_id: COMPANY, scope_id: COMPANY, source_host: HOST, entity_kind: "supplier", external_id: "1", target_id: supplier.id };
  for (const changes of [{ company_id: OTHER }, { source_host: "outro.eobra.com.br" }, { scope_id: PROJECT }, { entity_kind: "client" }]) {
    const [result] = resolveFinancialRows([row({ counterparty_external_id: "1", supplier_id: "forged", resolved_counterparty_name: "Forged" })], context({ suppliers: [supplier], supplierLinks: [{ ...base, ...changes }] }));
    assert.equal(result.normalized_data.supplier_id, undefined);
    assert.equal(result.normalized_data.resolved_counterparty_name, undefined);
    assert.match(result.errors[0], /beneficiário/);
  }
  const [foreign] = resolveFinancialRows([row({ counterparty_tax_id: "11111111111" })], context({ suppliers: [{ ...supplier, company_id: OTHER, tax_id: "11111111111" }] }));
  assert.equal(foreign.normalized_data.supplier_id, undefined);
});

function commercial(extra = {}) {
  return context({ entityKind: "receivable",
    sales: [{ id: "sale-a", company_id: COMPANY, project_id: PROJECT, number: "V-01", contract_number: "C-01", source_code: "EXT-1", client_id: "client-a", unit_id: "unit-a", status: "active" }],
    clients: [{ id: "client-a", company_id: COMPANY, name: "Cliente exemplo", tax_id: "12345678901" }],
    units: [{ id: "unit-a", company_id: COMPANY, project_id: PROJECT }], ...extra });
}

test("receivables derive actual sale/client/unit from an exact reference", () => {
  for (const reference of ["sale-a", "V-01", "C-01", "EXT-1"]) {
    const [result] = resolveFinancialRows([row({ sale_reference: reference, client_id: "untrusted", unit_id: "untrusted", counterparty_tax_id: "123.456.789-01" })], commercial());
    assert.equal(result.errors.length, 0);
    assert.deepEqual([result.normalized_data.sale_id, result.normalized_data.client_id, result.normalized_data.unit_id], ["sale-a", "client-a", "unit-a"]);
  }
});

test("missing, ambiguous, cancelled or cross-tenant commercial relationships remain blocked", () => {
  const base = commercial();
  const variants = [
    { sales: [] },
    { sales: [...base.sales, { ...base.sales[0], id: "sale-b" }] },
    { sales: [{ ...base.sales[0], project_id: OTHER_PROJECT }] },
    { sales: [{ ...base.sales[0], company_id: OTHER }] },
    { sales: [{ ...base.sales[0], status: "cancelled" }] },
    { clients: [{ ...base.clients[0], company_id: OTHER }] },
    { units: [{ ...base.units[0], project_id: OTHER_PROJECT }] },
  ];
  for (const options of variants) {
    const [result] = resolveFinancialRows([row({ sale_reference: "V-01", sale_id: "forged", client_id: "forged", unit_id: "forged" })], commercial(options));
    assert.ok(result.errors.length > 0);
    assert.equal(result.normalized_data.sale_id, undefined);
  }
  const [wrongDocument] = resolveFinancialRows([row({ sale_reference: "V-01", counterparty_tax_id: "22222222222" })], base);
  assert.match(wrongDocument.errors[0], /documento/);
});

test("namespaced eObra sale identifiers only resolve for the selected host and project", () => {
  const sale = commercial().sales[0];
  const [result] = resolveFinancialRows([row({ sale_reference: "0009" })], commercial({ sales: [{ ...sale, source_system: "eobra", source_id: `${HOST}|${PROJECT}|0009` }] }));
  assert.equal(result.normalized_data.sale_id, "sale-a");
  for (const source of [`outro.eobra.com.br|${PROJECT}|0009`, `${HOST}|${OTHER_PROJECT}|0009`]) {
    const [foreign] = resolveFinancialRows([row({ sale_reference: "0009" })], commercial({ sales: [{ ...sale, source_system: "eobra", source_id: source }] }));
    assert.equal(foreign.normalized_data.sale_id, undefined);
  }
});
