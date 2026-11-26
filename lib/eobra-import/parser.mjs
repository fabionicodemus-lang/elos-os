import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { posix } from "node:path";
import { SaxesParser } from "saxes";

export const ENTITY_KINDS = Object.freeze(["supplier", "client", "payable", "receivable"]);
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_ROWS = 2000;

const MAX_COLUMNS = 128;
const MAX_CELLS = 200_000;
const MAX_CELL_CHARS = 32_768;
const MAX_HEADER_ROW = 100;
const MAX_SHEETS = 20;
const MAX_ZIP_ENTRIES = 256;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_MONEY_CENTS = 9_999_999_999_999_999n;

const field = (key, label, aliases, required = false) => Object.freeze({ key, label, aliases, required });
const contacts = [
  field("external_id", "ID na origem", ["id", "codigo", "código", "id origem", "id fornecedor", "codigo fornecedor", "id cliente", "codigo cliente", "external_id"], true),
  field("name", "Nome / razão social", ["nome", "razao social", "razão social", "nome fornecedor", "fornecedor", "nome cliente", "cliente", "nome razao social", "name"], true),
  field("tax_id", "CPF / CNPJ", ["cpf cnpj", "cpf/cnpj", "cnpj cpf", "cnpj", "cpf", "documento fiscal", "tax_id"]),
  field("person_type", "Tipo de pessoa", ["tipo pessoa", "tipo de pessoa", "pessoa", "pf pj", "person_type"]),
  field("email", "E-mail", ["email", "e-mail", "correio eletronico"]),
  field("phone", "Telefone", ["telefone", "celular", "fone", "whatsapp", "phone"]),
  field("address", "Endereço", ["endereco", "endereço", "logradouro", "address"]),
  field("city", "Cidade", ["cidade", "municipio", "município", "city"]),
  field("state", "UF", ["uf", "estado", "state"]),
  field("notes", "Observações", ["observacoes", "observações", "observacao", "notas", "notes"]),
  field("status", "Situação do cadastro", ["status", "situacao", "situação", "ativo", "situacao cadastro"]),
];

const financial = [
  field("external_id", "ID único da parcela na origem", ["id", "id titulo", "id título", "id parcela", "codigo titulo", "codigo parcela", "codigo", "código", "external_id"], true),
  field("description", "Descrição", ["descricao", "descrição", "historico", "histórico", "description"]),
  field("document", "Documento", ["documento", "numero documento", "n documento", "nota fiscal", "document"]),
  field("installment_label", "Parcela", ["parcela", "numero parcela", "n parcela", "installment_label"]),
  field("due_date", "Vencimento", ["vencimento", "data vencimento", "data de vencimento", "dt vencimento", "due_date"], true),
  field("original_amount", "Valor original", ["valor original", "valor titulo", "valor da parcela", "valor parcela", "valor nominal", "valor", "original_amount"], true),
  field("current_amount", "Valor atualizado", ["valor atualizado", "valor atual", "valor corrigido", "valor total atualizado", "current_amount"]),
  field("paid_amount", "Valor pago / recebido", ["valor pago", "valor recebido", "valor baixado", "valor liquidado", "total pago", "total recebido", "paid_amount"]),
  field("balance_amount", "Saldo em aberto", ["saldo", "saldo aberto", "saldo em aberto", "valor em aberto", "valor pendente", "balance_amount"]),
  field("source_status", "Situação na origem", ["status", "situacao", "situação", "situacao titulo", "situacao parcela", "source_status"], true),
  field("paid_at", "Data do pagamento / recebimento", ["data pagamento", "data de pagamento", "data recebimento", "data de recebimento", "data baixa", "data liquidacao", "paid_at"]),
  field("paid_account_name", "Conta de liquidação na origem", ["conta", "conta bancaria", "conta pagamento", "conta recebimento", "banco conta", "paid_account_name"]),
  field("counterparty_external_id", "ID do fornecedor / cliente", ["id fornecedor", "codigo fornecedor", "id cliente", "codigo cliente", "id favorecido", "counterparty_external_id"]),
  field("counterparty_tax_id", "CPF / CNPJ do fornecedor / cliente", ["cpf cnpj", "cpf/cnpj", "cnpj", "cpf", "cnpj fornecedor", "cpf cliente", "documento favorecido", "counterparty_tax_id"]),
  field("counterparty_name", "Fornecedor / cliente", ["fornecedor", "cliente", "favorecido", "beneficiario", "beneficiário", "nome fornecedor", "nome cliente", "counterparty_name"]),
  field("sale_reference", "Venda / contrato na origem", ["id venda", "codigo venda", "venda", "contrato", "numero contrato", "contrato venda", "sale_reference"]),
  field("source_project", "Obra na origem", ["obra", "empreendimento", "projeto", "centro custo obra", "id obra", "codigo obra", "source_project"]),
  field("category", "Categoria da parcela", ["categoria", "tipo parcela", "tipo de parcela", "categoria parcela", "category"]),
  field("interest_amount", "Juros", ["juros", "valor juros", "interest_amount"]),
  field("penalty_amount", "Multa", ["multa", "valor multa", "penalty_amount"]),
  field("correction_amount", "Correção monetária", ["correcao", "correção", "correcao monetaria", "valor correcao", "correction_amount"]),
  field("other_accrual_amount", "Outros acréscimos", ["outros acrescimos", "outros acréscimos", "acrescimos", "acréscimos", "other_accrual_amount"]),
  field("discount_amount", "Desconto", ["desconto", "valor desconto", "discount_amount"]),
  field("bank_identifier", "Identificador bancário / nosso número", ["nosso numero", "nosso número", "id boleto", "identificador bancario", "bank_identifier"]),
  field("bank_agreement", "Convênio de cobrança na origem", ["convenio", "convênio", "convenio cobranca", "bank_agreement"]),
  field("notes", "Observações", ["observacoes", "observações", "observacao", "notas", "notes"]),
];

