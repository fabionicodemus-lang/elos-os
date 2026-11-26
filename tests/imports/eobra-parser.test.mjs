import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  ENTITY_KINDS, FIELD_DEFINITIONS, MAX_FILE_BYTES, MAX_ROWS,
  inspectImportFile, suggestColumnMapping, parseImportFile,
} from "../../lib/eobra-import/parser.mjs";

const quote = (value, separator) => {
  const text = String(value ?? "");
  return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
function csv(headers, rows, separator = ";") {
  return Buffer.from([headers, ...rows].map(row => row.map(value => quote(value, separator)).join(separator)).join("\r\n"));
}
async function parse(kind, records, { separator = ";", ...options } = {}) {
  const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
  const bytes = csv(headers, records.map(record => headers.map(header => record[header])), separator);
  return parseImportFile(bytes, "exportacao.csv", { entityKind: kind, columnMapping: Object.fromEntries(headers.map(header => [header, header])), ...options });
}
function finance(overrides = {}) {
  return { external_id: "000012", due_date: "26/11/2026", original_amount: "1.234,56", source_status: "Em aberto", ...overrides };
}
async function xlsx(rows, configure = () => {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Exportação");
  for (const row of rows) sheet.addRow(row);
  configure(workbook, sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const fieldMap = headers => Object.fromEntries(headers.map(header => [header, header]));
const has = (row, regex) => row.errors.some(error => regex.test(error));

test("contrato público inclui quatro entidades, limites e campos obrigatórios", () => {
  assert.deepEqual(ENTITY_KINDS, ["supplier", "client", "payable", "receivable"]);
  assert.equal(MAX_FILE_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_ROWS, 2000);
  for (const kind of ENTITY_KINDS) {
    assert.ok(FIELD_DEFINITIONS[kind].some(field => field.key === "external_id" && field.required));
    assert.ok(FIELD_DEFINITIONS[kind].every(field => Array.isArray(field.aliases)));
  }
});

test("sugestão usa aliases exatos e não decide entre colunas ambíguas", () => {
  const mapping = suggestColumnMapping(["Código", "Razão Social", "CPF/CNPJ", "E-mail"], "supplier");
  assert.deepEqual(mapping, { external_id: "Código", name: "Razão Social", tax_id: "CPF/CNPJ", email: "E-mail" });
  assert.equal(suggestColumnMapping(["Nome", "Razão Social"], "client").name, undefined);
});

test("CSV RFC4180 preserva aspas, separador e linha física após campo multilinha", async () => {
  const bytes = csv(["id", "nome", "observações"], [["000001", 'Empresa "Azul"; filial', "Primeira linha\nSegunda linha"], ["000002", "Outra", "Fim"]]);
  const inspection = await inspectImportFile(bytes, "exportacao.csv");
  assert.equal(inspection.sheets[0].rowCount, 2);
  assert.equal(inspection.sheets[0].samples[0].nome, 'Empresa "Azul"; filial');
  const result = await parseImportFile(bytes, "exportacao.csv", { entityKind: "supplier", columnMapping: { external_id: "id", name: "nome", notes: "observações" } });
  assert.equal(result.rows[0].external_id, "000001");
  assert.equal(result.rows[0].normalized_data.notes, "Primeira linha\nSegunda linha");
  assert.equal(result.rows[1].source_row, 4);
  assert.equal(result.summary.valid, 2);
});

for (const separator of [",", "\t", ";"]) test(`CSV detecta separador ${JSON.stringify(separator)}`, async () => {
  const result = await parse("supplier", [{ external_id: "01", name: "Empresa, São José; SC" }], { separator });
  assert.equal(result.rows[0].normalized_data.name, "Empresa, São José; SC");
});

test("decodifica UTF-8 BOM, UTF-16 LE/BE e Windows-1252 sem perder acentos", async () => {
  const content = "id;nome\r\n0001;Ação e João";
  const utf16le = Buffer.from(content, "utf16le");
  const utf16be = Buffer.from(utf16le); utf16be.swap16();
  const cp1252 = Buffer.from([0x69, 0x64, 0x3b, 0x6e, 0x6f, 0x6d, 0x65, 0x0a, 0x30, 0x30, 0x30, 0x31, 0x3b, 0x41, 0xe7, 0xe3, 0x6f, 0x20, 0x65, 0x20, 0x4a, 0x6f, 0xe3, 0x6f]);
  for (const bytes of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)]), Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le]), Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be]), utf16le, cp1252]) {
    const result = await inspectImportFile(bytes, "exportacao.csv");
    assert.equal(result.sheets[0].samples[0].nome, "Ação e João");
  }
});

