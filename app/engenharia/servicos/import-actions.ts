"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/servicos";
const IMPORT_PATH = "/engenharia/servicos/importar";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const allowedMethods = new Set(["unit", "count", "length", "area", "volume", "weight", "custom"]);

const headerAliases: Record<string, string> = {
  codigo_servico: "codigo_servico",
  codigo: "codigo_servico",
  servico_codigo: "codigo_servico",
  descricao: "descricao",
  servico: "descricao",
  unidade: "unidade",
  un: "unidade",
  codigo_grupo: "codigo_grupo",
  grupo_codigo: "codigo_grupo",
  grupo: "codigo_grupo",
  metodo: "metodo",
  metodo_padrao: "metodo",
  default_method: "metodo",
  regra_levantamento: "regra_levantamento",
  takeoff_rule: "regra_levantamento",
  regra_medicao: "regra_medicao",
  measurement_rule: "regra_medicao",
  observacoes: "observacoes",
  observacao: "observacoes",
  notas: "observacoes",
  status: "status",
};

const methodAliases: Record<string, string> = {
  unit: "unit",
  unidade: "unit",
  valor_global_unidade: "unit",
  count: "count",
  contagem: "count",
  length: "length",
  comprimento: "length",
  area: "area",
  volume: "volume",
  weight: "weight",
  peso: "weight",
  custom: "custom",
  formula_personalizada: "custom",
};

const statusAliases: Record<string, string> = {
  active: "active",
  ativo: "active",
  ativa: "active",
  inactive: "inactive",
  inativo: "inactive",
  inativa: "inactive",
};

type ImportedServiceRow = {
  code: string;
  description: string;
  unit: string;
  group_code: string | null;
  default_method: string;
  takeoff_rule: string | null;
  measurement_rule: string | null;
  notes: string | null;
  status: string;
};

function resultUrl(message: string, type: "error" | "success" = "error") {
  const safeMessage = message.length > 1500 ? `${message.slice(0, 1497)}...` : message;
  return `${IMPORT_PATH}?${new URLSearchParams({ [type]: safeMessage }).toString()}`;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeHeader(value: unknown) {
  const normalized = normalizeText(value);
  return headerAliases[normalized] ?? normalized;
}

function requiredText(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value ?? "").trim();
}

function optionalText(value: unknown) {
  const result = requiredText(value);
  return result || null;
}

function rowErrorSummary(errors: string[]) {
  const visible = errors.slice(0, 10);
  const suffix = errors.length > visible.length ? ` Mais ${errors.length - visible.length} erro(s).` : "";
  return `A planilha não foi importada. ${visible.join(" | ")}${suffix}`;
}

function readSpreadsheetRows(buffer: ArrayBuffer) {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    dense: true,
  });

  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === "servicos") ?? workbook.SheetNames[0];
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

