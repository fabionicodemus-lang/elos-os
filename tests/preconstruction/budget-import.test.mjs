import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseBudgetWorkbook } from "../../lib/budget-import/parser.mjs";

function service(code, quantity, cost = 100) {
  const row = [];
  row[4] = code; row[6] = `Serviço ${code}`; row[7] = quantity;
  row[8] = "m²"; row[9] = cost; row[10] = typeof quantity === "number" ? quantity * cost : 0;
  return row;
}
function input(code = "MAT.01", quantity = 20) {
  const row = [];
  row[0] = code; row[6] = "Cimento"; row[7] = quantity; row[8] = "kg";
  row[9] = 5; row[10] = quantity * 5; row[12] = 2;
  return row;
}
function workbook(rows, summaryTotal) {
  const book = XLSX.utils.book_new();
  const group = []; group[4] = "GRUPO: 01"; group[6] = "Estrutura";
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([group, ...rows]), "ORCAMENTO ANALITICO");
  if (summaryTotal != null) {
    const summary = []; summary[0] = "CUSTO OBRA"; summary[7] = summaryTotal;
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([summary]), "RESUMO GRUPOS");
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

test("serviço zero e toda a sua composição são excluídos sem contaminar o serviço seguinte", () => {
  const result = parseBudgetWorkbook(workbook([
    service("01.01", 10), input(), service("01.02", 0), input("MAT.02"), input("MAT.03"),
    service("01.03", 5), input("MAT.04", 15),
  ]));
  const services = result.rows.filter(r => r.entity_kind === "service");
  const inputs = result.rows.filter(r => r.entity_kind === "input");
  assert.deepEqual(services.map(r => r.external_code), ["01.01", "01.03"]);
  assert.deepEqual(inputs.map(r => r.external_code), ["MAT.01", "MAT.04"]);
  assert.equal(inputs[1].source_service_code, "01.03");
  assert.equal(inputs[1].coefficient, 3);
  assert.equal(result.summary.skipped_zero_services, 1);
  assert.equal(result.summary.skipped_zero_inputs, 2);
  assert.equal(result.source_total, 1500);
});

test("quantidade zero em texto brasileiro também é ignorada", () => {
  const result = parseBudgetWorkbook(workbook([service("01.01", "0,00"), input(), service("01.02", 2)]));
  assert.equal(result.summary.services, 1);
  assert.equal(result.summary.inputs, 0);
});

for (const quantity of ["", "inválido", -1]) {
  test(`quantidade inválida ${JSON.stringify(quantity)} não vira zero silenciosamente`, () => {
    assert.throws(() => parseBudgetWorkbook(workbook([service("01.01", quantity)])), /Quantidade inválida.*01.01.*linha 2/);
  });
}

test("arquivo só com serviços zerados não produz orçamento vazio", () => {
  assert.throws(() => parseBudgetWorkbook(workbook([service("01.01", 0), input()])), /Nenhum serviço com quantidade maior que zero/);
});

test("total da origem é preservado para revelar divergências na conciliação", () => {
  const result = parseBudgetWorkbook(workbook([service("01.01", 10), input()], 1200));
  assert.equal(result.source_total, 1200);
  assert.equal(result.rows.find(r => r.entity_kind === "service").total_cost, 1000);
});

test("valor unitário ausente usa preço da lista sem transformar vazio em zero", () => {
  const book = XLSX.read(workbook([service("01.01", 10), input()]));
  delete book.Sheets["ORCAMENTO ANALITICO"].J3;
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["MAT.01", "Cimento", "kg", 8, "Fornecedor", "", 7]]), "Lista de Preços");
  const result = parseBudgetWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
  assert.equal(result.rows.find(r => r.entity_kind === "input").unit_cost, 7);
});

test("zero explícito não vira verba mesmo com total preenchido", () => {
  const zero = service("01.01", 0); zero[10] = 500;
  const result = parseBudgetWorkbook(workbook([zero, input(), service("01.02", 2)]));
  assert.deepEqual(result.rows.filter(r => r.entity_kind === "service").map(r => r.external_code), ["01.02"]);
});