test("rejeita aspas quebradas e cabeçalhos duplicados sem sobrescrever", async () => {
  await assert.rejects(inspectImportFile(Buffer.from('id;nome\n1;"sem fechar'), "dados.csv"), /aspas/i);
  await assert.rejects(inspectImportFile(Buffer.from("ID;id\n1;Empresa"), "dados.csv"), /duplicado/i);
  await assert.rejects(inspectImportFile(Buffer.from('id;nome\n1;"nome"texto'), "dados.csv"), /aspas/i);
});

test("coluna sem cabeçalho e dados extras continuam inspecionáveis e no raw_data", async () => {
  const bytes = Buffer.from("id;nome\n1;Empresa;informação extra");
  const inspection = await inspectImportFile(bytes, "dados.csv");
  assert.deepEqual(inspection.sheets[0].headers, ["id", "nome", "Coluna 3 (sem cabeçalho)"]);
  const result = await parseImportFile(bytes, "dados.csv", { entityKind: "supplier", columnMapping: { external_id: "id", name: "nome" } });
  assert.equal(result.rows[0].raw_data["Coluna 3 (sem cabeçalho)"], "informação extra");
});

test("headerRow permite preâmbulo e conserva a linha da origem", async () => {
  const bytes = Buffer.from("Relatório de fornecedores\nExportado em 26/11/2026\nid;nome\n0003;Empresa");
  const result = await parseImportFile(bytes, "dados.csv", { entityKind: "supplier", headerRow: 3, columnMapping: { external_id: "id", name: "nome" } });
  assert.equal(result.rows[0].source_row, 4);
});

test("inspeção inclui abas ocultas e vazias; múltiplas abas exigem seleção explícita", async () => {
  const bytes = await xlsx([["id", "nome"], ["1", "Primeira"]], workbook => {
    const hidden = workbook.addWorksheet("Oculta", { state: "hidden" }); hidden.addRows([["id", "nome"], ["2", "Segunda"]]);
    workbook.addWorksheet("Vazia");
  });
  const result = await inspectImportFile(bytes, "dados.xlsx");
  assert.deepEqual(result.sheets.map(sheet => [sheet.name, sheet.rowCount]), [["Exportação", 1], ["Oculta", 1], ["Vazia", 0]]);
  await assert.rejects(parseImportFile(bytes, "dados.xlsx", { entityKind: "supplier", columnMapping: { external_id: "id", name: "nome" } }), /explicitamente/);
  const selected = await parseImportFile(bytes, "dados.xlsx", { entityKind: "supplier", sheetName: "Oculta", columnMapping: { external_id: "id", name: "nome" } });
  assert.equal(selected.rows[0].external_id, "2");
});

test("linha XLSX contendo somente erro permanece na inspeção e fica bloqueada", async () => {
  const headers = ["external_id", "name"];
  const bytes = await xlsx([headers, ["1", "Empresa"], [null, { error: "#VALUE!" }]]);
  const inspection = await inspectImportFile(bytes, "dados.xlsx");
  assert.equal(inspection.sheets[0].rowCount, 2);
  assert.match(inspection.sheets[0].samples[1].name, /erro do Excel/);
  const result = await parseImportFile(bytes, "dados.xlsx", { entityKind: "supplier", columnMapping: fieldMap(headers) });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].source_row, 3);
  assert.ok(has(result.rows[1], /erro do Excel/));
  assert.equal(result.rows[1].raw_data.name.value, null);
  assert.match(result.rows[1].raw_data.name.error, /#VALUE!/);
});

