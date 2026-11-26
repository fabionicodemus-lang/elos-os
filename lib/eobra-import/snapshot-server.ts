import 'server-only';

import { hashEobraValue, inspectEobraSnapshot } from './snapshot.mjs';
import { inspectEobraPackageManifest, inspectEobraPackagePart } from './package.mjs';
import { getImportWorkspace, ImportRequestError } from './server';
import { assertSnapshotBundlePath, assertSnapshotPartPath, assertSnapshotPath, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_PART_BYTES, parseSnapshotProjectMap, SNAPSHOT_BUNDLE_BUCKET, snapshotRequiredPermissions, snapshotStorageBucket } from './snapshot-request.mjs';

type Workspace = Awaited<ReturnType<typeof getImportWorkspace>>;

async function requireSnapshotPermissions(workspace: Workspace, permissions: string[]) {
  const checks = await Promise.all(permissions.map((permission) =>
    workspace.supabase.rpc('has_company_permission', { target_company_id: workspace.companyId, target_permission: permission })));
  if (checks.some((check) => check.error || check.data !== true)) {
    throw new ImportRequestError('Seu perfil precisa ter acesso aos cadastros e módulos incluídos neste pacote.', 403);
  }
}

export async function loadEobraSnapshot(workspace: Workspace, control: Record<string, unknown>) {
  if (control.company_id !== workspace.companyId) {
    throw new ImportRequestError('A empresa selecionada mudou. Atualize a página antes de continuar.', 409);
  }
  const path = assertSnapshotPath(control.storage_path, workspace.companyId, workspace.userId);
  const bucket = snapshotStorageBucket(path);
  const isParts = bucket === SNAPSHOT_BUNDLE_BUCKET;
  if (isParts) await requireSnapshotPermissions(workspace, snapshotRequiredPermissions([{ entity: 'raw_archive' }]));
  const downloaded = await workspace.supabase.storage.from(bucket).download(path);
  if (downloaded.error || !downloaded.data) {
    throw new ImportRequestError('Não foi possível ler o pacote. Envie o arquivo novamente.', 404);
  }
  if (!downloaded.data.size || downloaded.data.size > (isParts ? MAX_SNAPSHOT_PART_BYTES : MAX_SNAPSHOT_BYTES)) {
    throw new ImportRequestError(isParts ? 'O manifesto deve ter até 2 MiB.' : 'Use um pacote JSON de até 50 MiB.', 413);
  }
  let original: unknown;
  try { original = JSON.parse(await downloaded.data.text()); }
  catch { throw new ImportRequestError('O pacote não contém um JSON válido.'); }
  if (isParts) {
    const checked = inspectEobraPackageManifest(original);
    if (!checked.ok || !checked.manifest) throw new ImportRequestError(checked.errors[0] ?? 'O manifesto da migração é inválido.');
    return { transport: 'parts' as const, original: checked.manifest, path };
  }
  const inspection = inspectEobraSnapshot(original);
  if (!inspection.source?.host || !inspection.source.capturedAt || !inspection.source.referenceDate || !inspection.snapshotHash || !inspection.records?.length) {
    throw new ImportRequestError(inspection.errors?.[0] ?? 'O pacote de migração não contém registros válidos.');
  }
  await requireSnapshotPermissions(workspace, snapshotRequiredPermissions(inspection.records));
  return { transport: 'single' as const, original, inspection, path };
}

/** Read just one immutable part after the caller has authorized the persisted run. */
export async function loadEobraSnapshotPart(workspace: Workspace, runId: string, storagePath: unknown, ordinal: unknown) {
  await requireSnapshotPermissions(workspace, snapshotRequiredPermissions([{ entity: 'raw_archive' }]));
  const manifestPath = assertSnapshotBundlePath(storagePath, workspace.companyId);
  const result = await workspace.supabase.from('eobra_migration_snapshots').select('document')
    .eq('run_id', runId).eq('company_id', workspace.companyId).maybeSingle();
  if (result.error || !result.data) throw new ImportRequestError('O manifesto desta coleta não está disponível.', 404);
  const checked = inspectEobraPackageManifest(result.data.document);
  if (!checked.ok || !checked.manifest) throw new ImportRequestError('O manifesto salvo está inconsistente. A preparação foi interrompida.', 409);
  if (!Number.isInteger(ordinal) || Number(ordinal) < 1) throw new ImportRequestError('A próxima parte da coleta é inválida.', 409);
  const descriptor = checked.manifest.parts.find((part) => part.ordinal === ordinal);
  if (!descriptor) throw new ImportRequestError('A próxima parte não consta no manifesto salvo.', 409);
  const path = assertSnapshotPartPath(manifestPath, descriptor.name, workspace.companyId);
  const downloaded = await workspace.supabase.storage.from(SNAPSHOT_BUNDLE_BUCKET).download(path);
  if (downloaded.error || !downloaded.data) throw new ImportRequestError('Uma parte da coleta ainda não está disponível. Conclua o envio da pasta e retome.', 404);
  if (!downloaded.data.size || downloaded.data.size > MAX_SNAPSHOT_PART_BYTES) throw new ImportRequestError('Uma parte excede o limite de 2 MiB.', 413);
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const inspected = inspectEobraPackagePart(bytes, descriptor);
  if (!inspected.ok) throw new ImportRequestError(inspected.errors[0] ?? 'Uma parte não corresponde ao manifesto salvo.', 409);
  let jsonText: string;
  try { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new ImportRequestError('Uma parte não contém texto UTF-8 válido.', 400); }
  return { ordinal: descriptor.ordinal, jsonText };
}

