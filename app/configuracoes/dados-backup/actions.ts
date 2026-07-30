"use server";

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/configuracoes/dados-backup";
const BUCKET = "system-backups";
const ALLOWED_MODULES = new Set([
  "system",
  "registries",
  "projects",
  "engineering",
  "execution",
  "procurement",
  "finance",
  "commercial",
  "postwork",
  "documents",
  "other",
]);

type BackupSnapshot = {
  schema_version?: string;
  generated_at?: string;
  scope?: string;
  modules?: string[];
  table_count?: number;
  row_count?: number;
  company?: Record<string, unknown> | null;
  project?: Record<string, unknown> | null;
  warnings?: unknown[];
  tables?: Record<string, unknown[]>;
};

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function messageUrl(message: string, type: "success" | "error" = "error") {
  return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function safeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "empresa";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Falha inesperada ao gerar o pacote.";
}

function worksheetName(source: string, used: Set<string>) {
  const base = source.replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "dados";
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function cellValue(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

async function createExportFile(snapshot: BackupSnapshot, format: "json" | "xlsx") {
  if (format === "json") {
    return {
      buffer: Buffer.from(JSON.stringify(snapshot, null, 2), "utf8"),
      extension: "json",
      mimeType: "application/json",
    };
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Elos OS";
  workbook.company = "Elos OS";
  workbook.created = new Date();

  const manifest = workbook.addWorksheet("Manifesto");
  manifest.columns = [
    { header: "Campo", key: "field", width: 28 },
    { header: "Valor", key: "value", width: 80 },
  ];
  manifest.addRows([
    { field: "Versão do pacote", value: snapshot.schema_version ?? "elos-os-logical-backup-v1" },
    { field: "Gerado em", value: snapshot.generated_at ?? new Date().toISOString() },
    { field: "Escopo", value: snapshot.scope ?? "company" },
    { field: "Módulos", value: (snapshot.modules ?? []).join(", ") || "Todos" },
    { field: "Tabelas", value: Number(snapshot.table_count ?? 0) },
    { field: "Registros", value: Number(snapshot.row_count ?? 0) },
    { field: "Empresa", value: JSON.stringify(snapshot.company ?? {}) },
    { field: "Empreendimento", value: JSON.stringify(snapshot.project ?? {}) },
    { field: "Avisos", value: JSON.stringify(snapshot.warnings ?? []) },
  ]);
  manifest.views = [{ state: "frozen", ySplit: 1 }];
  manifest.autoFilter = "A1:B1";
  manifest.getRow(1).font = { bold: true };

  const usedNames = new Set<string>(["Manifesto"]);
  for (const [tableName, rawRows] of Object.entries(snapshot.tables ?? {})) {
    const rows = Array.isArray(rawRows) ? rawRows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
    const sheet = workbook.addWorksheet(worksheetName(tableName, usedNames));

    if (!rows.length) {
      sheet.addRow(["Sem registros no escopo exportado."]);
      continue;
    }

    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    sheet.columns = keys.map((key) => ({ header: key, key, width: Math.min(42, Math.max(14, key.length + 3)) }));
    for (const row of rows) {
      const converted: Record<string, string | number | boolean | Date | null> = {};
      for (const key of keys) converted[key] = cellValue(row[key]);
      sheet.addRow(converted);
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, keys.length) } };
    sheet.getRow(1).font = { bold: true };
  }

  const workbookBuffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(workbookBuffer),
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

function refresh() {
  revalidatePath(PATH);
}

export async function generateDataExport(formData: FormData) {
  const { supabase, company, companyId } = await requireCompanyPermission("admin.data.export");
  const scopeType = text(formData, "scope_type") === "project" ? "project" : "company";
  const projectId = scopeType === "project" ? text(formData, "project_id") || null : null;
  const format = text(formData, "format") === "xlsx" ? "xlsx" : "json";
  const retentionDays = Number.parseInt(text(formData, "retention_days") || "30", 10);
  const modules = formData
    .getAll("modules")
    .map((item) => String(item).trim())
    .filter((item) => ALLOWED_MODULES.has(item));

  if (scopeType === "project" && !projectId) {
    redirect(messageUrl("Selecione o empreendimento do pacote."));
  }
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    redirect(messageUrl("Escolha uma retenção entre 1 e 365 dias."));
  }

  const { data: exportIdData, error: createError } = await supabase.rpc("system_create_data_export", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_scope_type: scopeType,
    p_modules: modules,
    p_format: format,
    p_retention_days: retentionDays,
  });
  const exportId = typeof exportIdData === "string" ? exportIdData : "";
  if (createError || !exportId) {
    redirect(messageUrl(createError?.message ?? "Não foi possível iniciar a exportação."));
  }

  let failure = "";
  try {
    const { data: snapshotData, error: snapshotError } = await supabase.rpc("system_build_data_export", {
      p_company_id: companyId,
      p_project_id: projectId,
      p_modules: modules,
    });
    if (snapshotError || !snapshotData) throw new Error(snapshotError?.message ?? "O banco não retornou o pacote lógico.");

    const snapshot = snapshotData as BackupSnapshot;
    const generated = await createExportFile(snapshot, format);
    const checksum = createHash("sha256").update(generated.buffer).digest("hex");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const scopeLabel = scopeType === "project" ? "empreendimento" : "empresa";
    const fileName = `elos-os-${safeSlug(company.slug || company.name)}-${scopeLabel}-${timestamp}.${generated.extension}`;
    const storagePath = `${companyId}/${exportId}/${fileName}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, generated.buffer, {
      contentType: generated.mimeType,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { error: completeError } = await supabase.rpc("system_complete_data_export", {
      p_export_id: exportId,
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_mime_type: generated.mimeType,
      p_file_size: generated.buffer.length,
      p_checksum_sha256: checksum,
      p_table_count: Number(snapshot.table_count ?? Object.keys(snapshot.tables ?? {}).length),
      p_row_count: Number(snapshot.row_count ?? 0),
      p_metadata: {
        schema_version: snapshot.schema_version ?? "elos-os-logical-backup-v1",
        scope: snapshot.scope ?? scopeType,
        modules,
        project_id: projectId,
      },
    });
    if (completeError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      throw new Error(completeError.message);
    }
  } catch (error) {
    failure = errorMessage(error);
  }

  if (failure) {
    await supabase.rpc("system_fail_data_export", { p_export_id: exportId, p_error_message: failure });
    refresh();
    redirect(messageUrl(failure));
  }

  refresh();
  redirect(messageUrl("Pacote gerado, validado e armazenado de forma privada.", "success"));
}

export async function deleteDataExport(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("admin.data.manage");
  const exportId = text(formData, "export_id");
  const confirmation = text(formData, "confirmation");
  if (!exportId || confirmation !== "EXCLUIR") {
    redirect(messageUrl("Digite EXCLUIR para remover o pacote."));
  }

  const { data: record, error: recordError } = await supabase
    .from("system_data_exports")
    .select("id, storage_path")
    .eq("id", exportId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (recordError || !record) redirect(messageUrl(recordError?.message ?? "Pacote não localizado."));

  const { error: markError } = await supabase.rpc("system_mark_data_export_deleted", { p_export_id: exportId });
  if (markError) redirect(messageUrl(markError.message));

  if (record.storage_path) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([record.storage_path]);
    if (removeError) {
      refresh();
      redirect(messageUrl(`O registro foi excluído, mas o arquivo privado precisa de limpeza operacional: ${removeError.message}`));
    }
  }

  refresh();
  redirect(messageUrl("Pacote removido e operação registrada na auditoria.", "success"));
}

export async function requestDataRestore(formData: FormData) {
  const { supabase } = await requireCompanyPermission("admin.data.restore");
  const exportId = text(formData, "export_id");
  const reason = text(formData, "reason");
  const confirmation = text(formData, "confirmation");
  if (confirmation !== "SOLICITAR RESTAURAÇÃO") {
    redirect(messageUrl("Digite SOLICITAR RESTAURAÇÃO para abrir a revisão."));
  }

  const { error } = await supabase.rpc("system_request_data_restore", {
    p_export_id: exportId,
    p_reason: reason,
  });
  if (error) redirect(messageUrl(error.message));

  refresh();
  redirect(messageUrl("Solicitação registrada. Nenhum dado foi sobrescrito.", "success"));
}

export async function reviewDataRestore(formData: FormData) {
  const { supabase } = await requireCompanyPermission("admin.data.restore");
  const requestId = text(formData, "request_id");
  const decision = text(formData, "decision") === "reject" ? "reject" : "approve";
  const notes = text(formData, "notes");
  const confirmation = text(formData, "confirmation");
  const expected = decision === "approve" ? "APROVAR RESTAURAÇÃO" : "REJEITAR";
  if (confirmation !== expected) {
    redirect(messageUrl(`Digite ${expected} para confirmar a decisão.`));
  }

  const { error } = await supabase.rpc("system_review_data_restore", {
    p_request_id: requestId,
    p_decision: decision,
    p_notes: notes,
  });
  if (error) redirect(messageUrl(error.message));

  refresh();
  redirect(messageUrl(decision === "approve" ? "Restauração aprovada para procedimento manual controlado." : "Solicitação rejeitada.", "success"));
}

export async function cancelDataRestore(formData: FormData) {
  const { supabase } = await requireCompanyPermission("admin.data.restore");
  const requestId = text(formData, "request_id");
  const reason = text(formData, "reason");
  if (text(formData, "confirmation") !== "CANCELAR") {
    redirect(messageUrl("Digite CANCELAR para encerrar a solicitação."));
  }
  const { error } = await supabase.rpc("system_cancel_data_restore", {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) redirect(messageUrl(error.message));

  refresh();
  redirect(messageUrl("Solicitação de restauração cancelada.", "success"));
}
