"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/precos";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

const headerAliases: Record<string, string> = {
  codigo_insumo: "codigo_insumo",
  insumo_codigo: "codigo_insumo",
  cod_insumo: "codigo_insumo",
  fornecedor_cnpj: "fornecedor_cnpj",
  cnpj_fornecedor: "fornecedor_cnpj",
  fornecedor_nome: "fornecedor_nome",
  nome_fornecedor: "fornecedor_nome",
  fornecedor: "fornecedor_nome",
  data_preco: "data_preco",
  data: "data_preco",
  escopo: "escopo",
  codigo_obra: "codigo_obra",
  obra_codigo: "codigo_obra",
  obra: "codigo_obra",
  preco_unitario: "preco_unitario",
  valor_unitario: "preco_unitario",
  preco: "preco_unitario",
  desconto_percentual: "desconto_percentual",
  desconto: "desconto_percentual",
  frete_unitario: "frete_unitario",
  frete: "frete_unitario",
  outros_custos_unitarios: "outros_custos_unitarios",
  outros_custos: "outros_custos_unitarios",
  adotar_preco: "adotar_preco",
  adotado: "adotar_preco",
  origem_documento: "origem_documento",
  origem: "origem_documento",
  documento: "origem_documento",
  observacoes: "observacoes",
  observacao: "observacoes",
  notas: "observacoes",
};

type ImportedPriceRow = {
  input_id: string;
  supplier_id: string | null;
  project_id: string | null;
  price_date: string;
  unit_price: number;
  freight_unit_cost: number;
  other_unit_cost: number;
  discount_percentage: number;
  is_adopted: boolean;
  source: string | null;
  notes: string | null;
};

type InputRecord = { id: string; code: string; description: string };
type SupplierRecord = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
type ProjectRecord = { id: string; name: string; code: string | null };

