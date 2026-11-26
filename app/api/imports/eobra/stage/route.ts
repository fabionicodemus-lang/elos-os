import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parseImportFile } from "@/lib/eobra-import/parser.mjs";
import { buildProjectBinding, normalizeSourceHost, validateReferenceDate } from "@/lib/eobra-import/resolution.mjs";
import { ImportRequestError, assertImportCompany, assertImportEntityPermission, assertImportOrigin, checkImportProject, getImportWorkspace, importHeaderRow, importKind, importMapping, readImportFormData, readImportUpload, resolveImportRelationships, safeImportDatabaseMessage } from "@/lib/eobra-import/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertImportOrigin(request);
    const workspace = await getImportWorkspace();
    const form = await readImportFormData(request);
    const kind = importKind(form.get("entity_kind"));
    assertImportCompany(workspace.companyId, form.get("company_id"));
    await assertImportEntityPermission(workspace, kind);
    const projectId = await checkImportProject(workspace, kind, form.get("project_id"));
    const sourceHost = normalizeSourceHost(form.get("source_host"));
    const referenceDate = validateReferenceDate(form.get("reference_date"));
    const columnMapping = importMapping(form.get("mapping"), kind);
    const headerRow = importHeaderRow(form.get("header_row"));
    const { file, bytes } = await readImportUpload(form);
    const parsed = await parseImportFile(bytes, file.name, {
      entityKind: kind, sheetName: String(form.get("source_sheet") ?? ""), headerRow, columnMapping,
    });
    const projectBinding = projectId ? buildProjectBinding(parsed.rows, projectId,
      form.get("single_project_confirmed") === "true", Boolean(columnMapping.source_project)) : null;
    const rows = await resolveImportRelationships(workspace, kind, sourceHost, projectId, parsed.rows);
    const result = await workspace.supabase.rpc("stage_eobra_import", {
      p_company_id: workspace.companyId, p_project_id: projectId, p_source_host: sourceHost,
      p_entity_kind: kind, p_file_name: file.name.slice(0, 240), p_file_hash: createHash("sha256").update(bytes).digest("hex"),
      p_sheet_name: parsed.sheetName, p_reference_date: referenceDate,
      p_mapping: { version: "eobra-mapped-v1", columns: columnMapping, header_row: headerRow,
        single_project_confirmed: Boolean(projectBinding), project_binding: projectBinding },
      p_rows: rows,
    });
    if (result.error) throw new ImportRequestError(safeImportDatabaseMessage(result.error), 400);
    const batchId = result.data as string;
    return NextResponse.json({ batch_id: batchId, review_url: `/configuracoes/importacoes/${batchId}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível preparar a importação." },
      { status: error instanceof ImportRequestError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
