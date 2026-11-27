import { NextResponse } from 'next/server';
import { assertImportOrigin, getImportWorkspace, ImportRequestError } from '@/lib/eobra-import/server';
import { readSnapshotControl } from '@/lib/eobra-import/snapshot-request.mjs';
import { loadEobraSnapshot, snapshotUploadInspectionView } from '@/lib/eobra-import/snapshot-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertImportOrigin(request);
    const workspace = await getImportWorkspace();
    const control = await readSnapshotControl(request);
    const upload = await loadEobraSnapshot(workspace, control);
    return NextResponse.json({ inspection: snapshotUploadInspectionView(upload) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ImportRequestError ? error.message : 'Não foi possível conferir o pacote de migração.' },
      { status: error instanceof ImportRequestError ? error.status : 500 });
  }
}
