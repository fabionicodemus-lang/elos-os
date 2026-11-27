import { ImportRequestError } from './request.mjs';

export const MAX_UNIT_MAP_BYTES = 3 * 1024 * 1024;
export const UNIT_MAP_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Match the immutable run scope; parts already carry the maximum native permission set. */
export function unitMapRequiredPermissions(runPermissions) {
  if (!Array.isArray(runPermissions) || runPermissions.length > 64 || runPermissions.some(permission => typeof permission !== 'string' || !permission || permission.length > 100 || permission.trim() !== permission)) {
    throw new ImportRequestError('Não foi possível validar as permissões desta coleta.', 403);
  }
  return [...new Set(['admin.company.manage', 'projects.manage', 'sales.manage', ...runPermissions])].sort();
}

/** Identity is explicit: neither source IDs nor unit codes are normalized or inferred. */
export function parseSnapshotUnitMap(input, expectedCount) {
  if (!object(input)) throw new ImportRequestError('Confira as decisões para as unidades.');
  const entries = Object.entries(input);
  if (entries.length > 100_000 || (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 0 || entries.length !== expectedCount))) {
    throw new ImportRequestError('Escolha um destino para cada unidade da coleta antes de confirmar.');
  }
  const targets = new Set();
  const mapped = entries.map(([sourceId, decision]) => {
    if (!sourceId || sourceId.length > 512 || sourceId.trim() !== sourceId || /[\u0000-\u001f\u007f]/.test(sourceId) || !object(decision)) {
      throw new ImportRequestError('Uma decisão de unidade contém um identificador inválido.');
    }
    if (decision.action === 'create' && exactKeys(decision, ['action'])) return [sourceId, { action: 'create' }];
    if (decision.action !== 'reuse' || !exactKeys(decision, ['action', 'unit_id', 'expected_identity_hash']) || typeof decision.unit_id !== 'string' || !UUID.test(decision.unit_id) || typeof decision.expected_identity_hash !== 'string' || !HASH.test(decision.expected_identity_hash)) {
      throw new ImportRequestError('Selecione novamente a unidade existente para conferir sua identidade.');
    }
    const target = decision.unit_id.toLowerCase();
    if (targets.has(target)) throw new ImportRequestError('Duas unidades da origem não podem usar o mesmo cadastro do Elos.');
    targets.add(target);
    return [sourceId, { action: 'reuse', unit_id: target, expected_identity_hash: decision.expected_identity_hash }];
  });
  const result = Object.fromEntries(mapped);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_UNIT_MAP_BYTES) {
    throw new ImportRequestError('O de-para excede 3 MiB. Prepare uma coleta com menos unidades por revisão.', 413);
  }
  return result;
}

/** Separate bounded control: the snapshot and raw records never travel in this request. */
export async function readSnapshotUnitMapRequest(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new ImportRequestError('Origem da solicitação não permitida.', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) {
    throw new ImportRequestError('Confirme os vínculos pelo formulário das unidades.');
  }
  const size = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(size) && size > MAX_UNIT_MAP_BYTES) throw new ImportRequestError('O de-para excede 3 MiB.', 413);
  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_UNIT_MAP_BYTES) {
        await reader.cancel();
        throw new ImportRequestError('O de-para excede 3 MiB.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body;
  try { body = JSON.parse(await new Blob(chunks).text()); }
  catch { throw new ImportRequestError('O de-para das unidades é inválido.'); }
  if (!object(body) || !exactKeys(body, ['company_id', 'run_id', 'confirm_units', 'unit_map']) || typeof body.company_id !== 'string' || !UUID.test(body.company_id) || typeof body.run_id !== 'string' || !UUID.test(body.run_id) || body.confirm_units !== true) {
    throw new ImportRequestError('Confira a empresa, a coleta e a confirmação dos vínculos.');
  }
  return { company_id: body.company_id, run_id: body.run_id, confirm_units: true, unit_map: parseSnapshotUnitMap(body.unit_map) };
}

export function parseUnitMapPageQuery(parameters) {
  const mode = parameters.get('mode') ?? 'source';
  const pageText = parameters.get('page') ?? '1';
  const search = parameters.get('search') ?? '';
  const projectId = parameters.get('project_id') || null;
  const companyId = parameters.get('company_id') ?? '';
  const runId = parameters.get('run_id') ?? '';
  if (!['source', 'options'].includes(mode) || !/^[1-9]\d{0,3}$/.test(pageText) || Number(pageText) > 2_000 || search.length > 120 || /[\u0000-\u001f\u007f]/.test(search) || !UUID.test(companyId) || !UUID.test(runId) || (projectId !== null && !UUID.test(projectId)) || (mode === 'options' && !projectId)) {
    throw new ImportRequestError('A consulta de unidades é inválida.');
  }
  return { mode, page: Number(pageText), search, projectId, companyId, runId };
}

/** Supabase ilike receives a literal substring, without caller-controlled wildcards. */
export const unitMapSearchPattern = value => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
