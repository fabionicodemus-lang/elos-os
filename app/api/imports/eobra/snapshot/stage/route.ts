import { NextResponse } from 'next/server';
import { assertImportOrigin, getImportWorkspace, ImportRequestError, safeImportDatabaseMessage } from '@/lib/eobra-import/server';
import { readSnapshotControl } from '@/lib/eobra-import/snapshot-request.mjs';
import { loadEobraSnapshot, validateSnapshotProjectMap } from '@/lib/eobra-import/snapshot-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertImportOrigin(request);
    const workspace = await getImportWorkspace();
    const control = await readSnapshotControl(request);
    const upload = await loadEobraSnapshot(workspace, control);
    const sourceProjectIds = upload.transport === 'parts' ? upload.original.scope.projectIds : upload.inspection.scope.projectIds;
    const projectMap = await validateSnapshotProjectMap(workspace, control.project_map, sourceProjectIds);
    const result = upload.transport === 'parts'
      ? await workspace.supabase.rpc('begin_eobra_snapshot_parts', {
        p_company_id: workspace.companyId, p_manifest: upload.original, p_project_map: projectMap, p_storage_path: upload.path,
      })
      : await workspace.supabase.rpc('begin_eobra_snapshot', {
        p_company_id: workspace.companyId, p_snapshot: upload.original, p_project_map: projectMap,
      });
    if (result.error) throw new ImportRequestError(safeImportDatabaseMessage(result.error), 400);
    if (typeof result.data !== 'string') throw new ImportRequestError('A coleta foi enviada, mas não foi possível abrir seu resultado. Consulte o histórico antes de reenviar.', 500);
    return NextResponse.json({ runId: result.data, href: `/configuracoes/importacoes/migracoes/${result.data}` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ImportRequestError ? error.message : 'Não foi possível preparar a revisão da migração.' },
      { status: error instanceof ImportRequestError ? error.status : 500 });
  }
}