export const FIELD_DEFINITIONS = Object.freeze({
  supplier: Object.freeze([...contacts]), client: Object.freeze([...contacts]),
  payable: Object.freeze([...financial]), receivable: Object.freeze([...financial]),
});

const normalized = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const text = value => value == null ? "" : value instanceof Date ? value.toISOString() : String(value).trim();
const nonempty = cell => cell != null && (cell.formula != null || cell.problem != null || text(cell.value) !== "");
const plainCell = value => ({ value, kind: typeof value, format: "", formula: null, problem: null });

function requireKind(kind) {
  if (!ENTITY_KINDS.includes(kind)) throw new Error("Tipo de importação inválido.");
}

function inputBytes(bytes, fileName, headerRow) {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new Error("Conteúdo do arquivo inválido.");
  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  if (!buffer.length) throw new Error("O arquivo está vazio.");
  if (buffer.length > MAX_FILE_BYTES) throw new Error("O arquivo ultrapassa o limite de 4 MB.");
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > MAX_HEADER_ROW) {
    throw new Error(`A linha de cabeçalho deve estar entre 1 e ${MAX_HEADER_ROW}.`);
  }
  const extension = String(fileName ?? "").toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (!["csv", "tsv", "xlsx"].includes(extension)) throw new Error("Use CSV, TSV ou XLSX. XLS, XLSB e arquivos com macros não são aceitos.");
  return { buffer, extension };
}

function decodeCsv(buffer) {
  let encoding = "utf-8";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = "utf-16le";
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = "utf-16be";
  else {
    const n = Math.min(buffer.length, 256);
    let even = 0; let odd = 0;
    for (let i = 0; i < n; i += 1) if (buffer[i] === 0) {
      if (i % 2) odd++;
      else even++;
    }
    if (odd > n / 5 && even < n / 20) encoding = "utf-16le";
    else if (even > n / 5 && odd < n / 20) encoding = "utf-16be";
  }
  let decoded;
  try { decoded = new TextDecoder(encoding, { fatal: true }).decode(buffer); }
  catch {
    if (encoding !== "utf-8") throw new Error("O CSV tem codificação UTF-16 inválida.");
    encoding = "windows-1252";
    decoded = new TextDecoder(encoding, { fatal: true }).decode(buffer);
  }
  if (decoded.includes("\0")) throw new Error("O CSV contém bytes nulos ou não é um arquivo de texto válido.");
  return decoded.replace(/^\uFEFF/, "");
}

// Logical records preserve physical start lines, including quoted multiline fields.
function csvRecords(source, separator) {
  const records = [];
  let cells = []; let value = ""; let quoted = false; let afterQuote = false;
  let line = 1; let startLine = 1; let cellCount = 0;
  const finishCell = () => {
    if (value.length > MAX_CELL_CHARS) throw new Error("Uma célula excede o limite de texto permitido.");
    cells.push(plainCell(value)); value = ""; afterQuote = false; cellCount++;
    if (cells.length > MAX_COLUMNS || cellCount > MAX_CELLS) throw new Error("O arquivo excede o limite de colunas ou células.");
  };
  const finishRow = () => {
    finishCell(); records.push({ sourceRow: startLine, cells }); cells = [];
    if (records.length > MAX_ROWS + MAX_HEADER_ROW + 1) throw new Error(`O arquivo excede o limite de ${MAX_ROWS} registros.`);
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else if (ch === "\r" || ch === "\n") {
        value += "\n";
        if (ch === "\r" && source[i + 1] === "\n") i++;
        line++;
      } else value += ch;
    } else if (ch === separator) finishCell();
    else if (ch === "\r" || ch === "\n") {
      finishRow(); if (ch === "\r" && source[i + 1] === "\n") i++;
      line++; startLine = line;
    } else if (ch === '"') {
      if (value !== "" || afterQuote) throw new Error(`Aspas inválidas no CSV, linha ${line}.`);
      quoted = true;
    } else if (afterQuote) {
      if (!/[ \t]/.test(ch)) throw new Error(`Texto após fechamento de aspas no CSV, linha ${line}.`);
    } else value += ch;
    if (value.length > MAX_CELL_CHARS) throw new Error("Uma célula excede o limite de texto permitido.");
  }
  if (quoted) throw new Error("O CSV contém aspas sem fechamento.");
  if (value !== "" || cells.length || afterQuote) finishRow();
  return records;
}

function readCsv(buffer, extension, headerRow) {
  const source = decodeCsv(buffer);
  const candidates = extension === "tsv" ? ["\t"] : [";", ",", "\t"];
  const parsed = []; const failures = [];
  for (const separator of candidates) {
    try {
      const records = csvRecords(source, separator);
      const header = records[headerRow - 1];
      const width = header?.cells.length ?? 0;
      const sample = records.slice(headerRow).filter(r => r.cells.some(nonempty)).slice(0, 50);
      const matches = sample.filter(r => r.cells.length === width).length;
      parsed.push({ records, width, score: (width > 1 ? 1000 : 0) + (sample.length ? matches / sample.length : 1) * 100 + Math.min(width, 20) });
    } catch (error) { failures.push(error); }
  }
  parsed.sort((a, b) => b.score - a.score);
  if (!parsed.length) throw failures[0] ?? new Error("Não foi possível interpretar o CSV.");
  if (parsed[0].width === 1 && failures.length) throw failures[0];
  return [{ name: "CSV", records: parsed[0].records, date1904: false }];
}

