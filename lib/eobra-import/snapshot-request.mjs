import { ImportRequestError } from './request.mjs';

export const SNAPSHOT_BUCKET = 'eobra-migration-snapshots';
export const SNAPSHOT_BUNDLE_BUCKET = 'eobra-migration-bundles';
export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
export const MAX_SNAPSHOT_PART_BYTES = 2 * 1024 * 1024;
export const MAX_SNAPSHOT_CONTROL_BYTES = 128 * 1024;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`, 'i');
const SINGLE_PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})\\.json$`, 'i');
const BUNDLE_PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})/manifest\\.json$`, 'i');
const PART_NAME_RE = /^part-(\d{6})\.json$/;

/** The file is uploaded directly to private Storage; requests only carry its identity. */
export async function readSnapshotControl(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw new ImportRequestError('Origem da solicitação não permitida.', 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) {
    throw new ImportRequestError('Envie o pacote pelo formulário da migração.');
  }
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_SNAPSHOT_CONTROL_BYTES) {
    throw new ImportRequestError('A solicitação de migração excede o limite permitido.', 413);
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SNAPSHOT_CONTROL_BYTES) {
        await reader.cancel();
        throw new ImportRequestError('A solicitação de migração excede o limite permitido.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(await new Blob(chunks).text()); }
  catch { throw new ImportRequestError('A solicitação de migração é inválida.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ImportRequestError('A solicitação de migração é inválida.');
  }
  return body;
}

/** An authenticated user can inspect only their immutable upload in the active company. */
export function assertSnapshotPath(path, companyId, userId) {
  if (!UUID_RE.test(companyId) || !UUID_RE.test(userId) || typeof path !== 'string') {
    throw new ImportRequestError('Arquivo da migração inválido.', 403);
  }
  const match = SINGLE_PATH_RE.exec(path) ?? BUNDLE_PATH_RE.exec(path);
  if (!match || match[1] !== companyId || match[2] !== userId) {
    throw new ImportRequestError('O arquivo não pertence ao usuário e à empresa selecionados.', 403);
  }
  return path;
}

/** Omit userId only after authorizing the persisted run and all native permissions. */
export function assertSnapshotBundlePath(path, companyId, userId) {
  const match = typeof path === 'string' ? BUNDLE_PATH_RE.exec(path) : null;
  if (!UUID_RE.test(companyId) || !match || match[1] !== companyId || (userId !== undefined && (!UUID_RE.test(userId) || match[2] !== userId))) {
    throw new ImportRequestError('A pasta da migração não pertence ao escopo autorizado.', 403);
  }
  return path;
}

export function assertSnapshotPartPath(manifestPath, partName, companyId, userId) {
  const path = assertSnapshotBundlePath(manifestPath, companyId, userId);
  const match = typeof partName === 'string' ? PART_NAME_RE.exec(partName) : null;
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 1000) {
    throw new ImportRequestError('Nome da parte da migração inválido.', 403);
  }
  return path.slice(0, -'manifest.json'.length) + partName;
}

/** Bucket selection comes from a validated path shape, never a caller-supplied bucket. */
export function snapshotStorageBucket(path) {
  if (typeof path === 'string' && BUNDLE_PATH_RE.test(path)) return SNAPSHOT_BUNDLE_BUCKET;
  if (typeof path === 'string' && SINGLE_PATH_RE.test(path)) return SNAPSHOT_BUCKET;
  throw new ImportRequestError('Arquivo da migração inválido.', 403);
}

export function parseSnapshotProjectMap(input, sourceProjectIds) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ImportRequestError('Confira a correspondência dos empreendimentos.');
  }
  const allowed = new Set(sourceProjectIds);
  const entries = Object.entries(input);
  if (entries.length > 1_000 || entries.some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || !UUID_RE.test(value))) {
    throw new ImportRequestError('O vínculo de um empreendimento é inválido. Atualize a prévia.');
  }
  if (new Set(entries.map(([, value]) => value)).size !== entries.length) {
    throw new ImportRequestError('Cada empreendimento do eObra deve corresponder a uma obra distinta no Elos.');
  }
  return Object.fromEntries(entries);
}

export function snapshotRequiredPermissions(records) {
  const permissions = new Set(['admin.company.manage']);
  for (const record of records) {
    switch (record.entity) {
      case 'project': permissions.add('projects.manage'); break;
      case 'unit': permissions.add('projects.manage'); permissions.add('sales.manage'); break;
      case 'sale': permissions.add('sales.manage'); permissions.add('clients.manage'); break;
      case 'receivable': permissions.add('receivables.manage'); permissions.add('sales.manage'); permissions.add('clients.manage'); break;
      case 'payable': permissions.add('payables.manage'); permissions.add('suppliers.manage'); break;
      case 'person':
        permissions.add('clients.manage');
        permissions.add('suppliers.manage');
        if (Array.isArray(record.normalized?.roles)) {
          if (record.normalized.roles.includes('client')) permissions.add('clients.manage');
          if (record.normalized.roles.includes('supplier')) permissions.add('suppliers.manage');
          if (record.normalized.roles.includes('broker')) permissions.add('sales.manage');
        }
        break;
      case 'settlement': permissions.add('receivables.manage'); permissions.add('payables.manage'); break;
      case 'bank_account': case 'bank_transaction': permissions.add('finance.bank_accounts.manage'); break;
      case 'correction_index': case 'index_value': permissions.add('receivables.manage'); break;
      case 'raw_archive':
        // Unclassified source data can contain commercial and financial details.
        for (const permission of ['projects.manage', 'clients.manage', 'suppliers.manage', 'sales.manage', 'receivables.manage', 'payables.manage', 'finance.bank_accounts.manage']) permissions.add(permission);
        break;
    }
  }
  return [...permissions].sort();
}
