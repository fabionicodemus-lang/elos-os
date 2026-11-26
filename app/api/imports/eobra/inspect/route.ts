import { NextResponse } from "next/server";
import { FIELD_DEFINITIONS, inspectImportFile, suggestColumnMapping } from "@/lib/eobra-import/parser.mjs";
import { ImportRequestError, assertImportCompany, assertImportEntityPermission, assertImportOrigin, getImportWorkspace, importHeaderRow, importKind, readImportFormData, readImportUpload } from "@/lib/eobra-import/server";

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
    const { file, bytes } = await readImportUpload(form);
    const inspection = await inspectImportFile(bytes, file.name, { headerRow: importHeaderRow(form.get("header_row")) });
    return NextResponse.json({
      ...inspection, fields: FIELD_DEFINITIONS[kind],
      suggested_mappings: Object.fromEntries(inspection.sheets.map((sheet) => [sheet.name, suggestColumnMapping(sheet.headers, kind)])),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível ler o arquivo." },
      { status: error instanceof ImportRequestError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
