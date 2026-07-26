"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/levantamento";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

const headerAliases: Record<string, string> = {
  local_codigo: "local_codigo",
  codigo_local: "local_codigo",
  pavimento_codigo: "local_codigo",
  local_nome: "local_nome",
  nome_local: "local_nome",
  pavimento: "local_nome",
  local_tipo: "local_tipo",
  tipo_local: "local_tipo",
  local_superior_codigo: "local_superior_codigo",
  codigo_local_superior: "local_superior_codigo",
  repeticoes: "repeticoes",
  repeticoes_oficiais: "repeticoes",
  ordem_local: "ordem_local",
  local_observacoes: "local_observacoes",
  servico_codigo: "servico_codigo",
  codigo_servico: "servico_codigo",
  metodo: "metodo",
  quantidade_elementos: "quantidade_elementos",
  qtd_elementos: "quantidade_elementos",
  dimensao_a: "dimensao_a",
  dimensao_b: "dimensao_b",
  dimensao_c: "dimensao_c",
  ajuste: "ajuste",
  memoria_calculo: "memoria_calculo",
  formula: "memoria_calculo",
  quantidade_por_local: "quantidade_por_local",
  quantidade_total: "quantidade_total",
  origem_projeto_prancha: "origem_projeto_prancha",
  origem: "origem_projeto_prancha",
  revisao_projeto: "revisao_projeto",
  descricao_memoria: "descricao_memoria",
  descricao: "descricao_memoria",
  status: "status",
};

type ServiceRecord = {
  id: string;
  code: string;
  description: string;
  unit: string;
  default_method: string;
};

type BudgetRecord = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  updated_at: string;
};

type ExistingLocation = {
  code: string;
};

type ImportedTakeoffRow = {
  location_code: string;
  location_name: string;
  location_type: string;
  parent_location_code: string | null;
  location_repetitions: number;
  location_sort_order: number;
  location_notes: string | null;
  service_id: string;
  method: string;
  element_count: number;
  dimension_a: number | null;
  dimension_b: number | null;
  dimension_c: number | null;
  adjustment: number;
  quantity_per_location: number;
  total_quantity: number;
  formula: string;
  unit_snapshot: string;
  source_reference: string | null;
  project_revision: string | null;
  description: string | null;
  status: string;
};

function resultUrl(message: string, type: "error" | "success" = "error", budgetId?: string | null) {
  const safeMessage = message.length > 1400 ? `${message.slice(0, 1397)}...` : message;
  const params = new URLSearchParams({ [type]: safeMessage });
  if (budgetId) params.set("budget", budgetId);
  return `${LIST_PATH}?${params.toString()}`;
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

function normalizeCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeHeader(value: unknown) {
  const normalized = normalizeText(value).replace(/ /g, "_");
  return headerAliases[normalized] ?? normalized;
}

function textValue(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function parseNumber(value: unknown, fallback = Number.NaN) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  let normalized = raw.replace(/\s/g, "");
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }

  const result = Number(normalized);
  return Number.isFinite(result) ? result : fallback;
}

function parseLocationType(value: unknown) {
  const normalized = normalizeText(value);
  const values: Record<string, string> = {
    empreendimento: "enterprise",
    enterprise: "enterprise",
    torre: "tower",
    bloco: "tower",
    "torre bloco": "tower",
    pavimento: "floor",
    andar: "floor",
    floor: "floor",
    unidade: "unit",
    apartamento: "unit",
    unit: "unit",
    ambiente: "room",
    comodo: "room",
    room: "room",
    setor: "sector",
    sector: "sector",
    "area externa": "external",
    externo: "external",
    external: "external",
    outro: "other",
    other: "other",
  };
  return values[normalized] ?? (normalized ? null : "floor");
}

function parseMethod(value: unknown, fallback: string) {
  const normalized = normalizeText(value);
  if (!normalized) return fallback || "custom";
  const values: Record<string, string> = {
    unidade: "unit",
    "valor global": "unit",
    unit: "unit",
    contagem: "count",
    count: "count",
    comprimento: "length",
    linear: "length",
    length: "length",
    area: "area",
    volume: "volume",
    peso: "weight",
    weight: "weight",
    direta: "custom",
    "quantidade direta": "custom",
    custom: "custom",
  };
  return values[normalized] ?? null;
}

function parseStatus(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized || normalized === "rascunho" || normalized === "draft") return "draft";
  if (["em conferencia", "conferencia", "em revisao", "in review", "in_review"].includes(normalized)) return "in_review";
  if (["aprovado", "aprovada", "approved"].includes(normalized)) return "approved";
  return null;
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
  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === "levantamento") ?? workbook.SheetNames[0];
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