test("mesclagens na área de dados são rejeitadas antes de replicar valores", async () => {
  const headers = ["external_id", "due_date", "original_amount", "source_status"];
  const bytes = await xlsx([headers, ["1", "26/11/2026", 100, "aberto"], ["2", "26/11/2026", null, "aberto"]], (workbook, sheet) => sheet.mergeCells("C2:C3"));
  await assert.rejects(inspectImportFile(bytes, "dados.xlsx"), /mescladas.*C2:C3/);
  await assert.rejects(parseImportFile(bytes, "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) }), /mescladas.*C2:C3/);
  const preamble = await xlsx([["Relatório financeiro"], headers, ["1", "26/11/2026", 100, "aberto"]], (workbook, sheet) => sheet.mergeCells("A1:D1"));
  const result = await parseImportFile(preamble, "dados.xlsx", { entityKind: "payable", headerRow: 2, columnMapping: fieldMap(headers) });
  assert.equal(result.summary.valid, 1);
  assert.equal(result.summary.original_amount, "100.00");
});

test("lexema numérico XLSX não perde fração nem oculta notação científica do ID", async () => {
  const headers = ["external_id", "name"];
  const bytes = await xlsx([headers, [1, "Fracionário arredondado"], [2, "Notação científica"], [3, "Inteiro seguro"]]);
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  for (const [address, value] of [["A2", "9007199254740990.1"], ["A3", "1e3"], ["A4", "12345.00"]]) {
    const pattern = new RegExp(`(<c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?<v>)[^<]*(</v>)`);
    xml = xml.replace(pattern, (_, start, end) => `${start}${value}${end}`);
  }
  zip.file("xl/worksheets/sheet1.xml", xml);
  const result = await parseImportFile(await zip.generateAsync({ type: "nodebuffer" }), "dados.xlsx", { entityKind: "supplier", columnMapping: fieldMap(headers) });
  assert.equal(result.summary.blocked, 2);
  assert.equal(result.rows[0].external_id, null);
  assert.ok(has(result.rows[0], /perda de precisão/));
  assert.equal(result.rows[0].raw_data.external_id.lexeme, "9007199254740990.1");
  assert.match(result.rows[0].raw_data.external_id.error, /perda de precisão/);
  assert.ok(has(result.rows[1], /notação científica/));
  assert.equal(result.rows[1].raw_data.external_id.lexeme, "1e3");
  assert.equal(result.rows[2].external_id, "12345");
  assert.equal(result.rows[2].errors.length, 0);
});

test("valor numérico XLSX arredondado não alimenta valores financeiros derivados", async () => {
  const headers = ["external_id", "due_date", "original_amount", "source_status"];
  const zip = await JSZip.loadAsync(await xlsx([headers, ["1", "26/11/2026", 100, "aberto"]]));
  const xml = (await zip.file("xl/worksheets/sheet1.xml").async("string"))
    .replace(/(<c\b[^>]*\br="C2"[^>]*>[\s\S]*?<v>)[^<]*(<\/v>)/, (_, start, end) => `${start}99.999999999999999999${end}`);
  zip.file("xl/worksheets/sheet1.xml", xml);
  const result = await parseImportFile(await zip.generateAsync({ type: "nodebuffer" }), "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) });
  assert.equal(result.summary.blocked, 1);
  assert.equal(result.rows[0].normalized_data.original_amount, null);
  assert.equal(result.rows[0].normalized_data.current_amount, null);
  assert.equal(result.rows[0].normalized_data.balance_amount, null);
  assert.equal(result.rows[0].raw_data.original_amount.lexeme, "99.999999999999999999");
});

test("IDs textuais e formato de zeros Excel são preservados; científicos e inseguros bloqueados", async () => {
  const bytes = await xlsx([["external_id", "name"], [123, "Zeros"], [9007199254740992, "Inseguro"], ["1E+12", "Científico"], [-123, "Negativo"], [1.25, "Fracionário"], ["00009999999999999999999999", "Texto longo"]], (_book, sheet) => { sheet.getCell("A2").numFmt = "000000"; });
  const result = await parseImportFile(bytes, "dados.xlsx", { entityKind: "supplier", columnMapping: { external_id: "external_id", name: "name" } });
  assert.equal(result.rows[0].external_id, "000123");
  assert.ok(has(result.rows[1], /inseguro/));
  assert.ok(has(result.rows[2], /científica/));
  assert.ok(has(result.rows[3], /negativo/));
  assert.ok(has(result.rows[4], /fracionário/));
  assert.equal(result.rows[5].external_id, "00009999999999999999999999");
  assert.equal(result.summary.valid, 2);
});

test("IDs duplicados bloqueiam todas as linhas e não são agregados silenciosamente", async () => {
  const result = await parse("client", [{ external_id: "001", name: "Um" }, { external_id: "001", name: "Dois" }]);
  assert.equal(result.summary.blocked, 2);
  assert.ok(result.rows.every(row => has(row, /repetido/)));
});

test("CPF/CNPJ validam dígitos e person_type fica PF/PJ/OTHER", async () => {
  const result = await parse("supplier", [
    { external_id: "1", name: "Pessoa sintética", tax_id: "529.982.247-25" },
    { external_id: "2", name: "Empresa sintética", tax_id: "11.222.333/0001-81" },
    { external_id: "3", name: "Sem documento" },
    { external_id: "4", name: "Inválido", tax_id: "111.111.111-11" },
    { external_id: "5", name: "Tipo divergente", tax_id: "52998224725", person_type: "PJ" },
  ]);
  assert.deepEqual(result.rows.slice(0, 3).map(row => row.normalized_data.person_type), ["PF", "PJ", "OTHER"]);
  assert.equal(result.summary.valid, 3);
  assert.ok(has(result.rows[3], /inválido/));
  assert.ok(has(result.rows[4], /não corresponde/));
});

test("telefone internacional não é fórmula; expressões CSV não são executadas", async () => {
  const result = await parse("supplier", [
    { external_id: "1", name: "Empresa", phone: "+55 (47) 99999-0000" },
    { external_id: "2", name: '=HYPERLINK("https://invalid.example","X")' },
    { external_id: "3", name: "+SUM(1,2)" },
    { external_id: "4", name: "@SUM(1,2)" },
  ]);
  assert.equal(result.rows[0].errors.length, 0);
  assert.equal(result.rows[0].normalized_data.phone, "+55 (47) 99999-0000");
  assert.ok(result.rows.slice(1).every(row => has(row, /expressão/)));
});

test("moeda pt-BR e decimal pontuado somam centavos exatos sem float", async () => {
  const result = await parse("payable", [finance({ external_id: "1", original_amount: "R$ 1.234,56" }), finance({ external_id: "2", original_amount: "0,10" }), finance({ external_id: "3", original_amount: "0.20" })]);
  assert.equal(result.summary.valid, 3);
  assert.equal(result.summary.original_amount, "1234.86");
  assert.equal(result.summary.paid_amount, "0.00");
  assert.equal(result.summary.balance_amount, "1234.86");
  assert.ok(result.rows[0].warnings.some(warning => /considerado zero/.test(warning)));
  assert.equal(result.rows[0].normalized_data.interest_amount, null);
});

test("valores inválidos, negativos ou três casas decimais não viram zero", async () => {
  const result = await parse("payable", [finance({ external_id: "1", original_amount: "-12,34" }), finance({ external_id: "2", original_amount: "12,345" }), finance({ external_id: "3", original_amount: "inválido" }), finance({ external_id: "4", original_amount: "1e3" })]);
  assert.equal(result.summary.valid, 0);
  assert.equal(result.summary.totals_complete, false);
  assert.ok(result.rows.every(row => row.normalized_data.original_amount === null));
});

test("data civil inválida é bloqueada; ano bissexto, ISO e data brasileira funcionam", async () => {
  const result = await parse("payable", [finance({ external_id: "1", due_date: "29/02/2024" }), finance({ external_id: "2", due_date: "2026-11-26" }), finance({ external_id: "3", due_date: "31/02/2026" }), finance({ external_id: "4", due_date: "29/02/2026" })]);
  assert.equal(result.rows[0].normalized_data.due_date, "2024-02-29");
  assert.equal(result.rows[1].normalized_data.due_date, "2026-11-26");
  assert.equal(result.summary.valid, 2);
  assert.ok(result.rows.slice(2).every(row => has(row, /data inválida/)));
});

test("datas XLSX tipadas e seriais respeitam o calendário sem o falso 29/02/1900", async () => {
  const headers = ["external_id", "due_date", "original_amount", "source_status"];
  const bytes = await xlsx([headers, ["1", new Date("2026-11-26T00:00:00Z"), 12.34, "aberto"], ["2", 1, 1, "aberto"], ["3", 60, 1, "aberto"]]);
  const result = await parseImportFile(bytes, "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) });
  assert.equal(result.rows[0].normalized_data.due_date, "2026-11-26");
  assert.equal(result.rows[1].normalized_data.due_date, "1900-01-01");
  assert.ok(has(result.rows[2], /data inválida/));
  const bytes1904 = await xlsx([headers, ["1", 0, 1, "aberto"]], workbook => { workbook.properties.date1904 = true; });
  const result1904 = await parseImportFile(bytes1904, "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) });
  assert.equal(result1904.rows[0].normalized_data.due_date, "1904-01-01");
});

test("status desconhecido não inventa baixa ou saldo zero", async () => {
  const result = await parse("payable", [finance({ source_status: "A conferir" })]);
  const row = result.rows[0];
  assert.equal(row.normalized_data.status, "unknown");
  assert.equal(row.normalized_data.paid_amount, null);
  assert.equal(row.normalized_data.balance_amount, null);
  assert.equal(row.normalized_data.current_amount, null);
  assert.ok(has(row, /Situação/));
});

test("pago exige valor e data explícitos; histórico integral é válido", async () => {
  const result = await parse("payable", [finance({ external_id: "1", source_status: "Pago" }), finance({ external_id: "2", source_status: "Pago", paid_amount: "1234,56" }), finance({ external_id: "3", source_status: "Pago", paid_amount: "1234,56", paid_at: "25/11/2026", paid_account_name: "Conta da SPE" })]);
  assert.equal(result.summary.valid, 1);
  assert.ok(has(result.rows[0], /valor efetivamente/));
  assert.ok(has(result.rows[1], /data de pagamento/));
  assert.equal(result.rows[2].normalized_data.paid_at, "2026-11-25");
  assert.equal(result.rows[2].normalized_data.balance_amount, "0.00");
  assert.equal(result.rows[2].normalized_data.paid_account_name, "Conta da SPE");
});

test("baixa parcial explícita ou detectada permanece bloqueada", async () => {
  const result = await parse("receivable", [finance({ external_id: "1", source_status: "Parcial", paid_amount: "100,00", balance_amount: "1134,56", paid_at: "25/11/2026" }), finance({ external_id: "2", source_status: "Em aberto", current_amount: "1234,56", paid_amount: "100,00", balance_amount: "1134,56", paid_at: "25/11/2026" })]);
  assert.equal(result.summary.blocked, 2);
  assert.ok(result.rows.every(row => row.normalized_data.status === "partial" && has(row, /Baixa parcial/)));
});

test("reconciliação não aceita valores contraditórios nem títulos cancelados com baixa", async () => {
  const result = await parse("receivable", [finance({ external_id: "1", current_amount: "1234,56", paid_amount: "0", balance_amount: "999,99" }), finance({ external_id: "2", source_status: "cancelado", paid_amount: "10", paid_at: "25/11/2026", balance_amount: "0" }), finance({ external_id: "3", source_status: "cancelado", paid_amount: "0", balance_amount: "0" })]);
  assert.equal(result.summary.valid, 1);
  assert.ok(has(result.rows[0], /contraditórios/));
  assert.ok(has(result.rows[1], /cancelado contém baixa/));
});

test("ajustes financeiros são preservados e payable ajustado fica bloqueado", async () => {
  const record = finance({ original_amount: "100,00", current_amount: "107,00", paid_amount: "0", balance_amount: "107,00", interest_amount: "5,00", penalty_amount: "3,00", discount_amount: "1,00", source_project: "PBH-0001", sale_reference: "VENDA-001" });
  const payable = await parse("payable", [record]);
  assert.ok(has(payable.rows[0], /atualizado diferente/));
  const receivable = await parse("receivable", [record]);
  assert.equal(receivable.summary.valid, 1);
  assert.equal(receivable.rows[0].normalized_data.interest_amount, "5.00");
  assert.equal(receivable.rows[0].normalized_data.correction_amount, null);
  assert.equal(receivable.rows[0].normalized_data.source_project, "PBH-0001");
  assert.equal(receivable.rows[0].normalized_data.category, "other");
  assert.ok(receivable.rows[0].warnings.some(warning => /Categoria/.test(warning)));
});

test("diferença sem componentes não é inferida como correção e baixa zero é bloqueada", async () => {
  const result = await parse("receivable", [
    finance({ external_id: "1", original_amount: "100,00", current_amount: "107,00", paid_amount: "0", balance_amount: "107,00" }),
    finance({ external_id: "2", original_amount: "100,00", source_status: "Pago", paid_amount: "107,00", paid_at: "25/11/2026" }),
    finance({ external_id: "3", original_amount: "100,00", source_status: "Pago", paid_amount: "0", discount_amount: "100,00", paid_at: "25/11/2026" }),
  ]);
  assert.equal(result.summary.blocked, 3);
  assert.ok(has(result.rows[0], /componentes da diferença/));
  assert.ok(has(result.rows[1], /componentes da diferença/));
  assert.equal(result.rows[0].normalized_data.correction_amount, null);
  assert.ok(has(result.rows[2], /maior que zero/));
});

test("categoria desconhecida preserva source_category e não inventa mensal", async () => {
  const result = await parse("receivable", [finance({ external_id: "1", category: "Reforço" }), finance({ external_id: "2", category: "Aporte especial" })]);
  assert.equal(result.rows[0].normalized_data.category, "reinforcement");
  assert.equal(result.rows[1].normalized_data.category, "other");
  assert.equal(result.rows[1].normalized_data.source_category, "Aporte especial");
});

test("fórmula XLSX sem cache bloqueia; cache numérico é usado sem executar", async () => {
  const headers = ["external_id", "due_date", "original_amount", "source_status"];
  const bytes = await xlsx([headers, ["1", "26/11/2026", { formula: "1+1" }, "aberto"], ["2", "26/11/2026", { formula: "1+1", result: 2 }, "aberto"]]);
  const result = await parseImportFile(bytes, "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) });
  assert.ok(has(result.rows[0], /Fórmula sem resultado/));
  assert.equal(result.rows[1].normalized_data.original_amount, "2.00");
  assert.equal(result.rows[1].errors.length, 0);
  assert.ok(result.rows[1].warnings.some(warning => /sem executar/.test(warning)));
  assert.deepEqual(result.rows[1].raw_data.original_amount, { formula: "1+1", result: 2, lexeme: "2", error: null });
});

test("cache de fórmula marcado para recálculo e referência externa são bloqueados", async () => {
  const headers = ["external_id", "due_date", "original_amount", "source_status"];
  const bytes = await xlsx([headers, ["1", "26/11/2026", { formula: "1+1", result: 2 }, "aberto"]], workbook => { workbook.calcProperties.fullCalcOnLoad = true; });
  const result = await parseImportFile(bytes, "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) });
  assert.ok(has(result.rows[0], /Fórmula sem resultado/));
  assert.equal(result.rows[0].normalized_data.original_amount, null);
  assert.equal(result.rows[0].normalized_data.current_amount, null);
  assert.equal(result.rows[0].normalized_data.balance_amount, null);
  const external = await xlsx([headers, ["1", "26/11/2026", { formula: "'[origem.xlsx]Plan1'!A1", result: 2 }, "aberto"]]);
  const resultExternal = await parseImportFile(external, "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) });
  assert.ok(has(resultExternal.rows[0], /Fórmula sem resultado/));
  const statusCache = await xlsx([headers, ["1", "26/11/2026", 100, { formula: 'IF(1=1,"aberto","pago")', result: "aberto" }]], workbook => { workbook.calcProperties.fullCalcOnLoad = true; });
  const resultStatus = await parseImportFile(statusCache, "dados.xlsx", { entityKind: "payable", columnMapping: fieldMap(headers) });
  assert.equal(resultStatus.rows[0].normalized_data.status, "unknown");
  assert.equal(resultStatus.rows[0].normalized_data.paid_amount, null);
  assert.equal(resultStatus.rows[0].normalized_data.balance_amount, null);
});

test("rejeita XLS, XLSM, XLSX falso e macros dentro de arquivo renomeado", async () => {
  for (const name of ["arquivo.xls", "arquivo.xlsm", "arquivo.xlsb"]) await assert.rejects(inspectImportFile(Buffer.from("x"), name), /CSV, TSV ou XLSX/);
  await assert.rejects(inspectImportFile(Buffer.from("não é zip"), "arquivo.xlsx"), /XLSX inválido/);
  const bytes = await xlsx([["id", "nome"], ["1", "Empresa"]]);
  const zip = await JSZip.loadAsync(bytes); zip.file("xl/vbaProject.bin", "synthetic macro marker");
  await assert.rejects(inspectImportFile(await zip.generateAsync({ type: "nodebuffer" }), "arquivo.xlsx"), /macros/i);
});

test("XLSX com configuração binária de impressão continua legível", async () => {
  const bytes = await xlsx([["id", "nome"], ["1", "Empresa"]]);
  const zip = await JSZip.loadAsync(bytes);
  zip.file("xl/printerSettings/printerSettings1.bin", Buffer.from([0, 1, 2, 3]));
  const result = await inspectImportFile(await zip.generateAsync({ type: "nodebuffer" }), "arquivo.xlsx");
  assert.equal(result.sheets[0].samples[0].nome, "Empresa");
});

test("limites de arquivo, linhas, colunas e ZIP não truncam dados silenciosamente", async () => {
  await assert.rejects(inspectImportFile(Buffer.alloc(MAX_FILE_BYTES + 1, 65), "arquivo.csv"), /4 MB/);
  const tooMany = csv(["id", "nome"], Array.from({ length: MAX_ROWS + 1 }, (_, i) => [String(i), "Empresa"]));
  await assert.rejects(inspectImportFile(tooMany, "arquivo.csv"), /2000/);
  const tooWide = csv(Array.from({ length: 129 }, (_, i) => `coluna${i}`), [Array.from({ length: 129 }, () => "x")]);
  await assert.rejects(inspectImportFile(tooWide, "arquivo.csv"), /colunas|células/);
  const bytes = await xlsx([["id", "nome"], ["1", "Empresa"]]);
  const zip = await JSZip.loadAsync(bytes); zip.file("padding.xml", "x".repeat(16 * 1024 * 1024 + 1));
  await assert.rejects(inspectImportFile(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), "arquivo.xlsx"), /descompactado/);
});

test("mapeamento ausente ou para coluna inexistente não permite leitura parcial", async () => {
  const bytes = csv(["id", "nome"], [["1", "Empresa"]]);
  await assert.rejects(parseImportFile(bytes, "arquivo.csv", { entityKind: "supplier", columnMapping: { name: "nome" } }), /obrigatória/);
  await assert.rejects(parseImportFile(bytes, "arquivo.csv", { entityKind: "supplier", columnMapping: { external_id: "outra", name: "nome" } }), /não encontrada/);
  await assert.rejects(parseImportFile(bytes, "arquivo.csv", { entityKind: "supplier", columnMapping: { external_id: "id", name: "nome", ignored_field: "id" } }), /desconhecido/);
});

test("raw_data não perde cabeçalho reservado de objeto", async () => {
  const bytes = csv(["id", "nome", "__proto__"], [["1", "Empresa", "dado literal"]]);
  const result = await parseImportFile(bytes, "arquivo.csv", { entityKind: "supplier", columnMapping: { external_id: "id", name: "nome" } });
  assert.equal(Object.hasOwn(result.rows[0].raw_data, "__proto__"), true);
  assert.equal(result.rows[0].raw_data.__proto__, "dado literal");
  assert.equal({}.polluted, undefined);
});