export async function importEngineeringServices(formData: FormData) {
  const uploaded = formData.get("file");
  if (!(uploaded instanceof File) || uploaded.size === 0) {
    redirect(resultUrl("Selecione o arquivo XLSX com a lista de serviços."));
  }

  if (!uploaded.name.toLowerCase().endsWith(".xlsx")) {
    redirect(resultUrl("O arquivo precisa estar no formato XLSX."));
  }

  if (uploaded.size > MAX_FILE_SIZE) {
    redirect(resultUrl("O arquivo ultrapassa o limite de 5 MB."));
  }

  let matrix: unknown[][] | null = null;
  try {
    matrix = readSpreadsheetRows(await uploaded.arrayBuffer());
  } catch (error) {
    console.error("engineering_services_xlsx_read_error", error);
    redirect(resultUrl("Não foi possível ler a planilha. O arquivo pode estar protegido, corrompido ou fora do padrão XLSX."));
  }

  if (!matrix || matrix.length === 0) {
    redirect(resultUrl("A planilha não possui uma aba de serviços."));
  }

  const columns = new Map<string, number>();
  const headerRow = matrix[0] ?? [];
  headerRow.forEach((value, columnIndex) => {
    const header = normalizeHeader(value);
    if (header) columns.set(header, columnIndex);
  });

  const requiredHeaders = ["codigo_servico", "descricao", "unidade"];
  const missingHeaders = requiredHeaders.filter((header) => !columns.has(header));
  if (missingHeaders.length > 0) {
    redirect(resultUrl(`Colunas obrigatórias ausentes: ${missingHeaders.join(", ")}.`));
  }

  const rawRows: { rowNumber: number; values: Record<string, unknown> }[] = [];
  matrix.slice(1).forEach((row, index) => {
    const values: Record<string, unknown> = {};
    columns.forEach((columnIndex, header) => {
      values[header] = row[columnIndex] ?? "";
    });
    const hasContent = Object.values(values).some((value) => requiredText(value) !== "");
    if (hasContent) rawRows.push({ rowNumber: index + 2, values });
  });

  if (rawRows.length === 0) redirect(resultUrl("A aba Serviços não possui linhas preenchidas."));
  if (rawRows.length > MAX_ROWS) redirect(resultUrl(`A importação permite no máximo ${MAX_ROWS.toLocaleString("pt-BR")} serviços por arquivo.`));

  const errors: string[] = [];
  const rows: ImportedServiceRow[] = [];
  const codes = new Map<string, number>();

  rawRows.forEach(({ rowNumber, values }) => {
    const code = requiredText(values.codigo_servico).toUpperCase();
    const description = requiredText(values.descricao);
    const unit = requiredText(values.unidade).toLowerCase();
    const method = methodAliases[normalizeText(values.metodo || "unit")] ?? normalizeText(values.metodo || "unit");
    const status = statusAliases[normalizeText(values.status || "active")] ?? null;

    if (!code) errors.push(`Linha ${rowNumber}: código do serviço não informado.`);
    if (!description) errors.push(`Linha ${rowNumber}: descrição não informada.`);
    if (!unit) errors.push(`Linha ${rowNumber}: unidade não informada.`);
    if (!allowedMethods.has(method)) errors.push(`Linha ${rowNumber}: método inválido.`);
    if (!status) errors.push(`Linha ${rowNumber}: status inválido.`);

    if (code) {
      const previousRow = codes.get(code);
      if (previousRow) errors.push(`Linha ${rowNumber}: código ${code} repetido; já apareceu na linha ${previousRow}.`);
      else codes.set(code, rowNumber);
    }

    if (code && description && unit && allowedMethods.has(method) && status) {
      rows.push({
        code,
        description,
        unit,
        group_code: optionalText(values.codigo_grupo)?.toUpperCase() ?? null,
        default_method: method,
        takeoff_rule: optionalText(values.regra_levantamento),
        measurement_rule: optionalText(values.regra_medicao),
        notes: optionalText(values.observacoes),
        status,
      });
    }
  });

  if (errors.length > 0) redirect(resultUrl(rowErrorSummary(errors)));

  const { supabase, companyId, userId } = await requireCompanyPermission("services.manage");
  const { data: existing, error: existingError } = await supabase
    .from("engineering_services")
    .select("code")
    .eq("company_id", companyId)
    .limit(10000);

  if (existingError) redirect(resultUrl(existingError.message));

  const existingCodes = new Set((existing ?? []).map((item) => String(item.code).toUpperCase()));
  const now = new Date().toISOString();
  const payload = rows.map((row) => ({
    company_id: companyId,
    code: row.code,
    description: row.description,
    unit: row.unit,
    group_code: row.group_code,
    default_method: row.default_method,
    takeoff_rule: row.takeoff_rule,
    measurement_rule: row.measurement_rule,
    notes: row.notes,
    status: row.status,
    source_system: "elos_os",
    source_id: `master-service:${row.code.toLowerCase()}`,
    created_by: userId,
    updated_at: now,
  }));

  const { error } = await supabase
    .from("engineering_services")
    .upsert(payload, { onConflict: "company_id,code" });

  if (error) redirect(resultUrl(error.message));

  const updatedCount = rows.filter((row) => existingCodes.has(row.code)).length;
  const insertedCount = rows.length - updatedCount;

  revalidatePath(LIST_PATH);
  revalidatePath("/engenharia/composicoes");
  revalidatePath("/engenharia/insumos");
  redirect(resultUrl(`${rows.length.toLocaleString("pt-BR")} serviço(s) processado(s): ${insertedCount.toLocaleString("pt-BR")} novo(s) e ${updatedCount.toLocaleString("pt-BR")} atualizado(s).`, "success"));
}