function columnNumber(reference) {
  const match = String(reference).match(/^([A-Z]+)[1-9]\d*$/i);
  if (!match) throw new Error("Referência de célula XLSX inválida.");
  let value = 0;
  for (const char of match[1].toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64;
  return value;
}

function readXml(xml, handlers) {
  const parser = new SaxesParser();
  for (const [event, handler] of Object.entries(handlers)) parser.on(event, handler);
  parser.on("error", () => { throw new Error("Estrutura XML inválida no XLSX."); });
  parser.write(xml).close();
}

// Read the original numeric spelling before ExcelJS converts it to a JS double.
function worksheetNumericLexemes(xml, headerRow) {
  const numbers = new Map();
  let cell = null; let inValue = false; let value = "";
  readXml(xml, {
    opentag(node) {
      if (node.name === "mergeCell") {
        const range = String(node.attributes.ref ?? "");
        const match = range.match(/^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/i);
        if (!match) throw new Error("Intervalo de células mescladas inválido no XLSX.");
        if (Math.max(Number(match[2]), Number(match[4])) > headerRow) {
          throw new Error(`Há células mescladas na área de dados (${range}). Desfaça a mesclagem e preencha cada linha explicitamente antes de importar.`);
        }
        if (columnNumber(`${match[1]}${match[2]}`) > MAX_COLUMNS || columnNumber(`${match[3]}${match[4]}`) > MAX_COLUMNS) {
          throw new Error("O XLSX contém uma mesclagem além do limite de colunas.");
        }
      }
      if (node.name === "c") cell = { address: String(node.attributes.r ?? "").toUpperCase(), type: node.attributes.t ?? "n" };
      if (node.name === "v" && cell) { inValue = true; value = ""; }
    },
    text(part) { if (inValue) value += part; },
    cdata(part) { if (inValue) value += part; },
    closetag(node) {
      if (node.name === "v" && cell) {
        if (cell.type === "n") {
          if (value.length > MAX_CELL_CHARS) throw new Error("Uma célula excede o limite de texto permitido.");
          numbers.set(cell.address, value.trim());
        }
        inValue = false;
      }
      if (node.name === "c") { cell = null; inValue = false; }
    },
  });
  return numbers;
}

function decimalIdentity(value) {
  const match = String(value).match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? "";
  let digits = `${match[2] ?? ""}${fraction}`.replace(/^0+/, "");
  if (!digits) return "0";
  const trailingZeros = digits.length - digits.replace(/0+$/, "").length;
  digits = digits.slice(0, digits.length - trailingZeros);
  const exponent = BigInt(match[5] ?? "0") - BigInt(fraction.length) + BigInt(trailingZeros);
  return `${match[1] === "-" ? "-" : ""}${digits}e${exponent}`;
}

// Validate and bounded-decompress ZIP entries before handing the workbook to ExcelJS.
function inspectZip(buffer, headerRow) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw new Error("XLSX inválido: diretório ZIP não encontrado.");
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== count
    || count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) throw new Error("XLSX multipartes ou ZIP64 não é aceito.");
  if (!count || count > MAX_ZIP_ENTRIES || directoryOffset + directorySize > end) throw new Error("Estrutura ou quantidade de entradas XLSX inválida.");
  let pos = directoryOffset; let totalBytes = 0; let totalCells = 0; let sheetCount = 0;
  let needsRecalculation = false;
  const names = new Set();
  const worksheetNumbers = new Map(); const workbookSheets = []; const relationships = new Map();
  for (let index = 0; index < count; index++) {
    if (pos + 46 > end || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Diretório XLSX corrompido.");
    const flags = buffer.readUInt16LE(pos + 8); const method = buffer.readUInt16LE(pos + 10);
    const packed = buffer.readUInt32LE(pos + 20); const size = buffer.readUInt32LE(pos + 24);
    const nameSize = buffer.readUInt16LE(pos + 28); const extraSize = buffer.readUInt16LE(pos + 30); const commentSize = buffer.readUInt16LE(pos + 32);
    const local = buffer.readUInt32LE(pos + 42);
    if (pos + 46 + nameSize + extraSize + commentSize > end) throw new Error("Entrada XLSX incompleta.");
    const name = buffer.subarray(pos + 46, pos + 46 + nameSize).toString("utf8");
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || names.has(name)) throw new Error("Nome de entrada XLSX inválido ou duplicado.");
    names.add(name);
    if ((flags & 0x41) || ![0, 8].includes(method)) throw new Error("XLSX criptografado ou com compressão não suportada.");
    if (/vbaProject|(?:^|\/)(?:macrosheets|activeX|embeddings)(?:\/|$)/i.test(name)) throw new Error("Planilhas com macros ou conteúdo ativo incorporado não são aceitas.");
    if (size > MAX_ZIP_ENTRY_BYTES || (totalBytes += size) > MAX_ZIP_BYTES) throw new Error("O XLSX excede o limite de tamanho descompactado.");
    if (local + 30 > directoryOffset || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("Entrada local XLSX inválida.");
    const localNameSize = buffer.readUInt16LE(local + 26); const localExtraSize = buffer.readUInt16LE(local + 28);
    const start = local + 30 + localNameSize + localExtraSize;
    if (start + packed > directoryOffset || buffer.subarray(local + 30, local + 30 + localNameSize).toString("utf8") !== name) throw new Error("Tamanho ou nome de entrada XLSX inconsistente.");
    let inflated;
    try { inflated = method === 0 ? buffer.subarray(start, start + packed) : inflateRawSync(buffer.subarray(start, start + packed), { maxOutputLength: MAX_ZIP_ENTRY_BYTES }); }
    catch { throw new Error("Entrada XLSX corrompida ou acima do limite descompactado."); }
    if (inflated.length !== size) throw new Error("Tamanho descompactado XLSX inconsistente.");
    if (/\.xml$|\.rels$/i.test(name)) {
      const xml = inflated.toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Declarações XML externas não são aceitas.");
      if (/macroEnabled|vbaProject/i.test(xml)) throw new Error("Planilhas com macros não são aceitas.");
      if (name === "xl/workbook.xml") readXml(xml, { opentag(node) {
        if (node.name === "sheet") workbookSheets.push({ name: node.attributes.name, relationship: node.attributes["r:id"] });
        if (node.name === "calcPr") needsRecalculation = ["fullCalcOnLoad", "forceFullCalc"].some(key => ["1", "true"].includes(node.attributes[key])) || ["0", "false"].includes(node.attributes.calcCompleted);
      } });
      if (name === "xl/_rels/workbook.xml.rels") readXml(xml, { opentag(node) {
        if (node.name === "Relationship") relationships.set(node.attributes.Id, node.attributes);
      } });
      if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
        sheetCount++;
        if (sheetCount > MAX_SHEETS) throw new Error(`O XLSX excede o limite de ${MAX_SHEETS} abas.`);
        for (const match of xml.matchAll(/<row\b[^>]*\br=["'](\d+)["']/g)) if (Number(match[1]) > MAX_ROWS + MAX_HEADER_ROW) throw new Error(`A planilha excede o limite de ${MAX_ROWS} linhas de dados. Remova linhas excedentes e formatação residual.`);
        for (const match of xml.matchAll(/<c\b[^>]*\br=["']([^"']+)["']/g)) {
          if (++totalCells > MAX_CELLS || columnNumber(match[1]) > MAX_COLUMNS) throw new Error("O XLSX excede o limite de células ou colunas.");
        }
        for (const match of xml.matchAll(/<col\b[^>]*\bmax=["'](\d+)["']/g)) if (Number(match[1]) > MAX_COLUMNS) throw new Error("O XLSX declara colunas além do limite permitido.");
        worksheetNumbers.set(name, worksheetNumericLexemes(xml, headerRow));
      }
    }
    pos += 46 + nameSize + extraSize + commentSize;
  }
  if (pos !== directoryOffset + directorySize || !names.has("[Content_Types].xml") || !names.has("xl/workbook.xml")) throw new Error("O arquivo não é uma pasta de trabalho XLSX válida.");
  const numericBySheet = new Map();
  for (const sheet of workbookSheets) {
    const relationship = relationships.get(sheet.relationship);
    if (!relationship || relationship.TargetMode === "External") throw new Error("Referência de aba XLSX inválida ou externa.");
    const path = posix.resolve("/xl", relationship.Target).slice(1);
    const numbers = worksheetNumbers.get(path);
    if (numbers) numericBySheet.set(sheet.name, numbers);
  }
  return { needsRecalculation, numericBySheet };
}

function excelCell(cell, needsRecalculation, numericLexeme) {
  let value = cell.value; let formula = null; let problem = null;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("formula" in value || "sharedFormula" in value) {
      formula = value.formula ?? `compartilhada:${value.sharedFormula}`;
      const hasResult = Object.hasOwn(value, "result") && value.result != null && value.result !== "";
      const cached = value.result;
      if (!hasResult || (typeof cached === "object" && !(cached instanceof Date)) || needsRecalculation
        || /\[[^\]]*\]|\b(?:NOW|TODAY|RAND|RANDBETWEEN|WEBSERVICE|DDE|INDIRECT)\s*\(/i.test(formula)) {
        problem = "Fórmula sem resultado armazenado confiável; substitua por valores antes de importar.";
      }
      value = cached ?? null;
    } else if ("richText" in value) value = value.richText.map(part => part.text ?? "").join("");
    else if ("hyperlink" in value) value = value.text ?? value.hyperlink;
    else if ("error" in value) { problem = `Célula contém erro do Excel (${value.error}).`; value = null; }
    else { problem = "Tipo de célula não suportado; substitua por texto ou valor."; value = null; }
  }
  if (numericLexeme != null) {
    const numeric = Number(numericLexeme);
    if (!Number.isFinite(numeric) || decimalIdentity(numericLexeme) == null || decimalIdentity(numericLexeme) !== decimalIdentity(String(numeric))) {
      problem = "Número XLSX não pode ser representado sem perda de precisão; exporte a célula como texto.";
    }
  }
  if (typeof value === "number" && !Number.isFinite(value)) problem = "Valor numérico não finito.";
  if (text(value).length > MAX_CELL_CHARS) throw new Error("Uma célula excede o limite de texto permitido.");
  return { value, kind: value instanceof Date ? "date" : typeof value, format: cell.numFmt ?? "", formula, problem, numericLexeme };
}

async function readXlsx(buffer, headerRow) {
  const validation = inspectZip(buffer, headerRow);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new Error("Não foi possível ler o XLSX. Verifique se está íntegro e sem proteção."); }
  if (workbook.worksheets.length > MAX_SHEETS) throw new Error(`O XLSX excede o limite de ${MAX_SHEETS} abas.`);
  return workbook.worksheets.map(sheet => {
    if (sheet.rowCount > MAX_ROWS + MAX_HEADER_ROW || sheet.columnCount > MAX_COLUMNS) throw new Error("A planilha excede o limite de linhas ou colunas.");
    const numericLexemes = validation.numericBySheet.get(sheet.name);
    if (!numericLexemes) throw new Error("Não foi possível conferir os números originais de uma aba do XLSX.");
    const records = [];
    for (let index = 1; index <= sheet.rowCount; index++) {
      const row = sheet.getRow(index); const cells = [];
      for (let column = 1; column <= row.cellCount; column++) {
        const cell = row.getCell(column);
        cells.push(excelCell(cell, validation.needsRecalculation, numericLexemes.get(cell.address)));
      }
      records.push({ sourceRow: index, cells });
    }
    return { name: sheet.name, records, date1904: Boolean(workbook.properties.date1904) };
  });
}

function prepareSheet(sheet, headerRow) {
  const headerRecord = sheet.records[headerRow - 1];
  const records = sheet.records.slice(headerRow).filter(record => record.cells.some(nonempty));
  const relevant = [headerRecord, ...records].filter(Boolean);
  let width = 0;
  for (const record of relevant) record.cells.forEach((cell, index) => { if (nonempty(cell)) width = Math.max(width, index + 1); });
  if (width > MAX_COLUMNS) throw new Error(`A aba ${sheet.name} excede ${MAX_COLUMNS} colunas.`);
  if (records.length > MAX_ROWS) throw new Error(`A aba ${sheet.name} excede ${MAX_ROWS} registros.`);
  if (!headerRecord && records.length) throw new Error(`Cabeçalho não encontrado na aba ${sheet.name}.`);
  const seen = new Set(); const headers = [];
  for (let index = 0; index < width; index++) {
    const cell = headerRecord?.cells[index];
    if (cell?.formula || cell?.problem) throw new Error(`O cabeçalho da aba ${sheet.name} não pode conter fórmulas ou erros.`);
    const label = text(cell?.value) || `Coluna ${index + 1} (sem cabeçalho)`;
    const key = normalized(label);
    if (seen.has(key)) throw new Error(`Cabeçalho duplicado na aba ${sheet.name}: ${label}. Renomeie as colunas para evitar sobrescrita.`);
    seen.add(key); headers.push(label);
  }
  return { ...sheet, headers, records };
}

async function readFile(bytes, fileName, headerRow) {
  const { buffer, extension } = inputBytes(bytes, fileName, headerRow);
  const raw = extension === "xlsx" ? await readXlsx(buffer, headerRow) : readCsv(buffer, extension, headerRow);
  const sheets = raw.map(sheet => prepareSheet(sheet, headerRow));
  if (sheets.reduce((sum, sheet) => sum + sheet.records.length, 0) > MAX_ROWS) throw new Error(`O arquivo excede ${MAX_ROWS} registros somando todas as abas. Divida a exportação em arquivos menores.`);
  return sheets;
}

function stringCell(cell) {
  if (!cell || cell.problem) return "";
  if (cell.kind === "number" && Number.isSafeInteger(cell.value) && cell.value >= 0 && /^0+$/.test(cell.format)) {
    return String(cell.value).padStart(Math.min(cell.format.length, 64), "0");
  }
  return text(cell.value);
}

export async function inspectImportFile(bytes, fileName, { headerRow = 1 } = {}) {
  const sheets = await readFile(bytes, fileName, headerRow);
  return { sheets: sheets.map(sheet => ({
    name: sheet.name, headers: sheet.headers, rowCount: sheet.records.length,
    samples: sheet.records.slice(0, 5).map(record => Object.fromEntries(sheet.headers.map((header, index) => {
      const cell = record.cells[index];
      return [header, cell?.problem ? `[${cell.problem}]` : cell?.formula ? `${stringCell(cell)} [resultado de fórmula]` : stringCell(cell)];
    }))),
  })) };
}

export function suggestColumnMapping(headers, kind) {
  requireKind(kind);
  const mapping = {}; const used = new Set();
  for (const definition of FIELD_DEFINITIONS[kind]) {
    const aliases = new Set([definition.key, ...definition.aliases].map(normalized));
    const candidates = headers.filter(header => !used.has(header) && aliases.has(normalized(header)));
    if (candidates.length === 1) { mapping[definition.key] = candidates[0]; used.add(candidates[0]); }
  }
  return mapping;
}

function identifier(cell, label, errors, required = false) {
  if (cell?.problem) return null;
  const value = stringCell(cell);
  if (!value) { if (required) errors.push(`${label}: obrigatório.`); return null; }
  if (cell.kind === "date" || typeof cell.value === "boolean") errors.push(`${label}: use um identificador textual.`);
  if (cell.kind === "number" && (!Number.isSafeInteger(cell.value) || cell.value < 0)) errors.push(`${label}: número inseguro, fracionário ou negativo; exporte como texto.`);
  if (/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)[eE][+-]?\d+$/.test(cell.numericLexeme ?? value) || /[Ee][+-]0/.test(cell.format ?? "")) errors.push(`${label}: notação científica não é aceita; exporte o ID completo como texto.`);
  if (/^-\d+(?:[.,]\d+)?$/.test(value)) errors.push(`${label}: identificador numérico negativo não é aceito.`);
  return value;
}

function validTaxId(value) {
  if (!/^\d{11}$|^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const check = (base, weights) => { const mod = [...base].reduce((sum, digit, i) => sum + Number(digit) * weights[i], 0) % 11; return mod < 2 ? 0 : 11 - mod; };
  if (value.length === 11) {
    const first = check(value.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = check(`${value.slice(0, 9)}${first}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return value.endsWith(`${first}${second}`);
  }
  const first = check(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = check(`${value.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${first}${second}`);
}

function taxId(cell, label, errors) {
  const value = identifier(cell, label, errors);
  if (!value) return null;
  if (!/^[\d.\-/\s]+$/.test(value)) errors.push(`${label}: contém caracteres que não pertencem a CPF/CNPJ.`);
  const digits = value.replace(/\D/g, "");
  if (!validTaxId(digits)) errors.push(`${label}: CPF/CNPJ inválido; confira os dígitos e os zeros à esquerda.`);
  return digits || null;
}

function isoDate(year, month, day) {
  if (year < 1900 || year > 2199) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

function dateValue(cell, label, errors, date1904, required = false) {
  if (cell?.problem) return null;
  if (!nonempty(cell)) { if (required) errors.push(`${label}: obrigatório.`); return null; }
  let result = null;
  if (cell.value instanceof Date && !Number.isNaN(cell.value.getTime())) result = isoDate(cell.value.getUTCFullYear(), cell.value.getUTCMonth() + 1, cell.value.getUTCDate());
  else if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
    const serial = Math.floor(cell.value);
    if (serial >= (date1904 ? 0 : 1) && (date1904 || serial !== 60) && serial < 109_574) {
      const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : serial < 60 ? 31 : 30);
      const date = new Date(epoch + serial * 86_400_000);
      result = isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  } else {
    const raw = text(cell.value);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/);
    const br = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?: (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)?$/);
    if (match) result = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    else if (br) result = isoDate(Number(br[3]), Number(br[2]), Number(br[1]));
  }
  if (!result) errors.push(`${label}: data inválida; use DD/MM/AAAA ou AAAA-MM-DD.`);
  return result;
}

function money(cell, label, errors, required = false) {
  if (cell?.problem) return null;
  if (!nonempty(cell)) { if (required) errors.push(`${label}: obrigatório.`); return null; }
  const fail = () => { errors.push(`${label}: valor inválido, negativo, ambíguo ou com mais de duas casas decimais.`); return null; };
  if (cell.kind === "date" || typeof cell.value === "boolean") return fail();
  if (typeof cell.value === "number" && (!Number.isFinite(cell.value) || Math.abs(cell.value) > Number.MAX_SAFE_INTEGER / 100)) return fail();
  let raw = text(cell.numericLexeme ?? cell.value).replace(/\s/g, "").replace(/^(?:R\$|BRL)/i, "").replace(/(?:BRL)$/i, "").replace(/^\+/, "");
  if (!raw || /[eE()\-]/.test(raw)) return fail();
  let integer; let fraction = "";
  if (raw.includes(",") && raw.includes(".")) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      if (!/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(raw)) return fail();
      [integer, fraction] = raw.replace(/\./g, "").split(",");
    } else {
      if (!/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(raw)) return fail();
      [integer, fraction] = raw.replace(/,/g, "").split(".");
    }
  } else if (raw.includes(",")) {
    if (!/^\d+,\d{1,2}$/.test(raw)) return fail();
    [integer, fraction] = raw.split(",");
  } else if (raw.includes(".")) {
    if (/^\d+\.\d{1,2}$/.test(raw)) [integer, fraction] = raw.split(".");
    else if (typeof cell.value !== "number" && /^\d{1,3}(?:\.\d{3})+$/.test(raw)) integer = raw.replace(/\./g, "");
    else return fail();
  } else {
    if (!/^\d+$/.test(raw)) return fail();
    integer = raw;
  }
  if (integer.length > 16) return fail();
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  return cents <= MAX_MONEY_CENTS ? cents : fail();
}

function decimal(cents) {
  return cents == null ? null : `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

const statusGroups = {
  open: ["open", "aberto", "aberta", "em aberto", "a pagar", "a receber", "pendente", "em atraso", "atrasado", "atrasada", "vencido", "vencida", "a vencer", "previsto", "pending", "overdue", "unpaid"],
  paid: ["paid", "pago", "paga", "quitado", "quitada", "recebido", "recebida", "liquidado", "liquidada", "baixado", "baixada", "settled"],
  cancelled: ["cancelled", "canceled", "cancelado", "cancelada", "anulado", "anulada", "excluido", "excluida"],
  partial: ["partial", "parcial", "parcialmente pago", "parcialmente paga", "pago parcial", "paga parcial", "pagamento parcial", "recebimento parcial", "parcialmente recebido", "parcialmente recebida", "partially paid"],
};
const categories = {
  entry: ["entry", "entrada", "sinal"], monthly: ["monthly", "mensal", "mensalidade", "mensais"],
  reinforcement: ["reinforcement", "reforco", "reforcos", "intermediaria", "intermediarias", "anual"],
  keys: ["keys", "chaves", "entrega das chaves"], post_keys: ["post keys", "pos chaves", "apos chaves"],
  other: ["other", "outro", "outra", "outros", "outras"],
};

function normalizeContact(get, errors, warnings) {
  const externalId = identifier(get("external_id"), "ID na origem", errors, true);
  const name = stringCell(get("name")) || null;
  if (!name) errors.push("Nome / razão social: obrigatório.");
  const tax = taxId(get("tax_id"), "CPF / CNPJ", errors);
  const typeText = normalized(stringCell(get("person_type")));
  const type = ["pf", "fisica", "pessoa fisica", "individual"].includes(typeText) ? "PF"
    : ["pj", "juridica", "pessoa juridica", "company"].includes(typeText) ? "PJ"
      : ["", "other", "outro", "outros"].includes(typeText) ? "OTHER" : null;
  if (!type) errors.push("Tipo de pessoa não reconhecido; use PF, PJ ou OTHER.");
  const detected = tax?.length === 11 ? "PF" : tax?.length === 14 ? "PJ" : null;
  if (detected && type && type !== "OTHER" && detected !== type) errors.push("Tipo de pessoa não corresponde ao CPF/CNPJ informado.");
  const statusText = normalized(stringCell(get("status")));
  let status = null;
  if (!statusText) { status = "active"; warnings.push("Situação do cadastro ausente: será criado como ativo."); }
  else if (["active", "ativo", "ativa", "sim", "s", "1", "true"].includes(statusText)) status = "active";
  else if (["inactive", "inativo", "inativa", "nao", "n", "0", "false"].includes(statusText)) status = "inactive";
  else errors.push("Situação do cadastro não reconhecida; use ativo ou inativo.");
  const email = stringCell(get("email")) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("E-mail inválido.");
  const state = stringCell(get("state")).toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) errors.push("UF inválida; use duas letras.");
  return {
    external_id: externalId, name, tax_id: tax, person_type: detected ?? type ?? "OTHER", email,
    phone: stringCell(get("phone")) || null, address: stringCell(get("address")) || null,
    city: stringCell(get("city")) || null, state, notes: stringCell(get("notes")) || null, status,
  };
}

function normalizeFinancial(get, kind, errors, warnings, date1904) {
  const externalId = identifier(get("external_id"), "ID da parcela", errors, true);
  const sourceStatus = stringCell(get("source_status")) || null;
  const statusKey = normalized(sourceStatus);
  let status = Object.entries(statusGroups).find(([, aliases]) => aliases.includes(statusKey))?.[0] ?? "unknown";
  if (status === "unknown") errors.push("Situação na origem obrigatória e não reconhecida; nenhum pagamento ou saldo foi presumido.");
  const due = dateValue(get("due_date"), "Vencimento", errors, date1904, true);
  const paidAt = dateValue(get("paid_at"), "Data da baixa", errors, date1904);
  const original = money(get("original_amount"), "Valor original", errors, true);
  let current = money(get("current_amount"), "Valor atualizado", errors);
  let paid = money(get("paid_amount"), "Valor pago / recebido", errors);
  let balance = money(get("balance_amount"), "Saldo em aberto", errors);
  const adjustmentKeys = ["interest_amount", "penalty_amount", "correction_amount", "other_accrual_amount", "discount_amount"];
  const amounts = Object.fromEntries(adjustmentKeys.map(key => [key, money(get(key), FIELD_DEFINITIONS[kind].find(def => def.key === key).label, errors)]));
  const hasAdjustments = adjustmentKeys.some(key => amounts[key] != null);
  const adjustment = (amounts.interest_amount ?? 0n) + (amounts.penalty_amount ?? 0n) + (amounts.correction_amount ?? 0n) + (amounts.other_accrual_amount ?? 0n) - (amounts.discount_amount ?? 0n);
  if (paid == null && !nonempty(get("paid_amount")) && ["open", "cancelled"].includes(status) && !nonempty(get("paid_at"))) {
    paid = 0n; warnings.push("Valor baixado ausente: considerado zero pela situação explícita sem data de baixa.");
  }
  if (status === "paid") {
    if (!nonempty(get("paid_amount"))) errors.push("Título pago exige valor efetivamente pago/recebido explícito.");
    if (paid != null && paid <= 0n) errors.push("Título pago exige valor efetivamente pago/recebido maior que zero.");
    if (!nonempty(get("paid_at"))) errors.push("Título pago exige data de pagamento/recebimento explícita.");
  }
  if (current == null && !nonempty(get("current_amount")) && status !== "unknown") {
    if (balance != null && paid != null && status !== "cancelled") {
      current = paid + balance; warnings.push("Valor atualizado derivado do valor baixado mais o saldo explícito.");
    } else if (status === "paid" && paid != null) {
      current = paid; warnings.push("Valor atualizado ausente: usado o valor integral explicitamente quitado.");
    } else if (original != null) {
      current = original + adjustment;
      warnings.push(hasAdjustments ? "Valor atualizado derivado do original e dos ajustes informados." : "Valor atualizado ausente: considerado igual ao original; confira antes de importar.");
    }
  }
  if (current != null && (current < 0n || current > MAX_MONEY_CENTS)) { errors.push("Valor atualizado fora do intervalo permitido."); current = null; }
  if (current != null && original != null && current !== original + adjustment) errors.push("Valor atualizado não confere com o original e os ajustes informados; mapeie os componentes da diferença.");
  if (balance == null && !nonempty(get("balance_amount")) && status !== "unknown") {
    if (status === "cancelled") { balance = 0n; warnings.push("Saldo ausente: considerado zero porque o título está cancelado."); }
    else if (current != null && paid != null && current >= paid) { balance = current - paid; warnings.push("Saldo derivado do valor atualizado menos o valor baixado."); }
  }
  if (status === "cancelled") {
    if ((paid != null && paid !== 0n) || nonempty(get("paid_at"))) errors.push("Título cancelado contém baixa; exige conferência antes da importação.");
    if (balance != null && balance !== 0n) errors.push("Título cancelado apresenta saldo em aberto diferente de zero.");
  } else if (status !== "unknown") {
    if (current != null && paid != null && balance != null && current !== paid + balance) errors.push("Valores contraditórios: atualizado deve ser igual ao baixado mais o saldo.");
    if (current != null && paid != null && paid > current) errors.push("Valor pago/recebido é maior que o valor atualizado.");
    if (paid != null && paid > 0n && current != null && current > paid) status = "partial";
    if (status === "paid" && ((balance != null && balance !== 0n) || (current != null && paid != null && current !== paid))) errors.push("Título marcado como pago não está integralmente quitado.");
    if (status === "open" && ((paid != null && paid !== 0n) || nonempty(get("paid_at")))) errors.push("Título aberto apresenta baixa ou data de pagamento incompatível.");
    if (status === "partial") errors.push("Baixa parcial não pode ser promovida neste importador; mantenha em revisão.");
  }
  if (kind === "payable" && current != null && original != null && current !== original) errors.push("Conta a pagar com valor atualizado diferente do original exige revisão; o modelo não representa esses ajustes separadamente.");
  const sourceCategory = stringCell(get("category")) || null;
  const category = Object.entries(categories).find(([, aliases]) => aliases.includes(normalized(sourceCategory)))?.[0] ?? "other";
  if (kind === "receivable" && (!sourceCategory || category === "other" && !categories.other.includes(normalized(sourceCategory)))) warnings.push("Categoria ausente ou não reconhecida: classificada como Outros, preservando o rótulo da origem.");
  return {
    external_id: externalId, description: stringCell(get("description")) || null,
    document: stringCell(get("document")) || null, installment_label: stringCell(get("installment_label")) || null,
    due_date: due, original_amount: decimal(original), current_amount: decimal(current), paid_amount: decimal(paid), balance_amount: decimal(balance),
    source_status: sourceStatus, status, paid_at: paidAt, paid_account_name: stringCell(get("paid_account_name")) || null,
    counterparty_external_id: identifier(get("counterparty_external_id"), "ID do fornecedor / cliente", errors),
    counterparty_tax_id: taxId(get("counterparty_tax_id"), "CPF / CNPJ do fornecedor / cliente", errors),
    counterparty_name: stringCell(get("counterparty_name")) || null,
    sale_reference: identifier(get("sale_reference"), "Referência da venda", errors),
    ...(stringCell(get("bank_identifier")) ? { bank_identifier: identifier(get("bank_identifier"), "Identificador bancário", errors) } : {}),
    ...(stringCell(get("bank_agreement")) ? { bank_agreement: identifier(get("bank_agreement"), "Convênio bancário", errors) } : {}),
    source_project: stringCell(get("source_project")) || null, category, source_category: sourceCategory,
    ...Object.fromEntries(adjustmentKeys.map(key => [key, decimal(amounts[key])])), notes: stringCell(get("notes")) || null,
  };
}

function rawCell(cell) {
  if (!cell) return null;
  const value = cell.value instanceof Date ? cell.value.toISOString() : cell.value ?? null;
  const numeric = cell.numericLexeme == null ? {} : { lexeme: cell.numericLexeme };
  return cell.formula ? { formula: cell.formula, result: value, ...numeric, error: cell.problem }
    : cell.problem || cell.numericLexeme != null ? { value, ...numeric, error: cell.problem } : value;
}

function suspiciousFormula(cell) {
  if (typeof cell?.value !== "string" || cell.formula) return false;
  const value = cell.value.trimStart();
  return /^=/.test(value) || /^[+@-]\s*(?:[A-Za-z_][\w.]*\s*\(|[^\r\n]*\|)/.test(value);
}

export async function parseImportFile(bytes, fileName, { entityKind, sheetName, headerRow = 1, columnMapping = {} } = {}) {
  requireKind(entityKind);
  const sheets = await readFile(bytes, fileName, headerRow);
  const filled = sheets.filter(sheet => sheet.records.length);
  const sheet = sheetName ? sheets.find(item => item.name === sheetName) : filled.length === 1 ? filled[0] : null;
  if (!sheet) throw new Error(sheetName ? "A aba selecionada não existe no arquivo." : "Selecione explicitamente a aba que será importada.");
  if (!sheet.records.length) throw new Error("A aba selecionada não possui registros de dados.");
  if (!columnMapping || typeof columnMapping !== "object" || Array.isArray(columnMapping)) throw new Error("Mapeamento de colunas inválido.");
  const mapping = { ...columnMapping };
  if (["payable", "receivable"].includes(entityKind) && !mapping.source_status && mapping.status) { mapping.source_status = mapping.status; delete mapping.status; }
  const allowedKeys = new Set(FIELD_DEFINITIONS[entityKind].map(item => item.key));
  for (const [key, header] of Object.entries(mapping)) {
    if (!allowedKeys.has(key)) throw new Error(`Campo de mapeamento desconhecido: ${key}.`);
    if (header != null && header !== "" && (typeof header !== "string" || !sheet.headers.includes(header))) throw new Error(`Coluna mapeada não encontrada: ${String(header)}.`);
  }
  for (const def of FIELD_DEFINITIONS[entityKind]) if (def.required && !mapping[def.key]) throw new Error(`Mapeie a coluna obrigatória: ${def.label}.`);
  const rows = sheet.records.map(record => {
    const errors = []; const warnings = [];
    const rawData = Object.fromEntries(sheet.headers.map((header, index) => [header, rawCell(record.cells[index])]));
    record.cells.forEach((cell, index) => {
      const header = sheet.headers[index] ?? `Coluna ${index + 1}`;
      if (cell?.problem) errors.push(`${header}: ${cell.problem}`);
      else if (cell?.formula) warnings.push(`${header}: utilizado resultado armazenado da fórmula, sem executar ou recalcular.`);
      if (suspiciousFormula(cell)) errors.push(`${header}: expressão de planilha sem resultado confiável; substitua por um valor literal.`);
    });
    const get = key => record.cells[sheet.headers.indexOf(mapping[key])] ?? plainCell(null);
    const data = ["supplier", "client"].includes(entityKind) ? normalizeContact(get, errors, warnings) : normalizeFinancial(get, entityKind, errors, warnings, sheet.date1904);
    return { source_row: record.sourceRow, external_id: data.external_id, raw_data: rawData, normalized_data: data, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
  });
  const identities = new Map();
  for (const row of rows) {
    if (!row.external_id) continue;
    const key = row.external_id.normalize("NFC");
    identities.set(key, [...(identities.get(key) ?? []), row]);
  }
  for (const same of identities.values()) if (same.length > 1) {
    const message = `ID na origem repetido nas linhas ${same.map(row => row.source_row).join(", ")}; cada parcela/cadastro precisa de ID único.`;
    for (const row of same) row.errors.push(message);
  }
  const totals = { original_amount: 0n, paid_amount: 0n, balance_amount: 0n };
  let complete = true;
  for (const row of rows) for (const key of Object.keys(totals)) {
    const value = row.normalized_data[key];
    if (value != null) totals[key] += BigInt(value.replace(".", ""));
    else if (["payable", "receivable"].includes(entityKind)) complete = false;
  }
  return {
    sheetName: sheet.name, headers: sheet.headers, rows,
    summary: { rows: rows.length, valid: rows.filter(row => !row.errors.length).length, blocked: rows.filter(row => row.errors.length).length,
      ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, decimal(value)])), totals_complete: complete },
  };
}