function resultUrl(message: string, type: "error" | "success" = "error") {
  const safeMessage = message.length > 1400 ? `${message.slice(0, 1397)}...` : message;
  return `${LIST_PATH}?${new URLSearchParams({ [type]: safeMessage }).toString()}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: unknown) {
  const normalized = normalizeText(value).replace(/ /g, "_");
  return headerAliases[normalized] ?? normalized;
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function parseNumber(value: unknown, fallback = Number.NaN) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  let normalized = raw.replace(/\s/g, "").replace(/R\$/gi, "").replace(/%/g, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  const result = Number(normalized);
  return Number.isFinite(result) ? result : fallback;
}

function isoDateParts(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.round((value - 25569) * 86_400_000);
    const date = new Date(milliseconds);
    return isoDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return isoDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const brazilian = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (brazilian) return isoDateParts(Number(brazilian[3]), Number(brazilian[2]), Number(brazilian[1]));

  return null;
}

function parseScope(value: unknown) {
  const normalized = normalizeText(value);
  if (["corporativo", "corporate", "geral", "empresa"].includes(normalized)) return "corporate";
  if (["obra", "project", "projeto", "empreendimento"].includes(normalized)) return "project";
  return null;
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = normalizeText(value);
  return ["sim", "s", "yes", "y", "true", "verdadeiro", "1"].includes(normalized);
}

function textValue(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function addNameToMap(map: Map<string, SupplierRecord[]>, name: string | null, supplier: SupplierRecord) {
  const key = normalizeText(name);
  if (!key) return;
  const values = map.get(key) ?? [];
  if (!values.some((item) => item.id === supplier.id)) values.push(supplier);
  map.set(key, values);
}

function rowErrorSummary(errors: string[]) {
  const visible = errors.slice(0, 8);
  const suffix = errors.length > visible.length ? ` Mais ${errors.length - visible.length} erro(s).` : "";
  return `A planilha não foi importada. ${visible.join(" | ")}${suffix}`;
}

function readSpreadsheetRows(buffer: ArrayBuffer) {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    dense: true,
  });

  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === "cotacoes") ?? workbook.SheetNames[0];
  if (!sheetName) return null;

  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return null;

  return XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  }) as unknown[][];
}

export async function importEngineeringInputPrices(formData: FormData) {
  const uploaded = formData.get("file");
  if (!(uploaded instanceof File) || uploaded.size === 0) {
    redirect(resultUrl("Selecione um arquivo XLSX para importar."));
  }

  if (!uploaded.name.toLowerCase().endsWith(".xlsx")) {
    redirect(resultUrl("Use o modelo XLSX disponibilizado pelo sistema."));
  }

  if (uploaded.size > MAX_FILE_SIZE) {
    redirect(resultUrl("O arquivo ultrapassa o limite de 5 MB."));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("prices.manage");
  const [inputsResult, suppliersResult, projectsResult] = await Promise.all([
    fetchAllRows<InputRecord>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_inputs")
        .select("id, code, description")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as InputRecord[], error };
    }),
    fetchAllRows<SupplierRecord>(async (from, to) => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, legal_name, trade_name, tax_id")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("legal_name")
        .range(from, to);
      return { data: (data ?? []) as SupplierRecord[], error };
    }),
    fetchAllRows<ProjectRecord>(async (from, to) => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, code")
        .eq("company_id", companyId)
        .neq("status", "archived")
        .order("name")
        .range(from, to);
      return { data: (data ?? []) as ProjectRecord[], error };
    }),
  ]);

  if (inputsResult.error || suppliersResult.error || projectsResult.error) {
    redirect(resultUrl("Não foi possível carregar os cadastros necessários para validar a planilha."));
  }

  const inputs = inputsResult.data;
  const suppliers = suppliersResult.data;
  const projects = projectsResult.data;
  const inputMap = new Map(inputs.map((input) => [normalizeText(input.code), input]));
  const supplierTaxMap = new Map(suppliers.map((supplier) => [digits(supplier.tax_id), supplier]).filter(([key]) => Boolean(key)) as [string, SupplierRecord][]);
  const supplierNameMap = new Map<string, SupplierRecord[]>();
  suppliers.forEach((supplier) => {
    addNameToMap(supplierNameMap, supplier.legal_name, supplier);
    addNameToMap(supplierNameMap, supplier.trade_name, supplier);
  });
  const projectCodeMap = new Map(projects.map((project) => [normalizeText(project.code), project]).filter(([key]) => Boolean(key)) as [string, ProjectRecord][]);
  const projectNameMap = new Map(projects.map((project) => [normalizeText(project.name), project]));

  let matrix: unknown[][] | null = null;
  try {
    matrix = readSpreadsheetRows(await uploaded.arrayBuffer());
  } catch (error) {
    console.error("engineering_input_prices_xlsx_read_error", error);
    redirect(resultUrl("Não foi possível ler o arquivo. O arquivo pode estar protegido, corrompido ou fora do padrão XLSX."));
  }

  if (!matrix || matrix.length === 0) {
    redirect(resultUrl("A planilha não possui nenhuma aba para importar."));
  }

  const columns = new Map<string, number>();
  const headerRow = matrix[0] ?? [];
  headerRow.forEach((value, columnIndex) => {
    const header = normalizeHeader(value);
    if (header) columns.set(header, columnIndex);
  });

  const requiredHeaders = ["codigo_insumo", "data_preco", "escopo", "preco_unitario"];
  const missingHeaders = requiredHeaders.filter((header) => !columns.has(header));
  if (missingHeaders.length > 0) {
    redirect(resultUrl(`Colunas obrigatórias ausentes: ${missingHeaders.join(", ")}. Use o modelo fornecido pelo sistema.`));
  }

  const rawRows: { rowNumber: number; values: Record<string, unknown> }[] = [];
  matrix.slice(1).forEach((row, index) => {
    const values: Record<string, unknown> = {};
    columns.forEach((columnIndex, header) => {
      values[header] = row[columnIndex] ?? "";
    });
    const hasContent = Object.values(values).some((value) => String(value ?? "").trim() !== "");
    if (hasContent) rawRows.push({ rowNumber: index + 2, values });
  });

  if (rawRows.length === 0) redirect(resultUrl("A aba Cotações não possui linhas preenchidas."));
  if (rawRows.length > MAX_ROWS) redirect(resultUrl("A importação permite no máximo 2.000 cotações por arquivo."));

  const errors: string[] = [];
  const importRows: ImportedPriceRow[] = [];
  const adoptedKeys = new Map<string, number>();

  rawRows.forEach(({ rowNumber, values }) => {
    const inputCode = normalizeText(values.codigo_insumo);
    const input = inputMap.get(inputCode);
    if (!input) errors.push(`Linha ${rowNumber}: código de insumo não encontrado ou inativo.`);

    const taxId = digits(values.fornecedor_cnpj);
    const supplierName = normalizeText(values.fornecedor_nome);
    let supplier: SupplierRecord | null = null;

    if (taxId) {
      supplier = supplierTaxMap.get(taxId) ?? null;
      if (!supplier) errors.push(`Linha ${rowNumber}: CNPJ do fornecedor não encontrado.`);
    } else if (supplierName) {
      const matches = supplierNameMap.get(supplierName) ?? [];
      if (matches.length === 1) supplier = matches[0];
      else if (matches.length > 1) errors.push(`Linha ${rowNumber}: nome de fornecedor ambíguo; informe o CNPJ.`);
      else errors.push(`Linha ${rowNumber}: fornecedor não encontrado; informe o nome exatamente como cadastrado.`);
    }

    const priceDate = parseDate(values.data_preco);
    if (!priceDate) errors.push(`Linha ${rowNumber}: data do preço inválida.`);

    const scope = parseScope(values.escopo);
    if (!scope) errors.push(`Linha ${rowNumber}: escopo inválido; use Corporativo ou Obra.`);

    let project: ProjectRecord | null = null;
    if (scope === "project") {
      const projectValue = normalizeText(values.codigo_obra);
      project = projectValue ? projectCodeMap.get(projectValue) ?? projectNameMap.get(projectValue) ?? null : projects.find((item) => item.id === projectId) ?? null;
      if (!project) errors.push(`Linha ${rowNumber}: obra não encontrada; informe o código da obra ou selecione a obra antes da importação.`);
    }

    const unitPrice = parseNumber(values.preco_unitario);
    const discount = parseNumber(values.desconto_percentual, 0);
    const freight = parseNumber(values.frete_unitario, 0);
    const otherCosts = parseNumber(values.outros_custos_unitarios, 0);

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) errors.push(`Linha ${rowNumber}: preço unitário deve ser maior que zero.`);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) errors.push(`Linha ${rowNumber}: desconto deve ficar entre 0 e 100%.`);
    if (!Number.isFinite(freight) || freight < 0) errors.push(`Linha ${rowNumber}: frete unitário inválido.`);
    if (!Number.isFinite(otherCosts) || otherCosts < 0) errors.push(`Linha ${rowNumber}: outros custos unitários inválidos.`);

    const adopted = parseBoolean(values.adotar_preco);
    if (input && adopted) {
      const key = `${input.id}|${project?.id ?? "corporate"}`;
      const previousRow = adoptedKeys.get(key);
      if (previousRow) errors.push(`Linhas ${previousRow} e ${rowNumber}: há mais de um preço adotado para o mesmo insumo e escopo.`);
      else adoptedKeys.set(key, rowNumber);
    }

    if (!input || !priceDate || !scope || (scope === "project" && !project)) return;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(discount) || discount < 0 || discount > 100 || !Number.isFinite(freight) || freight < 0 || !Number.isFinite(otherCosts) || otherCosts < 0) return;

    importRows.push({
      input_id: input.id,
      supplier_id: supplier?.id ?? null,
      project_id: project?.id ?? null,
      price_date: priceDate,
      unit_price: unitPrice,
      freight_unit_cost: freight,
      other_unit_cost: otherCosts,
      discount_percentage: discount,
      is_adopted: adopted,
      source: textValue(values.origem_documento) ?? `Importação XLSX · ${uploaded.name}`,
      notes: textValue(values.observacoes),
    });
  });

  if (errors.length > 0) redirect(resultUrl(rowErrorSummary(errors)));

  const { data, error } = await supabase.rpc("import_engineering_input_prices", {
    p_company_id: companyId,
    p_rows: importRows,
  });

  if (error) {
    const message = error.message.includes("import_engineering_input_prices")
      ? "A rotina de importação ainda não está instalada. Execute a migration 20260724_0018_import_engineering_input_prices.sql."
      : error.message;
    redirect(resultUrl(message));
  }

  const result = data as { imported_count?: number; adopted_count?: number } | null;
  const importedCount = result?.imported_count ?? importRows.length;
  const adoptedCount = result?.adopted_count ?? importRows.filter((row) => row.is_adopted).length;

  revalidatePath(LIST_PATH);
  redirect(resultUrl(`${importedCount} cotação(ões) importada(s) com sucesso. ${adoptedCount} preço(s) adotado(s) como referência.`, "success"));
}