export function snapshotUploadInspectionView(upload: Awaited<ReturnType<typeof loadEobraSnapshot>>) {
  if (upload.transport === 'single') return { ...snapshotInspectionView(upload.inspection), transport: 'single', verificationPending: false };
  const manifest = upload.original;
  return {
    transport: 'parts', verificationPending: true, partCount: manifest.parts.length,
    ok: true, complete: false, allProjectsComplete: false,
    source: manifest.source, scope: manifest.scope, snapshotHash: hashEobraValue(manifest),
    summary: { records: manifest.recordCount, uniqueRecords: 0, validRecords: 0, blockedRecords: 0, archivedRecords: 0, promotionBlockedRecords: 0 },
    errors: [], warnings: ['O manifesto foi conferido. Os registros, os vínculos, os totais e a cobertura serão verificados por partes durante a preparação.'],
    projects: manifest.scope.projectIds.map((sourceId) => ({ sourceId, name: `Obra ${sourceId}` })),
    coverage: manifest.coverage.map((item) => ({
      entity: item.entity, sourceProjectId: item.sourceProjectId, archiveType: item.archiveType,
      expectedCount: item.expectedCount, collectedCount: null, complete: false,
      detailsExpected: item.detailsExpected, detailsCollected: null,
      errors: [], warnings: ['A conferir durante a preparação.'],
    })),
    sample: [],
  };
}

export async function validateSnapshotProjectMap(workspace: Workspace, input: unknown, sourceProjectIds: readonly string[]) {
  const map = parseSnapshotProjectMap(input ?? {}, sourceProjectIds);
  const targetIds = [...new Set(Object.values(map))];
  if (targetIds.length) {
    const result = await workspace.supabase.from('projects').select('id').eq('company_id', workspace.companyId).in('id', targetIds);
    if (result.error || result.data?.length !== targetIds.length) {
      throw new ImportRequestError('Uma obra vinculada não está disponível na empresa selecionada.', 403);
    }
  }
  return map;
}

export function snapshotInspectionView(inspection: ReturnType<typeof inspectEobraSnapshot>) {
  return {
    ok: inspection.ok,
    complete: inspection.complete,
    allProjectsComplete: inspection.allProjectsComplete,
    source: inspection.source,
    scope: inspection.scope,
    snapshotHash: inspection.snapshotHash,
    summary: inspection.summary,
    errors: inspection.errors.slice(0, 100),
    warnings: inspection.warnings.slice(0, 100),
    projects: inspection.records.filter((record) => record.entity === 'project').map((record) => ({
      sourceId: record.sourceId, name: String(record.normalized.name ?? record.sourceId),
    })),
    coverage: inspection.coverage.map((item) => ({
      entity: item.entity, sourceProjectId: item.sourceProjectId, archiveType: item.archiveType,
      expectedCount: item.expectedCount, collectedCount: item.collectedCount, complete: item.complete,
      detailsExpected: item.detailsExpected, detailsCollected: item.detailsCollected.length,
      errors: item.errors.slice(0, 20), warnings: item.warnings.slice(0, 20),
    })),
    sample: inspection.records.slice(0, 50).map((record) => ({
      entity: record.entity, sourceId: record.sourceId, sourceProjectId: record.sourceProjectId,
      label: String(record.normalized.name ?? record.normalized.description ?? record.normalized.number ?? record.normalized.code ?? record.sourceId).slice(0, 200),
      disposition: record.disposition, errors: record.errors.slice(0, 10), warnings: record.warnings.slice(0, 10),
      promotionBlockers: record.promotionBlockers.slice(0, 10),
    })),
  };
}