export async function importEngineeringTakeoffs(formData: FormData) {
  const uploaded = formData.get("file");
  const requestedBudgetId = String(formData.get("budget_id") ?? "").trim();

  if (!(uploaded instanceof File) || uploaded.size === 0) redirect(resultUrl("Selecione um arquivo XLSX para importar.", "error", requestedBudgetId));
  if (!uploaded.name.toLowerCase().endsWith(".xlsx")) redirect(resultUrl("Use o modelo XLSX disponibilizado pelo sistema.", "error", requestedBudgetId));
  if (uploaded.size > MAX_FILE_SIZE) redirect(resultUrl("O arquivo ultrapassa o limite de 5 MB.", "error", requestedBudgetId));

  const { supabase, companyId, projectId } = await requireCompanyPermission("takeoffs.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de importar o levantamento.", "error", requestedBudgetId));

  const [servicesResult, budgetsResult, locationsResult] = await Promise.all([
    fetchAllRows<ServiceRecord>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description, unit, default_method")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as ServiceRecord[], error };
    }),
    fetchAllRows<BudgetRecord>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_budgets")
        .select("id, code, name, version, status, updated_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as BudgetRecord[], error };
    }),
    fetchAllRows<ExistingLocation>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_takeoff_locations")
        .select("code")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ExistingLocation[], error };
    }),
  ]);

  if (servicesResult.error || budgetsResult.error || locationsResult.error) {
    redirect(resultUrl("Não foi possível carregar os cadastros necessários para validar a planilha.", "error", requestedBudgetId));
  }

  const budget = budgetsResult.data.find((item) => item.id === requestedBudgetId) ?? budgetsResult.data[0];
  if (!budget) redirect(resultUrl("Crie uma revisão de orçamento antes de importar o levantamento."));

  const serviceMap = new Map(servicesResult.data.map((service) => [normalizeText(service.code), service]));
  const existingLocationCodes = new Set(locationsResult.data.map((location) => normalizeCode(location.code)));

  let matrix: unknown[][] | null = null;
  try {
    matrix = readSpreadsheetRows(await uploaded.arrayBuffer());
  } catch (error) {
    console.error("engineering_takeoffs_xlsx_read_error", error);
    redirect(resultUrl("Não foi possível ler o arquivo. O arquivo pode estar protegido, corrompido ou fora do padrão XLSX.", "error", budget.id));
  }

  if (!matrix || matrix.length === 0) redirect(resultUrl("A planilha não possui nenhuma aba para importar.", "error", budget.id));

  const columns = new Map<string, number>();
  (matrix[0] ?? []).forEach((value, columnIndex) => {
    const header = normalizeHeader(value);
    if (header) columns.set(header, columnIndex);
  });

  const requiredHeaders = ["local_codigo", "local_nome", "repeticoes", "servico_codigo", "memoria_calculo", "quantidade_total"];
  const missingHeaders = requiredHeaders.filter((header) => !columns.has(header));
  if (missingHeaders.length > 0) {
    redirect(resultUrl(`Colunas obrigatórias ausentes: ${missingHeaders.join(", ")}. Use o modelo fornecido pelo sistema.`, "error", budget.id));
  }

  const rawRows: { rowNumber: number; values: Record<string, unknown> }[] = [];
  matrix.slice(1).forEach((row, index) => {
    const values: Record<string, unknown> = {};
    columns.forEach((columnIndex, header) => { values[header] = row[columnIndex] ?? ""; });
    if (Object.values(values).some((value) => String(value ?? "").trim() !== "")) rawRows.push({ rowNumber: index + 2, values });
  });

  if (rawRows.length === 0) redirect(resultUrl("A aba Levantamento não possui linhas preenchidas.", "error", budget.id));
  if (rawRows.length > MAX_ROWS) redirect(resultUrl("A importação permite no máximo 5.000 memórias por arquivo.", "error", budget.id));

  const errors: string[] = [];
  const importRows: ImportedTakeoffRow[] = [];
  const locationsInFile = new Map<string, { name: string; type: string; repetitions: number; parent: string | null }>();

  rawRows.forEach(({ rowNumber, values }) => {
    const locationCode = normalizeCode(values.local_codigo);
    const locationName = String(values.local_nome ?? "").trim();
    const locationType = parseLocationType(values.local_tipo);
    const parentLocationCode = normalizeCode(values.local_superior_codigo) || null;
    const repetitions = parseNumber(values.repeticoes);
    const sortOrder = Math.trunc(parseNumber(values.ordem_local, 0));
    const service = serviceMap.get(normalizeText(values.servico_codigo));
    const method = parseMethod(values.metodo, service?.default_method ?? "custom");
    const totalQuantity = parseNumber(values.quantidade_total);
    const informedPerLocation = parseNumber(values.quantidade_por_local);
    const formula = String(values.memoria_calculo ?? "").trim();
    const status = parseStatus(values.status);

    if (!locationCode) errors.push(`Linha ${rowNumber}: informe o código do local ou pavimento.`);
    if (!locationName) errors.push(`Linha ${rowNumber}: informe o nome do local ou pavimento.`);
    if (!locationType) errors.push(`Linha ${rowNumber}: tipo de local inválido.`);
    if (!Number.isFinite(repetitions) || repetitions <= 0) errors.push(`Linha ${rowNumber}: repetições deve ser maior que zero.`);
    if (!service) errors.push(`Linha ${rowNumber}: código de serviço não encontrado ou inativo.`);
    if (!method) errors.push(`Linha ${rowNumber}: método de levantamento inválido.`);
    if (!formula) errors.push(`Linha ${rowNumber}: informe a memória de cálculo ou fórmula.`);
    if (!Number.isFinite(totalQuantity) || totalQuantity < 0) errors.push(`Linha ${rowNumber}: quantidade total inválida.`);
    if (!status) errors.push(`Linha ${rowNumber}: status inválido.`);
    if (parentLocationCode === locationCode) errors.push(`Linha ${rowNumber}: o local não pode ser superior de si mesmo.`);

    const quantityPerLocation = Number.isFinite(informedPerLocation)
      ? informedPerLocation
      : Number.isFinite(totalQuantity) && Number.isFinite(repetitions) && repetitions > 0
        ? totalQuantity / repetitions
        : Number.NaN;

    if (!Number.isFinite(quantityPerLocation) || quantityPerLocation < 0) {
      errors.push(`Linha ${rowNumber}: quantidade por local inválida.`);
    } else if (Number.isFinite(informedPerLocation) && Number.isFinite(totalQuantity) && Number.isFinite(repetitions)) {
      const calculated = informedPerLocation * repetitions;
      const tolerance = Math.max(0.01, Math.abs(totalQuantity) * 0.001);
      if (Math.abs(calculated - totalQuantity) > tolerance) {
        errors.push(`Linha ${rowNumber}: quantidade por local × repetições não confere com a quantidade total.`);
      }
    }

    if (locationCode && locationName && locationType && Number.isFinite(repetitions)) {
      const previous = locationsInFile.get(locationCode);
      if (previous && (previous.name !== locationName || previous.type !== locationType || Math.abs(previous.repetitions - repetitions) > 0.000001 || previous.parent !== parentLocationCode)) {
        errors.push(`Linha ${rowNumber}: o local ${locationCode} aparece com dados diferentes em outra linha.`);
      } else if (!previous) {
        locationsInFile.set(locationCode, { name: locationName, type: locationType, repetitions, parent: parentLocationCode });
      }
    }

    if (service && locationType && method && status && locationCode && locationName && formula && Number.isFinite(repetitions) && repetitions > 0 && Number.isFinite(totalQuantity) && totalQuantity >= 0 && Number.isFinite(quantityPerLocation)) {
      importRows.push({
        location_code: locationCode,
        location_name: locationName,
        location_type: locationType,
        parent_location_code: parentLocationCode,
        location_repetitions: repetitions,
        location_sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        location_notes: textValue(values.local_observacoes),
        service_id: service.id,
        method,
        element_count: parseNumber(values.quantidade_elementos, 1),
        dimension_a: Number.isFinite(parseNumber(values.dimensao_a)) ? parseNumber(values.dimensao_a) : null,
        dimension_b: Number.isFinite(parseNumber(values.dimensao_b)) ? parseNumber(values.dimensao_b) : null,
        dimension_c: Number.isFinite(parseNumber(values.dimensao_c)) ? parseNumber(values.dimensao_c) : null,
        adjustment: parseNumber(values.ajuste, 0),
        quantity_per_location: quantityPerLocation,
        total_quantity: totalQuantity,
        formula,
        unit_snapshot: service.unit,
        source_reference: textValue(values.origem_projeto_prancha),
        project_revision: textValue(values.revisao_projeto),
        description: textValue(values.descricao_memoria),
        status,
      });
    }
  });

  locationsInFile.forEach((location, code) => {
    if (location.parent && !locationsInFile.has(location.parent) && !existingLocationCodes.has(location.parent)) {
      errors.push(`Local ${code}: o local superior ${location.parent} não existe no arquivo nem na obra.`);
    }
  });

  if (errors.length > 0) redirect(resultUrl(rowErrorSummary(errors), "error", budget.id));

  const { data, error } = await supabase.rpc("import_engineering_takeoffs", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_budget_id: budget.id,
    p_rows: importRows,
  });

  if (error) redirect(resultUrl(error.message, "error", budget.id));

  const result = data as { locations_processed?: number; memories_imported?: number } | null;
  revalidatePath(LIST_PATH);
  redirect(resultUrl(
    `${result?.memories_imported ?? importRows.length} memória(s) importada(s) e ${result?.locations_processed ?? locationsInFile.size} local(is) sincronizado(s).`,
    "success",
    budget.id,
  ));
}
