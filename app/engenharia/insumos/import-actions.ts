"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/insumos";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

const headerAliases: Record<string, string> = {
  codigo_insumo: "codigo_insumo",
  codigo: "codigo_insumo",
  descricao: "descricao",
  unidade: "unidade",
  natureza: "natureza",
  categoria: "natureza",
  codigo_familia: "codigo_familia",
  familia_codigo: "codigo_familia",
  nome_familia: "nome_familia",
  familia_nome: "nome_familia",
  marca_referencia: "marca_referencia",
  marca: "marca_referencia",
  especificacao_tecnica: "especificacao_tecnica",
  especificacao: "especificacao_tecnica",
  sistema_origem: "sistema_origem",
  codigo_origem: "codigo_origem",
  id_origem: "id_origem",
  observacoes: "observacoes",
  observacao: "observacoes",
  notas: "observacoes",
  status: "status",
};

const categoryAliases: Record<string, string> = {
  material: "material",
  materiais: "material",
  labor: "labor",
  mao_de_obra: "labor",
  equipamento: "equipment",
  equipamentos: "equipment",
  equipment: "equipment",
  servico: "service",
  servico_terceirizado: "service",
  service: "service",
  frete: "freight",
  freight: "freight",
  outro: "other",
  outros: "other",
  outro_custo: "other",
  other: "other",
};

const statusAliases: Record<string, string> = {
  active: "active",
  ativo: "active",
  ativa: "active",
  inactive: "inactive",
  inativo: "inactive",
  inativa: "inactive",
};

type ImportedInputRow = {
  code: string;
  description: string;
  unit: string;
  category: string;
  family_code: string | null;
  family_label: string | null;
  brand_reference: string | null;
  technical_specification: string | null;
  source_system: string;
  source_code: string | null;
  source_id: string | null;
  notes: string | null;
  status: string;
};

function resultUrl(message: string, type: "error" | "success" = "error") {
  const safeMessage = message.length > 1500 ? `${message.slice(0, 1497)}...` : message;
  return `${LIST_PATH}?${new URLSearchParams({ [type]: safeMessage }).toString()}`;
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

  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === "insumos") ?? workbook.SheetNames[0];
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

export async function importEngineeringInputs(formData: FormData) {
  const uploaded = formData.get("file");
  if (!(uploaded instanceof File) || uploaded.size === 0) {
    redirect(resultUrl("Selecione o arquivo XLSX com a lista de insumos."));
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
    console.error("engineering_inputs_xlsx_read_error", error);
    redirect(resultUrl("Não foi possível ler a planilha. O arquivo pode estar protegido, corrompido ou fora do padrão XLSX."));
  }

  if (!matrix || matrix.length === 0) {
    redirect(resultUrl("A planilha não possui uma aba de insumos."));
  }

  const columns = new Map<string, number>();
  const headerRow = matrix[0] ?? [];
  headerRow.forEach((value, columnIndex) => {
    const header = normalizeHeader(value);
    if (header) columns.set(header, columnIndex);
  });

  const requiredHeaders = ["codigo_insumo", "descricao", "unidade", "natureza"];
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

  if (rawRows.length === 0) redirect(resultUrl("A aba Insumos não possui linhas preenchidas."));
  if (rawRows.length > MAX_ROWS) redirect(resultUrl(`A importação permite no máximo ${MAX_ROWS.toLocaleString("pt-BR")} insumos por arquivo.`));

  const errors: string[] = [];
  const rows: ImportedInputRow[] = [];
  const codes = new Map<string, number>();
  const sourceIds = new Map<string, number>();

  rawRows.forEach(({ rowNumber, values }) => {
    const code = requiredText(values.codigo_insumo).toUpperCase();
    const description = requiredText(values.descricao);
    const unit = requiredText(values.unidade);
    const category = categoryAliases[normalizeText(values.natureza)] ?? null;
    const status = statusAliases[normalizeText(values.status || "active")] ?? null;
    const sourceSystem = requiredText(values.sistema_origem) || "elos_os";
    const sourceId = optionalText(values.id_origem);

    if (!code) errors.push(`Linha ${rowNumber}: código do insumo não informado.`);
    if (!description) errors.push(`Linha ${rowNumber}: descrição não informada.`);
    if (!unit) errors.push(`Linha ${rowNumber}: unidade não informada.`);
    if (!category) errors.push(`Linha ${rowNumber}: natureza inválida.`);
    if (!status) errors.push(`Linha ${rowNumber}: status inválido.`);

    if (code) {
      const previousRow = codes.get(code);
      if (previousRow) errors.push(`Linha ${rowNumber}: código ${code} repetido; já apareceu na linha ${previousRow}.`);
      else codes.set(code, rowNumber);
    }

    if (sourceId) {
      const sourceKey = `${sourceSystem.toLowerCase()}::${sourceId.toLowerCase()}`;
      const previousRow = sourceIds.get(sourceKey);
      if (previousRow) errors.push(`Linha ${rowNumber}: id_origem repetido; já apareceu na linha ${previousRow}.`);
      else sourceIds.set(sourceKey, rowNumber);
    }

    if (code && description && unit && category && status) {
      rows.push({
        code,
        description,
        unit,
        category,
        family_code: optionalText(values.codigo_familia)?.toUpperCase() ?? null,
        family_label: optionalText(values.nome_familia),
        brand_reference: optionalText(values.marca_referencia),
        technical_specification: optionalText(values.especificacao_tecnica),
        source_system: sourceSystem,
        source_code: optionalText(values.codigo_origem),
        source_id: sourceId,
        notes: optionalText(values.observacoes),
        status,
      });
    }
  });

  if (errors.length > 0) redirect(resultUrl(rowErrorSummary(errors)));

  const { supabase, companyId } = await requireCompanyPermission("inputs.manage");
  const { data, error } = await supabase.rpc("import_engineering_inputs", {
    p_company_id: companyId,
    p_rows: rows,
  });

  if (error) redirect(resultUrl(error.message));

  const result = (data ?? {}) as { imported_count?: number; inserted_count?: number; updated_count?: number };
  const importedCount = result.imported_count ?? rows.length;
  const insertedCount = result.inserted_count ?? 0;
  const updatedCount = result.updated_count ?? 0;

  revalidatePath(LIST_PATH);
  revalidatePath("/engenharia/composicoes");
  redirect(resultUrl(`${importedCount.toLocaleString("pt-BR")} insumo(s) processado(s): ${insertedCount.toLocaleString("pt-BR")} novo(s) e ${updatedCount.toLocaleString("pt-BR")} atualizado(s).`, "success"));
}
