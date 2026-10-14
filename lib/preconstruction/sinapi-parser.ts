import ExcelJS from "exceljs";

export type SinapiInputRow = {
  code: string;
  description: string;
  unit: string;
  category: string | null;
  unitPrice: number;
  raw: Record<string, string | number | null>;
};
export type SinapiCompositionRow = {
  code: string;
  description: string;
  unit: string;
  totalCost: number;
  raw: Record<string, string | number | null>;
};
export type SinapiCompositionItemRow = {
  compositionCode: string;
  itemType: "input" | "composition";
  itemCode: string;
  description: string;
  unit: string;
  coefficient: number;
  unitPrice: number;
  subtotal: number;
};
export type ParsedSinapiWorkbook = {
  inputs: SinapiInputRow[];
  compositions: SinapiCompositionRow[];
  compositionItems: SinapiCompositionItemRow[];
  sheets: string[];
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
function text(value: unknown) {
  if (value && typeof value === "object" && "text" in (value as Record<string, unknown>)) return String((value as { text?: unknown }).text ?? "").trim();
  return String(value ?? "").trim();
}
function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function cellValue(row: ExcelJS.Row, column: number | null) {
  return column ? row.getCell(column).value : null;
}
function firstColumn(headers: Map<string, number>, patterns: RegExp[]) {
  for (const [key, column] of headers) if (patterns.some((pattern) => pattern.test(key))) return column;
  return null;
}
function rowObject(row: ExcelJS.Row, headerCells: { key: string; column: number }[]) {
  const result: Record<string, string | number | null> = {};
  for (const header of headerCells) {
    const value = row.getCell(header.column).value;
    result[header.key] = typeof value === "number" ? value : text(value) || null;
  }
  return result;
}

function detectHeader(worksheet: ExcelJS.Worksheet) {
  const max = Math.min(40, worksheet.rowCount);
  let best: { rowNumber: number; headers: Map<string, number>; headerCells: { key: string; column: number }[]; score: number } | null = null;
  for (let rowNumber = 1; rowNumber <= max; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const headers = new Map<string, number>();
    const headerCells: { key: string; column: number }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const key = normalize(cell.value);
      if (!key) return;
      headers.set(key, column);
      headerCells.push({ key, column });
    });
    const keys = [...headers.keys()].join(" | ");
    let score = 0;
    if (/CODIGO/.test(keys)) score += 3;
    if (/DESCRICAO/.test(keys)) score += 3;
    if (/UNIDADE|\bUN\b/.test(keys)) score += 2;
    if (/PRECO|CUSTO|VALOR/.test(keys)) score += 2;
    if (/COEFICIENTE/.test(keys)) score += 2;
    if (!best || score > best.score) best = { rowNumber, headers, headerCells, score };
  }
  return best && best.score >= 6 ? best : null;
}

function classifySheet(name: string, headers: Map<string, number>) {
  const key = normalize(name);
  const all = [...headers.keys()].join(" | ");
  if (/ANALIT|COMPOSICAO.*ITEM|ITEM.*COMPOSICAO/.test(key) || (/COEFICIENTE/.test(all) && /COMPOS/.test(all))) return "analytic" as const;
  if (/INSUM/.test(key) || /CODIGO.*INSUM/.test(all) || /PRECO MEDIANO/.test(all)) return "inputs" as const;
  if (/COMPOS/.test(key) || /CODIGO.*COMPOS/.test(all) || /CUSTO TOTAL/.test(all)) return "compositions" as const;
  return "unknown" as const;
}

export async function parseSinapiWorkbook(buffer: ArrayBuffer): Promise<ParsedSinapiWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const result: ParsedSinapiWorkbook = { inputs: [], compositions: [], compositionItems: [], sheets: [] };

  for (const worksheet of workbook.worksheets) {
    const detected = detectHeader(worksheet);
    if (!detected) continue;
    const kind = classifySheet(worksheet.name, detected.headers);
    if (kind === "unknown") continue;
    result.sheets.push(`${worksheet.name}:${kind}`);
    const codeCol = firstColumn(detected.headers, [/^CODIGO$/, /CODIGO.*INSUM/, /CODIGO.*COMPOS/]);
    const descriptionCol = firstColumn(detected.headers, [/DESCRICAO/]);
    const unitCol = firstColumn(detected.headers, [/^UN$/, /UNIDADE/, /^UND$/]);
    const categoryCol = firstColumn(detected.headers, [/TIPO.*INSUM/, /GRUPO/, /CATEGORIA/]);
    const priceCol = firstColumn(detected.headers, [/PRECO MEDIANO/, /^PRECO$/, /^VALOR$/, /CUSTO UNIT/]);
    const costCol = firstColumn(detected.headers, [/CUSTO TOTAL/, /^CUSTO$/, /PRECO TOTAL/]);
    const compositionCodeCol = firstColumn(detected.headers, [/CODIGO.*COMPOS/, /^COMPOSICAO$/]);
    const itemCodeCol = firstColumn(detected.headers, [/CODIGO.*ITEM/, /CODIGO.*INSUM/, /CODIGO.*AUXILIAR/]);
    const coefficientCol = firstColumn(detected.headers, [/COEFICIENTE/]);
    const itemTypeCol = firstColumn(detected.headers, [/TIPO.*ITEM/, /^TIPO$/]);
    const subtotalCol = firstColumn(detected.headers, [/SUBTOTAL/, /CUSTO TOTAL.*ITEM/, /CUSTO PARCIAL/]);

    for (let rowNumber = detected.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      if (kind === "inputs") {
        const code = text(cellValue(row, codeCol));
        const description = text(cellValue(row, descriptionCol));
        if (!code || !description) continue;
        result.inputs.push({
          code,
          description,
          unit: text(cellValue(row, unitCol)) || "un",
          category: text(cellValue(row, categoryCol)) || null,
          unitPrice: Math.max(0, numeric(cellValue(row, priceCol ?? costCol))),
          raw: rowObject(row, detected.headerCells),
        });
      } else if (kind === "compositions") {
        const code = text(cellValue(row, codeCol ?? compositionCodeCol));
        const description = text(cellValue(row, descriptionCol));
        if (!code || !description) continue;
        result.compositions.push({
          code,
          description,
          unit: text(cellValue(row, unitCol)) || "un",
          totalCost: Math.max(0, numeric(cellValue(row, costCol ?? priceCol))),
          raw: rowObject(row, detected.headerCells),
        });
      } else {
        const compositionCode = text(cellValue(row, compositionCodeCol ?? codeCol));
        const itemCode = text(cellValue(row, itemCodeCol));
        if (!compositionCode || !itemCode) continue;
        const rawType = normalize(cellValue(row, itemTypeCol));
        result.compositionItems.push({
          compositionCode,
          itemType: /COMPOS|AUX/.test(rawType) ? "composition" : "input",
          itemCode,
          description: text(cellValue(row, descriptionCol)),
          unit: text(cellValue(row, unitCol)) || "un",
          coefficient: Math.max(0, numeric(cellValue(row, coefficientCol))) || 1,
          unitPrice: Math.max(0, numeric(cellValue(row, priceCol))),
          subtotal: Math.max(0, numeric(cellValue(row, subtotalCol ?? costCol))),
        });
      }
    }
  }

  const dedupe = <T extends { code: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.code, row])).values()];
  result.inputs = dedupe(result.inputs);
  result.compositions = dedupe(result.compositions);
  return result;
}