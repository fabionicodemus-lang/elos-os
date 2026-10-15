import * as XLSX from "xlsx";

function text(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value ?? "").trim();
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeImportText(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sheetByName(workbook, candidates) {
  const wanted = new Set(candidates.map(normalizeImportText));
  const name = workbook.SheetNames.find((sheetName) => wanted.has(normalizeImportText(sheetName)));
  return name ? { name, sheet: workbook.Sheets[name] } : null;
}

function matrix(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: true });
}

function findLabelValue(rows, label) {
  const target = normalizeImportText(label);
  for (const row of rows) {
    for (let column = 0; column < row.length; column += 1) {
      if (normalizeImportText(row[column]) !== target) continue;
      for (let next = column + 1; next < row.length; next += 1) {
        if (text(row[next])) return row[next];
      }
    }
  }
  return null;
}

function toIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86400000).toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function codeLikeService(value) {
  return /^\d+(?:\.\d+)+$/.test(text(value));
}

function priceMapFromSheet(rows) {
  const map = new Map();
  rows.forEach((row, index) => {
    const code = text(row[0]).toUpperCase();
    const description = text(row[1]);
    const unit = text(row[2]);
    if (!code || !description || !unit || !code.includes(".")) return;
    map.set(code, {
      code,
      description,
      unit,
      proposed_price: number(row[3]),
      supplier: text(row[4]) || null,
      adopted_price: number(row[6]),
      source_row: index + 1,
    });
  });
  return map;
}

function sourceBudgetCode(reference) {
  const match = text(reference).match(/(?:n[ºo°:]?\s*)?([A-Z]?\d+)\s*$/i);
  return match?.[1]?.toUpperCase() ?? text(reference) || null;
}

function sourceVersion(value) {
  const raw = text(value);
  const match = raw.match(/(?:revis[aã]o|rev\.?)[\s:-]*(\d+)/i);
  return match ? `R${String(Number(match[1])).padStart(2, "0")}` : raw || null;
}

export function parseBudgetWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true, dense: true, cellStyles: true });
  const analytic = sheetByName(workbook, ["ORCAMENTO ANALITICO", "ORÇAMENTO ANALÍTICO", "ORCAMENTO ANALÍTICO"]);
  if (!analytic) throw new Error("Aba ORCAMENTO ANALITICO não encontrada.");

  const analyticRows = matrix(analytic.sheet);
  const pricesSheet = sheetByName(workbook, ["Lista de Preços", "Lista de Precos"]);
  const priceRows = pricesSheet ? matrix(pricesSheet.sheet) : [];
  const prices = priceMapFromSheet(priceRows);
  const summarySheet = sheetByName(workbook, ["RESUMO GRUPOS", "RESUMO"]);
  const summaryRows = summarySheet ? matrix(summarySheet.sheet) : [];

  const rows = [];
  let currentGroup = null;
  let currentService = null;
  let groupOrder = 0;
  let serviceOrder = 0;
  let inputOrder = 0;

  analyticRows.forEach((row, index) => {
    const sourceRow = index + 1;
    const a = text(row[0]);
    const e = text(row[4]);
    const f = text(row[5]);
    const g = text(row[6]);
    const h = number(row[7]);
    const i = text(row[8]);
    const j = number(row[9]);
    const k = number(row[10]);
    const m = number(row[12]);

    const groupMatch = e.match(/^GRUPO\s*:\s*([A-Z0-9.-]+)/i);
    if (groupMatch && g) {
      currentGroup = { code: groupMatch[1].toUpperCase(), name: g, sourceRow };
      currentService = null;
      groupOrder += 1;
      rows.push({
        entity_kind: "group",
        source_sheet: analytic.name,
        source_row: sourceRow,
        sort_order: groupOrder,
        source_group_code: currentGroup.code,
        source_group_name: currentGroup.name,
        external_code: currentGroup.code,
        external_name: currentGroup.name,
        external_unit: null,
        quantity: null,
        unit_cost: null,
        total_cost: null,
        coefficient: null,
        raw_coefficient: null,
        payload: {},
      });
      return;
    }

    if (codeLikeService(e) && g && !a) {
      currentService = {
        code: e.toUpperCase(),
        name: g,
        unit: i || "un",
        quantity: h,
        unitCost: j,
        totalCost: k,
        sourceRow,
      };
      serviceOrder += 1;
      rows.push({
        entity_kind: "service",
        source_sheet: analytic.name,
        source_row: sourceRow,
        sort_order: serviceOrder,
        source_group_code: currentGroup?.code ?? null,
        source_group_name: currentGroup?.name ?? null,
        source_service_code: currentService.code,
        source_service_name: currentService.name,
        external_code: currentService.code,
        external_name: currentService.name,
        external_unit: currentService.unit,
        quantity: currentService.quantity,
        unit_cost: currentService.unitCost,
        total_cost: currentService.totalCost,
        coefficient: null,
        raw_coefficient: null,
        payload: { sequence: f || null },
      });
      return;
    }

    if (!currentService || !g || !i || g === "#N/A" || i === "#N/A") return;
    if (!a && !f) return;

    const inputCode = a ? a.toUpperCase() : null;
    const price = inputCode ? prices.get(inputCode) : null;
    const quantity = h;
    const parentQuantity = currentService.quantity;
    const coefficient = quantity != null && parentQuantity != null && parentQuantity > 0
      ? quantity / parentQuantity
      : m;

    inputOrder += 1;
    rows.push({
      entity_kind: "input",
      source_sheet: analytic.name,
      source_row: sourceRow,
      sort_order: inputOrder,
      source_group_code: currentGroup?.code ?? null,
      source_group_name: currentGroup?.name ?? null,
      source_service_code: currentService.code,
      source_service_name: currentService.name,
      external_code: inputCode,
      external_name: g,
      external_unit: i,
      quantity,
      unit_cost: j ?? price?.adopted_price ?? price?.proposed_price ?? null,
      total_cost: k,
      coefficient: coefficient ?? null,
      raw_coefficient: m,
      payload: {
        sequence: f || null,
        price_list_row: price?.source_row ?? null,
        supplier: price?.supplier ?? null,
        proposed_price: price?.proposed_price ?? null,
        adopted_price: price?.adopted_price ?? null,
      },
    });
  });

  const groups = rows.filter((row) => row.entity_kind === "group");
  const services = rows.filter((row) => row.entity_kind === "service");
  const inputs = rows.filter((row) => row.entity_kind === "input");
  const sourceTotal = number(findLabelValue(summaryRows, "CUSTO OBRA"))
    ?? services.reduce((sum, row) => sum + Number(row.total_cost ?? 0), 0);

  return {
    parser_key: "flow_legacy_budget_v1",
    source_sheet: analytic.name,
    catalog_namespace: "koper",
    source_budget_code: sourceBudgetCode(findLabelValue(analyticRows, "REFERÊNCIA:")),
    source_budget_name: text(findLabelValue(analyticRows, "OBRA:")) || null,
    source_version: sourceVersion(findLabelValue(analyticRows, "REV. DO CUSTO:")),
    source_reference_date: toIsoDate(findLabelValue(analyticRows, "DATA:")),
    source_area_m2: number(findLabelValue(analyticRows, "Área Construída")),
    source_total: sourceTotal,
    rows,
    summary: {
      groups: groups.length,
      services: services.length,
      inputs: inputs.length,
      unique_input_codes: new Set(inputs.map((row) => row.external_code).filter(Boolean)).size,
      priced_inputs: inputs.filter((row) => row.unit_cost != null).length,
    },
  };
}
